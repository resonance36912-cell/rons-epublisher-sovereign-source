#!/usr/bin/env node
/**
 * Edge-function stress harness.
 *
 * Hammers `generate-storyboard` and `generate-chapter-image` with a
 * configurable workload and reports per-endpoint latency percentiles,
 * success rate, and error breakdown.
 *
 * Usage:
 *   node scripts/edge-stress-harness.mjs                 # defaults
 *   STRESS_REQUESTS=20 STRESS_CONCURRENCY=4 \
 *     node scripts/edge-stress-harness.mjs
 *   node scripts/edge-stress-harness.mjs --only=storyboard
 *
 * Required env (any one of each pair works):
 *   VITE_SUPABASE_URL          | SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY     | SUPABASE_ANON_KEY | SUPABASE_PUBLISHABLE_KEY
 *
 * Auth (one of):
 *   STRESS_USER_JWT            – paste an access_token directly, OR
 *   STRESS_USER_EMAIL + STRESS_USER_PASSWORD – signs in via password grant
 *
 * Knobs:
 *   STRESS_REQUESTS            (default 10)  – total requests per endpoint
 *   STRESS_CONCURRENCY         (default 3)   – parallel in-flight requests
 *   STRESS_TIMEOUT_MS          (default 70000)
 *   STRESS_REPORT_PATH         (default /mnt/documents/edge-stress-report.json)
 *
 * The harness intentionally uses a small kid-friendly storyline so storyboard
 * generation stays well under the 55s AI cap and image prompts are safe.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Missing SUPABASE_URL / ANON_KEY. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
  process.exit(2);
}

const REQUESTS = Number(process.env.STRESS_REQUESTS ?? 10);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT_MS ?? 70_000);
const REPORT_PATH =
  process.env.STRESS_REPORT_PATH || "/mnt/documents/edge-stress-report.json";

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split(
  "=",
)[1];

// ───────────────────────── auth ─────────────────────────

async function resolveJwt() {
  if (process.env.STRESS_USER_JWT) return process.env.STRESS_USER_JWT;
  const email = process.env.STRESS_USER_EMAIL;
  const password = process.env.STRESS_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set STRESS_USER_JWT, or STRESS_USER_EMAIL + STRESS_USER_PASSWORD.",
    );
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Sign-in failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

// ──────────────────────── workload ─────────────────────────

const STORYLINE_TOPIC =
  "A short, friendly children's lesson about kindness and noticing nature.";

const STORYBOARD_BODY = {
  mode: "outline",
  sources: [
    {
      type: "url",
      title: "Kindness primer",
      status: "ready",
      content:
        "Kindness is noticing what others feel and responding with care. " +
        "Children practice kindness by sharing, listening, and helping a friend. " +
        STORYLINE_TOPIC,
    },
  ],
  config: {
    theme: "Documentary",
    tone: "warm",
    chapterCount: 4,
    audience: "kids",
  },
  storylineMode: "guided",
  storylineGuide: STORYLINE_TOPIC,
  chapterTitles: "Noticing\nSharing\nListening\nHelping",
};

const IMAGE_BODY = {
  imagePrompt:
    "Watercolor illustration of two friendly children planting a sapling in a sunny meadow, soft pastel palette, storybook style.",
  imageStyle: "watercolor",
  mode: "auto",
  rawPromptMode: false,
  chapterId: process.env.STRESS_CHAPTER_ID,
};

// ──────────────────────── runner ─────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function callEdge(name, body, jwt) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  let status = 0;
  let ok = false;
  let errorKind = null;
  let errorMessage = null;
  let payload = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = res.status;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 400) }; }
    ok = res.ok && !payload?.error;
    if (!ok) {
      errorKind = `http_${status}`;
      errorMessage = String(payload?.error ?? `HTTP ${status}`).slice(0, 200);
    }
  } catch (e) {
    errorKind = e.name === "AbortError" ? "timeout" : "network";
    errorMessage = String(e.message || e).slice(0, 200);
  } finally {
    clearTimeout(timer);
  }
  return {
    durationMs: Math.round(performance.now() - t0),
    status,
    ok,
    errorKind,
    errorMessage,
  };
}

async function runEndpoint(name, body, jwt) {
  console.log(
    `\n▶ ${name}: ${REQUESTS} req @ concurrency ${CONCURRENCY} (timeout ${TIMEOUT_MS}ms)`,
  );
  const results = [];
  let nextIdx = 0;
  let inflight = 0;
  let done = 0;
  await new Promise((resolve) => {
    const launch = () => {
      while (inflight < CONCURRENCY && nextIdx < REQUESTS) {
        const idx = nextIdx++;
        inflight++;
        callEdge(name, body, jwt).then((r) => {
          results.push(r);
          inflight--;
          done++;
          process.stdout.write(
            `\r  ${done}/${REQUESTS} done — ` +
              `ok ${results.filter((x) => x.ok).length} · ` +
              `err ${results.filter((x) => !x.ok).length}`,
          );
          if (done === REQUESTS) {
            process.stdout.write("\n");
            resolve();
          } else {
            launch();
          }
        });
      }
    };
    launch();
  });

  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.length - okCount;

  const errorBreakdown = {};
  for (const r of results) {
    if (r.ok) continue;
    const key = r.errorKind || "unknown";
    errorBreakdown[key] = (errorBreakdown[key] || 0) + 1;
  }
  const sampleErrors = results
    .filter((r) => !r.ok)
    .slice(0, 5)
    .map((r) => ({ status: r.status, kind: r.errorKind, msg: r.errorMessage }));

  const summary = {
    endpoint: name,
    requests: results.length,
    concurrency: CONCURRENCY,
    okCount,
    errCount,
    errorRate: results.length ? errCount / results.length : 0,
    latencyMs: {
      min: latencies[0] ?? 0,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] ?? 0,
      meanMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0,
    },
    errorBreakdown,
    sampleErrors,
  };

  console.log(
    `  ✓ ok=${okCount}/${results.length} (errors: ${(summary.errorRate * 100).toFixed(1)}%)`,
  );
  console.log(
    `  latency ms: p50=${summary.latencyMs.p50} p95=${summary.latencyMs.p95} ` +
      `p99=${summary.latencyMs.p99} max=${summary.latencyMs.max}`,
  );
  if (Object.keys(errorBreakdown).length) {
    console.log(`  errors:`, errorBreakdown);
  }
  return summary;
}

// ───────────────────────── main ─────────────────────────

(async () => {
  const jwt = await resolveJwt();

  const endpoints = [];
  if (!ONLY || ONLY === "storyboard") {
    endpoints.push(["generate-storyboard", STORYBOARD_BODY]);
  }
  if (!ONLY || ONLY === "image") {
    endpoints.push(["generate-chapter-image", IMAGE_BODY]);
  }
  if (endpoints.length === 0) {
    console.error(`Unknown --only=${ONLY}. Use 'storyboard' or 'image'.`);
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const summaries = [];
  for (const [name, body] of endpoints) {
    summaries.push(await runEndpoint(name, body, jwt));
  }

  const totalOk = summaries.reduce((a, s) => a + s.okCount, 0);
  const totalErr = summaries.reduce((a, s) => a + s.errCount, 0);
  const totalReq = summaries.reduce((a, s) => a + s.requests, 0);

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: Math.round(performance.now() - t0),
    config: { requests: REQUESTS, concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS },
    totals: {
      requests: totalReq,
      ok: totalOk,
      err: totalErr,
      errorRate: totalReq ? totalErr / totalReq : 0,
    },
    endpoints: summaries,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report written to ${REPORT_PATH}`);
  console.log(
    `  totals: ok=${totalOk}/${totalReq} (error rate ${(report.totals.errorRate * 100).toFixed(1)}%)`,
  );

  // Non-zero exit if anything failed, so CI can gate on this.
  process.exit(totalErr > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Harness aborted:", e);
  process.exit(2);
});
