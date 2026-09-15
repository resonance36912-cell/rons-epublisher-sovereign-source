// Pure math for ProfitabilityPanel. Kept in its own module so it can be
// unit-tested without pulling in Supabase or React.
import type { UserTier } from "@/hooks/useUserTier";

export const AMORT_MONTHS = 12;

/** Once-off ZAR prices — must stay in sync with src/pages/Pricing.tsx and paystack-webhook. */
export const LIFETIME_PRICE_ZAR: Record<string, number> = {
  lifetime_starter: 99,
  starter_once_off: 99,
  lifetime_creator: 249,
  creator_once_off: 249,
  standard_once_off: 249,
  lifetime_pro: 499,
  pro_once_off: 499,
  premium_once_off: 499,
  lifetime_business: 699,
  business_once_off: 699,
  ultimate_once_off: 699,
};

/** Payfast fee schedule: percentage of gross + fixed ZAR per paying user. */
export const PAYFAST_PCT = 0.035;
export const PAYFAST_FIXED_ZAR = 2;

/** Legacy tier facade collapse used by ProfitabilityPanel. */
export function legacyTierForLifetimePrice(priceZar: number): UserTier {
  if (priceZar >= 499) return "premium";
  if (priceZar > 0) return "standard";
  return "free";
}

export type ProfitabilityInput = {
  profiles: Array<{ user_id: string }>;
  purchases: Array<{
    user_id: string;
    price_id: string;
    amount_total: number | null;
    created_at: string;
  }>;
  logs: Array<{ user_id: string | null; cost_estimate: number | null }>;
  fxUsdToZar: number;
  /** Defaults to now(). Injectable for deterministic tests. */
  now?: Date;
};

export type TierRow = {
  tier: UserTier;
  users: number;
  revenueZar: number;
  costZar: number;
  payfastZar: number;
  marginZar: number;
  marginPct: number;
  costPerUserZar: number;
};

export const TIER_ORDER_MATH: UserTier[] = ["free", "standard", "premium"];

export function computeProfitability(input: ProfitabilityInput): TierRow[] {
  const now = (input.now ?? new Date()).getTime();
  const windowStart = now - 30 * 86400000;

  const tierByUser = new Map<string, UserTier>();
  const bestPriceByUser = new Map<string, number>();
  for (const p of input.profiles) tierByUser.set(p.user_id, "free");

  for (const pu of input.purchases) {
    const price = LIFETIME_PRICE_ZAR[pu.price_id] ?? 0;
    if (price <= 0) continue;
    const prev = bestPriceByUser.get(pu.user_id) ?? 0;
    if (price > prev) bestPriceByUser.set(pu.user_id, price);
    const legacy = legacyTierForLifetimePrice(price);
    const current = tierByUser.get(pu.user_id) ?? "free";
    if (legacy === "premium" || current === "free") tierByUser.set(pu.user_id, legacy);
  }

  const packRevZarByUser = new Map<string, number>();
  for (const pu of input.purchases) {
    if (LIFETIME_PRICE_ZAR[pu.price_id]) continue;
    if (new Date(pu.created_at).getTime() < windowStart) continue;
    const zar = (pu.amount_total ?? 0) / 100;
    if (zar <= 0) continue;
    packRevZarByUser.set(pu.user_id, (packRevZarByUser.get(pu.user_id) ?? 0) + zar);
  }

  const costByUser = new Map<string, number>();
  for (const l of input.logs) {
    if (!l.user_id) continue;
    costByUser.set(l.user_id, (costByUser.get(l.user_id) ?? 0) + Number(l.cost_estimate ?? 0));
  }

  const agg: Record<UserTier, { users: number; costUsd: number; revenueZar: number }> = {
    free: { users: 0, costUsd: 0, revenueZar: 0 },
    standard: { users: 0, costUsd: 0, revenueZar: 0 },
    premium: { users: 0, costUsd: 0, revenueZar: 0 },
  };
  for (const [uid, tier] of tierByUser.entries()) {
    agg[tier].users += 1;
    agg[tier].costUsd += costByUser.get(uid) ?? 0;
    const lifetimeAmort = (bestPriceByUser.get(uid) ?? 0) / AMORT_MONTHS;
    agg[tier].revenueZar += lifetimeAmort + (packRevZarByUser.get(uid) ?? 0);
  }

  return TIER_ORDER_MATH.map((tier) => {
    const { users, costUsd, revenueZar } = agg[tier];
    const costZar = costUsd * input.fxUsdToZar;
    const payfastZar =
      tier === "free" ? 0 : revenueZar * PAYFAST_PCT + users * PAYFAST_FIXED_ZAR;
    const marginZar = revenueZar - costZar - payfastZar;
    const marginPct = revenueZar > 0 ? (marginZar / revenueZar) * 100 : 0;
    const costPerUserZar = users > 0 ? costZar / users : 0;
    return { tier, users, revenueZar, costZar, payfastZar, marginZar, marginPct, costPerUserZar };
  });
}
