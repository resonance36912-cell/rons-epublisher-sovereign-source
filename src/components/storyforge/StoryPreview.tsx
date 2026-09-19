import { useState, useRef, useEffect, useCallback } from "react";
import { useStoryForge } from "./StoryForgeContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ImageIcon, BookOpen, Sparkles, Monitor, Smartphone, ScrollText, Layers, RefreshCw, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { generateStoryboard, StoryboardError } from "@/lib/storyforge-api";
import { useToast } from "@/hooks/use-toast";
import { PublicationReadinessPanel } from "./PublicationReadinessPanel";
import { CitedParagraphs } from "./CitedParagraphs";
import type { Source, SlideChapter } from "./StoryForgeContext";
import { useChapterImageViewAudit } from "@/hooks/useChapterImageViewAudit";
import { PresentationControls } from "./PresentationControls";
import { DEFAULT_FORMAT_PREFS, type FormatPrefs } from "@/lib/presentation-export";

function ChapterSlide({ chapter, index, sources, prefs }: { chapter: SlideChapter | undefined; index: number; sources: Source[]; prefs: FormatPrefs }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const fitText = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    content.style.transform = "scale(1)";
    content.style.transformOrigin = "top center";

    const containerH = container.clientHeight;
    const contentH = content.scrollHeight;

    if (contentH > containerH && contentH > 0) {
      const newScale = Math.max(0.85, (containerH / contentH) * 0.95);
      setScale(newScale);
    } else {
      setScale(1);
    }
  }, []);

  useEffect(() => {
    fitText();
  }, [chapter?.body, chapter?.title, fitText, prefs.fontScale, prefs.lineHeight, prefs.bodyMaxWidth]);

  useEffect(() => {
    const observer = new ResizeObserver(() => fitText());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitText]);

  if (!chapter) return null;

  const alignClass = prefs.textAlign === "center" ? "text-center" : prefs.textAlign === "justify" ? "text-justify" : "text-left";

  return (
    <div ref={containerRef} className="w-full h-full overflow-y-auto overflow-x-hidden px-4 py-2 scrollbar-thin">
      <div
        ref={contentRef}
        className="w-full flex items-start justify-center"
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
      >
        <div className="space-y-5 w-full" style={{ maxWidth: `${prefs.bodyMaxWidth}px` }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-px gradient-primary" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Ch. {index + 1}
            </span>
            <div className="flex-1 h-px bg-border/30" />
          </div>
          <h2 className="font-serif font-bold leading-[1.15] text-foreground" style={{ fontSize: `${1.875 * prefs.fontScale}rem` }}>
            {chapter.title}
          </h2>
          <CitedParagraphs
            body={chapter.body}
            references={chapter.references}
            sources={sources}
            className={`${alignClass} text-foreground/75 space-y-3`}
            style={{ fontSize: `${0.875 * prefs.fontScale}rem`, lineHeight: prefs.lineHeight }}
          />
        </div>
      </div>
    </div>
  );
}

