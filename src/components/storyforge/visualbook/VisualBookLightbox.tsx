import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { saveAs } from "file-saver";
import { LightboxToolbar } from "../lightbox/LightboxToolbar";
import { ShortcutHints } from "../lightbox/ShortcutHints";
import { useLightboxGestures } from "../lightbox/useLightboxGestures";
import type { SlideChapter, StoryConfig, ChapterImage } from "../StoryForgeContext";
import { getChapterImages } from "../StoryForgeContext";

type Props = {
  /**
   * Index into `chaptersWithImages` of the chapter to open. The lightbox
   * internally expands every chapter's gallery into a flat list of images
   * so users can navigate every image (not just the cover).
   */
  lightboxIndex: number | null;
  setLightboxIndex: React.Dispatch<React.SetStateAction<number | null>>;
  chaptersWithImages: SlideChapter[];
  chapters: SlideChapter[];
  config: StoryConfig;
};

type FlatEntry = {
  chapter: SlideChapter;
  chapterIdxInAll: number;       // index in `chapters`
  chapterIdxInFiltered: number;  // index in `chaptersWithImages`
  image: ChapterImage;
  imageIndexInChapter: number;
  imagesInChapter: number;
};

export function VisualBookLightbox({
  lightboxIndex,
  setLightboxIndex,
  chaptersWithImages,
  chapters,
  config,
}: Props) {
  const { toast } = useToast();
  const { t } = useI18n();

  // Flatten every chapter's gallery into a single navigable list.
  const flat = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    chaptersWithImages.forEach((ch, chapterIdxInFiltered) => {
      const imgs = getChapterImages(ch);
      const chapterIdxInAll = chapters.findIndex((c) => c.id === ch.id);
      imgs.forEach((image, imageIndexInChapter) => {
        out.push({
          chapter: ch,
          chapterIdxInAll,
          chapterIdxInFiltered,
          image,
          imageIndexInChapter,
          imagesInChapter: imgs.length,
        });
      });
    });
    return out;
  }, [chaptersWithImages, chapters]);

  // Map chapter-index (from caller) → flat index of that chapter's first image.
  const firstFlatIndexOfChapter = useCallback((chapterIdxInFiltered: number) => {
    return flat.findIndex((f) => f.chapterIdxInFiltered === chapterIdxInFiltered);
  }, [flat]);

  // The caller hands us a chapter index. Translate to flat index on first open
  // / whenever the caller-supplied index changes to a value that doesn't match
  // the current flat entry's chapter.
  const [flatIndex, setFlatIndex] = useState<number | null>(null);
  const lastSeenCallerIndex = useRef<number | null>(null);
  useEffect(() => {
    if (lightboxIndex === null) {
      setFlatIndex(null);
      lastSeenCallerIndex.current = null;
      return;
    }
    if (lightboxIndex !== lastSeenCallerIndex.current) {
      // Caller picked a (different) chapter — jump to its first image.
      const fi = firstFlatIndexOfChapter(lightboxIndex);
      if (fi >= 0) setFlatIndex(fi);
      lastSeenCallerIndex.current = lightboxIndex;
    }
  }, [lightboxIndex, firstFlatIndexOfChapter]);

  // Keep parent's chapter-index in sync as the user navigates inside the
  // lightbox, so view-mode badges / external state can react.
  useEffect(() => {
    if (flatIndex === null) return;
    const entry = flat[flatIndex];
    if (!entry) return;
    if (entry.chapterIdxInFiltered !== lastSeenCallerIndex.current) {
      lastSeenCallerIndex.current = entry.chapterIdxInFiltered;
      setLightboxIndex(entry.chapterIdxInFiltered);
    }
  }, [flatIndex, flat, setLightboxIndex]);

  const total = flat.length;
  const current = flatIndex !== null ? flat[flatIndex] : null;

  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowSpeed, setSlideshowSpeed] = useState(4000);
  const [slideshowLoop, setSlideshowLoop] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const slideshowInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset zoom/pan whenever the displayed image changes.
  useEffect(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, [flatIndex]);

  // Adapter: gestures hook still wants a "lightboxIndex" + setter + total —
  // pass the flat-index state so swipe navigates per-image.
  const setFlatIndexFromGesture: React.Dispatch<React.SetStateAction<number | null>> = useCallback((upd) => {
    setFlatIndex((prev) => (typeof upd === "function" ? (upd as (p: number | null) => number | null)(prev) : upd));
  }, []);

  const {
    handlePanMouseDown, handlePanMouseMove, handlePanMouseUp,
    handleCombinedTouchStart, handleCombinedTouchMove, handleCombinedTouchEnd,
  } = useLightboxGestures({
    zoomScale, setZoomScale, panOffset, setPanOffset,
    lightboxIndex: flatIndex, totalImages: total, setLightboxIndex: setFlatIndexFromGesture,
  });

  // Slideshow auto-advance through every image of every chapter.
  useEffect(() => {
    if (slideshowActive && flatIndex !== null) {
      slideshowInterval.current = setInterval(() => {
        setFlatIndex((i) => {
          if (i === null) return null;
          if (i >= total - 1) {
            if (slideshowLoop) return 0;
            setSlideshowActive(false);
            return i;
          }
          return i + 1;
        });
      }, slideshowSpeed);
    }
    return () => { if (slideshowInterval.current) clearInterval(slideshowInterval.current); };
  }, [slideshowActive, flatIndex, total, slideshowSpeed, slideshowLoop]);

  // Show shortcut hints on open, stop slideshow on close
  useEffect(() => {
    if (flatIndex === null) {
      setSlideshowActive(false);
      setShowShortcutHints(false);
    } else {
      setShowShortcutHints(true);
      const timer = setTimeout(() => setShowShortcutHints(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [flatIndex !== null]);

  const handleDownloadImage = useCallback(async (imageUrl: string, title: string) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      saveAs(blob, `${title.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }, [toast]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const closeLightbox = useCallback(() => {
    setFlatIndex(null);
    setLightboxIndex(null);
    lastSeenCallerIndex.current = null;
  }, [setLightboxIndex]);

  // Keyboard navigation across every image of every chapter.
  useEffect(() => {
    if (flatIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        if (e.shiftKey) {
          // Jump to previous chapter's first image (or first image of current chapter if not already there).
          setFlatIndex((i) => {
            if (i === null) return null;
            const cur = flat[i];
            if (!cur) return i;
            if (cur.imageIndexInChapter > 0) {
              return firstFlatIndexOfChapter(cur.chapterIdxInFiltered);
            }
            const prevChapter = cur.chapterIdxInFiltered - 1;
            if (prevChapter < 0) return i;
            const fi = firstFlatIndexOfChapter(prevChapter);
            return fi >= 0 ? fi : i;
          });
        } else {
          setFlatIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
        }
      }
      if (e.key === "ArrowRight") {
        if (e.shiftKey) {
          // Jump to next chapter's first image.
          setFlatIndex((i) => {
            if (i === null) return null;
            const cur = flat[i];
            if (!cur) return i;
            const nextChapter = cur.chapterIdxInFiltered + 1;
            const fi = firstFlatIndexOfChapter(nextChapter);
            return fi >= 0 ? fi : i;
          });
        } else {
          setFlatIndex((i) => (i !== null ? Math.min(total - 1, i + 1) : null));
        }
      }
      if (e.key === "Escape") closeLightbox();
      if (e.key === " ") { e.preventDefault(); setSlideshowActive((prev) => !prev); }
      if (e.key === "+" || e.key === "=") setZoomScale((z) => Math.min(5, z + 0.5));
      if (e.key === "-") setZoomScale((z) => Math.max(1, z - 0.5));
      if (e.key === "d" || e.key === "D") {
        if (current?.image.url) handleDownloadImage(current.image.url, current.chapter.title);
      }
      if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flatIndex, total, current, flat, firstFlatIndexOfChapter, handleDownloadImage, toggleFullscreen, closeLightbox]);

  if (flatIndex === null || !current) return null;

  return (
    <motion.div
      key="lightbox"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col"
      onClick={closeLightbox}
    >
      <AnimatePresence>
        {showShortcutHints && <ShortcutHints onClose={() => setShowShortcutHints(false)} />}
      </AnimatePresence>

      <LightboxToolbar
        chapterIndex={current.chapterIdxInAll >= 0 ? current.chapterIdxInAll : current.chapterIdxInFiltered}
        chapterTitle={current.chapter.title}
        lightboxIndex={flatIndex}
        totalImages={total}
        imageIndexInChapter={current.imageIndexInChapter}
        imagesInChapter={current.imagesInChapter}
        zoomScale={zoomScale}
        slideshowActive={slideshowActive}
        slideshowSpeed={slideshowSpeed}
        slideshowLoop={slideshowLoop}
        isFullscreen={isFullscreen}
        onZoomIn={() => setZoomScale((s) => Math.min(5, s + 0.5))}
        onZoomOut={() => setZoomScale((s) => Math.max(1, s - 0.5))}
        onResetZoom={() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }}
        onToggleSlideshow={() => setSlideshowActive((a) => !a)}
        onSetSpeed={setSlideshowSpeed}
        onToggleLoop={() => setSlideshowLoop((l) => !l)}
        onDownload={() => handleDownloadImage(current.image.url, current.chapter.title)}
        onShare={async () => {
          const shareData = { title: current.chapter.title, text: `${current.chapter.title} — ${config.topic || "AudioVisual eBook"}`, url: current.image.url };
          if (navigator.share && navigator.canShare?.(shareData)) {
            try { await navigator.share(shareData); } catch {}
          } else {
            await navigator.clipboard.writeText(current.image.url);
            toast({ title: t("visual.linkCopied") });
          }
        }}
        onToggleFullscreen={toggleFullscreen}
        onShowShortcuts={() => setShowShortcutHints(true)}
        onClose={closeLightbox}
      />

      <div
        className="flex-1 flex items-center justify-center relative px-16 pb-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handlePanMouseDown}
        onMouseMove={handlePanMouseMove}
        onMouseUp={handlePanMouseUp}
        onMouseLeave={handlePanMouseUp}
        onTouchStart={handleCombinedTouchStart}
        onTouchMove={handleCombinedTouchMove}
        onTouchEnd={handleCombinedTouchEnd}
      >
        <button
          onClick={() => setFlatIndex(Math.max(0, flatIndex - 1))}
          disabled={flatIndex === 0}
          className="absolute left-4 z-10 p-3 rounded-full bg-card/80 border border-border/40 hover:bg-card transition-all disabled:opacity-20 disabled:cursor-not-allowed"
          title="Previous image"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {current.image.kind === "video" ? (
          <motion.video
            key={`${current.chapter.id}-${current.image.id}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            src={current.image.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-2xl bg-black"
          />
        ) : (
          <motion.img
            key={`${current.chapter.id}-${current.image.id}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            src={current.image.url}
            alt={`${current.chapter.title} — image ${current.imageIndexInChapter + 1}`}
            className={`max-h-[70vh] max-w-full rounded-xl object-contain shadow-2xl select-none ${zoomScale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
            style={{ transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)` }}
            draggable={false}
          />
        )}

        <button
          onClick={() => setFlatIndex(Math.min(total - 1, flatIndex + 1))}
          disabled={flatIndex === total - 1}
          className="absolute right-4 z-10 p-3 rounded-full bg-card/80 border border-border/40 hover:bg-card transition-all disabled:opacity-20 disabled:cursor-not-allowed"
          title="Next image"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      <div className="px-6 pb-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2 justify-center overflow-x-auto py-2">
          {flat.map((entry, i) => {
            const isActive = i === flatIndex;
            const isFirstOfChapter = entry.imageIndexInChapter === 0;
            return (
              <button
                key={`${entry.chapter.id}-${entry.image.id}`}
                onClick={() => setFlatIndex(i)}
                title={`Ch. ${entry.chapterIdxInAll + 1} · ${entry.chapter.title} — image ${entry.imageIndexInChapter + 1}/${entry.imagesInChapter}`}
                className={`relative w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                  isActive ? "border-primary ring-2 ring-primary/30 scale-105" : "border-border/30 opacity-60 hover:opacity-100"
                } ${isFirstOfChapter && i > 0 ? "ml-2" : ""}`}
              >
                {entry.image.kind === "video" ? (
                  <div className="w-full h-full bg-black flex items-center justify-center text-[10px] font-semibold text-primary-foreground">▶</div>
                ) : (
                  <img src={entry.image.url} alt={entry.chapter.title} className="w-full h-full object-cover" />
                )}
                {entry.imagesInChapter > 1 && (
                  <span className="absolute bottom-0 right-0 bg-background/80 text-foreground text-[9px] leading-none px-1 py-0.5 rounded-tl">
                    {entry.imageIndexInChapter + 1}/{entry.imagesInChapter}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
