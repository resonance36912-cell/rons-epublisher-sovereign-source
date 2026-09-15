// Integration test: verifies RLS policy definitions guarantee that
// authenticated users only ever SELECT rows scoped to their own auth.uid()
// on the four user-data tables most exposed to cross-tenant leakage:
//   - public.storybook_projects
//   - public.purchases
//   - public.subscriptions
//   - public.api_usage_logs
//
// We assert policy shape via pg_policies (no fixture data needed). Admin
// SELECT escape hatches (via has_role(..., 'admin')) are allowed but must
// be additive — every authenticated SELECT path must also gate on
// user_id = auth.uid(), and no policy may be granted to anon or be
// wide-open (USING true).
//
// Skipped automatically when PGHOST is not set (CI / local without DB).

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

// Returns the policies that grant SELECT to a non-service role
// (authenticated or public, excluding the service_role-only ALL policies).
function selectPoliciesForUsers(policies: Policy[]): Policy[] {
  return policies.filter((p) => {
    if (p.cmd !== "SELECT" && p.cmd !== "ALL") return false;
    // Skip service_role-only policies (they're not reachable as a logged-in
    // end user via the anon/PostgREST surface).
    if (p.roles.length === 1 && p.roles[0] === "service_role") return false;
    // ALL policies that gate on auth.role()='service_role' also don't apply
    // to ordinary users — filter them out by qual.
    if (p.cmd === "ALL" && (p.qual ?? "").includes("'service_role'")) return false;
    return true;
  });
}

const TABLES = [
  "storybook_projects",
  "purchases",
  "subscriptions",
  "api_usage_logs",
] as const;

d("per-user SELECT visibility RLS", () => {
  for (const table of TABLES) {
    describe(`public.${table}`, () => {
      const policies = HAS_DB ? getPolicies(table) : [];

      it("has Row Level Security enabled", () => {
        expect(rlsEnabled(table)).toBe(true);
      });

      it("does NOT grant any policy to the anon role", () => {
        const anon = policies.find((p) => p.roles.includes("anon"));
        expect(
          anon,
          `${table} policy granted to anon: ${JSON.stringify(anon)}`,
        ).toBeUndefined();
      });

      it("has an owner-scoped SELECT policy (user_id = auth.uid()) and any admin-bypass policy is gated by has_role(..., 'admin')", () => {
        const userSelects = selectPoliciesForUsers(policies);
        expect(
          userSelects.length,
          `${table} has no SELECT policy reachable by a logged-in user`,
        ).toBeGreaterThan(0);

        const OWNER = /user_id\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*user_id/;
        const ADMIN = /has_role\(.*'admin'/;

        const ownerScoped = userSelects.some((p) => OWNER.test(p.qual ?? ""));
        expect(
          ownerScoped,
          `${table} has no SELECT policy that gates on user_id = auth.uid(): ${JSON.stringify(userSelects)}`,
        ).toBe(true);

        // Every user-facing SELECT policy must be EITHER owner-scoped OR
        // an admin-only escape hatch — never a free-form bypass.
        for (const p of userSelects) {
          const qual = p.qual ?? "";
          const ok = OWNER.test(qual) || ADMIN.test(qual);
          expect(
            ok,
            `${table}.${p.policyname} (${p.cmd}) is neither owner-scoped nor admin-gated: ${qual}`,
          ).toBe(true);
        }
      });

      it("no SELECT policy is wide-open (USING true)", () => {
        const wide = policies.find(
          (p) =>
            (p.cmd === "SELECT" || p.cmd === "ALL") &&
            !p.roles.every((r) => r === "service_role") &&
            (p.qual === "true" || p.qual === "(true)"),
        );
        expect(
          wide,
          `over-permissive SELECT policy on ${table}: ${JSON.stringify(wide)}`,
        ).toBeUndefined();
      });
    });
  }
});
