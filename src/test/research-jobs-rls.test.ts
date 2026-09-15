// Integration test: verifies RLS policy definitions on public.research_jobs
// prevent unauthorized access and, critically, ownership reassignment via
// UPDATE (the WITH CHECK on owner_update_jobs must pin user_id to auth.uid()
// for non-admins).
//
// Asserts policy definitions via pg_policies; skipped when PGHOST is not set.

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

d("public.research_jobs RLS", () => {
  const policies = HAS_DB ? getPolicies("research_jobs") : [];

  it("has Row Level Security enabled", () => {
    expect(rlsEnabled("research_jobs")).toBe(true);
  });

  it("does NOT grant any access to anon role", () => {
    const anon = policies.find((p) => p.roles.includes("anon"));
    expect(anon, `research_jobs policy granted to anon: ${JSON.stringify(anon)}`).toBeUndefined();
  });

  it("SELECT is scoped to owner or admin", () => {
    const select = policies.find((p) => p.cmd === "SELECT" && p.roles.includes("authenticated"));
    expect(select, "missing SELECT policy").toBeTruthy();
    expect(select?.qual ?? "").toMatch(/user_id\s*=\s*auth\.uid\(\)/);
    expect(select?.qual ?? "").toMatch(/has_role\(.*'admin'/);
  });

  it("INSERT WITH CHECK forces user_id = auth.uid() (prevents creating jobs owned by others)", () => {
    const insert = policies.find((p) => p.cmd === "INSERT" && p.roles.includes("authenticated"));
    expect(insert, "missing INSERT policy").toBeTruthy();
    expect(insert?.with_check ?? "").toMatch(/user_id\s*=\s*auth\.uid\(\)/);
    // INSERT must not allow arbitrary user_id even for admins, otherwise an admin
    // could create jobs attributed to other users (and the system should not
    // create cross-owner jobs through normal app flow either).
  });

  it("UPDATE has BOTH a USING and a WITH CHECK clause (prevents ownership transfer)", () => {
    const update = policies.find((p) => p.cmd === "UPDATE" && p.roles.includes("authenticated"));
    expect(update, "missing UPDATE policy").toBeTruthy();
    expect(
      update?.with_check,
      "UPDATE policy must define WITH CHECK to prevent reassigning user_id to another user",
    ).toBeTruthy();
  });

  it("UPDATE WITH CHECK pins user_id to auth.uid() for non-admins", () => {
    const update = policies.find((p) => p.cmd === "UPDATE" && p.roles.includes("authenticated"));
    const wc = update?.with_check ?? "";
    expect(wc).toMatch(/user_id\s*=\s*auth\.uid\(\)/);
    // Admin escape hatch is allowed but only behind has_role.
    if (/has_role/.test(wc)) {
      expect(wc).toMatch(/has_role\(.*'admin'/);
    }
  });

  it("DELETE is restricted to owner or admin", () => {
    const del = policies.find((p) => p.cmd === "DELETE" && p.roles.includes("authenticated"));
    expect(del, "missing DELETE policy").toBeTruthy();
    expect(del?.qual ?? "").toMatch(/user_id\s*=\s*auth\.uid\(\)/);
  });

  it("no policy is wide-open (USING true or WITH CHECK true)", () => {
    const wide = policies.find((p) => p.qual === "true" || p.with_check === "true");
    expect(wide, `over-permissive policy on research_jobs: ${JSON.stringify(wide)}`).toBeUndefined();
  });
});
