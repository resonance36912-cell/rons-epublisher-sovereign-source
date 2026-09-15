// Runtime sanity check: compare locally hardcoded lifetime unlock prices
// against the Resonance Hub billing catalog. Surfaces mismatches via
// console warnings, analytics events, and an optional UI banner so a
// stale spoke catalog never silently disagrees with the Hub PayFast amount.

import { HUB_URL, APP_KEY } from "@/lib/hub";
import { trackEvent } from "@/lib/analytics";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

/**
 * Source-of-truth (local) prices shown in this app. ZAR, once-off.
 * Keys use the SKU that the Hub receives at checkout.
 */
export const LOCAL_PLAN_PRICES = {
  lifetime_starter:  { amount: 99,  currency: "ZAR", period: "once" as const },
  lifetime_creator:  { amount: 249, currency: "ZAR", period: "once" as const },
  lifetime_pro:      { amount: 499, currency: "ZAR", period: "once" as const },
  lifetime_business: { amount: 699, currency: "ZAR", period: "once" as const },
} as const;

export type PlanKey = keyof typeof LOCAL_PLAN_PRICES;

export interface PriceMismatch {
  plan: PlanKey;
  local: number;
  hub: number;
  currency: string;
}

interface HubCatalogEntry {
  sku: string;           // e.g. "lifetime_creator"
  amount: number;        // ZAR major units
  currency: string;
}

interface HubCatalogResponse {
  app: string;
  skus: HubCatalogEntry[];
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

  if (!catalog?.skus?.length) {
    sessionStorage.setItem(SESSION_FLAG, "ok");
    return [];
  }

  const hubMap = new Map<string, HubCatalogEntry>();
  for (const p of catalog.skus) hubMap.set(p.sku, p);

  const mismatches: PriceMismatch[] = [];
  for (const key of Object.keys(LOCAL_PLAN_PRICES) as PlanKey[]) {
    const local = LOCAL_PLAN_PRICES[key];
    const hub = hubMap.get(key);
    if (!hub) continue;
    if (hub.amount !== local.amount || hub.currency !== local.currency) {
      mismatches.push({
        plan: key,
        local: local.amount,
        hub: hub.amount,
        currency: local.currency,
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
