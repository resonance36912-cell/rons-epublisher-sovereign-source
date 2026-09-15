import { test, expect, type Page, type Route } from "../playwright-fixture";

/**
 * E2E smoke test: the admin storage panel renders exactly the chapter-image
 * files returned by the admin-storage edge function after the RLS hardening.
 *
 * Mounts /__test/admin-storage (a dev-only harness that bypasses the
 * /admin auth + role gate) and stubs every backend call the AdminProvider
 * issues so the run is hermetic.
 */

const HARNESS_PATH = "/__test/admin-storage";

const ADMIN_FILES = [
  {
    name: "scene-1.png",
    path: "11111111-1111-1111-1111-111111111111/proj-a/scene-1.png",
    size: 12_345,
    created_at: "2026-04-01T12:00:00Z",
  },
  {
    name: "scene-2.png",
    path: "11111111-1111-1111-1111-111111111111/proj-a/scene-2.png",
    size: 23_456,
    created_at: "2026-04-02T12:00:00Z",
  },
  {
    name: "scene-1.png",
    path: "22222222-2222-2222-2222-222222222222/proj-b/scene-1.png",
    size: 34_567,
    created_at: "2026-04-03T12:00:00Z",
  },
];

async function stubAdminBackends(page: Page) {
  // Stub the admin-storage edge function (the only one this section reads).
  await page.route("**/functions/v1/admin-storage**", async (route: Route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.action === "list") {
      const totalSize = ADMIN_FILES.reduce((s, f) => s + f.size, 0);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: ADMIN_FILES, totalSize, count: ADMIN_FILES.length }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Stub every other admin edge function with an empty 200 so AdminProvider's
  // parallel fetches don't 404 / pollute the panel under test.
  await page.route("**/functions/v1/**", async (route: Route) => {
    if (route.request().url().includes("/admin-storage")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Stub all PostgREST table reads (profiles, research_jobs, beta_signups, etc.)
  // with an empty array so the provider settles cleanly.
  await page.route("**/rest/v1/**", async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    });
  });
}

test.describe("Admin storage panel — smoke after RLS hardening", () => {
  test.beforeEach(async ({ page }) => {
    await stubAdminBackends(page);
  });

  test("renders exactly the file rows returned by admin-storage", async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByTestId("admin-storage-harness")).toHaveAttribute("data-ready", "true");

    // Wait for the table to populate.
    for (const f of ADMIN_FILES) {
      await expect(page.getByTitle(f.path)).toBeVisible();
    }

    // No extra/foreign rows beyond the stubbed payload.
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(ADMIN_FILES.length);
  });

  test("shows files from BOTH user folders (admin sees across users)", async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByTestId("admin-storage-harness")).toHaveAttribute("data-ready", "true");

    // Two distinct user_id/ prefixes are present — the admin-only RLS policy
    // is what makes this possible.
    await expect(page.getByTitle(/^11111111-/)).toHaveCount(2);
    await expect(page.getByTitle(/^22222222-/)).toHaveCount(1);
  });

  test("'Delete All' button reflects the stubbed file count", async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByTestId("admin-storage-harness")).toHaveAttribute("data-ready", "true");

    await expect(
      page.getByRole("button", { name: new RegExp(`Delete All \\(${ADMIN_FILES.length}\\)`) }),
    ).toBeVisible();
  });

  test("Storage by User section groups files by user_id folder", async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByTestId("admin-storage-harness")).toHaveAttribute("data-ready", "true");

    // Two user buckets, each with the correct file count label.
    await expect(page.getByText(/· 2 files/)).toBeVisible();
    await expect(page.getByText(/· 1 files/)).toBeVisible();
  });
});
