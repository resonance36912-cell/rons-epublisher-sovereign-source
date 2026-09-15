#!/usr/bin/env node
/**
 * Post-build serving gate for the sitemap.
 *
 * verify-dist-sitemap.mjs proves the files were copied into dist/. This goes a
 * step further and actually SERVES dist/ (through `vite preview`, so the
 * sitemap header plugin in vite.config.ts is exercised too) and fetches:
 *
 *   1. /sitemap.xml
 *   2. every shard referenced by a <sitemapindex>
 *   3. /robots.txt
 *   4. every page <loc> listed in a <urlset> (must end at 200, redirects OK)
 *
 * The build fails if any of them returns a non-200 status, an empty body,
 * a non-XML Content-Type, or unparseable XML — the exact failure modes that
 * make Googlebot drop a sitemap silently.
 *
 * Runs automatically via the `postbuild` npm hook. Set SKIP_SERVED_SITEMAP=1
 * to skip (e.g. in a sandbox without a free port).
 *
 * Options (also settable via env):
 *   --base-url=<url>    check an already-running origin (staging, production,
 *                       `vite dev`) instead of spawning `vite preview` on
 *                       dist/. Env: SITEMAP_BASE_URL
 *   --preview-port=<n>  port for the spawned preview server. Ignored with
 *                       --base-url. Env: SERVED_SITEMAP_PORT
 *   --skip-loc-checks   skip fetching each page <loc>. Env: SKIP_LOC_CHECKS=1
 *   --max-redirects=<n> redirect hops allowed per <loc> (0-20, default 5; 0
 *                       requires a direct 200). Env: SITEMAP_MAX_REDIRECTS
 *   --allowed-redirect-hosts=<a,b>
 *                       comma-separated hostnames a redirect may land on
 *                       (supports `.example.com` / `*.example.com` suffixes).
 *                       Default: any host. The origin under test is always
 *                       allowed. Env: SITEMAP_ALLOWED_REDIRECT_HOSTS
 *   --concurrency=<n>   parallel <loc> requests (1-32, default 6).
 *                       Env: SITEMAP_CONCURRENCY
 *   --retries=<n>       extra attempts per request on transport errors,
 *                       timeouts, 408/425/429 and 5xx (0-10, default 2).
 *                       Env: SITEMAP_RETRIES
 *   --retry-base-delay=<ms>
 *                       first backoff delay, doubled per retry (default 250).
 *                       Env: SITEMAP_RETRY_BASE_DELAY
 *   --request-timeout=<ms>
 *                       per-attempt socket timeout (default 15000).
 *                       Env: SITEMAP_REQUEST_TIMEOUT
 *   --slow-threshold=<ms>
 *                       flag requests at/over this duration (default 2000).
 *                       Env: SITEMAP_SLOW_THRESHOLD
 *
 *   node scripts/verify-served-sitemap.mjs --base-url=https://www.resonanceonline.life
 *   npm run verify:sitemap -- --preview-port=4200
 *   npm run verify:sitemap -- --concurrency=12 --retries=3 --slow-threshold=1500
 *   npm run verify:sitemap -- --fail-on-new-failures
 *   node scripts/verify-served-sitemap.mjs --compare-baseline=prev-report.json

 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";


if (process.env.SKIP_SERVED_SITEMAP === "1") {
  console.log("served sitemap check skipped (SKIP_SERVED_SITEMAP=1)");
  process.exit(0);
}

/** `--flag=value` / `--flag value` parsing for the two supported options. */
function readArg(name) {
  const args = process.argv.slice(2);
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return undefined;
  const arg = args[index];
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`✗ --${name} requires a value`);
    process.exit(1);
  }
  return value;
}

const baseUrlArg = readArg("base-url") ?? process.env.SITEMAP_BASE_URL;
const portArg = readArg("preview-port") ?? process.env.SERVED_SITEMAP_PORT;

let TARGET;
if (baseUrlArg) {
  try {
    TARGET = new URL(baseUrlArg);
  } catch {
    console.error(`✗ --base-url is not a valid URL: ${baseUrlArg}`);
    process.exit(1);
  }
  if (!/^https?:$/.test(TARGET.protocol)) {
    console.error(`✗ --base-url must be http(s): ${baseUrlArg}`);
    process.exit(1);
  }
}

const PORT = Number(portArg ?? 4183);
if (!baseUrlArg && (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)) {
  console.error(`✗ --preview-port must be an integer between 1 and 65535, got "${portArg}"`);
  process.exit(1);
}

/** Remote mode skips the preview server; the origin is already serving. */
const REMOTE = Boolean(baseUrlArg);
/** Base path so `--base-url=https://host/sub` resolves paths under /sub. */
const BASE_PATH = REMOTE ? TARGET.pathname.replace(/\/$/, "") : "";
const ORIGIN = REMOTE ? TARGET.origin + BASE_PATH : `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 60_000;

if (!REMOTE && !existsSync(resolve("dist/index.html"))) {
  console.error("✗ dist/ is missing — run the build before this check.");
  process.exit(1);
}

const server = REMOTE
  ? null
  : spawn(
      process.execPath,
      [resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

let serverLog = "";
server?.stdout.on("data", (chunk) => (serverLog += chunk));
server?.stderr.on("data", (chunk) => (serverLog += chunk));

const shutdown = () => {
  if (server && !server.killed) server.kill("SIGTERM");
};
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

/** Wait until the target origin answers, or fail fast with its output. */
async function waitForServer() {
  if (REMOTE) return;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`vite preview exited early (code ${server.exitCode}):\n${serverLog}`);
    }
    try {
      const res = await fetch(`${ORIGIN}/robots.txt`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite preview did not start within ${STARTUP_TIMEOUT_MS}ms:\n${serverLog}`);
}

const errors = [];
const checked = [];
/** Human-readable structure summary per validated sitemap document. */
const structure = [];
/** Per-request records for the machine-readable report. */
const results = [];
/** Every page <loc> discovered in a <urlset> (root or shard), in order. */
const pageLocs = [];
/** Per-page reachability records for the report. */
const locResults = [];
let screenshots = { enabled: false, reason: "not run", shots: [], skippedForLimit: 0 };

const SKIP_LOC_CHECKS = process.argv.includes("--skip-loc-checks") || process.env.SKIP_LOC_CHECKS === "1";

/**
 * --max-redirects=<n>  hops allowed before a <loc> is declared a failure.
 * 0 means "no redirects at all — every <loc> must answer 200 directly".
 * Env: SITEMAP_MAX_REDIRECTS
 */
const maxRedirectsArg = readArg("max-redirects") ?? process.env.SITEMAP_MAX_REDIRECTS;
const MAX_REDIRECTS = maxRedirectsArg === undefined ? 5 : Number(maxRedirectsArg);
if (!Number.isInteger(MAX_REDIRECTS) || MAX_REDIRECTS < 0 || MAX_REDIRECTS > 20) {
  console.error(`✗ --max-redirects must be an integer between 0 and 20, got "${maxRedirectsArg}"`);
  process.exit(1);
}

