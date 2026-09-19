import type { Source } from "@/components/storyforge/StoryForgeContext";

const STT_BASE_URL = String(
  import.meta.env.VITE_OPEN_NOVA_STT_URL || "/open-nova-stt",
).replace(/\/$/, "");

export type YouTubeRecoveryProgress = {
  current: number;
  total: number;
  title: string;
  stage?: string;
};

type YouTubeSttResponse = {
  text?: string;
  source_url?: string;
  video_id?: string;
  transcript_type?: string;
  acquisition?: string;
  retrieved_at?: string;
  content_hash?: string | null;
  quality?: {
    provider?: string;
    model?: string;
    mode?: string;
    word_count?: number;
    final_status?: string;
    evidence_status?: string;
  };
  error?: string;
};
function isDirectYouTubeVideo(source: Source): boolean {
  const raw = source.url || source.canonicalUrl || "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean).length === 1;
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) return false;
    return url.pathname === "/watch" && !!url.searchParams.get("v") || /^\/shorts\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

function needsLocalRecovery(source: Source): boolean {
  if (!isDirectYouTubeVideo(source)) return false;
  return source.contentAvailability === "metadata_only"
    || source.transcriptAvailable === false
    || /youtube-public-metadata/i.test(source.extractionProvider || "");
}

function abortError(): DOMException {
  return new DOMException("Recovery stopped", "AbortError");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const stop = () => { window.clearTimeout(timer); reject(abortError()); };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

type SttJob = {
  jobId?: string;
  status?: "queued" | "running" | "complete" | "failed";
  stage?: string;
  result?: YouTubeSttResponse;
  error?: string;
  reason?: string;
};

async function requestJob(path: string, init: RequestInit, signal?: AbortSignal): Promise<SttJob> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    const timer = window.setTimeout(stop, 15_000);
    let retry = false;
    try {
      const response = await fetch(`${STT_BASE_URL}${path}`, {
        ...init, credentials: "omit", cache: "no-store", signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as SttJob | null;
      if (signal?.aborted) throw abortError();
      if (response.ok && payload) return payload;
      retry = [429, 502, 503, 504, 524].includes(response.status);
      if (!retry || attempt === 2) {
        throw new Error(payload?.reason || payload?.error || (response.status === 404
          ? "Transcription job service is unavailable or the job expired. Retry after the service is updated."
          : `Local transcription request failed (HTTP ${response.status})`));
      }
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // Network failures and short transport timeouts can safely retry: submission is deduplicated.
      if (!(error instanceof TypeError) && (error as Error).name !== "AbortError") throw error;
      if (attempt === 2) throw new Error("Cannot reach local transcription jobs. Retry recovery to reconnect.");
      retry = true;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
    if (retry) await wait(2_000 * (attempt + 1), signal);
  }
  throw new Error("Transcription job request failed");
}

async function requestLocalYouTubeStt(
  source: Source, onStage?: (stage: string) => void, signal?: AbortSignal,
): Promise<YouTubeSttResponse> {
  let job = await requestJob("/transcription-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: source.url || source.canonicalUrl, mode: "fast" }),
  }, signal);
  if (!job.jobId) throw new Error("Transcription service returned no job ID");
  const jobId = job.jobId;
  const deadline = Date.now() + 30 * 60_000;
  while (true) {
    if (signal?.aborted) throw abortError();
    onStage?.(job.stage || job.status || "queued");
    if (job.status === "complete") {
      if (!job.result?.text?.trim()) throw new Error("Local transcription returned no speech");
      return job.result;
    }
    if (job.status === "failed") throw new Error(job.reason || job.error || "Local transcription failed");
    if (!["queued", "running"].includes(job.status || "")) throw new Error("Invalid transcription job status");
    if (Date.now() >= deadline) throw new Error("Stopped waiting after 30 minutes. Retry recovery to reconnect to the existing job.");
    await wait(2_000, signal);
    job = await requestJob(`/transcription-jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, signal);
  }
}

export async function recoverYouTubeEvidenceSources(
  sources: Source[],
  onProgress?: (progress: YouTubeRecoveryProgress) => void,
  signal?: AbortSignal,
): Promise<Source[]> {
  const queue = (sources || []).filter(needsLocalRecovery);
  if (!queue.length) return sources;
  const recovered = new Map<string, Source>();
  for (let index = 0; index < queue.length; index += 1) {
    if (signal?.aborted) throw abortError();
    const source = queue[index];
    onProgress?.({ current: index + 1, total: queue.length, title: source.title });
    try {
      const result = await requestLocalYouTubeStt(source, (stage) => {
        onProgress?.({ current: index + 1, total: queue.length, title: source.title, stage });
      }, signal);
      recovered.set(source.id, {
        ...source,
        content: result.text!.trim(),
        status: "ready",
        transcriptAvailable: true,
        contentAvailability: "speech_to_text",
        extractionProvider: "rons-local-whisper-youtube",
        provider: result.quality?.provider || "rons-local-whisper",
        retrievedAt: result.retrieved_at || source.retrievedAt,
        contentHash: result.content_hash || source.contentHash,
        evidenceReview: "not_reviewed",
        diagnostic: "Local speech-to-text extracted from public YouTube audio; factual verification remains separate.",
      });
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") throw abortError();
      recovered.set(source.id, {
        ...source,
        status: "error",
        contentAvailability: "metadata_only",
        diagnostic: `No public captions were available and local speech-to-text recovery failed: ${(error as Error).message}`,
      });
    }
  }
  return sources.map((source) => recovered.get(source.id) || source);
}
