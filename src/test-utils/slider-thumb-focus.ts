/**
 * Pure, DOM-only helpers used by the e2e slider-thumb helper. Extracted
 * into a standalone module (no playwright imports) so they can be
 * unit-tested directly under vitest+jsdom.
 */

export const SLIDER_SELECTOR = '[aria-label="Signed URL TTL in seconds"]';
export const SLIDER_ARIA_LABEL = "Signed URL TTL in seconds";

/**
 * Serialize a document's activeElement into a stable, debuggable string
 * including tag, id, classes, aria-label, role, name, type, data-testid,
 * and connectedness — so focus-assertion failures point at *what* was
 * actually focused instead of the expected target.
 */
export function serializeActiveElement(doc: Document): string {
  const ae = doc.activeElement as HTMLElement | null;
  if (!ae || ae === doc.body) {
    return `<${ae?.tagName?.toLowerCase() ?? "none"}> (no specific element focused)`;
  }
  const attr = (n: string) => {
    const v = ae.getAttribute(n);
    return v != null ? `${n}="${v}"` : null;
  };
  const parts = [
    `<${ae.tagName.toLowerCase()}>`,
    ae.id ? `#${ae.id}` : null,
    ae.classList.length ? `.${Array.from(ae.classList).join(".")}` : null,
    attr("aria-label"),
    attr("role"),
    attr("name"),
    attr("type"),
    attr("data-testid"),
    `connected=${ae.isConnected}`,
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Default cap (in characters) for the inlined outerHTML snippet.
 * Long Radix subtrees with inline styles can be several KB; trimming
 * keeps the failure output greppable without losing the useful prefix.
 */
export const ACTIVE_OUTER_HTML_MAX_LEN = 240;

/**
 * Return a truncated outerHTML snapshot of doc.activeElement, collapsing
 * runs of whitespace so the snippet renders on a single line. Returns
 * the "<none>" sentinel when focus is on body / no element.
 */
export function serializeActiveElementOuterHtml(
  doc: Document,
  maxLen: number = ACTIVE_OUTER_HTML_MAX_LEN,
): string {
  const ae = doc.activeElement as HTMLElement | null;
  if (!ae || ae === doc.body) return "<none>";
  const raw = (ae.outerHTML ?? "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}… (truncated, ${raw.length} chars total)`;
}

/**
 * Format the multi-line failure description shown when the slider thumb
 * is expected to be focused but isn't.
 *
 * When a `screenshot` line is supplied (e.g. `"saved → /path/to.png"` or
 * `"failed: <reason>"`), it's appended as an extra final line so CI logs
 * can point operators at the captured page state.
 */
export function formatSliderThumbFocusFailure(
  context: string,
  activeDescription: string,
  activeOuterHtml: string = "<none>",
  screenshot?: string,
): string {
  const lines = [
    `${context}`,
    `  expected focus on slider thumb`,
    `    selector:   ${SLIDER_SELECTOR}`,
    `    aria-label: "${SLIDER_ARIA_LABEL}"`,
    `  actual document.activeElement:`,
    `    ${activeDescription}`,
    `    outerHTML: ${activeOuterHtml}`,
  ];
  if (screenshot !== undefined) {
    lines.push(`    screenshot: ${screenshot}`);
  }
  return lines.join("\n");
}

/**
 * Style for rendering a screenshot path in a focus-failure message.
 *
 * Only affects the **text** of the rendered path in error messages /
 * log lines — the screenshot file itself is always written to its
 * resolved absolute path on disk, and (in Playwright tests) attached
 * to the HTML report as a downloadable artifact regardless of style.
 *
 * - `"absolute"` — full absolute path. Callers that render a header
 *   typically also wrap this in a `file://…` URL so terminals linkify
 *   it.
 * - `"relative"` — path relative to `process.cwd()` when inside it;
 *   falls back to the absolute form otherwise. Short and grep-friendly.
 * - `"basename"` — just the filename. Shortest; the absolute path
 *   stays discoverable via the attached report artifact.
 */
export type ScreenshotPathStyle = "absolute" | "relative" | "basename";

/**
 * Posix-style basename: returns the segment after the last `/` or `\`.
 * Mirrors `path.basename` for the subset relevant to screenshot paths
 * (no trailing-slash handling needed — files only).
 */
function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Render an absolute filesystem path according to a `style` preference.
 *
 * - `"basename"`  → just the file name (no directory).
 * - `"relative"`  → path relative to `cwd` when the file is inside it;
 *   falls back to the absolute form when the path is outside cwd, so
 *   the rendered string still resolves to a real file.
 * - `"absolute"`  → the input is returned unchanged.
 *
 * `cwd` is injectable so this function can be unit-tested without
 * mutating `process.cwd()`.
 */
export function formatScreenshotPath(
  absPath: string,
  style: ScreenshotPathStyle = "absolute",
  cwd: string = typeof process !== "undefined" ? process.cwd() : "/",
): string {
  if (style === "basename") return basenameOf(absPath);
  if (style === "relative") {
    // Normalize both ends so trailing slashes / different separators
    // don't break the prefix check.
    const normCwd = cwd.replace(/[\\/]+$/, "");
    const sep = absPath.includes("\\") && !absPath.includes("/") ? "\\" : "/";
    const cwdWithSep = normCwd + sep;
    if (absPath === normCwd) return ".";
    if (absPath.startsWith(cwdWithSep)) {
      return absPath.slice(cwdWithSep.length);
    }
    // Outside cwd → preserve absolute form so the link still resolves.
    return absPath;
  }
  return absPath;
}


/** Options for attaching a screenshot to a focus-failure description. */
export interface SliderFocusFailureOptions {
  /**
   * When set, a screenshot of the current page is captured at failure
   * time and its path is appended to the failure description.
   * - `true`           → auto-generate a path under `test-results/`.
   * - explicit string  → use that path verbatim (directory must exist or
   *   be creatable by Playwright).
   * - omitted/false    → no screenshot is captured.
   */
  screenshotPath?: string | true;
  /** Capture the full scrollable page rather than just the viewport. */
  fullPage?: boolean;
  /**
   * CSS selectors whose matching elements should be masked (overlaid
   * with a solid color box) in the screenshot before it's written to
   * disk — useful for hiding tokens, emails, signed URLs, or any other
   * PII/secret that might be visible on the page at failure time.
   * Each selector is resolved with `page.locator(sel)` and passed to
   * Playwright's `screenshot({ mask })` option.
   */
  maskSelectors?: string[];
  /**
   * CSS color for the mask overlay (defaults to Playwright's pink
   * `#FF00FF`). Use e.g. `"#000"` for a black redaction bar.
   */
  maskColor?: string;
  /**
   * How to render the screenshot path in the **thrown failure message**
   * (both the `[screenshot: …]` header and the inline
   * `screenshot: saved → …` body line).
   *
   * Only affects the rendered text of the error. The PNG itself is
   * always written to its resolved absolute path on disk and — when
   * running inside a Playwright test — attached to the HTML report via
   * `test.info().attach(...)` as a downloadable `image/png` artifact,
   * regardless of style. See {@link ScreenshotPathStyle} for variants.
   */
  pathStyle?: ScreenshotPathStyle;
}
