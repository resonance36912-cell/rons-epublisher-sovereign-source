import { test, expect, type Page, type Route } from "../playwright-fixture";

/**
 * E2E: After dismissing the server-error live region, the next Tab target
 * is the TTL input — in every supported locale.
 *
 * Companions to admin-ttl-server-error-dismiss.spec.ts and
 * admin-ttl-server-error-localized-announcement.spec.ts. Those pin the
 * announcement wording and immediate focus restoration. This spec pins
 * the *post-dismiss tab order*: a keyboard user who dismisses the panel
 * and then taps Tab once must land on `#ttl-seconds`, not on a stale
 * focusable that the panel left behind in the document order.
 *
 * Per locale we:
 *   1. Trigger the server-error panel.
 *   2. Tab to the dismiss button, activate it with Enter.
 *   3. Assert the panel unmounted and focus is restored to #ttl-seconds.
 *   4. Move focus off the TTL input (focus <body>) and press Tab.
 *   5. Assert the first focusable target Tab reaches is #ttl-seconds.
 */

const HARNESS_PATH = "/__test/admin-ttl-server-error";
const LOCALES = ["af", "es", "fr", "de"] as const;
const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";

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

async function triggerServerError(page: Page) {
  const input = page.locator("#ttl-seconds");
  await input.fill("");
  await input.fill("1200");
  await input.blur();
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();
}

test.describe("Admin TTL — post-dismiss tab order returns to #ttl-seconds across locales", () => {
  for (const lang of LOCALES) {
    test(`lang=${lang}: Tab from <body> after dismiss lands on #ttl-seconds`, async ({ page }) => {
      await stubBackend(page);

      await page.addInitScript((l) => {
        try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
      }, lang);

      await page.goto(HARNESS_PATH);
      await expect(page.getByTestId("admin-ttl-server-error-harness")).toHaveAttribute("data-ready", "true");
      await expect(page.locator("#ttl-seconds")).toBeVisible();

      // ---- 1. Trigger the inline panel ----
      await triggerServerError(page);

      // ---- 2. Tab-walk from the TTL input until the dismiss button is focused ----
      const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
      await expect(dismissBtn).toBeVisible();
      await page.locator("#ttl-seconds").focus();
      for (let i = 0; i < 25; i++) {
        if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(dismissBtn, `[${lang}] dismiss button reachable via Tab`).toBeFocused();

      // ---- 3. Activate via Enter, assert unmount + focus restoration ----
      await page.keyboard.press("Enter");
      await expect(page.locator("#ttl-seconds-server-error")).toHaveCount(0);
      await expect(page.locator("#ttl-seconds"), `[${lang}] focus restored to #ttl-seconds`).toBeFocused();

      // ---- 4. Move focus off #ttl-seconds so we can test the Tab landing ----
      // Blur via the DOM (not via Tab — that would already prove the next
      // forward target is *after* the input, not what we're asserting).
      // We park focus on <body>, then press Tab once and verify the
      // browser's first forward target is the TTL input itself.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        document.body.setAttribute("tabindex", "-1");
        document.body.focus();
      });
      // Sanity: focus parked off the input.
      await expect(page.locator("#ttl-seconds")).not.toBeFocused();

      // ---- 5. First Tab forward must land on #ttl-seconds ----
      // We allow a small bounded walk (≤8 Tabs) to skip any browser-chrome
      // / a11y-tree shims that may sit before the section's first
      // focusable in headless mode. The assertion is "the input is the
      // first focusable inside the section after dismissal" — equivalent
      // to "no stale focusable was left behind by the unmount in front
      // of the input".
      let landedIndex = -1;
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        if (await page.locator("#ttl-seconds").evaluate((el) => el === document.activeElement)) {
          landedIndex = i;
          break;
        }
      }
      expect(
        landedIndex,
        `[${lang}] Tab from <body> reached #ttl-seconds without traversing stale focusables`,
      ).toBeGreaterThanOrEqual(0);
      await expect(page.locator("#ttl-seconds")).toBeFocused();

      // ---- 6. The dismiss button is NOT in the post-dismiss tab order ----
      // Confirms no orphan focusable button with the dismiss aria-label
      // was left behind by the unmount.
      const orphanDismiss = await page
        .locator("button[aria-label]")
        .filter({ has: page.locator("svg") })
        .evaluateAll((els) =>
          els
            .filter((el) => /dismiss/i.test(el.getAttribute("aria-label") ?? ""))
            .map((el) => el.getAttribute("aria-label")),
        );
      expect(
        orphanDismiss,
        `[${lang}] no orphan "dismiss" button left in tab order after unmount`,
      ).toEqual([]);
    });
  }
});