/**
 * --allowed-redirect-hosts=<a,b>  hostnames a redirect may land on.
 * Empty (default) = any host. The origin under test is always allowed so a
 * local trailing-slash hop never trips the allowlist.
 * Env: SITEMAP_ALLOWED_REDIRECT_HOSTS
 */
const allowedHostsArg = readArg("allowed-redirect-hosts") ?? process.env.SITEMAP_ALLOWED_REDIRECT_HOSTS;
const ALLOWED_REDIRECT_HOSTS = (allowedHostsArg ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Allowlist match: exact hostname, or `.example.com`-style suffix wildcard. */
function isAllowedRedirectHost(hostname) {
  if (ALLOWED_REDIRECT_HOSTS.length === 0) return true;
  const host = hostname.toLowerCase();
  if (host === new URL(ORIGIN).hostname.toLowerCase()) return true;
  return ALLOWED_REDIRECT_HOSTS.some(
    (allowed) =>
      host === allowed ||
      (allowed.startsWith("*.") && host.endsWith(allowed.slice(1))) ||
      (allowed.startsWith(".") && host.endsWith(allowed)),
  );
}

/** Positive-integer CLI/env option with a default and an inclusive range. */
function intOption(flag, envName, fallback, { min, max }) {
  const raw = readArg(flag) ?? process.env[envName];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`✗ --${flag} must be an integer between ${min} and ${max}, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

/** --concurrency=<n>  parallel <loc> requests. Env: SITEMAP_CONCURRENCY */
const LOC_CONCURRENCY = intOption("concurrency", "SITEMAP_CONCURRENCY", 6, { min: 1, max: 32 });
/** --retries=<n>  extra attempts per request after the first. Env: SITEMAP_RETRIES */
const RETRIES = intOption("retries", "SITEMAP_RETRIES", 2, { min: 0, max: 10 });
/** --retry-base-delay=<ms>  first backoff delay; doubles each retry. Env: SITEMAP_RETRY_BASE_DELAY */
const RETRY_BASE_DELAY = intOption("retry-base-delay", "SITEMAP_RETRY_BASE_DELAY", 250, { min: 0, max: 10000 });
/** --request-timeout=<ms>  per-attempt socket timeout. Env: SITEMAP_REQUEST_TIMEOUT */
const REQUEST_TIMEOUT = intOption("request-timeout", "SITEMAP_REQUEST_TIMEOUT", 15000, { min: 500, max: 120000 });
/** --slow-threshold=<ms>  requests at/over this are flagged "slow" in reports. Env: SITEMAP_SLOW_THRESHOLD */
const SLOW_THRESHOLD = intOption("slow-threshold", "SITEMAP_SLOW_THRESHOLD", 2000, { min: 1, max: 120000 });
/**
 * --compare-baseline=<file>  previous report JSON to diff against.
 * Defaults to the existing report at the JSON output path (the last run's artifact).
 * Env: SITEMAP_COMPARE_BASELINE
 */
const COMPARE_BASELINE_ARG = readArg("compare-baseline") ?? process.env.SITEMAP_COMPARE_BASELINE;
/**
 * --fail-on-new-failures  regression mode: exit non-zero only when a URL/shard
 * that passed (or did not exist) in the baseline is now failing. Pre-existing
 * failures are reported but do not fail the run. Env: SITEMAP_FAIL_ON_NEW_FAILURES=1
 */
const FAIL_ON_NEW_FAILURES =
  process.argv.includes("--fail-on-new-failures") || process.env.SITEMAP_FAIL_ON_NEW_FAILURES === "1";
const COMPARE_ENABLED = FAIL_ON_NEW_FAILURES || COMPARE_BASELINE_ARG !== undefined;
/** --no-failure-screenshots  skip capturing PNGs of failing <loc> pages. Env: SITEMAP_NO_FAILURE_SCREENSHOTS=1 */
const CAPTURE_SCREENSHOTS = !(
  process.argv.includes("--no-failure-screenshots") || process.env.SITEMAP_NO_FAILURE_SCREENSHOTS === "1"
);
/** --screenshot-dir=<dir>  where failure PNGs are written. Env: SITEMAP_SCREENSHOT_DIR */
const SCREENSHOT_DIR = resolve(
  readArg("screenshot-dir") ?? process.env.SITEMAP_SCREENSHOT_DIR ?? "docs/generated/sitemap-failure-screenshots",
);
/** --screenshot-limit=<n>  max failing pages to screenshot. Env: SITEMAP_SCREENSHOT_LIMIT */
const SCREENSHOT_LIMIT = intOption("screenshot-limit", "SITEMAP_SCREENSHOT_LIMIT", 20, { min: 1, max: 200 });



const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A retry is worth it for transport faults, timeouts, 429 and 5xx — not 4xx. */
function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Raw HTTP request advertising gzip support.
 *
 * `fetch()` strips `Content-Encoding` after transparently decoding, so the
 * gzip assertions below need the untouched response headers. It also follows
 * redirects silently, which would hide the 3xx chain we want to inspect.
 */
function rawRequest(url, { method = "GET" } = {}) {
  const target = url instanceof URL ? url : new URL(url);
  const getter = target.protocol === "https:" ? httpsGet : httpGet;
  const startedAt = Date.now();
  return new Promise((resolvePromise, reject) => {
    const req = getter(
      target,
      { method, headers: { "accept-encoding": "gzip", "user-agent": "resonance-sitemap-verifier" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            raw: Buffer.concat(chunks),
            durationMs: Date.now() - startedAt,
          }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT}ms`));
    });
    req.on("error", reject);
  });
}

/**
 * rawRequest + exponential backoff, returning per-attempt timings so CI can
 * see which URL was slow and which one only passed on a retry.
 *
 * Resolves `{ res, timing }`; rejects only when every attempt threw.
 */
async function requestWithRetry(url, options = {}) {
  const attempts = [];
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const res = await rawRequest(url, options);
      attempts.push({ attempt: attempt + 1, status: res.status, durationMs: res.durationMs, error: null });
      if (attempt < RETRIES && isRetryableStatus(res.status)) {
        await sleep(RETRY_BASE_DELAY * 2 ** attempt);
        continue;
      }
      return { res, timing: summarizeTiming(attempts) };
    } catch (error) {
      lastError = error;
      attempts.push({ attempt: attempt + 1, status: null, durationMs: null, error: error?.message ?? String(error) });
      if (attempt < RETRIES) {
        await sleep(RETRY_BASE_DELAY * 2 ** attempt);
        continue;
      }
    }
  }
  const failure = new Error(
    `${lastError?.message ?? "request failed"} (after ${attempts.length} attempt(s))`,
  );
  failure.timing = summarizeTiming(attempts);
  throw failure;
}

