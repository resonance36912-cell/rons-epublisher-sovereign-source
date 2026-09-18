import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Source, SlideChapter, StoryConfig } from "@/components/storyforge/StoryForgeContext";
import { DEFAULT_IMAGE_DAILY_LIMIT, getUsageLimit } from "@/lib/usage-limits";
import {
  beginCorrelationScope,
  endCorrelationScope,
  getCorrelationId,
  createAuditRequestId,
} from "@/lib/storage-audit";
import {
  AI_INPUT_LIMITS,
  assertMaxBinarySize,
  assertMaxCount,
  assertMaxLength,
} from "@/lib/ai-input-limits";
import { friendlyEdgeErrorMessage } from "@/lib/edge-error";
import { recordAiAttempt, extractStatusCode } from "@/lib/ai-attempt-log";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { getFreeCloudQualityEnabled, parseHybridJson, requestHybridText } from "@/lib/free-cloud-quality";
import { qualifyDiscoverySources } from "@/lib/research-source-quality";

const OPEN_NOVA_RESEARCH_BASE_URL = String(
  import.meta.env.VITE_OPEN_NOVA_RESEARCH_URL || "/open-nova-research",
 ).replace(/\/$/, "");
const OPEN_NOVA_IMAGE_URL = String(
  import.meta.env.VITE_RONS_IMAGE_URL || "http://127.0.0.1:7865",
).replace(/\/$/, "");

