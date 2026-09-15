import { chromium } from "@playwright/test";

const topic = "Ashley Uys";
const videos = [
  ["life", "That's So Life Podcast ft Ashley Uys"],
  ["diagnostech", "Ashley Uys - Medical Diagnostech"],
  ["documentary", "ASHLEY UYS OFFICIAL DOCUMENTARY VIDEO BY DREAMBOX STUDIOS"],
  ["concierge", "Anton David Jeftha with Ashley Uys - The Concierge S1E2"],
  ["founder", "Ashley Uys - Founder of Medical Diagnostech"],
].map(([id, title]) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  title,
  description: `${title}. Public video metadata only.`,
  type: "youtube",
  provider: "youtube-public-search",
  selected: true,
}));

const processedSources = videos.map((video, index) => ({
  id: `video-${index + 1}`,
  type: "search",
  title: video.title,
  url: video.url,
  provider: "youtube-public-search",
  extractionProvider: "youtube-public-metadata",
  transcriptAvailable: false,
  status: "ready",
}));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

await page.route("**/open-nova-research/v1/research/discover", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ sources: videos, stats: { total: 5, youtube: 5, web: 0 } }),
  });
});
await page.route("**/open-nova-research/v1/research/jobs", async (route) => {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "zero-evidence" }) });
});
await page.route("**/open-nova-research/v1/research/jobs/zero-evidence**", async (route) => {
  const includeResults = new URL(route.request().url()).searchParams.get("include_results") === "true";
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "complete",
      progress: 100,
      statusMessage: "Extraction complete",
      ...(includeResults ? { processedSources } : {}),
    }),
  });
});

try {
  await page.goto("http://127.0.0.1:3101/app", { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator("textarea").first().fill(topic);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Discovery complete"), null, { timeout: 30_000 });
  await page.getByRole("button", { name: /Extract content from 5 selected sources/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes("No usable evidence was recovered"), null, { timeout: 30_000 });

  const body = await page.locator("body").innerText();
  if (!body.includes("0 usable evidence source(s); 5 excluded after extraction.")) throw new Error("Truthful zero-evidence summary missing");
  if (!body.includes("Review other sources") || !body.includes("Add URL or file") || !body.includes("Re-search")) throw new Error("Recovery actions missing");
  if (await page.getByRole("button", { name: /Configure Story/i }).count()) throw new Error("Evidence-backed Configure Story action must not appear");

  const continueButton = page.getByRole("button", { name: /Continue to Story Settings — topic-only/i });
  if (!(await continueButton.isDisabled())) throw new Error("Topic-only continuation must require acknowledgement");
  await page.getByLabel(/I understand that a topic-only draft/i).click();
  if (await continueButton.isDisabled()) throw new Error("Acknowledged topic-only continuation remained disabled");
  await continueButton.click();
  await page.getByText("Topic-only draft mode", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

  console.log("ZERO_EVIDENCE_RECOVERY_PASS metadata_only=5 topic_only_acknowledged=true");
} finally {
  await browser.close();
}
