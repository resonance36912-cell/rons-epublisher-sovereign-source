// Deterministic large-scale fixture generator for ProfitabilityPanel tests.
// Produces realistic profile/purchase/log distributions so render-parity tests
// exercise the same shapes as production data.

export type MockProfile = { user_id: string };
export type MockPurchase = {
  user_id: string;
  price_id: string;
  amount_total: number | null;
  created_at: string;
};
export type MockLog = { user_id: string | null; cost_estimate: number | null };

export type MockFixture = {
  profiles: MockProfile[];
  purchases: MockPurchase[];
  logs: MockLog[];
  /** Frozen "now" the fixture was generated against — pass to computeProfitability. */
  now: Date;
};

/** Tiny seeded RNG (mulberry32) — deterministic across runs. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const LIFETIME_SKUS: Array<{ sku: string; kobo: number }> = [
  { sku: "lifetime_starter",  kobo:  9900 },
  { sku: "lifetime_creator",  kobo: 24900 },
  { sku: "lifetime_pro",      kobo: 49900 },
  { sku: "lifetime_business", kobo: 69900 },
  // Legacy aliases mixed in to prove they still resolve.
  { sku: "creator_once_off",  kobo: 24900 },
  { sku: "premium_once_off",  kobo: 49900 },
];

const PACK_SKUS: Array<{ sku: string; kobo: number }> = [
  { sku: "pack_taste",   kobo:  4900 },
  { sku: "pack_starter", kobo:  9900 },
  { sku: "pack_creator", kobo: 24900 },
  { sku: "pack_studio",  kobo: 59900 },
];

export type MockOptions = {
  seed?: number;
  totalUsers?: number;
  /** Fraction of users that own at least one lifetime unlock. */
  paidRate?: number;
  /** Fraction of paying users who also buy a credit pack in the last 30d. */
  packRate?: number;
  /** Reference "now" (defaults to actual current time). */
  now?: Date;
};

export function makeProfitabilityFixture(opts: MockOptions = {}): MockFixture {
  const {
    seed = 20260703,
    totalUsers = 500,
    paidRate = 0.32,
    packRate = 0.45,
    now = new Date(),
  } = opts;

  const rand = rng(seed);
  const nowMs = now.getTime();
  const inWindow = () => new Date(nowMs - Math.floor(rand() * 29 * 86400000)).toISOString();
  const outWindow = () => new Date(nowMs - (31 + Math.floor(rand() * 300)) * 86400000).toISOString();

  const profiles: MockProfile[] = Array.from({ length: totalUsers }, (_, i) => ({
    user_id: `u_${i.toString().padStart(4, "0")}`,
  }));

  const purchases: MockPurchase[] = [];
  const logs: MockLog[] = [];

  for (const p of profiles) {
    const uid = p.user_id;
    const paid = rand() < paidRate;

    if (paid) {
      // 1-2 lifetime unlocks (upgrade path); highest wins in the panel math.
      const first = LIFETIME_SKUS[Math.floor(rand() * LIFETIME_SKUS.length)];
      purchases.push({ user_id: uid, price_id: first.sku, amount_total: first.kobo, created_at: outWindow() });
      if (rand() < 0.15) {
        const upgrade = LIFETIME_SKUS[Math.floor(rand() * LIFETIME_SKUS.length)];
        purchases.push({ user_id: uid, price_id: upgrade.sku, amount_total: upgrade.kobo, created_at: outWindow() });
      }
      // Credit-pack top-up (some in-window, some stale to exercise the 30d filter).
      if (rand() < packRate) {
        const pack = PACK_SKUS[Math.floor(rand() * PACK_SKUS.length)];
        const when = rand() < 0.75 ? inWindow() : outWindow();
        purchases.push({ user_id: uid, price_id: pack.sku, amount_total: pack.kobo, created_at: when });
      }
    }

    // API usage logs — typical cost with a long-tail outlier (~2% of paying users).
    const isPayingCoster = paid && rand() < 0.7;
    if (isPayingCoster) {
      const base = 0.05 + rand() * 3.5; // $0.05-$3.55 baseline
      const outlier = paid && rand() < 0.02 ? 20 + rand() * 30 : 0; // rare $20-$50 spike
      logs.push({ user_id: uid, cost_estimate: Number((base + outlier).toFixed(4)) });
    } else if (!paid && rand() < 0.4) {
      logs.push({ user_id: uid, cost_estimate: Number((rand() * 0.3).toFixed(4)) });
    }
  }

  // A handful of orphan logs (null user_id) to prove they're filtered out.
  for (let i = 0; i < 5; i++) {
    logs.push({ user_id: null, cost_estimate: 5 + rand() * 20 });
  }

  return { profiles, purchases, logs, now };
}
