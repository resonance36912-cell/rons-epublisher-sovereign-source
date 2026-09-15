import { test, expect } from "../playwright-fixture";

/**
 * E2E: Free vs Premium narration gating.
 *
 * Mounts the dedicated test harness route /__test/narration which renders
 * <ReviewConfigure /> in isolation with the user tier driven by a query
 * param. We never hit real billing or auth flows here — just the UI
 * contract: George visibility + which provider the preview button calls.
 */

const HARNESS_PATH = "/__test/narration";

// Stub the browser's SpeechSynthesis so the "browser voice" preview path
// resolves immediately and is observable from the test.
async function stubBrowserSpeech(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as any).__speakCalls = 0;
    const fakeUtterance: any = function () {};
    (window as any).SpeechSynthesisUtterance = fakeUtterance;
    (window as any).speechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      cancel() {},
      pause() {},
      resume() {},
      getVoices() { return []; },
      addEventListener() {},
      removeEventListener() {},
      speak(u: any) {
        (window as any).__speakCalls += 1;
        // Fire onend on the next tick so the component's promise resolves.
        setTimeout(() => u?.onend?.({}), 0);
      },
    };
  });
}

// Track requests to the ElevenLabs edge function so we can assert routing.
function trackElevenLabsCalls(page: import("@playwright/test").Page) {
  const calls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/elevenlabs-tts")) {
      calls.push(req.url());
    }
  });
  return calls;
}

test.describe("Narration gating — Free tier", () => {
  test.beforeEach(async ({ page }) => {
    await stubBrowserSpeech(page);
  });

  test("hides the George/ElevenLabs voice selector", async ({ page }) => {
    await page.goto(`${HARNESS_PATH}?tier=free&provider=elevenlabs`);
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-tier", "free");
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-ready", "true");

    // Voice select trigger should not be present at all on Free.
    await expect(page.getByText("voice.george")).toHaveCount(0);
    // The browser-fallback hint IS visible.
    await expect(
      page.getByText(/Browser narration uses your device's built-in voice/i),
    ).toBeVisible();
  });

  test("preview button routes to the BROWSER provider (no ElevenLabs network call)", async ({ page }) => {
    const elevenlabsCalls = trackElevenLabsCalls(page);
    await page.goto(`${HARNESS_PATH}?tier=free`);
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-ready", "true");

    const previewBtn = page.getByTitle(/Preview voice \(Browser voice\)/i);
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    // Browser TTS should have been invoked at least once…
    await expect.poll(() => page.evaluate(() => (window as any).__speakCalls ?? 0)).toBeGreaterThan(0);
    // …and ElevenLabs must NEVER be called for a Free user.
    expect(elevenlabsCalls).toHaveLength(0);
  });

  test("the 'Preview via Browser voice' label is shown next to the preview", async ({ page }) => {
    await page.goto(`${HARNESS_PATH}?tier=free`);
    await expect(page.getByText(/Preview via/i).first()).toContainText(/Browser voice/i);
  });
});

test.describe("Narration gating — Premium tier", () => {
  test.beforeEach(async ({ page }) => {
    await stubBrowserSpeech(page);
    // Stub the ElevenLabs edge function so we can assert routing without
    // burning real credits or depending on backend availability.
    await page.route("**/functions/v1/elevenlabs-tts**", async (route) => {
      // Smallest valid MP3-ish payload; the component only needs a Blob to
      // reach the audio.play() path (which jsdom/Playwright will accept).
      await route.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      });
    });
  });

  test("shows the George/ElevenLabs voice selector when Premium toggle is on", async ({ page }) => {
    await page.goto(`${HARNESS_PATH}?tier=premium&provider=elevenlabs`);
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-tier", "premium");
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-ready", "true");
    await expect(page.getByText("voice.george").first()).toBeVisible();
  });

  test("preview button routes to ElevenLabs (network call observed)", async ({ page }) => {
    const elevenlabsCalls = trackElevenLabsCalls(page);
    await page.goto(`${HARNESS_PATH}?tier=premium&provider=elevenlabs`);
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-ready", "true");

    const previewBtn = page.getByTitle(/Preview voice/i);
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    await expect.poll(() => elevenlabsCalls.length, { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test("preview falls back to BROWSER when Premium toggle is off", async ({ page }) => {
    const elevenlabsCalls = trackElevenLabsCalls(page);
    await page.goto(`${HARNESS_PATH}?tier=premium&provider=browser`);
    await expect(page.getByTestId("narration-harness")).toHaveAttribute("data-ready", "true");

    const previewBtn = page.getByTitle(/Preview voice \(Browser voice\)/i);
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    await expect.poll(() => page.evaluate(() => (window as any).__speakCalls ?? 0)).toBeGreaterThan(0);
    expect(elevenlabsCalls).toHaveLength(0);
  });
});