/** Collapse attempt records into the timing block stored on each result. */
function summarizeTiming(attempts) {
  const durations = attempts.map((a) => a.durationMs).filter((d) => typeof d === "number");
  const lastMs = durations.length ? durations[durations.length - 1] : null;
  return {
    attempts: attempts.length,
    retries: attempts.length - 1,
    totalMs: durations.reduce((sum, d) => sum + d, 0),
    lastMs,
    slowestMs: durations.length ? Math.max(...durations) : null,
    slow: durations.length ? Math.max(...durations) >= SLOW_THRESHOLD : false,
    attemptDetails: attempts,
  };
}

/** Merge several request timings (e.g. a redirect chain) into one block. */
function mergeTimings(timings) {
  const all = timings.flatMap((t) => t?.attemptDetails ?? []);
  return summarizeTiming(all);
}

function rawGet(path) {
  return requestWithRetry(`${ORIGIN}${path}`);
}

/**
 * Follow a page <loc> and assert it terminates in a 200.
 *
 * Redirects are allowed (a canonical host/trailing-slash hop is normal) but
 * the chain must end at 200 within MAX_REDIRECTS hops — a sitemap URL that
 * 404s or loops is a crawl-budget leak Google reports as "Couldn't fetch".
 */
async function checkLoc(loc) {
  const record = {
    loc,
    url: null,
    status: null,
    chain: [],
    timing: summarizeTiming([]),
    ok: false,
    errors: [],
  };
  locResults.push(record);
  const hopTimings = [];

  let target;
  try {
    const parsed = new URL(loc);
    // Sitemap <loc> values are absolute against the canonical domain; the
    // thing we can actually reach is the same path on the origin under test.
    let path = `${parsed.pathname}${parsed.search}`;
    if (BASE_PATH && path.startsWith(`${BASE_PATH}/`)) path = path.slice(BASE_PATH.length);
    target = new URL(`${ORIGIN}${path}`);
  } catch {
    record.errors.push(`<loc> is not a fetchable URL: ${loc}`);
    errors.push(`<loc> ${loc} — not a fetchable URL`);
    return record;
  }
  record.url = target.toString();

  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res;
    try {
      const attempt = await requestWithRetry(current);
      res = attempt.res;
      hopTimings.push(attempt.timing);
      record.timing = mergeTimings(hopTimings);
    } catch (error) {
      hopTimings.push(error.timing);
      record.timing = mergeTimings(hopTimings);
      record.errors.push(`request failed: ${error?.message ?? error}`);
      errors.push(`<loc> ${loc} — request failed: ${error?.message ?? error}`);
      return record;
    }
    record.status = res.status;
    record.chain.push({ url: current.toString(), status: res.status, location: res.headers.location ?? null });

    if (res.status === 200) {
      record.ok = true;
      return record;
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.location;
      if (!location) {
        record.errors.push(`${res.status} redirect without a Location header`);
        errors.push(`<loc> ${loc} — ${res.status} redirect without a Location header`);
        return record;
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, current);
      } catch {
        record.errors.push(`invalid redirect Location: ${location}`);
        errors.push(`<loc> ${loc} — invalid redirect Location: ${location}`);
        return record;
      }
      if (!isAllowedRedirectHost(nextUrl.hostname)) {
        const msg = `redirect to disallowed host "${nextUrl.hostname}" (allowed: ${ALLOWED_REDIRECT_HOSTS.join(", ")})`;
        record.errors.push(msg);
        errors.push(`<loc> ${loc} — ${msg}`);
        return record;
      }
      current = nextUrl;
      continue;

    }
    record.errors.push(`expected 200 (or a redirect to 200), got ${res.status}`);
    errors.push(`<loc> ${loc} — expected 200, got ${res.status} at ${current}`);
    return record;
  }

  record.errors.push(`redirect chain exceeded ${MAX_REDIRECTS} hops`);
  errors.push(`<loc> ${loc} — redirect chain exceeded ${MAX_REDIRECTS} hops`);
  return record;
}

/** Run checkLoc over every discovered page URL with bounded concurrency. */
async function checkAllLocs() {
  if (SKIP_LOC_CHECKS) {
    console.log("  · page <loc> reachability checks skipped (--skip-loc-checks)");
    return;
  }
  if (pageLocs.length === 0) return;
  const queue = [...pageLocs];
  const workers = Array.from({ length: Math.min(LOC_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await checkLoc(next);
    }
  });
  await Promise.all(workers);
  const okCount = locResults.filter((r) => r.ok).length;
  console.log(`  ✓ page <loc> reachability: ${okCount}/${locResults.length} returned 200 (redirects followed)`);
}

/**
 * Launch chromium, falling back to any browser already present on the machine.
 *
 * CI installs the matching build; sandboxes/dev boxes often have a differently
 * versioned Playwright download, so try an explicit executable before giving up.
 */
async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const explicit = process.env.SITEMAP_CHROMIUM_PATH ?? process.env.CHROME_PATH;
    const candidates = [];
    if (explicit) candidates.push(explicit);
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (root && existsSync(root)) {
      for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
        candidates.push(join(root, dir, "chrome-linux", "chrome"), join(root, dir, "chrome-linux", "headless_shell"));
      }
    }
    for (const executablePath of candidates) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ headless: true, executablePath });
      } catch {
        /* try the next candidate */
      }
    }
    throw error;
  }
}


/**
 * Screenshot every failing <loc> so CI artifacts show what the crawler hit.
 *
 * Runs before the preview server is torn down (local mode), uses the
 * Playwright chromium already vendored for e2e, and degrades gracefully:
 * a missing browser download or launch failure is recorded, never fatal.
 */
async function captureFailureScreenshots() {
  const targets = locResults.filter((r) => !r.ok).slice(0, SCREENSHOT_LIMIT);
  const skippedForLimit = Math.max(0, locResults.filter((r) => !r.ok).length - targets.length);
  if (!CAPTURE_SCREENSHOTS) return { enabled: false, reason: "disabled (--no-failure-screenshots)", shots: [], skippedForLimit: 0 };
  if (targets.length === 0) return { enabled: true, reason: "no failing <loc> pages", shots: [], skippedForLimit: 0 };

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    return { enabled: true, reason: `playwright unavailable: ${error.message}`, shots: [], skippedForLimit };
  }

  let browser;
  const shots = [];
  try {
    browser = await launchChromium(chromium);

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const target of targets) {
      const slug =
        target.loc
          .replace(/^https?:\/\//, "")
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "root";
      const file = join(SCREENSHOT_DIR, `${slug}.png`);
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
      });
      const shot = { loc: target.loc, status: target.status ?? null, file, consoleErrors };
      try {
        const response = await page.goto(target.loc, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT });
        shot.status = response?.status() ?? shot.status;
        await page.screenshot({ path: file });
        shot.captured = true;
      } catch (error) {
        shot.captured = false;
        shot.error = error.message;
        // A blank/partial render is still evidence — try once more, best effort.
        try {
          await page.screenshot({ path: file });
          shot.captured = true;
        } catch {
          /* nothing renderable */
        }
      }
      await page.close();
      shots.push(shot);
    }
    await context.close();
  } catch (error) {
    return { enabled: true, reason: `screenshot capture failed: ${error.message}`, shots, skippedForLimit };
  } finally {
    await browser?.close().catch(() => {});
  }
  const okCount = shots.filter((s) => s.captured).length;
  console.log(`  · captured ${okCount}/${shots.length} failure screenshot(s) in ${SCREENSHOT_DIR}`);
  return { enabled: true, reason: null, shots, skippedForLimit };
}





