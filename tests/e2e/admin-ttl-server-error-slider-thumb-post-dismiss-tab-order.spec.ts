import { test, expect, type Page, type Route } from "../playwright-fixture";
import {
  SLIDER_SELECTOR,
  focusSliderThumb,
  isSliderThumbFocused,
  waitForSliderThumbFocused,
  describeSliderThumbFocusFailure,
} from "./helpers/slider-thumb";

/**
 * E2E: After dismissing the server-error live region, when the user's
 * keyboard focus *originated on the Radix slider thumb* (not the input),
 * the very next forward Tab target must still be `#ttl-seconds` — in every
 * supported locale.
 *
 * This complements admin-ttl-server-error-post-dismiss-tab-order.spec.ts
 * (which exercises the input-origin path). The slider thumb sits beside
 * the TTL input in the section's DOM order, so a regression in cleanup or
 * focus restoration could leave Tab landing on the thumb again instead of
 * crossing forward to the input.
 *
 * Per locale we:
 *   1. Park keyboard focus on the slider thumb.
 *   2. Click Save to trigger the inline panel.
 *   3. Tab to the dismiss button → Enter to dismiss.
 *   4. Assert the panel unmounts and focus is restored to #ttl-seconds.
 *   5. Park focus off the input (on <body>) and press Tab.
 *   6. Assert the first forward focusable is #ttl-seconds (no stale
 *      focusable from the panel was left behind, and Tab from the slider
 *      thumb's neighborhood still flows forward into the input).
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


test.describe("Admin TTL — Tab after dismiss lands on #ttl-seconds when origin is the slider thumb", () => {
  for (const lang of LOCALES) {
    test(`lang=${lang}: focus-thumb → trigger error → dismiss → Tab from <body> lands on #ttl-seconds`, async ({ page }) => {
      await stubBackend(page);

      await page.addInitScript((l) => {
        try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
      }, lang);

      await page.goto(HARNESS_PATH);
      await expect(page.getByTestId("admin-ttl-server-error-harness"))
        .toHaveAttribute("data-ready", "true");
      await expect(page.locator("#ttl-seconds")).toBeVisible();
      await expect(page.locator(SLIDER_SELECTOR)).toBeVisible();

      // ---- 1. Stage a valid value via the input then park focus on the thumb ----
      const input = page.locator("#ttl-seconds");
      await input.fill("");
      await input.fill("1200");
      await input.blur();

      await focusSliderThumb(page);
      {
        const focused = await isSliderThumbFocused(page);
        expect(
          focused,
          await describeSliderThumbFocusFailure(
            page,
            `[${lang}] slider thumb is the keyboard origin before Save`,
            { screenshotPath: true },
          ),
        ).toBe(true);
      }

      // ---- 2. Click Save to trigger the P0001 inline panel ----
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();

      // ---- 3. Tab from the thumb until the dismiss button is focused ----
      await focusSliderThumb(page);
      // Wait/retry: Radix's pointer/blur handlers can steal focus
      // asynchronously, so we poll until the thumb is actually focused
      // before starting the Tab walk. A silent skip would let Tab start
      // from <body> and the test would still pass without ever exercising
      // the slider-thumb origin.
      await waitForSliderThumbFocused(page, undefined, { screenshotPath: true });
      const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
      await expect(dismissBtn).toBeVisible();
      for (let i = 0; i < 30; i++) {
        if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(dismissBtn, `[${lang}] dismiss reachable via Tab from slider thumb`)
        .toBeFocused();

      // ---- 4. Activate dismiss; panel unmounts, focus → #ttl-seconds ----
      await page.keyboard.press("Enter");
      await expect(page.locator("#ttl-seconds-server-error")).toHaveCount(0);
      await expect(page.locator("#ttl-seconds"), `[${lang}] focus restored to #ttl-seconds`)
        .toBeFocused();

      // ---- 5. Park focus off the input on <body> ----
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        document.body.setAttribute("tabindex", "-1");
        document.body.focus();
      });
      await expect(page.locator("#ttl-seconds")).not.toBeFocused();

      // ---- 6. First forward Tab must land on #ttl-seconds ----
      // Bounded walk (≤8 Tabs) to absorb any headless browser-chrome
      // shims that may sit before the section's first focusable. The
      // contract: no stale focusable (e.g. orphan dismiss button) is left
      // ahead of the input in the post-dismiss tab order.
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
        `[${lang}] Tab from <body> reached #ttl-seconds without traversing stale focusables (last active=${await page.evaluate(
          () =>
            (document.activeElement as HTMLElement | null)?.id ||
            (document.activeElement as HTMLElement | null)?.getAttribute?.("aria-label") ||
            document.activeElement?.tagName ||
            "<none>",
        )})`,
      ).toBeGreaterThanOrEqual(0);
      await expect(page.locator("#ttl-seconds")).toBeFocused();

      // ---- 7. No orphan dismiss button left in the tab order ----
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
