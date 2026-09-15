import { test, expect } from "../playwright-fixture";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * E2E: verifies RLS on public.storage_access_logs.
 *
 *   - A non-admin user can SELECT only rows where user_id = auth.uid().
 *   - An admin user can SELECT all rows (their own + foreign).
 *
 * Setup uses the service role to:
 *   1. Provision three fresh auth users (A = non-admin, B = foreign
 *      non-admin, C = admin).
 *   2. Grant the 'admin' role to user C via public.user_roles.
 *   3. Seed one storage_access_logs row for each user via PostgREST with
 *      the service-role key (bypasses RLS for setup).
 *
 * Then signs each user in via the password grant and queries
 * /rest/v1/storage_access_logs as that user, asserting the visible
 * row set matches the RLS contract.
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
const TAG = `e2e-access-logs-${RUN_ID}`;

type U = { email: string; password: string; id: string; token: string; logId: string };
const mk = (label: string): U => ({
  email: `e2e-logs-${label}-${RUN_ID}@example.test`,
  password: `Pa55!${RUN_ID}-${label}`,
  id: "",
  token: "",
  logId: "",
});
const userA = mk("a"); // non-admin caller
const userB = mk("b"); // foreign non-admin
const userC = mk("c"); // admin

const haveEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

test.describe("storage_access_logs RLS — own-row vs admin visibility", () => {
  test.skip(
    !haveEnv,
    "Requires VITE_SUPABASE_URL, anon key and SUPABASE_SERVICE_ROLE_KEY in env.",
  );

  let admin: APIRequestContext;
  let anon: APIRequestContext;

  async function signIn(u: U) {
    const res = await anon.post("/auth/v1/token?grant_type=password", {
      data: { email: u.email, password: u.password },
    });
    expect(res.ok(), `sign in ${u.email}: ${await res.text()}`).toBeTruthy();
    const json = await res.json();
    u.token = json.access_token;
    expect(u.token).toBeTruthy();
  }

  async function selectLogsAs(u: U, query: string) {
    const ctx = await playwrightRequest.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${u.token}`,
      },
    });
    const res = await ctx.get(`/rest/v1/storage_access_logs?${query}`);
    const text = await res.text();
    await ctx.dispose();
    expect(res.ok(), `select as ${u.email}: ${res.status()} ${text}`).toBeTruthy();
    return JSON.parse(text) as Array<{ id: string; user_id: string }>;
  }

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

    // Provision users.
    for (const u of [userA, userB, userC]) {
      const res = await admin.post("/auth/v1/admin/users", {
        data: { email: u.email, password: u.password, email_confirm: true },
      });
      expect(res.ok(), `create ${u.email}: ${await res.text()}`).toBeTruthy();
      const json = await res.json();
      u.id = json.id ?? json.user?.id;
      expect(u.id).toBeTruthy();
    }

    // Promote user C to admin.
    const roleRes = await admin.post("/rest/v1/user_roles", {
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      data: { user_id: userC.id, role: "admin" },
    });
    expect(roleRes.ok(), `grant admin: ${await roleRes.text()}`).toBeTruthy();

    // Seed one storage_access_logs row per user (tagged via metadata so we
    // can filter just our rows even on a busy database).
    for (const u of [userA, userB, userC]) {
      const ins = await admin.post("/rest/v1/storage_access_logs", {
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        data: {
          user_id: u.id,
          bucket: BUCKET,
          actor_role: u === userC ? "admin" : "user",
          action: "list",
          scope_path: `${u.id}/seed`,
          file_count: 1,
          metadata: { tag: TAG, owner: u.email },
        },
      });
      expect(ins.ok(), `seed log for ${u.email}: ${await ins.text()}`).toBeTruthy();
      const rows = await ins.json();
      u.logId = rows[0]?.id;
      expect(u.logId).toBeTruthy();
    }

    await signIn(userA);
    await signIn(userC);
  });

  test.afterAll(async () => {
    if (!admin) return;
    // Best-effort cleanup of seeded rows + users.
    await admin
      .delete(`/rest/v1/storage_access_logs?metadata->>tag=eq.${TAG}`)
      .catch(() => {});
    for (const u of [userA, userB, userC]) {
      if (!u.id) continue;
      await admin.delete(`/rest/v1/user_roles?user_id=eq.${u.id}`).catch(() => {});
      await admin.delete(`/auth/v1/admin/users/${u.id}`).catch(() => {});
    }
    await admin.dispose();
    await anon?.dispose();
  });

  test("non-admin sees only their own storage_access_logs rows", async () => {
    const rows = await selectLogsAs(
      userA,
      `select=id,user_id&metadata->>tag=eq.${TAG}`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(userA.logId);
    expect(ids).not.toContain(userB.logId);
    expect(ids).not.toContain(userC.logId);
    for (const r of rows) {
      expect(r.user_id).toBe(userA.id);
    }
  });

  test("non-admin cannot read a foreign row even when filtering by its id", async () => {
    const rows = await selectLogsAs(userA, `select=id&id=eq.${userB.logId}`);
    expect(rows).toEqual([]);
  });

  test("admin sees all storage_access_logs rows across users", async () => {
    const rows = await selectLogsAs(
      userC,
      `select=id,user_id&metadata->>tag=eq.${TAG}`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(userA.logId);
    expect(ids).toContain(userB.logId);
    expect(ids).toContain(userC.logId);
  });
});
