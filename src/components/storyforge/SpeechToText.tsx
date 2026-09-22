import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Loader2, Check, Save, Wand2, BookCheck, Sparkles, Globe, Download, HardDrive, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useBrowserStt, isBrowserSttSupported } from "@/hooks/use-browser-stt";
import { useWhisperStt, resolveWhisperLanguage, WHISPER_MODELS, type WhisperModelSize } from "@/hooks/use-whisper-stt";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

interface SpeechToTextProps {
  onTranscript: (text: string) => void;
  onSaveAndConfigure?: () => void;
  onFormatAndCreate?: (text: string) => void;
  onUseAsIs?: (text: string) => void;
  isFormatting?: boolean;
}

type SttEngine = "browser" | "offline" | "premium";

const ENGINE_KEY = "storyforge-stt-engine";
const MODEL_SIZE_KEY = "storyforge-stt-whisper-size";
const DRAFT_KEY = "storyforge-stt-draft";

// Rough word targets for common book lengths.
const BOOK_TARGETS: { label: string; words: number }[] = [
  { label: "Short story", words: 5_000 },
  { label: "Novella", words: 20_000 },
  { label: "Novel", words: 80_000 },
];

function readEngine(): SttEngine {
  if (typeof window === "undefined") return "browser";
  const stored = window.localStorage.getItem(ENGINE_KEY) ?? window.sessionStorage.getItem(ENGINE_KEY);
  if (OPEN_NOVA_LOCAL_ONLY) return stored === "browser" && isBrowserSttSupported() ? "browser" : "offline";
  if (stored === "premium" || stored === "browser" || stored === "offline") return stored;
  return isBrowserSttSupported() ? "browser" : "premium";
}

function readModelSize(): WhisperModelSize {
  if (typeof window === "undefined") return "base";
  const stored = window.localStorage.getItem(MODEL_SIZE_KEY);
  if (stored === "tiny" || stored === "base" || stored === "small") return stored;
  return "base";
}

