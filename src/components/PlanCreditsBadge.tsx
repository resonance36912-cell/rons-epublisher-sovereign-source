import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserTier } from "@/hooks/useUserTier";
import { PLAN_CREDITS_CHANGED } from "@/lib/plan-credits-events";

export function PlanCreditsBadge({ compact = false }: { compact?: boolean }) {
  const { userId } = useUserTier();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCredits = async () => {
    if (!userId) {
      setCredits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.rpc("get_credits_remaining", { _user_id: userId });
      setCredits(Number(data ?? 0));
    } catch {
      setCredits(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCredits();
    let timer: number | undefined;
    const onChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void fetchCredits(), 500);
    };
    window.addEventListener(PLAN_CREDITS_CHANGED, onChange);
    return () => {
      window.removeEventListener(PLAN_CREDITS_CHANGED, onChange);
      if (timer) window.clearTimeout(timer);
    };
  }, [userId]);

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs">
        <Activity className="h-3 w-3 text-primary" />
        Promotional access
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
      <div>
        <div className="font-medium text-foreground">Promotional access active</div>
        <div className="text-muted-foreground">
          Usage is measured for costing; it does not trigger a purchase or upgrade.
          {credits !== null ? ` Internal usage balance: ${credits.toLocaleString()}.` : ""}
        </div>
      </div>
      <button onClick={() => void fetchCredits()} className="text-muted-foreground hover:text-foreground" title="Refresh usage meter">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
