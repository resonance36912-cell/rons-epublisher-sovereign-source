import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import type { StoryConfig, NarrationProvider } from "../StoryForgeContext";
import { requestNarrationAudio, speakWithBrowserNarration, stopBrowserNarration, isNarrationAbortError } from "@/lib/tts-client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Headphones, BookDown, Loader2, BookOpenCheck,
  FileText, Video, Trash2, Play, Square, Type, Save, RefreshCw, Printer, StopCircle, Music,
  Mic2, Gauge, Sparkles, FileJson, Upload, ClipboardPaste,
} from "lucide-react";
import { NarrationCostEstimator } from "./NarrationCostEstimator";
import { setTtsMode } from "@/lib/cost-mode";

export type VideoQuality = "720p" | "1080p";
export type VideoSpeed = "fast" | "normal" | "hq";

const VOICE_OPTIONS = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel" },
  { id: "pFZP5JQG7iQjIQuC4Bku", label: "Lily" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam" },
];

const DEMEANOURS = [
  { value: "calm", label: "Calm" },
  { value: "energetic", label: "Energetic" },
  { value: "warm", label: "Warm" },
  { value: "authoritative", label: "Authoritative" },
  { value: "playful", label: "Playful" },
];

type Props = {
  chaptersCount: number;
  chaptersWithImagesCount: number;
  downloading: boolean;
  downloadProgress: { current: number; total: number; stage: string };
  config: StoryConfig;
  setConfig: React.Dispatch<React.SetStateAction<StoryConfig>>;
  onBack: () => void;
  onOpenReader: () => void;
  onDownloadEbook: () => void;
  onDownloadEpub: () => void;
  onDownloadPdf: (photoOnly: boolean) => void;
  onDownloadStoryboardJson: (selectedChapterIds?: string[]) => void;
  onPreviewStoryboardJson?: (selectedChapterIds?: string[]) => void;
  chapterPickerItems?: { id: string; title: string }[];
  onImportStoryboardJson: (file: File) => void | Promise<void>;
  /** Apply pasted JSON text directly (same review modal flow as file import). */
  onImportStoryboardText?: (text: string) => void | Promise<void>;
  onDownloadAudio: () => void;
  onDownloadVideo: (quality: VideoQuality, speed: VideoSpeed) => void;
  onDownloadTextBook: () => void;
  onClearTtsCache: () => number;
  ttsCacheSize: number;
  canResume?: boolean;
  cachedChapterCount?: number;
  onPreviewAll: () => void;
  previewAllActive: boolean;
  previewingChapter: string | null;
  previewingChapterIndex: number | null;
  onSave: () => void;
  saving: boolean;
  onRegenerateAllImages: () => void;
  onStopGeneration?: () => void;
  regeneratingImages: boolean;
  imageProgress: { current: number; total: number };
  onPrint: () => void;
  onResetImages: () => void;
  onRefreshImages: () => void;
  onStopExport: () => void;
  canUseNarration?: boolean;
  /** Total narration character count across all chapter bodies. Used by the pre-flight cost estimator. */
  totalNarrationChars?: number;
  /** Characters already cached (will not be re-billed). */
  cachedNarrationChars?: number;
};

