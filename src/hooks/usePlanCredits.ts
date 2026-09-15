import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserTier } from "@/hooks/useUserTier";
import { PLAN_CREDITS_CHANGED } from "@/lib/plan-credits-events";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

/**
 * Live plan-credit balance hook. Listens to PLAN_CREDITS_CHANGED so UI
 * disables premium actions immediately after a server debit.
 */
export function usePlanCredits() {
  const { userId } = useUserTier();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (OPEN_NOVA_LOCAL_ONLY) {
      setCredits(999999);
      setLoading(false);
      return;
    }
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
  }, [userId]);

  useEffect(() => {
    refresh();
    let t: number | undefined;
    const onChange = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => refresh(), 500);
    };
    window.addEventListener(PLAN_CREDITS_CHANGED, onChange);
    return () => {
      window.removeEventListener(PLAN_CREDITS_CHANGED, onChange);
      if (t) window.clearTimeout(t);
    };
  }, [refresh]);

  const empty = (credits ?? 0) === 0;
  const low = (credits ?? 0) > 0 && (credits ?? 0) < 25;

  return { credits: credits ?? 0, loading, empty, low, refresh };
}
