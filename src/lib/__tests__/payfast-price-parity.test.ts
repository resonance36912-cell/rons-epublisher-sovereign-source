import { describe, it, expect } from "vitest";
import { LOCAL_PLAN_PRICES, type PlanKey } from "@/lib/hub-pricing-check";
import { TIERS } from "@/pages/Pricing";
import { PLAN_LABELS } from "@/components/SubscriptionManager";

/**
 * Billing is delegated to the Resonance Hub, which signs PayFast using the
 * SKU we deep-link with. LOCAL_PLAN_PRICES is the canonical spoke-side
 * catalog. This test guarantees the amount the user sees on Pricing.tsx
 * and inside the SubscriptionManager card is identical to what the Hub
 * will charge for the same lifetime SKU.
 */

const PAID_PLANS = ["starter", "creator", "pro", "business"] as const;
type Paid = (typeof PAID_PLANS)[number];

function parseRand(label: string): number {
  const m = label.match(/R\s*([\d,]+)/);
  if (!m) throw new Error(`Unparseable price label: ${label}`);
  return Number(m[1].replace(/,/g, ""));
}

describe("PayFast amount ↔ displayed price parity", () => {
  it.each(PAID_PLANS)("Pricing.tsx %s once-off card matches Hub amount", (plan: Paid) => {
    const tier = TIERS.find((t) => t.id === plan);
    expect(tier, `missing tier ${plan} in Pricing TIERS`).toBeTruthy();

    const displayed = parseRand(tier!.price);
    const key = `lifetime_${plan}` as PlanKey;
    const canonical = LOCAL_PLAN_PRICES[key];

    expect(canonical, `LOCAL_PLAN_PRICES missing ${key}`).toBeTruthy();
    expect(displayed).toBe(canonical.amount);
    expect(tier!.sub).toBe("Once-off");
    expect(canonical.period).toBe("once");
    expect(canonical.currency).toBe("ZAR");
  });

  it.each(PAID_PLANS)("PLAN_LABELS %s once-off label matches Hub amount", (plan: Paid) => {
    const key = `lifetime_${plan}` as PlanKey;
    const label = PLAN_LABELS[key];
    expect(label, `PLAN_LABELS missing ${key}`).toBeTruthy();
    expect(parseRand(label.price)).toBe(LOCAL_PLAN_PRICES[key].amount);
    expect(label.price).toMatch(/once-off/i);
  });

  it("no subscription (recurring) SKUs remain in the local catalog", () => {
    for (const key of Object.keys(LOCAL_PLAN_PRICES)) {
      expect(key.startsWith("lifetime_"), `${key} must be a lifetime SKU`).toBe(true);
      expect(key).not.toMatch(/_monthly$|_annual$/);
    }
  });
});
