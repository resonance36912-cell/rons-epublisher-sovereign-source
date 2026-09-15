// Localized message helper for Signed-URL TTL admin controls.
//
// All admin TTL surfaces (inline field error, help text, toast titles +
// descriptions, server-error panel) should pull their strings from here
// so wording stays consistent across the admin portal and is ready for
// translation via the project's i18n layer (`src/lib/i18n.tsx`).
//
// The project's `t(key)` function doesn't support interpolation, so this
// helper accepts the active `t` and the live values, looks up the
// localized template, and fills in `{min}`, `{max}`, `{value}`,
// `{clamped}` placeholders. Missing keys fall back to readable English
// — there is exactly one source of truth per message.
import { useI18n } from "@/lib/i18n";

export const TTL_I18N_KEYS = {
  helpRange:        "admin.ttl.help.range",
  errorEmpty:       "admin.ttl.error.empty",
  errorDecimal:     "admin.ttl.error.decimal",
  errorTooLow:      "admin.ttl.error.tooLow",
  errorTooHigh:     "admin.ttl.error.tooHigh",
  toastInvalidT:    "admin.ttl.toast.invalid.title",
  toastInvalidD:    "admin.ttl.toast.invalid.desc",
  toastOutT:        "admin.ttl.toast.outOfRange.title",
  toastOutD:        "admin.ttl.toast.outOfRange.desc",
  toastRoundT:      "admin.ttl.toast.rounded.title",
  toastRoundD:      "admin.ttl.toast.rounded.desc",
  toastSavedT:      "admin.ttl.toast.saved.title",
  toastSavedD:      "admin.ttl.toast.saved.desc",
  toastFailedT:     "admin.ttl.toast.failed.title",
  serverPanelT:     "admin.ttl.server.title",
  serverHintLabel:  "admin.ttl.server.hintLabel",
  serverDetLabel:   "admin.ttl.server.detailsLabel",
  serverCodeLabel:  "admin.ttl.server.codeLabel",
  serverUnknown:    "admin.ttl.server.unknown",
} as const;

// English fallbacks. Other locales should add the same keys to
// `translations` in `src/lib/i18n.tsx`; until they do, `t()` returns
// these strings via the `entry.en || key` rule.
const EN_FALLBACK: Record<string, string> = {
  [TTL_I18N_KEYS.helpRange]:       "Allowed range: {min}–{max} seconds.",
  [TTL_I18N_KEYS.errorEmpty]:      "Enter a whole number of seconds.",
  [TTL_I18N_KEYS.errorDecimal]:    "TTL must be a whole number (no decimals).",
  [TTL_I18N_KEYS.errorTooLow]:     "Too low — minimum is {min}s (1 min). You entered {value}s.",
  [TTL_I18N_KEYS.errorTooHigh]:    "Too high — maximum is {max}s (1 hour). You entered {value}s.",
  [TTL_I18N_KEYS.toastInvalidT]:   "Invalid value",
  [TTL_I18N_KEYS.toastInvalidD]:   "Enter a whole number of seconds.",
  [TTL_I18N_KEYS.toastOutT]:       "Out of range",
  [TTL_I18N_KEYS.toastOutD]:       "TTL must be between {min}s and {max}s. Clamped to {clamped}s.",
  [TTL_I18N_KEYS.toastRoundT]:     "Rounded down",
  [TTL_I18N_KEYS.toastRoundD]:     "TTL must be a whole number. Adjusted {value} → {clamped}s.",
  [TTL_I18N_KEYS.toastSavedT]:     "Signed URL TTL updated",
  [TTL_I18N_KEYS.toastSavedD]:     "{value}s (~{minutes} min). Live within ~60s.",
  [TTL_I18N_KEYS.toastFailedT]:    "Failed to save",
  [TTL_I18N_KEYS.serverPanelT]:    "Server rejected the value",
  [TTL_I18N_KEYS.serverHintLabel]: "Hint:",
  [TTL_I18N_KEYS.serverDetLabel]:  "Details:",
  [TTL_I18N_KEYS.serverCodeLabel]: "SQLSTATE",
  [TTL_I18N_KEYS.serverUnknown]:   "Unknown server error.",
};

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

export type TtlContext = {
  min: number;
  max: number;
  /** Current (possibly invalid) input value; used for "you entered…" messages. */
  value?: number;
  /** Server- or blur-clamped value to surface in the message. */
  clamped?: number;
};

/**
 * Resolve a localized TTL message. Pass the active `t` (from `useI18n`)
 * plus the constraint context. The helper merges the template with any
 * placeholders and falls back to the English template if `t()` returns
 * the raw key (i.e. the key isn't registered in `translations` yet).
 */
