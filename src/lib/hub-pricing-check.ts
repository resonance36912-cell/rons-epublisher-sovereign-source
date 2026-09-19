// Runtime sanity check: compare the public ePublisher pack prices against
// the Resonance Hub billing catalog. Surfaces mismatches via console warnings,
// analytics events, and an optional UI banner so a stale spoke catalog never
// silently disagrees with the Hub-authoritative pack amount.

import { HUB_URL, APP_KEY, EPUBLISHER_PACKS, type HubPackId } from "@/lib/hub";
import { trackEvent } from "@/lib/analytics";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

/**
 * Legacy lifetime-price table retained only for historical audit helpers.
 * The active runtime parity check below uses EPUBLISHER_PACKS.
 */
export const LOCAL_PLAN_PRICES = {
  lifetime_starter:  { amount: 99,  currency: "ZAR", period: "once" as const },
  lifetime_creator:  { amount: 249, currency: "ZAR", period: "once" as const },
  lifetime_pro:      { amount: 499, currency: "ZAR", period: "once" as const },
  lifetime_business: { amount: 699, currency: "ZAR", period: "once" as const },
} as const;

export type PlanKey = keyof typeof LOCAL_PLAN_PRICES;

export interface PriceMismatch {
  plan: PlanKey | HubPackId;
  local: number;
  hub: number;
  currency: string;
}

interface HubCatalogEntry {
  id: HubPackId;
  amount: number;
  currency: string;
  available?: boolean;
}

interface HubCatalogResponse {
  app: string;
  packs: HubCatalogEntry[];
}

function displayedPackAmount(price: string): number {
  return Number(price.replace(/[^0-9]/g, ""));
}

const CATALOG_URL = `${HUB_URL}/api/billing/catalog?app=${APP_KEY}`;
const SESSION_FLAG = "hub_pricing_check_ran";

let lastResult: PriceMismatch[] | null = null;
const listeners = new Set<(m: PriceMismatch[]) => void>();

export function getLastMismatches(): PriceMismatch[] | null {
  return lastResult;
}

export function subscribePricingMismatches(fn: (m: PriceMismatch[]) => void): () => void {
  listeners.add(fn);
  if (lastResult) fn(lastResult);
  return () => { listeners.delete(fn); };
}

function emit(mismatches: PriceMismatch[]) {
  lastResult = mismatches;
  listeners.forEach((fn) => { try { fn(mismatches); } catch { /* noop */ } });
}

/** Fetch + diff. Returns [] when Hub is unreachable (treated as "no signal"). */
export async function runHubPricingCheck(options: { force?: boolean } = {}): Promise<PriceMismatch[]> {
  if (typeof window === "undefined") return [];
  if (OPEN_NOVA_LOCAL_ONLY) {
    sessionStorage.setItem(SESSION_FLAG, "ok");
    emit([]);
    return [];
  }
  if (!options.force && sessionStorage.getItem(SESSION_FLAG) === "ok") {
    return lastResult ?? [];
  }

  let catalog: HubCatalogResponse | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(CATALOG_URL, { signal: ctrl.signal, credentials: "omit" });
    clearTimeout(t);
    if (!res.ok) {
      sessionStorage.setItem(SESSION_FLAG, "ok");
      return [];
    }
    catalog = (await res.json()) as HubCatalogResponse;
  } catch {
    return [];
  }

  if (!catalog?.packs?.length) {
    sessionStorage.setItem(SESSION_FLAG, "ok");
    return [];
  }

  const hubMap = new Map<string, HubCatalogEntry>();
  for (const pack of catalog.packs) hubMap.set(pack.id, pack);

  const mismatches: PriceMismatch[] = [];
  for (const pack of EPUBLISHER_PACKS) {
    const localAmount = displayedPackAmount(pack.price);
    const hub = hubMap.get(pack.id);
    if (!hub) continue;
    if (hub.amount !== localAmount || hub.currency !== "ZAR") {
      mismatches.push({
        plan: pack.id,
        local: localAmount,
        hub: hub.amount,
        currency: "ZAR",
      });
    }
  }

  if (mismatches.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("[hub-pricing-check] Local prices disagree with Hub catalog:", mismatches);
    try { trackEvent("hub_pricing_mismatch", { count: mismatches.length, skus: mismatches.map(m => m.plan).join(",") }); } catch { /* noop */ }
  } else {
    sessionStorage.setItem(SESSION_FLAG, "ok");
  }

  emit(mismatches);
  return mismatches;
}
