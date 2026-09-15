import { useEffect, useState } from "react";
import { Coins, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useUserTier } from "@/hooks/useUserTier";
import { PLAN_CREDITS_CHANGED } from "@/lib/plan-credits-events";

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  creator: "Creator",
  pro: "Pro",
  business: "Business",
};

/**
 * Live plan-credit balance badge. Reads `get_credits_remaining` and refreshes
 * after `PLAN_CREDITS_CHANGED` events fired by generation calls. Renders inline
 * — drop into headers, toolbars, the QuotaAndCreditsCard, or Account page.
 */
export function PlanCreditsBadge({ compact = false }: { compact?: boolean }) {
  const { userId, effectiveTier } = useUserTier();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCredits = async () => {
    if (!userId) {
      setCredits(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.rpc("get_credits_remaining", { _user_id: userId });
      setCredits(Number(data ?? 0));
    } catch {
      setCredits(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();
    let t: number | undefined;
    const onChange = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fetchCredits(), 500);
    };
    window.addEventListener(PLAN_CREDITS_CHANGED, onChange);
    return () => {
      window.removeEventListener(PLAN_CREDITS_CHANGED, onChange);
      if (t) window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const low = (credits ?? 0) > 0 && (credits ?? 0) < 25;
  const empty = (credits ?? 0) === 0;
  const tierLabel = TIER_LABEL[effectiveTier] ?? "Free";

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/pricing"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              empty
                ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
                : low
                ? "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-300 hover:bg-amber-500/10"
                : "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10"
            }`}
          >
            <Coins className="h-3 w-3" />
            <span className="tabular-nums">{loading ? "…" : (credits ?? 0).toLocaleString()}</span>
            <span className="text-muted-foreground">credits</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-medium">{tierLabel} plan credits</p>
          <p>{(credits ?? 0).toLocaleString()} credits remaining this period</p>
          <p className="text-[10px] text-muted-foreground mt-1">Click to view plans &amp; top up.</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">Plan credits</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {tierLabel}
          </span>
        </div>
        <button
          onClick={fetchCredits}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-lg font-semibold tabular-nums ${empty ? "text-destructive" : low ? "text-amber-600 dark:text-amber-300" : "text-foreground"}`}>
            {loading ? "…" : (credits ?? 0).toLocaleString()}
          </span>
          <span className="text-muted-foreground">credits left</span>
        </div>
        <Button
          asChild
          size="sm"
          variant={empty || low ? "default" : "outline"}
          className="h-7 px-2.5 text-[11px] gap-1 ml-auto shrink-0"
        >
          <Link to="/pricing">
            <Plus className="h-3 w-3" />
            {empty ? "Top up" : low ? "Top up" : "Upgrade"}
          </Link>
        </Button>
      </div>

      {empty && (
        <p className="text-[10px] text-destructive/80">
          You've used all plan credits. Premium features now require top-up or upgrade.
        </p>
      )}
      {low && !empty && (
        <p className="text-[10px] text-amber-600/80 dark:text-amber-300/80">
          Running low — top up to keep generating premium content.
        </p>
      )}
    </div>
  );
}
