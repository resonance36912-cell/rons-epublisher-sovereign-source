// Bridges Supabase auth state changes into React Query so every entitlement-
// derived hook (useUserTier, useHubEntitlement, usePlanCredits, purchases) sees
// the new user immediately on login, logout, and token refresh.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ENTITLEMENT_KEYS = [
  ["auth-session"],
  ["purchases"],
  ["hub-entitlement"],
  ["plan-credits"],
  ["addon-credits"],
] as const;

export function AuthSessionSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED — all can flip
      // the user's tier or Hub bearer, so invalidate everything downstream.
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        ENTITLEMENT_KEYS.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return null;
}
