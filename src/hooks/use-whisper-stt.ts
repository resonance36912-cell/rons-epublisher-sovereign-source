import { useCallback, useEffect, useRef, useState } from "react";

// Available Whisper model sizes (all multilingual, quantized).
// Larger = more accurate, slower to download and transcribe.
export type WhisperModelSize = "tiny" | "base" | "small";

export interface WhisperModelInfo {
  id: string;
  label: string;
  sizeLabel: string;
  description: string;
}

export const WHISPER_MODELS: Record<WhisperModelSize, WhisperModelInfo> = {
  tiny: {
    id: "Xenova/whisper-tiny",
    label: "Tiny",
    sizeLabel: "~40 MB",
    description: "Fastest, lower accuracy. Good for short notes.",
  },
  base: {
    id: "Xenova/whisper-base",
    label: "Base",
    sizeLabel: "~75 MB",
    description: "Balanced speed and accuracy. Recommended default.",
  },
  small: {
    id: "Xenova/whisper-small",
    label: "Small",
    sizeLabel: "~250 MB",
    description: "Best accuracy, slower transcription and bigger download.",
  },
};

// Backward-compat: existing imports referenced these constants.
export const WHISPER_MODEL_ID = WHISPER_MODELS.base.id;
export const WHISPER_MODEL_SIZE_LABEL = WHISPER_MODELS.base.sizeLabel;

const LOCAL_STT_URL = String(import.meta.env.VITE_RONS_STT_URL || "http://127.0.0.1:7864").replace(/\/$/, "");
let localModelReady = false;

async function checkLocalWhisper(): Promise<void> {
  const response = await fetch(`${LOCAL_STT_URL}/health`, { credentials: "omit", cache: "no-store" });
  const payload = await response.json().catch(() => null) as { model_ready?: boolean; error?: string } | null;
  if (!response.ok || !payload?.model_ready) throw new Error(payload?.error || "Local RONS Whisper service is not ready on port 7864");
  localModelReady = true;
}

// Map our app's i18n short codes to Whisper's expected language names.
const WHISPER_LANG_MAP: Record<string, string | undefined> = {
  en: "english",
  af: "afrikaans",
  fr: "french",
  es: "spanish",
  de: "german",
  pt: "portuguese",
  it: "italian",
  nl: "dutch",
  zu: undefined,
  xh: undefined,
  st: undefined,
  ar: "arabic",
  zh: "chinese",
  hi: "hindi",
};

export function resolveWhisperLanguage(appLang?: string): string | undefined {
  if (!appLang) return undefined;
  return WHISPER_LANG_MAP[appLang];
}

export function isWhisperSttSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined"
  );
}

export interface WhisperSttHookOptions {
  onError?: (message: string) => void;
  /** App language code (e.g. "en", "fr", "af"). Maps to Whisper language. */
  language?: string;
  /** Model size to use. Defaults to "base". */
  modelSize?: WhisperModelSize;
}

export interface WhisperLoadProgress {
  file: string;
  progress: number;
}

// Rolling chunk size for book-length dictation. Smaller = more frequent
// transcription updates and lower peak memory; too small hurts accuracy at
// chunk boundaries. 45s is a good balance for Whisper's 30s window + 5s stride.
const ROLLING_CHUNK_MS = 45_000;

