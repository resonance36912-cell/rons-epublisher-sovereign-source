import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/sovereign-mode");
});

describe("hosted billing lookup remains reachable outside sovereign-local mode", () => {
  it("uses the Hub catalog when local-only mode is disabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sovereign-mode", () => ({ OPEN_NOVA_LOCAL_ONLY: false }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      app: "epublisher",
      skus: [
        { sku: "lifetime_starter", amount: 99, currency: "ZAR" },
        { sku: "lifetime_creator", amount: 249, currency: "ZAR" },
        { sku: "lifetime_pro", amount: 499, currency: "ZAR" },
        { sku: "lifetime_business", amount: 699, currency: "ZAR" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const { runHubPricingCheck } = await import("@/lib/hub-pricing-check");
    expect(await runHubPricingCheck({ force: true })).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the credit-pack Supabase lookup active outside local-only mode", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sovereign-mode", () => ({ OPEN_NOVA_LOCAL_ONLY: false }));
    const { supabase } = await import("@/integrations/supabase/client");
    const fromSpy = vi.spyOn(supabase, "from");
    const { fetchActiveCreditPacks } = await import("@/lib/credit-packs");
    await fetchActiveCreditPacks();
    expect(fromSpy).toHaveBeenCalledWith("credit_packs");
  });
});