export function SpeechToText({ onTranscript, onSaveAndConfigure, onFormatAndCreate, onUseAsIs, isFormatting }: SpeechToTextProps) {
  const { toast } = useToast();
  const { t, lang } = useI18n();
  const [connecting, setConnecting] = useState(false);
  const [premiumTranscript, setPremiumTranscript] = useState("");
  const [engine, setEngineState] = useState<SttEngine>(() => readEngine());
  const [whisperSize, setWhisperSizeState] = useState<WhisperModelSize>(() => readModelSize());
  const browserSupported = useMemo(() => isBrowserSttSupported(), []);
  const whisperLangSupported = useMemo(() => resolveWhisperLanguage(lang) !== undefined, [lang]);

  const setEngine = useCallback((next: SttEngine) => {
    setEngineState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ENGINE_KEY, next);
    }
  }, []);

  const setWhisperSize = useCallback((next: WhisperModelSize) => {
    setWhisperSizeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_SIZE_KEY, next);
    }
  }, []);

  const browserStt = useBrowserStt({
    onError: (msg) => toast({ title: "Speech error", description: msg, variant: "destructive" }),
  });

  const whisperStt = useWhisperStt({
    language: lang,
    modelSize: whisperSize,
    onError: (msg) => toast({ title: "Whisper error", description: msg, variant: "destructive" }),
  });
  const whisperSupported = whisperStt.supported;

  // Pre-warm the Whisper model as soon as the user selects the Offline tab,
  // so the first recording starts instantly without a download wait.
  useEffect(() => {
    if (engine === "offline" && whisperStt.supported && !whisperStt.modelReady && !whisperStt.isLoadingModel) {
      whisperStt.prewarm?.().catch(() => {});
    }
  }, [engine, whisperStt.supported, whisperStt.modelReady, whisperStt.isLoadingModel, whisperStt.prewarm]);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    onCommittedTranscript: (data) => {
      setPremiumTranscript((prev) => (prev ? `${prev} ${data.text}` : data.text));
    },
    onError: (error) => {
      console.error("Scribe error:", error);
      const msg = typeof error === "string" ? error : (error as any)?.message || "Speech recognition failed";
      const isInsufficientFunds = msg.includes("insufficient_funds") || msg.includes("funds");
      toast({
        title: isInsufficientFunds ? t("stt.fundsError") : "Speech error",
        description: isInsufficientFunds ? t("stt.fundsErrorDesc") : msg,
        variant: "destructive",
      });
    },
    onDisconnect: () => {},
  });

  const isBrowser = engine === "browser";
  const isOffline = engine === "offline";
  const isPremium = engine === "premium";

  const fullTranscript = isBrowser
    ? browserStt.fullTranscript
    : isOffline
      ? whisperStt.fullTranscript
      : premiumTranscript;
  const partialTranscript = isBrowser
    ? browserStt.partialTranscript
    : isOffline
      ? whisperStt.partialTranscript
      : scribe.partialTranscript;
  const isActive = isBrowser
    ? browserStt.isListening
    : isOffline
      ? whisperStt.isRecording
      : scribe.isConnected;

  const setFullTranscript = useCallback((next: string) => {
    if (isBrowser) browserStt.setFullTranscript(next);
    else if (isOffline) whisperStt.setFullTranscript(next);
    else setPremiumTranscript(next);
  }, [isBrowser, isOffline, browserStt, whisperStt]);

  // Restore any in-progress dictation draft on mount so a long book session
  // survives accidental reloads or browser crashes.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved && saved.trim() && !fullTranscript) {
        setFullTranscript(saved);
        toast({
          title: "Dictation restored",
          description: `Recovered ${saved.split(/\s+/).filter(Boolean).length.toLocaleString()} words from your last session.`,
        });
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the current transcript as it grows.
  useEffect(() => {
    try {
      if (fullTranscript && fullTranscript.trim()) {
        window.localStorage.setItem(DRAFT_KEY, fullTranscript);
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // ignore quota errors
    }
  }, [fullTranscript]);

  // Counters for book-length feedback.
  const wordCount = useMemo(
    () => (fullTranscript ? fullTranscript.trim().split(/\s+/).filter(Boolean).length : 0),
    [fullTranscript],
  );
  const charCount = fullTranscript.length;
  const nextTarget = BOOK_TARGETS.find((t) => wordCount < t.words) ?? BOOK_TARGETS[BOOK_TARGETS.length - 1];
  const targetProgress = Math.min(100, Math.round((wordCount / nextTarget.words) * 100));

  const handleStartPremium = useCallback(async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-scribe-token");
      if (error) throw new Error(error.message);
      if (!data?.token) throw new Error("No token received");

      await scribe.connect({
        token: data.token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });

      setTimeout(() => {
        if (!scribe.isConnected) {
          toast({
            title: t("stt.fundsError"),
            description: t("stt.fundsErrorDesc"),
            variant: "destructive",
          });
        }
      }, 2000);
    } catch (err: any) {
      toast({
        title: "Microphone error",
        description: err.message || "Could not start speech recognition",
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  }, [scribe, toast, t]);

  const handleStart = useCallback(() => {
    if (isBrowser) browserStt.start();
    else if (isOffline) whisperStt.start();
    else handleStartPremium();
  }, [isBrowser, isOffline, browserStt, whisperStt, handleStartPremium]);

  const handleStop = useCallback(() => {
    if (isBrowser) browserStt.stop();
    else if (isOffline) whisperStt.stop();
    else scribe.disconnect();
  }, [isBrowser, isOffline, browserStt, whisperStt, scribe]);

  const handleDownloadEvidence = useCallback(() => {
    if (!isOffline || !whisperStt.lastArtifact) return;
    const payload = {
      schemaVersion: 1,
      engine: "rons-local-whisper",
      transcript: fullTranscript.trim(),
      ...whisperStt.lastArtifact,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `epublisher-stt-evidence-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [isOffline, whisperStt.lastArtifact, fullTranscript]);

  const handleUseTranscript = useCallback(() => {
    const text = fullTranscript.trim();
    if (text) {
      onTranscript(text);
      toast({ title: "Transcript added", description: "Speech has been added to your topic." });
    }
    if (isBrowser) browserStt.reset();
    else if (isOffline) whisperStt.reset();
    else setPremiumTranscript("");
  }, [fullTranscript, onTranscript, toast, isBrowser, isOffline, browserStt, whisperStt]);

  const handleClear = useCallback(() => {
    if (isBrowser) browserStt.reset();
    else if (isOffline) whisperStt.reset();
    else setPremiumTranscript("");
  }, [isBrowser, isOffline, browserStt, whisperStt]);

  const startDisabled =
    connecting ||
    (isBrowser && !browserSupported) ||
    (isOffline && !whisperSupported) ||
    (isOffline && (whisperStt.isLoadingModel || whisperStt.isTranscribing));

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Mic className="w-3 h-3" /> {t("stt.label")}
        </label>
        <div className="inline-flex items-center rounded-full border border-border/60 bg-card/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => !isActive && setEngine("browser")}
            disabled={isActive || !browserSupported}
            className={`px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
              isBrowser ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={browserSupported ? "Free browser speech recognition" : "Not supported in this browser"}
          >
            <Globe className="w-3 h-3" /> Free
          </button>
          <button
            type="button"
            onClick={() => !isActive && setEngine("offline")}
            disabled={isActive || !whisperSupported}
            className={`px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
              isOffline ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={OPEN_NOVA_LOCAL_ONLY ? "RONS local Whisper on Ealiophin (private, no cloud upload)" : "RONS hosted Whisper (encrypted cloud transcription)"}
          >
            <HardDrive className="w-3 h-3" /> {OPEN_NOVA_LOCAL_ONLY ? "RONS Local" : "RONS Cloud"}
          </button>
        </div>
      </div>

      {isBrowser && !browserSupported && (
        <div className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-lg p-2.5">
          Free browser speech recognition isn't supported in this browser (e.g. Firefox). Switch to Offline, or use Chrome, Edge, or Safari.
        </div>
      )}

      {isOffline && !whisperSupported && (
        <div className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-lg p-2.5">
          Offline Whisper isn't supported in this browser. Try a recent version of Chrome, Edge, Safari, or Firefox.
        </div>
      )}

      {isOffline && whisperSupported && OPEN_NOVA_LOCAL_ONLY && (
        <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Whisper model size</div>
          <div className="inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5 text-xs">
            {(["tiny", "base", "small"] as const).map((size) => {
              const info = WHISPER_MODELS[size];
              const active = whisperSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => !isActive && !whisperStt.isLoadingModel && setWhisperSize(size)}
                  disabled={isActive || whisperStt.isLoadingModel}
                  className={`px-2.5 py-1 rounded-full transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={info.description}
                >
                  {info.label} <span className="opacity-70">({info.sizeLabel})</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground/80">{WHISPER_MODELS[whisperSize].description}</p>
        </div>
      )}

      {isOffline && whisperSupported && !whisperStt.modelReady && !whisperStt.isLoadingModel && (
        <div className="text-xs bg-primary/5 border border-primary/30 rounded-lg p-2.5 flex items-start gap-2">
          <Download className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
          <div className="text-muted-foreground space-y-1">
            <div>
              <span className="text-foreground font-medium">
                {OPEN_NOVA_LOCAL_ONLY
                  ? `Local model (${WHISPER_MODELS[whisperSize].sizeLabel}).`
                  : "RONS hosted Whisper."}
              </span>{" "}
              {OPEN_NOVA_LOCAL_ONLY
                ? "The multilingual Whisper service runs locally on Ealiophin through RONS. Audio stays on this machine and is not sent to a cloud speech provider."
                : "Audio is sent only to the governed RONS hosted STT service for transcription."}
            </div>
            {!whisperLangSupported && (
              <div className="text-[11px] text-destructive/90">
                Note: Whisper doesn't officially support your selected language ({lang}). It will auto-detect a close match — accuracy may vary.
              </div>
            )}
          </div>
        </div>
      )}

      {isOffline && whisperStt.isLoadingModel && (
        <div className="text-xs bg-card/60 border border-border/50 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-2 text-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Preparing local Whisper model… {whisperStt.loadProgress?.progress ?? 0}%
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${whisperStt.loadProgress?.progress ?? 0}%` }}
            />
          </div>
          {whisperStt.loadProgress?.file && (
            <div className="text-[10px] text-muted-foreground/80 truncate">{whisperStt.loadProgress.file}</div>
          )}
        </div>
      )}

      <div className="bg-card/60 border border-border/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          {!isActive ? (
            <Button
              onClick={handleStart}
              disabled={startDisabled}
              variant="outline"
              className="gap-2"
            >
              {connecting || (isOffline && whisperStt.isLoadingModel) ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4 text-destructive" />
              )}
              {connecting
                ? t("stt.connecting")
                : isOffline && whisperStt.isLoadingModel
                  ? "Loading model…"
                  : t("stt.startRecording")}
            </Button>
          ) : (
            <Button onClick={handleStop} variant="destructive" className="gap-2">
              <MicOff className="w-4 h-4" />
              {t("stt.stopRecording")}
            </Button>
          )}

          {isActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2"
            >
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
              </span>
              <span className="text-xs text-muted-foreground">
                {isOffline ? `Recording · ${OPEN_NOVA_LOCAL_ONLY ? "local" : "hosted"} transcription every 45s` : t("stt.listening")}
              </span>
            </motion.div>
          )}

          {isOffline && whisperStt.isTranscribing && !isActive && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing…
            </div>
          )}

          <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {isBrowser ? "Browser · Free" : isOffline ? `RONS Whisper · ${OPEN_NOVA_LOCAL_ONLY ? "Local" : "Cloud"}` : "External premium · Disabled locally"}
          </span>
        </div>

        <AnimatePresence>
          {(partialTranscript || fullTranscript) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="space-y-1.5">
                <Textarea
                  value={fullTranscript + (partialTranscript ? ` ${partialTranscript}` : "")}
                  onChange={(e) => {
                    // Strip trailing partial (it gets re-appended on next render)
                    const next = partialTranscript && e.target.value.endsWith(` ${partialTranscript}`)
                      ? e.target.value.slice(0, -1 - partialTranscript.length)
                      : e.target.value;
                    setFullTranscript(next);
                  }}
                  placeholder="Your dictation will appear here. You can edit it any time, even while recording."
                  className="min-h-[200px] max-h-[60vh] resize-y bg-background/60 text-sm leading-relaxed"
                />
                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      <strong className="text-foreground">{wordCount.toLocaleString()}</strong> words
                    </span>
                    <span>{charCount.toLocaleString()} chars</span>
                    <span className="opacity-70">Autosaved</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-[160px]">
                    <span>{nextTarget.label}</span>
                    <div className="h-1 w-20 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${targetProgress}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{targetProgress}%</span>
                  </div>
                </div>
              </div>

              {fullTranscript && !isActive && !whisperStt.isTranscribing && (
                <div className="flex gap-2 flex-wrap">
                  {isOffline && whisperStt.lastArtifact && (
                    <Button size="sm" variant="outline" onClick={handleDownloadEvidence} className="gap-1.5">
                      <Download className="w-4 h-4" /> STT evidence
                    </Button>
                  )}
                  <Button size="sm" onClick={handleUseTranscript} className="gap-1.5">
                    <Check className="w-3.5 h-3.5" /> {t("stt.useAsTopic")}
                  </Button>
                  {onSaveAndConfigure && (
                    <Button size="sm" onClick={() => { handleUseTranscript(); onSaveAndConfigure(); }} className="gap-1.5 glow-primary">
                      <Save className="w-3.5 h-3.5" /> {t("stt.saveConfigure")}
                    </Button>
                  )}
                  {onUseAsIs && (
                    <Button size="sm" variant="secondary" onClick={() => { const txt = fullTranscript; handleUseTranscript(); onUseAsIs(txt); }} className="gap-1.5">
                      <BookCheck className="w-3.5 h-3.5" /> {t("source.useAsIs")}
                    </Button>
                  )}
                  {onFormatAndCreate && (
                    <Button size="sm" disabled={isFormatting} onClick={() => { const txt = fullTranscript; handleUseTranscript(); onFormatAndCreate(txt); }} className="gap-1.5 glow-primary">
                      {isFormatting ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Formatting…</>
                      ) : (
                        <><Wand2 className="w-3.5 h-3.5" /> Format & Create Book</>
                      )}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={handleClear}>
                    {t("stt.clear")}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-xs text-muted-foreground/60">
          {isBrowser
            ? "Free in-browser speech recognition. Best for short to medium dictation. Your draft autosaves locally — close and come back any time."
            : isOffline
              ? (OPEN_NOVA_LOCAL_ONLY
                ? "Rolling RONS Whisper transcription in 45s chunks on Ealiophin — ideal for dictating a whole book. Fully local and autosaved."
                : "Rolling RONS hosted Whisper transcription in 45s chunks — ideal for long dictation and autosaved locally.")
              : t("stt.hint")}
        </p>
      </div>
    </motion.div>
  );
}