async function localImageRequest(body: Record<string, unknown>) {
  const maxAttempts = 4;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${OPEN_NOVA_IMAGE_URL}/v1/images/generate`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json().catch(() => null) as any;
      if (response.ok && payload?.imageUrl) return payload;
      const retryable = response.status === 503 && (payload?.retryable === true || payload?.error === "image_service_busy");
      if (!retryable || attempt === maxAttempts) throw new Error(payload?.error || `Local image service returned HTTP ${response.status}`);
      const retryAfter = Math.max(1, Number(response.headers.get("Retry-After") || 2));
      await new Promise((resolve) => window.setTimeout(resolve, retryAfter * 1000 * attempt));
    } catch (error) {
      if ((error as Error)?.name === "AbortError") lastError = new Error("Local image generation timed out after 120 seconds");
      else lastError = error instanceof Error ? error : new Error("RONS local image service request failed");
      if (attempt === maxAttempts || !/busy|503|failed to fetch|network/i.test(lastError.message)) throw lastError;
      await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
    } finally { window.clearTimeout(timeout); }
  }
  throw lastError || new Error("RONS local image service is unavailable on port 7865");
}

async function openNovaResearchRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`${OPEN_NOVA_RESEARCH_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: "omit",
    });
    const payload = await response.json().catch(() => null) as
      | (T & { detail?: string; error?: string })
      | null;
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || `Open Nova research returned HTTP ${response.status}`);
    }
    if (!payload) throw new Error("Open Nova research returned an empty response");
    return payload;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error(`Open Nova research timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const message = (error as Error)?.message || "Research request failed";
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      throw new Error(
        "Open Nova's governed research service is unavailable on local port 8787. " +
        "Install the sovereign research patch and restart Open Nova, then retry.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}


function localSentenceChunks(text: string, target = 1400): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length <= target) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= target) {
      current = paragraph;
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    current = "";
    for (const sentence of sentences) {
      if ((current + " " + sentence).length > target && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = `${current} ${sentence}`.trim();
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [cleaned];
}

export function localFormatChapters(text: string, config: Partial<StoryConfig>): SlideChapter[] {
  const topic = (config.topic || "Untitled").trim();
  const depth = config.depth || "standard";
  const maxChapters = depth === "summary" ? 6 : depth === "extensive" ? 20 : 12;
  const exactNoise = /^(chapter\s*\d*|section\s*\d*|page\s*\d*|help|send feedback|main menu|google apps?|true|false|\d+|source:\s*https?:\/\/|https?:\/\/\S+)$/i;
  const boilerplate = /(privacy policy|terms of service|cookie settings|sign in|log in|subscribe|all rights reserved|advertisement|send feedback)/i;
  const paragraphs = text.replace(/\r/g, "").split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 90 && !exactNoise.test(p) && !(p.length < 320 && boilerplate.test(p)));
  const seen = new Set<string>();
  const retained = paragraphs.filter((body) => {
    const key = body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let source = retained.length ? retained : [text.trim()].filter(Boolean);
  if (!source.length) return [];
  const targetChars = depth === "summary" ? 2600 : depth === "extensive" ? 2200 : 2400;
  let totalChars = source.reduce((sum, body) => sum + body.length, 0);
  const requestedCount = config.targetStoryPages == null ? undefined : Math.max(1, Math.floor(config.targetStoryPages));
  if (requestedCount && requestedCount > maxChapters) throw new Error(`Requested ${requestedCount} story pages exceeds the ${maxChapters}-page ${depth} limit.`);
  if (requestedCount && config.storyPageMinWords && config.storyPageMinWords > 0) {
    const sourceWords = source.join(" ").trim().split(/\s+/).filter(Boolean).length;
    const requiredWords = requestedCount * Math.floor(config.storyPageMinWords);
    if (sourceWords < requiredWords) {
      throw new Error(`Source material has ${sourceWords} words; the approved ${requestedCount}-page brief requires at least ${requiredWords} words (${Math.floor(config.storyPageMinWords)} per page).`);
    }
  }
  if (requestedCount && source.length < requestedCount) {
    const expanded = localSentenceChunks(source.join("\n\n"), Math.max(300, Math.ceil(totalChars / requestedCount)));
    if (expanded.length > source.length) source = expanded;
    totalChars = source.reduce((sum, body) => sum + body.length, 0);
  }
  const targetCount = requestedCount ?? Math.min(maxChapters, source.length, Math.max(1, Math.ceil(totalChars / targetChars)));
  const boundedTargetCount = Math.min(maxChapters, source.length, targetCount);
  const groups: string[][] = Array.from({ length: boundedTargetCount }, () => []);
  const targetSize = Math.max(1, Math.ceil(totalChars / boundedTargetCount));
  let groupIndex = 0;
  let groupChars = 0;
  for (const paragraph of source) {
    if (groupIndex < boundedTargetCount - 1 && groups[groupIndex].length && groupChars + paragraph.length > targetSize) {
      groupIndex += 1;
      groupChars = 0;
    }
    groups[groupIndex].push(paragraph);
    groupChars += paragraph.length;
  }
  const chapters = groups.filter((group) => group.length > 0).map((group, index) => ({
    id: `local-page-${index + 1}`,
    title: index === 0 ? topic : `${topic} — Part ${index + 1}`,
    body: group.join("\n\n"),
    imagePrompt: `Production storyboard frame for ${topic}, scene ${index + 1}; depict only concrete visual details supported by this scene text; cinematic composition, coherent characters, no invented events`,
    notes: `Relevance-gated locally; ${source.length} substantive source blocks merged into a governed ${maxChapters}-scene maximum. Short/noisy fragments are suppressed.`,
  }));
  if (chapters.length > maxChapters) throw new Error("Local storyboard exceeded its governed story-page budget");
  if (requestedCount && chapters.length !== requestedCount) throw new Error(`Could not satisfy the exact ${requestedCount}-story-page brief without inventing content; generated ${chapters.length}.`);
  return chapters;
}

/** Header name used to propagate the storyboard request id to edge functions. */
const REQUEST_ID_HEADER = "x-request-id";

/** Returns the active storyboard request id, minting one if none exists. */
function currentStoryboardRequestId(): string {
  return getCorrelationId("storyboard") ?? createAuditRequestId();
}

/** Build invoke options that propagate the storyboard request id end-to-end. */
function withRequestId<T extends Record<string, unknown>>(
  body: T,
  requestId: string = currentStoryboardRequestId(),
): { body: T & { requestId: string }; headers: Record<string, string> } {
  return {
    body: { ...body, requestId } as T & { requestId: string },
    headers: { [REQUEST_ID_HEADER]: requestId },
  };
}

// One-shot per browser session: only nudge the user once about free-tier images.
let _freeTierImageToastShown = false;

// ── Types ────────────────────────────────────────────────────────────────

type DiscoveredSource = {
  url: string;
  title: string;
  description: string;
  type: "web" | "youtube";
  selected: boolean;
};

type OutlineChapter = {
  title: string;
  synopsis: string;
  imagePrompt?: string;
  diagramPrompt?: string;
  references?: string[];
};

type StoryboardProgress = {
  message: string;
  percent: number;
  /** Correlation id for the entire storyboard flow — surface in UI so the
   *  user can copy it for support / audit-log lookup. */
  requestId?: string;
  /** True while a retry-after-timeout is in flight. */
  retrying?: boolean;
  /** 1-based retry attempt number. */
  attempt?: number;
  /** Total attempts that will be made before failing. */
  maxAttempts?: number;
  /** Human-readable reason a retry was triggered (e.g. "Timed out after 55s"). */
  retryReason?: string;
};

/** Invoke an edge function with a soft timeout and automatic retry on
 *  transient failures (timeout / network / 5xx gateway errors). */
async function invokeWithRetryAndTimeout<T = unknown>(
  name: string,
  options: Parameters<typeof supabase.functions.invoke>[1],
  {
    timeoutMs = 55_000,
    maxAttempts = 3,
    onRetry,
  }: {
    timeoutMs?: number;
    maxAttempts?: number;
    onRetry?: (attempt: number, maxAttempts: number, reason: string) => void;
  } = {},
): Promise<{ data: T | null; error: unknown }> {
  const isTransient = (msg: string) => {
    const m = msg.toLowerCase();
    return (
      m.includes("timed out") ||
      m.includes("timeout") ||
      m.includes("network") ||
      m.includes("failed to fetch") ||
      m.includes("502") ||
      m.includes("503") ||
      m.includes("504") ||
      m.includes("gateway")
    );
  };

  const requestId =
    (options as { headers?: Record<string, string> })?.headers?.[REQUEST_ID_HEADER] ??
    (options as { body?: Record<string, unknown> })?.body?.requestId as string | undefined;
  const callId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    recordAiAttempt({
      id: callId, fn: name, requestId, attempt, maxAttempts, timeoutMs,
      startedAt, status: "started",
    });
    try {
      const result = await Promise.race([
        supabase.functions.invoke(name, options),
        new Promise<{ data: null; error: Error }>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Edge function timed out after ${Math.round(timeoutMs / 1000)}s`)),
            timeoutMs,
          ),
        ),
      ]);
      const r = result as { data: T | null; error: unknown };
      const errMsg = (r.error as { message?: string } | null)?.message ?? "";
      const endedAt = Date.now();
      if (r.error && errMsg && isTransient(errMsg) && attempt < maxAttempts) {
        recordAiAttempt({
          id: callId, fn: name, requestId, attempt, maxAttempts, timeoutMs,
          startedAt, endedAt, status: "retrying", transient: true,
          statusCode: extractStatusCode(r.error), message: errMsg,
        });
        onRetry?.(attempt + 1, maxAttempts, errMsg);
        await new Promise((res) => setTimeout(res, 1500 * attempt));
        continue;
      }
      recordAiAttempt({
        id: callId, fn: name, requestId, attempt, maxAttempts, timeoutMs,
        startedAt, endedAt,
        status: r.error ? "failed" : "succeeded",
        statusCode: r.error ? extractStatusCode(r.error) : 200,
        message: r.error ? errMsg : undefined,
      });
      return r;
    } catch (e) {
      lastError = e;
      const msg = (e as Error)?.message ?? "";
      const endedAt = Date.now();
      const timedOut = msg.toLowerCase().includes("timed out");
      if (isTransient(msg) && attempt < maxAttempts) {
        recordAiAttempt({
          id: callId, fn: name, requestId, attempt, maxAttempts, timeoutMs,
          startedAt, endedAt, status: "retrying", transient: true, timedOut,
          statusCode: extractStatusCode(e), message: msg || "Timed out",
        });
        onRetry?.(attempt + 1, maxAttempts, msg || "Timed out");
        await new Promise((res) => setTimeout(res, 1500 * attempt));
        continue;
      }
      recordAiAttempt({
        id: callId, fn: name, requestId, attempt, maxAttempts, timeoutMs,
        startedAt, endedAt, status: "failed", timedOut,
        statusCode: extractStatusCode(e), message: msg,
      });
      throw e;
    }
  }
  throw lastError;
}

