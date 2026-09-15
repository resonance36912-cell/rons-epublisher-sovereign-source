import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_INPUT_LIMITS, AiInputTooLargeError } from "@/lib/ai-input-limits";
import { AiOversizedBanner } from "./AiOversizedBanner";

type Unit = "chars" | "bytes" | "items";

interface InlineNoticeProps {
  /** Either pass an error… */
  error?: AiInputTooLargeError | null;
  /** …or live values for a counter + progress bar that escalates near the cap. */
  field?: string;
  current?: number;
  limit?: number;
  unit?: Unit;
  /**
   * When true (default), always render the live counter + progress bar.
   * When false, the counter only appears at 80%+ of the cap.
   */
  alwaysShow?: boolean;
  className?: string;
}

function format(n: number, unit: Unit): string {
  if (unit === "bytes") {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)}MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${n}B`;
  }
  return n.toLocaleString();
}

function unitLabel(unit: Unit): string {
  if (unit === "chars") return "characters";
  if (unit === "items") return "items";
  return "";
}

/**
 * Inline counter + progress bar shown next to an AI input field.
 *
 * Modes:
 *  - With `error`: render the red "too large" message + suggestion.
 *  - With `current/limit`: always render a live counter with a thin progress
 *    bar. Color shifts from muted → amber (≥80%) → destructive (over cap).
 */
export function AiInputLimitNotice({
  error,
  field,
  current,
  limit,
  unit = "chars",
  alwaysShow = true,
  className,
}: InlineNoticeProps) {
  if (error) {
    return <AiOversizedBanner error={error} className={className} />;
  }

  if (typeof current !== "number" || typeof limit !== "number") return null;
  const ratio = limit > 0 ? current / limit : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const over = current > limit;
  const warn = ratio >= 0.8;
  if (!alwaysShow && !warn) return null;

  const remaining = limit - current;
  const remainingLabel = over
    ? `${format(Math.abs(remaining), unit)} over the limit`
    : `${format(Math.max(0, remaining), unit)} remaining`;

  const textTone = over
    ? "text-destructive"
    : warn
    ? "text-amber-700 dark:text-amber-300"
    : "text-muted-foreground";

  const barTrack = over
    ? "bg-destructive/15"
    : warn
    ? "bg-amber-500/15"
    : "bg-muted";

  const barFill = over
    ? "bg-destructive"
    : warn
    ? "bg-amber-500"
    : "bg-primary/70";

  const overError = over && field
    ? new AiInputTooLargeError(field, current, limit, unit)
    : null;

  const label = unitLabel(unit);

  return (
    <div
      role={over ? "alert" : "status"}
      aria-live="polite"
      className={cn("space-y-1", className)}
    >
      <div className={cn("flex items-center justify-between gap-2 text-xs tabular-nums", textTone)}>
        <span className="flex items-center gap-1.5 font-medium">
          {over && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
          {format(current, unit)} / {format(limit, unit)}
          {label ? <span className="font-normal opacity-70">{label}</span> : null}
        </span>
        <span className="opacity-80">{remainingLabel}</span>
      </div>
      <div
        className={cn("h-1 w-full overflow-hidden rounded-full", barTrack)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={field ? `${field} usage` : "input usage"}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-200", barFill)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overError && (
        <div className="text-xs text-destructive/90">{overError.suggestion}</div>
      )}
    </div>
  );
}

/** Convenience: read a known cap by key name without re-importing constants. */
export const InputLimits = AI_INPUT_LIMITS;
