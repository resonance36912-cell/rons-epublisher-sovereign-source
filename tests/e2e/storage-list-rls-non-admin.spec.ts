import { test, expect } from "../playwright-fixture";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * E2E: signs in as a real non-admin user and verifies that the chapter-images
 * Storage list endpoint only returns objects from the caller's own
 * <user_id>/ folder — i.e. the RLS hardening on storage.objects is enforced
 * end-to-end at the REST surface.
 *
 * The test:
 *   1. Uses the service-role key to provision two fresh users (A = caller,
 *      B = foreign owner) and seeds one object in each user's folder.
 *   2. Signs in as user A via the password grant to obtain a real JWT.
 *   3. Calls POST /storage/v1/object/list/chapter-images directly with that
 *      JWT and asserts: A's folder lists ≥1, B's folder lists 0, the root
 *      prefix only returns paths that start with A's user_id.
 *   4. Cleans up both users + their seeded objects.
 *
 * Skipped automatically if the required backend env vars are not exported
 * to the Playwright runner.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const BUCKET = "chapter-images";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const userA = {
  email: `e2e-rls-a-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-A`,
  id: "",
  token: "",
};
const userB = {
  email: `e2e-rls-b-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-B`,
  id: "",
};

const haveEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

test.describe("Storage list RLS — non-admin signed-in user", () => {
  test.skip(
    !haveEnv,
    "Requires VITE_SUPABASE_URL, anon key and SUPABASE_SERVICE_ROLE_KEY in env.",
  );

  let admin: APIRequestContext;
  let anon: APIRequestContext;

  test.beforeAll(async () => {
    admin = await playwrightRequest.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    anon = await playwrightRequest.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: { apikey: ANON_KEY },
    });

    // Create both users via the admin endpoint (email auto-confirmed).
    for (const u of [userA, userB]) {
      const res = await admin.post("/auth/v1/admin/users", {
        data: { email: u.email, password: u.password, email_confirm: true },
      });
      expect(res.ok(), `create user ${u.email}: ${await res.text()}`).toBeTruthy();
      const json = await res.json();
      u.id = json.id ?? json.user?.id;
      expect(u.id, "user id present").toBeTruthy();
    }

    // Seed one object in each user's folder using the service role (bypasses RLS).
    for (const u of [userA, userB]) {
      const path = `${u.id}/e2e-${RUN_ID}/probe.txt`;
      const up = await admin.post(`/storage/v1/object/${BUCKET}/${path}`, {
        headers: { "Content-Type": "text/plain", "x-upsert": "true" },
        data: `seed for ${u.email}`,
      });
      expect(up.ok(), `seed upload for ${u.email}: ${await up.text()}`).toBeTruthy();
    }

    // Sign user A in (password grant) to obtain a real non-admin JWT.
    const signIn = await anon.post("/auth/v1/token?grant_type=password", {
      data: { email: userA.email, password: userA.password },
    });
    expect(signIn.ok(), `sign in A: ${await signIn.text()}`).toBeTruthy();
    const session = await signIn.json();
    userA.token = session.access_token;
    expect(userA.token).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!admin) return;
    // Remove seeded objects (best-effort).
    for (const u of [userA, userB]) {
      if (!u.id) continue;
      await admin.delete(`/storage/v1/object/${BUCKET}/${u.id}/e2e-${RUN_ID}/probe.txt`).catch(() => {});
    }
    // Delete both users (cascades the auth identity).
    for (const u of [userA, userB]) {
      if (!u.id) continue;
      await admin.delete(`/auth/v1/admin/users/${u.id}`).catch(() => {});
    }
    await admin.dispose();
    await anon?.dispose();
  });

  async function listAsUserA(prefix: string) {
    const ctx = await playwrightRequest.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userA.token}`,
      },
    });
    const res = await ctx.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } },
    });
    const text = await res.text();
    await ctx.dispose();
    expect(res.ok(), `list prefix="${prefix}": ${res.status()} ${text}`).toBeTruthy();
    return JSON.parse(text) as Array<{ name: string }>;
  }

  test("listing the caller's own user_id/ prefix returns the seeded object", async () => {
    const rows = await listAsUserA(`${userA.id}/e2e-${RUN_ID}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === "probe.txt")).toBeTruthy();
  });

  test("listing a foreign user_id/ prefix returns no objects (RLS blocks)", async () => {
    const rows = await listAsUserA(`${userB.id}/e2e-${RUN_ID}`);
    expect(rows).toEqual([]);
  });

  test("listing the bucket root only surfaces the caller's user_id/ folder", async () => {
    // Listing prefix="" returns the immediate children of the bucket root
    // (the user_id "folders"). RLS must hide every folder that isn't the
    // caller's own.
    const rows = await listAsUserA("");
    const names = rows.map((r) => r.name);
    expect(names, `root listing leaked foreign folder: ${names.join(", ")}`)
      .not.toContain(userB.id);
    // The caller's own folder may or may not appear depending on whether
    // any objects exist; if it does it must be the only user_id-shaped entry.
    const userIdShaped = names.filter((n) => /^[0-9a-f-]{36}$/i.test(n));
    for (const n of userIdShaped) {
      expect(n).toBe(userA.id);
    }
  });
});
