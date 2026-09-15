/**
 * E2E: graceful export failure messages.
 *
 * Drives the /__test/exports harness with `error=` and `tier=` to
 * verify that the production error contract is enforced:
 *
 *  - missing-storyboard → blocks every format with a clear prompt
 *  - in-progress        → blocks every format with a "wait" prompt
 *  - tier-gated         → MP4 and MP4-narrated render upgrade prompts
 *    that name the required plan, and the buttons stay disabled.
 *
 * No real downloads should occur in any error scenario.
 */
import { test, expect, type Page } from "../playwright-fixture";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";

const ALL_FORMATS: Format[] = ["pdf", "html", "mp4", "mp4-narrated"];

const ERROR_COPY = {
  "missing-storyboard":
    "No storyboard found. Generate a story before exporting.",
  "in-progress":
    "A generation is in progress. Please wait for it to finish.",
} as const;

const TIER_GATE_COPY: Partial<Record<Format, string>> = {
  mp4: "Video export requires the Standard or Premium plan.",
  "mp4-narrated": "Narrated video export requires the Premium plan.",
};

async function openHarness(
  page: Page,
  opts: { tier: Tier; error?: keyof typeof ERROR_COPY },
) {
  const query = new URLSearchParams({ tier: opts.tier });
  if (opts.error) query.set("error", opts.error);
  await page.goto(`/__test/exports?${query.toString()}`);
  await expect(page.getByTestId("export-matrix-harness")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function expectNoDownload(page: Page, action: () => Promise<void>) {
  let downloaded = false;
  const onDownload = () => {
    downloaded = true;
  };
  page.on("download", onDownload);
  await action();
  // Give the browser a beat to surface any (unexpected) download.
  await page.waitForTimeout(200);
  page.off("download", onDownload);
  expect(downloaded).toBe(false);
}

for (const errorMode of ["missing-storyboard", "in-progress"] as const) {
  test.describe(`error=${errorMode}`, () => {
    for (const tier of ["free", "standard", "premium"] as const) {
      test(`tier=${tier} blocks every format with the right message`, async ({
        page,
      }) => {
        await openHarness(page, { tier, error: errorMode });
        for (const format of ALL_FORMATS) {
          const button = page.getByTestId(`export-${format}`);
          // Tier-gated buttons are disabled regardless of error mode; the
          // others remain clickable so the error message can surface.
          const tierAllowed =
            (await button.getAttribute("data-tier-allowed")) === "true";
          if (!tierAllowed) continue;

          await expectNoDownload(page, async () => {
            await button.click();
          });
          await expect(page.getByTestId("export-error")).toHaveText(
            ERROR_COPY[errorMode],
          );
        }
      });
    }
  });
}

test.describe("tier-gated error messages", () => {
  test("free tier surfaces upgrade prompts for MP4 + narrated MP4", async ({
    page,
  }) => {
    await openHarness(page, { tier: "free" });
    await expect(page.getByTestId("tier-gate-mp4")).toHaveText(
      TIER_GATE_COPY.mp4!,
    );
    await expect(page.getByTestId("tier-gate-mp4-narrated")).toHaveText(
      TIER_GATE_COPY["mp4-narrated"]!,
    );
    await expect(page.getByTestId("export-mp4")).toBeDisabled();
    await expect(page.getByTestId("export-mp4-narrated")).toBeDisabled();
  });

  test("standard tier surfaces upgrade prompt only for narrated MP4", async ({
    page,
  }) => {
    await openHarness(page, { tier: "standard" });
    await expect(page.getByTestId("tier-gate-mp4")).toHaveCount(0);
    await expect(page.getByTestId("tier-gate-mp4-narrated")).toHaveText(
      TIER_GATE_COPY["mp4-narrated"]!,
    );
    await expect(page.getByTestId("export-mp4-narrated")).toBeDisabled();
  });

  test("premium tier shows no tier-gate prompts", async ({ page }) => {
    await openHarness(page, { tier: "premium" });
    await expect(page.getByTestId("tier-gate-mp4")).toHaveCount(0);
    await expect(page.getByTestId("tier-gate-mp4-narrated")).toHaveCount(0);
  });
});