/** Fetch one path and assert status, body, gzip headers and parseable XML. */
async function check(path, { xml = true, expect = "either", role = "sitemap" } = {}) {
  const errorsBefore = errors.length;
  const record = {
    path,
    url: `${ORIGIN}${path}`,
    role,
    expect,
    status: null,
    headers: {},
    bytes: { transferred: null, decoded: null },
    // Only the local dist/ run can assert gzip from a public/*.gz sibling;
    // a remote origin may compress on the fly or not at all.
    gzip: { expected: !REMOTE && existsSync(resolve(`public${path}.gz`)), served: false },
    timing: summarizeTiming([]),
    ok: false,
    errors: [],
  };
  results.push(record);
  const finish = () => {
    record.errors = errors.slice(errorsBefore);
    record.ok = record.errors.length === 0;
  };

  let res;
  try {
    const attempt = await rawGet(path);
    res = attempt.res;
    record.timing = attempt.timing;
  } catch (error) {
    record.timing = error.timing ?? record.timing;
    errors.push(`${path} — request failed: ${error?.message ?? error}`);
    finish();
    return null;
  }

  const contentType = res.headers["content-type"] ?? "";
  const encoding = (res.headers["content-encoding"] ?? "").toLowerCase();
  const vary = res.headers["vary"] ?? "";

  record.status = res.status;
  record.headers = { ...res.headers };
  record.bytes.transferred = res.raw.length;
  record.gzip.served = encoding === "gzip";

  if (res.status !== 200) {
    errors.push(`${path} — expected 200, got ${res.status}`);
    finish();
    return null;
  }

  // Pre-compressed sibling exists → the server MUST hand it out for a
  // gzip-capable client, and MUST vary its cache on Accept-Encoding.
  const hasGzSibling = record.gzip.expected;
  if (hasGzSibling) {
    if (encoding !== "gzip") {
      errors.push(
        `${path} — Content-Encoding is "${encoding || "(none)"}", expected "gzip" (public${path}.gz exists)`,
      );
    }
    if (!/accept-encoding/i.test(vary)) {
      errors.push(`${path} — Vary is "${vary || "(none)"}", expected to include Accept-Encoding`);
    }
  }

  let body;
  if (encoding === "gzip") {
    try {
      body = gunzipSync(res.raw).toString("utf8");
    } catch (error) {
      errors.push(`${path} — Content-Encoding: gzip but body is not valid gzip: ${error?.message ?? error}`);
      finish();
      return null;
    }
  } else {
    body = res.raw.toString("utf8");
  }

  record.bytes.decoded = body.length;

  if (body.trim().length === 0) {
    errors.push(`${path} — served an empty body`);
    finish();
    return null;
  }
  if (xml) {
    if (!/xml/i.test(contentType)) {
      errors.push(`${path} — Content-Type is "${contentType || "(none)"}", expected XML`);
    }
    if (!body.trimStart().startsWith("<?xml")) {
      errors.push(`${path} — body is not XML (likely the SPA index.html fallback)`);
      finish();
      return null;
    }
    if (!validateSitemapXml(path, body, expect, record)) {
      finish();
      return null;
    }
  }

  checked.push(
    `${path} → ${res.status} ${String(contentType).split(";")[0]} ` +
      `${encoding === "gzip" ? `gzip ${res.raw.length}B → ` : ""}${body.length}B` +
      `${hasGzSibling ? ` [Vary: ${vary}]` : ""}`,
  );
  finish();
  return body;
}


/**
 * Well-formedness + sitemap-protocol structure check.
 *
 * A 200 with XML-looking bytes is not enough: an unclosed tag, a wrong root
 * element or an entry without <loc> makes Googlebot reject the whole file.
 * `expect` is "index", "urlset", or "either" for the root document.
 */