export function StoryPreview() {
  const { chapters, setChapters, sources, config, setConfig, setStep, projectId } = useStoryForge();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [viewMode, setViewMode] = useState<"slides" | "readAll">("slides");
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState({ message: "", percent: 0 });
  const [prefs, setPrefs] = useState<FormatPrefs>(() => {
    try {
      const raw = typeof window !== "undefined" && window.localStorage.getItem("resonance_preview_prefs");
      return raw ? { ...DEFAULT_FORMAT_PREFS, ...JSON.parse(raw) } : DEFAULT_FORMAT_PREFS;
    } catch { return DEFAULT_FORMAT_PREFS; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { toast } = useToast();
  useChapterImageViewAudit("Open story preview", projectId, chapters);

  // Persist format prefs across sessions.
  useEffect(() => {
    try { window.localStorage.setItem("resonance_preview_prefs", JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Track Fullscreen API state so the toolbar button reflects reality even
  // when the user exits via Esc or the OS chrome.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch (e) {
      toast({ title: "Fullscreen unavailable", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [toast]);

  const [regenRequestId, setRegenRequestId] = useState<string | null>(null);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    setRegenRequestId(null);
    setRegenProgress({ message: "Starting…", percent: 0 });
    try {
      const newChapters = await generateStoryboard(sources, config, (p) => {
        setRegenProgress({ message: p.message, percent: p.percent });
        if (p.requestId) setRegenRequestId(p.requestId);
      });
      setChapters(newChapters);
      setCurrentSlide(0);
      toast({ title: "Chapters regenerated", description: `${newChapters.length} chapters created.` });
    } catch (err: any) {
      const reqId = err instanceof StoryboardError ? err.requestId : regenRequestId;
      toast({
        title: "Regeneration failed",
        description: reqId
          ? `${err.message} (Request ID: ${reqId})`
          : err.message,
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
      setRegenProgress({ message: "", percent: 0 });
    }
  }, [sources, config, setChapters, toast, regenRequestId]);

  const allReferences = sources
    .filter((s) => s.type !== "file" && s.title)
    .map((s) => s.title);

  const hasRefs = allReferences.length > 0;
  const totalSlides = chapters.length + 1 + (hasRefs ? 1 : 0);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCurrentSlide((c) => Math.min(c + 1, totalSlides - 1));
      if (e.key === "ArrowLeft") setCurrentSlide((c) => Math.max(c - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [totalSlides]);

  const next = () => setCurrentSlide((c) => Math.min(c + 1, totalSlides - 1));
  const prev = () => setCurrentSlide((c) => Math.max(c - 1, 0));

  const isTitle = currentSlide === 0;
  const isRefs = hasRefs && currentSlide === totalSlides - 1;
  const chapterIdx = isTitle || isRefs ? -1 : currentSlide - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-5xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-xs font-medium text-primary">
          <BookOpen className="w-3 h-3" />
          {chapters.length} {t("preview.chapters")}
        </div>
        <h2 className="text-3xl font-serif font-bold gradient-text">{t("preview.storyBookPreview")}</h2>
        <div className="flex items-center justify-center gap-2">
          <p className="text-muted-foreground text-sm">
            {t("preview.navigateDesc")}
          </p>
          <div className="flex items-center gap-1 ml-3 bg-card/80 border border-border/40 rounded-full p-0.5">
            <button
              onClick={() => setViewMode("slides")}
              className={`p-1.5 rounded-full transition-all ${
                viewMode === "slides" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Slide view"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("readAll")}
              className={`p-1.5 rounded-full transition-all ${
                viewMode === "readAll" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Read all chapters"
            >
              <ScrollText className="w-3.5 h-3.5" />
            </button>
          </div>
          {viewMode === "slides" && (
          <div className="flex items-center gap-1 ml-1 bg-card/80 border border-border/40 rounded-full p-0.5">
            <button
              onClick={() => setConfig((c) => ({ ...c, orientation: "landscape" }))}
              className={`p-1.5 rounded-full transition-all ${
                config.orientation === "landscape" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Landscape"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setConfig((c) => ({ ...c, orientation: "portrait" }))}
              className={`p-1.5 rounded-full transition-all ${
                config.orientation === "portrait" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Portrait"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
          )}
        </div>
        {viewMode === "slides" && (
          <PresentationControls
            prefs={prefs}
            onPrefsChange={setPrefs}
            onFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            deck={{
              title: config.topic || "Your Story",
              subtitle: `A ${config.tone} ${config.theme} storybook`,
              chapters,
              sources,
            }}
          />
        )}
      </div>


      {viewMode === "readAll" ? (
        /* ── Read All view ── */
        <>
        <PublicationReadinessPanel
          chapters={chapters}
          sources={sources}
          config={config}
          setConfig={setConfig}
          setChapters={setChapters}
          onJumpToChapter={(chIdx) => { setViewMode("slides"); setCurrentSlide(chIdx); }}
        />
        <div className="glass-card overflow-hidden glow-primary">
          <div className="max-h-[70vh] overflow-y-auto p-8 md:p-12 space-y-12 scrollbar-thin">
            {/* Title */}
            <div className="text-center space-y-4 pb-8 border-b border-border/30">
              <h1 className="text-4xl md:text-5xl font-serif font-bold leading-[1.1] tracking-tight gradient-text">
                {config.topic || "Your Story"}
              </h1>
              <p className="text-muted-foreground text-base">
                A <span className="text-accent">{config.tone}</span>{" "}
                <span className="text-primary">{config.theme}</span> storybook
              </p>
            </div>

            {/* All chapters */}
            {chapters.map((ch, i) => (
              <div key={ch.id} className="max-w-2xl mx-auto space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-px gradient-primary" />
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    Ch. {i + 1}
                  </span>
                  <div className="flex-1 h-px bg-border/30" />
                </div>
                <h2 className="text-2xl md:text-3xl font-serif font-bold leading-[1.15] text-foreground">
                  {ch.title}
                </h2>
                <CitedParagraphs
                  body={ch.body}
                  references={ch.references}
                  sources={sources}
                  className="text-sm leading-[1.8] text-foreground/75 space-y-3"
                />
              </div>
            ))}

            {/* References */}
            {hasRefs && (
              <div className="max-w-2xl mx-auto pt-8 border-t border-border/30">
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="w-5 h-5 text-accent" />
                  <h2 className="text-2xl font-serif font-semibold">References</h2>
                </div>
                <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                  {allReferences.map((ref, i) => (
                    <li key={i} className="leading-relaxed hover:text-foreground/80 transition-colors">{ref}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
        </>
      ) : (
        /* ── Slide view ── */
        <>
          <PublicationReadinessPanel
            chapters={chapters}
            sources={sources}
            config={config}
            setConfig={setConfig}
            setChapters={setChapters}
            onJumpToChapter={(chIdx) => setCurrentSlide(chIdx)}
          />
          <div
            ref={stageRef}
            className={`relative glass-card overflow-hidden glow-primary ${
              isFullscreen ? "fixed inset-0 z-50 flex flex-col items-center justify-center !rounded-none" : ""
            } ${
              prefs.background === "dark" ? "bg-[hsl(240_10%_10%)] text-[hsl(0_0%_96%)]"
                : prefs.background === "cream" ? "bg-[hsl(40_45%_94%)] text-[hsl(25_30%_15%)]"
                : ""
            }`}
          >
            <div className={
              isFullscreen
                ? "w-full h-full"
                : (config.orientation === "portrait" ? "aspect-[3/4]" : "aspect-[16/9]")
            } style={{ position: "relative" }}>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-accent/[0.03]" />


              <AnimatePresence mode="wait">
                <motion.div
                  key={currentSlide}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 flex items-center justify-center p-8 md:p-12"
                >
                  {isTitle ? (
                    <div className="text-center space-y-6 max-w-xl">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 0.2, duration: 0.6 }}
                        className="w-16 h-px gradient-primary mx-auto"
                      />
                      <div className="space-y-4">
                        <h1 className="text-4xl md:text-5xl font-serif font-bold leading-[1.1] tracking-tight gradient-text">
                          {config.topic || "Your Story"}
                        </h1>
                        <p className="text-muted-foreground text-base md:text-lg">
                          A <span className="text-accent">{config.tone}</span>{" "}
                          <span className="text-primary">{config.theme}</span> storybook
                        </p>
                      </div>
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 0.4, duration: 0.6 }}
                        className="w-16 h-px gradient-primary mx-auto"
                      />
                      <p className="text-xs text-muted-foreground/50 uppercase tracking-[0.3em]">
                        Resonance ePublisher
                      </p>
                    </div>
                  ) : isRefs ? (
                    <div className="w-full h-full overflow-auto px-4 py-4">
                      <div className="flex items-center gap-2 mb-6">
                        <BookOpen className="w-5 h-5 text-accent" />
                        <h2 className="text-2xl font-serif font-semibold">References</h2>
                      </div>
                      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                        {allReferences.map((ref, i) => (
                          <li key={i} className="leading-relaxed hover:text-foreground/80 transition-colors">{ref}</li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <ChapterSlide chapter={chapters[chapterIdx]} index={chapterIdx} sources={sources} prefs={prefs} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation is intentionally outside the reading canvas so it never obscures manuscript text. */}
            <div className="mx-auto mt-3 mb-3 w-fit flex items-center gap-3 bg-card/90 backdrop-blur-md border border-border/40 rounded-full px-4 py-2 shadow-lg">
              <button
                onClick={prev}
                disabled={currentSlide === 0}
                className="p-1.5 text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors rounded-full hover:bg-primary/10"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalSlides }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === currentSlide
                        ? "w-6 h-2 bg-primary"
                        : "w-2 h-2 bg-muted-foreground/25 hover:bg-muted-foreground/50"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={next}
                disabled={currentSlide === totalSlides - 1}
                className="p-1.5 text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors rounded-full hover:bg-primary/10"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Slide thumbnails */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            <button
              onClick={() => setCurrentSlide(0)}
              className={`shrink-0 w-28 h-16 rounded-lg border text-[10px] font-serif font-semibold flex flex-col items-center justify-center gap-1 transition-all ${
                currentSlide === 0
                  ? "border-primary/60 bg-primary/10 ring-2 ring-primary/20 text-primary"
                  : "border-border/40 bg-card/50 hover:border-primary/30 text-muted-foreground"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              {t("preview.title")}
            </button>
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => setCurrentSlide(i + 1)}
                className={`shrink-0 w-28 h-16 rounded-lg border text-[10px] px-2.5 text-left flex flex-col justify-center gap-0.5 transition-all ${
                  currentSlide === i + 1
                    ? "border-primary/60 bg-primary/10 ring-2 ring-primary/20"
                    : "border-border/40 bg-card/50 hover:border-primary/30"
                }`}
              >
                <span className="text-[8px] text-accent font-medium">Ch. {i + 1}</span>
                <span className="font-medium truncate text-foreground/80">{ch.title}</span>
              </button>
            ))}
            {hasRefs && (
              <button
                onClick={() => setCurrentSlide(totalSlides - 1)}
                className={`shrink-0 w-28 h-16 rounded-lg border text-[10px] font-medium flex items-center justify-center gap-1.5 transition-all ${
                  currentSlide === totalSlides - 1
                    ? "border-primary/60 bg-primary/10 ring-2 ring-primary/20 text-primary"
                    : "border-border/40 bg-card/50 hover:border-primary/30 text-muted-foreground"
                }`}
              >
                <BookOpen className="w-3 h-3" /> {t("preview.references")}
              </button>
            )}
          </div>
        </>
      )}

      {/* Regeneration progress bar */}
      {regenerating && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              {regenProgress.message || "Starting…"}
            </span>
            <span className="font-mono text-primary">{Math.round(regenProgress.percent)}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${regenProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep(4)} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> {t("storyboard.storyline")}
          </Button>
          <Button variant="outline" onClick={handleRegenerate} disabled={regenerating} className="gap-2">
            {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
        <Button onClick={() => setStep(6)} disabled={regenerating} className="gap-2 glow-primary">
          <ImageIcon className="w-4 h-4" /> {t("preview.visualBook")} <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}
