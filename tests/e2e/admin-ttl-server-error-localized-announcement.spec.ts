import { test, expect, type Page, type Route } from "../playwright-fixture";

/**
 * E2E: Keyboard-dismissed server-error live region — localized announcement
 * parity across af/es/fr/de.
 *
 * Companion to admin-ttl-server-error-dismiss.spec.ts. That spec proves the
 * dismiss interaction is stable per locale and that the announcement
 * round-trips cleanly. This spec pins the *exact* localized strings the
 * live region must emit, then dismisses it with the keyboard and proves the
 * dismissal does not corrupt those strings before the panel unmounts.
 *
 * For each locale we assert:
 *   1. The header line uses the locale's "Server rejected the value"
 *      translation.
 *   2. The hint + details lines use the locale's label translations
 *      ("Wenk:" / "Sugerencia:" / "Indice :" / "Hinweis:" etc.).
 *   3. The SQLSTATE label is locale-invariant (it's the Postgres term).
 *   4. The server-supplied bodies (message/hint/details/code) appear verbatim.
 *   5. The accessible dismiss button is reachable with Tab, activatable with
 *      Enter, removes the live region, and the post-dismiss announcement
 *      captured at activation time matches the pre-dismiss announcement
 *      byte-for-byte.
 */

const HARNESS_PATH = "/__test/admin-ttl-server-error";
const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";

const SERVER_ERROR = {
  code: "P0001",
  message: "ttl out of policy range",
  hint: "Pick a value between 60 and 3600.",
  details: "Trigger ttl_policy_guard rejected the upsert.",
};

// Pinned per-locale wording. If translations change in src/lib/i18n.tsx
// these literals MUST be updated in lockstep — that's the whole point of
// this spec, it's a regression gate on the user-visible announcement.
const LOCALE_EXPECTATIONS = {
  af: { header: "Bediener het die waarde verwerp", hintLabel: "Wenk:",         detailsLabel: "Besonderhede:" },
  es: { header: "El servidor rechazó el valor",    hintLabel: "Sugerencia:",   detailsLabel: "Detalles:"     },
  fr: { header: "Le serveur a rejeté la valeur",   hintLabel: "Indice :",      detailsLabel: "Détails :"     },
  de: { header: "Server hat den Wert abgelehnt",   hintLabel: "Hinweis:",      detailsLabel: "Details:"      },
} as const;

const SQLSTATE_LABEL = "SQLSTATE"; // locale-invariant

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
    // Strip the dismiss button — its aria-label is chrome, not content.
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

test.describe("Admin TTL — localized live-region announcement survives keyboard dismiss", () => {
  for (const [lang, expected] of Object.entries(LOCALE_EXPECTATIONS)) {
    test(`lang=${lang}: announcement matches localized text and is stable through Tab+Enter dismiss`, async ({ page }) => {
      await stubBackend(page);

      await page.addInitScript((l) => {
        try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
      }, lang);

      await page.goto(HARNESS_PATH);
      await expect(page.getByTestId("admin-ttl-server-error-harness")).toHaveAttribute("data-ready", "true");
      await expect(page.locator("#ttl-seconds")).toBeVisible();

      // ---- Drive the inline panel ----
      await triggerServerError(page);

      const panel = page.locator("#ttl-seconds-server-error");
      // The inline panel is the polite live region the screen reader announces.
      await expect(panel).toHaveAttribute("aria-live", "polite");

      const announcementBefore = await readAnnouncement(page);

      // ---- Localized labels & header ----
      expect(announcementBefore, `[${lang}] header`).toContain(expected.header);
      expect(announcementBefore, `[${lang}] hint label`).toContain(expected.hintLabel);
      expect(announcementBefore, `[${lang}] details label`).toContain(expected.detailsLabel);
      expect(announcementBefore, `[${lang}] SQLSTATE label is locale-invariant`).toContain(SQLSTATE_LABEL);

      // ---- Server-supplied bodies appear verbatim ----
      for (const part of [SERVER_ERROR.message, SERVER_ERROR.hint, SERVER_ERROR.details, SERVER_ERROR.code]) {
        expect(announcementBefore, `[${lang}] contains "${part}"`).toContain(part);
      }

      // No untranslated key leaks / placeholder leaks.
      expect(announcementBefore, `[${lang}] no i18n key leak`).not.toMatch(/admin\.ttl\./);
      expect(announcementBefore, `[${lang}] no placeholder leak`).not.toMatch(/\{(min|max|value)\}/);

      // ---- Keyboard reach the dismiss button via Tab from the panel ----
      const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
      await expect(dismissBtn).toBeVisible();

      // Start Tab-walking from the TTL input; the dismiss button is the next
      // focusable inside the panel — walk forward up to a reasonable bound.
      await page.locator("#ttl-seconds").focus();
      for (let i = 0; i < 25; i++) {
        if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(dismissBtn, `[${lang}] dismiss button reachable via Tab`).toBeFocused();

      // Capture the announcement *while focus is on the dismiss button* —
      // focus change must not mutate the announced text.
      const announcementAtDismissFocus = await readAnnouncement(page);
      expect(announcementAtDismissFocus, `[${lang}] focus does not mutate announcement`)
        .toBe(announcementBefore);

      // ---- Activate via keyboard ----
      await page.keyboard.press("Enter");

      // Panel unmounts → live region is gone → no stale announcement remains.
      await expect(panel).toHaveCount(0);
      const lingering = await page.locator("[aria-live='polite']")
        .filter({ hasText: expected.header })
        .count();
      expect(lingering, `[${lang}] no orphan live region retains the localized header`).toBe(0);

      // Focus is returned to the TTL input (cross-locale invariant covered
      // by the sibling spec; we re-assert here to keep this spec standalone).
      await expect(page.locator("#ttl-seconds")).toBeFocused();
    });
  }
});