/** Error subclass carrying the storyboard request id for UI surfacing. */
export class StoryboardError extends Error {
  requestId: string;
  constructor(message: string, requestId: string) {
    super(message);
    this.name = "StoryboardError";
    this.requestId = requestId;
  }
}

type JobStatus = {
  jobId: string;
  status: string;
  progress: number;
  statusMessage: string;
  error?: string;
  sources?: unknown[];
  output?: unknown;
  chunks?: unknown[];
  processedSources?: Source[];
};

async function getImageUsageCount(): Promise<number | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase.rpc("get_daily_usage", {
    _user_id: user.id,
    _service: "generate-chapter-image",
  });

  if (error || typeof data !== "number") return null;
  return data;
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Image generation failed";
  return friendlyEdgeErrorMessage(error, fallback);
}

function shouldBubbleImageError(message: string): boolean {
  const normalized = message.toLowerCase();
  return ["daily image generation limit reached", "rate limit", "credits exhausted", "unauthorized"].some((term) => normalized.includes(term));
}

// ── Research Pipeline (Job-based) ────────────────────────────────────────

/** Start a research job — returns immediately with jobId */
export async function startResearchJob(
  topic: string,
  config?: Partial<StoryConfig>,
  userUrls?: string[]
): Promise<{ jobId: string }> {
  assertMaxLength("topic", topic, AI_INPUT_LIMITS.topic);
  if (OPEN_NOVA_LOCAL_ONLY) {
    return await openNovaResearchRequest<{ jobId: string }>(
      "/v1/research/jobs",
      {
        method: "POST",
        body: JSON.stringify({ topic, config: config || {}, urls: userUrls || [] }),
      },
      20_000,
    );
  }
  const mergedConfig = { ...(config || {}), userUrls: userUrls || [] };
  const { data, error } = await supabase.functions.invoke("research-pipeline", {
    body: { topic, config: mergedConfig },
  });

  if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to start research job"));
  if (data?.error) throw new Error(data.error);
  return { jobId: data.jobId };
}

