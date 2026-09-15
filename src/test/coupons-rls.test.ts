// Integration test: verifies RLS policy definitions on public.coupons and
// public.coupon_redemptions enforce admin-only writes and prevent regular
// users from reading or creating coupons / arbitrary redemptions.
//
// Like storage-rls.test.ts, we assert policy *definitions* via pg_policies
// because the managed Lovable Cloud postgres connection cannot SET ROLE
// authenticated to fully impersonate users.
//
// Skipped when PGHOST is not set.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

interface Policy {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

function psqlJson<T = unknown>(sql: string): T {
  const out = execFileSync("psql", ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
  return JSON.parse(out) as T;
}

function getPolicies(table: string): Policy[] {
  return psqlJson<Policy[]>(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'policyname', policyname,
      'cmd',        cmd,
      'roles',      roles,
      'qual',       qual,
      'with_check', with_check
    )), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = '${table}';
  `);
}

function rlsEnabled(table: string): boolean {
  const out = execFileSync(
    "psql",
    [
      "-tAX",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SELECT rowsecurity::text FROM pg_tables WHERE schemaname='public' AND tablename='${table}';`,
    ],
    { encoding: "utf8" },
  ).trim();
  return out === "t" || out === "true";
}

d("public.coupons RLS", () => {
  const policies = HAS_DB ? getPolicies("coupons") : [];

  it("has Row Level Security enabled", () => {
    expect(rlsEnabled("coupons")).toBe(true);
  });

  it("does NOT expose coupons to anon role", () => {
    const anon = policies.find((p) => p.roles.includes("anon"));
    expect(anon, `coupons policy granted to anon: ${JSON.stringify(anon)}`).toBeUndefined();
  });

  it("does NOT allow non-admin authenticated users to SELECT, INSERT, UPDATE, or DELETE", () => {
    // The only policy on coupons should be the admin-gated "ALL" policy.
    // Any policy that does not require has_role(..., 'admin') would be a leak.
    const nonAdmin = policies.filter(
      (p) =>
        p.roles.includes("authenticated") &&
        !/has_role\(.*'admin'/.test(p.qual ?? "") &&
        !/has_role\(.*'admin'/.test(p.with_check ?? ""),
    );
    expect(
      nonAdmin,
      `coupons must only be accessible to admins. Found non-admin policy: ${JSON.stringify(nonAdmin, null, 2)}`,
    ).toHaveLength(0);
  });

  it("admin policy uses the has_role security-definer function (no recursive pattern)", () => {
    const admin = policies.find((p) => /has_role\(.*'admin'/.test(p.qual ?? ""));
    expect(admin, "missing admin-gated policy on coupons").toBeTruthy();
    expect(admin?.qual ?? "").not.toMatch(/FROM\s+public\.coupons/i);
  });
});

d("public.coupon_redemptions RLS", () => {
  const policies = HAS_DB ? getPolicies("coupon_redemptions") : [];

  it("has Row Level Security enabled", () => {
    expect(rlsEnabled("coupon_redemptions")).toBe(true);
  });

  it("SELECT for non-admin users is scoped to user_id = auth.uid()", () => {
    const userSelect = policies.find(
      (p) =>
        p.cmd === "SELECT" &&
        p.roles.includes("authenticated") &&
        !/has_role/.test(p.qual ?? ""),
    );
    expect(userSelect, `missing owner-scoped SELECT policy`).toBeTruthy();
    expect(userSelect?.qual ?? "").toMatch(/user_id\s*=\s*auth\.uid\(\)/);
  });

  it("INSERT WITH CHECK forces user_id = auth.uid() (prevents inserting redemptions for other users)", () => {
    const insert = policies.find(
      (p) =>
        (p.cmd === "INSERT" || p.cmd === "ALL") &&
        p.roles.includes("authenticated") &&
        !/has_role/.test(p.with_check ?? ""),
    );
    expect(insert, "missing owner-scoped INSERT policy").toBeTruthy();
    expect(insert?.with_check ?? "").toMatch(/user_id\s*=\s*auth\.uid\(\)/);
  });

  it("does NOT grant UPDATE or DELETE to non-admin users", () => {
    const nonAdminMutations = policies.filter(
      (p) =>
        (p.cmd === "UPDATE" || p.cmd === "DELETE") &&
        p.roles.includes("authenticated") &&
        !/has_role\(.*'admin'/.test(p.qual ?? ""),
    );
    expect(
      nonAdminMutations,
      `coupon_redemptions UPDATE/DELETE leaked to non-admins: ${JSON.stringify(nonAdminMutations, null, 2)}`,
    ).toHaveLength(0);
  });
});
