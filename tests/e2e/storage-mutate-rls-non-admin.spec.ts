import { test, expect } from "../playwright-fixture";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * E2E: confirms that the INSERT / UPDATE / DELETE RLS policies on
 * storage.objects for the `chapter-images` bucket block a signed-in
 * non-admin caller from mutating objects in any other user's
 * <user_id>/ folder.
 *
 * For each mutating verb we:
 *   1. Seed an object in user B's folder using the service role
 *      (bypasses RLS) so we always have a real target.
 *   2. Attempt the mutation as user A (a different signed-in
 *      non-admin user).
 *   3. Assert the response was rejected AND that the object's actual
 *      state in storage is unchanged (still exists, same bytes for
 *      UPDATE, still missing for blocked-then-recreate cases).
 *
 * INSERT/PUT into own vs foreign folders is also covered by
 * `storage-upload-rls-non-admin.spec.ts`; this spec focuses on
 * UPDATE and DELETE plus the move/copy variants.
 *
 * Skipped if backend env vars are unavailable to the Playwright runner.
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
  email: `e2e-mut-a-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-A`,
  id: "",
  token: "",
};
const userB = {
  email: `e2e-mut-b-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-B`,
  id: "",
};

const haveEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

const SEED_BYTES = Buffer.from("seed-foreign-object");
const OVERWRITE_BYTES = Buffer.from("attacker-overwrite");

