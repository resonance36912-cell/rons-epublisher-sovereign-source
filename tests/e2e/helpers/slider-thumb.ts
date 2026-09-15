import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "../playwright-fixture";
import {
  SLIDER_SELECTOR,
  SLIDER_ARIA_LABEL,
  serializeActiveElement,
  serializeActiveElementOuterHtml,
  formatSliderThumbFocusFailure,
  formatScreenshotPath,
  type ScreenshotPathStyle,
  type SliderFocusFailureOptions,
} from "@/test-utils/slider-thumb-focus";

export { formatScreenshotPath };
export type { ScreenshotPathStyle, SliderFocusFailureOptions };

export { SLIDER_SELECTOR, SLIDER_ARIA_LABEL };

export async function focusSliderThumb(page: Page) {
  // Synchronous .focus({preventScroll:true}) on the page thread sidesteps
  // Radix's pointer/blur handlers that can swallow click-initiated focus.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`slider thumb not found for ${sel}`);
    if (el.tabIndex < 0) el.tabIndex = 0;
    el.focus({ preventScroll: true });
  }, SLIDER_SELECTOR);
}

export async function isSliderThumbFocused(page: Page): Promise<boolean> {
  return page.evaluate(
    (sel) => document.querySelector(sel) === document.activeElement,
    SLIDER_SELECTOR,
  );
}

/**
 * Serialize document.activeElement into a stable, debuggable string —
 * delegates to the pure `serializeActiveElement` helper so the same
 * format is reused (and unit-tested) outside Playwright.
 */
export async function describeActiveElement(page: Page): Promise<string> {
  // Pass the pure function's source across the page bridge.
  const source = `(${serializeActiveElement.toString()})(document)`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(source as any) as Promise<string>;
}

/**
 * Return a truncated, single-line outerHTML snapshot of the page's
 * current document.activeElement — delegates to the pure helper so the
 * truncation/whitespace contract is shared with unit tests.
 */
export async function describeActiveElementOuterHtml(page: Page): Promise<string> {
  const source = `(${serializeActiveElementOuterHtml.toString()})(document)`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(source as any) as Promise<string>;
}

// `SliderFocusFailureOptions` is re-exported above from the pure
// `@/test-utils/slider-thumb-focus` module so the same typings are
// available to package consumers via the `src/test-utils` entrypoint
// without dragging Playwright in.

// `formatScreenshotPath` is re-exported above from the pure
// `@/test-utils/slider-thumb-focus` module so it can be unit-tested
// without pulling Playwright into the vitest environment.



/**
 * Slugify an arbitrary string for safe inclusion in a filename:
 * lowercases, collapses non-[a-z0-9] runs to a single dash, trims
 * leading/trailing dashes, and caps total length so we don't blow
 * past filesystem name limits on CI.
 */
export function slugifyForFilename(input: string, maxLen = 60): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "unnamed").slice(0, maxLen).replace(/-+$/g, "");
}

/**
 * Build a predictable screenshot path under `test-results/` that
 * embeds the current Playwright test title (when available) and the
 * caller-supplied assertion context, so screenshots from different
 * specs / assertions in the same CI run don't collide and can be
 * grepped by test name.
 *
 * Format: `test-results/slider-thumb-focus-failure-{test}-{context}-{stamp}.png`
 * When no test title is available (e.g. helper invoked outside a
 * Playwright test) the `{test}-` segment is omitted.
 */
export function autoScreenshotPath(context?: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let testSlug = "";
  try {
    const title = test.info().title;
    if (title) testSlug = `${slugifyForFilename(title)}-`;
  } catch {
    // Outside of a running test (e.g. unit-test bridge) — skip.
  }
  const ctxSlug = context ? `${slugifyForFilename(context)}-` : "";
  return `test-results/slider-thumb-focus-failure-${testSlug}${ctxSlug}${stamp}.png`;
}

export async function captureFailureScreenshot(
  page: Page,
  opts: SliderFocusFailureOptions | undefined,
  context?: string,
): Promise<{ line: string; absPath: string; displayPath: string } | undefined> {
  if (!opts || !opts.screenshotPath) return undefined;
  const rel =
    opts.screenshotPath === true ? autoScreenshotPath(context) : opts.screenshotPath;
  const absPath = path.resolve(rel);
  try {
    const mask = opts.maskSelectors?.length
      ? opts.maskSelectors.map((sel) => page.locator(sel))
      : undefined;
    await page.screenshot({
      path: absPath,
      fullPage: !!opts.fullPage,
      ...(mask ? { mask } : {}),
      ...(opts.maskColor ? { maskColor: opts.maskColor } : {}),
    });
    const url = pathToFileURL(absPath).href;
    const displayPath = formatScreenshotPath(absPath, opts.pathStyle);
    const maskNote = mask ? ` (masked: ${opts.maskSelectors!.join(", ")})` : "";

    // Attach to the current Playwright test so the screenshot appears
    // as a downloadable artifact in the HTML report / CI run, not just
    // as a file:// link in the failure message. Best-effort: if we're
    // outside an active test (e.g. helper used from a fixture teardown
    // or a unit-test bridge), skip silently.
    let attachedNote = "";
    try {
      const info = test.info();
      const attachmentName = context
        ? `slider-thumb-focus-failure — ${context}`
        : "slider-thumb-focus-failure";
      await info.attach(attachmentName, {
        path: absPath,
        contentType: "image/png",
      });
      attachedNote = " [attached to test report]";
    } catch {
      // No active test → no attachment, just the file:// link.
    }

    // Only inline the `(file://…)` segment when the displayed path is
    // *not* already the absolute path — otherwise it just doubles the
    // length of the line, defeating the point of pathStyle: "basename".
    const urlNote = displayPath === absPath ? ` (${url})` : "";

    return {
      line: `saved → ${displayPath}${urlNote}${maskNote}${attachedNote}`,
      absPath,
      displayPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      line: `failed: ${msg}`,
      absPath,
      displayPath: formatScreenshotPath(absPath, opts.pathStyle),
    };
  }
}

