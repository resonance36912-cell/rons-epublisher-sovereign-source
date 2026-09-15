import { test, expect, type Page, type Route } from "../playwright-fixture";
import {
  describeActiveElement,
  describeSliderThumbFocusFailure,
  captureFailureScreenshot,
  type SliderFocusFailureOptions,
} from "./helpers/slider-thumb";

/**
 * E2E: Fallback focus path when #ttl-seconds is missing.
 *
 * dismissServerError() is documented as:
 *   (ttlInput ?? preErrorFocusRef.current)?.focus()
 *
 * The sibling unit test pins this in jsdom. This spec re-pins it in a
 * real browser engine so a focus-management regression that only shows
 * up under real layout/event ordering (e.g. blur events firing between
 * setServerError(null) and the synchronous focus()) is caught.
 *
 * Per locale × origin we:
 *   1. Park focus on the origin (Save button or audit-log link).
 *   2. Trigger the server-error panel.
 *   3. Detach #ttl-seconds from the live DOM (React still owns it
 *      internally; reconciliation re-adds it on the next render — but
 *      the focus() inside dismissServerError runs synchronously and
 *      sees null first, taking the fallback branch).
 *   4. Tab-focus the dismiss button, activate with Enter.
 *   5. Assert focus landed on the pre-error origin (the fallback).
 *
 * Origins covered: Save button, audit-log link, AND the Radix slider
 * thumb. The slider needs a small focus workaround — in a real browser
 * the Radix pointer handler can swallow a click-initiated focus, so we
 * use page.evaluate() to call .focus({preventScroll:true}) directly on
 * the thumb element, bypassing any pointer-driven blur.
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

type OriginId = "save-button" | "audit-log-link" | "slider-thumb";

const SLIDER_SELECTOR = '[aria-label="Signed URL TTL in seconds"]';

const ORIGINS: Array<{
  id: OriginId;
  focus: (page: Page) => Promise<void>;
  // Returns true when the currently focused element is THIS origin.
  isFocused: (page: Page) => Promise<boolean>;
}> = [
  {
    id: "save-button",
    focus: async (page) => {
      await page.getByRole("button", { name: /^save$/i }).focus();
    },
    isFocused: async (page) =>
      page.getByRole("button", { name: /^save$/i }).evaluate(
        (el) => el === document.activeElement,
      ),
  },
  {
    id: "audit-log-link",
    focus: async (page) => {
      await page.getByRole("link", { name: /view signed-url audit log/i }).focus();
    },
    isFocused: async (page) =>
      page.getByRole("link", { name: /view signed-url audit log/i }).evaluate(
        (el) => el === document.activeElement,
      ),
  },
  {
    id: "slider-thumb",
    // Workaround: page.locator(...).focus() can race with Radix's own
    // pointer/blur handlers. Drive .focus({preventScroll:true}) inside
    // page.evaluate so the call is synchronous on the page thread, and
    // promote tabIndex defensively if Radix hasn't set it yet on this
    // particular thumb.
    focus: async (page) => {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) throw new Error(`slider thumb not found for ${sel}`);
        if (el.tabIndex < 0) el.tabIndex = 0;
        el.focus({ preventScroll: true });
      }, SLIDER_SELECTOR);
    },
    isFocused: async (page) =>
      page.evaluate(
        (sel) => document.querySelector(sel) === document.activeElement,
        SLIDER_SELECTOR,
      ),
  },
];

/**
 * Build a consistent, descriptive failure message for the
 * "origin focused" assertion. For the slider-thumb origin we delegate
 * to the shared describeSliderThumbFocusFailure helper so every
 * slider-thumb focus assertion across the e2e suite emits identical
 * multi-line output (selector + aria-label + serialized activeElement).
 * For non-slider origins we still include a serialized activeElement
 * snapshot for parity.
 */
async function originFocusFailureMessage(
  page: Page,
  originId: OriginId,
  context: string,
  options?: SliderFocusFailureOptions,
): Promise<string> {
  if (originId === "slider-thumb") {
    return describeSliderThumbFocusFailure(page, context, options);
  }
  const [active, screenshot] = await Promise.all([
    describeActiveElement(page),
    captureFailureScreenshot(page, options, context),
  ]);
  const base = `${context}\n  actual document.activeElement:\n    ${active}`;
  return screenshot !== undefined ? `${base}\n    screenshot: ${screenshot.line}` : base;
}


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

