/**
 * Helpers for the "strict schema import" preference and blocking logic.
 * Extracted from VisualBook so the rules can be unit-tested in isolation.
 */

export const STRICT_SCHEMA_PREF_KEY = "resonance.strictSchemaImport";

/** Read the persisted strict-schema preference. Defaults to `true`. */
export function readStrictSchemaPref(storage?: Pick<Storage, "getItem">): boolean {
  const s = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!s) return true;
  try {
    const v = s.getItem(STRICT_SCHEMA_PREF_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/** Persist the strict-schema preference. Silent on storage failures. */
export function writeStrictSchemaPref(
  value: boolean,
  storage?: Pick<Storage, "setItem">,
): void {
  const s = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!s) return;
  try {
    s.setItem(STRICT_SCHEMA_PREF_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export interface StrictBlockInput {
  /** Global preference: when true, mismatched imports are blocked. */
  strict: boolean;
  /** Schema version stamped in the file. */
  originalSchemaVersion: number;
  /** Schema version this build understands (after migration). */
  schemaVersion: number;
  /** Per-import override the user can tick in the review modal. */
  overrideAck: boolean;
}

/**
 * True when the "Apply import" action must be disabled because strict mode
 * is on, the file's schema doesn't match the current build, and the user
 * hasn't ticked the per-import override checkbox.
 */
export function isImportBlocked(input: StrictBlockInput): boolean {
  return (
    input.strict &&
    input.originalSchemaVersion !== input.schemaVersion &&
    !input.overrideAck
  );
}
