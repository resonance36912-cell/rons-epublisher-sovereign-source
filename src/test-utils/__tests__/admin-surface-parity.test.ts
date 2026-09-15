// Self-tests for the shared admin surface-parity helpers.
//
// These are unit tests for the test utility itself — they pin the
// contract that other tests rely on. Of particular importance: the
// negative case below proves that `assertSurfaceParity` fails LOUDLY
// (with a structured per-section diff, not a "not contained" mush) when
// a real drift is introduced. If this test ever passes silently, every
// downstream drift guard is silently broken too.
import { describe, it, expect } from "vitest";
import {
  assertSurfaceParity,
  EN_LABELS,
  parsePanelSections,
  parseToastSections,
  TOAST_JOINER,
} from "../admin-surface-parity";

/**
 * Build a panel <div> matching the shape AdminSignedUrlTtlSection renders:
 *   <p class="font-medium">{header}</p>      ← chrome, skipped by parser
 *   <p>{message}</p>
 *   <p><span class="font-semibold">{hintLabel}</span> {hint}</p>
 *   <p><span class="font-semibold">{detailsLabel}</span> {details}</p>
 *   <p>{codeLabel} {code}</p>
 *
 * `order` controls the runtime order of the HINT and DETAILS rows so we
 * can construct an intentionally swapped panel without changing the
 * component.
 */
function buildPanel(opts: {
  message: string;
  hint: string;
  details: string;
  code: string;
  order: "hint-details" | "details-hint";
  labels?: { hint: string; details: string; code: string };
}): HTMLElement {
  const labels = opts.labels ?? EN_LABELS;
  const panel = document.createElement("div");
  panel.innerHTML = `
    <p class="font-medium">Server rejected the value</p>
    <p>${opts.message}</p>
  `;
  const hintP = document.createElement("p");
  hintP.innerHTML = `<span class="font-semibold">${labels.hint}</span> ${opts.hint}`;
  const detP = document.createElement("p");
  detP.innerHTML = `<span class="font-semibold">${labels.details}</span> ${opts.details}`;
  if (opts.order === "hint-details") {
    panel.appendChild(hintP);
    panel.appendChild(detP);
  } else {
    panel.appendChild(detP);
    panel.appendChild(hintP);
  }
  const codeP = document.createElement("p");
  codeP.textContent = `${labels.code} ${opts.code}`;
  panel.appendChild(codeP);
  return panel;
}

const FIXTURE = {
  message: "signed_url_ttl_seconds out of range (got 30)",
  hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
  details: "Failing row contains (signed_url_ttl_seconds, 30).",
  code: "23514",
};

describe("admin-surface-parity helpers", () => {
  // ── Sanity: parsers + parity pass for a well-formed pair ────────────
  it("passes parity when the toast and panel render the same sections in order", () => {
    const panel = buildPanel({ ...FIXTURE, order: "hint-details" });
    const toast = [
      FIXTURE.message,
      `${EN_LABELS.hint} ${FIXTURE.hint}`,
      `${EN_LABELS.details} ${FIXTURE.details}`,
      `${EN_LABELS.code} ${FIXTURE.code}`,
    ].join(TOAST_JOINER);

    const { panelSections, toastSections } = assertSurfaceParity(toast, panel);
    expect(panelSections.map((s) => s.label)).toEqual([
      "MESSAGE", "HINT", "DETAILS", "SQLSTATE",
    ]);
    expect(toastSections).toEqual(panelSections);
  });

  // ── Negative: HINT and DETAILS swapped between surfaces ─────────────
  // The toast keeps the canonical MESSAGE → HINT → DETAILS → SQLSTATE
  // order; the panel renders DETAILS before HINT. assertSurfaceParity
  // MUST fail, and the failure MUST be a structured per-section diff
  // (not a vague "string does not contain") so the offending section is
  // pinpointed in CI output.
  it("FAILS with a structured per-section diff when Hint and Details are swapped in the panel", () => {
    const swappedPanel = buildPanel({ ...FIXTURE, order: "details-hint" });
    const correctToast = [
      FIXTURE.message,
      `${EN_LABELS.hint} ${FIXTURE.hint}`,
      `${EN_LABELS.details} ${FIXTURE.details}`,
      `${EN_LABELS.code} ${FIXTURE.code}`,
    ].join(TOAST_JOINER);

    // First, sanity-check that the parsers themselves see the swap —
    // otherwise a green parity check wouldn't actually be checking order.
    const panelSections = parsePanelSections(swappedPanel);
    const toastSections = parseToastSections(correctToast);
    expect(panelSections.map((s) => s.label)).toEqual([
      "MESSAGE", "DETAILS", "HINT", "SQLSTATE",
    ]);
    expect(toastSections.map((s) => s.label)).toEqual([
      "MESSAGE", "HINT", "DETAILS", "SQLSTATE",
    ]);

    // Now the actual contract: assertSurfaceParity throws.
    let caught: Error | null = null;
    try {
      assertSurfaceParity(correctToast, swappedPanel);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught, "assertSurfaceParity must throw on Hint/Details swap").not.toBeNull();

    // The thrown AssertionError carries `.actual` (toast-parsed) and
    // `.expected` (panel-parsed) arrays — that IS the structured diff
    // (vitest's reporter prints them as a per-section deep-equal diff).
    // Pin the shape so a future "throw a plain Error" regression breaks
    // this test instead of silently degrading CI output.
    const err = caught as Error & { actual?: unknown; expected?: unknown };
    expect(err.actual, "actual = toast sections").toEqual([
      { label: "MESSAGE", body: FIXTURE.message },
      { label: "HINT", body: FIXTURE.hint },
      { label: "DETAILS", body: FIXTURE.details },
      { label: "SQLSTATE", body: FIXTURE.code },
    ]);
    expect(err.expected, "expected = panel sections (swapped)").toEqual([
      { label: "MESSAGE", body: FIXTURE.message },
      { label: "DETAILS", body: FIXTURE.details },
      { label: "HINT", body: FIXTURE.hint },
      { label: "SQLSTATE", body: FIXTURE.code },
    ]);
  });

  // ── Negative: HINT and DETAILS swapped in the TOAST instead ─────────
  // Symmetric to the above — drift can originate from either surface,
  // and parity must catch it from either direction.
  it("FAILS with a structured per-section diff when Hint and Details are swapped in the toast", () => {
    const correctPanel = buildPanel({ ...FIXTURE, order: "hint-details" });
    const swappedToast = [
      FIXTURE.message,
      `${EN_LABELS.details} ${FIXTURE.details}`,
      `${EN_LABELS.hint} ${FIXTURE.hint}`,
      `${EN_LABELS.code} ${FIXTURE.code}`,
    ].join(TOAST_JOINER);

    let caught: Error | null = null;
    try {
      assertSurfaceParity(swappedToast, correctPanel);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught, "assertSurfaceParity must throw on toast-side swap").not.toBeNull();
    const err = caught as Error & { actual?: unknown; expected?: unknown };
    expect(err.actual, "actual = toast sections (swapped)").toEqual([
      { label: "MESSAGE", body: FIXTURE.message },
      { label: "DETAILS", body: FIXTURE.details },
      { label: "HINT", body: FIXTURE.hint },
      { label: "SQLSTATE", body: FIXTURE.code },
    ]);
    expect(err.expected, "expected = panel sections (canonical)").toEqual([
      { label: "MESSAGE", body: FIXTURE.message },
      { label: "HINT", body: FIXTURE.hint },
      { label: "DETAILS", body: FIXTURE.details },
      { label: "SQLSTATE", body: FIXTURE.code },
    ]);
  });
});
