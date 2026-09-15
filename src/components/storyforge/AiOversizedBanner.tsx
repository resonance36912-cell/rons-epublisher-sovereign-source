import { AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiInputTooLargeError, type AiInputUnit } from "@/lib/ai-input-limits";

interface BannerProps {
  /** Either pass a typed error… */
  error?: AiInputTooLargeError | null;
  /** …or the raw parts for an ad-hoc 413 message. */
  field?: string;
  actual?: number;
  limit?: number;
  unit?: AiInputUnit;
  /** Optional override headline. Defaults to "Input too large". */
  title?: string;
  className?: string;
}

/**
 * One reusable 413-style banner used by every AI input.
 *
 * Renders the same headline + message + actionable suggestion everywhere,
 * plus a short "How to fix it" bulleted list with concrete worked examples
 * (e.g., "Split a 12,000-character chapter into 'Part 1' and 'Part 2'").
 */
export function AiOversizedBanner({
  error,
  field,
  actual,
  limit,
  unit = "chars",
  title = "Input too large",
  className,
}: BannerProps) {
  const err =
    error ??
    (field && typeof actual === "number" && typeof limit === "number"
      ? new AiInputTooLargeError(field, actual, limit, unit)
      : null);
  if (!err) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="space-y-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="font-medium">{err.message}</div>
        <div className="text-destructive/80">{err.suggestion}</div>
        {err.examples.length > 0 && (
          <div className="mt-1.5 rounded-sm border border-destructive/20 bg-background/40 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-destructive/80">
              <Lightbulb className="w-3 h-3" />
              How to fix it
            </div>
            <ul className="mt-1 space-y-0.5 pl-4 text-destructive/90 list-disc marker:text-destructive/50">
              {err.examples.map((ex, i) => (
                <li key={i}>{ex}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Build a uniform toast payload from a 413 error so all aggregate-overflow
 * catch blocks render identical wording. Includes the first worked example
 * inline so toasts stay actionable even without the full banner.
 */
export function oversizedToast(
  err: AiInputTooLargeError,
  title = "Input too large",
) {
  const example = err.examples[0] ? ` Try: ${err.examples[0]}` : "";
  return {
    title,
    description: `${err.message} ${err.suggestion}${example}`,
    variant: "destructive" as const,
  };
}
