import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SLIDER_SELECTOR,
  SLIDER_ARIA_LABEL,
  ACTIVE_OUTER_HTML_MAX_LEN,
  serializeActiveElement,
  serializeActiveElementOuterHtml,
  formatSliderThumbFocusFailure,
  formatScreenshotPath,
} from "../slider-thumb-focus";

describe("serializeActiveElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the '<body> (no specific element focused)' sentinel when focus is on body", () => {
    document.body.focus();
    expect(serializeActiveElement(document)).toBe(
      "<body> (no specific element focused)",
    );
  });

  it("serializes a fully-attributed focused element in a stable, ordered format", () => {
    const btn = document.createElement("button");
    btn.id = "dismiss";
    btn.className = "icon-btn primary";
    btn.setAttribute("aria-label", "Dismiss server error");
    btn.setAttribute("role", "button");
    btn.setAttribute("name", "dismiss-btn");
    btn.setAttribute("type", "button");
    btn.setAttribute("data-testid", "dismiss-server-error");
    document.body.appendChild(btn);
    btn.focus();

    expect(serializeActiveElement(document)).toBe(
      '<button> #dismiss .icon-btn.primary aria-label="Dismiss server error" ' +
        'role="button" name="dismiss-btn" type="button" ' +
        'data-testid="dismiss-server-error" connected=true',
    );
  });

  it("omits absent attributes and class segments cleanly", () => {
    const div = document.createElement("div");
    div.tabIndex = 0;
    div.setAttribute("aria-label", SLIDER_ARIA_LABEL);
    document.body.appendChild(div);
    div.focus();

    expect(serializeActiveElement(document)).toBe(
      `<div> aria-label="${SLIDER_ARIA_LABEL}" connected=true`,
    );
  });

  it("reports connected=false for a detached focused element", () => {
    const input = document.createElement("input");
    input.id = "ghost";
    input.tabIndex = 0;
    document.body.appendChild(input);
    input.focus();
    input.remove();

    const out = serializeActiveElement(document);
    // The detached element may or may not remain activeElement in jsdom;
    // assert only the connectedness sentinel is one of the two valid
    // serializations the helper can emit here.
    expect(out === "<body> (no specific element focused)" || /connected=false/.test(out)).toBe(true);
  });
});

describe("serializeActiveElementOuterHtml", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the '<none>' sentinel when focus is on body", () => {
    document.body.focus();
    expect(serializeActiveElementOuterHtml(document)).toBe("<none>");
  });

  it("collapses whitespace inside outerHTML to a single line", () => {
    const btn = document.createElement("button");
    btn.id = "x";
    btn.innerHTML = "  hello\n  world  ";
    document.body.appendChild(btn);
    btn.focus();
    expect(serializeActiveElementOuterHtml(document)).toBe(
      '<button id="x"> hello world </button>',
    );
  });

  it("returns short outerHTML untruncated", () => {
    const input = document.createElement("input");
    input.id = "ttl";
    input.type = "number";
    document.body.appendChild(input);
    input.focus();
    const out = serializeActiveElementOuterHtml(document);
    expect(out).toMatch(/^<input[^>]*id="ttl"[^>]*>$/);
    expect(out).not.toMatch(/truncated/);
  });

  it("truncates long outerHTML with a length-annotated suffix", () => {
    const div = document.createElement("div");
    div.tabIndex = 0;
    div.setAttribute("data-blob", "x".repeat(500));
    document.body.appendChild(div);
    div.focus();
    const out = serializeActiveElementOuterHtml(document, 64);
    expect(out.length).toBeGreaterThan(64);
    expect(out.startsWith("<div")).toBe(true);
    expect(out).toMatch(/… \(truncated, \d+ chars total\)$/);
  });

  it("uses the documented default cap when no maxLen is supplied", () => {
    const div = document.createElement("div");
    div.tabIndex = 0;
    div.setAttribute("data-blob", "y".repeat(ACTIVE_OUTER_HTML_MAX_LEN + 100));
    document.body.appendChild(div);
    div.focus();
    const out = serializeActiveElementOuterHtml(document);
    expect(out).toMatch(/… \(truncated, \d+ chars total\)$/);
  });
});

