import { describe, expect, it } from "vitest";
import { EPUBLISHER_PACKS, hubCheckoutUrl, hubPackCheckoutUrl, hubTopupUrl } from "@/lib/hub";
import { TIERS } from "@/pages/Pricing";

describe("free-promotion billing suppression", () => {
  for (const pack of EPUBLISHER_PACKS) {
    it(`does not build a checkout URL for ${pack.id} during the promotion`, () => {
      expect(hubPackCheckoutUrl(pack.id)).toBe("/app");
    });
  }

  it("keeps legacy lifetime SKUs off the public pricing catalog", () => {
    const publicIds = TIERS.map((tier) => tier.id);
    expect(publicIds.some((id) => id.startsWith("lifetime_"))).toBe(false);
    expect(publicIds).toEqual([
      "free",
      "epublisher_starter_pack",
      "epublisher_creator_pack",
      "epublisher_studio_pack",
    ]);
  });

  it("routes all legacy upgrade/top-up helpers back into the free app", () => {
    expect(hubCheckoutUrl("creator")).toBe("/app");
    expect(hubTopupUrl()).toBe("/app");
  });
});