/** Poll job status */
export async function getJobStatus(
  jobId: string,
  includeResults = false
): Promise<JobStatus> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    return await openNovaResearchRequest<JobStatus>(
      `/v1/research/jobs/${encodeURIComponent(jobId)}?include_results=${includeResults ? "true" : "false"}`,
      {},
      15_000,
    );
  }
  const { data, error } = await supabase.functions.invoke("job-status", {
    body: { jobId, includeResults },
  });

  if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to get job status"));
  if (data?.error) throw new Error(data.error);
  return data as JobStatus;
}

/** Poll until job reaches a terminal state, calling onProgress for updates */
export async function pollResearchJob(
  jobId: string,
  onProgress?: (status: JobStatus) => void,
  { intervalMs = 2000, maxWaitMs = 300000 }: { intervalMs?: number; maxWaitMs?: number } = {}
): Promise<JobStatus> {
  const startTime = Date.now();
  const terminalStates = ["complete", "partial_complete", "failed"];

  while (Date.now() - startTime < maxWaitMs) {
    const isTerminal = await (async () => {
      const status = await getJobStatus(jobId, false);
      onProgress?.(status);
      return terminalStates.includes(status.status);
    })();

    if (isTerminal) {
      // Final fetch with results
      return await getJobStatus(jobId, true);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Research job timed out after " + Math.round(maxWaitMs / 1000) + "s");
}

// ── Legacy discover/process (kept for compatibility, now uses job pipeline) ──

export async function discoverSources(
  topic: string
): Promise<{ sources: DiscoveredSource[]; stats: { total: number; youtube: number; web: number } }> {
  assertMaxLength("topic", topic, AI_INPUT_LIMITS.topic);
  if (OPEN_NOVA_LOCAL_ONLY) {
    const raw = await openNovaResearchRequest<{
      sources: DiscoveredSource[];
      stats: { total: number; youtube: number; web: number };
    }>("/v1/research/discover", { method: "POST", body: JSON.stringify({ topic }) }, 45_000);
    const sources = qualifyDiscoverySources(topic, raw.sources || []);
    return {
      sources,
      stats: { total: sources.length, youtube: sources.filter((s) => s.type === "youtube").length, web: sources.filter((s) => s.type === "web").length },
    };
  }
  const { data, error } = await supabase.functions.invoke("discover-sources", {
    body: { topic },
  });

  if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to discover sources"));
  if (data?.error) throw new Error(data.error);

  return { sources: data.sources || [], stats: data.stats || { total: 0, youtube: 0, web: 0 } };
}

export async function verifyResearchSources(
  urls: string[],
): Promise<{
  results: Array<{ url: string; accessible: boolean; statusCode?: number; reason?: string }>;
  stats: { total: number; accessible: number; unavailable: number };
}> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    return await openNovaResearchRequest(
      "/v1/research/verify",
      { method: "POST", body: JSON.stringify({ urls }) },
      45_000,
    );
  }

  return {
    results: urls.map((url) => ({ url, accessible: true })),
    stats: { total: urls.length, accessible: urls.length, unavailable: 0 },
  };
}

