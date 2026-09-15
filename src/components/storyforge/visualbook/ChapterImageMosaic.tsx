import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChapterImage, ChapterImageLayout } from "../StoryForgeContext";
import { useStoryForge, isRtlBookLanguage } from "../StoryForgeContext";
import { SignedImage } from "@/components/SignedImage";
import { SignedUrlCountdown } from "@/components/SignedUrlCountdown";

type Props = {
  images: ChapterImage[];
  layout?: ChapterImageLayout;
  /** Aspect ratio class for the container, e.g. "aspect-[3/4]" or "aspect-video". */
  aspectClass: string;
  alt: string;
  onImageClick?: (index: number) => void;
};

/** Top-right overlay slot that hosts the signed-URL countdown badge.
 *  Non-interactive (pointer-events-none) so it never blocks tile clicks. */
function CountdownOverlay({ src, compact }: { src?: string | null; compact?: boolean }) {
  if (!src) return null;
  return (
    <div
      className={`pointer-events-none absolute z-[2] ${compact ? "top-1 right-1" : "top-1.5 right-1.5"}`}
    >
      <SignedUrlCountdown src={src} />
    </div>
  );
}

/**
 * Phase A: shared in-app rendering for a chapter's image set.
 * Phase B will mirror this logic in HTML/PDF/MP4 exports.
 */
