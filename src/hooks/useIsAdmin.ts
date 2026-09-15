import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

/**
 * Resolves whether the current session belongs to an admin. Returns
 * `null` while loading so callers can avoid flashing privileged UI.
 */
export function useIsAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (OPEN_NOVA_LOCAL_ONLY) {
      setIsAdmin(false);
      return;
    }

    let cancelled = false;

    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!data);
    }

    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return isAdmin;
}
