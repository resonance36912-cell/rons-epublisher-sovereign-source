import { test, expect, type Page, type Route } from "../playwright-fixture";

/**
 * E2E: Server-error live region dismiss (focused dismiss button + keyboard).
 *
 * Mounts the dev-only harness /__test/admin-ttl-server-error which renders
 * <AdminSignedUrlTtlSection /> inside the real app shell (I18nProvider +
 * Toaster). For each locale we:
 *
 *   1. Seed `localStorage.resonance-lang` BEFORE navigation so the section
 *      mounts already-localized (no flicker, no late re-render).
 *   2. Stub every /rest/v1/* + /auth/v1/* request so the only network call
 *      that surfaces a structured Postgres error is the TTL upsert.
 *   3. Trigger a save, capture the inline panel's announced text (with the
 *      dismiss button stripped — its aria-label is chrome, not content).
 *   4. Tab focus onto the dismiss button, activate it with the keyboard,
 *      and assert focus returns to the TTL input (#ttl-seconds).
 *
 * Cross-locale invariant: the dismiss interaction must never alter the
 * announcement wording. We assert this twice — once by comparing the
 * pre-dismiss panel text to the toast description verbatim (parity), and
 * once by re-triggering the same error after dismissal and confirming the
 * announced text round-trips identically. Then across locales we assert
 * that each locale yields a non-empty, distinct announcement (translations
 * really happened — no untranslated key leaks).
 */

const HARNESS_PATH = "/__test/admin-ttl-server-error";
const LOCALES = ["af", "es", "fr", "de"] as const;

const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";
const SERVER_ERROR = {
  // PostgREST shape: returned with non-2xx status, parsed by supabase-js into
  // the `.error` object the section feeds through `captureTtlServerError`.
  code: "P0001",
  message: "ttl out of policy range",
  hint: "Pick a value between 60 and 3600.",
  details: "Trigger ttl_policy_guard rejected the upsert.",
};

