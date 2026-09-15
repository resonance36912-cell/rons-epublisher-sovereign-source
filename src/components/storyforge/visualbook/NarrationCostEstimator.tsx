import { useEffect, useState } from "react";
import { Calculator, AlertTriangle, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getQuotaStatus, type QuotaStatus } from "@/lib/usage-limits";

type Props = {
  /** Total characters that will be sent to the narration provider. */
  totalChars: number;
  /** Active narration provider. Estimator only applies to premium TTS. */
  provider: "browser" | "elevenlabs";
  /** Number of cached chapters that won't be re-billed. */
  cachedChars?: number;
};

function fmt(n: number) {
  return n.toLocaleString();
}

/**
 * Pre-flight cost / quota estimator shown in Step 7 before the user
 * triggers narration generation or an export that includes audio.
 *
 * Reads the user's current premium-narration quota from `check_user_quota`
 * and shows: "This narration will use ~X chars (Y% of your quota)".
 */
export function NarrationCostEstimator({ totalChars, provider, cachedChars = 0 }: Props) {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getQuotaStatus("elevenlabs-tts")
      .then((q) => { if (alive) { setQuota(q); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Only relevant for premium narration. Browser TTS is free.
  if (provider !== "elevenlabs") {
    return (
      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        <Calculator className="w-3 h-3" />
        Browser narration · free
      </div>
    );
  }

  const billable = Math.max(0, totalChars - cachedChars);

  if (loading || !quota) {
    return (
      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        <Calculator className="w-3 h-3" />
        Estimating ~{fmt(billable)} chars…
      </div>
    );
  }

  if (quota.period === "blocked") {
    return (
      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Premium narration locked on your plan
      </div>
    );
  }

  const remaining = Math.max(0, quota.limit - quota.used);
  const percentOfQuota = quota.limit > 0 ? (billable / quota.limit) * 100 : 0;
  const willExceed = billable > remaining;
  const heavy = percentOfQuota >= 50;

  const colorCls = willExceed
    ? "text-destructive border-destructive/40 bg-destructive/5"
    : heavy
      ? "text-yellow-600 dark:text-yellow-500 border-yellow-500/40 bg-yellow-500/5"
      : "text-muted-foreground border-border/40 bg-muted/30";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`text-[10px] inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${colorCls}`}>
          {willExceed ? <AlertTriangle className="w-3 h-3" /> : <Calculator className="w-3 h-3" />}
          <span className="tabular-nums">
            ~{fmt(billable)} chars ({percentOfQuota.toFixed(percentOfQuota < 10 ? 1 : 0)}% of quota)
          </span>
          {cachedChars > 0 && (
            <span className="text-[9px] opacity-70">· {fmt(cachedChars)} cached free</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium mb-1">Narration cost estimate</p>
        <p>Total text: <span className="tabular-nums">{fmt(totalChars)}</span> chars</p>
        {cachedChars > 0 && (
          <p>Already cached: <span className="tabular-nums">{fmt(cachedChars)}</span> chars (free)</p>
        )}
        <p>Will be billed: <span className="tabular-nums">{fmt(billable)}</span> chars</p>
        <p className="mt-1">
          Quota: <span className="tabular-nums">{fmt(quota.used)}/{fmt(quota.limit)}</span>
          {" "}({quota.period})
        </p>
        <p>Remaining: <span className="tabular-nums">{fmt(remaining)}</span> chars</p>
        {willExceed && (
          <p className="mt-1 text-destructive font-medium">
            ⚠ Exceeds remaining quota by {fmt(billable - remaining)} chars.
            Some chapters will fall back to browser narration.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