test.describe("Storage INSERT/UPDATE/DELETE RLS — non-admin foreign-folder writes", () => {
  test.skip(
    !haveEnv,
    "Requires VITE_SUPABASE_URL, anon key and SUPABASE_SERVICE_ROLE_KEY in env.",
  );

  let admin: APIRequestContext;
  let anon: APIRequestContext;
  let asUserA: APIRequestContext;

  // Helpers ----------------------------------------------------------------

  const foreignPath = (name: string) =>
    `${userB.id}/e2e-mut-${RUN_ID}/${name}`;
  const ownPath = (name: string) =>
    `${userA.id}/e2e-mut-${RUN_ID}/${name}`;

  async function seedForeign(name: string, bytes: Buffer = SEED_BYTES) {
    const res = await admin.post(`/storage/v1/object/${BUCKET}/${foreignPath(name)}`, {
      headers: { "Content-Type": "application/octet-stream", "x-upsert": "true" },
      data: bytes,
    });
    expect(res.ok(), `seed ${name}: ${await res.text()}`).toBeTruthy();
  }

  async function downloadAsAdmin(path: string) {
    // Service-role download via /object/<path> (bypasses RLS).
    const res = await admin.get(`/storage/v1/object/authenticated/${BUCKET}/${path}`);
    return { ok: res.ok(), status: res.status(), body: res.ok() ? Buffer.from(await res.body()) : null };
  }

  async function existsForeign(name: string) {
    const res = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userB.id}/e2e-mut-${RUN_ID}`, limit: 1000, offset: 0 },
    });
    if (!res.ok()) return false;
    const rows = (await res.json()) as Array<{ name: string }>;
    return rows.some((r) => r.name === name);
  }

  // Lifecycle --------------------------------------------------------------

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
      expect(res.ok(), `create ${u.email}: ${await res.text()}`).toBeTruthy();
      const json = await res.json();
      u.id = json.id ?? json.user?.id;
      expect(u.id).toBeTruthy();
    }

    const signIn = await anon.post("/auth/v1/token?grant_type=password", {
      data: { email: userA.email, password: userA.password },
    });
    expect(signIn.ok(), `sign in A: ${await signIn.text()}`).toBeTruthy();
    userA.token = (await signIn.json()).access_token;

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
    for (const u of [userA, userB]) {
      if (!u.id) continue;
      const listed = await admin
        .post(`/storage/v1/object/list/${BUCKET}`, {
          data: { prefix: `${u.id}/e2e-mut-${RUN_ID}`, limit: 1000, offset: 0 },
        })
        .catch(() => null);
      if (listed?.ok()) {
        const rows = (await listed.json()) as Array<{ name: string }>;
        for (const r of rows) {
          await admin
            .delete(`/storage/v1/object/${BUCKET}/${u.id}/e2e-mut-${RUN_ID}/${r.name}`)
            .catch(() => {});
        }
      }
      await admin.delete(`/auth/v1/admin/users/${u.id}`).catch(() => {});
    }
    await asUserA?.dispose();
    await anon?.dispose();
    await admin.dispose();
  });

  // INSERT ----------------------------------------------------------------

  test("INSERT (POST) into a foreign user_id/ folder is rejected", async () => {
    const res = await asUserA.post(`/storage/v1/object/${BUCKET}/${foreignPath("insert-attempt.bin")}`, {
      headers: { "Content-Type": "application/octet-stream" },
      data: Buffer.from("nope"),
    });
    expect(res.ok(), `foreign INSERT must fail (got ${res.status()})`).toBeFalsy();
    expect([400, 401, 403]).toContain(res.status());
    expect(await existsForeign("insert-attempt.bin")).toBe(false);
  });

  // UPDATE ----------------------------------------------------------------

  test("UPDATE (PUT upsert) of a foreign object is rejected and bytes unchanged", async () => {
    await seedForeign("update-target.bin", SEED_BYTES);

    const res = await asUserA.put(`/storage/v1/object/${BUCKET}/${foreignPath("update-target.bin")}`, {
      headers: { "Content-Type": "application/octet-stream", "x-upsert": "true" },
      data: OVERWRITE_BYTES,
    });
    expect(res.ok(), `foreign UPDATE must fail (got ${res.status()})`).toBeFalsy();
    expect([400, 401, 403]).toContain(res.status());

    // The seeded bytes must still be intact.
    const after = await downloadAsAdmin(foreignPath("update-target.bin"));
    expect(after.ok, `seed should still exist after blocked UPDATE`).toBe(true);
    expect(after.body?.equals(SEED_BYTES)).toBe(true);
  });

  test("MOVE of a foreign object out of its folder is rejected", async () => {
    await seedForeign("move-source.bin", SEED_BYTES);

    const res = await asUserA.post(`/storage/v1/object/move`, {
      data: {
        bucketId: BUCKET,
        sourceKey: foreignPath("move-source.bin"),
        destinationKey: ownPath("stolen.bin"),
      },
    });
    expect(res.ok(), `foreign MOVE must fail (got ${res.status()})`).toBeFalsy();
    expect([400, 401, 403, 404]).toContain(res.status());

    // Source must still be there; destination must NOT exist.
    expect(await existsForeign("move-source.bin")).toBe(true);
    const dest = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userA.id}/e2e-mut-${RUN_ID}`, limit: 1000, offset: 0 },
    });
    const rows = (await dest.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === "stolen.bin")).toBeUndefined();
  });

  test("COPY of a foreign object into the caller's folder is rejected", async () => {
    await seedForeign("copy-source.bin", SEED_BYTES);

    const res = await asUserA.post(`/storage/v1/object/copy`, {
      data: {
        bucketId: BUCKET,
        sourceKey: foreignPath("copy-source.bin"),
        destinationKey: ownPath("copied.bin"),
      },
    });
    expect(res.ok(), `foreign COPY must fail (got ${res.status()})`).toBeFalsy();
    expect([400, 401, 403, 404]).toContain(res.status());

    const dest = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userA.id}/e2e-mut-${RUN_ID}`, limit: 1000, offset: 0 },
    });
    const rows = (await dest.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === "copied.bin")).toBeUndefined();
  });

  // DELETE ----------------------------------------------------------------

  test("DELETE of a foreign object is rejected and the object survives", async () => {
    await seedForeign("delete-target.bin", SEED_BYTES);

    const res = await asUserA.delete(`/storage/v1/object/${BUCKET}/${foreignPath("delete-target.bin")}`);
    // Storage may answer 200 with an empty deleted[] array OR 400/403/404
    // when RLS filters out the row entirely. Either way the object must
    // remain in B's folder.
    if (res.ok()) {
      const body = await res.json().catch(() => null);
      const deleted = Array.isArray(body?.deleted) ? body.deleted : body;
      expect(
        Array.isArray(deleted) ? deleted.length : 0,
        `RLS should not report any rows deleted (got ${JSON.stringify(body)})`,
      ).toBe(0);
    } else {
      expect([400, 401, 403, 404]).toContain(res.status());
    }

    expect(await existsForeign("delete-target.bin")).toBe(true);
  });

  test("bulk DELETE that includes a foreign object does not remove it", async () => {
    await seedForeign("bulk-foreign.bin", SEED_BYTES);

    const res = await asUserA.delete(`/storage/v1/object/${BUCKET}`, {
      data: {
        prefixes: [foreignPath("bulk-foreign.bin")],
      },
    });
    // Same shape tolerance as the single DELETE above.
    if (res.ok()) {
      const body = await res.json().catch(() => null);
      const deleted = Array.isArray(body) ? body : Array.isArray(body?.deleted) ? body.deleted : [];
      expect(
        deleted.length,
        `bulk DELETE must not report a foreign row deleted (got ${JSON.stringify(body)})`,
      ).toBe(0);
    } else {
      expect([400, 401, 403, 404]).toContain(res.status());
    }

    expect(await existsForeign("bulk-foreign.bin")).toBe(true);
  });

  // Sanity: the same DELETE works against the caller's OWN folder, proving
  // that the failures above are RLS-driven and not a generic auth issue.
  test("the caller CAN delete an object in their own user_id/ folder (positive control)", async () => {
    // Seed an own-folder object as user A (covered by the INSERT policy).
    const path = ownPath("own-delete-target.bin");
    const seed = await asUserA.post(`/storage/v1/object/${BUCKET}/${path}`, {
      headers: { "Content-Type": "application/octet-stream" },
      data: SEED_BYTES,
    });
    expect(seed.ok(), `own seed should succeed: ${await seed.text()}`).toBeTruthy();

    const del = await asUserA.delete(`/storage/v1/object/${BUCKET}/${path}`);
    expect(del.ok(), `own DELETE should succeed: ${del.status()} ${await del.text()}`)
      .toBeTruthy();

    // Confirm it's gone from the admin's vantage point too.
    const listed = await admin.post(`/storage/v1/object/list/${BUCKET}`, {
      data: { prefix: `${userA.id}/e2e-mut-${RUN_ID}`, limit: 1000, offset: 0 },
    });
    const rows = (await listed.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === "own-delete-target.bin")).toBeUndefined();
  });
});