test.describe("Admin TTL — fallback focus when #ttl-seconds is missing (E2E)", () => {
  for (const lang of LOCALES) {
    for (const origin of ORIGINS) {
      test(`lang=${lang}, origin=${origin.id}: keyboard dismiss falls back to pre-error origin when #ttl-seconds is detached`, async ({ page }) => {
        await stubBackend(page);

        await page.addInitScript((l) => {
          try { localStorage.setItem("resonance-lang", l); } catch { /* ignore */ }
        }, lang);

        await page.goto(HARNESS_PATH);
        await expect(page.getByTestId("admin-ttl-server-error-harness")).toHaveAttribute("data-ready", "true");
        await expect(page.locator("#ttl-seconds")).toBeVisible();

        // ---- 1. Type a valid value, then park focus on the origin ----
        const input = page.locator("#ttl-seconds");
        await input.fill("");
        await input.fill("1200");
        await input.blur();

        await origin.focus(page);
        {
          const focused = await origin.isFocused(page);
          expect(
            focused,
            await originFocusFailureMessage(
              page,
              origin.id,
              `[${lang}/${origin.id}] origin focused before Save`,
              { screenshotPath: true },
            ),
          ).toBe(true);
        }

        // ---- 2. Drive Save via .click() on the button (NOT Enter — Enter
        // on the audit-log-link origin would activate the link instead). ----
        await page.getByRole("button", { name: /^save$/i }).click();
        await expect(page.locator("#ttl-seconds-server-error")).toBeVisible();

        // ---- 3. Detach #ttl-seconds from the live DOM ----
        // React still owns it; reconciliation will re-add on next render.
        // The focus() inside dismissServerError runs synchronously and
        // will see null at the moment of the click → fallback branch.
        await page.evaluate(() => {
          document.getElementById("ttl-seconds")?.remove();
        });
        await expect(page.locator("#ttl-seconds")).toHaveCount(0);

        // ---- 4. Tab to the dismiss button, activate with Enter ----
        const dismissBtn = page.locator("#ttl-seconds-server-error button[aria-label]");
        await expect(dismissBtn).toBeVisible();
        // Start the Tab walk from the origin so we exercise the same
        // keyboard path a real admin would use.
        await origin.focus(page);
        // Hard-assert focus is parked on the origin before tabbing — a
        // silent skip (e.g. slider thumb's pointer handler swallowed the
        // focus) would let Tab start from <body> and the test would
        // still incidentally reach the dismiss button without ever
        // exercising the documented origin × locale combo.
        {
          const focused = await origin.isFocused(page);
          expect(
            focused,
            await originFocusFailureMessage(
              page,
              origin.id,
              `[${lang}/${origin.id}] origin focused before Tab walk to dismiss`,
              { screenshotPath: true },
            ),
          ).toBe(true);
        }
        for (let i = 0; i < 30; i++) {
          if (await dismissBtn.evaluate((el) => el === document.activeElement)) break;
          await page.keyboard.press("Tab");
        }
        await expect(dismissBtn, `[${lang}/${origin.id}] dismiss reachable via Tab`).toBeFocused();
        await page.keyboard.press("Enter");

        // ---- 5. Panel unmounts ----
        await expect(page.locator("#ttl-seconds-server-error")).toHaveCount(0);

        // ---- 6. Focus is on the pre-error origin (the fallback) ----
        // Read activeElement BEFORE React reconciles #ttl-seconds back
        // into the DOM and any subsequent render-time focus effect can
        // legitimately move focus elsewhere. The contract under test is
        // the synchronous fallback path of dismissServerError().
        {
          const focused = await origin.isFocused(page);
          expect(
            focused,
            await originFocusFailureMessage(
              page,
              origin.id,
              `[${lang}/${origin.id}] fallback focus = pre-error origin`,
              { screenshotPath: true },
            ),
          ).toBe(true);
        }
      });
    }
  }
});
