import { useQuery } from "@tanstack/react-query";
import { APP_KEY, type Tier } from "@/lib/hub";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

export interface HubEntitlement {
  tier: Tier;
  status: "active" | "trialing" | "canceled" | "none";
  current_period_end: string | null;
  creditsRemaining: number;
  packTier: string | null;
  source: "hub" | "fallback" | "anon";
}

type RonsSession = {
  authenticated?: boolean;
  tier?: Tier;
  status?: string;
  current_period_end?: string | null;
  currentPeriodEnd?: string | null;
  credits_remaining?: number;
  creditsRemaining?: number;
  pack_tier?: string | null;
  packTier?: string | null;
};

async function fetchHubEntitlement(): Promise<HubEntitlement> {
  try {
    const res = await fetch("/_rons/session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { tier: null, status: "none", current_period_end: null, creditsRemaining: 0, packTier: null, source: "fallback" };
    const json = (await res.json()) as RonsSession;
    if (!json.authenticated) return { tier: null, status: "none", current_period_end: null, creditsRemaining: 0, packTier: null, source: "anon" };
    const mappedStatus = json.status === "active" ? "active" : "none";
    return {
      tier: json.tier ?? null,
      status: mappedStatus,
      current_period_end: json.current_period_end ?? json.currentPeriodEnd ?? null,
      creditsRemaining: Math.max(0, Number(json.creditsRemaining ?? json.credits_remaining ?? 0) || 0),
      packTier: json.packTier ?? json.pack_tier ?? null,
      source: "hub",
    };
  } catch {
    return { tier: null, status: "none", current_period_end: null, creditsRemaining: 0, packTier: null, source: "fallback" };
  }
}

export function useHubEntitlement() {
  return useQuery<HubEntitlement>({
    queryKey: ["hub-entitlement", APP_KEY, OPEN_NOVA_LOCAL_ONLY ? "local" : "cookie"],
    queryFn: fetchHubEntitlement,
    enabled: !OPEN_NOVA_LOCAL_ONLY,
    initialData: OPEN_NOVA_LOCAL_ONLY
      ? { tier: "business", status: "active", current_period_end: null, creditsRemaining: Number.POSITIVE_INFINITY, packTier: "studio_pack", source: "fallback" }
      : undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: !OPEN_NOVA_LOCAL_ONLY,
    retry: OPEN_NOVA_LOCAL_ONLY ? 0 : 1,
  });
}