export function ttlMessage(
  t: (key: string) => string,
  key: (typeof TTL_I18N_KEYS)[keyof typeof TTL_I18N_KEYS],
  ctx: TtlContext = { min: 0, max: 0 },
): string {
  const fromI18n = t(key);
  const template = fromI18n === key ? (EN_FALLBACK[key] ?? key) : fromI18n;
  const vars: Record<string, string | number> = {
    min: ctx.min,
    max: ctx.max,
  };
  if (ctx.value !== undefined) {
    vars.value = ctx.value;
    vars.minutes = Math.round(ctx.value / 60);
  }
  if (ctx.clamped !== undefined) vars.clamped = ctx.clamped;
  return interpolate(template, vars);
}

/**
 * React hook flavour — bound to the active locale so admin components
 * just call `m(TTL_I18N_KEYS.errorTooLow, { min, max, value })` without
 * re-importing `useI18n`.
 */
export function useTtlMessages() {
  const { t } = useI18n();
  return (key: (typeof TTL_I18N_KEYS)[keyof typeof TTL_I18N_KEYS], ctx?: TtlContext) =>
    ttlMessage(t, key, ctx ?? { min: 0, max: 0 });
}

/**
 * Client-side field validation outcomes for the TTL input. Used as a single
 * source of truth so the inline error message, the blur toast, and the
 * pre-flight `save()` guard all derive identical wording — they only
 * differ in *which* surface renders the message, never in the message itself.
 */
export type TtlFieldErrorKind = "empty" | "decimal" | "tooLow" | "tooHigh";
export type TtlFieldError = { kind: TtlFieldErrorKind; message: string };

/**
 * Classify the current input value and produce the localized error string.
 * Returns `null` when the value passes every client-side rule. Pass the
 * bound `m` (from `useTtlMessages`) plus the live MIN/MAX so the helper
 * stays free of module-level constants.
 */
export function ttlFieldError(
  m: ReturnType<typeof useTtlMessages>,
  value: number,
  bounds: { min: number; max: number },
): TtlFieldError | null {
  const { min, max } = bounds;
  if (!Number.isFinite(value)) {
    return { kind: "empty", message: m(TTL_I18N_KEYS.errorEmpty, { min, max }) };
  }
  if (!Number.isInteger(value)) {
    return { kind: "decimal", message: m(TTL_I18N_KEYS.errorDecimal, { min, max, value }) };
  }
  if (value < min) {
    return { kind: "tooLow", message: m(TTL_I18N_KEYS.errorTooLow, { min, max, value }) };
  }
  if (value > max) {
    return { kind: "tooHigh", message: m(TTL_I18N_KEYS.errorTooHigh, { min, max, value }) };
  }
  return null;
}

/**
 * Structured server-error payload captured from a failed save (mirrors the
 * shape Postgres returns: message + optional hint/details/code).
 */
export type TtlServerError = {
  message: string;
  hint?: string;
  details?: string;
  code?: string;
};

/**
 * Normalize a raw error from the Supabase client into a `TtlServerError`.
 * Falls back to the localized "unknown" message when no `.message` is set —
 * the same label used by the inline panel — so the toast and the panel can
 * never disagree about what we call an empty error.
 */
export function captureTtlServerError(
  m: ReturnType<typeof useTtlMessages>,
  raw: unknown,
): TtlServerError {
  const e = (raw ?? {}) as { message?: unknown; hint?: unknown; details?: unknown; code?: unknown };
  // Defensive: anything non-string (numbers, objects, undefined) collapses
  // to the localized "Unknown server error." fallback rather than throwing.
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    message: str(e.message) ?? m(TTL_I18N_KEYS.serverUnknown),
    hint:    str(e.hint),
    details: str(e.details),
    // Treat whitespace-only codes ("   ", "\t\n") as missing so the
    // SQLSTATE label is omitted cleanly from both the toast and the
    // inline panel — the same rule we apply to message/hint/details.
    code:    str(e.code),
  };
}

/**
 * Render a server-error description for a toast using the same labels the
 * inline panel renders ("Hint:", "Details:", "SQLSTATE"). Single source of
 * truth — change a label here and both surfaces update together.
 */
export function formatTtlServerErrorDescription(
  m: ReturnType<typeof useTtlMessages>,
  err: TtlServerError,
): string {
  return [
    err.message,
    err.hint    ? `${m(TTL_I18N_KEYS.serverHintLabel)} ${err.hint}`       : null,
    err.details ? `${m(TTL_I18N_KEYS.serverDetLabel)} ${err.details}`     : null,
    err.code    ? `${m(TTL_I18N_KEYS.serverCodeLabel)} ${err.code}`       : null,
  ].filter(Boolean).join(" — ");
}