function validateSitemapXml(path, body, expect = "either", record = null) {
  const before = errors.length;
  const note = (root, entryTag, count) => {
    if (record) record.document = { root, entryTag, entries: count };
  };


  // --- well-formedness: every non-self-closing tag must nest and close ---
  const stack = [];
  let root = null;
  const tagRe = /<(\/)?([A-Za-z_][\w.:-]*)([^>]*?)(\/)?>/g;
  for (const [, closing, name, attrs, selfClose] of body
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .matchAll(tagRe)) {
    if (selfClose || attrs.endsWith("/")) continue;
    if (closing) {
      const open = stack.pop();
      if (open !== name) {
        errors.push(`${path} — malformed XML: </${name}> closes <${open ?? "nothing"}>`);
        return false;
      }
    } else {
      if (stack.length === 0) root = root ?? name;
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    errors.push(`${path} — malformed XML: unclosed <${stack[stack.length - 1]}>`);
    return false;
  }
  if (!root) {
    errors.push(`${path} — no root element found`);
    return false;
  }

  // --- structure: correct root element for what we asked for ---
  const allowed =
    expect === "index" ? ["sitemapindex"] : expect === "urlset" ? ["urlset"] : ["sitemapindex", "urlset"];
  if (!allowed.includes(root)) {
    errors.push(`${path} — root element is <${root}>, expected ${allowed.map((r) => `<${r}>`).join(" or ")}`);
    return false;
  }
  if (!/xmlns\s*=\s*"http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(body)) {
    errors.push(`${path} — <${root}> is missing the sitemaps.org 0.9 xmlns declaration`);
  }

  // --- entries: each must carry exactly one absolute http(s) <loc> ---
  const entryTag = root === "sitemapindex" ? "sitemap" : "url";
  const entries = [...body.matchAll(new RegExp(`<${entryTag}>([\\s\\S]*?)</${entryTag}>`, "g"))].map(
    (m) => m[1],
  );
  if (entries.length === 0) {
    errors.push(`${path} — <${root}> contains no <${entryTag}> entries`);
    return false;
  }
  const seen = new Set();
  entries.forEach((entry, i) => {
    const locs = [...entry.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim());
    if (locs.length !== 1) {
      errors.push(`${path} — <${entryTag}> #${i + 1} has ${locs.length} <loc> elements, expected exactly 1`);
      return;
    }
    const loc = locs[0];
    if (!/^https?:\/\//.test(loc)) {
      errors.push(`${path} — <${entryTag}> #${i + 1} <loc> is not an absolute URL: "${loc}"`);
    } else if (seen.has(loc)) {
      errors.push(`${path} — duplicate <loc> ${loc}`);
    } else {
      seen.add(loc);
      // Page URLs get fetched later to prove they actually resolve.
      if (entryTag === "url" && !pageLocs.includes(loc)) pageLocs.push(loc);
    }

    const lastmod = entry.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim();
    if (lastmod !== undefined && Number.isNaN(Date.parse(lastmod))) {
      errors.push(`${path} — <${entryTag}> #${i + 1} has an unparseable <lastmod>: "${lastmod}"`);
    }
  });

  note(root, entryTag, entries.length);
  if (errors.length === before) {
    structure.push(`${path} — <${root}> with ${entries.length} <${entryTag}> entries`);
  }
  return errors.length === before;
}




/** Unattached failures (server start, bad shard <loc>) that have no record. */
const globalErrorsStart = () => errors.filter((e) => !results.some((r) => r.errors.includes(e)));

try {
  await waitForServer();

  const root = await check("/sitemap.xml", { role: "index-or-urlset" });
  if (root && /<sitemapindex\b/.test(root)) {
    const locs = [...root.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) errors.push("/sitemap.xml — <sitemapindex> references no shards");
    for (const loc of locs) {
      let path;
      try {
        path = new URL(loc).pathname;
      } catch {
        errors.push(`/sitemap.xml — shard <loc> is not an absolute URL: ${loc}`);
        continue;
      }
      // ORIGIN already carries any --base-url sub-path; don't double it.
      if (BASE_PATH && path.startsWith(`${BASE_PATH}/`)) path = path.slice(BASE_PATH.length);
      // A shard must be a <urlset> — a nested index is invalid per protocol.
      await check(path, { expect: "urlset", role: "shard" });
    }
  }
  await check("/robots.txt", { xml: false, role: "robots" });
  // Every page URL advertised to crawlers must actually resolve.
  await checkAllLocs();
  // Capture evidence while the preview server is still up.
  screenshots = await captureFailureScreenshots();

} catch (error) {
  errors.push(error?.message ?? String(error));
} finally {
  shutdown();
}

for (const line of checked) console.log(`  ✓ ${line}`);
for (const line of structure) console.log(`  ✓ ${line}`);

// --- machine- and human-readable reports -----------------------------------
const globalErrors = globalErrorsStart().filter(
  (e) => !locResults.some((r) => e.startsWith(`<loc> ${r.loc} —`)),
);
const failed = results.filter((r) => !r.ok);
const failedLocs = locResults.filter((r) => !r.ok);
const timedRecords = [...results, ...locResults].filter((r) => r.timing && r.timing.attempts > 0);
const slowRecords = timedRecords.filter((r) => r.timing.slow);
const retriedRecords = timedRecords.filter((r) => r.timing.retries > 0);
const allDurations = timedRecords.map((r) => r.timing.slowestMs).filter((d) => typeof d === "number");
const slowest = timedRecords
  .slice()
  .sort((a, b) => (b.timing.slowestMs ?? 0) - (a.timing.slowestMs ?? 0))
  .slice(0, 10)
  .map((r) => ({ url: r.loc ?? r.path, slowestMs: r.timing.slowestMs, retries: r.timing.retries }));
const report = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  mode: REMOTE ? "remote" : "vite-preview",
  passed: errors.length === 0,
  summary: {
    fetched: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    locsChecked: locResults.length,
    locsPassed: locResults.length - failedLocs.length,
    locsFailed: failedLocs.length,
    locChecksSkipped: SKIP_LOC_CHECKS,
    errors: errors.length,
    slowRequests: slowRecords.length,
    failureScreenshots: screenshots.shots.filter((s) => s.captured).length,
    retriedRequests: retriedRecords.length,
    maxDurationMs: allDurations.length ? Math.max(...allDurations) : null,
    medianDurationMs: allDurations.length
      ? [...allDurations].sort((a, b) => a - b)[Math.floor(allDurations.length / 2)]
      : null,
  },
  settings: {
    maxRedirects: MAX_REDIRECTS,
    allowedRedirectHosts: ALLOWED_REDIRECT_HOSTS,
    locChecksSkipped: SKIP_LOC_CHECKS,
    concurrency: LOC_CONCURRENCY,
    retries: RETRIES,
    retryBaseDelayMs: RETRY_BASE_DELAY,
    requestTimeoutMs: REQUEST_TIMEOUT,
    slowThresholdMs: SLOW_THRESHOLD,
  },
  slowest,
  screenshots: {
    enabled: screenshots.enabled,
    reason: screenshots.reason,
    directory: SCREENSHOT_DIR,
    skippedForLimit: screenshots.skippedForLimit,
    shots: screenshots.shots,
  },
  globalErrors,
  results,
  locResults,
};


const jsonPath = resolve(process.env.SITEMAP_REPORT_JSON ?? "docs/generated/sitemap-verify-report.json");
const textPath = resolve(process.env.SITEMAP_REPORT_TXT ?? "docs/generated/sitemap-verify-report.txt");
const htmlPath = resolve(process.env.SITEMAP_REPORT_HTML ?? "docs/generated/sitemap-verify-report.html");
mkdirSync(dirname(jsonPath), { recursive: true });
mkdirSync(dirname(textPath), { recursive: true });
mkdirSync(dirname(htmlPath), { recursive: true });

/* ---------------------------------------------------------------------------
 * Regression comparison against the previous run's artifact.
 * Entries are keyed as `file:<path>` (sitemap/robots requests) and `loc:<url>`
 * (page reachability) so shards and URLs can be tracked across runs.
 * ------------------------------------------------------------------------ */
const entryKeys = () => [
  ...results.map((r) => ({ key: `file:${r.path}`, label: r.path, kind: "file", ok: r.ok !== false })),
  ...locResults.map((r) => ({ key: `loc:${r.loc}`, label: r.loc, kind: "loc", ok: r.ok !== false })),
];

function loadBaseline(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const map = new Map();
    for (const r of parsed.results ?? []) map.set(`file:${r.path}`, r.ok !== false);
    for (const r of parsed.locResults ?? []) map.set(`loc:${r.loc}`, r.ok !== false);
    return { path, generatedAt: parsed.generatedAt ?? null, passed: parsed.passed ?? null, map };
  } catch (error) {
    console.warn(`  ! could not read baseline ${path}: ${error.message}`);
    return null;
  }
}

