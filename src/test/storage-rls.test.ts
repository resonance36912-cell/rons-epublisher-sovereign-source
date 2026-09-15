// Integration test: verifies the chapter-images bucket has the correct
// owner-scoped RLS policies on storage.objects.
//
// The managed Lovable Cloud postgres connection cannot `SET ROLE authenticated`
// to fully impersonate a user, so this test asserts the policy *definitions*
// (USING predicates, allowed commands, target roles) match what the security
// model requires: every signed-in user sees only files under their own
// `user_id/` folder, and admins see everything.
//
// Skipped when PGHOST is not set.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

function psqlJson<T = unknown>(sql: string): T {
  const out = execFileSync(
    "psql",
    ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  ).trim();
  return JSON.parse(out) as T;
}

interface Policy {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

function getChapterImagesPolicies(): Policy[] {
  return psqlJson<Policy[]>(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'policyname', policyname,
      'cmd',        cmd,
      'roles',      roles,
      'qual',       qual,
      'with_check', with_check
    )), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND (qual ILIKE '%chapter-images%' OR with_check ILIKE '%chapter-images%');
  `);
}

d("chapter-images bucket RLS policies on storage.objects", () => {
  const policies = HAS_DB ? getChapterImagesPolicies() : [];

  it("has an owner-scoped SELECT policy for authenticated users", () => {
    const own = policies.find(
      (p) =>
        p.cmd === "SELECT" &&
        p.roles.includes("authenticated") &&
        /storage\.foldername\(name\)/.test(p.qual ?? "") &&
        /auth\.uid\(\)/.test(p.qual ?? "") &&
        !/has_role/.test(p.qual ?? ""),
    );
    expect(own, `missing owner-scoped SELECT policy. found: ${JSON.stringify(policies, null, 2)}`).toBeTruthy();
  });

  it("scopes owner SELECT to the caller's user_id folder (foldername[1] = auth.uid())", () => {
    const own = policies.find(
      (p) =>
        p.cmd === "SELECT" &&
        p.roles.includes("authenticated") &&
        /storage\.foldername\(name\)/.test(p.qual ?? ""),
    );
    expect(own?.qual).toMatch(/\(storage\.foldername\(name\)\)\[1\]\s*=\s*\(?auth\.uid\(\)\)?::text/i);
    expect(own?.qual).toMatch(/bucket_id\s*=\s*'chapter-images'/);
  });

  it("has an admin SELECT policy gated by has_role(..., 'admin')", () => {
    const admin = policies.find(
      (p) => p.cmd === "SELECT" && /has_role\(.*'admin'/.test(p.qual ?? ""),
    );
    expect(admin, "missing admin-only SELECT policy for chapter-images").toBeTruthy();
  });

  it("does NOT expose chapter-images via any USING (true) policy", () => {
    const wideOpen = policies.find(
      (p) => p.qual === "true" || p.with_check === "true",
    );
    expect(wideOpen, `found over-permissive policy: ${JSON.stringify(wideOpen)}`).toBeUndefined();
  });

  it("does NOT grant chapter-images access to anon role", () => {
    const anonPolicy = policies.find((p) => p.roles.includes("anon"));
    expect(anonPolicy, `chapter-images storage.objects policy granted to anon: ${JSON.stringify(anonPolicy)}`).toBeUndefined();
  });
});
