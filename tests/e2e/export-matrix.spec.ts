/**
 * E2E: free / standard / premium export matrix.
 *
 * Drives the /__test/exports harness which mirrors the production
 * tier-gating contract for downloadable formats. For each (tier, format)
 * pair we assert either:
 *   - the button is enabled, clicking it produces a download whose
 *     suggested filename + payload bytes match expectations; or
 *   - the button is disabled (gated by tier).
 */
import { test, expect, type Page } from "../playwright-fixture";
import { readFile } from "node:fs/promises";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";

const TIERS: Tier[] = ["free", "standard", "premium"];
const FORMATS: Format[] = ["pdf", "html", "mp4", "mp4-narrated"];

const EXPECTED_FILENAME: Record<Format, string> = {
  pdf: "resonance-ebook.pdf",
  html: "resonance-ebook.html",
  mp4: "resonance-ebook.mp4",
  "mp4-narrated": "resonance-ebook-narrated.mp4",
};

// Magic-byte signatures for the synthesized payloads.
const SIGNATURE: Record<Format, (buf: Buffer) => boolean> = {
  pdf: (b) => b.slice(0, 5).toString("ascii") === "%PDF-",
  html: (b) => b.slice(0, 9).toString("ascii").toLowerCase() === "<!doctype",
  mp4: (b) => b.slice(4, 8).toString("ascii") === "ftyp",
  "mp4-narrated": (b) => b.slice(4, 8).toString("ascii") === "ftyp",
};

function isAllowed(tier: Tier, format: Format): boolean {
  if (format === "pdf" || format === "html") return true;
  if (format === "mp4") return tier !== "free";
  if (format === "mp4-narrated") return tier === "premium";
  return false;
}

async function openHarness(page: Page, tier: Tier) {
  await page.goto(`/__test/exports?tier=${tier}`);
  await expect(page.getByTestId("export-matrix-harness")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByTestId("export-matrix-harness")).toHaveAttribute(
    "data-tier",
    tier,
  );
}

for (const tier of TIERS) {
  test.describe(`tier=${tier}`, () => {
    for (const format of FORMATS) {
      const allowed = isAllowed(tier, format);

      test(`${format} → ${allowed ? "downloads" : "gated"}`, async ({ page }) => {
        await openHarness(page, tier);
        const button = page.getByTestId(`export-${format}`);
        await expect(button).toHaveAttribute(
          "data-allowed",
          allowed ? "true" : "false",
        );

        if (!allowed) {
          await expect(button).toBeDisabled();
          return;
        }

        await expect(button).toBeEnabled();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          button.click(),
        ]);

        expect(download.suggestedFilename()).toBe(EXPECTED_FILENAME[format]);
        const path = await download.path();
        expect(path).toBeTruthy();
        const bytes = await readFile(path!);
        expect(bytes.length).toBeGreaterThan(0);
        expect(SIGNATURE[format](bytes)).toBe(true);
      });
    }
  });
}
