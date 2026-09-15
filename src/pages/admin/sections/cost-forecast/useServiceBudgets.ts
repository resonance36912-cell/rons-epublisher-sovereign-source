import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function useServiceBudgets() {
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("service_budgets")
        .select("service, monthly_budget");
      if (cancelled || error || !data) return;
      const map: Record<string, number> = {};
      for (const r of data as Array<{ service: string; monthly_budget: number }>) {
        map[r.service] = Number(r.monthly_budget);
      }
      setBudgets(map);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveBudget = useCallback(async (service: string, value: number | null): Promise<boolean> => {
    setSaving(service);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const updatedBy = userRes?.user?.id ?? null;
      if (value === null) {
        const { error } = await supabase.from("service_budgets").delete().eq("service", service);
        if (error) throw error;
        setBudgets((b) => {
          const next = { ...b };
          delete next[service];
          return next;
        });
        toast({ title: "Reverted to auto-budget", description: service });
      } else {
        const { error } = await supabase
          .from("service_budgets")
          .upsert(
            { service, monthly_budget: value, updated_by: updatedBy },
            { onConflict: "service" },
          );
        if (error) throw error;
        setBudgets((b) => ({ ...b, [service]: value }));
        toast({ title: "Manual budget saved", description: `${service}: $${value.toFixed(2)}/mo` });
      }
      return true;
    } catch (e) {
      toast({
        title: "Could not save budget",
        description: (e as Error).message,
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(null);
    }
  }, []);

  return { budgets, saveBudget, saving };
}
