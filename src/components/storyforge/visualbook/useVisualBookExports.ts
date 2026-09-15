import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { saveAs } from "file-saver";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import type { SlideChapter, Source, StoryConfig } from "../StoryForgeContext";
import { getChapterImages, isRtlBookLanguage } from "../StoryForgeContext";
import { mapWithConcurrencyLimit } from "@/lib/async-utils";
import { requestNarrationAudio, canUseBrowserNarration } from "@/lib/tts-client";
import { fetchBgMusicBlob, decodeBgMusic, bgMusicToDataUri, mixBgMusicIntoOfflineCtx } from "@/lib/bg-music-utils";
import type { PdfStyleConfig } from "./PdfPreviewModal";
import { DEFAULT_PDF_STYLE } from "./PdfPreviewModal";
import { registerAllUsedFonts } from "@/lib/pdf-fonts";
import { resolveDesign, hexToRgb, isDarkBg } from "@/lib/ebook-design";
import { saveLastVideo, loadLastVideo, clearLastVideo } from "@/lib/video-export-cache";
import { beginBusyTask } from "@/lib/busy-registry";
import {
  computeChapterImageRects,
  fitImageCover,
  DEFAULT_IMAGE_GAP,
  type LayoutBox,
} from "@/lib/chapter-image-layout";
import { prepareExportImages } from "@/lib/export-image-utils";
import { getBrandLogoDataUrl, BRAND_NAME, BRAND_URL } from "@/lib/brand-asset";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { assertBookStructureReadyForExport, buildBookStructure, defaultBookStructurePolicy } from "@/lib/book-structure";
import { renderChapterSourceNotes } from "@/lib/chapter-source-notes";

/**
 * Download a Blob as a file using a blob URL.
 * Unlike file-saver's saveAs (which can strip audio from large MP4s in some
 * browsers), this creates a temporary object URL and clicks a hidden anchor.
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Small delay before cleanup so the browser can start the download
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

// ── Module-level cached FFmpeg loader with fallback + retry ─────────
let _ffmpegInstance: any = null;
let _ffmpegLoading: Promise<any> | null = null;

// The installed @ffmpeg/ffmpeg creates a module worker (type:"module"),
// which uses dynamic import() for the core — UMD builds don't work because
// they lack a default ESM export. All sources must use the /esm/ build.
const FFMPEG_SOURCES = [
  {
    label: "primary",
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
    timeout: 90_000,
  },
  {
    label: "cdn-fallback",
    coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
    wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
    timeout: 90_000,
  },
];

async function tryLoadFFmpeg(source: typeof FFMPEG_SOURCES[number], onProgress?: (msg: string) => void) {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  onProgress?.(`Loading video encoder (${source.label})…`);
  console.log(`[VideoExport] Trying FFmpeg source: ${source.label}`);

  try {
    // Module workers can fail to import cross-origin core files directly.
    // Converting remote assets to same-origin blob URLs makes the primary CDN reliable.
    const coreURL = await toBlobURL(source.coreURL, "text/javascript");
    const wasmURL = await toBlobURL(source.wasmURL, "application/wasm");

    const loadPromise = ffmpeg.load({ coreURL, wasmURL });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`FFmpeg load timed out (${source.label})`)), source.timeout)
    );
    await Promise.race([loadPromise, timeout]);
    console.log(`[VideoExport] FFmpeg loaded via ${source.label} ✓`);
    return ffmpeg;
  } catch (err: any) {
    // Attempt to terminate the half-loaded instance to avoid leaks
    try { ffmpeg.terminate(); } catch {}
    throw err;
  }
}

/** Log a heap memory snapshot to console for the debug overlay to pick up via stage changes */
function logHeapSnapshot(label: string) {
  const mem = (performance as any).memory;
  if (!mem) return;
  const used = (mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
  const limit = (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
  const pct = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);
  console.log(`[VideoExport][Heap] ${label}: ${used} MB / ${limit} MB (${pct}%)`);
}

function audioBufferToWavBytes(buffer: AudioBuffer): Uint8Array {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const length = buffer.length * numCh * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, length - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length - 44, true);

  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      off += 2;
    }
  }

  return new Uint8Array(out);
}

async function mergeAudioBlobsToWavBlob(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];

  const decodeContext = new AudioContext({ sampleRate: 44100 });

  try {
    const decodedBuffers: AudioBuffer[] = [];

    for (const blob of blobs) {
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      decodedBuffers.push(decoded);
    }

    const totalDuration = decodedBuffers.reduce((sum, buffer) => sum + buffer.duration, 0);
    const channelCount = Math.max(1, ...decodedBuffers.map((buffer) => buffer.numberOfChannels));
    const offlineContext = new OfflineAudioContext(channelCount, Math.ceil(totalDuration * 44100), 44100);

    let offset = 0;
    for (const buffer of decodedBuffers) {
      const source = offlineContext.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineContext.destination);
      source.start(offset);
      offset += buffer.duration;
    }

    const rendered = await offlineContext.startRendering();
    const wavBytes = audioBufferToWavBytes(rendered);
    const stableWavBytes = new Uint8Array(wavBytes.byteLength);
    stableWavBytes.set(wavBytes);
    return new Blob([stableWavBytes], { type: "audio/wav" });
  } finally {
    await decodeContext.close().catch(() => {});
  }
}

function getAudioInputExtension(blob: Blob): string {
  if (blob.type.includes("wav")) return "wav";
  if (blob.type.includes("webm")) return "webm";
  if (blob.type.includes("ogg")) return "ogg";
  if (blob.type.includes("mpeg") || blob.type.includes("mp3")) return "mp3";
  return "bin";
}

function getFFmpeg(onProgress?: (msg: string) => void): Promise<any> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    return Promise.reject(new Error("MP4/audio transcoding CDN is disabled in sovereign local v0.1. Use PDF/eBook/browser preview for this stage."));
  }
  // Verify cached instance is still usable
  if (_ffmpegInstance) {
    try {
      // Quick sanity check — if the instance was terminated this will throw
      return Promise.resolve(_ffmpegInstance);
    } catch {
      _ffmpegInstance = null;
    }
  }
  if (_ffmpegLoading) return _ffmpegLoading;
  _ffmpegLoading = (async () => {
    let lastError: Error | null = null;
    for (const source of FFMPEG_SOURCES) {
      try {
        const ffmpeg = await tryLoadFFmpeg(source, onProgress);
        _ffmpegInstance = ffmpeg;
        return ffmpeg;
      } catch (err: any) {
        console.warn(`[VideoExport] ${source.label} failed:`, err.message);
        lastError = err;
        onProgress?.(`${source.label} failed, trying next…`);
      }
    }
    throw new Error(`All FFmpeg sources failed. ${lastError?.message ?? "Check your connection and retry."}`);
  })().finally(() => {
    _ffmpegLoading = null;
  }).catch((err) => {
    _ffmpegInstance = null;
    throw err;
  });
  return _ffmpegLoading;
}

// ── Module-level TTS audio cache (persists across renders & exports) ──
const _ttsCache = new Map<string, Blob>();
let _ttsCacheVoiceKey = ""; // tracks which voice settings the cache was built with

// ── Module-level encoded MP4 cache (survives re-mounts; lets the user re-download
//    the last successful encode without re-rendering frames + re-encoding) ──
let _lastVideoExport: { key: string; blob: Blob; filename: string; savedAt: number } | null = null;

function videoExportCacheKey(
  chapters: SlideChapter[],
  quality: string,
  speed: string,
  voiceId: string,
  narrationSpeed: number,
  demeanour: string,
): string {
  // Hash chapters by id + body length + image url so any meaningful change invalidates
  const sig = chapters.map(c => `${c.id}:${(c.body || "").length}:${c.imageUrl || ""}`).join("|");
  return `${quality}|${speed}|${voiceId}|${narrationSpeed}|${demeanour}|${sig}`;
}

function ttsCacheKey(text: string, voiceId: string, speed: number, demeanour: string): string {
  return `${voiceId}|${speed}|${demeanour}|${text.slice(0, 200)}`;
}

function ttsCacheVoiceKey(voiceId: string, speed: number, demeanour: string): string {
  return `${voiceId}|${speed}|${demeanour}`;
}

function isTtsCached(text: string, voiceId: string, speed: number, demeanour: string): boolean {
  return _ttsCache.has(ttsCacheKey(text, voiceId, speed, demeanour));
}

/**
 * Record browser SpeechSynthesis into a WAV Blob via AudioContext + MediaStreamDestination.
 * Falls back when ElevenLabs quota is exhausted.
 */
/** Split text into segments at sentence boundaries, each ≤ maxLen chars */
function splitTextForTts(text: string, maxLen = 500): string[] {
  if (text.length <= maxLen) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let idx = remaining.lastIndexOf(". ", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf("? ", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf("! ", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf("\n", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf(" ", maxLen);
    if (idx < maxLen * 0.2) idx = maxLen;
    segments.push(remaining.slice(0, idx + 1).trim());
    remaining = remaining.slice(idx + 1).trim();
  }
  if (remaining) segments.push(remaining);
  return segments;
}

/** Speak a single segment via SpeechSynthesis. Resolves when done. */
function speakSegment(
  text: string,
  lang: string,
  rate: number,
  segIdx: number,
  totalSegs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (cb: () => void) => { if (!settled) { settled = true; cb(); } };

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.volume = 0.01;

    // Shorter timeout: 15s max (500-char segments should finish in <10s)
    const maxMs = Math.max(8_000, Math.min((text.length / 12) * 1000, 15_000));
    const timer = setTimeout(() => {
      window.speechSynthesis.cancel();
      console.warn(`[TTS] Segment ${segIdx + 1}/${totalSegs} timed out after ${(maxMs / 1000).toFixed(0)}s, skipping`);
      settle(resolve);
    }, maxMs);

    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 8_000);

    utterance.onend = () => { clearInterval(keepAlive); clearTimeout(timer); settle(resolve); };
    utterance.onerror = (e) => {
      clearInterval(keepAlive);
      clearTimeout(timer);
      const code = "error" in e ? (e as any).error : "";
      if (code === "canceled" || code === "interrupted") settle(resolve);
      else settle(() => reject(new Error(code || "Browser speech synthesis failed")));
    };

    window.speechSynthesis.speak(utterance);
  });
}

/** Track how many chapters have been synthesized consecutively */
let _synthChapterCount = 0;

/** Reset the speech synthesis engine to prevent Chrome's internal timeout bug */
function resetSpeechSynthEngine() {
  window.speechSynthesis.cancel();
  _synthChapterCount = 0;
  // Small delay for engine cleanup
  return new Promise<void>(r => setTimeout(r, 200));
}

/**
 * Record browser SpeechSynthesis into a WebM Blob via AudioContext + MediaStreamDestination.
 * Splits long text into ~800-char segments to avoid Chrome's utterance timeout bug.
 */
async function synthesizeBrowserTtsBlob(
  text: string,
  language?: string,
  speed?: number,
  onSegmentProgress?: (current: number, total: number) => void,
): Promise<Blob> {
  if (!canUseBrowserNarration()) {
    throw new Error("Browser narration is not available");
  }

  const segments = splitTextForTts(text, 500);
  const langMap: Record<string, string> = { af: "af-ZA", zu: "zu-ZA", xh: "xh-ZA", st: "st-ZA" };
  const lang = langMap[language || ""] || "en-US";
  const rate = Math.max(0.7, Math.min(1.2, speed ?? 1));

  console.log(`[TTS] Browser synth: ${text.length} chars → ${segments.length} segments`);

  // Reset engine before each chapter to prevent accumulated Chrome hangs
  _synthChapterCount++;
  if (_synthChapterCount % 5 === 0) {
    console.log("[TTS] Resetting speech synthesis engine (every 5 chapters)");
    await resetSpeechSynthEngine();
  }

  const audioCtx = new AudioContext({ sampleRate: 44100 });
  const dest = audioCtx.createMediaStreamDestination();
  const mediaRecorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
  const chunks: Blob[] = [];

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    mediaRecorder.onstop = () => {
      audioCtx.close().catch(() => {});
      if (chunks.length === 0) {
        reject(new Error("Browser narration produced no audio"));
        return;
      }
      resolve(new Blob(chunks, { type: "audio/webm" }));
    };
    mediaRecorder.onerror = () => {
      audioCtx.close().catch(() => {});
      reject(new Error("Browser narration recording failed"));
    };
  });

  const silentOsc = audioCtx.createOscillator();
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  silentOsc.connect(silentGain);
  silentGain.connect(dest);
  silentOsc.start();

  mediaRecorder.start(100);

  window.speechSynthesis.cancel();
  for (let i = 0; i < segments.length; i++) {
    onSegmentProgress?.(i + 1, segments.length);
    await speakSegment(segments[i], lang, rate, i, segments.length);
    await new Promise((r) => setTimeout(r, 50));
  }

  await new Promise((r) => setTimeout(r, 100));

  silentOsc.stop();
  mediaRecorder.stop();

  return recordingDone;
}

// ── Cached auth token (refreshes per export, not per chapter) ──────
let _cachedAuthToken: string | null = null;
let _cachedAuthExpiry = 0;

async function getAuthToken(): Promise<string> {
  if (_cachedAuthToken && Date.now() < _cachedAuthExpiry) return _cachedAuthToken;
  const { data: { session } } = await supabase.auth.getSession();
  _cachedAuthToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  _cachedAuthExpiry = Date.now() + 5 * 60 * 1000; // cache for 5 min
  return _cachedAuthToken;
}

