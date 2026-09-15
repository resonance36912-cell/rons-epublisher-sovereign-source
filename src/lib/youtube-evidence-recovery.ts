import type { Source } from "@/components/storyforge/StoryForgeContext";

const STT_BASE_URL = String(
  import.meta.env.VITE_OPEN_NOVA_STT_URL || "http://127.0.0.1:7864",
).replace(/\/$/, "");

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

async function requestLocalYouTubeStt(source: Source): Promise<YouTubeSttResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 360_000);
  try {
    const response = await fetch(`${STT_BASE_URL}/transcribe-url`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: source.url || source.canonicalUrl, mode: "fast" }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as YouTubeSttResponse | null;
    if (!response.ok || !payload?.text?.trim()) {
      throw new Error(payload?.error || `Local YouTube STT returned HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error("Local YouTube speech-to-text timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
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
      const result = await requestLocalYouTubeStt(source);
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