let comparison = null;
if (COMPARE_ENABLED) {
  const baselinePath = resolve(COMPARE_BASELINE_ARG ?? jsonPath);
  const baseline = loadBaseline(baselinePath);
  const current = entryKeys();
  const newFailures = [];
  const stillFailing = [];
  const fixed = [];
  for (const entry of current) {
    const before = baseline?.map.get(entry.key);
    if (!entry.ok) {
      if (baseline && before === false) stillFailing.push(entry.label);
      else newFailures.push({ url: entry.label, kind: entry.kind, knownInBaseline: before !== undefined });
    } else if (before === false) {
      fixed.push(entry.label);
    }
  }
  // Global errors aren't tied to a URL — treat them as new unless the baseline also failed overall.
  if (globalErrors.length && (!baseline || baseline.passed !== false)) {
    for (const message of globalErrors) {
      newFailures.push({ url: message, kind: "global", knownInBaseline: false });
    }
  }
  const currentKeys = new Set(current.map((e) => e.key));
  const removed = baseline ? [...baseline.map.keys()].filter((k) => !currentKeys.has(k)).map((k) => k.split(":").slice(1).join(":")) : [];
  comparison = {
    enabled: true,
    mode: FAIL_ON_NEW_FAILURES ? "fail-on-new-failures" : "report-only",
    baselinePath,
    baselineFound: Boolean(baseline),
    baselineGeneratedAt: baseline?.generatedAt ?? null,
    newFailures,
    stillFailing,
    fixed,
    removed,
  };
  report.comparison = comparison;
}

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "Served sitemap verification report",
  `Generated: ${report.generatedAt}`,
  `Origin:    ${ORIGIN} (${REMOTE ? "remote" : "vite preview on dist/"})`,
  `Result:    ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.fetched} URLs OK, ${report.summary.errors} error(s))`,
  `Settings:  max-redirects=${MAX_REDIRECTS}  allowed-redirect-hosts=${ALLOWED_REDIRECT_HOSTS.length ? ALLOWED_REDIRECT_HOSTS.join(", ") : "(any)"}  loc-checks=${SKIP_LOC_CHECKS ? "skipped" : "on"}`,
  `           concurrency=${LOC_CONCURRENCY}  retries=${RETRIES}  retry-base-delay=${RETRY_BASE_DELAY}ms  request-timeout=${REQUEST_TIMEOUT}ms  slow-threshold=${SLOW_THRESHOLD}ms`,
  `Timing:    max=${report.summary.maxDurationMs ?? "-"}ms  median=${report.summary.medianDurationMs ?? "-"}ms  slow=${report.summary.slowRequests}  retried=${report.summary.retriedRequests}`,
  "",
];
if (screenshots.shots.length || screenshots.reason) {
  lines.push(
    "Failure screenshots:",
    `  directory: ${SCREENSHOT_DIR}`,
    `  status:    ${screenshots.reason ?? `${screenshots.shots.filter((x) => x.captured).length}/${screenshots.shots.length} captured`}`,
    ...screenshots.shots.map(
      (x) => `  - ${x.loc} [${x.status ?? "-"}] -> ${x.captured ? x.file : `NOT CAPTURED (${x.error ?? "unknown"})`}`,
    ),
    screenshots.skippedForLimit ? `  (${screenshots.skippedForLimit} further failing page(s) not screenshotted; --screenshot-limit)` : "",
    "",
  );
}
if (comparison) {
  lines.push(
    "Comparison:",
    `  baseline:      ${comparison.baselineFound ? `${comparison.baselinePath} (${comparison.baselineGeneratedAt ?? "unknown date"})` : `${comparison.baselinePath} (not found — all failures treated as new)`}`,
    `  mode:          ${comparison.mode}`,
    `  new failures:  ${comparison.newFailures.length}${comparison.newFailures.length ? ` -> ${comparison.newFailures.map((f) => f.url).join(", ")}` : ""}`,
    `  still failing: ${comparison.stillFailing.length}${comparison.stillFailing.length ? ` -> ${comparison.stillFailing.join(", ")}` : ""}`,
    `  fixed:         ${comparison.fixed.length}${comparison.fixed.length ? ` -> ${comparison.fixed.join(", ")}` : ""}`,
    `  removed:       ${comparison.removed.length}${comparison.removed.length ? ` -> ${comparison.removed.join(", ")}` : ""}`,
    "",
  );
}

const timingLine = (t) =>
  `      timing: last=${t.lastMs ?? "-"}ms slowest=${t.slowestMs ?? "-"}ms total=${t.totalMs}ms` +
  ` attempts=${t.attempts} retries=${t.retries}${t.slow ? "  ⚠ SLOW" : ""}`;
for (const r of results) {
  lines.push(
    `${r.ok ? "PASS" : "FAIL"}  ${r.path}  [${r.role}]  status=${r.status ?? "no response"}` +
      (r.document ? `  <${r.document.root}> ${r.document.entries} ${r.document.entryTag} entries` : ""),
  );
  lines.push(
    `      bytes: transferred=${r.bytes.transferred ?? "-"} decoded=${r.bytes.decoded ?? "-"}` +
      `  gzip: expected=${r.gzip.expected} served=${r.gzip.served}`,
  );
  lines.push(timingLine(r.timing));
  const headerKeys = Object.keys(r.headers);
  if (headerKeys.length === 0) {
    lines.push("      headers: (none — request failed)");
  } else {
    lines.push("      headers:");
    for (const key of headerKeys.sort()) lines.push(`        ${key}: ${r.headers[key]}`);
  }
  for (const message of r.errors) lines.push(`      ✗ ${message}`);
  lines.push("");
}
if (SKIP_LOC_CHECKS) {
  lines.push("Page <loc> reachability: skipped (--skip-loc-checks)", "");
} else if (locResults.length > 0) {
  lines.push(
    `Page <loc> reachability (${report.summary.locsPassed}/${report.summary.locsChecked} returned 200):`,
  );
  for (const r of locResults) {
    lines.push(
      `${r.ok ? "PASS" : "FAIL"}  ${r.loc}  status=${r.status ?? "no response"}` +
        (r.chain.length > 1 ? `  (${r.chain.length} hops)` : ""),
    );
    lines.push(timingLine(r.timing));
    if (r.chain.length > 1) {
      for (const hop of r.chain) {
        lines.push(`        ${hop.status} ${hop.url}${hop.location ? ` → ${hop.location}` : ""}`);
      }
    }
    for (const message of r.errors) lines.push(`      ✗ ${message}`);
  }
  lines.push("");
}
if (report.slowest.length > 0) {
  lines.push(`Slowest requests (threshold ${SLOW_THRESHOLD}ms):`);
  for (const s of report.slowest) {
    lines.push(`  ${String(s.slowestMs ?? "-").padStart(6)}ms  retries=${s.retries}  ${s.url}`);
  }
  lines.push("");
}
if (globalErrors.length > 0) {
  lines.push("Global errors (not tied to a single URL):");
  for (const message of globalErrors) lines.push(`  ✗ ${message}`);
  lines.push("");
}
writeFileSync(textPath, `${lines.join("\n")}\n`);

// --- HTML report -----------------------------------------------------------
/** Escape for safe interpolation into HTML text and attribute contexts. */
const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const badge = (ok) => `<span class="badge ${ok ? "ok" : "fail"}">${ok ? "PASS" : "FAIL"}</span>`;

