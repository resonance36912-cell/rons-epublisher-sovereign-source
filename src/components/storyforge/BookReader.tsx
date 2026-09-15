import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SlideChapter, StoryConfig, useStoryForge } from "./StoryForgeContext";
import { useChapterImageViewAudit } from "@/hooks/useChapterImageViewAudit";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, BookOpen, Loader2, Mic, Languages, Gauge, Square, Download
} from "lucide-react";
import { saveAs } from "file-saver";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { VoiceRecorder } from "./VoiceRecorder";
import { isNarrationAbortError, requestNarrationAudio, speakWithBrowserNarration, stopBrowserNarration } from "@/lib/tts-client";
import { Slider } from "@/components/ui/slider";

type Props = {
  chapters: SlideChapter[];
  config: StoryConfig;
  onClose: () => void;
};

const VOICE_OPTIONS = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam" },
  { id: "custom", name: "My Voice" },
];

export function BookReader({ chapters, config, onClose }: Props) {
  const { toast } = useToast();
  const { t, lang } = useI18n();
  const { projectId } = useStoryForge();
  useChapterImageViewAudit("Open book reader", projectId, chapters);
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(config.narrationVoice);
  const [narrationLang, setNarrationLang] = useState<"en" | "af">(lang as "en" | "af");
  const [customRecordings, setCustomRecordings] = useState<Record<number, string>>({});
  const [showRecorder, setShowRecorder] = useState(false);
  const [readingWpm, setReadingWpm] = useState(180);
  const [narrationMode, setNarrationMode] = useState<"voice" | "autoread">("voice");
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoAdvanceRef = useRef(false);
  const audioCacheRef = useRef<Map<string, string>>(new Map());

  // Lightweight reading-progress timer for auto-read mode (drives auto-advance only,
  // no per-word highlighting — karaoke is now Video-eBook-only).
  const autoReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAutoReading, setIsAutoReading] = useState(false);

  const validChapters = chapters.filter((c) => c.imageUrl || c.body);
  const chapter = validChapters[currentPage];

  const stopAutoRead = useCallback(() => {
    if (autoReadTimerRef.current) {
      clearTimeout(autoReadTimerRef.current);
      autoReadTimerRef.current = null;
    }
    setIsAutoReading(false);
  }, []);

  const stopAudio = useCallback(() => {
    stopBrowserNarration();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
  }, []);

  const fetchAudio = useCallback(async (text: string, voiceId: string): Promise<string | null> => {
    const cacheKey = `${voiceId}-${narrationLang}-${config.narrationSpeed}-${text.slice(0, 100)}`;
    const cached = audioCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const result = await requestNarrationAudio({
      text,
      voiceId,
      language: narrationLang,
      speed: config.narrationSpeed,
      demeanour: config.narrationDemeanour,
    });

    if (result.kind === "fallback") {
      return null;
    }

    const audioBlob = result.blob;
    const audioUrl = URL.createObjectURL(audioBlob);
    audioCacheRef.current.set(cacheKey, audioUrl);
    return audioUrl;
  }, [narrationLang, config.narrationSpeed, config.narrationDemeanour]);

  // Prefetch next chapter audio
  const prefetchNext = useCallback((idx: number) => {
    const nextIdx = idx + 1;
    if (nextIdx >= validChapters.length || selectedVoice === "custom" || config.narrationProvider === "browser") return;
    const nextCh = validChapters[nextIdx];
    if (!nextCh?.body) return;
    fetchAudio(nextCh.body, selectedVoice).catch(() => {});
  }, [validChapters, selectedVoice, fetchAudio]);

  const speakChapter = useCallback(
    async (idx: number) => {
      stopAudio();
      const ch = validChapters[idx];
      if (!ch?.body || isMuted) return;

      if (selectedVoice === "custom" && customRecordings[idx]) {
        const audio = new Audio(customRecordings[idx]);
        audio.onended = () => {
          if (autoAdvanceRef.current && idx < validChapters.length - 1) {
            setCurrentPage(idx + 1);
          } else {
            setIsPlaying(false);
          }
        };
        audioRef.current = audio;
        await audio.play();
        prefetchNext(idx);
        return;
      }

      if (selectedVoice === "custom") {
        toast({ title: t("reader.noRecording"), description: t("reader.noRecordingDesc"), variant: "destructive" });
        setIsPlaying(false);
        return;
      }

      setIsLoading(true);
      try {
        if (config.narrationProvider === "browser") {
          await speakWithBrowserNarration(ch.body, { language: narrationLang, speed: config.narrationSpeed });
          if (autoAdvanceRef.current && idx < validChapters.length - 1) {
            setCurrentPage(idx + 1);
          } else {
            setIsPlaying(false);
          }
          return;
        }

        const audioUrl = await fetchAudio(ch.body, selectedVoice);
        if (!audioUrl) {
          toast({ title: "Using browser narration", description: "Voice service is busy, switching to browser voice." });
          await speakWithBrowserNarration(ch.body, { language: narrationLang, speed: config.narrationSpeed });
          if (autoAdvanceRef.current && idx < validChapters.length - 1) {
            setCurrentPage(idx + 1);
          } else {
            setIsPlaying(false);
          }
          return;
        }

        const audio = new Audio(audioUrl);

        audio.onended = () => {
          if (autoAdvanceRef.current && idx < validChapters.length - 1) {
            setCurrentPage(idx + 1);
          } else {
            setIsPlaying(false);
          }
        };

        audioRef.current = audio;
        await audio.play();
      } catch (err: any) {
        if (!isNarrationAbortError(err)) {
          toast({ title: t("reader.narrationFailed"), description: err.message, variant: "destructive" });
          setIsPlaying(false);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [validChapters, isMuted, selectedVoice, narrationLang, customRecordings, stopAudio, toast, t, fetchAudio, prefetchNext, config.narrationSpeed, config.narrationProvider]
  );

  // When page changes while playing, narrate the new chapter
  const prevPageRef = useRef(currentPage);
  useEffect(() => {
    if (isPlaying && currentPage !== prevPageRef.current) {
      if (narrationMode === "autoread") {
        startAutoReadChapter(currentPage);
      } else {
        speakChapter(currentPage);
      }
    }
    prevPageRef.current = currentPage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Keep autoAdvance ref in sync
  useEffect(() => {
    autoAdvanceRef.current = isPlaying;
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      stopAudio();
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, [stopAudio]);

  /** Master stop – kills all narration, auto-read, and resets state */
  const masterStop = useCallback(() => {
    stopAudio();
    stopAutoRead();
    setIsPlaying(false);
    setIsLoading(false);
  }, [stopAudio, stopAutoRead]);

  /** Download current chapter's narration as MP3 */
  const downloadChapterAudio = useCallback(async () => {
    const ch = validChapters[currentPage];
    if (!ch?.body || ch.body.trim().length < 10) {
      toast({ title: "Not enough text", description: "This chapter needs at least 10 characters.", variant: "destructive" });
      return;
    }
    setDownloadingAudio(true);
    try {
      const voiceId = selectedVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : selectedVoice;
      const result = await requestNarrationAudio({
        text: ch.body.slice(0, 5000),
        voiceId,
        language: narrationLang,
        speed: config.narrationSpeed,
        demeanour: config.narrationDemeanour,
      });
      if (result.kind === "fallback") {
        toast({ title: "Narration unavailable", description: result.payload.message || "Voice service is busy.", variant: "destructive" });
        return;
      }
      const safeName = ch.title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
      saveAs(result.blob, `Ch${currentPage + 1}_${safeName}.mp3`);
      toast({ title: "Chapter audio downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingAudio(false);
    }
  }, [validChapters, currentPage, selectedVoice, narrationLang, config, toast]);

  const togglePlay = () => {
    if (isPlaying) {
      masterStop();
    } else {
      setIsPlaying(true);
      if (narrationMode === "autoread") {
        startAutoReadChapter(currentPage);
      } else {
        speakChapter(currentPage);
      }
    }
  };

  const startAutoReadChapter = useCallback((idx: number) => {
    stopAudio();
    stopAutoRead();
    const wordCount = chapter?.body ? chapter.body.split(/\s+/).filter(Boolean).length : 0;
    if (wordCount === 0) return;
    const durationMs = Math.max(2000, Math.round((wordCount / readingWpm) * 60_000));
    setIsAutoReading(true);
    autoReadTimerRef.current = setTimeout(() => {
      setIsAutoReading(false);
      autoReadTimerRef.current = null;
      if (autoAdvanceRef.current && idx < validChapters.length - 1) {
        setCurrentPage(idx + 1);
      } else {
        setIsPlaying(false);
      }
    }, durationMs);
  }, [stopAudio, stopAutoRead, readingWpm, validChapters.length, chapter?.body]);

  const goPage = (dir: -1 | 1) => {
    const next = currentPage + dir;
    if (next >= 0 && next < validChapters.length) {
      setCurrentPage(next);
    }
  };

  const toggleMute = () => {
    if (!isMuted) stopAudio();
    setIsMuted((m) => !m);
  };

  if (!chapter) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="w-4 h-4" />
          <span>
            {t("reader.chapter")} {currentPage + 1} {t("reader.of")} {validChapters.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(isPlaying || isAutoReading) && (
            <Button
              variant="destructive"
              size="sm"
              onClick={masterStop}
              className="gap-1.5 text-xs h-8 animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="h-11 w-11 sm:h-10 sm:w-10">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Book content */}
      <div className="flex-1 overflow-hidden flex items-center justify-center p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={chapter.id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-5xl bg-card rounded-2xl border shadow-2xl overflow-hidden flex flex-col md:flex-row"
            style={{ maxHeight: "calc(100vh - 160px)" }}
          >
            {/* Image side */}
            {chapter.imageUrl && (
              <div className="md:w-1/2 w-full aspect-video md:aspect-auto bg-muted shrink-0">
                <img
                  src={chapter.imageUrl}
                  alt={chapter.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Text side */}
            <div className="md:w-1/2 w-full p-6 md:p-8 overflow-y-auto flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-primary/70">
                  {t("reader.chapter")} {currentPage + 1}
                </span>
              </div>
              <h2 className="text-xl md:text-2xl font-serif font-bold text-foreground">
                {chapter.title}
              </h2>
              {chapter.body && (
                <p className="text-sm md:text-base leading-relaxed text-foreground/90 whitespace-pre-wrap">
                  {chapter.body}
                </p>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Side nav arrows */}
        {currentPage > 0 && (
          <button
            onClick={() => goPage(-1)}
            className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 border border-border/50 flex items-center justify-center hover:bg-card transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {currentPage < validChapters.length - 1 && (
          <button
            onClick={() => goPage(1)}
            className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 border border-border/50 flex items-center justify-center hover:bg-card transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Narration indicator (indeterminate progress) */}
      {(isPlaying || isAutoReading) && (
        <div className="px-4">
          <div className="w-full max-w-5xl mx-auto">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: "20%", x: "-100%" }}
                animate={{ x: "500%" }}
                transition={{ duration: 1.6, ease: "linear", repeat: Infinity }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mode & speed controls */}
      <div className="border-t border-border/40 px-4 py-2 flex items-center justify-center gap-3 flex-wrap">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setNarrationMode("voice")}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${narrationMode === "voice" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            🔊 {t("reader.voice") || "Voice"}
          </button>
          <button
            onClick={() => setNarrationMode("autoread")}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${narrationMode === "autoread" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            📖 {t("reader.autoRead") || "Auto-Read"}
          </button>
        </div>

        {/* Speed slider */}
        <div className="flex items-center gap-2 min-w-[160px]">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Slider
            value={[readingWpm]}
            onValueChange={([v]) => setReadingWpm(v)}
            min={80}
            max={400}
            step={20}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground w-14 text-right">{readingWpm} wpm</span>
        </div>
      </div>

      {/* Audio controls bar */}
      <div className="border-t border-border/40 px-4 py-3 flex items-center justify-center gap-3 flex-wrap">
        {narrationMode === "voice" && (
          <Button variant="ghost" size="icon" onClick={toggleMute} className="shrink-0 h-11 w-11 sm:h-10 sm:w-10">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => goPage(-1)}
          disabled={currentPage === 0}
          className="h-11 w-11 sm:h-10 sm:w-10"
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        <Button
          onClick={togglePlay}
          size="icon"
          className="w-12 h-12 sm:w-10 sm:h-10 rounded-full"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => goPage(1)}
          disabled={currentPage === validChapters.length - 1}
          className="h-11 w-11 sm:h-10 sm:w-10"
        >
          <SkipForward className="w-4 h-4" />
        </Button>

        {/* Voice selector – only in voice mode */}
        {narrationMode === "voice" && (
          <>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="ml-2 text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>

            <select
              value={narrationLang}
              onChange={(e) => setNarrationLang(e.target.value as "en" | "af")}
              className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground"
              title={t("reader.narrationLang")}
            >
              <option value="en">{t("reader.langEn")}</option>
              <option value="af">{t("reader.langAf")}</option>
            </select>
          </>
        )}

        {/* Record own voice toggle */}
        {selectedVoice === "custom" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowRecorder((v) => !v)}
            className="gap-1 text-xs ml-1"
          >
            <Mic className="w-3.5 h-3.5 text-destructive" />
            {showRecorder ? t("reader.hideRecorder") : t("reader.record")}
          </Button>
        )}

        {/* Download current chapter audio */}
        {narrationMode === "voice" && selectedVoice !== "custom" && chapter?.body && chapter.body.trim().length >= 10 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={downloadChapterAudio}
            disabled={downloadingAudio}
            title="Download chapter narration"
            className="shrink-0 h-11 w-11 sm:h-10 sm:w-10"
          >
            {downloadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </Button>
        )}

        {/* Page indicator dots */}
        <div className="ml-4 flex items-center gap-1">
          {validChapters.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentPage
                  ? "bg-primary w-4"
                  : customRecordings[i]
                  ? "bg-destructive/60"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              title={customRecordings[i] ? `${t("reader.chapter")} ${i + 1} (${t("reader.recorded")})` : `${t("reader.chapter")} ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Voice recorder panel */}
      {showRecorder && selectedVoice === "custom" && (
        <div className="border-t border-border/40 px-4 py-2 flex items-center justify-center gap-3 bg-card/50">
          <span className="text-xs text-muted-foreground">{t("reader.chapter")} {currentPage + 1}:</span>
          <VoiceRecorder
            recordingUrl={customRecordings[currentPage] || null}
            onRecorded={(url) => setCustomRecordings((prev) => ({ ...prev, [currentPage]: url }))}
            onClear={() => setCustomRecordings((prev) => {
              const next = { ...prev };
              if (next[currentPage]) {
                URL.revokeObjectURL(next[currentPage]);
                delete next[currentPage];
              }
              return next;
            })}
          />
          {customRecordings[currentPage] && (
            <audio controls src={customRecordings[currentPage]} className="h-8 max-w-[200px]" />
          )}
        </div>
      )}
    </motion.div>
  );
}
