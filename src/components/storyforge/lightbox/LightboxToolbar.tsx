import { memo } from "react";
import {
  ZoomIn, ZoomOut, RotateCcw, Play, Pause, Repeat,
  Download, Share2, Minimize2, Maximize2, HelpCircle, X
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

type LightboxToolbarProps = {
  chapterIndex: number;
  chapterTitle: string;
  lightboxIndex: number;
  totalImages: number;
  imageIndexInChapter?: number;
  imagesInChapter?: number;
  zoomScale: number;
  slideshowActive: boolean;
  slideshowSpeed: number;
  slideshowLoop: boolean;
  isFullscreen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleSlideshow: () => void;
  onSetSpeed: (speed: number) => void;
  onToggleLoop: () => void;
  onDownload: () => void;
  onShare: () => void;
  onToggleFullscreen: () => void;
  onShowShortcuts: () => void;
  onClose: () => void;
};

export const LightboxToolbar = memo(function LightboxToolbar(props: LightboxToolbarProps) {
  const { t } = useI18n();
  const {
    chapterIndex, chapterTitle, lightboxIndex, totalImages,
    imageIndexInChapter, imagesInChapter,
    zoomScale, slideshowActive, slideshowSpeed, slideshowLoop, isFullscreen,
    onZoomIn, onZoomOut, onResetZoom, onToggleSlideshow, onSetSpeed,
    onToggleLoop, onDownload, onShare, onToggleFullscreen, onShowShortcuts, onClose,
  } = props;
  const showImageSubcounter = typeof imagesInChapter === "number" && imagesInChapter > 1 && typeof imageIndexInChapter === "number";

  return (
    <div className="flex flex-col gap-1 px-4 sm:px-6 pt-3 pb-2" onClick={(e) => e.stopPropagation()}>
      {/* Row 1: title + counter + close */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent shrink-0">Ch. {chapterIndex + 1}</span>
          <h3 className="font-serif font-semibold text-sm text-foreground truncate">{chapterTitle}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {lightboxIndex + 1} {t("visual.lightboxOf")} {totalImages}
            {showImageSubcounter && (
              <span className="ml-1 text-foreground/70">· img {imageIndexInChapter! + 1}/{imagesInChapter}</span>
            )}
          </span>
          <button onClick={onClose} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors ml-1">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {/* Row 2: all tool buttons — scrollable on mobile */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
        <button onClick={onZoomOut} disabled={zoomScale <= 1} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors disabled:opacity-30 shrink-0" title={t("visual.zoomOut")}>
          <ZoomOut className="w-4 h-4" />
        </button>
        {zoomScale > 1 && <span className="text-xs text-muted-foreground font-mono min-w-[3ch] text-center shrink-0">{zoomScale.toFixed(1)}×</span>}
        <button onClick={onZoomIn} disabled={zoomScale >= 5} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors disabled:opacity-30 shrink-0" title={t("visual.zoomIn")}>
          <ZoomIn className="w-4 h-4" />
        </button>
        {zoomScale > 1 && (
          <button onClick={onResetZoom} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors shrink-0" title={t("visual.resetZoom")}>
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        <div className="w-px h-4 bg-border/40 shrink-0 hidden sm:block" />
        <button onClick={onToggleSlideshow} className={`inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full transition-colors shrink-0 ${slideshowActive ? "bg-primary/20 text-primary" : "hover:bg-muted"}`} title={slideshowActive ? t("visual.slideshowStop") : t("visual.slideshow")}>
          {slideshowActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <select value={slideshowSpeed} onChange={(e) => onSetSpeed(Number(e.target.value))} className="text-xs bg-transparent border border-border/40 rounded px-2 py-2 sm:py-0.5 sm:px-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 min-h-[44px] sm:min-h-0" title={t("visual.slideshowSpeed")}>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
          <option value={8000}>8s</option>
        </select>
        <button onClick={onToggleLoop} className={`inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full transition-colors shrink-0 ${slideshowLoop ? "bg-primary/20 text-primary" : "hover:bg-muted"}`} title={t("visual.slideshowLoop")}>
          <Repeat className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border/40 shrink-0 hidden sm:block" />
        <button onClick={onDownload} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors shrink-0" title={t("visual.download")}>
          <Download className="w-4 h-4" />
        </button>
        <button onClick={onShare} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors shrink-0" title={t("visual.share")}>
          <Share2 className="w-4 h-4" />
        </button>
        <button onClick={onToggleFullscreen} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors shrink-0" title={isFullscreen ? t("visual.exitFullscreen") : t("visual.fullscreen")}>
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button onClick={onShowShortcuts} className="inline-flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-full hover:bg-muted transition-colors shrink-0" title={t("visual.shortcutsTitle")}>
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});