/** Timing line shared by the file and <loc> detail panels. */
const timingHtml = (t) =>
  `<p class="muted">timing: last <b>${esc(t.lastMs ?? "-")}ms</b> · slowest ${esc(t.slowestMs ?? "-")}ms · total ${esc(t.totalMs)}ms · ${t.attempts} attempt(s), ${t.retries} retry(ies)${t.slow ? ` · <b>SLOW (≥${SLOW_THRESHOLD}ms)</b>` : ""}</p>` +
  (t.attemptDetails.length > 1
    ? `<table class="headers"><caption>Attempts</caption>${t.attemptDetails
        .map(
          (a) =>
            `<tr><th>#${a.attempt}</th><td>${esc(a.status ?? "error")} · ${esc(a.durationMs ?? "-")}ms${a.error ? ` · ${esc(a.error)}` : ""}</td></tr>`,
        )
        .join("")}</table>`
    : "");

const fileSections = results
  .map((r) => {
    const headerRows = Object.keys(r.headers)
      .sort()
      .map((k) => `<tr><th>${esc(k)}</th><td>${esc(r.headers[k])}</td></tr>`)
      .join("");
    return `<details class="row ${r.ok ? "ok" : "fail"}"${r.ok ? "" : " open"}>
  <summary>${badge(r.ok)} <code>${esc(r.path)}</code> <span class="muted">[${esc(r.role)}]</span>
    <span class="status">status ${esc(r.status ?? "no response")}</span>
    ${r.document ? `<span class="muted">&lt;${esc(r.document.root)}&gt; · ${r.document.entries} ${esc(r.document.entryTag)} entries</span>` : ""}
  </summary>
  <div class="body">
    <p class="muted">bytes transferred ${esc(r.bytes.transferred ?? "-")} · decoded ${esc(r.bytes.decoded ?? "-")} · gzip expected ${r.gzip.expected} / served ${r.gzip.served}</p>
    ${timingHtml(r.timing)}
    ${r.errors.length ? `<ul class="errs">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    ${headerRows ? `<table class="headers"><caption>Response headers</caption>${headerRows}</table>` : `<p class="muted">No headers (request failed).</p>`}
  </div>
</details>`;
  })
  .join("\n");

const locSections = locResults
  .map((r) => {
    const chain = r.chain.length
      ? `<ol class="chain">${r.chain
          .map(
            (h) =>
              `<li><span class="status">${esc(h.status)}</span> <a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.url)}</a>${h.location ? ` → ${esc(h.location)}` : ""}</li>`,
          )
          .join("")}</ol>`
      : `<p class="muted">No response recorded.</p>`;
    return `<details class="row ${r.ok ? "ok" : "fail"}"${r.ok ? "" : " open"}>
  <summary>${badge(r.ok)} <a href="${esc(r.loc)}" target="_blank" rel="noreferrer">${esc(r.loc)}</a>
    <span class="status">status ${esc(r.status ?? "no response")}</span>${r.chain.length > 1 ? ` <span class="muted">(${r.chain.length} hops)</span>` : ""}
  </summary>
  <div class="body">
    ${timingHtml(r.timing)}
    ${r.errors.length ? `<ul class="errs">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    ${chain}
  </div>
</details>`;
  })
  .join("\n");

const failedLocLinks = failedLocs.length
  ? `<section class="panel fail-panel">
  <h2>Failed &lt;loc&gt; entries (${failedLocs.length})</h2>
  <ul class="failed-links">
    ${failedLocs
      .map(
        (r) =>
          `<li><a href="${esc(r.url ?? r.loc)}" target="_blank" rel="noreferrer">${esc(r.loc)}</a> <span class="status">${esc(r.status ?? "no response")}</span>${r.errors.length ? ` — ${esc(r.errors.join("; "))}` : ""}</li>`,
      )
      .join("")}
  </ul>
