import { describe, it, expect } from "vitest";
import {
  AMORT_MONTHS,
  LIFETIME_PRICE_ZAR,
  PAYFAST_PCT,
  PAYFAST_FIXED_ZAR,
  computeProfitability,
  legacyTierForLifetimePrice,
} from "../profitabilityMath";

const NOW = new Date("2026-07-15T00:00:00Z");
const recent = new Date(NOW.getTime() - 5 * 86400000).toISOString();
const old = new Date(NOW.getTime() - 60 * 86400000).toISOString();

describe("LIFETIME_PRICE_ZAR — pricing constant parity", () => {
  it("matches the intended South African lifetime prices", () => {
    // These four are the ONLY canonical SKUs. Legacy aliases must resolve to the same amount.
    expect(LIFETIME_PRICE_ZAR.lifetime_starter).toBe(99);
    expect(LIFETIME_PRICE_ZAR.lifetime_creator).toBe(249);
    expect(LIFETIME_PRICE_ZAR.lifetime_pro).toBe(499);
    expect(LIFETIME_PRICE_ZAR.lifetime_business).toBe(699);
  });

  it("keeps every legacy alias in lock-step with its canonical SKU", () => {
    const groups: Array<[number, string[]]> = [
      [99,  ["lifetime_starter",  "starter_once_off"]],
      [249, ["lifetime_creator",  "creator_once_off", "standard_once_off"]],
      [499, ["lifetime_pro",      "pro_once_off",     "premium_once_off"]],
      [699, ["lifetime_business", "business_once_off","ultimate_once_off"]],
    ];
    for (const [price, skus] of groups) {
      for (const sku of skus) expect(LIFETIME_PRICE_ZAR[sku]).toBe(price);
    }
  });

  it("collapses lifetime prices onto the legacy tier facade", () => {
    expect(legacyTierForLifetimePrice(99)).toBe("standard");
    expect(legacyTierForLifetimePrice(249)).toBe("standard");
    expect(legacyTierForLifetimePrice(499)).toBe("premium");
    expect(legacyTierForLifetimePrice(699)).toBe("premium");
    expect(legacyTierForLifetimePrice(0)).toBe("free");
  });
});

describe("computeProfitability — amortized revenue math", () => {
  it("amortizes a single lifetime unlock over 12 months", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "u1" }],
      purchases: [{ user_id: "u1", price_id: "lifetime_creator", amount_total: 24900, created_at: old }],
      logs: [],
      fxUsdToZar: 18.5,
      now: NOW,
    });
    const standard = rows.find((r) => r.tier === "standard")!;
    expect(standard.users).toBe(1);
    expect(standard.revenueZar).toBeCloseTo(249 / AMORT_MONTHS, 6);
  });

  it("uses the highest-value unlock when a user has multiple", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "u1" }],
      purchases: [
        { user_id: "u1", price_id: "lifetime_starter",  amount_total: 9900,  created_at: old },
        { user_id: "u1", price_id: "lifetime_business", amount_total: 69900, created_at: old },
      ],
      logs: [],
      fxUsdToZar: 18.5,
      now: NOW,
    });
    expect(rows.find((r) => r.tier === "standard")!.users).toBe(0);
    const premium = rows.find((r) => r.tier === "premium")!;
    expect(premium.users).toBe(1);
    expect(premium.revenueZar).toBeCloseTo(699 / AMORT_MONTHS, 6);
  });

  it("adds credit-pack top-ups from the last 30 days and ignores older packs", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "u1" }],
      purchases: [
        { user_id: "u1", price_id: "lifetime_pro", amount_total: 49900, created_at: old },
        { user_id: "u1", price_id: "pack_creator", amount_total: 24900, created_at: recent }, // in-window
        { user_id: "u1", price_id: "pack_studio",  amount_total: 59900, created_at: old },    // out-of-window
      ],
      logs: [],
      fxUsdToZar: 18.5,
      now: NOW,
    });
    const premium = rows.find((r) => r.tier === "premium")!;
    // 499/12 amortized lifetime + 249 in-window pack, old pack excluded.
    expect(premium.revenueZar).toBeCloseTo(499 / AMORT_MONTHS + 249, 6);
  });

  it("applies Payfast fees only to paying tiers", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "free" }, { user_id: "paid" }],
      purchases: [{ user_id: "paid", price_id: "lifetime_starter", amount_total: 9900, created_at: old }],
      logs: [],
      fxUsdToZar: 18.5,
      now: NOW,
    });
    const free = rows.find((r) => r.tier === "free")!;
    const standard = rows.find((r) => r.tier === "standard")!;
    expect(free.payfastZar).toBe(0);
    const expectedFee = standard.revenueZar * PAYFAST_PCT + 1 * PAYFAST_FIXED_ZAR;
    expect(standard.payfastZar).toBeCloseTo(expectedFee, 6);
  });

  it("converts USD API cost to ZAR at the supplied FX rate", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "u1" }],
      purchases: [{ user_id: "u1", price_id: "lifetime_pro", amount_total: 49900, created_at: old }],
      logs: [{ user_id: "u1", cost_estimate: 2 }], // $2 → R37 at 18.5
      fxUsdToZar: 18.5,
      now: NOW,
    });
    const premium = rows.find((r) => r.tier === "premium")!;
    expect(premium.costZar).toBeCloseTo(37, 6);
    expect(premium.costPerUserZar).toBeCloseTo(37, 6);
    expect(premium.marginZar).toBeCloseTo(
      premium.revenueZar - premium.costZar - premium.payfastZar,
      6,
    );
    expect(premium.marginPct).toBeCloseTo((premium.marginZar / premium.revenueZar) * 100, 6);
  });

  it("treats profile-only users as free with zero revenue and margin", () => {
    const rows = computeProfitability({
      profiles: [{ user_id: "u1" }, { user_id: "u2" }],
      purchases: [],
      logs: [],
      fxUsdToZar: 18.5,
      now: NOW,
    });
    const free = rows.find((r) => r.tier === "free")!;
    expect(free.users).toBe(2);
    expect(free.revenueZar).toBe(0);
    expect(free.marginPct).toBe(0);
  });
});