export async function processSources(
  sources: Source[]
): Promise<Source[]> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    return (sources || []).map((source) => {
      const explicitlyUnavailable = source.status === "error"
        || source.contentAvailability === "metadata_only"
        || source.contentAvailability === "failed";
      if (explicitlyUnavailable) return { ...source, status: "error" as const };
      if (source.status === "processing") return source;
      return {
        ...source,
        status: source.content?.trim() ? "ready" as const : "error" as const,
      };
    });
  }
  for (const s of sources || []) {
    assertMaxLength(`source "${s.title || s.id}" title`, s.title, AI_INPUT_LIMITS.sourceTitle);
    if (typeof s.content === "string") {
      if (s.content.startsWith("data:")) {
        assertMaxBinarySize(`source "${s.title || s.id}"`, s.content, AI_INPUT_LIMITS.sourceBinaryBytes);
      } else {
        assertMaxLength(`source "${s.title || s.id}" content`, s.content, AI_INPUT_LIMITS.sourceTextChars);
      }
    }
  }
  const { data, error } = await supabase.functions.invoke("process-sources", {
    body: { sources },
  });

  if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to process sources"));
  if (data?.error) throw new Error(data.error);

  return (data.sources || []).map((s: Source) => ({
    ...s,
    id: s.id || crypto.randomUUID(),
  }));
}

// ── Storyboard Generation (unchanged) ───────────────────────────────────