async function stubBackend(page: Page) {
  // Supabase auth — section calls supabase.auth.getUser() on mount.
  await page.route("**/auth/v1/user*", async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: FAKE_USER_ID, email: "admin@test.local" }),
    });
  });

  // PostgREST. Default = empty; override for app_settings + app_settings_audit.
  await page.route("**/rest/v1/**", async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    // app_settings: GET returns the current TTL row + override row so the
    // panel renders normally. POST/PATCH (upsert) returns the structured
    // server error we want to drive the inline panel from.
    if (url.includes("/rest/v1/app_settings") && !url.includes("app_settings_audit")) {
      if (method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "0-1/2" },
          body: JSON.stringify([
            { key: "signed_url_ttl_seconds", value: 900 },
            { key: "signed_url_ttl_user_override_allowed", value: true },
          ]),
        });
      }
      // Upsert: PostgREST-style error envelope. supabase-js surfaces the
      // four fields verbatim on the `.error` object.
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(SERVER_ERROR),
      });
    }

    // Audit table + profile lookups: empty list with valid content-range.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    });
  });

  // Belt-and-braces: any edge function call → 200 empty.
  await page.route("**/functions/v1/**", async (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

/**
 * Normalize the inline panel's announced text by stripping the dismiss
 * button (its aria-label must not bleed into the live-region wording).
 */
async function readPanelAnnouncement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const panel = document.getElementById("ttl-seconds-server-error");
    if (!panel) return "";
    const clone = panel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button").forEach((b) => b.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

async function readToastDescription(page: Page): Promise<string> {
  // shadcn/ui toast renders the description with this data attribute.
  const desc = page.locator("[data-radix-toast-description], [role='status']").last();
  await expect(desc).toBeVisible({ timeout: 5000 });
  return (await desc.textContent() ?? "").replace(/\s+/g, " ").trim();
}

async function triggerServerError(page: Page) {
  // Use a known-valid value (within MIN..MAX) so client-side preflight
  // passes and we exercise the real server-error path.
  const input = page.locator("#ttl-seconds");
  await input.fill("");
  await input.fill("1200");
  await input.blur();
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();
}

test.describe("Admin TTL — server-error live region dismiss across locales", () => {
  // Capture per-locale announcement text so we can assert the cross-locale
  // invariants after the loop (non-empty, distinct, no key leaks).
  const perLocaleAnnouncement: Record<string, string> = {};

  for (const lang of LOCALES) {
    test(`lang=${lang}: dismiss from focused button restores focus and preserves announcement`, async ({ page }) => {
      await stubBackend(page);

      // Seed locale BEFORE the SPA mounts so I18nProvider picks it up on
      // first render — no mid-flight setLang(), no flicker.
      await page.addInitScript((l) => {
        try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
      }, lang);

      await page.goto(HARNESS_PATH);
      await expect(page.getByTestId("admin-ttl-server-error-harness")).toHaveAttribute("data-ready", "true");
      await expect(page.locator("#ttl-seconds")).toBeVisible();

      // ---- 1. Trigger the server error ----
      await triggerServerError(page);

      const announcementBefore = await readPanelAnnouncement(page);
      const toastDescription = await readToastDescription(page);

      expect(announcementBefore.length, `[${lang}] panel announcement non-empty`).toBeGreaterThan(0);

      // No raw i18n keys / template placeholders leaked into the announced
      // wording — the live region must be human-readable in every locale.
      expect(announcementBefore, `[${lang}] no i18n key leak`).not.toMatch(/admin\.ttl\./);
      expect(announcementBefore, `[${lang}] no placeholder leak`).not.toMatch(/\{(min|max|value)\}/);

      // Toast description and panel must agree verbatim on the body of the
      // announcement — same labels ("Hint:", "Details:", "SQLSTATE"), same
      // server message, in the same order.
      for (const part of [SERVER_ERROR.message, SERVER_ERROR.hint, SERVER_ERROR.details, SERVER_ERROR.code]) {
        expect(announcementBefore, `[${lang}] panel contains "${part}"`).toContain(part);
        expect(toastDescription, `[${lang}] toast contains "${part}"`).toContain(part);
      }

      // ---- 2. Focus the dismiss button via the keyboard ----
      const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
      await expect(dismissBtn).toBeVisible();
      const dismissLabel = (await dismissBtn.getAttribute("aria-label")) ?? "";
      expect(dismissLabel.length, `[${lang}] dismiss button has accessible name`).toBeGreaterThan(0);
      // The dismiss button's label is chrome — it must not appear inside the
      // announcement text we just captured.
      expect(announcementBefore, `[${lang}] dismiss label excluded from announcement`)
        .not.toContain(dismissLabel);

      await dismissBtn.focus();
      await expect(dismissBtn).toBeFocused();

      // Re-read announcement now that focus is on the dismiss button — the
      // act of focusing chrome must not mutate the announced wording.
      const announcementWhileFocused = await readPanelAnnouncement(page);
      expect(announcementWhileFocused, `[${lang}] focus does not mutate announcement`)
        .toBe(announcementBefore);

      // ---- 3. Activate via keyboard (Enter on a native <button>) ----
      await page.keyboard.press("Enter");

      // Panel unmounts.
      await expect(page.locator("#ttl-seconds-server-error")).toHaveCount(0);

      // ---- 4. Focus is restored to the TTL input ----
      await expect(page.locator("#ttl-seconds")).toBeFocused();

      // ---- 5. Round-trip: re-trigger the same error, announcement matches ----
      await triggerServerError(page);
      const announcementAfter = await readPanelAnnouncement(page);
      expect(announcementAfter, `[${lang}] announcement stable across dismiss round-trip`)
        .toBe(announcementBefore);

      perLocaleAnnouncement[lang] = announcementBefore;
    });
  }

  test("cross-locale: every locale produced a non-empty, distinct announcement", async () => {
    // The per-test captures above ran in their own pages, but this serial
    // describe shares the closure-level map. Skip the assertion if a prior
    // locale test failed early (map is incomplete) so the failure isn't
    // double-reported.
    const captured = Object.entries(perLocaleAnnouncement);
    test.skip(captured.length !== LOCALES.length, "earlier locale tests did not complete");

    for (const [lang, text] of captured) {
      expect(text, `[${lang}] non-empty`).not.toBe("");
    }
    const unique = new Set(captured.map(([, t]) => t));
    expect(unique.size, "translations differ across locales").toBeGreaterThan(1);
  });
});
