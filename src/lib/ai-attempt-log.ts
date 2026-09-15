// In-memory diagnostics log for AI edge-function calls. Captures attempt
// timing, retries, timeout reasons, and HTTP-ish status hints so admins can
// troubleshoot intermittent generation failures from a single panel.
//
// The log is process-local (ring buffer, capped at MAX_ENTRIES). Subscribers
// receive a snapshot whenever a new entry lands.

export type AiAttemptStatus = "started" | "succeeded" | "retrying" | "failed";

export type AiAttemptEntry = {
  /** Stable id for this attempt sequence (one per outer call). */
  id: string;
  /** Edge function name, e.g. "generate-storyboard". */
  fn: string;
  /** Optional correlation/request id passed end-to-end. */
  requestId?: string;
  /** 1-based attempt number. */
  attempt: number;
  /** Total attempts that will be made before giving up. */
  maxAttempts: number;
  /** Configured soft timeout in ms. */
  timeoutMs: number;
  /** Wall-clock start of this attempt. */
  startedAt: number;
  /** Wall-clock end (success or failure). */
  endedAt?: number;
  /** Duration in ms (endedAt - startedAt). */
  durationMs?: number;
  status: AiAttemptStatus;
  /** Best-effort HTTP-like status code extracted from the error, when present. */
  statusCode?: number;
  /** Whether this attempt ended due to the soft timeout. */
  timedOut?: boolean;
  /** Whether the failure looked transient and was retried. */
  transient?: boolean;
  /** Short human-readable reason / message. */
  message?: string;
};

const MAX_ENTRIES = 200;
const _entries: AiAttemptEntry[] = [];
type Listener = (snapshot: AiAttemptEntry[]) => void;
const _listeners = new Set<Listener>();

function _notify() {
  const snap = _entries.slice();
  for (const l of _listeners) {
    try { l(snap); } catch { /* ignore */ }
  }
}

/** Parse a status code out of an error/message string ("502", "504 Gateway", etc.). */
export function extractStatusCode(input: unknown): number | undefined {
  if (input == null) return undefined;
  const obj = input as { status?: number; statusCode?: number; code?: number };
  if (typeof obj.status === "number") return obj.status;
  if (typeof obj.statusCode === "number") return obj.statusCode;
  if (typeof obj.code === "number") return obj.code;
  const msg = (input as { message?: string })?.message ?? String(input);
  const m = String(msg).match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export function recordAiAttempt(entry: Omit<AiAttemptEntry, "endedAt" | "durationMs"> & { endedAt?: number; durationMs?: number }): void {
  const merged: AiAttemptEntry = {
    ...entry,
    durationMs: entry.endedAt ? entry.endedAt - entry.startedAt : entry.durationMs,
  };
  // Replace prior entry with same id+attempt+fn (so "started" upgrades to "succeeded"/"failed").
  const idx = _entries.findIndex((e) => e.id === merged.id && e.attempt === merged.attempt && e.fn === merged.fn);
  if (idx >= 0) {
    _entries[idx] = { ..._entries[idx], ...merged };
  } else {
    _entries.unshift(merged);
    if (_entries.length > MAX_ENTRIES) _entries.length = MAX_ENTRIES;
  }
  _notify();
}

export function getAiAttempts(): AiAttemptEntry[] {
  return _entries.slice();
}

export function clearAiAttempts(): void {
  _entries.length = 0;
  _notify();
}

export function subscribeAiAttempts(listener: Listener): () => void {
  _listeners.add(listener);
  listener(_entries.slice());
  return () => { _listeners.delete(listener); };
}
