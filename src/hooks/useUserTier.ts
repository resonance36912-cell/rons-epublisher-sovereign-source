import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHubEntitlement } from "@/hooks/useHubEntitlement";
import type { Tier } from "@/lib/hub";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";


/**
 * Legacy tier union — kept as the canonical runtime type so existing
 * `tier === "premium"` capability checks continue to work after the
 * switch to once-off unlocks. The new 5-tier names are exposed
 * alongside via `effectiveTier` and collapse down to this union.
 */
export type UserTier = "free" | "standard" | "premium";

/** New 5-tier names used by the pricing page and billing UI. */
export type EffectiveTier =
  | "free"
  | "starter"
  | "creator"
  | "pro"
  | "business";

const LEGACY_FROM_EFFECTIVE: Record<EffectiveTier, UserTier> = {
  free: "free",
  starter: "free",
  creator: "standard",
  pro: "premium",
  business: "premium",
};

/** Map purchase price_ids to the effective tier. Subscriptions are retired. */
function resolveEffectiveTier(purchasePriceIds: string[]): EffectiveTier {
  const has = (id: string) => purchasePriceIds.includes(id);

  if (has("lifetime_business") || has("business_once_off") || has("ultimate_once_off")) {
    return "business";
  }
  if (has("lifetime_pro") || has("pro_once_off") || has("premium_once_off")) {
    return "pro";
  }
  if (has("lifetime_creator") || has("creator_once_off") || has("standard_once_off")) {
    return "creator";
  }
  if (has("lifetime_starter") || has("starter_once_off")) {
    return "starter";
  }
  return "free";
}

export function useUserTier() {
  const { data: session } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
    enabled: !OPEN_NOVA_LOCAL_ONLY,
  });

  const userId = session?.user?.id;

  const { data: purchases } = useQuery({
    queryKey: ["purchases", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchases")
        .select("*");
      return data || [];
    },
    enabled: !OPEN_NOVA_LOCAL_ONLY && !!userId,
  });

  // Hub entitlement (REST). When the Hub returns an active tier, it wins
  // over the local purchases table (Hub is the billing source of truth).
  const { data: hubEnt } = useHubEntitlement();

  let effectiveTier: EffectiveTier = OPEN_NOVA_LOCAL_ONLY
    ? "business"
    : resolveEffectiveTier((purchases ?? []).map((p) => p.price_id));

  if (
    hubEnt?.source === "hub" &&
    hubEnt.tier &&
    (hubEnt.status === "active" || hubEnt.status === "trialing")
  ) {
    effectiveTier = hubEnt.tier as EffectiveTier;
  }


  // E2E / dev test override — only honored in dev builds.
  if (import.meta.env.DEV) {
    const override = (globalThis as Record<string, unknown>).__LOVABLE_TIER_OVERRIDE__ as
      | UserTier
      | EffectiveTier
      | undefined;
    if (override) {
      if (override === "free" || override === "starter") effectiveTier = override === "starter" ? "starter" : "free";
      else if (override === "standard" || override === "creator") effectiveTier = "creator";
      else if (override === "premium" || override === "pro") effectiveTier = "pro";
      else if (override === "business") effectiveTier = "business";
    }
  }

  const tier: UserTier = LEGACY_FROM_EFFECTIVE[effectiveTier];
  const effectiveUserId = OPEN_NOVA_LOCAL_ONLY ? "open-nova-local-user" : userId;

  return {
    tier,
    effectiveTier,
    userId: effectiveUserId,
    isLoggedIn: OPEN_NOVA_LOCAL_ONLY || !!userId,
    canGenerateImages: tier !== "free",
    // Premium narration is gated by add-on credits (checked server-side).
    canUseNarration: true,
    canPublish: tier === "premium",
    hasSupport: tier === "premium",
    /** Retired: subscriptions no longer exist. Kept as `null` for compat. */
    subscription: null as null,
    purchases,
    hubEntitlement: hubEnt ?? null,
  };
}
