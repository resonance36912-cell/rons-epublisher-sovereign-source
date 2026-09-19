import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/sovereign-mode");
});

describe("hosted billing lookup during the free promotion", () => {
  it("does not call the Hub pricing catalog while promotion pricing is disabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sovereign-mode", () => ({ OPEN_NOVA_LOCAL_ONLY: false }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { runHubPricingCheck } = await import("@/lib/hub-pricing-check");
    expect(await runHubPricingCheck({ force: true })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