export function useWhisperStt(options: WhisperSttHookOptions = {}) {
  const { onError, language, modelSize = "base" } = options;
  const modelInfo = WHISPER_MODELS[modelSize];

  const [isRecording, setIsRecording] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<WhisperLoadProgress | null>(null);
  const [fullTranscript, setFullTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [lastArtifact, setLastArtifact] = useState<any | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rollingTimerRef = useRef<number | null>(null);
  const shouldKeepRollingRef = useRef(false);
  const pendingTranscriptionsRef = useRef(0);

  const supported = isWhisperSttSupported();

  // Reset readiness when model size changes — different model needs its own load.
  useEffect(() => {
    setModelReady(localModelReady);
    setLoadProgress(null);
  }, [modelInfo.id]);

  const handleProgress = useCallback((_data: any) => {}, []);

  const ensureModel = useCallback(async () => {
    if (localModelReady) { setModelReady(true); return; }
    setIsLoadingModel(true);
    setLoadProgress({ file: "RONS Whisper service", progress: 50 });
    try {
      await checkLocalWhisper();
      setModelReady(true);
    } catch (err: any) {
      onError?.(err?.message || "Local RONS Whisper service is unavailable");
      throw err;
    } finally {
      setIsLoadingModel(false);
      setLoadProgress(null);
    }
  }, [onError]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (blob.size === 0) return;
    pendingTranscriptionsRef.current += 1;
    setIsTranscribing(true);
    setPartialTranscript("Transcribing locally…");
    try {
      const response = await fetch(`${LOCAL_STT_URL}/transcribe`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": blob.type || "application/octet-stream", "X-Filename": "epublisher-dictation.webm", "X-Mode": "best" },
        body: blob,
      });
      const payload = await response.json().catch(() => null) as { text?: string; words?: any[]; segments?: any[]; quality?: Record<string, unknown>; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || `Local transcription failed (${response.status})`);
      const text = String(payload?.text || "").trim();
      if (payload) setLastArtifact({ ...payload, capturedAt: new Date().toISOString() });
      if (text) setFullTranscript((prev) => (prev ? `${prev} ${text}` : text));
    } catch (err: any) {
      onError?.(err?.message || "Local Whisper transcription failed");
    } finally {
      pendingTranscriptionsRef.current = Math.max(0, pendingTranscriptionsRef.current - 1);
      if (pendingTranscriptionsRef.current === 0) { setIsTranscribing(false); setPartialTranscript(""); }
    }
  }, [onError]);

  // Build & start a single MediaRecorder bound to the persistent stream.
  // When it stops, we transcribe its chunk and — if shouldKeepRolling — start
  // a fresh recorder so the user can keep dictating without losing audio.
  const startRecorderCycle = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const localChunks: Blob[] = [];
    chunksRef.current = localChunks;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) localChunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(localChunks, { type: recorder.mimeType || "audio/webm" });
      // Kick off transcription in the background; don't block the next cycle.
      void transcribeBlob(blob);
      if (shouldKeepRollingRef.current && streamRef.current) {
        // Immediately start the next cycle for seamless dictation.
        startRecorderCycle();
      } else {
        stopStream();
      }
    };
    recorder.start();

    // Schedule auto-stop so we transcribe in rolling chunks.
    if (rollingTimerRef.current) window.clearTimeout(rollingTimerRef.current);
    rollingTimerRef.current = window.setTimeout(() => {
      try {
        if (recorder.state === "recording") recorder.stop();
      } catch {
        // ignore
      }
    }, ROLLING_CHUNK_MS);
  }, [transcribeBlob, stopStream]);

  const start = useCallback(async () => {
    if (!supported) {
      onError?.("Offline Whisper requires a browser with MediaRecorder and AudioContext.");
      return;
    }
    try {
      await ensureModel();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      shouldKeepRollingRef.current = true;
      startRecorderCycle();
      setIsRecording(true);
    } catch (err: any) {
      stopStream();
      setIsRecording(false);
      shouldKeepRollingRef.current = false;
      if (err?.name === "NotAllowedError") {
        onError?.("Microphone access was denied. Please allow microphone access in your browser settings.");
      }
    }
  }, [supported, ensureModel, onError, stopStream, startRecorderCycle]);

  const stop = useCallback(() => {
    setIsRecording(false);
    shouldKeepRollingRef.current = false;
    if (rollingTimerRef.current) {
      window.clearTimeout(rollingTimerRef.current);
      rollingTimerRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setFullTranscript("");
    setPartialTranscript("");
    setLastArtifact(null);
  }, []);

  useEffect(() => {
    return () => {
      shouldKeepRollingRef.current = false;
      if (rollingTimerRef.current) window.clearTimeout(rollingTimerRef.current);
      try {
        recorderRef.current?.state === "recording" && recorderRef.current.stop();
      } catch {
        // ignore
      }
      stopStream();
    };
  }, [stopStream]);

  return {
    supported,
    isRecording,
    isLoadingModel,
    isTranscribing,
    modelReady,
    loadProgress,
    fullTranscript,
    setFullTranscript,
    start,
    stop,
    reset,
    prewarm: ensureModel,
    modelInfo,
    partialTranscript,
    lastArtifact,
  };
}
