// Centralized references to the Resonance Hub at reson8.life.
// Spoke apps delegate billing and pricing to the Hub — see
// docs/branding/HUB_PAYMENTS_INTEGRATION.md.

export const HUB_URL = "https://reson8.life" as const;
export const APP_KEY = "epublisher" as const;

export type Tier = "free" | "starter" | "creator" | "pro" | "business" | null;

const TIER_ORDER = ["free", "starter", "creator", "pro", "business"] as const;
export function tierMeets(have: Tier, need: Exclude<Tier, null | "free">): boolean {
  if (!have) return false;
  return TIER_ORDER.indexOf(have) >= TIER_ORDER.indexOf(need);
}

export type LifetimeTier = "starter" | "creator" | "pro" | "business";
export type CreditPack = "pack_taste" | "pack_starter" | "pack_creator" | "pack_studio";

/** Map a plan name to its canonical Hub SKU. */
export function lifetimeSku(plan: LifetimeTier): string {
  return `lifetime_${plan}`;
}

/**
 * Build a Hub checkout URL for a lifetime tier unlock. The Hub is
 * the one signing PayFast; we just deep-link with the SKU + return_to.
 */
export function hubCheckoutUrl(
  plan: LifetimeTier | "bundle" = "creator",
): string {
  const returnTo = typeof window !== "undefined" ? window.location.href : "/";
  const sku = plan === "bundle" ? "bundle" : lifetimeSku(plan);
  return `${HUB_URL}/checkout?app=${APP_KEY}&sku=${sku}&return_to=${encodeURIComponent(returnTo)}`;
}

/** Build a Hub credit-pack (top-up) checkout URL. */
export function hubPackCheckoutUrl(packId: CreditPack): string {
  const returnTo = typeof window !== "undefined" ? window.location.href : "/";
  return `${HUB_URL}/checkout?app=${APP_KEY}&sku=${packId}&return_to=${encodeURIComponent(returnTo)}`;
}

export const HUB_PRICING_URL = `${HUB_URL}/pricing` as const;
export const HUB_BILLING_URL = `${HUB_URL}/account` as const;
export const HUB_SUPPORT_URL = `${HUB_URL}/support` as const;
export const HUB_UPDATES_URL = `${HUB_URL}/updates` as const;

/** Generic top-up entry (Hub picks default pack). */
export function hubTopupUrl(): string {
  const returnTo = typeof window !== "undefined" ? window.location.href : "/";
  return `${HUB_URL}/checkout?app=${APP_KEY}&product=topup&return_to=${encodeURIComponent(returnTo)}`;
}