export async function generateStoryboard(
  sources: Source[],
  config: StoryConfig,
  onProgress?: (update: StoryboardProgress) => void
): Promise<SlideChapter[]> {
  const readySources = (sources || []).filter((source) => source.content?.trim() && source.status === "ready");
  if (config.researchBasis === "topic_only" && readySources.length === 0) {
    const requestId = `topic-only-${Date.now()}`;
    onProgress?.({ message: "Creating an explicitly unresearched topic-only draft…", percent: 80, requestId });
    const chapters = localFormatChapters(config.topic || "Untitled", config).map((chapter) => ({
      ...chapter,
      references: [],
      notes: `${chapter.notes || ""} Research basis: topic-only draft; no usable evidence sources were supplied.`.trim(),
    }));
    onProgress?.({ message: "Topic-only draft ready — factual verification required", percent: 100, requestId });
    return chapters;
  }
  if (OPEN_NOVA_LOCAL_ONLY) {
    const requestId = `local-${Date.now()}`;
    onProgress?.({ message: "Structuring local source material…", percent: 60, requestId });
    const sourceTerms = Array.from(new Set((config.topic || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)));
    const scoredSources = readySources.map((source, index) => {
      const haystack = `${source.title || ""} ${(source.content || "").slice(0, 12000)}`.toLowerCase();
      const score = sourceTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { source, index, score };
    });
    const topical = sourceTerms.length && scoredSources.some((item) => item.score > 0)
      ? scoredSources.filter((item) => item.score > 0)
      : scoredSources;
    const usable = topical
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 8)
      .sort((a, b) => a.index - b.index)
      .map((item) => item.source);
    const text = usable.map((source) => source.content || "").join("\n\n");
    let chapters = localFormatChapters(text || config.topic || "Untitled", config).map((chapter) => ({
      ...chapter,
      references: usable.map((source) => source.url ? `${source.title} (${source.url})` : source.title),
    }));
    if (getFreeCloudQualityEnabled() && chapters.length > 0 && usable.length > 0) {
      try {
        onProgress?.({ message: "Refining prose through the governed free-cloud router…", percent: 82, requestId });
        const sourceExcerpts = usable.map((source) => ({
          title: source.title,
          url: source.url,
          excerpt: (source.content || "").slice(0, 4500),
        }));
        const prompt = JSON.stringify({
          topic: config.topic,
          theme: config.theme,
          tone: config.tone,
          exactStoryPages: chapters.length,
          sourceExcerpts,
          baselineChapters: chapters.map((chapter) => ({ title: chapter.title, body: chapter.body, imagePrompt: chapter.imagePrompt })),
        });
        const refined = await requestHybridText({
          prompt,
          allowCloud: true,
          timeoutMs: 90_000,
          system: "You are the Resonance ePublisher editorial refinement engine. Use ONLY the supplied source excerpts and baseline chapters. Preserve the exact story-page count and factual meaning. Never invent facts, dates, names, quotations, dialogue or events. Improve structure, clarity, narrative flow and visual prompts for the requested theme and tone. Return JSON only as {\"chapters\":[{\"title\":string,\"body\":string,\"imagePrompt\":string}]}. No markdown fences.",
        });
        const parsed = parseHybridJson<{ chapters?: Array<{ title?: string; body?: string; imagePrompt?: string }> }>(refined.text);
        const candidate = parsed?.chapters;
        const valid = Array.isArray(candidate) && candidate.length === chapters.length && candidate.every((chapter) =>
          typeof chapter?.title === "string" && chapter.title.trim().length > 0 &&
          typeof chapter?.body === "string" && chapter.body.trim().length > 0,
        );
        if (valid && candidate) {
          chapters = chapters.map((base, index) => ({
            ...base,
            title: candidate[index].title!.trim(),
            body: candidate[index].body!.trim(),
            imagePrompt: candidate[index].imagePrompt?.trim() || base.imagePrompt,
            notes: `${base.notes || ""} Quality refinement: ${refined.provider} (${refined.route || "governed"}).`.trim(),
          }));
          onProgress?.({ message: `Quality refinement complete via ${refined.provider}`, percent: 96, requestId });
        }
      } catch (error) {
        console.warn("Free-cloud storyboard refinement unavailable; retaining local storyboard:", error);
        onProgress?.({ message: "Free-cloud unavailable; keeping governed local storyboard", percent: 96, requestId });
      }
    }
    onProgress?.({ message: "Local storyboard ready", percent: 100, requestId });
    return chapters;
  }
  // Open a single correlation scope for the whole storyboard flow. Every
  // edge invocation below — outline, each chapter batch, and any chapter
  // image generated by `generateChapterImage` while this scope is live —
  // shares the same request id, so the resulting audit rows
  // (storage_access_logs + api_usage_logs) can be joined together.
  assertMaxCount("sources", (sources || []).length, AI_INPUT_LIMITS.storyboardMaxSources);
  for (const s of sources || []) {
    assertMaxLength(`source "${s.title || s.id}" content`, s.content, AI_INPUT_LIMITS.storyboardSourceChars);
  }
  assertMaxLength("topic", config?.topic, AI_INPUT_LIMITS.topic);
  const requestId = beginCorrelationScope("storyboard");
  const wrapError = (msg: string) => new StoryboardError(msg, requestId);
  try {
    // Emit the requestId up-front so the UI can render a copyable badge
    // immediately, before the first edge invocation completes.
    onProgress?.({ message: "Planning storyboard chapters…", percent: 56, requestId });

    const trimmedSources = sources
      .filter((s) => s.content && s.status === "ready")
      .slice(0, 8)
      .map((s) => ({
        ...s,
        content: s.content ? s.content.slice(0, 2000) : undefined,
      }));

    const { data: outlineData, error: outlineError } = await invokeWithRetryAndTimeout<{
      outlines?: OutlineChapter[];
      batchSize?: number;
      error?: string;
    }>(
      "generate-storyboard",
      withRequestId({ mode: "outline", sources: trimmedSources, config }, requestId),
      {
        onRetry: (attempt, maxAttempts, reason) =>
          onProgress?.({
            message: `Outline timed out — retrying (attempt ${attempt}/${maxAttempts})…`,
            percent: 56,
            requestId,
            retrying: true,
            attempt,
            maxAttempts,
            retryReason: reason,
          }),
      },
    );

    if (outlineError) throw wrapError(await friendlyEdgeErrorMessage(outlineError, "Failed to plan storyboard"));
    if (outlineData?.error) throw wrapError(outlineData.error);

    const outlines: OutlineChapter[] = outlineData?.outlines || [];
    const batchSize = Math.max(1, outlineData?.batchSize || 4);

    if (outlines.length === 0) {
      throw wrapError("No storyboard chapters were generated");
    }

    const chapters: SlideChapter[] = [];
    const totalBatches = Math.ceil(outlines.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchOutlines = outlines.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const percent = 60 + ((batchIndex + 1) / totalBatches) * 34;

      onProgress?.({
        message: `Writing chapters ${batchIndex * batchSize + 1}-${batchIndex * batchSize + batchOutlines.length} of ${outlines.length}…`,
        percent,
        requestId,
      });

      const { data: batchData, error: batchError } = await invokeWithRetryAndTimeout<{
        chapters?: Array<{
          title: string;
          body: string;
          imagePrompt?: string;
          diagramPrompt?: string;
          notes?: string;
          references?: string[];
        }>;
        error?: string;
      }>(
        "generate-storyboard",
        withRequestId(
          {
            mode: "chapters",
            sources: trimmedSources,
            config,
            outlines: batchOutlines,
            batchIndex,
            totalBatches,
          },
          requestId,
        ),
        {
          onRetry: (attempt, maxAttempts, reason) =>
            onProgress?.({
              message: `Chapter batch ${batchIndex + 1}/${totalBatches} timed out — retrying (attempt ${attempt}/${maxAttempts})…`,
              percent,
              requestId,
              retrying: true,
              attempt,
              maxAttempts,
              retryReason: reason,
            }),
        },
      );

      if (batchError) throw wrapError(await friendlyEdgeErrorMessage(batchError, "Failed to generate chapter batch"));
      if (batchData?.error) throw wrapError(batchData.error);

      const batchChapters = (batchData?.chapters || []).map(
        (chapter: {
          title: string;
          body: string;
          imagePrompt?: string;
          diagramPrompt?: string;
          notes?: string;
          references?: string[];
        }) => ({
          id: crypto.randomUUID(),
          title: chapter.title,
          body: chapter.body,
          imagePrompt: chapter.imagePrompt,
          diagramPrompt: chapter.diagramPrompt,
          notes: chapter.notes,
          references: chapter.references,
        })
      );

      chapters.push(...batchChapters);
    }

    return chapters;
  } finally {
    endCorrelationScope("storyboard");
  }
}