</section>`
  : "";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Sitemap verification report — ${report.passed ? "PASS" : "FAIL"}</title>
<style>
  :root { color-scheme: light dark; --ok:#16794a; --fail:#b3261e; --muted:#6b7280; --line:#d8dbe0; --bg:#fbfcfd; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root { --line:#2c313a; --bg:#0f1115; --card:#161a20; --muted:#98a1ae; --ok:#4ade80; --fail:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 920px; margin: 0 auto; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; }
  h2 { font-size:1.05rem; margin:0 0 .75rem; }
  code, .status { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
  .muted { color:var(--muted); font-weight:400; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:1rem 1.15rem; margin:0 0 1.25rem; }
  .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.75rem; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:.6rem .75rem; }
  .stat b { display:block; font-size:1.35rem; }
  .verdict { display:inline-block; padding:.25rem .7rem; border-radius:999px; font-weight:700; color:#fff; background:var(--ok); }
  .verdict.fail { background:var(--fail); }
  .badge { display:inline-block; min-width:3.4rem; text-align:center; padding:.1rem .45rem; border-radius:6px; font-size:.72rem; font-weight:700; color:#fff; background:var(--ok); }
  .badge.fail { background:var(--fail); }
  details.row { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--ok); border-radius:10px; margin:0 0 .55rem; }
  details.row.fail { border-left-color:var(--fail); }
  summary { cursor:pointer; padding:.6rem .8rem; display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  .body { padding:0 .8rem .8rem; border-top:1px solid var(--line); }
  table.headers { width:100%; border-collapse:collapse; margin-top:.5rem; font-size:.85rem; }
  table.headers caption { text-align:left; color:var(--muted); padding:.4rem 0; }
  table.headers th { text-align:left; width:14rem; vertical-align:top; font-weight:600; padding:.2rem .5rem .2rem 0; word-break:break-all; }
  table.headers td { word-break:break-all; padding:.2rem 0; }
  ul.errs { color:var(--fail); margin:.5rem 0; padding-left:1.1rem; }
  ol.chain { padding-left:1.2rem; }
  .fail-panel { border-color:var(--fail); }
  .failed-links a { color:var(--fail); }
  a { color:inherit; }
  .toolbar { display:flex; gap:.5rem; margin:0 0 .75rem; }
  button { font:inherit; padding:.35rem .75rem; border:1px solid var(--line); border-radius:8px; background:var(--card); cursor:pointer; }
</style>
</head>
<body>
<main>
  <h1>Served sitemap verification report</h1>
  <p class="muted">Generated ${esc(report.generatedAt)} · Origin <code>${esc(ORIGIN)}</code> · Mode ${esc(report.mode)}</p>

  <section class="panel">
    <p><span class="verdict ${report.passed ? "" : "fail"}">${report.passed ? "PASS" : "FAIL"}</span></p>
    <div class="summary-grid">
      <div class="stat"><b>${report.summary.fetched}</b><span class="muted">files fetched</span></div>
      <div class="stat"><b>${report.summary.passed}</b><span class="muted">files OK</span></div>
      <div class="stat"><b>${report.summary.failed}</b><span class="muted">files failed</span></div>
      <div class="stat"><b>${report.summary.locChecksSkipped ? "—" : report.summary.locsChecked}</b><span class="muted">&lt;loc&gt; checked</span></div>
      <div class="stat"><b>${report.summary.locChecksSkipped ? "—" : report.summary.locsFailed}</b><span class="muted">&lt;loc&gt; failed</span></div>
      <div class="stat"><b>${report.summary.errors}</b><span class="muted">total errors</span></div>
      <div class="stat"><b>${report.summary.maxDurationMs ?? "—"}${report.summary.maxDurationMs == null ? "" : "ms"}</b><span class="muted">slowest request</span></div>
      <div class="stat"><b>${report.summary.medianDurationMs ?? "—"}${report.summary.medianDurationMs == null ? "" : "ms"}</b><span class="muted">median request</span></div>
      <div class="stat"><b>${report.summary.slowRequests}</b><span class="muted">slow (&ge;${report.settings.slowThresholdMs}ms)</span></div>
      <div class="stat"><b>${report.summary.retriedRequests}</b><span class="muted">needed retries</span></div>
    </div>
    <p class="muted">Redirect policy: max <code>${report.settings.maxRedirects}</code> hop(s) ·
      allowed redirect hosts <code>${esc(report.settings.allowedRedirectHosts.length ? report.settings.allowedRedirectHosts.join(", ") : "(any)")}</code> ·
      &lt;loc&gt; checks ${report.settings.locChecksSkipped ? "skipped" : "on"}</p>
    <p class="muted">Request policy: concurrency <code>${report.settings.concurrency}</code> ·
      retries <code>${report.settings.retries}</code> with exponential backoff from <code>${report.settings.retryBaseDelayMs}ms</code> ·
      timeout <code>${report.settings.requestTimeoutMs}ms</code> ·
      slow threshold <code>${report.settings.slowThresholdMs}ms</code></p>
  </section>

  ${
    report.slowest.length
      ? `<section class="panel">
    <h2>Slowest requests</h2>
    <table class="headers">${report.slowest
      .map(
        (s) =>
          `<tr><th>${esc(s.slowestMs ?? "-")}ms${s.retries ? ` <span class="muted">(${s.retries} retr${s.retries === 1 ? "y" : "ies"})</span>` : ""}</th><td><code>${esc(s.url)}</code></td></tr>`,
      )
      .join("")}</table>
  </section>`
      : ""
  }


  ${failedLocLinks}

  ${
    globalErrors.length
      ? `<section class="panel fail-panel"><h2>Global errors</h2><ul class="errs">${globalErrors
          .map((e) => `<li>${esc(e)}</li>`)
          .join("")}</ul></section>`
      : ""
  }

  ${
    screenshots.shots.length
      ? `<section class="panel">
    <h2>Failure screenshots</h2>
    <p class="muted">Directory: ${esc(SCREENSHOT_DIR)}${
      screenshots.skippedForLimit ? ` · ${screenshots.skippedForLimit} further failing page(s) not captured (--screenshot-limit)` : ""
    }</p>
    ${screenshots.shots
      .map(
        (x) => `<details class="row"${x.captured ? "" : " open"}>
      <summary><a href="${esc(x.loc)}">${esc(x.loc)}</a> — status ${esc(String(x.status ?? "-"))} ${
        x.captured ? "" : `(screenshot failed: ${esc(x.error ?? "unknown")})`
      }</summary>
      ${
        x.captured
          ? `<a href="${esc(relative(dirname(htmlPath), x.file))}"><img src="${esc(relative(dirname(htmlPath), x.file))}" alt="Screenshot of ${esc(x.loc)}" style="max-width:100%;border-radius:8px;border:1px solid rgba(128,128,128,.35)" /></a>`
          : ""
      }
      ${
        x.consoleErrors?.length
          ? `<ul class="errs">${x.consoleErrors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
          : ""
      }
    </details>`,
      )
      .join("")}
  </section>`
      : screenshots.reason && screenshots.reason !== "no failing <loc> pages"
        ? `<section class="panel"><h2>Failure screenshots</h2><p class="muted">${esc(screenshots.reason)}</p></section>`
        : ""
  }

  ${
    comparison
      ? `<section class="panel${comparison.newFailures.length ? " fail-panel" : ""}">
    <h2>Comparison with previous run</h2>
    <p class="muted">Baseline: ${esc(comparison.baselinePath)}${
      comparison.baselineFound ? ` (${esc(comparison.baselineGeneratedAt ?? "unknown date")})` : " — not found, all failures treated as new"
    } · mode: ${esc(comparison.mode)}</p>
    <ul class="errs">
      <li><strong>New failures:</strong> ${comparison.newFailures.length}${
        comparison.newFailures.length
          ? `<ul>${comparison.newFailures.map((f) => `<li><a href="${esc(f.url)}">${esc(f.url)}</a> (${esc(f.kind)})</li>`).join("")}</ul>`
          : ""
      }</li>
      <li><strong>Still failing:</strong> ${comparison.stillFailing.length}${
        comparison.stillFailing.length ? `<ul>${comparison.stillFailing.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""
      }</li>
      <li><strong>Fixed:</strong> ${comparison.fixed.length}${
        comparison.fixed.length ? `<ul>${comparison.fixed.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""
      }</li>
      <li><strong>Removed since baseline:</strong> ${comparison.removed.length}</li>
    </ul>
  </section>`
      : ""
  }



  <div class="toolbar">
    <button type="button" data-toggle="open">Expand all</button>
    <button type="button" data-toggle="close">Collapse all</button>
  </div>

  <section class="panel">
    <h2>Sitemap &amp; robots requests</h2>
    ${fileSections || `<p class="muted">No requests recorded.</p>`}
  </section>

  <section class="panel">
    <h2>Page &lt;loc&gt; reachability</h2>
    ${SKIP_LOC_CHECKS ? `<p class="muted">Skipped (--skip-loc-checks).</p>` : locSections || `<p class="muted">No page URLs discovered.</p>`}
  </section>
</main>
<script>
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const open = btn.dataset.toggle === "open";
      document.querySelectorAll("details.row").forEach((d) => { d.open = open; });
    });
  });
</script>
</body>
</html>
`;
writeFileSync(htmlPath, html);
console.log(`  ✓ report written to ${jsonPath}, ${textPath} and ${htmlPath}`);

if (comparison) {
  console.log(
    `  compare: ${comparison.newFailures.length} new failure(s), ${comparison.stillFailing.length} pre-existing, ${comparison.fixed.length} fixed` +
      `${comparison.baselineFound ? "" : "  (no baseline found)"}`,
  );
}

if (FAIL_ON_NEW_FAILURES) {
  // Regression mode: only new failures break the build; known ones are noise.
  if (comparison.newFailures.length > 0) {
    console.error("\n✗ new sitemap failures since the previous run:");
    for (const f of comparison.newFailures) {
      console.error(`  - ${f.url} (${f.kind}${f.knownInBaseline ? "" : ", not present in baseline"})`);
    }
    console.error(`  see ${textPath} for full status/header detail`);
    process.exit(1);
  }
  if (errors.length > 0) {
    console.warn("\n! pre-existing failures ignored (--fail-on-new-failures):");
    for (const message of errors) console.warn(`  - ${message}`);
  }
  console.log("✓ no new sitemap failures since the previous run");
  process.exit(0);
}

if (errors.length > 0) {
  console.error("\n✗ served sitemap check failed:");
  for (const message of errors) console.error(`  - ${message}`);
  console.error(`  see ${textPath} for full status/header detail`);
  process.exit(1);
}


console.log(
  `✓ served sitemap check passed (${checked.length} file(s) fetched over HTTP, ` +
    `${SKIP_LOC_CHECKS ? "loc checks skipped" : `${locResults.length} page <loc> URL(s) reachable`})`,
);


