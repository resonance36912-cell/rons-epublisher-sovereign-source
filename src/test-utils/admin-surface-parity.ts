/**
 * Shared "surface parity" parser and assertion for admin sections that
 * surface a server error in TWO places: a toast `description` (string) and
 * an inline panel (DOM). Both surfaces must render the same sections, in
 * the same order, with identical bodies and localized labels.
 *
 * This module is the single source of truth for that contract. It was
 * extracted from src/pages/admin/sections/__tests__/AdminSignedUrlTtlSection.test.tsx
 * so other admin section tests (e.g. future TTL siblings, auth, storage)
 * can reuse the same parity helpers without duplicating regex logic.
 *
 * Contract assumed of the rendered output:
 *   - Toast description joins sections with TOAST_JOINER (" — ").
 *   - Panel renders one <p> per section.
 *     • HINT / DETAILS rows use <span class="font-semibold">{label}</span>.
 *     • SQLSTATE row is plain text "SQLSTATE {code}" (no font-semibold span).
 *     • Header row (admin.ttl.server.title) is marked with `font-medium`.
 *   - Labels are locale-aware via LabelSet (defaults to EN_LABELS).
 *
 * Usage:
 *   import { assertSurfaceParity, EN_LABELS, TOAST_JOINER } from "@/test-utils/admin-surface-parity";
 *   const { panelSections, toastSections } = assertSurfaceParity(toast, panelEl);
 */
import { expect } from "vitest";

export type SectionLabel = "MESSAGE" | "HINT" | "DETAILS" | "SQLSTATE";
export type Section = { label: SectionLabel; body: string };
export type LabelSet = { hint: string; details: string; code: string };

export const EN_LABELS: LabelSet = {
  hint: "Hint:",
  details: "Details:",
  code: "SQLSTATE",
};

/** Toast joiner is layout, not translation — stays " — " across locales. */
export const TOAST_JOINER = " — ";

/** Collapse runs of whitespace (incl. NBSP) and trim. */
export const normalize = (s: string): string =>
  s.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

/** Escape a literal string for safe inclusion in a RegExp. */
const reEscape = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Parse the inline server-error panel DOM into typed sections. Skips the
 * panel header (font-medium) since the toast has no equivalent chrome.
 */
export function parsePanelSections(
  panel: HTMLElement,
  labels: LabelSet = EN_LABELS,
): Section[] {
  const sections: Section[] = [];
  for (const p of Array.from(panel.querySelectorAll("p"))) {
    const text = normalize(p.textContent ?? "");
    if (!text) continue;
    // The header paragraph (only one with font-medium) is panel-only chrome.
    if (p.className.includes("font-medium")) continue;
    const labelEl = p.querySelector("span.font-semibold");
    if (labelEl) {
      const rawLabel = normalize(labelEl.textContent ?? "");
      const body = normalize(text.slice(rawLabel.length));
      if (rawLabel === labels.hint) sections.push({ label: "HINT", body });
      else if (rawLabel === labels.details) sections.push({ label: "DETAILS", body });
      else throw new Error(`Unrecognized panel label: ${rawLabel}`);
    } else {
      const codeRe = new RegExp(`^${reEscape(labels.code)}\\s+(\\S+)$`);
      const m = codeRe.exec(text);
      if (m) sections.push({ label: "SQLSTATE", body: m[1] });
      else sections.push({ label: "MESSAGE", body: text });
    }
  }
  return sections;
}

/**
 * Parse the toast description string into the same typed sections. The
 * toast format is: `MESSAGE — HINT_LABEL body — DETAILS_LABEL body — CODE_LABEL code`,
 * with missing sections (server returned no hint/details/code) omitted.
 */
export function parseToastSections(
  toast: string,
  labels: LabelSet = EN_LABELS,
): Section[] {
  const segments = toast.split(TOAST_JOINER).map((s) => s.trim()).filter(Boolean);
  const hintRe = new RegExp(`^${reEscape(labels.hint)}\\s+`);
  const detRe = new RegExp(`^${reEscape(labels.details)}\\s+`);
  const codeRe = new RegExp(`^${reEscape(labels.code)}\\s+(\\S+)$`);
  return segments.map<Section>((seg) => {
    if (hintRe.test(seg)) return { label: "HINT", body: seg.replace(hintRe, "") };
    if (detRe.test(seg)) return { label: "DETAILS", body: seg.replace(detRe, "") };
    const m = codeRe.exec(seg);
    if (m) return { label: "SQLSTATE", body: m[1] };
    return { label: "MESSAGE", body: seg };
  });
}

/**
 * The single drift assertion: structurally identical section lists between
 * the toast description and the inline panel. Failure shows the diff
 * between the two parsed arrays, so a mismatch in label spelling, body
 * wording, or section order is pinpointed to the offending section rather
 * than surfacing as a vague "not contained".
 *
 * Returns both parsed lists so callers can layer locale-specific or
 * scenario-specific assertions on top (e.g. exact label ordering, joiner
 * placement, forbidden-token leak checks).
 */
export function assertSurfaceParity(
  toast: string,
  panelEl: HTMLElement,
  labels: LabelSet = EN_LABELS,
): { panelSections: Section[]; toastSections: Section[] } {
  const panelSections = parsePanelSections(panelEl, labels);
  const toastSections = parseToastSections(toast, labels);
  expect(toastSections).toEqual(panelSections);
  return { panelSections, toastSections };
}