/**
 * Build a verbose focus-assertion failure description that includes
 * the expected selector + aria-label of the slider thumb, a serialized
 * snapshot of the current document.activeElement, and a truncated
 * outerHTML so the actual focused node is inspectable in CI logs.
 *
 * Pass `options.screenshotPath` to additionally capture a screenshot
 * of the page at failure time and append its path to the description.
 */
export async function describeSliderThumbFocusFailure(
  page: Page,
  context: string,
  options?: SliderFocusFailureOptions,
): Promise<string> {
  const [active, outer, screenshot] = await Promise.all([
    describeActiveElement(page),
    describeActiveElementOuterHtml(page),
    captureFailureScreenshot(page, options, context),
  ]);
  return formatSliderThumbFocusFailure(context, active, outer, screenshot?.line);
}

/**
 * Poll until the slider thumb becomes `document.activeElement`. On
 * timeout, throws an `Error` whose message is shaped as:
 *
 * ```
 * [screenshot: <path>] <context>\n  active: …\n  outerHTML: …\n  screenshot: saved → <path> …
 * ```
 *
 * The leading `[screenshot: <path>]` header is prepended so the path
 * survives CI log-line truncation. The form of `<path>` is controlled
 * by `options.pathStyle` (see {@link SliderFocusFailureOptions.pathStyle}):
 *
 * - `"absolute"` (default) → header uses a clickable `file://…` URL
 *   built from the absolute path; the inline body line also appends
 *   `(file://…)`.
 * - `"relative"` → header and inline body both use the cwd-relative
 *   path (falling back to absolute when outside cwd); no `file://…`
 *   annotation is appended.
 * - `"basename"` → header and inline body show only the filename; no
 *   `file://…` annotation is appended.
 *
 * Regardless of `pathStyle`, the PNG is written to its absolute path
 * on disk and (when running inside a Playwright test) attached to the
 * HTML report via `test.info().attach(...)`, so it is always
 * downloadable from the CI run.
 *
 * @example
 * ```ts
 * // 1. Default — "absolute": header carries the clickable file:// URL.
 * await waitForSliderThumbFocused(page, "after Tab", {
 *   screenshotPath: true,
 * });
 * // throws: Error: [screenshot: file:///repo/test-results/foo.png] after Tab
 * //   …
 * //   screenshot: saved → /repo/test-results/foo.png (file:///repo/test-results/foo.png) [attached to test report]
 *
 * // 2. "relative" — short header, still grep-friendly from repo root.
 * await waitForSliderThumbFocused(page, "after Tab", {
 *   screenshotPath: true,
 *   pathStyle: "relative",
 * });
 * // throws: Error: [screenshot: test-results/foo.png] after Tab
 * //   …
 * //   screenshot: saved → test-results/foo.png [attached to test report]
 *
 * // 3. "basename" — shortest header; PNG still on disk + in HTML report.
 * await waitForSliderThumbFocused(page, "after Tab", {
 *   screenshotPath: true,
 *   pathStyle: "basename",
 * });
 * // throws: Error: [screenshot: foo.png] after Tab
 * //   …
 * //   screenshot: saved → foo.png [attached to test report]
 * // → Open the file via the Playwright HTML report attachment named
 * //   "slider-thumb-focus-failure — after Tab"; the basename in the
 * //   log line is enough to locate it under test-results/.
 * ```
 */
export async function waitForSliderThumbFocused(
  page: Page,
  context = "slider thumb did not become focused within 2s",
  options?: SliderFocusFailureOptions,
): Promise<void> {
  try {
    await expect
      .poll(() => isSliderThumbFocused(page), {
        timeout: 2000,
        intervals: [100, 200, 400],
      })
      .toBe(true);
  } catch (err) {
    // Re-capture explicitly so we can hoist the screenshot path into
    // the *first* line of the thrown error message — Playwright's CI
    // log viewer truncates long messages, and burying the file:// URL
    // 7 lines deep makes it easy to miss.
    const [active, outer, screenshot] = await Promise.all([
      describeActiveElement(page),
      describeActiveElementOuterHtml(page),
      captureFailureScreenshot(page, options, context),
    ]);
    const body = formatSliderThumbFocusFailure(
      context,
      active,
      outer,
      screenshot?.line,
    );
    // For the default absolute style we keep the clickable file:// URL
    // form in the header; shortened styles use the styled string as-is
    // (their whole point is to be short).
    const headerPath =
      !options?.pathStyle || options.pathStyle === "absolute"
        ? pathToFileURL(screenshot?.absPath ?? "").href
        : (screenshot?.displayPath ?? "");
    const header = screenshot?.absPath ? `[screenshot: ${headerPath}] ` : "";
    throw new Error(`${header}${body}`, { cause: err as Error });
  }
}
