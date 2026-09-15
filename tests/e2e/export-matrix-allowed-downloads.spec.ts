/**
 * E2E: every non-gated (tier, format) combination must trigger a real
 * download with the expected filename and a non-empty payload whose
 * magic bytes match the format. Complements export-matrix-gated-no-download
 * (which proves the inverse for gated combos).
 */
import { test, expect, type Page } from "../playwright-fixture";
import { readFile } from "node:fs/promises";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";

const EXPECTED_FILENAME: Record<Format, string> = {
  pdf: "resonance-ebook.pdf",
  html: "resonance-ebook.html",
  mp4: "resonance-ebook.mp4",
  "mp4-narrated": "resonance-ebook-narrated.mp4",
};

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

const ALLOWED: Array<{ tier: Tier; format: Format }> = (
  ["free", "standard", "premium"] as Tier[]
).flatMap((tier) =>
  (["pdf", "html", "mp4", "mp4-narrated"] as Format[])
    .filter((format) => isAllowed(tier, format))
    .map((format) => ({ tier, format })),
);

async function openHarness(page: Page, tier: Tier) {
  await page.goto(`/__test/exports?tier=${tier}`);
  await expect(page.getByTestId("export-matrix-harness")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

for (const { tier, format } of ALLOWED) {
  test(`tier=${tier} format=${format}: allowed button triggers a valid download`, async ({
    page,
  }) => {
    await openHarness(page, tier);

    const button = page.getByTestId(`export-${format}`);
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("data-tier-allowed", "true");
    await expect(button).toHaveAttribute("data-allowed", "true");

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

    // No error alert should ever appear for an allowed export.
    await expect(page.getByTestId("export-error")).toHaveCount(0);
  });
}
