import { test, expect, type Page, type Route } from "../playwright-fixture";
import {
  SLIDER_SELECTOR,
  focusSliderThumb,
  isSliderThumbFocused,
  waitForSliderThumbFocused,
  describeSliderThumbFocusFailure,
} from "./helpers/slider-thumb";

/**
 * E2E: Slider-thumb fallback focus path (per locale).
 *
 * Scenario:
 *   1. Park focus on the Radix slider thumb (origin).
 *   2. Trigger a server-side ttl rejection (P0001) by clicking Save.
 *   3. Detach #ttl-seconds from the live DOM so the synchronous focus()
 *      inside dismissServerError() takes the documented fallback branch:
 *        (ttlInput ?? preErrorFocusRef.current)?.focus()
 *   4. Keyboard-dismiss the inline panel (Tab to dismiss button → Enter).
 *   5. Assert focus has been restored to the slider thumb.
 *
 * This complements the broader fallback-focus spec by isolating the
 * slider-thumb origin into its own dedicated assertion and applying the
 * jsdom/Radix focus workaround (synchronous .focus({preventScroll:true})
 * via page.evaluate, with defensive tabIndex promotion) consistently.
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




test.describe("Admin TTL — slider thumb is the fallback focus target when #ttl-seconds is missing", () => {
  for (const lang of LOCALES) {
    test(`lang=${lang}: focus-thumb → trigger error → dismiss → focus returns to slider thumb`, async ({ page }) => {
      await stubBackend(page);

      await page.addInitScript((l) => {
        try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
      }, lang);

      await page.goto(HARNESS_PATH);
      await expect(page.getByTestId("admin-ttl-server-error-harness"))
        .toHaveAttribute("data-ready", "true");
      await expect(page.locator("#ttl-seconds")).toBeVisible();
      await expect(page.locator(SLIDER_SELECTOR)).toBeVisible();

      // ---- 1. Stage a valid value via the input (so Save dispatches) ----
      const input = page.locator("#ttl-seconds");
      await input.fill("");
      await input.fill("1200");
      await input.blur();

      // ---- 2. Park focus on the slider thumb (the origin) ----
      await focusSliderThumb(page);
      {
        const focused = await isSliderThumbFocused(page);
        expect(
          focused,
          await describeSliderThumbFocusFailure(page, `[${lang}] slider thumb focused before Save`, { screenshotPath: true }),
        ).toBe(true);
      }

      // ---- 3. Click Save to trigger the P0001 server error ----
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();

      // ---- 4. Detach #ttl-seconds so dismissServerError falls back ----
      await page.evaluate(() => {
        document.getElementById("ttl-seconds")?.remove();
      });
      await expect(page.locator("#ttl-seconds")).toHaveCount(0);

      // ---- 5. Tab from the slider thumb to the dismiss button, Enter ----
      await focusSliderThumb(page);
      // Wait/retry: Radix's pointer/blur handlers can steal focus
      // asynchronously, so we poll until the thumb is actually focused
      // before starting the Tab walk. A silent failure here would let
      // the Tab walk start from <body> and still incidentally reach the
      // dismiss button, masking the fact that we never exercised the
      // slider-thumb origin.
      await waitForSliderThumbFocused(page, undefined, { screenshotPath: true });
      const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
      await expect(dismissBtn).toBeVisible();
      for (let i = 0; i < 30; i++) {
        if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(dismissBtn, `[${lang}] dismiss reachable via Tab from slider thumb`)
        .toBeFocused();
      await page.keyboard.press("Enter");

      // ---- 6. Panel unmounts ----
      await expect(page.locator("#ttl-seconds-server-error")).toHaveCount(0);

      // ---- 7. Focus is back on the slider thumb (the fallback) ----
      // Read synchronously — the contract under test is the synchronous
      // .focus() inside dismissServerError(), before React reconciles
      // #ttl-seconds back into the DOM.
      {
        const focused = await isSliderThumbFocused(page);
        expect(
          focused,
          await describeSliderThumbFocusFailure(
            page,
            `[${lang}] focus returned to slider thumb after dismiss`,
            { screenshotPath: true },
          ),
        ).toBe(true);
      }

      // And the slider thumb is still a live, connected element.
      expect(
        await page.evaluate(
          (sel) => !!document.querySelector(sel)?.isConnected,
          SLIDER_SELECTOR,
        ),
        `[${lang}] slider thumb is still connected to the DOM`,
      ).toBe(true);
    });
  }
});
