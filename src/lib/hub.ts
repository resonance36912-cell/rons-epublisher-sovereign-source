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

/** Canonical Hub pack IDs for new ePublisher purchases. */
export type HubPackId =
  | "epublisher_starter_pack"
  | "epublisher_creator_pack"
  | "epublisher_studio_pack";

export const EPUBLISHER_PACKS = [
  { id: "epublisher_starter_pack", name: "Starter Pack", price: "R99", credits: 99, blurb: "First-book kit" },
  { id: "epublisher_creator_pack", name: "Creator Pack", price: "R299", credits: 299, blurb: "For active authors" },
  { id: "epublisher_studio_pack", name: "Studio Pack", price: "R699", credits: 699, blurb: "Backlist migration" },
] as const satisfies ReadonlyArray<{ id: HubPackId; name: string; price: string; credits: number; blurb: string }>;

/** Legacy lifetime IDs remain readable for historical purchases only. */
export function lifetimeSku(plan: LifetimeTier): string {
  return `lifetime_${plan}`;
}

/**
 * Legacy compatibility entry point. Lifetime SKUs are historical only, so any
 * old caller is redirected to the Hub pricing authority instead of constructing
 * an invalid checkout URL.
 */
export function hubCheckoutUrl(
  _plan: LifetimeTier | "bundle" = "creator",
): string {
  return `${HUB_URL}/pricing#epublisher`;
}

/** Build a canonical Hub once-off pack checkout URL. */
export function hubPackCheckoutUrl(packId: HubPackId): string {
  const returnTo = typeof window !== "undefined" ? window.location.href : "/";
  return `${HUB_URL}/checkout?pack=${encodeURIComponent(packId)}&return_to=${encodeURIComponent(returnTo)}`;
}

export const HUB_PRICING_URL = `${HUB_URL}/pricing` as const;
export const HUB_BILLING_URL = `${HUB_URL}/account` as const;
export const HUB_SUPPORT_URL = `${HUB_URL}/support` as const;
export const HUB_UPDATES_URL = `${HUB_URL}/updates` as const;

/** Generic top-up entry: delegate pack selection to the Hub authority. */
export function hubTopupUrl(): string {
  return `${HUB_URL}/pricing#epublisher`;
}
