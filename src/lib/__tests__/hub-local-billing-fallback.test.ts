import { describe, expect, it, vi } from "vitest";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { runHubPricingCheck } from "@/lib/hub-pricing-check";

describe("sovereign-local billing fallback", () => {
  it("does not call the remote Hub catalog in local-only mode", async () => {
    expect(OPEN_NOVA_LOCAL_ONLY).toBe(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runHubPricingCheck({ force: true });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
