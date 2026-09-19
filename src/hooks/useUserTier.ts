import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHubEntitlement } from "@/hooks/useHubEntitlement";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";


/**
 * Legacy tier union — kept as the canonical runtime type so existing
 * `tier === "premium"` capability checks continue to work while the
 * Hub transitions billing authority to passes and once-off packs. Effective
 * capability bands are exposed via `effectiveTier` and collapse to this union.
 */
export type UserTier = "free" | "standard" | "premium";

/** Legacy capability bands retained for existing feature gates. */
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

const EFFECTIVE_RANK: Record<EffectiveTier, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
  business: 4,
};

function normalizeHubTier(value: unknown): EffectiveTier | null {
  switch (value) {
    case "free": return "free";
    case "starter": return "starter";
    case "creator":
    case "creator_pass": return "creator";
    case "pro": return "pro";
    case "business":
    case "studio_pass": return "business";
    default: return null;
  }
}

function effectiveTierFromPack(value: unknown): EffectiveTier | null {
  switch (value) {
    case "starter_pack": return "starter";
    case "creator_pack": return "creator";
    case "studio_pack": return "business";
    default: return null;
  }
}

function maxEffectiveTier(a: EffectiveTier, b: EffectiveTier | null): EffectiveTier {
  return b && EFFECTIVE_RANK[b] > EFFECTIVE_RANK[a] ? b : a;
}

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

  const creditsRemaining = Math.max(0, Number(hubEnt?.creditsRemaining ?? 0) || 0);
  const hasPaidCredits = creditsRemaining > 0;

  if (
    hubEnt?.source === "hub" &&
    hubEnt.tier &&
    (hubEnt.status === "active" || hubEnt.status === "trialing")
  ) {
    effectiveTier = maxEffectiveTier(effectiveTier, normalizeHubTier(hubEnt.tier));
  }

  // Once-off Hub packs fund the wallet rather than creating subscription rows.
  // While credits remain, preserve the pack's capability band without treating
  // the purchase as a recurring/lifetime subscription.
  if (hubEnt?.source === "hub" && hasPaidCredits) {
    effectiveTier = maxEffectiveTier(effectiveTier, effectiveTierFromPack(hubEnt.packTier));
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
    creditsRemaining,
    hasPaidCredits,
    canGenerateImages: tier !== "free" || hasPaidCredits,
    // Premium narration is credit-gated server-side; a funded pack may use it
    // even when no legacy subscription tier exists.
    canUseNarration: true,
    canPublish: tier === "premium" || hasPaidCredits,
    hasSupport: tier === "premium",
    /** Retired: subscriptions no longer exist. Kept as `null` for compat. */
    subscription: null as null,
    purchases,
    hubEntitlement: hubEnt ?? null,
  };
}