// ── Format raw text into chapters using AI ──────────────────────────────
export async function formatTextToChapters(
  text: string,
  config: Partial<StoryConfig>
): Promise<SlideChapter[]> {
  assertMaxLength("text", text, AI_INPUT_LIMITS.formatText);
  if (OPEN_NOVA_LOCAL_ONLY) {
    return localFormatChapters(text, config);
  }
  const { data, error } = await supabase.functions.invoke("format-text", {
    body: { text, config },
  });

  if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to format text"));
  if (data?.error) throw new Error(data.error);

  return (data.chapters || []).map(
    (ch: { title: string; body: string; imagePrompt?: string; notes?: string }) => ({
      id: crypto.randomUUID(),
      title: ch.title,
      body: ch.body,
      imagePrompt: ch.imagePrompt,
      notes: ch.notes,
    })
  );
}

export async function generateChapterImage(
  chapterId: string,
  imagePrompt: string,
  referenceImageBase64?: string,
  imageStyle: "cinematic" | "animated" = "cinematic",
  characterDescription?: string,
  additionalInstruction?: string,
  refCharacterDetails?: { gender?: string; age?: string; details?: string },
  rawPromptMode?: boolean,
  modeOverride?: "auto" | "draft" | "premium",
  orientation: "landscape" | "portrait" | "square" = "landscape",
): Promise<{ chapterId: string; imageUrl: string; provider?: string; freeTier?: boolean; upgradeable?: boolean; mode?: string; correlationId?: string }> {
  assertMaxLength("imagePrompt", imagePrompt, AI_INPUT_LIMITS.imagePrompt);
  if (OPEN_NOVA_LOCAL_ONLY) {
    const correlationId = `local-image-${Date.now()}`;
    const prompt = [imagePrompt, characterDescription, additionalInstruction, imageStyle === "animated" ? "animated illustration" : "cinematic illustration"].filter(Boolean).join(", ");
    const data = await localImageRequest({ prompt, orientation, referenceImage: referenceImageBase64, refCharacterDetails, rawPromptMode });
    return { chapterId, imageUrl: data.imageUrl, provider: data.provider || "rons-local-image", freeTier: true, upgradeable: false, mode: "local-gpu", correlationId };
  }
  assertMaxLength("characterDescription", characterDescription, AI_INPUT_LIMITS.imageCharacter);
  assertMaxLength("additionalInstruction", additionalInstruction, AI_INPUT_LIMITS.imageInstruction);
  assertMaxLength("refCharacterDetails", refCharacterDetails?.details, AI_INPUT_LIMITS.imageCharacter);
  const FALLBACK_IMAGE = `${window.location.origin}/fallback-chapter.png`;
  const { getImageMode } = await import("./cost-mode");
  const mode = modeOverride ?? getImageMode();

  // Premium mode: confirm overage charge if the user has exceeded their daily
  // image quota and has no add-on credits remaining. Protects platform margins
  // while still letting power users authorize one-off paid generations.
  if (mode === "premium") {
    const { ensurePremiumQuota } = await import("./premium-quota-gate");
    const ok = await ensurePremiumQuota("generate-chapter-image", { estimatedUnits: 1 });
    if (!ok) {
      return { chapterId, imageUrl: `${window.location.origin}/fallback-chapter.png` };
    }
  }
  // Client-generated correlation ID — links this UI action to the api_usage_logs row.
  // If a storyboard flow is currently in scope, inherit its request id so
  // every chapter image generated as part of that flow is grouped under
  // the same correlation id across api_usage_logs and storage audits.
  const scopedRequestId = getCorrelationId("storyboard");
  const correlationId =
    scopedRequestId ??
    ((typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const { data, error } = await supabase.functions.invoke("generate-chapter-image", {
    body: { chapterId, imagePrompt, referenceImage: referenceImageBase64, imageStyle, characterDescription, additionalInstruction, refCharacterDetails, rawPromptMode, mode, orientation, correlationId, requestId: correlationId },
    headers: { [REQUEST_ID_HEADER]: correlationId },
  });

  if (error) {
    const message = await getFunctionErrorMessage(error);
    if (shouldBubbleImageError(message)) {
      throw new Error(message);
    }
    console.warn("Image generation failed, using fallback:", message);
    return { chapterId, imageUrl: FALLBACK_IMAGE, correlationId };
  }

  if (typeof data?.error === "string" && shouldBubbleImageError(data.error)) {
    throw new Error(data.error);
  }

  if (data?.fallback || data?.error) {
    console.warn("Image blocked by content policy, using fallback:", data?.error);
    return { chapterId, imageUrl: FALLBACK_IMAGE, correlationId: data?.correlationId ?? correlationId };
  }

  // Notify widgets (e.g. AddonCreditsWidget) that a successful image gen happened —
  // add-on credits may have been deducted server-side.
  try {
    const { notifyAddonCreditsChanged } = await import("./addon-credits-events");
    notifyAddonCreditsChanged({ type: "image" });
  } catch { /* ignore */ }

  // Plan-credit refresh: server returns planCreditsConsumed when the user was
  // over their daily quota and we debited monthly plan credits. Fire the
  // PLAN_CREDITS_CHANGED event so live badges + history refresh immediately.
  const planConsumed = Number(data?.planCreditsConsumed ?? 0);
  if (planConsumed > 0) {
    try {
      const { notifyPlanCreditsChanged } = await import("./plan-credits-events");
      notifyPlanCreditsChanged({
        consumed: planConsumed,
        remaining: typeof data?.planCreditsRemaining === "number" ? data.planCreditsRemaining : undefined,
      });
    } catch { /* ignore */ }
  }

  // Broadcast auto-eco activation so the VisualBook banner can surface why image quality dropped.
  if (data?.autoEco && data?.freeTier && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auto-eco-active", { detail: { service: "image", provider: data.provider } }));
  }

  // Free-tier transparency: nudge the user once per session when the image came
  // from a free provider (FLUX-schnell or Pollinations.ai) instead of Gemini.
  if (data?.freeTier && !_freeTierImageToastShown) {
    _freeTierImageToastShown = true;
    toast.info("Generated with free tier", {
      description: "This image was created with a free provider. Upgrade for premium quality with Gemini Image.",
      duration: 7000,
      action: { label: "Upgrade", onClick: () => { window.location.href = "/pricing"; } },
    });
  }

  return { chapterId: data.chapterId, imageUrl: data.imageUrl, provider: data.provider, freeTier: !!data.freeTier, upgradeable: !!data.upgradeable, mode: data.mode, correlationId: data.correlationId ?? correlationId };
}
