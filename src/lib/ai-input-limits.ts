/**
 * Client-side input limits for AI edge functions.
 *
 * Constants are re-exported from the canonical shared file at
 * `supabase/functions/_shared/ai-input-limits.ts` so the client and every
 * edge function enforce identical caps. Only edit limits in the shared file.
 *
 * The assertion helpers below are client-only (they throw typed errors used
 * to render friendly toast messages before we hit the network).
 */

/**
 * Open Nova sovereign-local copy of the canonical ePublisher input limits.
 *
 * The hosted application originally re-exported these constants from
 * `supabase/functions/_shared/ai-input-limits.ts`. The sovereign-local
 * migration intentionally does not ship or execute that hosted backend tree,
 * so the same canonical values are defined locally for frontend validation.
 */
export const AI_INPUT_LIMITS = {
  // Generic
  topic: 5_000,
  chapterTitle: 500,

  // ai-rewrite-chapter
  rewriteBody: 50_000,
  rewriteInstruction: 2_000,

  // format-text
  formatText: 200_000,

  // narration / TTS
  ttsText: 10_000,

  // generate-chapter-image
  imagePrompt: 4_000,
  imageInstruction: 2_000,
  imageCharacter: 4_000,

  // translate-chapters
  translateMaxChapters: 200,
  translateTotalChars: 500_000,

  // generate-storyboard
  storyboardMaxSources: 50,
  storyboardSourceChars: 100_000,
  storyboardChapterTitlesChars: 250_000,
  storyboardCustomPrompt: 5_000,
  storyboardStorylineGuide: 20_000,
  storyboardMaxExistingChapters: 100,

  // process-sources
  sourceTitle: 2_000,
  sourceTextChars: 200_000,
  sourceBinaryBytes: 20 * 1024 * 1024,
} as const;

export const SOURCE_BINARY_DATAURI_MAX =
  Math.ceil(AI_INPUT_LIMITS.sourceBinaryBytes * 4 / 3) + 100;

export type AiInputLimits = typeof AI_INPUT_LIMITS;

export type AiInputUnit = "chars" | "bytes" | "items" | "seconds";

