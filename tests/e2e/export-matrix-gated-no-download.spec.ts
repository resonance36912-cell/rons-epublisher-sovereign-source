/**
 * E2E: tier-gated export buttons must never trigger a download and
 * must never surface the generic export-error alert. The tier-gate
 * <li> note is the only allowed signal.
 *
 * Covers every (tier, format) pair where production gating disallows
 * the export: free (mp4, mp4-narrated) and standard (mp4-narrated).
 */
import { test, expect, type Page } from "../playwright-fixture";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";

const GATED: Array<{ tier: Tier; format: Format }> = [
  { tier: "free", format: "mp4" },
  { tier: "free", format: "mp4-narrated" },
  { tier: "standard", format: "mp4-narrated" },
];

async function openHarness(page: Page, tier: Tier) {
  await page.goto(`/__test/exports?tier=${tier}`);
  await expect(page.getByTestId("export-matrix-harness")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

for (const { tier, format } of GATED) {
  test(`tier=${tier} format=${format}: gated button never downloads or shows export-error`, async ({
    page,
  }) => {
    await openHarness(page, tier);

    const button = page.getByTestId(`export-${format}`);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-tier-allowed", "false");
    await expect(button).toHaveAttribute("data-allowed", "false");

    let downloaded = false;
    page.on("download", () => {
      downloaded = true;
    });

    // `force: true` bypasses the disabled-actionability check so we can
    // prove the click truly is a no-op (no download, no error alert).
    await button.click({ force: true });
    await page.waitForTimeout(250);

    expect(downloaded).toBe(false);
    await expect(page.getByTestId("export-error")).toHaveCount(0);

    // Tier-gate note remains the only surfaced signal.
    await expect(page.getByTestId(`tier-gate-${format}`)).toBeVisible();
  });
}
