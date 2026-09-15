/**
 * Guardrail: ensure user-facing pages/components do not use recurring
 * subscription language, and that pricing CTAs route to the Resonance Hub
 * (reson8.life) rather than an in-app pricing page.
 *
 * This is a static-source scan — it fails the build/test suite if regressions
 * slip in. Update FORBIDDEN_EXCEPTIONS with a comment justifying any allow.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

// Files we intentionally exempt from the scan (internal identifiers, DB types,
// admin panels that describe historical subscription records, this test file).
const EXEMPT_FILES = new Set<string>([
  "src/test/hub-consistency.test.ts",
  // Auto-generated / internal identifiers only
  "src/integrations/supabase/types.ts",
  "src/integrations/supabase/client.ts",
  // Admin surfaces describing historical subscription records (not user CTAs)
  "src/pages/admin/sections/ProfitabilityPanel.tsx",
]);

// Words/phrases forbidden in user-visible strings.
const FORBIDDEN = [
  /\bmonthly plan\b/i,
  /\bannual plan\b/i,
  /\bcancel anytime\b/i,
  /\bper[- ]month\b/i,
  /\bapp subscription\b/i,
  /\bsubscribe now\b/i,
];

// Pricing-CTA anchors that must be external hub links, not local routes.
// Internal <Link to="/pricing"> navigation to the local Pricing bridge page
// is allowed (that page delegates checkout to the hub). Plain <a href="/pricing">
// mimics an external CTA and is treated as a regression.
const LOCAL_PRICING_CTA = /href=["']\/pricing["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter(
  (f) => !EXEMPT_FILES.has(relative(process.cwd(), f).replace(/\\/g, "/")),
);

// Extract text content from JSX-ish strings only (rough): match strings inside
// double/single quotes and JSX text nodes. This is a heuristic; false-positive
// noise is filtered by only flagging known forbidden phrases.
function extractUserText(src: string): string {
  // Strip block/line comments so JSDoc references don't trip us.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("Hub consistency guardrail", () => {
  it("has no forbidden subscription phrasing in user-facing source", () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = extractUserText(readFileSync(file, "utf8"));
      for (const rx of FORBIDDEN) {
        const m = text.match(rx);
        if (m) {
          hits.push(`${relative(process.cwd(), file)} → matched ${rx} ("${m[0]}")`);
        }
      }
    }
    expect(hits, `Forbidden phrasing found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("has no pricing CTAs pointing to a local /pricing route", () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      // The Pricing page itself is allowed to exist / route to /pricing for
      // internal navigation, but should not present itself as checkout.
      if (rel === "src/pages/Pricing.tsx" || rel === "src/App.tsx") continue;
      const text = readFileSync(file, "utf8");
      if (LOCAL_PRICING_CTA.test(text)) {
        hits.push(`${rel} → has href/to="/pricing" (checkout must link to reson8.life)`);
      }
    }
    expect(hits, `Local pricing CTAs found:\n${hits.join("\n")}`).toEqual([]);
  });
});
