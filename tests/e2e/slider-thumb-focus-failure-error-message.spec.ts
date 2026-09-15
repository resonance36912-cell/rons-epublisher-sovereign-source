import { test, expect, type Page, type Route } from "../playwright-fixture";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { waitForSliderThumbFocused } from "./helpers/slider-thumb";

/**
 * E2E: verify the thrown focus-assertion error message carries the
 * screenshot path in a way that's trivially discoverable from CI logs.
 *
 * Contract under test (helpers/slider-thumb.ts):
 *   - When waitForSliderThumbFocused() times out with
 *     `options.screenshotPath: true`, the thrown Error.message:
 *       1. starts with `[screenshot: file://…]` so it survives log
 *          truncation,
 *       2. contains the absolute on-disk path of the saved PNG, and
 *       3. the file actually exists on disk afterward.
 *
 * Deliberately drives a failure by never focusing the slider thumb,
 * so the 2s `expect.poll` inside waitForSliderThumbFocused times out
 * and the helper takes the catch/throw branch.
 */

const HARNESS_PATH = "/__test/admin-ttl-server-error";
const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";

async function stubBackend(page: Page) {
  await page.route("**/auth/v1/user*", async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: FAKE_USER_ID, email: "admin@test.local" }),
    }),
  );
  await page.route("**/rest/v1/**", async (route: Route) => {
    const url = route.request().url();
    if (url.includes("/rest/v1/app_settings") && !url.includes("audit")) {
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

test("waitForSliderThumbFocused failure surfaces [screenshot: file://…] prefix and absolute path", async ({ page }) => {
  await stubBackend(page);

  // Use an explicit, predictable screenshot path so we can grep for it
  // verbatim in the thrown error message instead of having to reverse
  // the auto-generated stamp.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relPath = `test-results/slider-focus-error-msg-${stamp}.png`;
  const absPath = path.resolve(relPath);
  const fileUrl = pathToFileURL(absPath).href;

  // Make sure we're not asserting against a stale artifact.
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  await page.goto(HARNESS_PATH);
  await expect(page.getByTestId("admin-ttl-server-error-harness"))
    .toHaveAttribute("data-ready", "true");

  // Park focus on document.body (i.e. don't focus the slider thumb) so
  // waitForSliderThumbFocused is guaranteed to time out.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  let thrown: unknown;
  try {
    await waitForSliderThumbFocused(
      page,
      "intentional failure: thumb is not focused (asserting error format)",
      { screenshotPath: relPath },
    );
  } catch (err) {
    thrown = err;
  }

  expect(thrown, "waitForSliderThumbFocused must throw when the thumb never focuses").toBeInstanceOf(Error);
  const msg = (thrown as Error).message;

  // (1) prefix is the very first thing in the message
  expect(msg.startsWith(`[screenshot: ${fileUrl}]`), `expected message to start with [screenshot: ${fileUrl}], got:\n${msg}`).toBe(true);

  // (2) absolute path appears somewhere in the body
  expect(msg).toContain(absPath);

  // (3) the file:// URL is also present in the body's `screenshot:` line,
  //     not only the prefix, so a grep on either form finds it
  expect(msg).toContain(`(${fileUrl})`);

  // (4) the screenshot was actually written to disk
  expect(fs.existsSync(absPath), `expected screenshot at ${absPath} to exist after failure`).toBe(true);
  expect(fs.statSync(absPath).size).toBeGreaterThan(0);

  // Cleanup so the artifact doesn't accumulate across runs.
  fs.unlinkSync(absPath);
});

test("waitForSliderThumbFocused failure header uses the relative path form when pathStyle:'relative'", async ({ page }) => {
  await stubBackend(page);

  // Predictable relative path under cwd so path.relative collapses to
  // exactly `test-results/<name>.png` (no `..` prefix).
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relPath = `test-results/slider-focus-pathstyle-rel-${stamp}.png`;
  const absPath = path.resolve(relPath);
  const fileUrl = pathToFileURL(absPath).href;
  const expectedRel = path.relative(process.cwd(), absPath);

  // Sanity-check the precondition this assertion depends on.
  expect(
    expectedRel && !expectedRel.startsWith("..") && !path.isAbsolute(expectedRel),
    "test setup: resolved screenshot path must live under cwd for the 'relative' style to apply",
  ).toBe(true);

  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  await page.goto(HARNESS_PATH);
  await expect(page.getByTestId("admin-ttl-server-error-harness"))
    .toHaveAttribute("data-ready", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  let thrown: unknown;
  try {
    await waitForSliderThumbFocused(
      page,
      "intentional failure: thumb is not focused (asserting relative pathStyle)",
      { screenshotPath: relPath, pathStyle: "relative" },
    );
  } catch (err) {
    thrown = err;
  }

  expect(thrown).toBeInstanceOf(Error);
  const msg = (thrown as Error).message;

  // (1) header carries the *relative* path verbatim — not the absolute
  //     path and not the file:// URL.
  expect(
    msg.startsWith(`[screenshot: ${expectedRel}]`),
    `expected message to start with [screenshot: ${expectedRel}], got:\n${msg}`,
  ).toBe(true);

  // (2) the header MUST NOT contain the noisier forms — the whole point
  //     of pathStyle:'relative' is to reduce truncation risk.
  const header = msg.split("\n", 1)[0];
  expect(header).not.toContain(fileUrl);
  expect(header).not.toContain(absPath);

  // (3) inline 'screenshot:' line in the body uses the same relative
  //     form and omits the parenthesized (file://…) annotation that the
  //     absolute style adds.
  expect(msg).toContain(`screenshot: saved → ${expectedRel}`);
  expect(msg).not.toContain(`(${fileUrl})`);

  // (4) the file itself was still written to its absolute on-disk path.
  expect(fs.existsSync(absPath)).toBe(true);
  expect(fs.statSync(absPath).size).toBeGreaterThan(0);

  fs.unlinkSync(absPath);
});

test("waitForSliderThumbFocused failure header uses only the basename when pathStyle:'basename'", async ({ page }) => {
  await stubBackend(page);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relPath = `test-results/slider-focus-pathstyle-base-${stamp}.png`;
  const absPath = path.resolve(relPath);
  const fileUrl = pathToFileURL(absPath).href;
  const expectedBasename = path.basename(absPath);
  const expectedRel = path.relative(process.cwd(), absPath);

  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  await page.goto(HARNESS_PATH);
  await expect(page.getByTestId("admin-ttl-server-error-harness"))
    .toHaveAttribute("data-ready", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  let thrown: unknown;
  try {
    await waitForSliderThumbFocused(
      page,
      "intentional failure: thumb is not focused (asserting basename pathStyle)",
      { screenshotPath: relPath, pathStyle: "basename" },
    );
  } catch (err) {
    thrown = err;
  }

  expect(thrown).toBeInstanceOf(Error);
  const msg = (thrown as Error).message;

  // (1) header carries only the basename — no directory, no file:// URL.
  expect(
    msg.startsWith(`[screenshot: ${expectedBasename}]`),
    `expected message to start with [screenshot: ${expectedBasename}], got:\n${msg}`,
  ).toBe(true);
  expect(expectedBasename).not.toContain("/");
  expect(expectedBasename).not.toContain(path.sep);

  // (2) header MUST NOT contain any of the noisier path forms.
  const header = msg.split("\n", 1)[0];
  expect(header).not.toContain(fileUrl);
  expect(header).not.toContain(absPath);
  // Guard against the relative-style form leaking into the header. The
  // relative path includes a directory segment (e.g. `test-results/…`),
  // so its presence in the basename header would mean pathStyle was
  // ignored. (Skip if expectedRel happens to equal the basename, which
  // can only occur for a file written directly into cwd.)
  if (expectedRel !== expectedBasename) {
    expect(header).not.toContain(expectedRel);
  }

  // (3) inline body 'screenshot:' line uses the basename too, and omits
  //     the parenthesized (file://…) annotation that absolute adds.
  expect(msg).toContain(`screenshot: saved → ${expectedBasename}`);
  expect(msg).not.toContain(`(${fileUrl})`);

  // (4) the file itself was still written to its absolute on-disk path —
  //     the shortened display form must not affect what's saved.
  expect(fs.existsSync(absPath)).toBe(true);
  expect(fs.statSync(absPath).size).toBeGreaterThan(0);

  fs.unlinkSync(absPath);
});
