/**
 * Reason codes emitted when (provider, embed_url) cannot be normalized for the
 * demo_video_embed_* analytics events. These are sent as a `reason` property on
 * `demo_video_embed_invalid` so we can see *why* tracking was skipped.
 */
export type EmbedEventInvalidReason =
  | "provider_missing"
  | "provider_invalid_type"
  | "url_missing"
  | "url_invalid_type"
  | "url_malformed"
  | "url_protocol_unsupported";

export type EmbedEventValidation =
  | { ok: true; provider: string; embed_url: string }
  | { ok: false; reason: EmbedEventInvalidReason };

/**
 * Validates + normalizes (provider, embed_url) for demo_video_embed_* analytics
 * events. Returns a discriminated result so callers can emit a follow-up
 * `demo_video_embed_invalid` event with the reason when normalization fails.
 */
export function validateEmbedEventProps(
  rawProvider: unknown,
  rawEmbedUrl: unknown,
): EmbedEventValidation {
  if (typeof rawProvider !== "string") return { ok: false, reason: "provider_invalid_type" };
  const provider = rawProvider.trim().slice(0, 64);
  if (!provider) return { ok: false, reason: "provider_missing" };

  if (typeof rawEmbedUrl !== "string") return { ok: false, reason: "url_invalid_type" };
  const rawUrl = rawEmbedUrl.trim();
  if (!rawUrl) return { ok: false, reason: "url_missing" };

  let normalizedUrl: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, reason: "url_protocol_unsupported" };
    }
    u.hash = "";
    normalizedUrl = u.toString();
  } catch {
    return { ok: false, reason: "url_malformed" };
  }
  if (normalizedUrl.length > 500) normalizedUrl = normalizedUrl.slice(0, 500);
  return { ok: true, provider, embed_url: normalizedUrl };
}

/**
 * Back-compat helper: returns the normalized props on success or `null` on
 * failure. Prefer `validateEmbedEventProps` when you also need the reason.
 */
export function buildEmbedEventProps(
  rawProvider: unknown,
  rawEmbedUrl: unknown,
): { provider: string; embed_url: string } | null {
  const res = validateEmbedEventProps(rawProvider, rawEmbedUrl);
  return res.ok ? { provider: res.provider, embed_url: res.embed_url } : null;
}

/**
 * Returns the same `embed_url` shape that `validateEmbedEventProps` produces
 * (http/https only, hash stripped, capped at 500 chars), or `null` for any
 * unusable input. Use this on the read-side (admin filters, joining) so that
 * legacy rows written before normalization land in the same bucket as newer
 * rows.
 */
export function normalizeEmbedUrl(rawEmbedUrl: unknown): string | null {
  if (typeof rawEmbedUrl !== "string") return null;
  const trimmed = rawEmbedUrl.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    let out = u.toString();
    if (out.length > 500) out = out.slice(0, 500);
    return out;
  } catch {
    return null;
  }
}
