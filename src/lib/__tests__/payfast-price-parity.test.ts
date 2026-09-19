import { describe, expect, it } from "vitest";
import { EPUBLISHER_PACKS, hubCheckoutUrl, hubPackCheckoutUrl, hubTopupUrl } from "@/lib/hub";
import { TIERS } from "@/pages/Pricing";

function parseRand(label: string): number {
  const m = label.match(/R\s*([\d,]+)/);
  if (!m) throw new Error(`Unparseable price label: ${label}`);
  return Number(m[1].replace(/,/g, ""));
}

describe("Hub pack checkout ↔ displayed price parity", () => {
  for (const pack of EPUBLISHER_PACKS) {
    it(`renders ${pack.id} at the Hub-authoritative price`, () => {
      const tier = TIERS.find((item) => item.id === pack.id);
      expect(tier, `missing pack ${pack.id} in Pricing TIERS`).toBeTruthy();
      expect(parseRand(tier!.price)).toBe(parseRand(pack.price));
      expect(tier!.sub).toBe("Once-off");
    });

    it(`builds a canonical Hub checkout URL for ${pack.id}`, () => {
      const url = hubPackCheckoutUrl(pack.id);
      expect(url).toContain(`/checkout?pack=${pack.id}`);
      expect(url).not.toContain("lifetime_");
      expect(url).not.toContain("paystack");
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

  it("routes legacy upgrade/top-up helpers to Hub pricing instead of invalid checkout SKUs", () => {
    expect(hubCheckoutUrl("creator")).toBe("https://reson8.life/pricing#epublisher");
    expect(hubTopupUrl()).toBe("https://reson8.life/pricing#epublisher");
  });
});