export function VisualBookActions({
  chaptersCount,
  chaptersWithImagesCount,
  downloading,
  downloadProgress,
  config,
  setConfig,
  onBack,
  onOpenReader,
  onDownloadEbook,
  onDownloadEpub,
  onDownloadPdf,
  onDownloadStoryboardJson,
  onPreviewStoryboardJson,
  chapterPickerItems = [],
  onImportStoryboardJson,
  onImportStoryboardText,
  onDownloadAudio,
  onDownloadVideo,
  onDownloadTextBook,
  onClearTtsCache,
  ttsCacheSize,
  canResume,
  cachedChapterCount,
  onPreviewAll,
  previewAllActive,
  previewingChapter,
  previewingChapterIndex,
  onSave,
  saving,
  onRegenerateAllImages,
  onStopGeneration,
  regeneratingImages,
  imageProgress,
  onPrint,
  onResetImages,
  onRefreshImages,
  onStopExport,
  canUseNarration = true,
  totalNarrationChars = 0,
  cachedNarrationChars = 0,
}: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [pdfPhotoOnly, setPdfPhotoOnly] = useState(false);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("720p");
  const [videoSpeed, setVideoSpeed] = useState<VideoSpeed>("fast");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [voicePreviewLoading, setVoicePreviewLoading] = useState(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [jsonPickerOpen, setJsonPickerOpen] = useState(false);
  const [jsonPickerSelected, setJsonPickerSelected] = useState<Set<string>>(new Set());
  const [jsonExporting, setJsonExporting] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteSubmitting, setPasteSubmitting] = useState(false);

  // Wraps the (potentially heavy) sync export so the UI can show a spinner
  // and disable buttons while JSON.stringify + Blob assembly happens.
  const runJsonExport = useCallback(async (ids?: string[]) => {
    if (jsonExporting) return;
    setJsonExporting(true);
    try {
      // Yield a frame so the spinner state actually paints before the
      // (synchronous) serialization blocks the main thread.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      onDownloadStoryboardJson(ids);
    } finally {
      // Small delay so the spinner is visible even on tiny projects.
      setTimeout(() => setJsonExporting(false), 250);
    }
  }, [jsonExporting, onDownloadStoryboardJson]);
  const isVideoExport = downloading && downloadProgress.stage !== "" && (
    downloadProgress.stage.includes("narration") ||
    downloadProgress.stage.includes("Narration") ||
    downloadProgress.stage.includes("image") ||
    downloadProgress.stage.includes("Render") ||
    downloadProgress.stage.includes("Encod") ||
    downloadProgress.stage.includes("FFmpeg") ||
    downloadProgress.stage.includes("Video")
  );

  useEffect(() => {
    if (isVideoExport && !timerRef.current) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    }
    if (!downloading && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isVideoExport, downloading]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
  };

  const estimateExportTime = (chapters: number, quality: VideoQuality, speed: VideoSpeed) => {
    const ttsSeconds = Math.ceil(chapters / 3) * 4;
    const fpsMultiplier = speed === "fast" ? 0.5 : speed === "hq" ? 2 : 1;
    const renderPerChapter = (quality === "1080p" ? 6 : 3) * fpsMultiplier;
    const encodeSeconds = chapters * (quality === "1080p" ? 8 : 4) * fpsMultiplier;
    const totalSeconds = ttsSeconds + chapters * renderPerChapter + encodeSeconds + 10;
    const minutes = Math.ceil(totalSeconds / 60);
    return minutes <= 1 ? "< 1 min" : `${minutes} min`;
  };

  const playVoicePreview = useCallback(async () => {
    if (voicePreviewPlaying) {
      voicePreviewAudioRef.current?.pause();
      voicePreviewAudioRef.current = null;
      stopBrowserNarration();
      setVoicePreviewPlaying(false);
      return;
    }
    const previewText = "Once upon a time, in a land far away, a story was born.";
    if (config.narrationProvider === "browser") {
      setVoicePreviewPlaying(true);
      speakWithBrowserNarration(previewText, { speed: config.narrationSpeed })
        .then(() => setVoicePreviewPlaying(false))
        .catch(() => setVoicePreviewPlaying(false));
      return;
    }
    setVoicePreviewLoading(true);
    try {
      const result = await requestNarrationAudio({
        text: previewText,
        voiceId: config.narrationVoice,
        speed: config.narrationSpeed,
        demeanour: config.narrationDemeanour,
      });
      if (result.kind === "fallback") {
        toast({ title: "Preview failed", description: result.payload.message || "Narration unavailable", variant: "destructive" });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const audio = new Audio(url);
      audio.onended = () => { setVoicePreviewPlaying(false); URL.revokeObjectURL(url); };
      voicePreviewAudioRef.current = audio;
      await audio.play();
      setVoicePreviewPlaying(true);
    } catch (err: any) {
      if (!isNarrationAbortError(err)) {
        toast({ title: "Preview failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setVoicePreviewLoading(false);
    }
  }, [config.narrationProvider, config.narrationVoice, config.narrationSpeed, config.narrationDemeanour, voicePreviewPlaying, toast]);

  const progressLabel = downloading
    ? `${downloadProgress.stage} (${downloadProgress.current}/${downloadProgress.total})`
    : "";

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">{children}</span>
  );

  return (
    <div className="flex flex-col gap-2 pt-4">
      {/* Row 0: Narration Settings */}
      {canUseNarration ? (
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap border border-border/40 rounded-lg px-2 sm:px-3 py-2 bg-card/50">
        <div className="flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5 text-primary" />
          <SectionLabel>Narration</SectionLabel>
        </div>

        {/* Provider toggle */}
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">Premium</span>
          <Switch
            checked={config.narrationProvider === "elevenlabs"}
            onCheckedChange={(checked) => {
              setConfig((c) => ({ ...c, narrationProvider: checked ? "elevenlabs" : "browser" }));
              // Keep the server-side TTS routing mode in sync with the toggle so
              // the edge function bypasses admin/auto eco demotion when the user
              // has explicitly chosen Premium narration.
              setTtsMode(checked ? "premium" : "eco");
            }}
            className="scale-75"
          />
        </div>

        {/* Quality comparison note */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border cursor-help ${
              config.narrationProvider === "elevenlabs"
                ? "bg-primary/10 text-primary border-primary/25"
                : "bg-accent/20 text-accent-foreground border-accent/25"
            }`}>
              {config.narrationProvider === "elevenlabs" ? "✨ HD voices" : "🔊 Basic voices"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[280px] space-y-1.5 p-3">
            <p className="font-semibold">
              {config.narrationProvider === "elevenlabs" ? "Premium (ElevenLabs)" : "Free (Browser Speech)"}
            </p>
            {config.narrationProvider === "elevenlabs" ? (
              <>
                <p>• Studio-quality AI voices with natural intonation</p>
                <p>• Multiple voice personalities & demeanour control</p>
                <p>• Multilingual support (29 languages)</p>
                <p>• Faster export — parallel processing</p>
                <p className="text-muted-foreground pt-1">Uses your ElevenLabs character quota</p>
              </>
            ) : (
              <>
                <p>• Uses your device's built-in speech engine</p>
                <p>• Voice quality varies by browser & OS</p>
                <p>• Free — no API quota needed</p>
                <p>• Slower export — records speech in real-time</p>
                <p className="text-muted-foreground pt-1">Works in Video, MP3, and eBook exports</p>
              </>
            )}
          </TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border/40" />

        {/* Voice selector (ElevenLabs only) */}
        {config.narrationProvider === "elevenlabs" && (
          <>
            <div className="flex items-center gap-1.5">
              <Mic2 className="w-3 h-3 text-muted-foreground" />
              <Select value={config.narrationVoice} onValueChange={(v) => setConfig((c) => ({ ...c, narrationVoice: v }))}>
                <SelectTrigger className="h-7 w-[100px] text-xs bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Demeanour */}
            <Select value={config.narrationDemeanour} onValueChange={(v) => setConfig((c) => ({ ...c, narrationDemeanour: v as any }))}>
              <SelectTrigger className="h-7 w-[110px] text-xs bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEMEANOURS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {/* Speed */}
        <div className="flex items-center gap-1.5 min-w-[100px] sm:min-w-[120px]">
          <Gauge className="w-3 h-3 text-muted-foreground shrink-0" />
          <Slider
            value={[config.narrationSpeed]}
            onValueChange={([v]) => setConfig((c) => ({ ...c, narrationSpeed: v }))}
            min={0.7}
            max={1.2}
            step={0.1}
            className="w-12 sm:w-16"
          />
          <span className="text-[10px] text-muted-foreground w-6">{config.narrationSpeed.toFixed(1)}x</span>
        </div>

        {/* Preview button */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={voicePreviewLoading || downloading}
          onClick={playVoicePreview}
        >
          {voicePreviewLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : voicePreviewPlaying ? (
            <><Square className="w-3 h-3" /> Stop</>
          ) : (
            <><Play className="w-3 h-3" /> Preview</>
          )}
        </Button>
      </div>
      ) : (
      <div className="flex items-center gap-3 flex-wrap border border-amber-500/30 rounded-lg px-3 py-2 bg-amber-500/5">
        <Headphones className="w-4 h-4 text-amber-500" />
        <div className="flex-1">
          <p className="text-xs font-medium">🔒 Narration requires Premium</p>
          <p className="text-[10px] text-muted-foreground">Upgrade to unlock voice narration, audio previews, and MP3/video exports with narration.</p>
        </div>
      </div>
      )}

      {/* Row 1: Navigation + Project tools */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5" title="Go back to the StoryBook preview step">
          <ArrowLeft className="w-3.5 h-3.5" /> {t("visual.backToStoryBook")}
        </Button>

        <div className="w-px h-6 bg-border/50" />

        <Button variant="outline" size="sm" onClick={onSave} disabled={saving || downloading} className="gap-1.5" title="Save your project">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" size="sm" onClick={onPrint} disabled={downloading} className="gap-1.5" title="Print the storybook">
          <Printer className="w-3.5 h-3.5" /> Print
        </Button>

        <div className="w-px h-6 bg-border/50" />
        <SectionLabel>Images</SectionLabel>

        <Button variant="outline" size="sm" onClick={onRegenerateAllImages} disabled={regeneratingImages || downloading} className="gap-1.5" title="Regenerate all chapter images">
          {regeneratingImages ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {imageProgress.current}/{imageProgress.total}</>
          ) : (
            <><RefreshCw className="w-3.5 h-3.5" /> Regenerate</>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={onRefreshImages} disabled={downloading || regeneratingImages || chaptersWithImagesCount === 0} className="gap-1.5" title="Reload images from storage">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={onResetImages} disabled={downloading || regeneratingImages || chaptersWithImagesCount === 0} className="gap-1.5 text-destructive hover:text-destructive" title="Remove all generated images">
          <Trash2 className="w-3.5 h-3.5" /> Reset
        </Button>

        {(downloading || regeneratingImages) && (
          <Button variant="destructive" size="sm" onClick={() => { onStopExport(); if (onStopGeneration) onStopGeneration(); }} className="gap-1.5" title="Stop current process">
            <StopCircle className="w-3.5 h-3.5" /> Stop
          </Button>
        )}

        {/* TTS cache badge — right-aligned */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
            ttsCacheSize > 0
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-muted/50 text-muted-foreground border-border/40"
          }`}>
            <Headphones className="w-2.5 h-2.5" />
            {ttsCacheSize > 0 ? `${ttsCacheSize} cached` : "No cache"}
          </span>
          {ttsCacheSize > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-muted-foreground h-6 px-1.5"
              disabled={downloading}
              onClick={() => {
                const cleared = onClearTtsCache();
                toast({ title: "Narration cache cleared", description: `${cleared} cached audio clip${cleared !== 1 ? "s" : ""} removed.` });
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Exports & Downloads */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap border-t border-border/30 pt-2">
        {chaptersWithImagesCount > 0 && (
          <Button variant="secondary" size="sm" onClick={onOpenReader} className="gap-1.5 glow-accent" title="Open the immersive audiovisual reader">
            <Headphones className="w-3.5 h-3.5" /> {t("visual.listenRead")}
          </Button>
        )}

        {/* Preview All */}
        <div className="flex flex-col items-center gap-0.5">
          <Button
            variant={previewAllActive ? "destructive" : "outline"}
            size="sm"
            onClick={onPreviewAll}
            disabled={downloading || chaptersCount === 0}
            className="gap-1.5"
            title="Preview narration for all chapters"
          >
            {previewAllActive ? (
              <>
                <div className="flex items-end gap-[2px] h-3.5">
                  <span className="waveform-bar" />
                  <span className="waveform-bar" />
                  <span className="waveform-bar" />
                  <span className="waveform-bar" />
                </div>
                Ch. {previewingChapterIndex !== null ? previewingChapterIndex + 1 : "…"}/{chaptersCount} <Square className="w-3 h-3" />
              </>
            ) : (
              <><Play className="w-3.5 h-3.5" /> Preview all</>
            )}
          </Button>
          {previewAllActive && (
            <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${previewingChapterIndex !== null ? ((previewingChapterIndex + 1) / chaptersCount) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>

        {totalNarrationChars > 0 && canUseNarration && (
          <NarrationCostEstimator
            totalChars={totalNarrationChars}
            cachedChars={cachedNarrationChars}
            provider={config.narrationProvider as "browser" | "elevenlabs"}
          />
        )}

        <div className="w-px h-6 bg-border/50" />
        <SectionLabel>Export</SectionLabel>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
          config.narrationProvider === "elevenlabs"
            ? "bg-primary/10 text-primary border-primary/30"
            : "bg-muted/50 text-muted-foreground border-border/40"
        }`}>
          {config.narrationProvider === "elevenlabs" ? "✨ Premium" : "🔊 Browser"}
        </span>

        {/* Time savings indicator when cached chapters exist */}
        {canResume && cachedChapterCount && cachedChapterCount > 0 && !downloading && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25 animate-in fade-in cursor-help">
                ⚡ ~{Math.max(1, Math.round(cachedChapterCount * (config.narrationProvider === "elevenlabs" ? 4 : 8) / 60))} min saved
                <span className="text-[9px] opacity-70">({cachedChapterCount} cached)</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              <p>{cachedChapterCount} of {chaptersCount} chapters already narrated.</p>
              <p className="text-muted-foreground mt-1">
                Estimate: ~{config.narrationProvider === "elevenlabs" ? "4" : "8"}s per chapter
                ({config.narrationProvider === "elevenlabs" ? "Premium API" : "Browser TTS"}).
                Cached audio is reused on resume.
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        <Button size="sm" onClick={onDownloadEbook} disabled={downloading || chaptersCount === 0} className="gap-1.5" title={canResume ? `Resume — ${cachedChapterCount} of ${chaptersCount} chapters cached` : "Download as interactive HTML eBook"}>
          {downloading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
          ) : (
            <><BookDown className="w-3.5 h-3.5" /> {canResume ? `Resume (${cachedChapterCount}/${chaptersCount})` : t("visual.downloadEbook")}</>
          )}
        </Button>
        <Button size="sm" onClick={onDownloadEpub} disabled={downloading || chaptersCount === 0} variant="outline" className="gap-1.5" title="Export as ePub for eReader apps">
          {downloading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
          ) : (
            <><BookOpenCheck className="w-3.5 h-3.5" /> ePub</>
          )}
        </Button>
        <Button size="sm" onClick={onDownloadTextBook} disabled={downloading || chaptersCount === 0} variant="outline" className="gap-1.5" title="Download text-only HTML book">
          {downloading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
          ) : (
            <><Type className="w-3.5 h-3.5" /> Text</>
          )}
        </Button>
        <Button size="sm" onClick={onDownloadAudio} disabled={downloading || chaptersCount === 0 || !canUseNarration} variant="outline" className="gap-1.5" title={!canUseNarration ? "Upgrade to Premium+ for MP3 export" : canResume ? `Resume MP3 — ${cachedChapterCount} cached` : "Download all narrations as MP3 audiobook"}>
          {downloading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
          ) : !canUseNarration ? (
            <><Music className="w-3.5 h-3.5" /> 🔒 MP3</>
          ) : (
            <><Music className="w-3.5 h-3.5" /> {canResume ? `MP3 (resume)` : "MP3"}</>
          )}
        </Button>

        {/* PDF with photo-only toggle */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => onDownloadPdf(pdfPhotoOnly)} disabled={downloading || chaptersWithImagesCount === 0} variant="outline" className="gap-1.5" title="Download as PDF">
            {downloading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
            ) : (
              <><FileText className="w-3.5 h-3.5" /> PDF</>
            )}
          </Button>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pdfPhotoOnly}
              onChange={(e) => setPdfPhotoOnly(e.target.checked)}
              className="accent-primary w-3 h-3 rounded"
            />
            {t("visual.photoOnly")}
          </label>
          </div>

        <Button
          size="sm"
          onClick={() => runJsonExport()}
          disabled={chaptersCount === 0 || jsonExporting || downloading}
          variant="outline"
          className="gap-1.5"
          title="Download editable storyboard data (JSON) — full project, re-importable for editing"
        >
          {jsonExporting ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting…</>
          ) : (
            <><FileJson className="w-3.5 h-3.5" /> JSON</>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={chaptersCount === 0 || jsonExporting || downloading}
          title="Export only selected chapters as JSON"
          onClick={() => {
            // Default to all selected when opening
            setJsonPickerSelected(new Set(chapterPickerItems.map((c) => c.id)));
            setJsonPickerOpen(true);
          }}
        >
          <FileJson className="w-3.5 h-3.5" /> JSON (pick…)
        </Button>

        {onPreviewStoryboardJson && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={chaptersCount === 0 || jsonExporting || downloading}
            title="Preview the JSON payload (schema, version, sample) before downloading"
            onClick={() => onPreviewStoryboardJson()}
          >
            <FileJson className="w-3.5 h-3.5" /> Preview JSON
          </Button>
        )}

        <span
          id="storyboard-import-inputs"
          tabIndex={-1}
          className="contents focus:outline-none"
          aria-label="Storyboard import inputs"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          title="Import a previously exported storyboard JSON file"
          onClick={() => importJsonInputRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" /> Import JSON
        </Button>
        <input
          ref={importJsonInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (file.size > 20 * 1024 * 1024) {
                toast({ title: "File too large", description: "Storyboard JSON must be under 20MB.", variant: "destructive" });
              } else {
                void onImportStoryboardJson(file);
              }
            }
            e.target.value = ""; // allow re-importing the same filename
          }}
        />

        {onImportStoryboardText && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            title="Paste exported storyboard JSON directly"
            onClick={async () => {
              // Try to seed the textarea from the user's clipboard.
              try {
                if (navigator.clipboard?.readText) {
                  const clip = await navigator.clipboard.readText();
                  if (clip && clip.trim().startsWith("{")) setPasteText(clip);
                }
              } catch {
                // Clipboard permission denied — open empty.
              }
              setPasteOpen(true);
            }}
          >
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste JSON
          </Button>
        )}

        <Dialog open={pasteOpen} onOpenChange={(o) => { if (!pasteSubmitting) setPasteOpen(o); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Paste storyboard JSON</DialogTitle>
              <DialogDescription>
                Paste the contents of an exported storyboard JSON file below. You'll get the same review screen as a file import before anything is applied.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='{"schema":"resonance-storyboard@2", ...}'
              className="font-mono text-xs h-72 resize-none"
              spellCheck={false}
              autoFocus
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{pasteText ? `${(new Blob([pasteText]).size / 1024).toFixed(1)} KB` : "Empty"}</span>
              {pasteText && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setPasteText("")}
                >
                  Clear
                </button>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasteOpen(false)} disabled={pasteSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const text = pasteText.trim();
                  if (!text) {
                    toast({ title: "Nothing to import", description: "Paste storyboard JSON first.", variant: "destructive" });
                    return;
                  }
                  if (new Blob([text]).size > 20 * 1024 * 1024) {
                    toast({ title: "JSON too large", description: "Pasted JSON must be under 20MB.", variant: "destructive" });
                    return;
                  }
                  setPasteSubmitting(true);
                  try {
                    await onImportStoryboardText!(text);
                    setPasteOpen(false);
                    setPasteText("");
                  } finally {
                    setPasteSubmitting(false);
                  }
                }}
                disabled={pasteSubmitting || !pasteText.trim()}
              >
                {pasteSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Parsing…</> : "Review import"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Selective JSON export — pick chapters to include */}
        <Dialog open={jsonPickerOpen} onOpenChange={setJsonPickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Export selected chapters</DialogTitle>
              <DialogDescription>
                Choose which chapters to include in the JSON export. Sources, config and reference image are always included.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-y py-2">
              <span>{jsonPickerSelected.size} of {chapterPickerItems.length} selected</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setJsonPickerSelected(new Set(chapterPickerItems.map((c) => c.id)))}
                >Select all</button>
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setJsonPickerSelected(new Set())}
                >Clear</button>
              </div>
            </div>
            <ScrollArea className="max-h-[50vh] pr-2">
              <ul className="space-y-1.5 py-1">
                {chapterPickerItems.map((c, i) => {
                  const checked = jsonPickerSelected.has(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setJsonPickerSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(c.id); else next.delete(c.id);
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <span className="flex-1 leading-snug">
                          <span className="text-muted-foreground tabular-nums mr-1.5">{i + 1}.</span>
                          {c.title}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setJsonPickerOpen(false)} disabled={jsonExporting}>Cancel</Button>
              <Button
                size="sm"
                disabled={jsonPickerSelected.size === 0 || jsonExporting}
                onClick={async () => {
                  // Preserve original chapter order rather than insertion order in the Set.
                  const orderedIds = chapterPickerItems
                    .map((c) => c.id)
                    .filter((id) => jsonPickerSelected.has(id));
                  await runJsonExport(orderedIds);
                  setJsonPickerOpen(false);
                }}
              >
                {jsonExporting ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Exporting…</>
                ) : (
                  <>Export {jsonPickerSelected.size} chapter{jsonPickerSelected.size === 1 ? "" : "s"}</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Video with quality/speed toggles */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={() => onDownloadVideo(videoQuality, videoSpeed)} disabled={downloading || chaptersWithImagesCount === 0} variant="outline" className="gap-1.5" title="Export as MP4 video">
                {downloading && isVideoExport ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressLabel}</>
                ) : (
                  <>
                    <Video className="w-3.5 h-3.5" /> Video
                    {config.narrationProvider === "elevenlabs" ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded-full bg-primary/15 text-primary border border-primary/25">
                        <Headphones className="w-2.5 h-2.5" /> Premium
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded-full bg-accent/40 text-accent-foreground border border-accent/30">
                        <Headphones className="w-2.5 h-2.5" /> Free
                      </span>
                    )}
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[220px]">
              {config.narrationProvider === "elevenlabs"
                ? "Video will include Premium narration audio"
                : "Video will include free browser narration (recording takes longer)"}
            </TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-0.5 bg-card/80 border border-border/40 rounded-full p-0.5 text-[10px]">
            {(["720p", "1080p"] as VideoQuality[]).map((q) => (
              <button
                key={q}
                onClick={() => setVideoQuality(q)}
                className={`px-1.5 py-0.5 rounded-full transition-all ${videoQuality === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 bg-card/80 border border-border/40 rounded-full p-0.5 text-[10px]" title="Fast (12fps) / Normal (18fps) / HQ (24fps)">
            {(["fast", "normal", "hq"] as VideoSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => setVideoSpeed(s)}
                className={`px-1.5 py-0.5 rounded-full transition-all capitalize ${videoSpeed === s ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {s === "hq" ? "HQ" : s}
              </button>
            ))}
          </div>
          <DebugDriftToggle />
          {isVideoExport ? (
            <span className="text-[10px] text-primary font-mono whitespace-nowrap animate-pulse">
              ⏱ {formatElapsed(elapsedSeconds)} / ~{estimateExportTime(chaptersCount, videoQuality, videoSpeed)}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              ~{estimateExportTime(chaptersCount, videoQuality, videoSpeed)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Debug-only toggle that injects ±1s of synthetic A/V drift into the next video export
 * so the warning toast / log line can be verified without needing a mismatched project.
 * State lives on `globalThis.__avDriftDebugSecs` and is read by useVisualBookExports.
 */
function DebugDriftToggle() {
  const [enabled, setEnabled] = useState(false);
  const handleToggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    (globalThis as unknown as { __avDriftDebugSecs?: number }).__avDriftDebugSecs = next ? 1 : 0;
  }, [enabled]);
  return (
    <button
      type="button"
      onClick={handleToggle}
      title="Debug: inject +1s A/V drift on next export to verify the sync warning"
      className={`px-1.5 py-0.5 rounded-full border text-[10px] font-mono transition-colors whitespace-nowrap ${
        enabled
          ? "bg-destructive/20 border-destructive/40 text-destructive"
          : "bg-card/80 border-border/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      🐞 +1s drift {enabled ? "ON" : "OFF"}
    </button>
  );
}