export function ChapterImageMosaic({ images, layout = "stack", aspectClass, alt, onImageClick }: Props) {
  if (images.length === 0) return null;

  // Single image — same look as before, regardless of layout.
  if (images.length === 1) {
    return (
      <div className={`relative w-full ${aspectClass}`}>
        <SignedImage
          src={images[0].url}
          alt={alt}
          className="w-full h-full object-cover cursor-pointer"
          loading="lazy"
          onClick={() => onImageClick?.(0)}
        />
        <CountdownOverlay src={images[0].url} />
      </div>
    );
  }

  if (layout === "hero") {
    // Big first image + small thumbnails strip.
    const [hero, ...rest] = images;
    return (
      <div className={`flex flex-col w-full ${aspectClass}`}>
        <div className="relative flex-1 min-h-0">
          <SignedImage
            src={hero.url}
            alt={alt}
            className="w-full h-full object-cover cursor-pointer"
            loading="lazy"
            onClick={() => onImageClick?.(0)}
          />
          <CountdownOverlay src={hero.url} />
        </div>
        <div className="flex gap-1 p-1 bg-background/40 shrink-0">
          {rest.map((img, i) => (
            <button
              key={img.id}
              onClick={() => onImageClick?.(i + 1)}
              className="relative flex-1 h-12 rounded overflow-hidden border border-border/30 hover:border-primary/60 transition-colors"
            >
              <SignedImage src={img.url} alt={`${alt} ${i + 2}`} className="w-full h-full object-cover" loading="lazy" />
              <CountdownOverlay src={img.url} compact />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (layout === "carousel") {
    return <CarouselPreview images={images} aspectClass={aspectClass} alt={alt} onImageClick={onImageClick} />;
  }

  if (layout === "stack") {
    // Vertical stack inside the same aspect box (each image scaled to fit).
    return (
      <div className={`flex flex-col w-full ${aspectClass} gap-0.5 bg-background/30`}>
        {images.map((img, i) => (
          <div key={img.id} className="relative flex-1 min-h-0">
            <SignedImage
              src={img.url}
              alt={`${alt} ${i + 1}`}
              className="w-full h-full object-cover cursor-pointer"
              loading="lazy"
              onClick={() => onImageClick?.(i)}
            />
            <CountdownOverlay src={img.url} compact />
          </div>
        ))}
      </div>
    );
  }

  // Default: grid (auto 2x2 for up to 4 images).
  const cols = images.length === 2 ? "grid-cols-2" : "grid-cols-2";
  const rows = images.length <= 2 ? "grid-rows-1" : "grid-rows-2";
  return (
    <div className={`grid ${cols} ${rows} w-full ${aspectClass} gap-0.5 bg-background/30`}>
      {images.map((img, i) => (
        <button
          key={img.id}
          onClick={() => onImageClick?.(i)}
          className="relative overflow-hidden"
        >
          <SignedImage
            src={img.url}
            alt={`${alt} ${i + 1}`}
            className="w-full h-full object-cover hover:scale-[1.02] transition-transform"
            loading="lazy"
          />
          <CountdownOverlay src={img.url} compact />
        </button>
      ))}
    </div>
  );
}

/**
 * Live in-app mirror of the exported HTML carousel: sliding flex track with
 * prev/next + dots, and optional autoplay (with hover-pause) driven by the
 * global Format & Preview settings (`carouselAutoplay`, `carouselAutoplaySec`).
 */
function CarouselPreview({
  images, aspectClass, alt, onImageClick,
}: { images: ChapterImage[]; aspectClass: string; alt: string; onImageClick?: (i: number) => void }) {
  const { config } = useStoryForge();
  const autoplay = config.carouselAutoplay === true;
  const intervalMs = Math.max(1, Math.min(15, config.carouselAutoplaySec ?? 4)) * 1000;
  const reverse = config.carouselAutoplayReverse === true;
  const indicator = config.carouselAutoplayIndicator === "bar" ? "bar" : "ring";
  const isRtl = isRtlBookLanguage(config.bookLanguage);

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartXRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0); // re-mounts the ring/bar to restart its CSS animation
  const n = images.length;
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const ringActive = autoplay && !paused && n > 1 && !reduceMotion && indicator === "ring";
  const barActive = autoplay && !paused && n > 1 && !reduceMotion && indicator === "bar";

  // Reset if image set shrinks below current index.
  useEffect(() => { if (idx > n - 1) setIdx(0); }, [n, idx]);

  // Autoplay: pause on hover/focus, respect prefers-reduced-motion.
  const playing = autoplay && !paused && n > 1 && !reduceMotion;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () => {
        setIdx((i) => (reverse ? (i - 1 + n) % n : (i + 1) % n));
        setTick((x) => x + 1);
      },
      intervalMs,
    );
    return () => clearInterval(t);
  }, [playing, intervalMs, n, reverse]);

  // Restart the ring whenever the user manually navigates while autoplay is on.
  useEffect(() => { setTick((x) => x + 1); }, [idx]);

  const safeIdx = Math.min(idx, n - 1);
  // In RTL, the flex track lays out right-to-left so the translation sign flips.
  const trackOffset = (isRtl ? 1 : -1) * safeIdx * 100;

  const keyPrev = isRtl ? "ArrowRight" : "ArrowLeft";
  const keyNext = isRtl ? "ArrowLeft" : "ArrowRight";

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (n <= 1) return;
    if (e.key === keyPrev) {
      e.preventDefault();
      setIdx((i) => (i - 1 + n) % n);
    } else if (e.key === keyNext) {
      e.preventDefault();
      setIdx((i) => (i + 1) % n);
    } else if (autoplay && (e.key === " " || e.code === "Space")) {
      e.preventDefault();
      setPaused((p) => !p);
    }
  };

  return (
    <div
      dir={isRtl ? "rtl" : undefined}
      tabIndex={0}
      role="region"
      aria-label={`Image carousel. Use ${isRtl ? "left/right" : "left/right"} arrows to navigate${autoplay ? ", space to toggle autoplay" : ""}.`}
      className={`relative w-full ${aspectClass} bg-muted overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={onKeyDown}
      onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const sx = touchStartXRef.current;
        touchStartXRef.current = null;
        if (sx == null || n <= 1) return;
        const dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) <= 40) return;
        // Swiping right shows the previous slide in LTR, next in RTL — mirror the
        // exported HTML carousel's behavior for consistency.
        const forward = isRtl ? dx > 0 : dx < 0;
        setIdx((i) => (forward ? (i + 1) % n : (i - 1 + n) % n));
      }}
    >
      <div
        className="flex w-full h-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${trackOffset}%)` }}
      >
        {images.map((img, i) => (
          <SignedImage
            key={img.id}
            src={img.url}
            alt={`${alt} ${i + 1}`}
            loading="lazy"
            onClick={() => onImageClick?.(i)}
            className="shrink-0 w-full h-full object-cover cursor-pointer"
            style={{ flex: "0 0 100%" }}
          />
        ))}
      </div>
      {/* Countdown for the currently visible slide — top-left to avoid the
          "auto" autoplay chip in the top-right. */}
      <div className="pointer-events-none absolute top-2 left-2 z-[2]">
        <SignedUrlCountdown src={images[safeIdx]?.url} />
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + n) % n); }}
        className="absolute top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/70 hover:bg-background border border-border/40"
        style={{ insetInlineStart: 8 }}
        aria-label="Previous image"
      >
        {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % n); }}
        className="absolute top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/70 hover:bg-background border border-border/40"
        style={{ insetInlineEnd: 8 }}
        aria-label="Next image"
      >
        {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        {images.map((_, i) => {
          const isActive = i === safeIdx;
          return (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
              aria-label={`Go to image ${i + 1}`}
              className="relative flex items-center justify-center"
              style={{ width: isActive ? 14 : 8, height: isActive ? 14 : 8 }}
            >
              <span
                className={`block w-1.5 h-1.5 rounded-full transition-colors ${
                  isActive ? "bg-primary" : "bg-background/70 hover:bg-background"
                }`}
              />
              {isActive && ringActive && (
                <svg
                  key={tick}
                  className="absolute inset-0 -rotate-90 pointer-events-none"
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                >
                  <circle cx="7" cy="7" r="6" fill="none" stroke="hsl(var(--primary) / 0.25)" strokeWidth="1.5" />
                  <circle
                    cx="7" cy="7" r="6"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={1}
                    style={{
                      strokeDashoffset: 1,
                      animation: `carousel-ring-fill ${intervalMs}ms linear forwards`,
                    }}
                  />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {indicator === "bar" && autoplay && n > 1 && (
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-0 h-0.5 bg-muted-foreground/25 pointer-events-none overflow-hidden z-[3]"
        >
          {barActive && (
            <div
              key={tick}
              className="h-full w-full bg-primary"
              style={{
                transformOrigin: isRtl ? "right center" : "left center",
                animation: `carousel-bar-fill ${intervalMs}ms linear forwards`,
              }}
            />
          )}
        </div>
      )}
      {autoplay && n > 1 && (
        <span
          aria-hidden="true"
          className="absolute top-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-background/70 text-muted-foreground transition-opacity duration-200 pointer-events-none"
          style={{ insetInlineEnd: 8, opacity: paused ? 0 : 1 }}
        >
          auto
        </span>
      )}
      <style>{`@keyframes carousel-ring-fill { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } } @keyframes carousel-bar-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
    </div>
  );
}
