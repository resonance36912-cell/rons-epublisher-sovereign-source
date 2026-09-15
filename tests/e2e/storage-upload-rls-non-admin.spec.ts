import { test, expect } from "../playwright-fixture";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * E2E: signs in as a real non-admin user and verifies that the
 * chapter-images Storage upload endpoint enforces the per-user RLS:
 *   - uploads into the caller's own <user_id>/ folder succeed
 *   - uploads into a foreign <user_id>/ folder are rejected (403)
 *   - both PUT (upsert) and POST (create) verbs are blocked for foreign paths
 *
 * Strategy mirrors storage-list-rls-non-admin.spec.ts:
 *   1. Service-role-provision two fresh users (A = caller, B = foreign).
 *   2. Sign in as A via password grant.
 *   3. As A, attempt uploads against A's path (allowed) and B's path (blocked).
 *   4. Clean up seeded objects + users.
 *
 * Skipped when backend env vars are not available to the runner.
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
  email: `e2e-upload-a-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-A`,
  id: "",
  token: "",
};
const userB = {
  email: `e2e-upload-b-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-B`,
  id: "",
};

const haveEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

test.describe("Storage upload RLS — non-admin signed-in user", () => {
  test.skip(
    !haveEnv,
    "Requires VITE_SUPABASE_URL, anon key and SUPABASE_SERVICE_ROLE_KEY in env.",
  );

  let admin: APIRequestContext;
  let anon: APIRequestContext;
  let asUserA: APIRequestContext;

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

    for (const u of [userA, userB]) {
      const res = await admin.post("/auth/v1/admin/users", {
        data: { email: u.email, password: u.password, email_confirm: true },
      });
      expect(res.ok(), `create user ${u.email}: ${await res.text()}`).toBeTruthy();
      const json = await res.json();
      u.id = json.id ?? json.user?.id;
      expect(u.id).toBeTruthy();
    }

    const signIn = await anon.post("/auth/v1/token?grant_type=password", {
      data: { email: userA.email, password: userA.password },
    });
    expect(signIn.ok(), `sign in A: ${await signIn.text()}`).toBeTruthy();
    userA.token = (await signIn.json()).access_token;
    expect(userA.token).toBeTruthy();

    asUserA = await playwrightRequest.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userA.token}`,
      },
    });
  });

  test.afterAll(async () => {
    if (!admin) return;
    // Best-effort cleanup of anything either user might have created.
    for (const u of [userA, userB]) {
      if (!u.id) continue;
      const listed = await admin
        .post(`/storage/v1/object/list/${BUCKET}`, {
          data: { prefix: `${u.id}/e2e-upload-${RUN_ID}`, limit: 1000, offset: 0 },
        })
        .catch(() => null);
      if (listed?.ok()) {
        const rows = (await listed.json()) as Array<{ name: string }>;
        for (const r of rows) {
          await admin
            .delete(`/storage/v1/object/${BUCKET}/${u.id}/e2e-upload-${RUN_ID}/${r.name}`)
            .catch(() => {});
        }
      }
      await admin.delete(`/auth/v1/admin/users/${u.id}`).catch(() => {});
    }
    await asUserA?.dispose();
    await anon?.dispose();
    await admin.dispose();
  });

  const PNG_BYTES = Buffer.from([
    // Tiny but well-formed payload — content type is what matters for the
    // RLS check; the storage server does not strictly validate PNG bytes.
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  test("PUT (upsert) into the caller's own user_id/ folder succeeds", async () => {
    const path = `${userA.id}/e2e-upload-${RUN_ID}/own-put.png`;
    const res = await asUserA.put(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "image/png", "x-upsert": "true" },
      data: PNG_BYTES,
    });
    expect(res.ok(), `own PUT should succeed: ${res.status()} ${await res.text()}`)
      .toBeTruthy();
  });

  test("POST (create) into the caller's own user_id/ folder succeeds", async () => {
    const path = `${userA.id}/e2e-upload-${RUN_ID}/own-post.png`;
    const res = await asUserA.post(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "image/png" },
      data: PNG_BYTES,
    });
    expect(res.ok(), `own POST should succeed: ${res.status()} ${await res.text()}`)
      .toBeTruthy();
  });

  test("PUT (upsert) into a foreign user_id/ folder is rejected by RLS", async () => {
    const path = `${userB.id}/e2e-upload-${RUN_ID}/foreign-put.png`;
    const res = await asUserA.put(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "image/png", "x-upsert": "true" },
      data: PNG_BYTES,
    });
    expect(
      res.ok(),
      `foreign PUT must NOT succeed (got ${res.status()})`,
    ).toBeFalsy();
    expect([400, 401, 403]).toContain(res.status());

    // Confirm nothing actually landed in B's folder.
    const check = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userB.id}/e2e-upload-${RUN_ID}`, limit: 100, offset: 0 },
    });
    const rows = (await check.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === "foreign-put.png")).toBeUndefined();
  });

  test("POST (create) into a foreign user_id/ folder is rejected by RLS", async () => {
    const path = `${userB.id}/e2e-upload-${RUN_ID}/foreign-post.png`;
    const res = await asUserA.post(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "image/png" },
      data: PNG_BYTES,
    });
    expect(
      res.ok(),
      `foreign POST must NOT succeed (got ${res.status()})`,
    ).toBeFalsy();
    expect([400, 401, 403]).toContain(res.status());

    const check = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userB.id}/e2e-upload-${RUN_ID}`, limit: 100, offset: 0 },
    });
    const rows = (await check.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === "foreign-post.png")).toBeUndefined();
  });

  test("uploads under a fabricated/non-existent user_id/ prefix are also blocked", async () => {
    const fakeUid = "00000000-0000-0000-0000-0000deadbeef";
    const path = `${fakeUid}/e2e-upload-${RUN_ID}/spoof.png`;
    const res = await asUserA.put(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "image/png", "x-upsert": "true" },
      data: PNG_BYTES,
    });
    expect(res.ok(), `spoofed PUT must NOT succeed (got ${res.status()})`)
      .toBeFalsy();
    expect([400, 401, 403]).toContain(res.status());
  });
});