describe("formatSliderThumbFocusFailure", () => {
  it("produces a stable 7-line failure description with selector, aria-label, active element, and outerHTML", () => {
    const out = formatSliderThumbFocusFailure(
      "[fr] slider thumb focused before Save",
      '<input> #ttl-seconds type="number" connected=true',
      '<input id="ttl-seconds" type="number">',
    );
    expect(out.split("\n")).toEqual([
      "[fr] slider thumb focused before Save",
      "  expected focus on slider thumb",
      `    selector:   ${SLIDER_SELECTOR}`,
      `    aria-label: "${SLIDER_ARIA_LABEL}"`,
      "  actual document.activeElement:",
      '    <input> #ttl-seconds type="number" connected=true',
      '    outerHTML: <input id="ttl-seconds" type="number">',
    ]);
  });

  it("defaults the outerHTML line to '<none>' when omitted", () => {
    const out = formatSliderThumbFocusFailure(
      "ctx",
      "<body> (no specific element focused)",
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[6]).toBe("    outerHTML: <none>");
  });

  it("preserves an empty context line without collapsing the layout", () => {
    const out = formatSliderThumbFocusFailure(
      "",
      "<body> (no specific element focused)",
      "<none>",
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("");
    expect(lines[2]).toBe(`    selector:   ${SLIDER_SELECTOR}`);
    expect(lines[5]).toBe("    <body> (no specific element focused)");
    expect(lines[6]).toBe("    outerHTML: <none>");
  });

  it("does not interpolate or trim user-supplied strings", () => {
    const ctx = "  [af] padded context  ";
    const active = '  <div> spaced  connected=true  ';
    const outer = "  <div>raw</div>  ";
    const out = formatSliderThumbFocusFailure(ctx, active, outer);
    expect(out.startsWith(ctx + "\n")).toBe(true);
    expect(out.endsWith("    outerHTML: " + outer)).toBe(true);
  });

  it("omits the screenshot line entirely when no screenshot string is supplied", () => {
    const out = formatSliderThumbFocusFailure("ctx", "<body>", "<none>");
    expect(out.split("\n")).toHaveLength(7);
    expect(out).not.toMatch(/screenshot:/);
  });

  it("appends a 'screenshot:' line verbatim when a saved-path string is supplied", () => {
    const out = formatSliderThumbFocusFailure(
      "ctx",
      "<body>",
      "<none>",
      "saved → test-results/slider-thumb-focus-failure-2026-05-19T07-42-00.png",
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe(
      "    screenshot: saved → test-results/slider-thumb-focus-failure-2026-05-19T07-42-00.png",
    );
  });

  it("appends a 'screenshot:' failure line when capture didn't succeed", () => {
    const out = formatSliderThumbFocusFailure(
      "ctx",
      "<body>",
      "<none>",
      "failed: page closed",
    );
    expect(out.endsWith("    screenshot: failed: page closed")).toBe(true);
  });

  it("renders an empty screenshot string as a present-but-empty line (explicit opt-in)", () => {
    const out = formatSliderThumbFocusFailure("ctx", "<body>", "<none>", "");
    const lines = out.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe("    screenshot: ");
  });
});

describe("formatScreenshotPath", () => {
  const CWD = "/home/runner/work/app";

  it("defaults to 'absolute' style and returns the input unchanged", () => {
    const abs = "/home/runner/work/app/test-results/foo.png";
    expect(formatScreenshotPath(abs)).toBe(abs);
    expect(formatScreenshotPath(abs, "absolute", CWD)).toBe(abs);
  });

  it("returns only the file name for 'basename' style", () => {
    expect(
      formatScreenshotPath(
        "/home/runner/work/app/test-results/nested/dir/foo.png",
        "basename",
        CWD,
      ),
    ).toBe("foo.png");
  });

  it("returns just the input when 'basename' is given a bare filename", () => {
    expect(formatScreenshotPath("foo.png", "basename", CWD)).toBe("foo.png");
  });

  it("handles Windows-style separators for 'basename'", () => {
    expect(
      formatScreenshotPath(
        "C:\\Users\\runner\\app\\test-results\\foo.png",
        "basename",
        "C:\\Users\\runner\\app",
      ),
    ).toBe("foo.png");
  });

  it("returns a cwd-relative form for 'relative' when the path is inside cwd", () => {
    expect(
      formatScreenshotPath(
        "/home/runner/work/app/test-results/foo.png",
        "relative",
        CWD,
      ),
    ).toBe("test-results/foo.png");
  });

  it("tolerates a trailing slash on cwd for 'relative'", () => {
    expect(
      formatScreenshotPath(
        "/home/runner/work/app/test-results/foo.png",
        "relative",
        "/home/runner/work/app/",
      ),
    ).toBe("test-results/foo.png");
  });

  it("returns '.' for 'relative' when absPath equals cwd", () => {
    expect(formatScreenshotPath(CWD, "relative", CWD)).toBe(".");
  });

  it("falls back to the absolute form for 'relative' when path is outside cwd", () => {
    const outside = "/var/lib/other-project/foo.png";
    expect(formatScreenshotPath(outside, "relative", CWD)).toBe(outside);
  });

  it("does not produce a 'sibling-prefix' false positive (cwd substring, not parent dir)", () => {
    // Path starts with the cwd string but is not actually inside it
    // (the next char isn't a separator). Must NOT be treated as
    // relative — otherwise we'd emit a path with a leading dash/letter
    // that doesn't actually resolve.
    const sibling = "/home/runner/work/app-other/foo.png";
    expect(formatScreenshotPath(sibling, "relative", CWD)).toBe(sibling);
  });

  it("handles Windows-style separators for 'relative'", () => {
    expect(
      formatScreenshotPath(
        "C:\\Users\\runner\\app\\test-results\\foo.png",
        "relative",
        "C:\\Users\\runner\\app",
      ),
    ).toBe("test-results\\foo.png");
  });

  it("treats explicit 'absolute' style as a no-op even when path is inside cwd", () => {
    const abs = "/home/runner/work/app/test-results/foo.png";
    expect(formatScreenshotPath(abs, "absolute", CWD)).toBe(abs);
  });
});
