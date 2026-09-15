/**
 * E2E: every allowed (tier, format) download must carry the correct
 * Content-Type (MIME) and a filename whose extension matches the format.
 *
 * Content-Type is read from the harness's `data-last-mime` attribute,
 * which mirrors the Blob `type` used by the real anchor-download path.
 * Filename extension is read from Playwright's Download.suggestedFilename().
 */
import { test, expect, type Page } from "../playwright-fixture";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";

const EXPECTED_MIME: Record<Format, string> = {
  pdf: "application/pdf",
  html: "text/html",
  mp4: "video/mp4",
  "mp4-narrated": "video/mp4",
};

const EXPECTED_EXT: Record<Format, string> = {
  pdf: ".pdf",
  html: ".html",
  mp4: ".mp4",
  "mp4-narrated": ".mp4",
};

const EXPECTED_FILENAME: Record<Format, string> = {
  pdf: "resonance-ebook.pdf",
  html: "resonance-ebook.html",
  mp4: "resonance-ebook.mp4",
  "mp4-narrated": "resonance-ebook-narrated.mp4",
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
  test(`tier=${tier} format=${format}: Content-Type + extension match`, async ({
    page,
  }) => {
    await openHarness(page, tier);

    const button = page.getByTestId(`export-${format}`);
    await expect(button).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      button.click(),
    ]);

    const filename = download.suggestedFilename();
    expect(filename).toBe(EXPECTED_FILENAME[format]);
    expect(filename.toLowerCase().endsWith(EXPECTED_EXT[format])).toBe(true);

    const harness = page.getByTestId("export-matrix-harness");
    await expect(harness).toHaveAttribute("data-last-mime", EXPECTED_MIME[format]);
    await expect(harness).toHaveAttribute("data-last-filename", EXPECTED_FILENAME[format]);
  });
}
