// Structured audit log for every checkout intent originating from this spoke.
// Billing runs on the Resonance Hub (Hub signs PayFast), but we record what
// the user clicked (plan/SKU, amount, currency, page, hub URL) so we have a
// spoke-side audit trail to reconcile against Hub-side PayFast records.
//
// After the switch to once-off purchases, "subscription" no longer exists —
// every plan checkout is a lifetime unlock, and every top-up is a credit pack.
// The `CheckoutPeriod` type is retained (frozen to "once") for compatibility
// with existing analytics dashboards.

import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import {
  LOCAL_PLAN_PRICES,
  getLastMismatches,
  runHubPricingCheck,
  type PlanKey,
  type PriceMismatch,
} from "@/lib/hub-pricing-check";
import {
  APP_KEY,
  HUB_URL,
  hubCheckoutUrl,
  hubTopupUrl,
  lifetimeSku,
  type LifetimeTier,
} from "@/lib/hub";

export type CheckoutPlan = LifetimeTier | "bundle";
export type CheckoutPeriod = "once";

export interface CheckoutAuditPayload {
  kind: "lifetime_unlock" | "topup";
  plan: CheckoutPlan | "topup";
  sku: string | null;
  amount: number | null;
  currency: string;
  period: CheckoutPeriod;
  app: string;
  hub_url: string;
  page: string | null;
  source: string;
  ts: string;
}

function safePage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.location.pathname + window.location.search;
  } catch {
    return null;
  }
}

function priceFor(plan: CheckoutPlan): { amount: number | null; currency: string; sku: string | null } {
  if (plan === "bundle") return { amount: null, currency: "ZAR", sku: null };
  const sku = lifetimeSku(plan) as PlanKey;
  const local = LOCAL_PLAN_PRICES[sku];
  return { amount: local?.amount ?? null, currency: local?.currency ?? "ZAR", sku };
}

function emit(payload: CheckoutAuditPayload): void {
  try { console.info("[hub-checkout]", payload); } catch { /* noop */ }
  try { trackEvent("hub_checkout_intent", payload as unknown as Record<string, unknown>); } catch { /* noop */ }
}

/**
 * Log a lifetime-unlock checkout intent. Signature is kept
 * backwards-compatible with the previous subscription flow — the
 * `period` argument is ignored (always "once") and left for callers
 * that haven't been updated yet.
 */
export function logSubscriptionCheckout(
  plan: CheckoutPlan,
  _period: CheckoutPeriod | "monthly" | "annual" | unknown,
  source: string,
): string {
  const { amount, currency, sku } = priceFor(plan);
  const hub_url = hubCheckoutUrl(plan);
  emit({
    kind: "lifetime_unlock",
    plan,
    sku,
    amount,
    currency,
    period: "once",
    app: APP_KEY,
    hub_url,
    page: safePage(),
    source,
    ts: new Date().toISOString(),
  });
  return hub_url;
}

/** Log a top-up (credit pack) checkout intent. */
export function logTopupCheckout(source: string): string {
  const hub_url = hubTopupUrl();
  emit({
    kind: "topup",
    plan: "topup",
    sku: null,
    amount: null,
    currency: "ZAR",
    period: "once",
    app: APP_KEY,
    hub_url,
    page: safePage(),
    source,
    ts: new Date().toISOString(),
  });
  return hub_url;
}

export { HUB_URL };

function findMismatch(plan: CheckoutPlan): PriceMismatch | null {
  if (plan === "bundle") return null;
  const sku = lifetimeSku(plan) as PlanKey;
  const list = getLastMismatches() ?? [];
  return list.find((m) => m.plan === sku) ?? null;
}

function openHub(url: string): void {
  try { window.open(url, "_blank", "noopener,noreferrer"); }
  catch { window.location.href = url; }
}

/**
 * Verify the displayed unlock price matches the Hub catalog. If a
 * mismatch is known, surface a toast with a Retry action that re-checks
 * the catalog and re-opens checkout on success. Returns `true` when it
 * is safe to proceed with the original navigation.
 */
export function verifyCheckoutPriceOrToast(
  plan: CheckoutPlan,
  _period: CheckoutPeriod | "monthly" | "annual" | unknown,
  source: string,
): boolean {
  const mismatch = findMismatch(plan);
  if (!mismatch) return true;

  const hub_url = hubCheckoutUrl(plan);
  try {
    trackEvent("hub_checkout_blocked_price_mismatch", {
      sku: mismatch.plan,
      local: mismatch.local,
      hub: mismatch.hub,
      currency: mismatch.currency,
      source,
    });
  } catch { /* noop */ }

  toast.error("Price changed since this page loaded", {
    description: `Displayed ${mismatch.currency} ${mismatch.local} vs current ${mismatch.currency} ${mismatch.hub}. Refresh to see the latest price, or retry to continue at the current amount.`,
    duration: 12000,
    action: {
      label: "Retry checkout",
      onClick: async () => {
        const t = toast.loading("Re-checking current price…");
        try {
          const next = await runHubPricingCheck({ force: true });
          const still = next.find((m) => m.plan === lifetimeSku(plan as LifetimeTier));
          toast.dismiss(t);
          if (still) {
            toast.error("Price still differs", {
              description: `Current ${still.currency} ${still.hub}. Please refresh the page.`,
            });
            return;
          }
          logSubscriptionCheckout(plan, "once", `${source}_retry`);
          openHub(hub_url);
        } catch {
          toast.dismiss(t);
          openHub(hub_url);
        }
      },
    },
  });
  return false;
}
