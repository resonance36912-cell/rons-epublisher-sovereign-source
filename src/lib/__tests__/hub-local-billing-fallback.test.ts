import { describe, expect, it, vi } from "vitest";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { runHubPricingCheck } from "@/lib/hub-pricing-check";
import { fetchActiveCreditPacks, fetchCreditPack, FALLBACK_CREDIT_PACKS } from "@/lib/credit-packs";
import { supabase } from "@/integrations/supabase/client";

describe("sovereign-local billing fallback", () => {
  it("does not call the remote Hub catalog in local-only mode", async () => {
    expect(OPEN_NOVA_LOCAL_ONLY).toBe(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runHubPricingCheck({ force: true });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("serves seeded credit packs without querying Supabase", async () => {
    const fromSpy = vi.spyOn(supabase, "from");
    expect(await fetchActiveCreditPacks()).toEqual(FALLBACK_CREDIT_PACKS);
    expect(await fetchCreditPack("pack_creator")).toEqual(FALLBACK_CREDIT_PACKS[2]);
    expect(fromSpy).not.toHaveBeenCalled();
    fromSpy.mockRestore();
  });
});