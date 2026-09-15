import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImageIcon, Loader2, Download, Music, Sparkles, Leaf, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { saveAs } from "file-saver";
import { useToast } from "@/hooks/use-toast";
import { SceneRating } from "../SceneRating";
import { requestNarrationAudio } from "@/lib/tts-client";
import type { SlideChapter, StoryConfig } from "../StoryForgeContext";
import { getChapterImages } from "../StoryForgeContext";
import { ChapterImageMosaic } from "./ChapterImageMosaic";
import { ImageViewerSettings } from "./ImageViewerSettings";
import { SignedImage } from "@/components/SignedImage";
import { SignedUrlCountdown } from "@/components/SignedUrlCountdown";
import { useEffectiveSignedUrlTtl, formatEffectiveTtlTooltip } from "@/hooks/use-effective-signed-url-ttl";

type Props = {
  chapters: SlideChapter[];
  chaptersWithImages: SlideChapter[];
  config: StoryConfig;
  onOpenLightbox: (index: number) => void;
  onSceneRate: (chapterId: string, rating: number, comment: string) => void;
  /** Re-render this chapter's image with mode='premium' (Gemini). Shown only on draft/free-tier images. */
  onUpgradeImage?: (chapter: SlideChapter) => void;
  /** Patch a chapter (used to record TTS provider/free-tier flags after an audio request). */
  onChapterPatch?: (chapterId: string, patch: Partial<SlideChapter>) => void;
};

