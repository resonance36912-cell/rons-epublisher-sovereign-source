// Integration test: verifies non-admin users CANNOT enumerate or list objects
// outside their own user_id/ folder in the chapter-images bucket.
//
// The managed Lovable Cloud postgres role cannot SET ROLE authenticated/anon,
// so we cannot run a literal impersonated SELECT. Instead we evaluate the
// actual RLS predicate logic in SQL against synthetic rows, substituting a
// fake non-admin uid for auth.uid(). This proves the policy expressions deny
// foreign-folder access without depending on row-impersonation.
//
// Skipped when PGHOST is not set.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
  qual: string;
  roles: string[];
}

const CALLER_UID  = randomUUID(); // synthetic non-admin user
const FOREIGN_UID = randomUUID(); // a different user's folder
const OWN_PATH     = `${CALLER_UID}/proj/scene.png`;
const FOREIGN_PATH = `${FOREIGN_UID}/proj/scene.png`;

function fetchSelectPolicies(): Policy[] {
  return psqlJson<Policy[]>(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'policyname', policyname,
      'qual',       qual,
      'roles',      roles
    )), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND cmd = 'SELECT'
      AND qual ILIKE '%chapter-images%';
  `);
}

/**
 * Evaluate a single policy's USING expression against a synthetic row by
 * substituting auth.uid() with the test caller uid, then asking Postgres
 * to evaluate the boolean. Returns true if the policy would expose the row.
 */
function policyMatches(
  qual: string,
  callerUid: string,
  rowName: string,
): boolean {
  // Inject (storage.objects) values via a CTE row, replace auth.uid() with
  // the literal caller uid (cast to uuid). Bucket is always chapter-images.
  const patched = qual
    .replace(/auth\.uid\(\)/g, `'${callerUid}'::uuid`);

  const sql = `
    WITH r AS (
      SELECT
        'chapter-images'::text AS bucket_id,
        '${rowName}'::text AS name
    )
    SELECT jsonb_build_object('match', COALESCE((SELECT (${patched}) FROM r), false));
  `;
  return psqlJson<{ match: boolean }>(sql).match === true;
}

d("chapter-images bucket — non-admin folder isolation", () => {
  it("no SELECT policy exposes a foreign user_id/ folder to a non-admin caller", () => {
    const policies = fetchSelectPolicies();
    expect(policies.length, "expected at least one SELECT policy for chapter-images").toBeGreaterThan(0);

    for (const p of policies) {
      // Admin policy is allowed to match anything — skip it; the admin test
      // covers that case separately.
      if (/has_role/.test(p.qual)) continue;

      const exposesForeign = policyMatches(p.qual, CALLER_UID, FOREIGN_PATH);
      expect(
        exposesForeign,
        `policy "${p.policyname}" leaks foreign folder to non-admin: ${p.qual}`,
      ).toBe(false);
    }
  });

  it("the owner-scoped SELECT policy DOES match the caller's own folder", () => {
    const policies = fetchSelectPolicies();
    const owner = policies.find(
      (p) => !/has_role/.test(p.qual) && /storage\.foldername\(name\)/.test(p.qual),
    );
    expect(owner, "missing owner-scoped SELECT policy").toBeTruthy();

    expect(policyMatches(owner!.qual, CALLER_UID, OWN_PATH)).toBe(true);
    expect(policyMatches(owner!.qual, CALLER_UID, FOREIGN_PATH)).toBe(false);
  });

  it("no SELECT policy on chapter-images is granted to the anon role", () => {
    const policies = fetchSelectPolicies();
    const anonPolicy = policies.find((p) => p.roles.includes("anon"));
    expect(anonPolicy, `anon was granted a chapter-images policy: ${JSON.stringify(anonPolicy)}`).toBeUndefined();
  });

  it("a random non-admin uid is NOT considered admin by has_role()", () => {
    const r = psqlJson<{ admin: boolean }>(`
      SELECT jsonb_build_object('admin',
        public.has_role('${CALLER_UID}'::uuid, 'admin'::public.app_role)
      );
    `);
    expect(r.admin).toBe(false);
  });
});
