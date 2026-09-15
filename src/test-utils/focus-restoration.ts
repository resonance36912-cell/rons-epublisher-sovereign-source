// Shared focus-restoration assertion helper for the admin TTL section
// tests (and any future section test with the same focus contract).
//
// The contract under test is twofold and easy to get wrong piecemeal:
//
//   1. document.activeElement must equal the expected element — proves
//      focus actually landed where the dismiss handler intended.
//   2. The expected element must still be connected to the live DOM —
//      proves we didn't focus a detached node that React has already
//      replaced (which would silently move keyboard focus to <body>).
//
// Both halves are required: a detached element can still satisfy (1) in
// some engines for one tick before the browser blurs it, and a stale
// pointer that *passes* (1) but fails (2) is the worst kind of false
// positive — the test goes green but real users land on <body>.
//
// This helper bundles both assertions plus a precise failure message
// so the regression is obvious in CI output.
import { expect } from "vitest";

export type FocusRestorationOptions = {
  /** Free-form label for failure messages (e.g. "lang=af/origin=slider-thumb"). */
  scope?: string;
  /**
   * Additional checks to fold into the assertion when the focused
   * element is expected to be a specific kind of node (e.g. INPUT).
   */
  expectedTagName?: string;
  /**
   * If true, also assert that the element is visible-ish — i.e. has
   * non-empty bounding rects. Off by default because jsdom doesn't
   * compute layout and would always fail.
   */
  requireVisible?: boolean;
};

/**
 * Assert focus was restored to `expected` AND that `expected` is still
 * connected to the live DOM (so screen readers / keyboard users will
 * actually land on it).
 */
export function assertFocusRestoredTo(
  expected: Element | null | undefined,
  opts: FocusRestorationOptions = {},
): void {
  const tag = opts.scope ? `[${opts.scope}] ` : "";

  // Pre-check: caller provided a real element.
  expect(expected, `${tag}expected focus target is null/undefined`).toBeTruthy();
  const el = expected as HTMLElement;

  // (1) The element is still in the live document. A detached node
  //     would silently fail focus in real browsers — pin it explicitly
  //     so the failure mode is loud, not silent.
  expect(
    el.isConnected,
    `${tag}focus target is detached from the DOM (tag=${el.tagName}, id=${el.id || "<none>"})`,
  ).toBe(true);

  // (2) document.activeElement is the expected element.
  const active = document.activeElement as HTMLElement | null;
  const activeDescriptor = active
    ? `${active.tagName}${active.id ? `#${active.id}` : ""}${
        active.getAttribute?.("aria-label")
          ? `[aria-label="${active.getAttribute("aria-label")}"]`
          : ""
      }`
    : "<none>";
  expect(
    active,
    `${tag}focus not restored: active=${activeDescriptor}, expected=${el.tagName}${
      el.id ? `#${el.id}` : ""
    }`,
  ).toBe(el);

  // (3) Optional: tag check (catches "we landed on a wrapper that
  //     shares the id" regressions when the expected element is a
  //     specific node kind like INPUT).
  if (opts.expectedTagName) {
    expect(
      el.tagName,
      `${tag}focus target has wrong tagName (got ${el.tagName}, expected ${opts.expectedTagName})`,
    ).toBe(opts.expectedTagName);
  }

  // (4) Optional: visibility check via bounding rects. jsdom returns
  //     all-zero rects so this is opt-in for real-browser tests only.
  if (opts.requireVisible) {
    const rect = el.getBoundingClientRect();
    expect(
      rect.width > 0 && rect.height > 0,
      `${tag}focus target has zero size (rect=${rect.width}x${rect.height})`,
    ).toBe(true);
  }
}

/**
 * Convenience wrapper for the common case: focus must be on the TTL
 * number input (`#ttl-seconds`) and that input must be a real
 * connected `<input>` element.
 */
export function assertTtlInputFocused(scope?: string): void {
  const input = document.getElementById("ttl-seconds");
  assertFocusRestoredTo(input, { scope, expectedTagName: "INPUT" });
}