export function useVisualBookExports(
  chapters: SlideChapter[],
  config: StoryConfig,
  referenceImage?: string | null,
  sources: Source[] = [],
) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, stage: "" });
  const [segmentInfo, setSegmentInfo] = useState<{ segment: number; totalSegments: number; chapterTitle: string } | null>(null);
  const [narrationEta, setNarrationEta] = useState<number | null>(null); // seconds remaining
  const narrationStartRef = useRef(0);
  const [exportStep, setExportStep] = useState("");
  const [pendingDownload, setPendingDownload] = useState<{ blob: Blob; filename: string } | null>(null);
  // Last A/V sync drift measurement from a video export — surfaced as a badge on the success card.
  const [lastAvDrift, setLastAvDrift] = useState<{ driftSecs: number; exceeded: boolean } | null>(null);
  const [videoCacheTick, setVideoCacheTick] = useState(0); // bumps to re-render when _lastVideoExport changes
  const cancelledRef = useRef(false);
  const activeFFmpegRef = useRef<any>(null);

  // Hydrate the persisted MP4 from IndexedDB on mount so the
  // "Re-download last video" card survives a full page reload.
  useEffect(() => {
    if (_lastVideoExport) return; // already hydrated this session
    let cancelled = false;
    loadLastVideo().then((entry) => {
      if (cancelled || !entry) return;
      _lastVideoExport = { key: entry.key, blob: entry.blob, filename: entry.filename, savedAt: entry.savedAt };
      setVideoCacheTick((n) => n + 1);
      console.log(`[VideoExport] Hydrated cached MP4 from IndexedDB (${(entry.blob.size / 1024 / 1024).toFixed(1)} MB)`);
    });
    return () => { cancelled = true; };
  }, []);

  const stopExport = useCallback(() => {
    cancelledRef.current = true;
    // Force-terminate FFmpeg if it's running an exec() call
    if (activeFFmpegRef.current) {
      try {
        activeFFmpegRef.current.terminate();
        console.log("[VideoExport] FFmpeg terminated via stop button");
      } catch (e) {
        console.warn("[VideoExport] FFmpeg terminate error:", e);
      }
      activeFFmpegRef.current = null;
      _ffmpegInstance = null; // Reset so next export gets a fresh instance
    }
    setDownloading(false);
    setDownloadProgress({ current: 0, total: 0, stage: "" });
    // Notify user that cached progress is preserved for resume
    if (_ttsCache.size > 0) {
      toast({
        title: "Export stopped — progress saved",
        description: `${_ttsCache.size} chapter${_ttsCache.size !== 1 ? "s" : ""} cached. Click the export button again to resume.`,
      });
    }
  }, [toast]);

  // Hold a screen wake lock + busy flag for the entire duration of any export
  // so mobile browsers don't suspend the tab when the screen turns off.
  useEffect(() => {
    if (!downloading) return;
    const end = beginBusyTask("visual-book-export");
    return () => { end(); };
  }, [downloading]);

  // Preload FFmpeg WASM in the background when hook mounts
  useEffect(() => {
    getFFmpeg().catch(() => { /* silent preload failure is fine */ });
  }, []);

  // Auto-clear narration cache when voice settings change (detects cross-step changes)
  useEffect(() => {
    const currentKey = ttsCacheVoiceKey(
      config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice,
      config.narrationSpeed,
      config.narrationDemeanour
    );
    if (_ttsCache.size > 0 && _ttsCacheVoiceKey && _ttsCacheVoiceKey !== currentKey) {
      _ttsCache.clear();
      _ttsCacheVoiceKey = "";
      toast({ title: "Narration cache cleared", description: "Voice settings changed — audio will be re-fetched on next export." });
    }
  }, [config.narrationVoice, config.narrationSpeed, config.narrationDemeanour]);

  const fetchPremiumNarrationChunks = useCallback(async (text: string, voiceId: string): Promise<Blob[]> => {
    const MAX_CHUNK = 4500;
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > MAX_CHUNK) {
      let splitIdx = remaining.lastIndexOf(". ", MAX_CHUNK);
      if (splitIdx < MAX_CHUNK * 0.5) splitIdx = remaining.lastIndexOf(" ", MAX_CHUNK);
      if (splitIdx < MAX_CHUNK * 0.3) splitIdx = MAX_CHUNK;
      chunks.push(remaining.slice(0, splitIdx + 1).trim());
      remaining = remaining.slice(splitIdx + 1).trim();
    }
    if (remaining) chunks.push(remaining);

    return mapWithConcurrencyLimit(chunks, 5, async (chunk) => {
      const result = await requestNarrationAudio({
        text: chunk,
        voiceId,
        language: config.bookLanguage !== "en" ? config.bookLanguage : undefined,
        speed: config.narrationSpeed,
        demeanour: config.narrationDemeanour,
      });

      if (result.kind === "fallback") {
        throw new Error("FALLBACK_TO_BROWSER");
      }

      return result.blob;
    });
  }, [config.bookLanguage, config.narrationSpeed, config.narrationDemeanour]);

  const fetchAudioForChapter = useCallback(async (
    text: string,
    onSegmentProgress?: (current: number, total: number) => void,
  ): Promise<Blob> => {
    // Skip empty or trivially short text
    const trimmed = text.trim();
    if (trimmed.length < 10) {
      return new Blob([], { type: "audio/webm" });
    }

    const voiceId = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
    const fullCacheKey = ttsCacheKey(trimmed, voiceId, config.narrationSpeed, config.narrationDemeanour);

    const cached = _ttsCache.get(fullCacheKey);
    if (cached) return cached;

    const useBrowser = config.narrationProvider === "browser";

    // Browser speech synthesis (default / free)
    if (useBrowser && canUseBrowserNarration()) {
      console.log("[TTS] Using browser speech synthesis (free mode)");
      const browserBlob = await synthesizeBrowserTtsBlob(
        trimmed.slice(0, 5000),
        config.bookLanguage !== "en" ? config.bookLanguage : undefined,
        config.narrationSpeed,
        onSegmentProgress,
      );
      _ttsCache.set(fullCacheKey, browserBlob);
      _ttsCacheVoiceKey = ttsCacheVoiceKey(voiceId, config.narrationSpeed, config.narrationDemeanour);
      return browserBlob;
    }

    // ElevenLabs premium narration — with browser fallback on quota errors
    try {
      const audioBlobs = await fetchPremiumNarrationChunks(trimmed, voiceId);
      const blob = audioBlobs.length === 1 ? audioBlobs[0] : await mergeAudioBlobsToWavBlob(audioBlobs);
      _ttsCache.set(fullCacheKey, blob);
      _ttsCacheVoiceKey = ttsCacheVoiceKey(voiceId, config.narrationSpeed, config.narrationDemeanour);
      return blob;
    } catch (err: any) {
      const isQuotaOrFallback =
        err.message === "FALLBACK_TO_BROWSER" ||
        err.message?.includes("quota_exceeded") ||
        err.message?.includes("credits remaining") ||
        err.message?.includes("credits are exhausted");

      if (isQuotaOrFallback && canUseBrowserNarration()) {
        // IMPORTANT: We previously called synthesizeBrowserTtsBlob() here, but
        // browsers route SpeechSynthesis output to the system audio sink — it
        // never feeds into MediaStreamDestination — so MediaRecorder captures
        // only the silent oscillator. That produced ~silent WebM blobs that
        // got embedded into the exported eBook (looked like audio, played
        // nothing). Instead, return an empty Blob so the eBook exporter
        // skips the <audio> tag for this chapter and the player falls back
        // to live in-browser speechSynthesis on playback (which DOES work).
        console.log("[TTS] ElevenLabs unavailable — chapter will use live browser narration in exported HTML");
        return new Blob([], { type: "audio/webm" });
      }

      throw err;
    }
  }, [config.narrationVoice, config.narrationSpeed, config.narrationDemeanour, config.narrationProvider, config.bookLanguage, fetchPremiumNarrationChunks]);

  const fetchNarrationBatch = useCallback(async (items: SlideChapter[]): Promise<(Blob | null)[]> => {
    const total = items.length;
    const voiceId = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
    const cachedCount = items.filter((ch) => isTtsCached(ch.body.slice(0, 5000), voiceId, config.narrationSpeed, config.narrationDemeanour)).length;
    const fetchingCount = total - cachedCount;
    let completed = 0;

    narrationStartRef.current = performance.now();
    setNarrationEta(null);

    setDownloadProgress({
      current: 0,
      total,
      stage: cachedCount === total ? `Narration: ${cachedCount} cached ✓` : `Narration: ${cachedCount} cached, ${fetchingCount} queued…`,
    });

    // Pre-warm auth token once before batch to avoid per-chapter auth lookups
    await getAuthToken();

    const isBrowser = config.narrationProvider === "browser";
    const BATCH_LIMIT = 10; // auto-pause every N chapters for browser TTS engine reset
    const results: (Blob | null)[] = new Array(total).fill(null);

    // Process chapters sequentially for browser TTS (single-threaded),
    // or with concurrency 5 for ElevenLabs
    if (!isBrowser) {
      const mapped = await mapWithConcurrencyLimit(items, 5, async (chapter, idx) => {
        if (cancelledRef.current) return null;
        if (!chapter.body || chapter.body.trim().length < 10) {
          completed += 1;
          console.log(`[TTS] Ch ${idx + 1}/${total} "${chapter.title}" — skipped (too short)`);
          setDownloadProgress({ current: completed, total, stage: `Narration: ${completed}/${total} processed…` });
          return null;
        }
        return processOneChapter(chapter, idx);
      });
      mapped.forEach((b, i) => { results[i] = b; });
    } else {
      // Browser TTS: process in batches of BATCH_LIMIT, auto-pausing between
      for (let batchStart = 0; batchStart < total; batchStart += BATCH_LIMIT) {
        if (cancelledRef.current) break;

        const batchEnd = Math.min(batchStart + BATCH_LIMIT, total);
        const batchNum = Math.floor(batchStart / BATCH_LIMIT) + 1;
        const totalBatches = Math.ceil(total / BATCH_LIMIT);

        if (batchStart > 0) {
          // Reset the synth engine between batches to prevent Chrome hangs
          console.log(`[TTS] Batch ${batchNum}/${totalBatches}: Resetting speech engine before next ${batchEnd - batchStart} chapters…`);
          setDownloadProgress({ current: completed, total, stage: `Resetting speech engine (batch ${batchNum}/${totalBatches})…` });
          window.speechSynthesis.cancel();
          _synthChapterCount = 0;
          // Give Chrome time to fully release the synth engine
          await new Promise(r => setTimeout(r, 1000));
        }

        for (let idx = batchStart; idx < batchEnd; idx++) {
          if (cancelledRef.current) break;
          const chapter = items[idx];
          if (!chapter.body || chapter.body.trim().length < 10) {
            completed += 1;
            console.log(`[TTS] Ch ${idx + 1}/${total} "${chapter.title}" — skipped (too short)`);
            setDownloadProgress({ current: completed, total, stage: `Narration: ${completed}/${total} processed…` });
            continue;
          }
          results[idx] = await processOneChapter(chapter, idx);
        }

        if (batchEnd < total && !cancelledRef.current) {
          console.log(`[TTS] Batch ${batchNum}/${totalBatches} complete — ${completed}/${total} chapters done`);
        }
      }
    }

    return results;

    async function processOneChapter(chapter: SlideChapter, idx: number): Promise<Blob | null> {
      const chLabel = `Ch ${idx + 1}/${total} "${chapter.title}"`;
      const startTime = performance.now();
      console.log(`[TTS] ${chLabel} — starting (${chapter.body.trim().length} chars)`);
      try {
        const blob = await fetchAudioForChapter(chapter.body, (seg, totalSegs) => {
          setSegmentInfo({ segment: seg, totalSegments: totalSegs, chapterTitle: chapter.title });
        });
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        console.log(`[TTS] ${chLabel} — done in ${elapsed}s (${blob?.size ?? 0} bytes)`);
        setSegmentInfo(null);
        return blob;
      } catch (err: any) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        console.error(`[TTS] ${chLabel} — FAILED after ${elapsed}s:`, err?.message);
        return null;
      } finally {
        completed += 1;
        const elapsedMs = performance.now() - narrationStartRef.current;
        const avgMs = elapsedMs / completed;
        const remaining = total - completed;
        const etaSec = remaining > 0 ? Math.round((avgMs * remaining) / 1000) : 0;
        setNarrationEta(remaining > 0 ? etaSec : null);
        setDownloadProgress({
          current: completed,
          total,
          stage: cancelledRef.current ? "Stopping…" : `Narration: ${completed}/${total} processed…`,
        });
      }
    }
  }, [config.narrationVoice, config.narrationSpeed, config.narrationDemeanour, config.narrationProvider, fetchAudioForChapter]);

  const blobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const safeName = useCallback(() => {
    return config.topic.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-") || "ebook";
  }, [config.topic]);

  // ── HTML eBook ────────────────────────────────────────────────────────
  const downloadAsEbook = useCallback(async () => {
    cancelledRef.current = false;
    setDownloading(true);
    const total = chapters.length;
    const useBrowserTts = config.narrationProvider === "browser";
    const _outerChapters = chapters;
    const _outerRef = referenceImage;

    try {
      // Refresh signed URLs and inline images as data URIs so the exported
      // HTML keeps working after the 1h chapter-images signed-URL TTL.
      // Shadows the outer `chapters` / `referenceImage` for the rest of this scope.
      const { chapters, referenceImage } = await prepareExportImages(
        _outerChapters, _outerRef,
        { embedAsDataUri: true, uiAction: "exportEbookHtml" }
      );
      // Reset synth engine counter for fresh export
      _synthChapterCount = 0;

      // Fetch background music (if selected)
      let bgMusicDataUri = "";
      if (config.bgMusicTrackId && config.bgMusicTrackId !== "none") {
        setDownloadProgress({ current: 0, total, stage: "Loading background music…" });
        const bgBlob = await fetchBgMusicBlob(config.bgMusicTrackId);
        if (bgBlob) {
          bgMusicDataUri = await bgMusicToDataUri(bgBlob);
        }
      }

      // For browser TTS: skip broken pre-recording, use live speechSynthesis in exported HTML.
      // For ElevenLabs: pre-record audio and embed as data URIs (works offline).
      let audioDataUris: string[] = [];

      if (!useBrowserTts) {
        // Phase 1: Fetch narration audio (ElevenLabs)
        const audioResults = await fetchNarrationBatch(chapters);
        if (cancelledRef.current) throw new Error("Export cancelled");

        // Phase 2: Convert audio blobs → data URIs
        setDownloadProgress({ current: 0, total, stage: "Encoding assets…" });
        audioDataUris = await Promise.all(
          audioResults.map(async (blob) => {
            if (!blob || blob.size === 0) return "";
            try { return await blobToBase64(blob); } catch { return ""; }
          })
        );
      } else {
        setDownloadProgress({ current: 0, total, stage: "Building eBook (live narration)…" });
      }

      if (cancelledRef.current) throw new Error("Export cancelled");

      const chapterData = chapters.map((ch, i) => ({
        imgDataUri: ch.imageUrl || "",
        audioDataUri: audioDataUris[i] || "",
        title: ch.title,
        body: ch.body,
        references: ch.references || [],
        // Phase B: forward the multi-image gallery so the HTML reader renders the chosen layout.
        images: getChapterImages(ch),
        imageLayout: ch.imageLayout || "stack",
      }));

      // Prefer reference image as cover, fall back to first chapter image
      const coverImage = referenceImage || chapterData.find((ch) => ch.imgDataUri)?.imgDataUri || "";

      setDownloadProgress({ current: total, total, stage: "Building eBook…" });

      const design = resolveDesign(config);
      const dark = isDarkBg(design.bg);
      const coverGradA = dark ? "rgba(10,10,26,0)" : "rgba(255,255,255,0)";
      const coverGradB = dark ? "rgba(10,10,26,0.6)" : "rgba(255,255,255,0.6)";
      const coverGradC = dark ? "rgba(10,10,26,0.95)" : "rgba(255,255,255,0.95)";
      const controlsBg = dark ? "rgba(26,26,46,0.95)" : "rgba(255,255,255,0.95)";
      const btnBorder = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
      const btnHoverBg = dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";
      const dotInactive = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";

      // Build chapter layout based on design.layout
      const chapterImgClass = design.layout === "full-bleed" ? "chapter-img full-bleed" : design.layout === "side-by-side" ? "chapter-img side" : "chapter-img";
      const imgGap = config.imageGap ?? DEFAULT_IMAGE_GAP;
      const imgFit = config.imageFit ?? "cover";
      const carouselAutoplay = config.carouselAutoplay === true;
      const carouselAutoplayMs = Math.max(1, Math.min(15, config.carouselAutoplaySec ?? 4)) * 1000;
      const carouselReverse = config.carouselAutoplayReverse === true;
      const carouselIndicator = config.carouselAutoplayIndicator === "bar" ? "bar" : "ring";
      const isRtl = isRtlBookLanguage(config.bookLanguage);

      /** Phase B: render a chapter's image set as a layout-aware wrapper.
       *  Falls back to a single img tag for back-compat. */
      const renderChapterImages = (
        ch: typeof chapterData[number],
        i: number,
        wrapperClass: string,
      ): string => {
        const imgs = ch.images.filter((im) => im.url);
        if (imgs.length === 0) return "";
        const altBase = escapeHtml(ch.title);
        if (imgs.length === 1) {
          return `<img class="${wrapperClass}" src="${imgs[0].url}" alt="${altBase}" loading="lazy" style="object-fit:${imgFit}">`;
        }
        const layout = ch.imageLayout;
        // CSS grid templates per layout. Match-height side-by-side guaranteed by the wrapper height.
        let style = "";
        let inner = "";
        if (layout === "carousel") {
          // Self-contained carousel: track of slides + prev/next + dots, no external JS needed.
          const cid = `car-${i}-${Math.random().toString(36).slice(2, 8)}`;
          const slides = imgs.map((im, k) =>
            `<img src="${im.url}" alt="${altBase} ${k + 1}" loading="lazy" data-idx="${k}" style="flex:0 0 100%;width:100%;height:100%;object-fit:${imgFit};display:block">`
          ).join("");
          // Each dot is wrapped in a button that hosts an SVG progress ring overlay
          // (only animates on the active dot when autoplay is on + reduced-motion not set).
          const dots = imgs.map((_, k) =>
            `<button type="button" data-go="${k}" aria-label="Go to image ${k + 1}" style="position:relative;width:14px;height:14px;border-radius:50%;border:none;padding:0;cursor:pointer;background:transparent;display:inline-flex;align-items:center;justify-content:center">
              <span data-dot style="display:block;width:6px;height:6px;border-radius:50%;background:${k === 0 ? "currentColor" : "rgba(127,127,127,.4)"};opacity:${k === 0 ? "1" : ".6"}"></span>
              <svg data-ring viewBox="0 0 14 14" aria-hidden="true" style="position:absolute;inset:0;transform:rotate(-90deg);pointer-events:none;display:${k === 0 ? "block" : "none"}">
                <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"></circle>
                <circle data-ring-fill cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"></circle>
              </svg>
            </button>`
          ).join("");
          const arrowBtn = (dir: "prev" | "next", glyph: string) =>
            `<button type="button" data-${dir} aria-label="${dir === "prev" ? "Previous" : "Next"} image" style="position:absolute;top:50%;${dir === "prev" ? "left" : "right"}:8px;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2">${glyph}</button>`;
          const keyframes = `@keyframes carRingFill_${cid.replace(/-/g, "_")}{from{stroke-dashoffset:1}to{stroke-dashoffset:0}} @keyframes carBarFill_${cid.replace(/-/g, "_")}{from{transform:scaleX(0)}to{transform:scaleX(1)}}`;
          const animName = `carRingFill_${cid.replace(/-/g, "_")}`;
          const barAnimName = `carBarFill_${cid.replace(/-/g, "_")}`;
          const useBar = carouselAutoplay && carouselIndicator === "bar";
          const useRing = carouselAutoplay && carouselIndicator === "ring";
          const ringJs = useRing
            ? `function paintRing(){dots.forEach(function(d,k){var ring=d.querySelector('[data-ring]');var fill=d.querySelector('[data-ring-fill]');if(!ring||!fill)return;if(k===cur&&!rm){ring.style.display='block';fill.style.animation='none';void fill.getBoundingClientRect();fill.style.animation='${animName} ${carouselAutoplayMs}ms linear forwards'}else{ring.style.display='none';fill.style.animation='none';fill.style.strokeDashoffset='1'}})}`
            : `function paintRing(){}`;
          const barJs = useBar
            ? `function paintBar(){var bar=r.querySelector('[data-bar-fill]');if(!bar||rm)return;bar.style.animation='none';void bar.getBoundingClientRect();bar.style.animation='${barAnimName} ${carouselAutoplayMs}ms linear forwards'}function clearBar(){var bar=r.querySelector('[data-bar-fill]');if(bar){bar.style.animation='none';bar.style.transform='scaleX(0)'}}`
            : `function paintBar(){}function clearBar(){}`;
          // Autoplay toggles the 'auto' badge visibility alongside start/stop so
          // readers see at a glance that the carousel is advancing on its own.
          const autoplaySnippet = carouselAutoplay
            ? `var iv=null;var b=r.querySelector('[data-auto-badge]');function showBadge(){if(b)b.style.opacity='1'}function hideBadge(){if(b)b.style.opacity='0'}function start(){stop();if(rm)return;iv=setInterval(function(){go(cur${carouselReverse ? "-1" : "+1"})},${carouselAutoplayMs});showBadge();paintBar()}function stop(){if(iv){clearInterval(iv);iv=null}hideBadge();clearBar()}r.addEventListener('mouseenter',stop);r.addEventListener('mouseleave',start);r.addEventListener('focusin',stop);r.addEventListener('focusout',start);start();paintRing();`
            : ``;
          // In RTL mode, the flex track lays out right-to-left, so the offset
          // sign flips. Touch swipes also reverse: swiping left in RTL means "previous".
          const trackSign = isRtl ? "" : "-";
          const swipeSign = isRtl ? "(dx<0?-1:1)" : "(dx<0?1:-1)";
          // Badge sits at the trailing edge of the reading direction (top-right
          // in LTR, top-left in RTL) using a logical inline-end offset.
          const autoBadge = carouselAutoplay
            ? `<span data-auto-badge aria-hidden="true" style="position:absolute;top:8px;inset-inline-end:8px;z-index:3;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;opacity:0;transition:opacity .2s ease;pointer-events:none">auto</span>`
            : ``;
          // Keyboard nav: ArrowLeft/Right move slides (mirrored in RTL so the
          // arrow that points "back" in the reading direction goes to prev),
          // Space toggles autoplay when it's enabled (preventDefault stops page scroll).
          const keyPrev = isRtl ? "ArrowRight" : "ArrowLeft";
          const keyNext = isRtl ? "ArrowLeft" : "ArrowRight";
          const spaceToggleJs = carouselAutoplay
            ? `else if(e.key===' '||e.code==='Space'){e.preventDefault();if(iv){stop()}else{start()}}`
            : ``;
          const keyJs = `r.addEventListener('keydown',function(e){if(e.key==='${keyPrev}'){e.preventDefault();go(cur-1);if(typeof start==='function'){start()}}else if(e.key==='${keyNext}'){e.preventDefault();go(cur+1);if(typeof start==='function'){start()}}${spaceToggleJs}});`;
          const initJs = `(function(){var r=document.getElementById('${cid}');if(!r||r.dataset.init)return;r.dataset.init='1';var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;var t=r.querySelector('[data-track]');var imgs=t.querySelectorAll('img');var dots=r.querySelectorAll('[data-go]');var n=imgs.length,cur=0;${ringJs}${barJs}function go(i){cur=(i+n)%n;t.style.transform='translateX('+(${trackSign}cur*100)+'%)';dots.forEach(function(d,k){var s=d.querySelector('[data-dot]');if(s){s.style.background=k===cur?'currentColor':'rgba(127,127,127,.4)';s.style.opacity=k===cur?'1':'.6'}});paintRing();paintBar()}r.querySelector('[data-prev]').addEventListener('click',function(e){e.stopPropagation();go(cur-1);if(typeof start==='function'){start()}});r.querySelector('[data-next]').addEventListener('click',function(e){e.stopPropagation();go(cur+1);if(typeof start==='function'){start()}});dots.forEach(function(d){d.addEventListener('click',function(e){e.stopPropagation();go(parseInt(d.dataset.go,10));if(typeof start==='function'){start()}})});var sx=null;r.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});r.addEventListener('touchend',function(e){if(sx==null)return;var dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>40){go(cur+${swipeSign});if(typeof start==='function'){start()}}sx=null});${keyJs}${autoplaySnippet}})();`;
          // Help affordance: small "?" button at the top-leading edge with a
          // CSS-only tooltip that appears on hover/focus of the carousel or button.
          const tipLines = carouselAutoplay
            ? `<div>← / → : prev / next${isRtl ? " (mirrored, RTL)" : ""}</div><div>Space : toggle autoplay</div>`
            : `<div>← / → : prev / next${isRtl ? " (mirrored, RTL)" : ""}</div>`;
          const helpStyles = `#${cid} [data-help-tip]{position:absolute;top:32px;inset-inline-start:8px;z-index:4;background:rgba(0,0,0,.85);color:#fff;font-size:11px;line-height:1.45;padding:6px 8px;border-radius:4px;white-space:nowrap;opacity:0;transform:translateY(-4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}#${cid}:hover [data-help-tip],#${cid}:focus-within [data-help-tip]{opacity:1;transform:translateY(0)}#${cid} [data-help-btn]{position:absolute;top:8px;inset-inline-start:8px;z-index:4;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,.55);color:#fff;font-size:12px;font-weight:600;line-height:1;cursor:help;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit}#${cid} [data-help-btn]:focus-visible{outline:2px solid currentColor;outline-offset:1px}`;
          const helpHtml = `<button type="button" data-help-btn aria-label="Keyboard shortcuts">?</button><div data-help-tip role="tooltip">${tipLines}</div>`;
          // Bottom progress bar (alternative to dot ring). Sits on the bottom edge,
          // 2px tall, scaled from leading edge over carouselAutoplaySec.
          const barOriginCss = isRtl ? "right" : "left";
          const barHtml = useBar
            ? `<div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(127,127,127,.25);z-index:3;pointer-events:none"><div data-bar-fill style="height:100%;width:100%;background:currentColor;transform:scaleX(0);transform-origin:${barOriginCss} center"></div></div>`
            : ``;
          const hideRingsCss = useBar ? `#${cid} [data-ring]{display:none!important}` : ``;
          return `<div class="${wrapperClass} multi-img" id="${cid}"${isRtl ? ` dir="rtl"` : ""} tabindex="0" role="region" aria-roledescription="carousel" aria-label="Image carousel${carouselAutoplay ? " (Arrow keys navigate, Space toggles autoplay)" : " (Arrow keys navigate)"}" style="position:relative;overflow:hidden;outline:none">
            <style>${keyframes} #${cid}:focus-visible{box-shadow:0 0 0 2px currentColor inset} ${helpStyles} ${hideRingsCss}</style>
            <div data-track style="display:flex;width:100%;height:100%;transition:transform .35s ease">${slides}</div>
            ${arrowBtn("prev", isRtl ? "›" : "‹")}
            ${arrowBtn("next", isRtl ? "‹" : "›")}
            <div style="position:absolute;bottom:8px;left:0;right:0;display:flex;gap:8px;justify-content:center;align-items:center;z-index:2">${dots}</div>
            ${barHtml}
            ${autoBadge}
            ${helpHtml}
            <script>${initJs}<\/script>
          </div>`;
        } else if (layout === "hero") {
          const restCount = imgs.length - 1;
          inner = `
            <div style="grid-area:hero;overflow:hidden"><img src="${imgs[0].url}" alt="${altBase}" loading="lazy" style="width:100%;height:100%;object-fit:${imgFit}"></div>
            ${imgs.slice(1).map((im, k) => `<div style="overflow:hidden"><img src="${im.url}" alt="${altBase} ${k + 2}" loading="lazy" style="width:100%;height:100%;object-fit:${imgFit}"></div>`).join("")}
          `;
          style = `display:grid;grid-template-areas:'hero hero hero' 'b1 ${restCount > 1 ? "b2" : "b1"} ${restCount > 2 ? "b3" : "b1"}';grid-template-rows:7fr 3fr;grid-template-columns:repeat(${restCount},1fr);gap:${imgGap}px;`;
        } else if (layout === "stack") {
          inner = imgs.map((im, k) => `<div style="overflow:hidden"><img src="${im.url}" alt="${altBase} ${k + 1}" loading="lazy" style="width:100%;height:100%;object-fit:${imgFit}"></div>`).join("");
          style = `display:grid;grid-template-rows:repeat(${imgs.length},1fr);gap:${imgGap}px;`;
        } else {
          // grid: 2 → 1 row, 3-4 → 2x2
          const cols = 2;
          const rows = imgs.length <= 2 ? 1 : 2;
          inner = imgs.map((im, k) => `<div style="overflow:hidden"><img src="${im.url}" alt="${altBase} ${k + 1}" loading="lazy" style="width:100%;height:100%;object-fit:${imgFit}"></div>`).join("");
          style = `display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:${imgGap}px;`;
        }
        return `<div class="${wrapperClass} multi-img" style="${style}">${inner}</div>`;
      };

      // Per-chapter narration: prefer embedded audio when we have real bytes,
      // otherwise the player falls back to live speechSynthesis using data-body.
      // We always include data-body so the fallback is available even when
      // the primary path (ElevenLabs) silently fails on a single chapter.
      let liveSpeechChaptersCount = 0;
      const chaptersHtml = chapterData.map((ch, i) => {
        const imgTag = renderChapterImages(ch, i, chapterImgClass);
        const hasRealAudio = !useBrowserTts && !!ch.audioDataUri;
        if (!hasRealAudio) liveSpeechChaptersCount++;
        const audioTag = hasRealAudio ? `<audio id="audio${i}" preload="none" src="${ch.audioDataUri}"></audio>` : "";
        const bodyAttr = ` data-body="${escapeHtml(ch.body).replace(/\n/g, " ")}"`;
        const bodyHtml = `<div class="chapter-body">${escapeHtml(ch.body).replace(/\n/g, "<br>")}</div>`;
        const sourceNotes = renderChapterSourceNotes(ch.references);
        const hasImages = ch.images.length > 0;

        if (design.layout === "side-by-side" && hasImages) {
          return `<div class="chapter layout-side" id="ch${i}" ${i > 0 ? 'style="display:none"' : ''}${bodyAttr}>
            <div class="side-grid">${imgTag}<div class="side-text"><p class="ch-num">Chapter ${i + 1} of ${total}</p><h2>${escapeHtml(ch.title)}</h2>${bodyHtml}${sourceNotes}</div></div>${audioTag}
          </div>`;
        }
        if (design.layout === "overlay" && hasImages) {
          return `<div class="chapter layout-overlay" id="ch${i}" ${i > 0 ? 'style="display:none"' : ''}${bodyAttr}>
            <div class="overlay-wrap">${imgTag}<div class="overlay-content"><p class="ch-num">Chapter ${i + 1} of ${total}</p><h2>${escapeHtml(ch.title)}</h2>${bodyHtml}</div></div>${sourceNotes}${audioTag}
          </div>`;
        }
        return `<div class="chapter" id="ch${i}" ${i > 0 ? 'style="display:none"' : ''}${bodyAttr}>
          ${imgTag}<p class="ch-num">Chapter ${i + 1} of ${total}</p><h2>${escapeHtml(ch.title)}</h2>${bodyHtml}${sourceNotes}${audioTag}
        </div>`;
      }).join("\n");

      const speechLang = (() => {
        const m: Record<string, string> = { af: "af-ZA", zu: "zu-ZA", xh: "xh-ZA", st: "st-ZA" };
        return config.bookLanguage && config.bookLanguage !== "en" ? (m[config.bookLanguage] || "en-US") : "en-US";
      })();

      // Hybrid narration: per-chapter, prefer embedded <audio>; otherwise use
      // SpeechSynthesisUtterance from data-body. Auto-advances either way.
      const narrationScript = `
var synth=window.speechSynthesis||null,currentUtterance=null;
function getAudio(){return document.getElementById('audio'+cur)}
function getBody(){var ch=document.getElementById('ch'+cur);return ch?(ch.getAttribute('data-body')||(ch.querySelector('.chapter-body')?ch.querySelector('.chapter-body').textContent:'')):''}
function setPlayIcon(p){var b=document.getElementById('playBtn');if(b)b.innerHTML=p?'&#9646;&#9646;':'&#9654;'}
function playLive(){
  if(!synth){alert('No narration audio for this chapter, and this browser does not support live speech synthesis.');return}
  var text=getBody().trim();if(!text)return;
  try{synth.cancel()}catch(_){}
  currentUtterance=new SpeechSynthesisUtterance(text);
  currentUtterance.lang='${speechLang}';
  currentUtterance.rate=Math.max(0.5,Math.min(2,speed));
  currentUtterance.onend=function(){playing=false;setPlayIcon(false);if(cur<total-1){cur++;show(cur);toggleAudio()}};
  currentUtterance.onerror=function(){playing=false;setPlayIcon(false)};
  synth.speak(currentUtterance);
  playing=true;setPlayIcon(true);
}
function playRecorded(a){
  a.playbackRate=Math.max(0.5,Math.min(2,speed));
  var p=a.play();if(p&&p.catch){p.catch(function(){})}
  playing=true;setPlayIcon(true);
  a.onended=function(){playing=false;setPlayIcon(false);if(cur<total-1){cur++;show(cur);toggleAudio()}};
}
function toggleAudio(){
  if(playing){
    var a=getAudio();if(a){a.pause()}
    if(synth){try{synth.cancel()}catch(_){}}
    playing=false;setPlayIcon(false);return;
  }
  var a=getAudio();
  if(a&&a.src){playRecorded(a)}else{playLive()}
}
function stopAudio(){
  document.querySelectorAll('audio').forEach(function(a){if(a.id&&a.id.indexOf('audio')===0){a.pause();a.currentTime=0}});
  if(synth){try{synth.cancel()}catch(_){}}
  playing=false;setPlayIcon(false);
}
var speaking=false; // legacy flag kept for backwards-compat with patcher below
`;


      const brandLogoDataUrl = await getBrandLogoDataUrl();
      const brandMark = brandLogoDataUrl
        ? `<img src="${brandLogoDataUrl}" alt="${BRAND_NAME}" style="height:28px;width:auto;display:block;margin:0 auto 12px;opacity:.95">`
        : "";
      const brandFooter = `<div class="brand-footer"><a href="${BRAND_URL}" target="_blank" rel="noopener">${brandLogoDataUrl ? `<img src="${brandLogoDataUrl}" alt="" style="height:16px;width:auto;vertical-align:middle;margin-right:6px">` : ""}Created with ${BRAND_NAME}</a></div>`;

      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.topic)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${design.fontFamily};background:${design.bg};color:${design.text};min-height:100vh;display:flex;flex-direction:column}
.cover{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px 20px;background:${design.chapterBg};overflow:hidden}
.cover-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.35;filter:blur(2px)}
.cover-content{position:relative;z-index:1}
.cover h1{font-size:clamp(2em,5vw,3.5em);margin-bottom:0.3em;color:${design.accent};text-shadow:0 2px 40px ${design.accent}33}
.cover .subtitle{color:${design.text}99;font-size:1.1em;margin-bottom:2em}
.cover button{background:${design.accent};color:${isDarkBg(design.accent) ? "#fff" : "#1a1a2e"};border:none;padding:14px 40px;font-size:1.1em;border-radius:30px;cursor:pointer;font-family:inherit;font-weight:bold;transition:transform 0.2s}
.cover button:hover{transform:scale(1.05)}
.reader{display:none;flex:1;flex-direction:column}
.reader.active{display:flex}
.content{flex:1;max-width:800px;margin:0 auto;padding:40px 24px;width:100%}
.chapter-img{width:100%;max-height:450px;object-fit:cover;border-radius:12px;margin-bottom:24px;box-shadow:0 8px 32px ${dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.12)"}}
.chapter-img.full-bleed{max-height:none;border-radius:0;margin:0 -24px 24px;width:calc(100% + 48px)}
.chapter-img.multi-img{height:450px;max-height:450px;width:100%;border-radius:12px;overflow:hidden;margin-bottom:24px;box-shadow:0 8px 32px ${dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.12)"}}
.chapter-img.multi-img.full-bleed{height:60vh;max-height:none;border-radius:0;margin:0 -24px 24px;width:calc(100% + 48px)}
.chapter-img.multi-img.side{height:100%;min-height:320px;margin:0;border-radius:12px}
.layout-side .side-grid{align-items:stretch}
.ch-num{color:${design.text}88;font-size:0.8em;text-transform:uppercase;letter-spacing:3px;margin-bottom:8px}
.chapter h2{font-size:1.8em;margin-bottom:16px;color:${design.accent}}
.chapter-body{line-height:2;font-size:1.05em;color:${design.text}cc}
.source-notes{margin-top:28px;padding-top:18px;border-top:1px solid ${btnBorder};font-size:.82em;color:${design.text}99}
.source-notes h3{margin-bottom:6px;color:${design.text};font-size:1em}
.source-notes p{margin-bottom:8px;line-height:1.5}
.source-notes ol{padding-left:20px;display:grid;gap:6px}
.source-notes a{color:${design.accent};overflow-wrap:anywhere}
.layout-side .side-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.layout-side .chapter-img.side{width:100%;max-height:none;border-radius:12px;margin:0}
.layout-overlay .overlay-wrap{position:relative}
.layout-overlay .overlay-wrap .chapter-img{width:100%;max-height:500px;object-fit:cover;border-radius:12px;filter:brightness(0.45)}
.layout-overlay .overlay-content{position:absolute;bottom:0;left:0;right:0;padding:32px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5)}
.layout-overlay .overlay-content h2{color:#fff}
.layout-overlay .overlay-content .chapter-body{color:rgba(255,255,255,0.9)}
.controls{position:sticky;bottom:0;background:${controlsBg};backdrop-filter:blur(12px);border-top:1px solid ${btnBorder};padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
.controls button{background:none;border:1px solid ${btnBorder};color:${design.text};width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:1.1em;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.controls button:hover{background:${btnHoverBg};border-color:${design.text}44}
.controls button:disabled{opacity:0.3;cursor:not-allowed}
.controls button.play-btn{width:48px;height:48px;background:${design.accent};border:none;color:${isDarkBg(design.accent) ? "#fff" : "#1a1a2e"};font-size:1.2em}
.controls button.play-btn:hover{transform:scale(1.08)}
.page-info{color:${design.text}88;font-size:0.85em;min-width:80px;text-align:center}
.toc{display:flex;gap:6px;align-items:center}
.toc .dot{width:8px;height:8px;border-radius:50%;background:${dotInactive};cursor:pointer;transition:all 0.2s}
.toc .dot.active{background:${design.accent};width:16px;border-radius:4px}
.speed-ctrl{display:flex;align-items:center;gap:6px;color:${design.text}88;font-size:0.8em}
.speed-ctrl input[type=range]{width:70px;accent-color:${design.accent}}
.speed-ctrl span{min-width:32px;text-align:center;color:${design.text};font-weight:bold}
.brand-footer{padding:18px 12px;text-align:center;font-size:.78em;color:${design.text}88;border-top:1px solid ${btnBorder}}
.brand-footer a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.brand-footer a:hover{color:${design.accent}}
<\/style>
</head>
<body>
<div class="cover" id="coverPage">
  ${coverImage ? `<img class="cover-bg" src="${coverImage}" alt="Cover">` : ""}
  <div class="cover-content">
    ${brandMark}
    <h1>${escapeHtml(config.topic)}</h1>
    <p class="subtitle">A ${escapeHtml(config.tone)} ${escapeHtml(config.theme)} eBook</p>
    <button onclick="startReading()">Start Reading</button>
  </div>
</div>

<div class="reader" id="readerView">
  <div class="content">
    ${chaptersHtml}
  </div>
  <div class="controls">
    <button onclick="prevCh()" id="prevBtn" title="Previous">&#9664;</button>
    <button onclick="toggleAudio()" id="playBtn" class="play-btn" title="Play narration">&#9654;</button>
    <button onclick="nextCh()" id="nextBtn" title="Next">&#9654;</button>
    <span class="page-info" id="pageInfo">1 / ${total}</span>
    <div class="speed-ctrl">
      <span>&#9201;</span>
      <input type="range" id="speedSlider" min="0.5" max="2" step="0.1" value="${config.narrationSpeed}" oninput="setSpeed(this.value)" title="Playback speed">
      <span id="speedLabel">${config.narrationSpeed.toFixed(1)}x</span>
    </div>
    <div class="toc" id="tocDots"></div>
  </div>
${bgMusicDataUri ? `<audio id="bgMusic" src="${bgMusicDataUri}" loop preload="auto"></audio>` : ""}
${brandFooter}

<script>
let cur=0,total=${total},playing=false,speed=${config.narrationSpeed};
var bgMusic=document.getElementById('bgMusic');
if(bgMusic){bgMusic.volume=${config.bgMusicVolume};bgMusic.addEventListener('timeupdate',function(){var fade=1.5;if(bgMusic.duration&&bgMusic.currentTime>bgMusic.duration-fade){bgMusic.volume=Math.max(0,${config.bgMusicVolume}*((bgMusic.duration-bgMusic.currentTime)/fade))}});bgMusic.addEventListener('seeking',function(){bgMusic.volume=${config.bgMusicVolume}})}
function startReading(){document.getElementById('coverPage').style.display='none';var r=document.getElementById('readerView');r.classList.add('active');buildDots();show(0)}
function show(i){document.querySelectorAll('.chapter').forEach(function(c,j){c.style.display=j===i?'block':'none'});stopAudio();document.getElementById('pageInfo').textContent=(i+1)+' / '+total;document.getElementById('prevBtn').disabled=i===0;document.getElementById('nextBtn').disabled=i===total-1;updateDots();window.scrollTo(0,0)}
function prevCh(){if(cur>0){cur--;show(cur)}}
function nextCh(){if(cur<total-1){cur++;show(cur)}}
function setSpeed(v){speed=parseFloat(v);document.getElementById('speedLabel').textContent=speed.toFixed(1)+'x';var a=getAudio();if(a)a.playbackRate=speed}
function startBgMusic(){if(bgMusic&&bgMusic.paused){bgMusic.play().catch(function(){})}}
function stopBgMusic(){if(bgMusic&&!bgMusic.paused){bgMusic.pause()}}
${narrationScript}
// Patch toggleAudio to start/stop bg music alongside narration
var _origToggleAudio=toggleAudio;
toggleAudio=function(){_origToggleAudio();if(playing||speaking){startBgMusic()}else{stopBgMusic()}};
var _origStopAudio=stopAudio;
stopAudio=function(){_origStopAudio();stopBgMusic()};
function buildDots(){var c=document.getElementById('tocDots');for(var i=0;i<total;i++){var d=document.createElement('div');d.className='dot'+(i===0?' active':'');d.onclick=(function(idx){return function(){cur=idx;show(cur)}})(i);c.appendChild(d)}}
function updateDots(){document.querySelectorAll('.toc .dot').forEach(function(d,i){d.className='dot'+(i===cur?' active':'')})}
document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')prevCh();if(e.key==='ArrowRight')nextCh();if(e.key===' '){e.preventDefault();toggleAudio()}});
<\/script>
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: "text/html" });
      saveAs(blob, `${safeName()}-ebook.html`);

      let narrationNote: string;
      if (useBrowserTts) {
        narrationNote = "Narration uses your browser's built-in voice. Press play in the eBook to hear it.";
      } else if (liveSpeechChaptersCount === total) {
        narrationNote = `${total} chapters exported. Premium narration was unavailable, so playback uses your browser's built-in voice live.`;
      } else if (liveSpeechChaptersCount > 0) {
        narrationNote = `${total} chapters with images. ${total - liveSpeechChaptersCount} have embedded premium narration; ${liveSpeechChaptersCount} will use your browser's built-in voice on play.`;
      } else {
        narrationNote = `${total} chapters with images and embedded narration. Open the HTML file in any browser.`;
      }
      toast({ title: "eBook downloaded!", description: narrationNote });

    } catch (err: any) {
      if (err.message === "Export cancelled") { toast({ title: "Export stopped" }); }
      else toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
    }
  }, [chapters, config, fetchNarrationBatch, blobToBase64, toast, safeName, referenceImage]);

  // ── ePub ──────────────────────────────────────────────────────────────
  const downloadAsEpub = useCallback(async () => {
    cancelledRef.current = false;
    setDownloading(true);
    const total = chapters.length;
    const _outerChapters = chapters;
    const _outerRef = referenceImage;

    try {
      // Re-sign + inline images so the .epub is portable past the TTL window.
      const { chapters, referenceImage } = await prepareExportImages(
        _outerChapters, _outerRef,
        { embedAsDataUri: true, uiAction: "exportEpub" }
      );
      const { default: epub } = await import("epub-gen-memory");

      setDownloadProgress({ current: 0, total, stage: "Preparing ePub…" });

      const epubChapters: { title: string; content: string }[] = [];

      for (let i = 0; i < total; i++) {
        if (cancelledRef.current) throw new Error("Export cancelled");
        const ch = chapters[i];
        setDownloadProgress({ current: i + 1, total, stage: `Processing Ch. ${i + 1}` });

        let imgHtml = "";
        const epubImgs = getChapterImages(ch).filter((im) => im.url);
        if (epubImgs.length > 0) {
          // ePub readers have inconsistent CSS grid support — render a simple
          // centered stack of images that respects the chosen image gap.
          const gap = config.imageGap ?? DEFAULT_IMAGE_GAP;
          imgHtml = `<div style="text-align:center;margin-bottom:1em;">${epubImgs
            .map((im, k) => `<img src="${im.url}" alt="${ch.title.replace(/"/g, '&quot;')} ${k + 1}" style="max-width:100%;height:auto;margin-bottom:${gap}px;" />`)
            .join("")}</div>`;
        }

        const bodyHtml = ch.body.replace(/\n/g, "<br/>");

        epubChapters.push({
          title: ch.title,
          content: `${imgHtml}<p>${bodyHtml}</p>`,
        });
      }

      setDownloadProgress({ current: total, total, stage: "Building ePub…" });

      // Prefer reference image as cover, fall back to first chapter image
      const coverImageUrl = referenceImage || chapters.find((c) => c.imageUrl)?.imageUrl;

      const epubContent = await epub(
        {
          title: config.topic || "AudioVisual eBook",
          author: "Resonance ePublisher",
          description: `A ${config.tone || ""} ${config.theme || ""} eBook created with Resonance ePublisher.`,
          lang: "en",
          ...(coverImageUrl ? { cover: coverImageUrl } : {}),
        },
        epubChapters
      );

      const epubBuffer = epubContent as unknown as ArrayBuffer;
      saveAs(new Blob([new Uint8Array(epubBuffer)], { type: "application/epub+zip" }), `${safeName()}.epub`);

      toast({ title: "ePub downloaded!", description: `${total} chapters exported. Open in any eReader app.` });
    } catch (err: any) {
      console.error("ePub export error:", err);
      if (err.message === "Export cancelled") { toast({ title: "Export stopped" }); }
      else toast({ title: "ePub export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
    }
  }, [chapters, config, toast, safeName]);

  // ── PDF ───────────────────────────────────────────────────────────────
  const downloadAsPdf = useCallback(async (photoOnly: boolean = false, pdfStyle?: PdfStyleConfig, chaptersOverride?: SlideChapter[]) => {
    const ps = pdfStyle || DEFAULT_PDF_STYLE;
    cancelledRef.current = false;
    setDownloading(true);
    const sourceChapters = chaptersOverride ?? chapters;
    const total = sourceChapters.length;
    const _outerChapters = sourceChapters;
    const _outerRef = referenceImage;

    try {
      // Refresh signed URLs for every chapter image before we fetch them into jsPDF.
      const { chapters, referenceImage } = await prepareExportImages(
        _outerChapters, _outerRef,
        { uiAction: "exportPdf" }
      );
      const { default: jsPDF } = await import("jspdf");

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // Register any Google Fonts used in the style config
      const usedFonts = [ps.coverTitleFont, ps.chapterTitleFont, ps.bodyFont, ps.tocFont];
      await registerAllUsedFonts(pdf, usedFonts, (msg) => setDownloadProgress({ current: 0, total, stage: msg }));

      setDownloadProgress({ current: 0, total, stage: "Preloading images…" });

      // Parallel image preloading for all chapters + cover
      const coverUrl = referenceImage || chapters.find((c) => c.imageUrl)?.imageUrl;
      const preloadImage = async (url: string | undefined): Promise<{ dataUrl: string; format: string; img: HTMLImageElement } | null> => {
        if (!url) return null;
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const dataUrl = await blobToBase64(blob);
          const format = dataUrl.includes("image/png") ? "PNG" : "JPEG";
          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve) => { img.onload = resolve; });
          return { dataUrl, format, img };
        } catch { return null; }
      };

      // Phase B: preload every image of every chapter (up to 4) so the layout
      // engine can render multi-image chapters in PDF.
      const chapterImageUrlSets = chapters.map((ch) => getChapterImages(ch).map((im) => im.url).filter(Boolean));
      const allUrls = [coverUrl, ...chapterImageUrlSets.flat()];
      const allLoaded = await Promise.all(allUrls.map((u) => preloadImage(u)));
      const coverData = allLoaded[0];
      // Slice chapter images back into per-chapter arrays
      const chapterImageSets: (Awaited<ReturnType<typeof preloadImage>> | null)[][] = [];
      let cursor = 1;
      for (const set of chapterImageUrlSets) {
        chapterImageSets.push(allLoaded.slice(cursor, cursor + set.length));
        cursor += set.length;
      }
      // Back-compat alias used elsewhere in the function
      const chapterImageData = chapterImageSets.map((set) => set[0] || null);

      const pdfDesign = resolveDesign(config);
      const pdfBg = hexToRgb(pdfDesign.bg);
      const pdfText = hexToRgb(pdfDesign.text);
      const pdfAccent = hexToRgb(pdfDesign.accent);
      const pdfChBg = hexToRgb(pdfDesign.chapterBg);
      const pdfMuted = { r: Math.round((pdfText.r + pdfBg.r) / 2), g: Math.round((pdfText.g + pdfBg.g) / 2), b: Math.round((pdfText.b + pdfBg.b) / 2) };

      setDownloadProgress({ current: 0, total, stage: t("visual.buildingPdf") });
      pdf.setFillColor(pdfBg.r, pdfBg.g, pdfBg.b);
      pdf.rect(0, 0, pageW, pageH, "F");

      if (coverData) {
        const coverRatio = coverData.img.width / coverData.img.height;
        let drawW = pageW;
        let drawH = drawW / coverRatio;
        if (drawH > pageH) { drawH = pageH; drawW = drawH * coverRatio; }
        const drawX = (pageW - drawW) / 2;
        const drawY = (pageH - drawH) / 2;
        pdf.addImage(coverData.dataUrl, coverData.format, drawX, drawY, drawW, drawH);
        pdf.setFillColor(pdfBg.r, pdfBg.g, pdfBg.b);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.55 }));
        pdf.rect(0, 0, pageW, pageH, "F");
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
      }

      pdf.setFont(ps.coverTitleFont);
      pdf.setTextColor(pdfAccent.r, pdfAccent.g, pdfAccent.b);
      pdf.setFontSize(ps.coverTitleSize);
      const coverTitleLines: string[] = pdf.splitTextToSize(config.topic || "Storybook", pageW - 40);
      const coverTitleLineH = ps.coverTitleSize * 0.39;
      const coverAlignX = ps.coverTitleAlign === "left" ? 20 : ps.coverTitleAlign === "right" ? pageW - 20 : pageW / 2;
      const coverTitleStartY = pageH / 2 - (coverTitleLines.length * coverTitleLineH) / 2;
      coverTitleLines.forEach((line: string, li: number) => {
        pdf.text(line, coverAlignX, coverTitleStartY + li * coverTitleLineH, { align: ps.coverTitleAlign });
      });
      const coverSubY = coverTitleStartY + coverTitleLines.length * coverTitleLineH + 6;
      pdf.setFontSize(14);
      pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
      const subtitleText = `A ${config.tone} ${config.theme} storybook`;
      const subtitleLines: string[] = pdf.splitTextToSize(subtitleText, pageW - 40);
      subtitleLines.forEach((line: string, li: number) => {
        pdf.text(line, pageW / 2, coverSubY + li * 6, { align: "center" });
      });
      pdf.setFontSize(10);
      pdf.text(`${total} chapters`, pageW / 2, coverSubY + subtitleLines.length * 6 + 8, { align: "center" });

      // Brand stamp on cover (bottom-center)
      const brandLogo = await getBrandLogoDataUrl();
      if (brandLogo) {
        try { pdf.addImage(brandLogo, "PNG", pageW / 2 - 5, pageH - 18, 10, 10); } catch { /* ignore */ }
      }
      pdf.setFontSize(8);
      pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
      pdf.text(`${BRAND_NAME} · ${BRAND_URL}`, pageW / 2, pageH - 5, { align: "center" });

      // ── Table of Contents page ──
      pdf.addPage();
      pdf.setFillColor(pdfBg.r, pdfBg.g, pdfBg.b);
      pdf.rect(0, 0, pageW, pageH, "F");
      pdf.setFont(ps.tocFont);
      pdf.setTextColor(pdfAccent.r, pdfAccent.g, pdfAccent.b);
      pdf.setFontSize(28);
      pdf.text("Table of Contents", pageW / 2, 22, { align: "center" });
      pdf.setDrawColor(pdfAccent.r, pdfAccent.g, pdfAccent.b);
      pdf.line(pageW / 2 - 40, 26, pageW / 2 + 40, 26);

      const tocLineH = 9;
      let tocY = 38;
      const tocMaxLines = Math.floor((pageH - tocY - 12) / tocLineH);
      for (let ti = 0; ti < total; ti++) {
        if (ti > 0 && ti % tocMaxLines === 0) {
          pdf.addPage();
          pdf.setFillColor(pdfBg.r, pdfBg.g, pdfBg.b);
          pdf.rect(0, 0, pageW, pageH, "F");
          tocY = 18;
        }
        const chNum = `${ti + 1}.`;
        pdf.setFont(ps.tocFont);
        pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
        pdf.setFontSize(ps.tocSize - 1);
        pdf.text(chNum, 22, tocY);
        pdf.setTextColor(pdfText.r, pdfText.g, pdfText.b);
        pdf.setFontSize(ps.tocSize);
        const tocTitle: string[] = pdf.splitTextToSize(chapters[ti].title, pageW - 70);
        pdf.text(tocTitle[0], 34, tocY);
        tocY += tocLineH;
      }

      for (let i = 0; i < total; i++) {
        if (cancelledRef.current) throw new Error("Export cancelled");
        const ch = chapters[i];
        setDownloadProgress({ current: i + 1, total, stage: `Building page ${i + 1}/${total}` });

        pdf.addPage();
        pdf.setFillColor(pdfChBg.r, pdfChBg.g, pdfChBg.b);
        pdf.rect(0, 0, pageW, pageH, "F");

        // Phase B: render every chapter image with the chosen layout.
        const imgSet = (chapterImageSets[i] || []).filter((d): d is NonNullable<typeof d> => !!d);
        if (imgSet.length > 0) {
          // Page-fit affects how much vertical room the image area gets.
          const pageFit = config.imagePageFit ?? "standard";
          const imgAreaFrac = pageFit === "compact" ? 0.55 : pageFit === "full" ? 0.95 : 0.68;
          const imgAreaH = pageH * imgAreaFrac;
          const imgMargin = 10;
          const gapMm = (config.imageGap ?? DEFAULT_IMAGE_GAP) * 0.26; // px → mm rough

          if (photoOnly) {
            // Use the whole page for the mosaic.
            const box: LayoutBox = { x: 0, y: 0, w: pageW, h: pageH };
            const rects = computeChapterImageRects(box, imgSet.length, {
              layout: ch.imageLayout || "stack",
              gap: gapMm,
            });
            for (let r = 0; r < rects.length; r++) {
              const d = imgSet[r];
              const fit = fitImageCover(d.img.width, d.img.height, rects[r]);
              // jsPDF doesn't support clipping easily — let cover-fit overflow be hidden by next image / page edge.
              pdf.addImage(d.dataUrl, d.format, fit.x, fit.y, fit.w, fit.h);
            }
          } else {
            const box: LayoutBox = {
              x: imgMargin,
              y: 8,
              w: pageW - imgMargin * 2,
              h: imgAreaH,
            };
            const rects = computeChapterImageRects(box, imgSet.length, {
              layout: ch.imageLayout || "stack",
              gap: gapMm,
            });
            for (let r = 0; r < rects.length; r++) {
              const d = imgSet[r];
              const fit = fitImageCover(d.img.width, d.img.height, rects[r]);
              pdf.addImage(d.dataUrl, d.format, fit.x, fit.y, fit.w, fit.h);
            }
            // Repaint the area below the image strip so text always sits on chapterBg
            // (cover-fit overflow can otherwise bleed into the body region).
            pdf.setFillColor(pdfChBg.r, pdfChBg.g, pdfChBg.b);
            pdf.rect(0, 8 + imgAreaH, pageW, pageH - (8 + imgAreaH), "F");
          }
        }

        if (photoOnly) {
          pdf.setTextColor(pdfText.r, pdfText.g, pdfText.b);
          pdf.setFontSize(11);
          const captionLines: string[] = pdf.splitTextToSize(`${i + 1}. ${ch.title}`, pageW - 30);
          pdf.text(captionLines[0], pageW / 2, pageH - 6, { align: "center" });
        } else {
          const chAlignX = ps.chapterTitleAlign === "left" ? 20 : ps.chapterTitleAlign === "right" ? pageW - 20 : pageW / 2;
          const bodyAlignX = ps.bodyAlign === "left" ? 20 : ps.bodyAlign === "right" ? pageW - 20 : pageW / 2;

          // Chapter label
          const textStartY = pageH * 0.72;
          pdf.setFont(ps.chapterTitleFont);
          pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
          pdf.setFontSize(12);
          pdf.text(`Chapter ${i + 1} of ${total}`, chAlignX, textStartY, { align: ps.chapterTitleAlign });

          // Chapter title
          pdf.setTextColor(pdfAccent.r, pdfAccent.g, pdfAccent.b);
          pdf.setFontSize(ps.chapterTitleSize);
          const titleLines: string[] = pdf.splitTextToSize(ch.title, pageW - 50);
          const titleLineH = ps.chapterTitleSize * 0.42;
          titleLines.forEach((line: string, li: number) => {
            pdf.text(line, chAlignX, textStartY + 10 + li * titleLineH, { align: ps.chapterTitleAlign });
          });

          // Body text
          const bodyStartY = textStartY + 10 + titleLines.length * titleLineH + 6;
          pdf.setFont(ps.bodyFont);
          pdf.setTextColor(pdfText.r, pdfText.g, pdfText.b);
          pdf.setFontSize(ps.bodySize);
          const marginX = 20;
          const bodyLines: string[] = pdf.splitTextToSize(ch.body, pageW - marginX * 2);
          const lineHeight = ps.bodyLineHeight;
          const maxLinesFirstPage = Math.floor((pageH - bodyStartY - 10) / lineHeight);

          // First page of text
          const bodyOpts = { align: ps.bodyAlign as "left" | "center" | "right" };
          bodyLines.slice(0, maxLinesFirstPage).forEach((line: string, li: number) => {
            pdf.text(line, bodyAlignX, bodyStartY + li * lineHeight, bodyOpts);
          });

          // Overflow pages for remaining text
          let remaining = bodyLines.slice(maxLinesFirstPage);
          while (remaining.length > 0) {
            pdf.addPage();
            pdf.setFillColor(pdfChBg.r, pdfChBg.g, pdfChBg.b);
            pdf.rect(0, 0, pageW, pageH, "F");
            // Continuation header
            pdf.setFont(ps.chapterTitleFont);
            pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
            pdf.setFontSize(10);
            const contLines: string[] = pdf.splitTextToSize(`${ch.title} (continued)`, pageW - 50);
            pdf.text(contLines[0], pageW / 2, 12, { align: "center" });
            pdf.setDrawColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
            pdf.line(marginX, 15, pageW - marginX, 15);
            // Body text continues
            pdf.setFont(ps.bodyFont);
            pdf.setTextColor(pdfText.r, pdfText.g, pdfText.b);
            pdf.setFontSize(ps.bodySize);
            const overflowStartY = 20;
            const overflowMaxLines = Math.floor((pageH - overflowStartY - 10) / lineHeight);
            remaining.slice(0, overflowMaxLines).forEach((line: string, li: number) => {
              pdf.text(line, bodyAlignX, overflowStartY + li * lineHeight, bodyOpts);
            });
            remaining = remaining.slice(overflowMaxLines);
          }
        }
      }

      // Add page numbers to every page (skip cover = page 1)
      const totalPages = pdf.getNumberOfPages();
      for (let p = 2; p <= totalPages; p++) {
        pdf.setPage(p);
        pdf.setTextColor(pdfMuted.r, pdfMuted.g, pdfMuted.b);
        pdf.setFontSize(9);
        pdf.text(`${p - 1}`, pageW / 2, pageH - 4, { align: "center" });
      }

      setDownloadProgress({ current: total, total, stage: t("visual.buildingPdf") });
      pdf.save(`${safeName()}-storybook.pdf`);
      toast({ title: t("visual.pdfDownloaded"), description: `${total} ${t("visual.pdfChaptersDesc")}` });
    } catch (err: any) {
      if (err.message === "Export cancelled") { toast({ title: "Export stopped" }); }
      else toast({ title: t("visual.pdfExportFailed"), description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
    }
  }, [chapters, config, toast, t, blobToBase64, safeName]);

  // ── Audio (MP3 via FFmpeg concat) ──────────────────────────────────────
  const downloadAsAudio = useCallback(async () => {
    if (config.narrationProvider === "browser") {
      toast({
        title: "🔊 Free narration recording",
        description: "Browser speech will be recorded into the MP3. This may take longer than Premium narration.",
      });
    }

    cancelledRef.current = false;
    setDownloading(true);
    const total = chapters.length;

    try {
      // Fetch bg music in parallel with narration
      const bgMusicPromise = fetchBgMusicBlob(config.bgMusicTrackId);

      // Fetch all narration audio
      const audioBlobs = await fetchNarrationBatch(chapters);
      // Filter out null AND empty blobs (empty blobs come from skipped short chapters)
      const validBlobs = audioBlobs.filter((b): b is Blob => b !== null && b.size > 0);

      if (validBlobs.length === 0) {
        throw new Error("No narration audio could be generated. Make sure your chapters have enough text (at least 10 characters each).");
      }

      const bgMusicBlob = await bgMusicPromise;
      const hasBgMusic = bgMusicBlob && bgMusicBlob.size > 0;

      // Fast path: single blob that's already MP3 AND no bg music — skip FFmpeg entirely
      if (validBlobs.length === 1 && !hasBgMusic && (validBlobs[0].type.includes("mpeg") || validBlobs[0].type.includes("mp3"))) {
        const filename = `${safeName()}-audiobook.mp3`;
        setPendingDownload({ blob: validBlobs[0], filename });
        downloadBlob(validBlobs[0], filename);
        toast({ title: "Audiobook downloaded!", description: "1 chapter exported as MP3." });
        return;
      }

      setDownloadProgress({ current: 0, total: validBlobs.length, stage: "Loading audio encoder…" });

      let ffmpeg: any;
      try {
        ffmpeg = await getFFmpeg();
      } catch (ffmpegErr: any) {
        console.warn("FFmpeg failed to load, using direct blob merge:", ffmpegErr.message);
        // Fallback: merge blobs without FFmpeg (results in webm/wav but still downloadable)
        const mergedBlob = validBlobs.length === 1
          ? validBlobs[0]
          : await mergeAudioBlobsToWavBlob(validBlobs);
        const ext = mergedBlob.type.includes("wav") ? "wav" : (mergedBlob.type.includes("webm") ? "webm" : "mp3");
        const filename = `${safeName()}-audiobook.${ext}`;
        setPendingDownload({ blob: mergedBlob, filename });
        downloadBlob(mergedBlob, filename);
        toast({ title: "Audiobook downloaded!", description: `${validBlobs.length} chapters merged (${ext.toUpperCase()} format — FFmpeg was unavailable for MP3 encoding).` });
        return;
      }

      // Normalize each chapter narration to MP3 so resumed/cache audio works
      // even when long premium chapters were merged into WAV for decode safety.
      const { fetchFile } = await import("@ffmpeg/util");
      const fileList: string[] = [];
      for (let i = 0; i < validBlobs.length; i++) {
        if (cancelledRef.current) throw new Error("Export cancelled");
        setDownloadProgress({ current: i + 1, total: validBlobs.length, stage: `Encoding audio ${i + 1}/${validBlobs.length}…` });
        const sourceBlob = validBlobs[i];
        const sourceExt = getAudioInputExtension(sourceBlob);
        const sourceName = `audio_src_${i}.${sourceExt}`;
        const outputName = `audio_${i}.mp3`;
        await ffmpeg.writeFile(sourceName, await fetchFile(new File([sourceBlob], sourceName, { type: sourceBlob.type || "application/octet-stream" })));
        await ffmpeg.exec(["-i", sourceName, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", outputName]);
        fileList.push(`file '${outputName}'`);
      }

      // Create concat list
      await ffmpeg.writeFile("list.txt", new TextEncoder().encode(fileList.join("\n")));

      setDownloadProgress({ current: validBlobs.length, total: validBlobs.length, stage: "Merging audio…" });

      await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "narration.mp3"]);

      // Mix background music if selected
      let finalOutputName = "narration.mp3";
      if (hasBgMusic) {
        setDownloadProgress({ current: validBlobs.length, total: validBlobs.length, stage: "Mixing background music…" });
        const { fetchFile: fetchFileUtil } = await import("@ffmpeg/util");
        await ffmpeg.writeFile("bgmusic.mp3", await fetchFileUtil(new File([bgMusicBlob!], "bgmusic.mp3", { type: "audio/mpeg" })));
        // Use FFmpeg amix to layer bg music (looped) underneath narration at configured volume
        const bgVol = config.bgMusicVolume.toFixed(2);
        await ffmpeg.exec([
          "-i", "narration.mp3",
          "-stream_loop", "-1", "-i", "bgmusic.mp3",
          "-filter_complex", `[1:a]volume=${bgVol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[out]`,
          "-map", "[out]",
          "-c:a", "libmp3lame", "-b:a", "128k",
          "output.mp3",
        ]);
        finalOutputName = "output.mp3";
        await ffmpeg.deleteFile("bgmusic.mp3").catch(() => {});
        await ffmpeg.deleteFile("narration.mp3").catch(() => {});
      }

      const data = await ffmpeg.readFile(finalOutputName);
      const mp3Blob = new Blob([data], { type: "audio/mpeg" });
      const filename = `${safeName()}-audiobook.mp3`;
      setPendingDownload({ blob: mp3Blob, filename });
      downloadBlob(mp3Blob, filename);

      // Cleanup
      for (let i = 0; i < validBlobs.length; i++) {
        const sourceExt = getAudioInputExtension(validBlobs[i]);
        await ffmpeg.deleteFile(`audio_src_${i}.${sourceExt}`).catch(() => {});
        await ffmpeg.deleteFile(`audio_${i}.mp3`).catch(() => {});
      }
      await ffmpeg.deleteFile("list.txt").catch(() => {});
      await ffmpeg.deleteFile(finalOutputName).catch(() => {});

      toast({ title: "Audiobook downloaded!", description: `${validBlobs.length} chapters merged into a single MP3.` });
    } catch (err: any) {
      console.error("Audio export error:", err);
      if (err.message === "Export cancelled") { toast({ title: "Export stopped" }); }
      else toast({ title: "Audio export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
    }
  }, [chapters, config, fetchNarrationBatch, toast, safeName]);

  const downloadAsVideo = useCallback(async (quality: "720p" | "1080p" = "720p", speed: "fast" | "normal" | "hq" = "fast") => {
    if (config.narrationProvider === "browser") {
      toast({
        title: "🔊 Free narration recording",
        description: "Browser speech will be recorded into the video. This may take longer than Premium narration.",
      });
    }

    cancelledRef.current = false;
    setDownloading(true);
    const total = chapters.length;
    const WIDTH = quality === "1080p" ? 1920 : 1280;
    const HEIGHT = quality === "1080p" ? 1080 : 720;
    const MIN_SECS_PER_TEXT_PAGE = 4; // minimum seconds each text page stays on screen
    const FPS = speed === "fast" ? 12 : speed === "hq" ? 24 : 18;
    let currentStep = "init";

    // ── Resume short-circuit: if we already encoded an MP4 for this exact
    //    chapter+config combination, re-download it instantly instead of
    //    re-rendering frames + re-encoding. This rescues users who were
    //    interrupted right after the slow encode finished. ──
    const _voiceIdForKey = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
    const _videoCacheKey = videoExportCacheKey(
      chapters, quality, speed, _voiceIdForKey, config.narrationSpeed, config.narrationDemeanour
    );
    if (_lastVideoExport && _lastVideoExport.key === _videoCacheKey) {
      console.log("[VideoExport] ✓ Resuming from cached encoded MP4 — skipping render + encode");
      setPendingDownload({ blob: _lastVideoExport.blob, filename: _lastVideoExport.filename });
      downloadBlob(_lastVideoExport.blob, _lastVideoExport.filename);
      toast({
        title: "Video re-downloaded from cache",
        description: "Used last encoded MP4 — no re-encoding needed.",
      });
      setDownloading(false);
      setExportStep("");
      return;
    }

    const _outerChapters = chapters;
    const _outerRef = referenceImage;

    try {
      // Refresh signed URLs before <img>.src loads (chapter-images bucket is private).
      const { chapters, referenceImage } = await prepareExportImages(
        _outerChapters, _outerRef,
        { uiAction: "exportVideo" }
      );
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to create canvas 2D context");

      // ── Step 1: Parallel — TTS + images + FFmpeg load simultaneously ──
      currentStep = "parallel-load"; setExportStep(currentStep);
      setDownloadProgress({ current: 0, total, stage: "Loading video encoder…" });
      console.log(`[VideoExport] Config: ${quality} @ ${FPS}fps (${speed}), ${total} chapters`);

      const ffmpegPromise = getFFmpeg((msg) => setDownloadProgress({ current: 0, total, stage: msg }));
      const bgMusicPromise = fetchBgMusicBlob(config.bgMusicTrackId);

      const useBrowserNarration = config.narrationProvider === "browser";
      const audioBlobs: (Blob | null)[] = new Array(total).fill(null);
      const ttsPromise = (async () => {
        if (useBrowserNarration) {
          // Record browser speech synthesis via MediaRecorder + AudioContext graph.
          // fetchNarrationBatch already handles browser TTS when provider is "browser",
          // producing WebM blobs that can be decoded and muxed into the final MP4.
          console.log("[VideoExport] Step 1a: Recording browser narration…");
        }
        console.log("[VideoExport] Step 1a: Fetching narration…");
        const results = await fetchNarrationBatch(chapters);
        results.forEach((result, i) => { audioBlobs[i] = result; });
        const successCount = results.filter(Boolean).length;
        console.log(`[VideoExport] Step 1a done ✓ — ${successCount}/${total} narrations fetched`);
        setDownloadProgress({ current: total, total, stage: `Narration: ${total} ready ✓` });
      })();

      // Phase B: load every image of every chapter (up to 4) for multi-image title cards.
      const loadOne = (url: string, idx: number) => new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => { console.warn(`[VideoExport] Image load failed for ch ${idx + 1}:`, url.slice(0, 80)); resolve(null); };
        img.src = url;
      });
      const chapterImageUrlSetsVideo = chapters.map((ch) => getChapterImages(ch).map((im) => im.url).filter(Boolean));
      const imageSetsPromise = Promise.all(
        chapterImageUrlSetsVideo.map((set, idx) => Promise.all(set.map((u) => loadOne(u, idx))))
      );

      const [ffmpeg, loadedChapterImageSets] = await Promise.all([ffmpegPromise, imageSetsPromise, ttsPromise]);
      const chapterImageSetsVideo: (HTMLImageElement | null)[][] = loadedChapterImageSets.map((s) => [...s]);
      // Back-compat: primary image per chapter (used by GC line further down)
      const chapterImages: (HTMLImageElement | null)[] = chapterImageSetsVideo.map((s) => s[0] || null);
      if (cancelledRef.current) throw new Error("Export cancelled");
      const loadedImages = chapterImages.filter(Boolean).length;
      logHeapSnapshot("after parallel-load (images + narration + FFmpeg)");
      console.log(`[VideoExport] Step 1 done ✓ — FFmpeg loaded, ${loadedImages}/${total} images, narration ready`);
      toast({ title: "Narration ready ✓", description: "Rendering video frames… file will download automatically." });

      // ── Step 2: Decode audio & compute chapter timings ────────────
      currentStep = "audio-decode"; setExportStep(currentStep);
      setDownloadProgress({ current: 0, total, stage: "Processing audio…" });
      console.log("[VideoExport] Step 2: Decoding audio…");
      const audioCtx = new AudioContext();
      const audioBuffers: (AudioBuffer | null)[] = [];
      let totalAudioDuration = 0;
      // Pre-compute fallback durations based on text length (approx reading speed)
      const FALLBACK_MIN_SECS = 10;
      const FALLBACK_MAX_SECS = 60; // Cap to prevent multi-GB silent WAV files
      const chapterFallbackDurations = chapters.map(ch => {
        const wordCount = ch.body.split(/\s+/).length;
        const estimated = Math.max(FALLBACK_MIN_SECS, (wordCount / 130) * 60); // ~130 wpm reading speed
        return Math.min(estimated, FALLBACK_MAX_SECS);
      });

      for (let i = 0; i < total; i++) {
        if (cancelledRef.current) throw new Error("Export cancelled");
        const fallbackDur = chapterFallbackDurations[i];
        if (audioBlobs[i]) {
          try {
            const decoded = await audioCtx.decodeAudioData(await audioBlobs[i]!.arrayBuffer());
            audioBuffers.push(decoded);
            totalAudioDuration += Math.max(decoded.duration, fallbackDur);
          } catch (decErr) {
            console.warn(`[VideoExport] Audio decode failed for ch ${i + 1}:`, decErr);
            audioBuffers.push(null);
            totalAudioDuration += fallbackDur;
          }
        } else { audioBuffers.push(null); totalAudioDuration += fallbackDur; }
      }
      console.log(`[VideoExport] Step 2 done ✓ — total audio: ${totalAudioDuration.toFixed(1)}s`);

      // ── Step 3: Mix audio offline ────────────────────────────────
      // IMPORTANT: We pre-compute the SAME per-chapter visual duration that the
      // video renderer will use later (title card + max(narration, textPages*MIN)),
      // so audio and video stay perfectly aligned and the final chapter's
      // narration doesn't get cut off by visual padding accumulating between chapters.
      currentStep = "audio-mix"; setExportStep(currentStep);
      const sampleRate = 44100;
      const TITLE_CARD_SECS_AUDIO = 3; // silence gap for the title card visual

      // Pre-compute text page counts (mirrors video renderer's wrapText logic).
      // We use the same font metrics so page counts match exactly.
      const _PAGE_PAD_X_PRE = Math.round(WIDTH * 0.08);
      const _PAGE_PAD_TOP_PRE = Math.round(HEIGHT * 0.1);
      const _PAGE_PAD_BOTTOM_PRE = Math.round(HEIGHT * 0.08);
      const _TITLE_FONT_SIZE_PRE = quality === "1080p" ? 38 : 28;
      const _LABEL_FONT_SIZE_PRE = quality === "1080p" ? 18 : 14;
      const _BODY_FONT_SIZE_PRE = quality === "1080p" ? 24 : 18;
      const _BODY_LINE_H_PRE = Math.round(_BODY_FONT_SIZE_PRE * 1.75);
      const _vidDesignPre = resolveDesign(config);
      const _vidFontPre = _vidDesignPre.fontName;
      ctx.font = `${_BODY_FONT_SIZE_PRE}px ${_vidFontPre}, Georgia, serif`;
      // Side-by-side layout: text occupies the right half of the content area.
      const _GUTTER_PRE = Math.round(WIDTH * 0.03);
      const _bodyMaxW_PRE = Math.round((WIDTH - _PAGE_PAD_X_PRE * 2 - _GUTTER_PRE) / 2);
      const _bodyAreaH_PRE = HEIGHT - _PAGE_PAD_TOP_PRE - _PAGE_PAD_BOTTOM_PRE - (_LABEL_FONT_SIZE_PRE + 12 + _TITLE_FONT_SIZE_PRE + 20);
      const _bodyLinesPerPage_PRE = Math.floor(_bodyAreaH_PRE / _BODY_LINE_H_PRE);
      function _wrapTextPre(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const paragraphs = text.split(/\n/);
        const lines: string[] = [];
        for (const para of paragraphs) {
          if (para.trim() === "") { lines.push(""); continue; }
          const words = para.split(/\s+/);
          let currentLine = "";
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (context.measureText(testLine).width > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) lines.push(currentLine);
        }
        return lines;
      }
      const _textPagesPerChapter: number[] = chapters.map((ch) => {
        const lines = _wrapTextPre(ctx, ch.body, _bodyMaxW_PRE);
        return Math.max(1, Math.ceil(lines.length / _bodyLinesPerPage_PRE));
      });

      // Compute the actual per-chapter narration duration the video will display.
      // Mirrors `textTotalSecs` in the render loop below.
      // Auto-correct sub-2s drift by rounding each chapter's audio duration up to the
      // exact frame boundary the video renderer uses (Math.ceil(secs * FPS) / FPS).
      // This pads the audio with trailing silence so the mix ends precisely with the last frame.
      const FPS_FOR_AUDIO = FPS;
      const TITLE_CARD_FRAMES_PRE = Math.ceil(TITLE_CARD_SECS_AUDIO * FPS_FOR_AUDIO);
      const TITLE_CARD_SECS_FRAMED = TITLE_CARD_FRAMES_PRE / FPS_FOR_AUDIO;
      const chapterNarrationDurations: number[] = [];
      let totalMixDuration = 0;
      for (let i = 0; i < total; i++) {
        const buf = audioBuffers[i];
        const fallbackDur = chapterFallbackDurations[i];
        const audioDur = buf ? Math.max(buf.duration, fallbackDur) : fallbackDur;
        const minVisualSecs = _textPagesPerChapter[i] * 4; // MIN_SECS_PER_TEXT_PAGE
        const rawNarrationDur = Math.max(audioDur, minVisualSecs);
        // Snap to frame boundary — pads with at most (1/FPS) seconds of trailing silence.
        const framedNarrationDur = Math.ceil(rawNarrationDur * FPS_FOR_AUDIO) / FPS_FOR_AUDIO;
        chapterNarrationDurations.push(framedNarrationDur);
        totalMixDuration += TITLE_CARD_SECS_FRAMED + framedNarrationDur;
      }
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalMixDuration * sampleRate), sampleRate);
      let audioOffset = 0;
      const chapterTimings: number[] = [];
      for (let i = 0; i < total; i++) {
        chapterTimings.push(audioOffset);
        audioOffset += TITLE_CARD_SECS_AUDIO; // silence during title card
        const buf = audioBuffers[i];
        const dur = chapterNarrationDurations[i];
        if (buf) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buf;
          source.connect(offlineCtx.destination);
          source.start(audioOffset); // narration starts after title card
        }
        audioOffset += dur;
      }
      chapterTimings.push(audioOffset);

      // Mix background music if selected
      const bgMusicBlob = await bgMusicPromise;
      if (bgMusicBlob && bgMusicBlob.size > 0) {
        console.log("[VideoExport] Mixing background music into audio…");
        const bgBuffer = await decodeBgMusic(bgMusicBlob, sampleRate);
        if (bgBuffer) {
          mixBgMusicIntoOfflineCtx(offlineCtx, bgBuffer, config.bgMusicVolume, totalMixDuration);
        }
      }

      console.log("[VideoExport] Step 3: Rendering offline audio…");
      const renderedAudio = await offlineCtx.startRendering();
      audioCtx.close();
      // ── Memory cleanup: release raw audio data no longer needed ──
      for (let i = 0; i < audioBlobs.length; i++) audioBlobs[i] = null;
      audioBuffers.length = 0;
      logHeapSnapshot("after audio-release (blobs + buffers freed)");
      console.log("[VideoExport] Step 3 done ✓ (audio blobs + buffers released)");

      // ── Step 4: WAV conversion ───────────────────────────────────
      currentStep = "wav-convert"; setExportStep(currentStep);
      let wavData: Uint8Array | null = audioBufferToWavBytes(renderedAudio);
      // renderedAudio no longer needed — let GC reclaim it
      console.log(`[VideoExport] Step 4 done ✓ — WAV: ${(wavData.byteLength / 1024 / 1024).toFixed(1)} MB`);

      // ── Step 5: Progress handler ─────────────────────────────────
      const encodeStartTime = { value: 0 };
      ffmpeg.on("progress", ({ progress }: { progress: number }) => {
        const pct = Math.round(Math.max(0, Math.min(100, progress * 100)));
        let eta = "";
        if (pct > 2 && encodeStartTime.value > 0) {
          const elapsed = (Date.now() - encodeStartTime.value) / 1000;
          const remaining = Math.round((elapsed / pct) * (100 - pct));
          if (remaining > 60) eta = ` — ~${Math.ceil(remaining / 60)} min left`;
          else if (remaining > 0) eta = ` — ~${remaining}s left`;
        }
        setDownloadProgress({ current: pct, total: 100, stage: `Encoding MP4… ${pct}%${eta}` });
      });

      // ── Step 6: Render frames (PDF-style — full page text like the PDF) ──
      currentStep = "render-frames"; setExportStep(currentStep);
      let frameIndex = 0;

      // Layout constants
      const PAGE_PAD_X = Math.round(WIDTH * 0.08);
      const PAGE_PAD_TOP = Math.round(HEIGHT * 0.1);
      const PAGE_PAD_BOTTOM = Math.round(HEIGHT * 0.08);
      const TITLE_FONT_SIZE = quality === "1080p" ? 38 : 28;
      const LABEL_FONT_SIZE = quality === "1080p" ? 18 : 14;
      const BODY_FONT_SIZE = quality === "1080p" ? 24 : 18;
      const BODY_LINE_H = Math.round(BODY_FONT_SIZE * 1.75);
      const TITLE_CARD_SECS = 3; // seconds to show the image title card

      // Canvas helper: word-wrap text to fit within maxWidth
      function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const paragraphs = text.split(/\n/);
        const lines: string[] = [];
        for (const para of paragraphs) {
          if (para.trim() === "") { lines.push(""); continue; }
          const words = para.split(/\s+/);
          let currentLine = "";
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (context.measureText(testLine).width > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) lines.push(currentLine);
        }
        return lines;
      }

      // Resolve design for video rendering
      const vidDesign = resolveDesign(config);
      const vidFont = vidDesign.fontName;

      // Pre-compute body text lines and page counts for each chapter
      ctx.font = `${BODY_FONT_SIZE}px ${vidFont}, Georgia, serif`;
      // Side-by-side layout: text panel = right half of content area; image = left half.
      const GUTTER = Math.round(WIDTH * 0.03);
      const HALF_W = Math.round((WIDTH - PAGE_PAD_X * 2 - GUTTER) / 2);
      const TEXT_X = PAGE_PAD_X + HALF_W + GUTTER;
      const IMAGE_PANEL = { x: PAGE_PAD_X, y: PAGE_PAD_TOP, w: HALF_W, h: HEIGHT - PAGE_PAD_TOP - PAGE_PAD_BOTTOM };
      const bodyMaxW = HALF_W;
      const bodyAreaH = HEIGHT - PAGE_PAD_TOP - PAGE_PAD_BOTTOM - (LABEL_FONT_SIZE + 12 + TITLE_FONT_SIZE + 20);
      const bodyLinesPerPage = Math.floor(bodyAreaH / BODY_LINE_H);

      type ChapterLayout = {
        bodyLines: string[];
        textPages: number;
        titleCardFrames: number;
        textFrames: number;
        totalChFrames: number;
      };
      const chapterLayouts: ChapterLayout[] = [];

      // First pass — compute layouts and total frames
      for (let i = 0; i < total; i++) {
        const ch = chapters[i];
        const bodyLines = wrapText(ctx, ch.body, bodyMaxW);
        const textPages = Math.max(1, Math.ceil(bodyLines.length / bodyLinesPerPage));
        const chDuration = chapterTimings[i + 1] - chapterTimings[i];

        // Title card gets fixed time, remaining time split across text pages
        const titleCardFrames = Math.ceil(TITLE_CARD_SECS * FPS);
        const textTotalSecs = Math.max(chDuration - TITLE_CARD_SECS, textPages * MIN_SECS_PER_TEXT_PAGE);
        const textFrames = Math.ceil(textTotalSecs * FPS);

        chapterLayouts.push({ bodyLines, textPages, titleCardFrames, textFrames, totalChFrames: titleCardFrames + textFrames });
      }

      const totalFrames = chapterLayouts.reduce((s, cl) => s + cl.totalChFrames, 0);
      console.log(`[VideoExport] Step 6: Rendering ${totalFrames} frames across ${total} chapters at ${FPS}fps…`);

      // ── A/V sync QA: warn if video frame duration drifts from audio mix duration ──
      const videoDurationSecs = totalFrames / FPS;
      const rawDriftSecs = videoDurationSecs - totalMixDuration;
      // Debug-only: artificially inject drift via window.__avDriftDebugSecs (set from the export panel toggle).
      const debugDriftInjection = Number((globalThis as any).__avDriftDebugSecs) || 0;
      const driftSecs = rawDriftSecs + debugDriftInjection;
      const absDrift = Math.abs(driftSecs);
      const exceededDriftThreshold = absDrift > 0.5;
      setLastAvDrift({ driftSecs, exceeded: exceededDriftThreshold });
      console.log(
        `[VideoExport] A/V sync check — video: ${videoDurationSecs.toFixed(3)}s, audio: ${totalMixDuration.toFixed(3)}s, drift: ${driftSecs >= 0 ? "+" : ""}${driftSecs.toFixed(3)}s${debugDriftInjection ? ` (incl. ${debugDriftInjection}s debug injection)` : ""}`
      );
      if (exceededDriftThreshold) {
        const direction = driftSecs > 0 ? "video longer than audio (silent tail)" : "audio longer than video (cut-off narration)";
        console.warn(`[VideoExport] ⚠ A/V drift ${absDrift.toFixed(2)}s exceeds 0.5s threshold — ${direction}`);
        toast({
          title: "⚠ A/V sync drift detected",
          description: `Video and audio differ by ${absDrift.toFixed(2)}s (${direction}). Export will continue.`,
          variant: "destructive",
        });
      }
      // Persist drift metric to api_usage_logs (best-effort, never blocks export).
      void supabase.functions
        .invoke("log-export-metric", {
          body: {
            service: "video-export-av-drift",
            driftSecs,
            videoDurationSecs,
            audioDurationSecs: totalMixDuration,
            exceededThreshold: exceededDriftThreshold,
            quality,
            speed,
            totalChapters: total,
          },
        })
        .catch((err) => console.warn("[VideoExport] drift metric log failed:", err));

      // Higher keyframe interval for fast mode = fewer unique renders
      const KEYFRAME_INTERVAL = speed === "fast" ? 12 : speed === "hq" ? 4 : 6;
      const JPEG_QUALITY = speed === "fast" ? 0.65 : speed === "hq" ? 0.85 : 0.78;

      for (let i = 0; i < total; i++) {
        if (cancelledRef.current) throw new Error("Export cancelled");
        const ch = chapters[i];
        const layout = chapterLayouts[i];
        const img = chapterImages[i];
        // Phase B: full image set for the multi-image title-card mosaic.
        const titleImgSet = (chapterImageSetsVideo[i] || []).filter((x): x is HTMLImageElement => !!x);
        setDownloadProgress({ current: frameIndex, total: totalFrames, stage: `Rendering: Ch. ${i + 1}/${total}` });

        // ── Phase A: Title card (image + title overlay) ──
        let lastKeyframeBuf: Uint8Array | null = null;

        // Pre-compute single-image draw params (cover-fill) for the legacy/single path.
        let drawW = 0, drawH = 0, drawX = 0, drawY = 0;
        if (img && titleImgSet.length <= 1) {
          const imgRatio = img.width / img.height;
          const areaRatio = WIDTH / HEIGHT;
          if (imgRatio > areaRatio) {
            drawH = HEIGHT; drawW = HEIGHT * imgRatio;
            drawX = (WIDTH - drawW) / 2; drawY = 0;
          } else {
            drawW = WIDTH; drawH = WIDTH / imgRatio;
            drawX = 0; drawY = (HEIGHT - drawH) / 2;
          }
        }

        // Pre-compute multi-image rects once per chapter.
        const titleRects = titleImgSet.length > 1
          ? computeChapterImageRects(
              { x: 0, y: 0, w: WIDTH, h: HEIGHT },
              titleImgSet.length,
              { layout: ch.imageLayout || "stack", gap: config.imageGap ?? DEFAULT_IMAGE_GAP }
            )
          : [];

        for (let f = 0; f < layout.titleCardFrames; f++) {
          const needsNewKeyframe = f % KEYFRAME_INTERVAL === 0;
          if (needsNewKeyframe) {
            // Dark background
            ctx.fillStyle = vidDesign.chapterBg;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);

            // Image(s) with Ken Burns zoom
            const zoomProgress = f / layout.titleCardFrames;
            const scale = 1 + zoomProgress * 0.04;
            const cx = WIDTH / 2, cy = HEIGHT / 2;

            if (titleImgSet.length > 1) {
              for (let r = 0; r < titleRects.length; r++) {
                const rect = titleRects[r];
                const im = titleImgSet[r];
                const fit = fitImageCover(im.width, im.height, rect);
                ctx.save();
                ctx.beginPath();
                ctx.rect(rect.x, rect.y, rect.w, rect.h);
                ctx.clip();
                ctx.translate(cx, cy);
                ctx.scale(scale, scale);
                ctx.translate(-cx, -cy);
                ctx.drawImage(im, fit.x, fit.y, fit.w, fit.h);
                ctx.restore();
              }
            } else if (img) {
              ctx.save();
              ctx.translate(cx, cy);
              ctx.scale(scale, scale);
              ctx.translate(-cx, -cy);
              ctx.drawImage(img, drawX, drawY, drawW, drawH);
              ctx.restore();
            }

            // Dark gradient overlay at bottom for text readability
            const grad = ctx.createLinearGradient(0, HEIGHT * 0.5, 0, HEIGHT);
            grad.addColorStop(0, "rgba(10, 10, 26, 0)");
            grad.addColorStop(0.5, "rgba(10, 10, 26, 0.6)");
            grad.addColorStop(1, "rgba(10, 10, 26, 0.95)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);

            // Chapter label
            const fadeIn = Math.min(1, f / (FPS * 0.5));
            ctx.globalAlpha = fadeIn;
            ctx.fillStyle = vidDesign.text + "99";
            ctx.font = `${LABEL_FONT_SIZE}px sans-serif`;
            ctx.textAlign = "left";
            ctx.fillText(`CHAPTER ${i + 1} OF ${total}`, PAGE_PAD_X, HEIGHT - 120);

            // Chapter title
            ctx.fillStyle = vidDesign.accent;
            ctx.font = `bold ${Math.round(TITLE_FONT_SIZE * 1.3)}px ${vidFont}, Georgia, serif`;
            const titleLines = wrapText(ctx, ch.title, WIDTH - PAGE_PAD_X * 2);
            for (let tl = 0; tl < Math.min(titleLines.length, 3); tl++) {
              ctx.fillText(titleLines[tl], PAGE_PAD_X, HEIGHT - 80 + tl * (TITLE_FONT_SIZE * 1.3 + 6));
            }
            ctx.globalAlpha = 1;

            // Progress bar
            const totalProgress = (frameIndex + f) / totalFrames;
            ctx.fillStyle = vidDesign.accent + "26";
            ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
            ctx.fillStyle = vidDesign.accent + "b3";
            ctx.fillRect(0, HEIGHT - 4, WIDTH * totalProgress, 4);

            const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (!blob) return reject(new Error(`Canvas toBlob null at title card ch ${i + 1}`));
                blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
              }, "image/jpeg", JPEG_QUALITY);
            });
            lastKeyframeBuf = jpegBytes;
          }

          const frameName = `frame${String(frameIndex).padStart(6, "0")}.jpg`;
          await ffmpeg.writeFile(frameName, new Uint8Array(lastKeyframeBuf!));
          frameIndex++;
        }

        // ── Phase B: Full-page text pages ──
        for (let f = 0; f < layout.textFrames; f++) {
          const progress = f / layout.textFrames;
          const currentPage = Math.min(Math.floor(progress * layout.textPages), layout.textPages - 1);
          const needsNewKeyframe = f % KEYFRAME_INTERVAL === 0;

          if (needsNewKeyframe) {
            // Background
            ctx.fillStyle = vidDesign.bg;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);

            // ── Left image panel (cover-fit, rounded clip) ──
            if (img) {
              const radius = Math.round(HEIGHT * 0.012);
              ctx.save();
              ctx.beginPath();
              const r = radius;
              const { x: ix, y: iy, w: iw, h: ih } = IMAGE_PANEL;
              ctx.moveTo(ix + r, iy);
              ctx.lineTo(ix + iw - r, iy);
              ctx.quadraticCurveTo(ix + iw, iy, ix + iw, iy + r);
              ctx.lineTo(ix + iw, iy + ih - r);
              ctx.quadraticCurveTo(ix + iw, iy + ih, ix + iw - r, iy + ih);
              ctx.lineTo(ix + r, iy + ih);
              ctx.quadraticCurveTo(ix, iy + ih, ix, iy + ih - r);
              ctx.lineTo(ix, iy + r);
              ctx.quadraticCurveTo(ix, iy, ix + r, iy);
              ctx.closePath();
              ctx.clip();
              const fit = fitImageCover(img.width, img.height, IMAGE_PANEL);
              ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
              ctx.restore();
            } else {
              // Placeholder block if no image
              ctx.fillStyle = vidDesign.accent + "1a";
              ctx.fillRect(IMAGE_PANEL.x, IMAGE_PANEL.y, IMAGE_PANEL.w, IMAGE_PANEL.h);
            }

            // Subtle accent line between image and text
            ctx.fillStyle = vidDesign.accent + "26";
            ctx.fillRect(TEXT_X - Math.round(GUTTER / 2), PAGE_PAD_TOP, 2, HEIGHT - PAGE_PAD_TOP - PAGE_PAD_BOTTOM);

            let textY = PAGE_PAD_TOP;

            // Chapter label
            ctx.fillStyle = vidDesign.text + "99";
            ctx.font = `${LABEL_FONT_SIZE}px sans-serif`;
            ctx.textAlign = "left";
            ctx.fillText(`CHAPTER ${i + 1}`, TEXT_X, textY);
            textY += LABEL_FONT_SIZE + 12;

            // Chapter title
            ctx.fillStyle = vidDesign.accent;
            ctx.font = `bold ${TITLE_FONT_SIZE}px ${vidFont}, Georgia, serif`;
            const titleLines = wrapText(ctx, ch.title, bodyMaxW);
            for (let tl = 0; tl < Math.min(titleLines.length, 2); tl++) {
              ctx.fillText(titleLines[tl], TEXT_X, textY + tl * (TITLE_FONT_SIZE + 6));
            }
            textY += Math.min(titleLines.length, 2) * (TITLE_FONT_SIZE + 6) + 16;

            // Separator line
            ctx.strokeStyle = vidDesign.accent + "4d";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(TEXT_X, textY);
            ctx.lineTo(TEXT_X + 120, textY);
            ctx.stroke();
            textY += 20;

            // Body text for current page with karaoke highlighting
            const startLine = currentPage * bodyLinesPerPage;
            const visibleLines = layout.bodyLines.slice(startLine, startLine + bodyLinesPerPage);
            const totalBodyLines = Math.max(1, layout.bodyLines.length);
            const activeBodyLine = Math.min(totalBodyLines - 1, Math.floor(progress * totalBodyLines));
            const activeVisibleIdx = activeBodyLine - startLine;

            ctx.font = `${BODY_FONT_SIZE}px ${vidFont}, Georgia, serif`;
            ctx.textAlign = "left";
            for (let bl = 0; bl < visibleLines.length; bl++) {
              const line = visibleLines[bl];
              if (line === "") { continue; }
              const isActive = bl === activeVisibleIdx;
              ctx.fillStyle = isActive ? vidDesign.accent : vidDesign.text;
              ctx.fillText(line, TEXT_X, textY + bl * BODY_LINE_H);
              if (isActive) {
                const lineMetrics = ctx.measureText(line);
                ctx.fillRect(TEXT_X, textY + bl * BODY_LINE_H + 6, Math.min(lineMetrics.width, bodyMaxW), 2);
              }
            }

            // Page indicator
            if (layout.textPages > 1) {
              ctx.fillStyle = "rgba(136, 153, 170, 0.5)";
              ctx.font = `${LABEL_FONT_SIZE - 2}px sans-serif`;
              ctx.textAlign = "right";
              ctx.fillText(`${currentPage + 1} / ${layout.textPages}`, WIDTH - PAGE_PAD_X, HEIGHT - PAGE_PAD_BOTTOM + 10);
            }

            // Overall progress bar
            const totalProgress = (frameIndex) / totalFrames;
            ctx.fillStyle = vidDesign.accent + "1f";
            ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
            ctx.fillStyle = vidDesign.accent + "99";
            ctx.fillRect(0, HEIGHT - 4, WIDTH * totalProgress, 4);

            const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (!blob) return reject(new Error(`Canvas toBlob null at text page ch ${i + 1}`));
                blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
              }, "image/jpeg", JPEG_QUALITY);
            });
            lastKeyframeBuf = jpegBytes;
          }

          const frameName = `frame${String(frameIndex).padStart(6, "0")}.jpg`;
          await ffmpeg.writeFile(frameName, new Uint8Array(lastKeyframeBuf!));
          frameIndex++;

          if (f % 32 === 0) {
            if (cancelledRef.current) throw new Error("Export cancelled");
            setDownloadProgress({ current: frameIndex, total: totalFrames, stage: `Rendering: Ch. ${i + 1}/${total} — page ${currentPage + 1}/${layout.textPages}` });
            await new Promise(r => setTimeout(r, 0));
          }
        }
        // ── Memory cleanup: release chapter image + keyframe buffer ──
        chapterImages[i] = null; // allow GC to reclaim HTMLImageElement
        lastKeyframeBuf = null;
        ctx.clearRect(0, 0, WIDTH, HEIGHT); // flush canvas pixel buffer

        logHeapSnapshot(`after ch ${i + 1}/${total}`);
        console.log(`[VideoExport] Ch ${i + 1} done — ${layout.totalChFrames} frames (${layout.textPages} text pages)`);

        // Yield to allow GC between chapters
        await new Promise(r => setTimeout(r, 0));
      }
      console.log(`[VideoExport] Step 6 done ✓ — ${frameIndex} total frames`);

      // ── Step 7: Write audio & encode MP4 ──────────────────────────
      currentStep = "ffmpeg-encode"; setExportStep(currentStep);
      if (cancelledRef.current) throw new Error("Export cancelled");
      console.log("[VideoExport] Step 7: Writing audio + encoding MP4…");
      setDownloadProgress({ current: 0, total: 100, stage: "Encoding MP4…" });
      try {
        await ffmpeg.writeFile("audio.wav", wavData!);
      } catch (wavErr: any) {
        throw new Error(`FFmpeg writeFile audio.wav failed: ${wavErr.message}`);
      }
      wavData = null; // release ~20-50 MB WAV buffer
      // Also release the canvas — no longer needed for encoding
      canvas.width = 1; canvas.height = 1; // shrink canvas memory
      logHeapSnapshot("before ffmpeg-encode (WAV + canvas released)");

      activeFFmpegRef.current = ffmpeg;
      encodeStartTime.value = Date.now();

      try {
        await ffmpeg.exec([
          "-framerate", String(FPS),
          "-i", "frame%06d.jpg",
          "-i", "audio.wav",
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "128k",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-shortest",
          "output.mp4",
        ]);
      } catch (encErr: any) {
        throw new Error(`FFmpeg exec (encode) failed: ${encErr.message}`);
      }
      activeFFmpegRef.current = null;
      const encodeDuration = ((Date.now() - encodeStartTime.value) / 1000).toFixed(1);
      console.log(`[VideoExport] Step 7 done ✓ — encoded in ${encodeDuration}s`);

      // ── Step 8: Read output & download ───────────────────────────
      currentStep = "read-output"; setExportStep(currentStep);
      let mp4Data: any;
      try {
        mp4Data = await ffmpeg.readFile("output.mp4");
      } catch (readErr: any) {
        throw new Error(`FFmpeg readFile output.mp4 failed: ${readErr.message}`);
      }
      const mp4Blob = new Blob([mp4Data as unknown as BlobPart], { type: "video/mp4" });
      mp4Data = null;
      console.log(`[VideoExport] Step 8 ✓ — MP4 size: ${(mp4Blob.size / 1024 / 1024).toFixed(1)} MB`);

      // ── Step 8a: Free FFmpeg virtual FS + terminate worker BEFORE validation ──
      // This is critical: the audio-validation step previously decoded the entire
      // MP4 back into PCM via AudioContext, doubling memory at the worst moment
      // (encoded MP4 + WAV + JPEG frames all still in memory) which crashed the
      // tab on larger projects and triggered a browser auto-reload.
      try {
        const cleanups = ["audio.wav", "output.mp4"];
        for (let fi = 0; fi < frameIndex; fi++) cleanups.push(`frame${String(fi).padStart(6, "0")}.jpg`);
        const cleanupResults = await Promise.allSettled(cleanups.map((f) => ffmpeg.deleteFile(f)));
        const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
        if (cleanupFailures.length > 0) {
          console.warn(`[VideoExport] Cleanup completed with ${cleanupFailures.length} non-fatal file deletion issue(s)`);
        }
      } catch (cleanupErr) {
        console.warn("[VideoExport] FFmpeg FS cleanup skipped:", cleanupErr);
      }
      if (_ffmpegInstance) {
        try { _ffmpegInstance.terminate(); } catch {}
        _ffmpegInstance = null;
      }
      logHeapSnapshot("after ffmpeg release (pre-validate)");

      // ── Step 8b: Lightweight audio sanity check (no full PCM decode) ──
      currentStep = "audio-validate"; setExportStep(currentStep);
      setDownloadProgress({ current: 95, total: 100, stage: "Validating audio track…" });
      const hasNarration = !useBrowserNarration;
      if (hasNarration) {
        // Heuristic only: AAC ~128kbps ≈ 16 KB/s. If the MP4 is implausibly
        // small for the expected narration duration, warn the user but still
        // deliver the file. We intentionally do NOT call decodeAudioData here
        // — decoding the whole MP4 doubles peak memory and crashed the tab.
        const expectedMinBytes = totalMixDuration * 16000;
        if (totalMixDuration > 0 && mp4Blob.size < expectedMinBytes * 0.3) {
          console.warn(`[VideoExport] ⚠ MP4 size (${(mp4Blob.size / 1024 / 1024).toFixed(1)} MB) seems too small for ${totalMixDuration.toFixed(0)}s of audio`);
          toast({
            title: "⚠ Audio may be missing",
            description: "The video file is smaller than expected for the narration length. Check playback and re-export if needed.",
            variant: "destructive",
          });
        } else {
          console.log("[VideoExport] ✓ Audio size heuristic passed");
        }
      }

      const filename = `${safeName()}-audiovisual.mp4`;
      setPendingDownload({ blob: mp4Blob, filename });
      // Cache the encoded MP4 so the user can re-download instantly if their
      // browser, tab, or download was interrupted right after encoding.
      _lastVideoExport = { key: _videoCacheKey, blob: mp4Blob, filename, savedAt: Date.now() };
      setVideoCacheTick((n) => n + 1);
      // Persist to IndexedDB so it survives a full page reload (fire-and-forget)
      saveLastVideo({ key: _videoCacheKey, blob: mp4Blob, filename });
      console.log(`[VideoExport] ✓ MP4 cached for instant re-download (${(mp4Blob.size / 1024 / 1024).toFixed(1)} MB)`);

      downloadBlob(mp4Blob, filename);
      toast({ title: t("visual.videoDownloaded"), description: `${total} ${t("visual.videoChaptersDesc")} (MP4)` });
    } catch (err: any) {
      console.error(`[VideoExport] FAILED at step "${currentStep}":`, err);
      activeFFmpegRef.current = null;
      if (_ffmpegInstance) {
        try { _ffmpegInstance.terminate(); } catch {}
        _ffmpegInstance = null;
      }
      if (cancelledRef.current || err.message === "Export cancelled") {
        toast({ title: "Export stopped" });
      } else {
        const detail = `[${currentStep}] ${err.message}`;
        toast({ title: t("visual.videoExportFailed"), description: detail, variant: "destructive" });
      }
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
      setExportStep("");
    }
  }, [chapters, config, fetchNarrationBatch, toast, t, safeName]);

  const clearTtsCache = useCallback(() => {
    const size = _ttsCache.size;
    _ttsCache.clear();
    _ttsCacheVoiceKey = "";
    return size;
  }, []);

  // ── Per-chapter narration preview ──────────────────────────────────
  const [previewingChapter, setPreviewingChapter] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewAllActive, setPreviewAllActive] = useState(false);
  const previewAllAbortRef = useRef(false);
  const previewRequestRef = useRef(0);

  const stopCurrentAudio = useCallback(() => {
    previewRequestRef.current += 1;
    const a = previewAudioRef.current;
    if (a) { a.pause(); a.currentTime = 0; a.src = ""; }
    previewAudioRef.current = null;
    setPreviewingChapter(null);
  }, []);

  const playChapterAudio = useCallback((chapterId: string, text: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const requestId = ++previewRequestRef.current;
      try {
        const blob = await fetchAudioForChapter(text);
        if (requestId !== previewRequestRef.current || previewAllAbortRef.current) {
          resolve();
          return;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        previewAudioRef.current = audio;
        setPreviewingChapter(chapterId);

        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (previewAudioRef.current === audio) previewAudioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (previewAudioRef.current === audio) previewAudioRef.current = null;
          reject(new Error("Playback error"));
        };
        audio.onpause = () => {
          URL.revokeObjectURL(url);
          if (previewAudioRef.current === audio) previewAudioRef.current = null;
          resolve();
        };

        await audio.play();

        if (requestId !== previewRequestRef.current) {
          audio.pause();
          audio.currentTime = 0;
        }
      } catch (err: any) { reject(err); }
    });
  }, [fetchAudioForChapter]);

  const previewNarration = useCallback(async (chapterId: string, text: string) => {
    previewAllAbortRef.current = true;
    setPreviewAllActive(false);
    if (previewingChapter === chapterId && previewAudioRef.current) {
      stopCurrentAudio();
      return;
    }
    stopCurrentAudio();
    try {
      await playChapterAudio(chapterId, text);
      previewAudioRef.current = null;
      setPreviewingChapter(null);
    } catch (err: any) {
      toast({ title: "Narration preview failed", description: err.message, variant: "destructive" });
      previewAudioRef.current = null;
      setPreviewingChapter(null);
    }
  }, [previewingChapter, stopCurrentAudio, playChapterAudio, toast]);

  const previewAllNarration = useCallback(async () => {
    if (previewAllActive) {
      previewAllAbortRef.current = true;
      setPreviewAllActive(false);
      stopCurrentAudio();
      return;
    }
    const withBody = chapters.filter((c) => c.body);
    if (withBody.length === 0) return;

    previewAllAbortRef.current = false;
    setPreviewAllActive(true);

    for (const ch of withBody) {
      if (previewAllAbortRef.current) break;
      try {
        await playChapterAudio(ch.id, ch.body);
      } catch (err: any) {
        if (previewAllAbortRef.current) break;
        toast({ title: `Preview failed: ${ch.title}`, description: err.message, variant: "destructive" });
      }
    }
    setPreviewAllActive(false);
    previewAudioRef.current = null;
    setPreviewingChapter(null);
  }, [previewAllActive, chapters, stopCurrentAudio, playChapterAudio, toast]);

  const stopPreview = useCallback(() => {
    previewAllAbortRef.current = true;
    setPreviewAllActive(false);
    stopCurrentAudio();
  }, [stopCurrentAudio]);

  const isChapterCached = useCallback((text: string) => {
    const voiceId = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
    return isTtsCached(text.slice(0, 5000), voiceId, config.narrationSpeed, config.narrationDemeanour);
  }, [config.narrationVoice, config.narrationSpeed, config.narrationDemeanour]);

  // ── Text-only download (no images) ────────────────────────────────────
  const downloadAsTextBook = useCallback(async () => {
    setDownloading(true);
    const total = chapters.length;
    try {
      const txtDesign = resolveDesign(config);
      const txtDark = isDarkBg(txtDesign.bg);
      const txtControlsBg = txtDark ? `${txtDesign.bg}f2` : `${txtDesign.bg}f2`;
      const txtBtnBorder = txtDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
      const txtBtnHoverBg = txtDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";

      setDownloadProgress({ current: 0, total, stage: "Building text book…" });
      const txtBrandLogo = await getBrandLogoDataUrl();
      const txtBrandMark = txtBrandLogo
        ? `<img src="${txtBrandLogo}" alt="${BRAND_NAME}" style="height:28px;width:auto;display:block;margin:0 auto 12px;opacity:.95">`
        : "";
      const txtBrandFooter = `<div class="brand-footer"><a href="${BRAND_URL}" target="_blank" rel="noopener">${txtBrandLogo ? `<img src="${txtBrandLogo}" alt="" style="height:16px;width:auto;vertical-align:middle;margin-right:6px">` : ""}Created with ${BRAND_NAME}</a></div>`;

      const chaptersHtml = chapters.map((ch, i) => {
        setDownloadProgress({ current: i + 1, total, stage: `Processing Ch. ${i + 1}` });
        const sourceNotes = renderChapterSourceNotes(ch.references);
        return `
        <div class="chapter" id="ch${i}" ${i > 0 ? 'style="display:none"' : ''}>
          <p class="ch-num">Chapter ${i + 1} of ${total}</p>
          <h2>${escapeHtml(ch.title)}</h2>
          <div class="chapter-body">${escapeHtml(ch.body).replace(/\n/g, "<br>")}</div>
          ${sourceNotes}
        </div>`;
      }).join("\n");

      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.topic)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${txtDesign.fontFamily};background:${txtDesign.bg};color:${txtDesign.text};min-height:100vh;display:flex;flex-direction:column}
.cover{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px 20px;background:${txtDesign.chapterBg};overflow:hidden}
.cover-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.35;filter:blur(2px)}
.cover-content{position:relative;z-index:1}
.cover h1{font-size:clamp(2em,5vw,3.5em);margin-bottom:0.3em;color:${txtDesign.accent};text-shadow:0 2px 40px ${txtDesign.accent}33}
.cover .subtitle{color:${txtDesign.text}99;font-size:1.1em;margin-bottom:2em}
.cover button{background:${txtDesign.accent};color:${isDarkBg(txtDesign.accent) ? "#fff" : "#1a1a2e"};border:none;padding:14px 40px;font-size:1.1em;border-radius:30px;cursor:pointer;font-family:inherit;font-weight:bold;transition:transform 0.2s}
.cover button:hover{transform:scale(1.05)}
.reader{display:none;flex:1;flex-direction:column}
.reader.active{display:flex}
.content{flex:1;max-width:700px;margin:0 auto;padding:40px 24px;width:100%}
.ch-num{color:${txtDesign.text}88;font-size:0.8em;text-transform:uppercase;letter-spacing:3px;margin-bottom:8px}
.chapter h2{font-size:1.8em;margin-bottom:16px;color:${txtDesign.accent}}
.chapter-body{line-height:2;font-size:1.05em;color:${txtDesign.text}cc}
.source-notes{margin-top:28px;padding-top:18px;border-top:1px solid ${txtBtnBorder};font-size:.82em;color:${txtDesign.text}99}
.source-notes h3{margin-bottom:6px;color:${txtDesign.text};font-size:1em}
.source-notes p{margin-bottom:8px;line-height:1.5}
.source-notes ol{padding-left:20px;display:grid;gap:6px}
.source-notes a{color:${txtDesign.accent};overflow-wrap:anywhere}
.controls{position:sticky;bottom:0;background:${txtControlsBg};backdrop-filter:blur(12px);border-top:1px solid ${txtBtnBorder};padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:12px}
.controls button{background:none;border:1px solid ${txtBtnBorder};color:${txtDesign.text};width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:1.1em;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.controls button:hover{background:${txtBtnHoverBg}}
.controls button:disabled{opacity:0.3;cursor:not-allowed}
.page-info{color:${txtDesign.text}88;font-size:0.85em;min-width:80px;text-align:center}
.brand-footer{padding:18px 12px;text-align:center;font-size:.78em;color:${txtDesign.text}88;border-top:1px solid ${txtBtnBorder}}
.brand-footer a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.brand-footer a:hover{color:${txtDesign.accent}}
<\/style>
</head>
<body>
<div class="cover" id="coverPage">
  ${(() => { const coverUrl = referenceImage || chapters.find((c) => c.imageUrl)?.imageUrl; return coverUrl ? `<img class="cover-bg" src="${coverUrl}" alt="Cover">` : ""; })()}
  <div class="cover-content">
    ${txtBrandMark}
    <h1>${escapeHtml(config.topic)}</h1>
    <p class="subtitle">A ${escapeHtml(config.tone)} ${escapeHtml(config.theme)} book</p>
    <button onclick="startReading()">Start Reading</button>
  </div>
</div>
<div class="reader" id="readerView">
  <div class="content">${chaptersHtml}</div>
  <div class="controls">
    <button onclick="prevCh()" id="prevBtn" title="Previous">&#9664;</button>
    <span class="page-info" id="pageInfo">1 / ${total}</span>
    <button onclick="nextCh()" id="nextBtn" title="Next">&#9654;</button>
  </div>
</div>
${txtBrandFooter}
<script>
let cur=0,total=${total};
function startReading(){document.getElementById('coverPage').style.display='none';document.getElementById('readerView').classList.add('active');show(0)}
function show(i){document.querySelectorAll('.chapter').forEach(function(c,j){c.style.display=j===i?'block':'none'});document.getElementById('pageInfo').textContent=(i+1)+' / '+total;document.getElementById('prevBtn').disabled=i===0;document.getElementById('nextBtn').disabled=i===total-1;window.scrollTo(0,0)}
function prevCh(){if(cur>0){cur--;show(cur)}}
function nextCh(){if(cur<total-1){cur++;show(cur)}}
document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')prevCh();if(e.key==='ArrowRight')nextCh()});
<\/script>
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: "text/html" });
      saveAs(blob, `${safeName()}-text-only.html`);
      toast({ title: "Text book downloaded!", description: `${total} chapters, text only — no images.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, stage: "" });
    }
  }, [chapters, config, toast, safeName]);

  const manualDownload = useCallback(() => {
    if (pendingDownload) {
      downloadBlob(pendingDownload.blob, pendingDownload.filename);
    }
  }, [pendingDownload]);

  const dismissPendingDownload = useCallback(() => {
    setPendingDownload(null);
  }, []);

  // Compute how many chapters can be resumed from cache
  const voiceId = config.narrationVoice === "custom" ? "JBFqnCBsd6RMkjVDRZzb" : config.narrationVoice;
  const cachedChapterCount = chapters.filter((ch) =>
    ch.body && ch.body.trim().length >= 10 &&
    isTtsCached(ch.body.slice(0, 5000), voiceId, config.narrationSpeed, config.narrationDemeanour)
  ).length;
  const canResume = cachedChapterCount > 0 && cachedChapterCount < chapters.length;

  const ensureExportReady = useCallback(() => {
    try {
      const structure = buildBookStructure({ pages: chapters, config, sources, referenceImage });
      const result = assertBookStructureReadyForExport(structure, defaultBookStructurePolicy(config));
      if (result.warnings.length) console.warn("[BookReleaseGate]", result.warnings);
      return true;
    } catch (error: any) {
      toast({ title: "Book release gate blocked export", description: error?.message || "Book structure validation failed.", variant: "destructive" });
      return false;
    }
  }, [chapters, config, sources, referenceImage, toast]);

  return {
    downloading,
    downloadProgress,
    segmentInfo,
    narrationEta,
    exportStep,
    pendingDownload,
    lastAvDrift,
    manualDownload,
    dismissPendingDownload,
    downloadAsEbook: (...args: Parameters<typeof downloadAsEbook>) => ensureExportReady() ? downloadAsEbook(...args) : undefined,
    downloadAsEpub: (...args: Parameters<typeof downloadAsEpub>) => ensureExportReady() ? downloadAsEpub(...args) : undefined,
    downloadAsPdf: (...args: Parameters<typeof downloadAsPdf>) => ensureExportReady() ? downloadAsPdf(...args) : undefined,
    downloadAsAudio: (...args: Parameters<typeof downloadAsAudio>) => ensureExportReady() ? downloadAsAudio(...args) : undefined,
    downloadAsVideo: (...args: Parameters<typeof downloadAsVideo>) => ensureExportReady() ? downloadAsVideo(...args) : undefined,
    downloadAsTextBook: (...args: Parameters<typeof downloadAsTextBook>) => ensureExportReady() ? downloadAsTextBook(...args) : undefined,
    stopExport,
    clearTtsCache,
    ttsCacheSize: _ttsCache.size,
    cachedChapterCount,
    canResume,
    previewNarration,
    previewAllNarration,
    stopPreview,
    previewingChapter,
    previewAllActive,
    isChapterCached,
    hasCachedVideo: !!_lastVideoExport && videoCacheTick >= 0, // tick keeps reactivity
    cachedVideoFilename: _lastVideoExport?.filename ?? null,
    cachedVideoSize: _lastVideoExport?.blob.size ?? null,
    cachedVideoSavedAt: _lastVideoExport?.savedAt ?? null,
    redownloadLastVideo: () => {
      if (_lastVideoExport) {
        const { blob, filename } = _lastVideoExport;
        downloadBlob(blob, filename);
        toast({ title: "Re-downloading cached video", description: filename });
        // Auto-clear cache shortly after the browser starts the download.
        // Delay covers the blob URL lifetime in downloadBlob() (~1s).
        setTimeout(() => {
          _lastVideoExport = null;
          clearLastVideo();
          setVideoCacheTick((n) => n + 1);
          console.log("[VideoExport] Cached MP4 auto-cleared after successful re-download");
        }, 1500);
      }
    },
    clearCachedVideo: () => {
      _lastVideoExport = null;
      clearLastVideo();
      setVideoCacheTick((n) => n + 1);
      toast({ title: "Cached video cleared" });
    },
  };
}