export function VisualBookGallery({
  chapters,
  chaptersWithImages,
  config,
  onOpenLightbox,
  onSceneRate,
  onUpgradeImage,
  onChapterPatch,
}: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [gallerySelected, setGallerySelected] = useState<string | null>(null);
  const ttl = useEffectiveSignedUrlTtl();
  const ttlTooltip = formatEffectiveTtlTooltip(ttl);
  const [downloadingAudioId, setDownloadingAudioId] = useState<string | null>(null);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);

  const copyCid = useCallback((cid: string) => {
    navigator.clipboard?.writeText(cid).then(() => {
      setCopiedCid(cid);
      toast({ title: "Correlation ID copied", description: "Search api_usage_logs.metadata->>'correlation_id'" });
      setTimeout(() => setCopiedCid((c) => (c === cid ? null : c)), 1500);
    }).catch(() => toast({ title: "Copy failed", variant: "destructive" }));
  }, [toast]);

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

  const handleDownloadChapterAudio = useCallback(async (chapter: SlideChapter, index: number) => {
    if (!chapter.body || chapter.body.trim().length < 10) {
      toast({ title: "Not enough text", description: "This chapter needs at least 10 characters for narration.", variant: "destructive" });
      return;
    }

    setDownloadingAudioId(chapter.id);
    try {
      const voiceId = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
      const result = await requestNarrationAudio({
        text: chapter.body.slice(0, 5000),
        voiceId,
        language: config.bookLanguage !== "en" ? config.bookLanguage : undefined,
        speed: config.narrationSpeed,
        demeanour: config.narrationDemeanour,
      });

      if (result.kind === "fallback") {
        toast({ title: "Narration unavailable", description: result.payload.message || "Voice service is busy.", variant: "destructive" });
        return;
      }

      // Record provider/free-tier + correlation_id so the chapter card can show
      // an "Eco TTS" badge and a copyable correlation ID linking to api_usage_logs.
      onChapterPatch?.(chapter.id, {
        ttsProvider: result.provider,
        ttsFreeTier: !!result.freeTier,
        ttsCorrelationId: result.correlationId,
      });

      const safeName = chapter.title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
      saveAs(result.blob, `Ch${index + 1}_${safeName}.mp3`);
      toast({ title: "Chapter audio downloaded" });
    } catch (err: any) {
      toast({ title: "Audio download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingAudioId(null);
    }
  }, [config, toast, onChapterPatch]);

  if (chaptersWithImages.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{t("visual.noImages")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ImageViewerSettings />
      </div>
      {/* Thumbnail grid */}
      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5 sm:gap-2">
        {chapters.map((chapter, idx) => {
          const hasImage = !!chapter.imageUrl;
          const isSelected = gallerySelected === chapter.id;
          return (
            <button
              key={chapter.id}
              onClick={() => hasImage && setGallerySelected(isSelected ? null : chapter.id)}
              onDoubleClick={() => {
                if (hasImage) {
                  const imgIdx = chaptersWithImages.findIndex((c) => c.id === chapter.id);
                  if (imgIdx >= 0) onOpenLightbox(imgIdx);
                }
              }}
              title={hasImage ? `${chapter.title}\n\n${ttlTooltip}` : undefined}
              aria-label={hasImage ? `${chapter.title}. ${ttlTooltip.replace(/\n/g, ". ")}` : undefined}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                isSelected
                  ? "border-primary ring-2 ring-primary/30 scale-[1.02]"
                  : hasImage
                  ? "border-border/40 hover:border-primary/50 hover:scale-[1.02]"
                  : "border-border/20 opacity-40 cursor-default"
              }`}
              disabled={!hasImage}
            >
              {chapter.imageUrl ? (
                <SignedImage src={chapter.imageUrl} alt={chapter.title} className="w-full h-full object-cover" loading="lazy" uiAction="gallery-thumb" />
              ) : chapter.imageLoading ? (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                <span className="text-[9px] font-bold text-white/90">Ch. {idx + 1}</span>
              </div>
              {chapter.rating && (
                <div className="absolute top-1 right-1 bg-black/60 rounded px-1 py-0.5">
                  <span className="text-[9px] text-amber-400">{chapter.rating}★</span>
                </div>
              )}
              <div className="absolute top-1 left-1 flex flex-col gap-0.5 items-start">
                {chapter.imageFreeTier && (
                  <div className="bg-primary/80 backdrop-blur-sm rounded px-1 py-0.5">
                    <span className="text-[9px] font-semibold text-primary-foreground uppercase tracking-wide">Draft</span>
                  </div>
                )}
                {chapter.ttsFreeTier && (
                  <div className="bg-accent/80 backdrop-blur-sm rounded px-1 py-0.5 flex items-center gap-0.5" title="Narration generated with a free TTS provider (cost-saving)">
                    <Leaf className="w-2 h-2 text-accent-foreground" />
                    <span className="text-[9px] font-semibold text-accent-foreground uppercase tracking-wide">Eco</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected image detail */}
      <AnimatePresence>
        {gallerySelected && (() => {
          const chapter = chapters.find((c) => c.id === gallerySelected);
          const idx = chapters.findIndex((c) => c.id === gallerySelected);
          if (!chapter) return null;
          const isDownloadingAudio = downloadingAudioId === chapter.id;
          return (
            <motion.div
              key={gallerySelected}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="glass-card overflow-hidden"
            >
              {chapter.imageUrl && (
                <ChapterImageMosaic
                  images={getChapterImages(chapter)}
                  layout={chapter.imageLayout}
                  aspectClass={config.orientation === "portrait" ? "aspect-[3/4] max-h-[400px] sm:max-h-[500px]" : "aspect-video"}
                  alt={chapter.title}
                  onImageClick={() => {
                    const imgIdx = chaptersWithImages.findIndex((c) => c.id === chapter.id);
                    if (imgIdx >= 0) onOpenLightbox(imgIdx);
                  }}
                />
              )}
              <div className="p-3 sm:p-4 space-y-2">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Ch. {idx + 1}</span>
                  <h3 className="font-serif font-semibold text-xs sm:text-sm flex-1 truncate">{chapter.title}</h3>
                  {chapter.imageUrl && <SignedUrlCountdown src={chapter.imageUrl} />}
                  {(chapter.imageFreeTier || chapter.ttsFreeTier) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] font-semibold text-accent uppercase tracking-wide"
                      title={
                        chapter.imageFreeTier && chapter.ttsFreeTier
                          ? "Image and narration generated with free providers (cost-saving)"
                          : chapter.imageFreeTier
                          ? "Image generated with a free provider (Pollinations / FLUX)"
                          : "Narration generated with a free provider (Pollinations / HuggingFace)"
                      }
                    >
                      <Leaf className="w-2.5 h-2.5" />
                      Free tier
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {chapter.body && chapter.body.trim().length >= 10 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 sm:h-7 sm:w-7"
                        disabled={isDownloadingAudio}
                        title="Download chapter narration"
                        onClick={() => handleDownloadChapterAudio(chapter, idx)}
                      >
                        {isDownloadingAudio ? (
                          <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin" />
                        ) : (
                          <Music className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                        )}
                      </Button>
                    )}
                    {chapter.imageUrl && chapter.imageFreeTier && onUpgradeImage && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1 border-primary/40 text-primary hover:bg-primary/10"
                        disabled={chapter.imageUpgrading || chapter.imageLoading}
                        title="Re-render this image with premium quality (Gemini)"
                        onClick={() => onUpgradeImage(chapter)}
                      >
                        {chapter.imageUpgrading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        <span className="hidden sm:inline">Upgrade</span>
                      </Button>
                    )}
                    {chapter.imageUrl && (
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-7 sm:w-7" onClick={() => handleDownloadImage(chapter.imageUrl!, chapter.title)}>
                        <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        const imgIdx = chaptersWithImages.findIndex((c) => c.id === chapter.id);
                        if (imgIdx >= 0) onOpenLightbox(imgIdx);
                      }}
                    >
                      {t("visual.fullscreen")}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-foreground/70 leading-relaxed">{chapter.body}</p>
                {(chapter.imageProvider || chapter.ttsProvider) && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {chapter.imageProvider && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono uppercase tracking-wide border ${
                          chapter.imageFreeTier
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-primary/40 bg-primary/10 text-primary"
                        }`}
                        title={`Image generated by ${chapter.imageProvider}${chapter.imageFreeTier ? " (free tier)" : " (premium)"}`}
                      >
                        <span className="opacity-70 normal-case font-sans">img:</span>
                        {chapter.imageProvider}
                      </span>
                    )}
                    {chapter.ttsProvider && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono uppercase tracking-wide border ${
                          chapter.ttsFreeTier
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-primary/40 bg-primary/10 text-primary"
                        }`}
                        title={`Narration generated by ${chapter.ttsProvider}${chapter.ttsFreeTier ? " (free tier)" : " (premium)"}`}
                      >
                        <span className="opacity-70 normal-case font-sans">tts:</span>
                        {chapter.ttsProvider}
                      </span>
                    )}
                  </div>
                )}
                {(chapter.imageCorrelationId || chapter.ttsCorrelationId) && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/30">
                    {chapter.imageCorrelationId && (
                      <button
                        type="button"
                        onClick={() => copyCid(chapter.imageCorrelationId!)}
                        className="inline-flex items-center gap-1 rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={`Image correlation ID — search api_usage_logs.metadata->>'correlation_id' = '${chapter.imageCorrelationId}'`}
                      >
                        <span className="font-semibold non-italic">img:</span>
                        <span>{chapter.imageCorrelationId.slice(0, 8)}</span>
                        {copiedCid === chapter.imageCorrelationId ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    )}
                    {chapter.ttsCorrelationId && (
                      <button
                        type="button"
                        onClick={() => copyCid(chapter.ttsCorrelationId!)}
                        className="inline-flex items-center gap-1 rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={`TTS correlation ID — search api_usage_logs.metadata->>'correlation_id' = '${chapter.ttsCorrelationId}'`}
                      >
                        <span className="font-semibold">tts:</span>
                        <span>{chapter.ttsCorrelationId.slice(0, 8)}</span>
                        {copiedCid === chapter.ttsCorrelationId ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    )}
                  </div>
                )}
                {chapter.imageUrl && (
                  <SceneRating
                    rating={chapter.rating}
                    comment={chapter.ratingComment}
                    isOptimizing={chapter.autoOptimizing}
                    onRate={(rating, comment) => onSceneRate(chapter.id, rating, comment)}
                  />
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}