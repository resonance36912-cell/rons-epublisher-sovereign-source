import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const port = 3197;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
const topic = "Ashley Uys";
const videos = ["abcdefghijk", "lmnopqrstuv"].map((id) => ({
  url: `https://www.youtube.com/watch?v=${id}`, title: `Ashley Uys documentary ${id}`,
  description: "Ashley Uys documentary interview", type: "youtube", provider: "youtube-public-search", selected: true,
}));
const processedSources = videos.map((video, index) => ({
  id: `video-${index}`, type: "search", ...video, type: "search", status: "error",
  extractionProvider: "youtube-public-metadata", contentAvailability: "metadata_only", transcriptAvailable: false,
}));
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw new Error("QA server did not start");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route("**/open-nova-research/v1/research/discover", route => route.fulfill({ json: { sources: videos, stats: { total: 2, youtube: 2, web: 0 } } }));
  await page.route("**/open-nova-research/v1/research/jobs", route => route.fulfill({ json: { jobId: "qa-zero" } }));
  await page.route("**/open-nova-research/v1/research/jobs/qa-zero**", route => route.fulfill({ json: { status: "complete", progress: 100, processedSources } }));
  await page.route("**/open-nova-stt/transcription-jobs", route => route.fulfill({ status: 202, json: { jobId: "qa-stt", status: "queued", stage: "queued" } }));
  await page.route("**/open-nova-stt/transcription-jobs/qa-stt", route => route.fulfill({ json: { jobId: "qa-stt", status: "failed", error: "source_download_denied", reason: "Supply an authorized transcript." } }));
  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.locator("textarea").first().fill(topic);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.getByRole("button", { name: /Extract content from 2 selected sources/ }).click({ timeout: 20000 });
  await page.getByRole("heading", { name: "Extraction failed — no usable evidence", exact: true }).waitFor({ timeout: 20000 });
  if (await page.getByRole("heading", { name: "Extraction complete", exact: true }).count()) throw new Error("False success heading");
  if (await page.getByRole("button", { name: /Configure Story/i }).count()) throw new Error("False evidence continuation");
  if (!(await page.getByRole("button", { name: /Continue to Story Settings.*topic-only/i }).isDisabled())) throw new Error("Topic-only acknowledgement bypassed");
  await page.getByRole("button", { name: "Add URL or file", exact: true }).waitFor();
  console.log("PASS: zero-evidence warning, recovery actions, evidence and topic-only gates");
} finally {
  await browser?.close();
  server.kill();
}
