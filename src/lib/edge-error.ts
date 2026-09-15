/**
 * Helpers for turning raw `supabase.functions.invoke` errors (and fetch
 * Response errors) into friendly messages users can act on. In particular,
 * 413 Payload Too Large responses from the AI edge functions are converted
 * into a clear "input too large, please shorten" message that names the
 * offending field when the server includes it.
 */

type AnyRecord = Record<string, unknown>;

export interface FriendlyEdgeError {
  message: string;
  status?: number;
  /** True when the server signalled the payload was too large (HTTP 413). */
  tooLarge: boolean;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

function pickString(obj: AnyRecord | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function friendlyTooLargeMessage(payload: AnyRecord | undefined, fallback: string): string {
  const serverMessage = pickString(payload, "error", "message");
  const field = pickString(payload, "field");
  const limit = payload && typeof payload.limit === "number" ? payload.limit : undefined;

  if (serverMessage) {
    // Server already provides a useful description (e.g. "chapterBody exceeds maximum length")
    return `Input too large: ${serverMessage}. Please shorten it and try again.`;
  }

  if (field && limit) {
    return `"${field}" is too large (max ${limit.toLocaleString()}). Please shorten it and try again.`;
  }

  return fallback;
}

/**
 * Parse a `supabase.functions.invoke` error into a structured friendly form.
 * Falls back to `fallback` (or `error.message`) if the body cannot be read.
 */
export async function getFriendlyEdgeError(
  error: unknown,
  fallback: string,
): Promise<FriendlyEdgeError> {
  const fallbackMessage = (error instanceof Error && error.message) || fallback;

  if (!error || typeof error !== "object" || !("context" in error)) {
    return { message: fallbackMessage, tooLarge: false };
  }

  const response = (error as { context?: unknown }).context;
  if (!isResponse(response)) {
    return { message: fallbackMessage, tooLarge: false };
  }

  const status = response.status;
  let payload: AnyRecord | undefined;
  try {
    payload = (await response.clone().json()) as AnyRecord;
  } catch {
    try {
      const text = await response.clone().text();
      if (text) payload = { error: text };
    } catch {
      /* ignore */
    }
  }

  if (status === 413) {
    return {
      message: friendlyTooLargeMessage(
        payload,
        "Your input is too large for this AI step. Please shorten the text or remove some content and try again.",
      ),
      status,
      tooLarge: true,
    };
  }

  const serverMessage = pickString(payload, "error", "message") || fallbackMessage;
  return { message: serverMessage, status, tooLarge: false };
}

/** Convenience: just the friendly message string. */
export async function friendlyEdgeErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const { message } = await getFriendlyEdgeError(error, fallback);
  return message;
}

/**
 * Build a friendly message from a raw `fetch` Response (used by callers that
 * skip `functions.invoke`, e.g. tts-client). Returns `null` when the response
 * is not a recognisable too-large error so the caller can fall back to its
 * existing parsing.
 */
export function friendlyTooLargeFromResponseStatus(
  status: number,
  payload?: unknown,
): string | null {
  if (status !== 413) return null;
  const record = payload && typeof payload === "object" ? (payload as AnyRecord) : undefined;
  return friendlyTooLargeMessage(
    record,
    "Your input is too large for this AI step. Please shorten the text or remove some content and try again.",
  );
}
