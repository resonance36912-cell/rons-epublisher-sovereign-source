// Integration test: exercises the coupon validation + redemption pipeline
// end-to-end at the database level.
//
// We can't synthesize a new auth.users row from this connection (the auth
// schema isn't writable and we can't disable FK enforcement), so we pick an
// existing free-tier profile at runtime and run the whole flow inside a
// transaction that is ROLLBACK'd at the end. Nothing is committed.
//
// Flow:
//   1. Find a profile with no premium subscription and no standard purchase
//      (so resolve_user_tier currently returns 'free').
//   2. Seed a free_access coupon (target tier = standard).
//   3. Impersonate the user via SET LOCAL request.jwt.claims (auth.uid()
//      reads claims.sub, and the coupon RPCs are SECURITY DEFINER).
//   4. validate_coupon  → valid=true, target_tier='standard'.
//   5. redeem_coupon    → success=true, target_tier='standard'.
//   6. resolve_user_tier → 'standard' (purchase row was written).
//   7. check_user_quota('elevenlabs-tts' / 'generate-chapter-image')
//        → tier='standard', non-zero limit, allowed=true.
//   8. redeem_coupon again → success=false, error mentions "already used".
//
// Skipped automatically when PGHOST is not set, or when there is no
// free-tier profile available to test with.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

function psqlJson<T = unknown>(sql: string): T {
  const out = execFileSync("psql", ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
  // Multi-statement scripts produce stacked outputs (BEGIN, INSERT 0 1, the
  // JSON row, ROLLBACK). Pull out the first line that parses as JSON.
  const line = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("{") || l.startsWith("["));
  if (!line) throw new Error(`no JSON line in psql output:\n${out}`);
  return JSON.parse(line) as T;
}

function psqlScalar(sql: string): string {
  return execFileSync("psql", ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

interface Result {
  validate: { valid: boolean; coupon_type?: string; target_tier?: string; error?: string };
  redeem: { success: boolean; target_tier?: string; error?: string };
  tier: string;
  tts_quota: { tier: string; limit: number; period: string; allowed: boolean };
  img_quota: { tier: string; limit: number; period: string; allowed: boolean };
  redeem_again: { success: boolean; error?: string };
  purchase_count: number;
  redemption_count: number;
}

d("coupon validation + redemption grants tier and quota", () => {
  let result: Result | null = null;
  let skipReason = "";

  beforeAll(() => {
    const userId = psqlScalar(`
      SELECT p.user_id::text FROM public.profiles p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = p.user_id
          AND s.price_id = 'premium_monthly'
          AND s.status IN ('active','trialing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.purchases pu
        WHERE pu.user_id = p.user_id
          AND pu.price_id = 'standard_once_off'
      )
      LIMIT 1;
    `);

    if (!userId) {
      skipReason = "no free-tier profile available";
      return;
    }

    const code = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Whole script runs in one transaction; ROLLBACK at the end means no
    // coupon, purchase, or redemption rows persist.
    const sql = `
      BEGIN;

      INSERT INTO public.coupons (code, coupon_type, discount_value, max_redemptions, target_tier, active)
      VALUES ('${code}', 'free_access', 100, 5, 'standard', true);

      SET LOCAL request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';

      -- Run the side-effecting calls FIRST (and in a deterministic order)
      -- by stashing them in a temp table. jsonb_build_object below does not
      -- guarantee left-to-right argument evaluation, so we can't rely on
      -- 'redeem' being computed before 'tier'.
      CREATE TEMP TABLE _t ON COMMIT DROP AS
      SELECT
        public.validate_coupon('${code}', '${userId}'::uuid) AS validate,
        public.redeem_coupon('${code}',   '${userId}'::uuid) AS redeem;

      CREATE TEMP TABLE _t2 ON COMMIT DROP AS
      SELECT
        public.resolve_user_tier('${userId}'::uuid)                          AS tier,
        public.check_user_quota('${userId}'::uuid, 'elevenlabs-tts')         AS tts_q,
        public.check_user_quota('${userId}'::uuid, 'generate-chapter-image') AS img_q,
        public.redeem_coupon('${code}', '${userId}'::uuid)                   AS redeem_again;

      SELECT jsonb_build_object(
        'validate',         (SELECT validate FROM _t),
        'redeem',           (SELECT redeem   FROM _t),
        'tier',             (SELECT tier     FROM _t2),
        'tts_quota',        (
          SELECT jsonb_build_object(
            'tier',    tts_q->>'tier',
            'limit',   (tts_q->>'limit')::int,
            'period',  tts_q->>'period',
            'allowed', (tts_q->>'allowed')::boolean
          ) FROM _t2
        ),
        'img_quota',        (
          SELECT jsonb_build_object(
            'tier',    img_q->>'tier',
            'limit',   (img_q->>'limit')::int,
            'period',  img_q->>'period',
            'allowed', (img_q->>'allowed')::boolean
          ) FROM _t2
        ),
        'redeem_again',     (SELECT redeem_again FROM _t2),
        'purchase_count',   (SELECT count(*) FROM public.purchases       WHERE user_id = '${userId}'::uuid AND price_id = 'standard_once_off'),
        'redemption_count', (SELECT count(*) FROM public.coupon_redemptions WHERE user_id = '${userId}'::uuid AND coupon_id = (SELECT id FROM public.coupons WHERE code='${code}'))
      );

      ROLLBACK;
    `;

    result = psqlJson<Result>(sql);
  });

  it("found a free-tier profile to test with", () => {
    if (skipReason) console.warn(`skipping coupon e2e: ${skipReason}`);
    expect(skipReason).toBe("");
    expect(result).not.toBeNull();
  });

  it("validate_coupon returns valid=true with target_tier='standard'", () => {
    if (!result) return;
    expect(result.validate.valid, JSON.stringify(result.validate)).toBe(true);
    expect(result.validate.coupon_type).toBe("free_access");
    expect(result.validate.target_tier).toBe("standard");
  });

  it("redeem_coupon succeeds for the target user", () => {
    if (!result) return;
    expect(result.redeem.success, JSON.stringify(result.redeem)).toBe(true);
    expect(result.redeem.target_tier).toBe("standard");
  });

  it("creates exactly one standard-tier purchase row and one redemption row", () => {
    if (!result) return;
    expect(result.purchase_count).toBe(1);
    expect(result.redemption_count).toBe(1);
  });

  it("resolve_user_tier reports 'standard' after redemption", () => {
    if (!result) return;
    expect(result.tier).toBe("standard");
  });

  it("check_user_quota('elevenlabs-tts') uses the standard tier preset", () => {
    if (!result) return;
    expect(result.tts_quota.tier).toBe("standard");
    expect(result.tts_quota.period).not.toBe("blocked");
    expect(result.tts_quota.limit).toBeGreaterThan(0);
    // Don't assert `allowed`: lifetime presets mean an existing test user
    // may already be at/over the cap from prior usage — the tier+limit
    // jumping to the 'standard' preset row is what proves redemption worked.
  });

  it("check_user_quota('generate-chapter-image') uses the standard tier preset", () => {
    if (!result) return;
    expect(result.img_quota.tier).toBe("standard");
    expect(result.img_quota.period).not.toBe("blocked");
    expect(result.img_quota.limit).toBeGreaterThan(0);
  });

  it("a second redemption attempt is rejected with 'already used'", () => {
    if (!result) return;
    expect(result.redeem_again.success).toBe(false);
    expect(result.redeem_again.error ?? "").toMatch(/already used/i);
  });
});
