import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EPUBLISHER_PACKS, hubCheckoutUrl, hubPackCheckoutUrl, hubTopupUrl } from "@/lib/hub";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

describe("free-promotion billing suppression", () => {
  it("keeps the promotion active", () => {
    expect(FREE_PROMOTION_ACTIVE).toBe(true);
  });

  for (const pack of EPUBLISHER_PACKS) {
    it("does not build a checkout URL for " + pack.id, () => {
      expect(hubPackCheckoutUrl(pack.id)).toBe("/app");
    });
  }

  it("routes legacy upgrade and top-up helpers back into the free app", () => {
    expect(hubCheckoutUrl("creator")).toBe("/app");
    expect(hubTopupUrl()).toBe("/app");
  });

  it("keeps historical price ladders out of the public pricing page", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/Pricing.tsx"), "utf8");
    expect(source).not.toMatch(/R(?:99|299|699)\b/);
    expect(source).not.toContain("hubPackCheckoutUrl");
    expect(source).not.toContain("Buy Creator");
    expect(source).toContain("Open ePublisher free");
  });
});