function fmtSeconds(n: number): string {
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export class AiInputTooLargeError extends Error {
  readonly field: string;
  readonly limit: number;
  readonly actual: number;
  readonly unit: AiInputUnit;
  /** Short, actionable hint for the user — rendered inline and in toasts. */
  readonly suggestion: string;
  /** Concrete worked examples shown as a bulleted "how to fix it" list. */
  readonly examples: string[];
  constructor(field: string, actual: number, limit: number, unit: AiInputUnit = "chars") {
    const formatted = unit === "bytes"
      ? `${Math.round(limit / (1024 * 1024))}MB`
      : unit === "seconds"
      ? fmtSeconds(limit)
      : `${limit.toLocaleString()} ${unit}`;
    const over = Math.max(0, actual - limit);
    const overFmt = unit === "bytes"
      ? `${(over / (1024 * 1024)).toFixed(1)}MB`
      : unit === "seconds"
      ? fmtSeconds(over)
      : `${over.toLocaleString()} ${unit}`;
    super(`${field} is too large (max ${formatted}). Please shorten it and try again.`);
    this.name = "AiInputTooLargeError";
    this.field = field;
    this.actual = actual;
    this.limit = limit;
    this.unit = unit;
    this.suggestion = suggestionFor(field, unit, overFmt);
    this.examples = examplesFor(field, unit);
  }
}

function suggestionFor(field: string, unit: AiInputUnit, overFmt: string): string {
  const f = field.toLowerCase();
  if (unit === "seconds") {
    return `Trim the recording or split it into shorter clips (${overFmt} over).`;
  }
  if (unit === "items") {
    if (f.includes("chapter")) return `Remove or merge chapters until you're under the limit (${overFmt} over).`;
    if (f.includes("source")) return `Remove some sources or split them across runs (${overFmt} over).`;
    return `Reduce the number of items (${overFmt} over the limit).`;
  }
  if (unit === "bytes") {
    return `Use a smaller file or compress it before uploading (${overFmt} over the limit).`;
  }
  if (f.includes("instruction")) return `Trim the instruction to the essentials (${overFmt} over).`;
  if (f.includes("title")) return `Shorten the title (${overFmt} over).`;
  if (f.includes("topic")) return `Shorten the topic — a sentence is plenty (${overFmt} over).`;
  if (f.includes("storyline")) return `Tighten the storyline; remove repetition (${overFmt} over).`;
  if (f.includes("translation") || f.includes("batch")) return `Split the work into smaller batches (${overFmt} over).`;
  if (f.includes("chapter body") || f.includes("body")) return `Trim or split this chapter into two (${overFmt} over).`;
  if (f.includes("summar")) return `Shorten chapter bodies or merge chapters to reduce the summary (${overFmt} over).`;
  if (f.includes("narration") || f.includes("tts")) return `Break the narration into shorter segments (${overFmt} over).`;
  return `Shorten this field — it's ${overFmt} over the limit.`;
}

/**
 * Concrete worked examples for the offending field. Returned as short
 * bullet strings rendered under the suggestion in the 413 banner so users
 * see *how* to comply, not just *that* they must.
 */
export function examplesFor(field: string, unit: AiInputUnit): string[] {
  const f = field.toLowerCase();
  if (unit === "seconds") {
    return [
      "Split a 45-minute interview into three ~15-minute clips and upload them separately.",
      "Trim silence and intros from the top and tail before exporting.",
    ];
  }
  if (unit === "bytes") {
    if (f.includes("image") || f.includes("photo")) {
      return [
        "Re-export the image at 1600px wide JPEG quality ~80 — usually <2MB.",
        "Use a tool like Squoosh or TinyPNG to compress before uploading.",
      ];
    }
    return [
      "Export a PDF as text-only (remove embedded scans) to drop the size.",
      "For video, transcode to 720p H.264 at ~1Mbps — fits hours into 20MB.",
    ];
  }
  if (unit === "items") {
    if (f.includes("chapter")) {
      return [
        "Merge two adjacent short chapters into one — e.g. 'Origins' + 'Childhood' → 'Origins'.",
        "Move standalone anecdotes into appendices instead of separate chapters.",
      ];
    }
    if (f.includes("source")) {
      return [
        "Keep only the 3–5 most authoritative sources; remove duplicates and SEO listicles.",
        "Run a second pass later with the leftover sources.",
      ];
    }
    return ["Process the items in two smaller batches and combine the results."];
  }
  // chars
  if (f.includes("instruction")) {
    return [
      "Replace 'Please could you very kindly rewrite this paragraph in a more elegant tone…' with 'Rewrite more elegantly.'",
      "Drop background context the chapter already contains — the model can see it.",
    ];
  }
  if (f.includes("title")) {
    return ["Aim for ≤60 characters. 'The Complete Untold History of …' → 'Untold History of …'."];
  }
  if (f.includes("topic")) {
    return ["One sentence is plenty: 'A memoir about leaving banking to farm olives in Crete.'"];
  }
  if (f.includes("storyline")) {
    return [
      "Keep one line per beat: 'Act 1 — setup. Act 2 — conflict. Act 3 — resolution.'",
      "Delete restated chapter summaries; the storyline is a map, not the territory.",
    ];
  }
  if (f.includes("translation") || f.includes("batch")) {
    return [
      "Translate 5 chapters at a time instead of 20.",
      "Translate long chapters individually before running batches.",
    ];
  }
  if (f.includes("chapter body") || f.includes("body")) {
    return [
      "Split a 12,000-character chapter into 'Part 1' and 'Part 2' at a natural scene break.",
      "Move quoted source material into a footnote-style appendix chapter.",
    ];
  }
  if (f.includes("summar")) {
    return [
      "Tighten each chapter body to its essential beats before resummarising.",
      "Merge similar chapters so the summary has fewer headings to chew through.",
    ];
  }
  if (f.includes("narration") || f.includes("tts")) {
    return [
      "Break a long chapter into 2–3 narration segments of ~1,500 characters each.",
      "Strip parenthetical asides and stage directions from the narration text.",
    ];
  }
  return [
    "Cut filler words and restatements first — that's usually 20–30% of the text.",
    "If the content is reference material, link to it instead of pasting it.",
  ];
}


export function assertMaxLength(
  field: string,
  value: string | undefined | null,
  limit: number,
): void {
  if (typeof value === "string" && value.length > limit) {
    throw new AiInputTooLargeError(field, value.length, limit, "chars");
  }
}

export function assertMaxCount(field: string, count: number, limit: number): void {
  if (count > limit) {
    throw new AiInputTooLargeError(field, count, limit, "items");
  }
}

/**
 * Rough size of a base64 data URI, in raw decoded bytes. We don't need byte
 * exactness here — the server enforces the real cap, this just avoids the
 * upload entirely when the payload is obviously oversized.
 */
export function approxBase64Bytes(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  const b64Len = comma >= 0 ? dataUri.length - comma - 1 : dataUri.length;
  return Math.floor(b64Len * 3 / 4);
}

export function assertMaxBinarySize(field: string, dataUri: string, limitBytes: number): void {
  if (!dataUri.startsWith("data:")) return;
  const bytes = approxBase64Bytes(dataUri);
  if (bytes > limitBytes) {
    throw new AiInputTooLargeError(field, bytes, limitBytes, "bytes");
  }
}

/** Client-side caps for direct file uploads (kept in sync with backend). */
export const UPLOAD_LIMITS = {
  /** Source documents (PDF/DOCX/TXT/audio/video) on the intake step. */
  sourceFileBytes: 20 * 1024 * 1024,
  /** Optional character reference photo in the Visual Book config. */
  referenceImageBytes: 10 * 1024 * 1024,
  /** Per-image uploads on the Chapter Images editor. */
  chapterImageBytes: 8 * 1024 * 1024,
  /** Per-video uploads on the Chapter Images editor (signed via same TTL as images). */
  chapterVideoBytes: 30 * 1024 * 1024,
  /** Max audio/video duration accepted for transcription (seconds). */
  mediaDurationSeconds: 30 * 60,
} as const;

/**
 * Assert a `File` is within the given byte limit. Throws `AiInputTooLargeError`
 * so callers can reuse the shared 413 banner/toast helpers.
 */
export function assertMaxFileSize(field: string, file: File, limitBytes: number): void {
  if (file.size > limitBytes) {
    throw new AiInputTooLargeError(`${field} (${file.name})`, file.size, limitBytes, "bytes");
  }
}

/**
 * Probe the duration of an audio/video file via a hidden media element.
 * Resolves with `null` if duration can't be determined (corrupt file,
 * unsupported codec, slow metadata) so callers can fall back gracefully.
 */
export function probeMediaDuration(file: File, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio") as HTMLMediaElement;
    el.preload = "metadata";
    el.muted = true;
    let done = false;
    const finish = (val: number | null) => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch {}
      resolve(val);
    };
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : null;
      finish(d);
    };
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), timeoutMs);
    el.src = url;
  });
}

/**
 * Probe + assert that an audio/video file's duration is within `limitSeconds`.
 * If duration can't be probed we silently accept and rely on the server cap.
 */
export async function assertMaxMediaDuration(
  field: string,
  file: File,
  limitSeconds: number,
): Promise<void> {
  const duration = await probeMediaDuration(file);
  if (duration == null) return;
  if (duration > limitSeconds) {
    throw new AiInputTooLargeError(
      `${field} (${file.name})`,
      Math.round(duration),
      limitSeconds,
      "seconds",
    );
  }
}

