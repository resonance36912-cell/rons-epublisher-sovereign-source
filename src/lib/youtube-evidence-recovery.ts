import type { Source } from "@/components/storyforge/StoryForgeContext";
import { isSovereignLocal } from "@/lib/sovereign-mode";

export type YouTubeSttRoute = {
  baseUrl: string | null;
  mode: "local" | "hosted";
};

export function resolveYouTubeSttRoute(
  localOnly: boolean,
  configuredUrl: string | undefined,
): YouTubeSttRoute {
  const configured = String(configuredUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (configured) {
    return { baseUrl: configured, mode: localOnly ? "local" : "hosted" };
  }
  if (localOnly) {
    return { baseUrl: "/open-nova-stt", mode: "local" };
  }
  return { baseUrl: null, mode: "hosted" };
}

const STT_ROUTE = resolveYouTubeSttRoute(
  isSovereignLocal(),
  import.meta.env.VITE_OPEN_NOVA_STT_URL,
);

export type YouTubeRecoveryProgress = {
  current: number;
  total: number;
  title: string;
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
    if (!host.endsWith("youtube.com")) return false;
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

async function requestYouTubeStt(source: Source): Promise<YouTubeSttResponse> {
  if (!STT_ROUTE.baseUrl) {
    throw new Error("Hosted speech-to-text is unavailable for this deployment");
  }

  const retryableStatuses = new Set([429, 502, 503, 504]);
  const generalMaxAttempts = 2;
  const busyMaxAttempts = 8;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= busyMaxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 360_000);
    let response: Response | null = null;
    try {
      response = await fetch(`${STT_ROUTE.baseUrl}/transcribe-url`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url || source.canonicalUrl, mode: "fast" }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new Error(`${STT_ROUTE.mode === "local" ? "Local" : "Hosted"} YouTube speech-to-text timed out`);
      }
      lastError = error as Error;
      if (attempt >= generalMaxAttempts) throw lastError;
    } finally {
      window.clearTimeout(timer);
    }

    let retryDelayMs = 400 * attempt;
    let maxAttempts = generalMaxAttempts;

    if (response) {
      const payload = await response.json().catch(() => null) as YouTubeSttResponse | null;
      if (response.ok && payload?.text?.trim()) return payload;

      const busy = response.status === 503 && payload?.error === "stt_service_busy";
      maxAttempts = busy ? busyMaxAttempts : generalMaxAttempts;
      lastError = new Error(
        busy
          ? "Speech-to-text is busy with another transcription; waiting for capacity."
          : payload?.error || `${STT_ROUTE.mode === "local" ? "Local" : "Hosted"} YouTube STT returned HTTP ${response.status}`,
      );
      if (!retryableStatuses.has(response.status) || attempt >= maxAttempts) throw lastError;

      if (busy) {
        const retryAfter = Number(response.headers?.get?.("Retry-After") || "");
        const serverDelayMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 0;
        retryDelayMs = Math.min(10_000, Math.max(serverDelayMs, attempt * 2_000));
      }
    }

    await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
  }

  throw lastError || new Error(`${STT_ROUTE.mode === "local" ? "Local" : "Hosted"} YouTube speech-to-text failed`);
}

export async function recoverYouTubeEvidenceSources(
  sources: Source[],
  onProgress?: (progress: YouTubeRecoveryProgress) => void,
): Promise<Source[]> {
  const queue = (sources || []).filter(needsLocalRecovery);
  if (!queue.length) return sources;
  const recovered = new Map<string, Source>();
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    onProgress?.({ current: index + 1, total: queue.length, title: source.title });
    try {
      const result = await requestYouTubeStt(source);
      recovered.set(source.id, {
        ...source,
        content: result.text!.trim(),
        status: "ready",
        transcriptAvailable: true,
        contentAvailability: "speech_to_text",
        extractionProvider: STT_ROUTE.mode === "local" ? "rons-local-whisper-youtube" : "rons-cloud-whisper-youtube",
        provider: result.quality?.provider || (STT_ROUTE.mode === "local" ? "rons-local-whisper" : "rons-cloud-whisper"),
        retrievedAt: result.retrieved_at || source.retrievedAt,
        contentHash: result.content_hash || source.contentHash,
        evidenceReview: "not_reviewed",
        diagnostic: `${STT_ROUTE.mode === "local" ? "Local" : "Hosted"} speech-to-text extracted from public YouTube audio; factual verification remains separate.`,
      });
    } catch (error) {
      recovered.set(source.id, {
        ...source,
        status: "error",
        contentAvailability: "metadata_only",
        diagnostic: `No public captions were available and ${STT_ROUTE.mode === "local" ? "local" : "hosted"} speech-to-text recovery failed: ${(error as Error).message}`,
      });
    }
  }
  return sources.map((source) => recovered.get(source.id) || source);
}
