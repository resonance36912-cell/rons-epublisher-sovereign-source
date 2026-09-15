import { test, expect, type Page, type Route } from "../playwright-fixture";

/**
 * E2E: Dismissing the server-error panel from the *focused dismiss button*
 * must not mutate the live-region announcement text, and the invariant
 * (server-supplied) portions of the announcement must be byte-identical
 * across every supported locale.
 *
 * For each locale (af/es/fr/de) we:
 *   1. Trigger the inline server-error panel.
 *   2. Snapshot the live-region text (S1).
 *   3. Move keyboard focus *onto* the dismiss button.
 *   4. Snapshot again (S2) — must equal S1 byte-for-byte.
 *   5. Activate the focused dismiss button (Enter, then re-arm Space in a
 *      second pass) and confirm the panel unmounts.
 *
 * After the per-locale loop we cross-check: every locale's announcement must
 * contain the locale-invariant server payload (message, hint, details, code,
 * SQLSTATE label) verbatim — i.e. localization wraps but never rewrites the
 * server-supplied strings.
 */

const HARNESS_PATH = "/__test/admin-ttl-server-error";
const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";
const LOCALES = ["af", "es", "fr", "de"] as const;
const SQLSTATE_LABEL = "SQLSTATE";

const SERVER_ERROR = {
  code: "P0001",
  message: "ttl out of policy range",
  hint: "Pick a value between 60 and 3600.",
  details: "Trigger ttl_policy_guard rejected the upsert.",
};

async function stubBackend(page: Page) {
  await page.route("**/auth/v1/user*", async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: FAKE_USER_ID, email: "admin@test.local" }),
    }),
  );

  await page.route("**/rest/v1/**", async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

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
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(SERVER_ERROR),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    });
  });

  await page.route("**/functions/v1/**", async (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

async function readAnnouncement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const panel = document.getElementById("ttl-seconds-server-error");
    if (!panel) return "";
    const clone = panel.cloneNode(true) as HTMLElement;
    // Dismiss button aria-label is chrome, not announced content.
    clone.querySelectorAll("button").forEach((b) => b.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

async function triggerServerError(page: Page) {
  const input = page.locator("#ttl-seconds");
  await input.fill("");
  await input.fill("1200");
  await input.blur();
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();
}

async function focusDismissButton(page: Page) {
  const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
  await expect(dismissBtn).toBeVisible();
  await page.locator("#ttl-seconds").focus();
  for (let i = 0; i < 25; i++) {
    if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(dismissBtn).toBeFocused();
  return dismissBtn;
}

async function captureAnnouncementForLocale(
  page: Page,
  lang: string,
  activation: "Enter" | "Space",
): Promise<string> {
  await stubBackend(page);

  await page.addInitScript((l) => {
    try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
  }, lang);

  await page.goto(HARNESS_PATH);
  await expect(page.getByTestId("admin-ttl-server-error-harness"))
    .toHaveAttribute("data-ready", "true");
  await expect(page.locator("#ttl-seconds")).toBeVisible();

  await triggerServerError(page);
  const panel = page.locator("#ttl-seconds-server-error");
  await expect(panel).toHaveAttribute("aria-live", "polite");

  // (1) Snapshot before focusing the dismiss button.
  const before = await readAnnouncement(page);
  expect(before.length, `[${lang}/${activation}] non-empty pre-focus announcement`).toBeGreaterThan(0);

  // Server-supplied invariants — must always be present verbatim.
  for (const part of [SERVER_ERROR.message, SERVER_ERROR.hint, SERVER_ERROR.details, SERVER_ERROR.code, SQLSTATE_LABEL]) {
    expect(before, `[${lang}/${activation}] contains "${part}" pre-focus`).toContain(part);
  }

  // (2) Move focus onto the dismiss button.
  await focusDismissButton(page);

  // (3) Snapshot while the dismiss button has focus — must equal (1).
  const atFocus = await readAnnouncement(page);
  expect(atFocus, `[${lang}/${activation}] focusing dismiss button mutated announcement`)
    .toBe(before);

  // (4) Activate via keyboard from the focused button.
  await page.keyboard.press(activation);

  await expect(panel, `[${lang}/${activation}] panel unmounts after dismiss`).toHaveCount(0);

  // No orphan live region keeps the announcement text alive.
  const lingering = await page.locator("[aria-live='polite']")
    .filter({ hasText: SERVER_ERROR.message })
    .count();
  expect(lingering, `[${lang}/${activation}] no orphan live region with server text`).toBe(0);

  return before;
}

test.describe("Admin TTL — dismissing from the focused dismiss button preserves announcement across locales", () => {
  for (const lang of LOCALES) {
    for (const activation of ["Enter", "Space"] as const) {
      test(`lang=${lang}: focusing the dismiss button and activating via ${activation} does not mutate the announcement`, async ({ page }) => {
        await captureAnnouncementForLocale(page, lang, activation);
      });
    }
  }

  test("cross-locale invariant: server-supplied payload occurs identically in every locale's announcement", async ({ page }) => {
    // Walk every locale in a single test so the comparison is hermetic and
    // independent of Playwright worker sharding.
    const captured: Record<string, string> = {};
    for (const lang of LOCALES) {
      captured[lang] = await captureAnnouncementForLocale(page, lang, "Enter");
      // Re-arm Playwright route handlers / fresh page state for the next iteration.
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => { /* ignore */ });
    }

    const invariantParts = [
      SERVER_ERROR.message,
      SERVER_ERROR.hint,
      SERVER_ERROR.details,
      SERVER_ERROR.code,
      SQLSTATE_LABEL,
    ];

    for (const part of invariantParts) {
      const occurrences = LOCALES.map((lang) => ({
        lang,
        // Count substring occurrences — must be ≥1 and equal across locales
        // so a locale can't silently drop or duplicate a server-supplied field.
        count: captured[lang].split(part).length - 1,
      }));
      const baseline = occurrences[0].count;
      expect(baseline, `"${part}" missing from ${occurrences[0].lang}`).toBeGreaterThan(0);
      for (const o of occurrences) {
        expect(
          o.count,
          `"${part}" occurs ${o.count}× in ${o.lang} but ${baseline}× in ${occurrences[0].lang}`,
        ).toBe(baseline);
      }
    }
  });
});
