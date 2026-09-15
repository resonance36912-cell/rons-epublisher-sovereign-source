import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIFETIME_PRICE_ZAR } from "../profitabilityMath";

const PANEL_SRC = readFileSync(
  resolve(__dirname, "../ProfitabilityPanel.tsx"),
  "utf8",
);

describe("ProfitabilityPanel — on-screen copy parity", () => {
  it("advertises each canonical lifetime SKU with the price from the constants module", () => {
    const canonical: Array<[string, number]> = [
      ["Starter",  LIFETIME_PRICE_ZAR.lifetime_starter],   // 99
      ["Creator",  LIFETIME_PRICE_ZAR.lifetime_creator],   // 249
      ["Pro",      LIFETIME_PRICE_ZAR.lifetime_pro],       // 499
      ["Business", LIFETIME_PRICE_ZAR.lifetime_business],  // 699
    ];
    for (const [label, price] of canonical) {
      expect(PANEL_SRC).toContain(`${label} R${price}`);
    }
  });

  it("names the four active credit packs (Taste/Starter/Creator/Studio)", () => {
    for (const pack of ["Taste R49", "Starter R99", "Creator R249", "Studio R599"]) {
      expect(PANEL_SRC).toContain(pack);
    }
  });

  it("describes the revenue model as once-off + amortized, not subscription", () => {
    expect(PANEL_SRC).toMatch(/once-off lifetime unlocks/i);
    expect(PANEL_SRC).toMatch(/amortized over \{AMORT_MONTHS\} months/);
    // Guard against copy regressing to the retired subscription language.
    expect(PANEL_SRC).not.toMatch(/\/mo per active subscription/i);
    expect(PANEL_SRC).not.toMatch(/R149 once-off/);
  });
});
