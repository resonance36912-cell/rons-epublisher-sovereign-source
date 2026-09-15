#!/usr/bin/env node
/**
 * Build-time sitemap diff report.
 *
 * Compares the freshly generated public/sitemap.xml against the previously
 * deployed one so every build states exactly which URLs appeared, disappeared,
 * or changed <lastmod> — the values Google uses to decide what to re-crawl.
 *
 * Baseline resolution order:
 *   1. The live production sitemap (fetched from BASE_URL), unless --offline.
 *   2. docs/generated/sitemap-baseline.xml — the snapshot written by the
 *      previous run, used when the network is unavailable (CI sandboxes,
 *      offline dev) or production has no sitemap yet.
 *
 * After reporting, the current sitemap is stored as the new snapshot and a
 * markdown report is written to docs/generated/sitemap-diff.md.
 *
 * Runs automatically via the `prebuild` npm hook. Advisory by default —
 * pass --strict to fail the build when anything changed (useful when you want
 * a deploy to be an explicit, reviewed action).
 *
 * Usage:
 *   node scripts/diff-sitemap.mjs [--offline] [--strict] [--no-write]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { BASE_URL } from "./site-routes.mjs";

const args = new Set(process.argv.slice(2));
const OFFLINE = args.has("--offline") || process.env.SITEMAP_DIFF_OFFLINE === "1";
const STRICT = args.has("--strict");
const WRITE = !args.has("--no-write");

const CURRENT_PATH = resolve("public/sitemap.xml");
const SNAPSHOT_PATH = resolve("docs/generated/sitemap-baseline.xml");
const REPORT_PATH = resolve("docs/generated/sitemap-diff.md");
const LIVE_URL = `${BASE_URL}/sitemap.xml`;
const FETCH_TIMEOUT_MS = 8000;

/** Parse a <urlset> into an ordered Map of loc -> { lastmod, changefreq, priority }. */
function parseUrlset(xml) {
  const entries = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const field = (tag) => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() ?? null;
    const loc = field("loc");
    if (!loc) continue;
    entries.set(loc, {
      lastmod: field("lastmod"),
      changefreq: field("changefreq"),
      priority: field("priority"),
    });
  }
  return entries;
}

/**
 * Flattens a sitemap document into a single loc -> fields Map. When the
 * document is a <sitemapindex>, each child sitemap is loaded via `loadChild`
 * so the diff compares URLs, not shard boundaries.
 */
async function expandSitemap(xml, loadChild) {
  if (!/<sitemapindex\b/.test(xml)) return parseUrlset(xml);

  const entries = new Map();
  for (const [, loc] of xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)) {
    const childXml = await loadChild(loc.trim());
    if (!childXml) {
      console.log(`  note: could not load child sitemap ${loc.trim()} — its URLs are skipped.`);
      continue;
    }
    for (const [childLoc, fields] of parseUrlset(childXml)) entries.set(childLoc, fields);
  }
  return entries;
}

/** Serializes a flattened entry Map back into a plain urlset (snapshot format). */
function flattenToXml(entries) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Snapshot of the last generated sitemap set, flattened for diffing. -->`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...[...entries].map(([loc, f]) =>
      [
        `  <url>`,
        `    <loc>${loc}</loc>`,
        f.lastmod ? `    <lastmod>${f.lastmod}</lastmod>` : null,
        f.changefreq ? `    <changefreq>${f.changefreq}</changefreq>` : null,
        f.priority ? `    <priority>${f.priority}</priority>` : null,
        `  </url>`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `</urlset>`,
    ``,
  ].join("\n");
}

async function fetchXml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status} from ${url}` };
    const body = await response.text();
    if (!body.includes("<urlset") && !body.includes("<sitemapindex")) {
      return { ok: false, reason: `response from ${url} is not a sitemap` };
    }
    return { ok: true, xml: body };
  } catch (error) {
    const why = error.name === "AbortError" ? "timed out" : error.message;
    return { ok: false, reason: `could not reach ${url} (${why})` };
  } finally {
    clearTimeout(timer);
  }
}

/** Child loader for the live baseline: fetch each shard over the network. */
const remoteChildLoader = async (loc) => {
  const result = await fetchXml(loc);
  return result.ok ? result.xml : null;
};

/** Child loader for local files: read public/<shard>.xml off disk. */
const localChildLoader = async (loc) => {
  let name;
  try {
    name = basename(new URL(loc).pathname);
  } catch {
    return null;
  }
  const path = resolve("public", name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

async function resolveBaseline() {
  if (!OFFLINE) {
    const live = await fetchXml(LIVE_URL);
    if (live.ok) {
      return { source: "deployed", label: LIVE_URL, xml: live.xml, loadChild: remoteChildLoader };
    }
    console.log(`  note: ${live.reason} — falling back to the local snapshot.`);
  }
  if (existsSync(SNAPSHOT_PATH)) {
    return {
      source: "snapshot",
      label: "docs/generated/sitemap-baseline.xml (previous build)",
      xml: readFileSync(SNAPSHOT_PATH, "utf8"),
      loadChild: localChildLoader,
    };
  }
  return { source: "none", label: "no baseline available", xml: null };
}


function diffSitemaps(previous, current) {
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const [loc, next] of current) {
    const prev = previous.get(loc);
    if (!prev) {
      added.push({ loc, ...next });
      continue;
    }
    const fields = ["lastmod", "changefreq", "priority"].filter((f) => prev[f] !== next[f]);
    if (fields.length > 0) changed.push({ loc, fields, prev, next });
    else unchanged.push(loc);
  }
  for (const [loc, prev] of previous) {
    if (!current.has(loc)) removed.push({ loc, ...prev });
  }
  return { added, removed, changed, unchanged };
}

const fmt = (value) => value ?? "—";

function printReport(baseline, diff) {
  const { added, removed, changed, unchanged } = diff;
  console.log(`\nsitemap diff vs ${baseline.label}`);
  console.log("─".repeat(72));

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log(`  no changes — ${unchanged.length} URL(s) identical.`);
  }
  for (const entry of added) {
    console.log(`  + added    ${entry.loc}`);
    console.log(`               lastmod ${fmt(entry.lastmod)}, priority ${fmt(entry.priority)}`);
  }
  for (const entry of removed) {
    console.log(`  - removed  ${entry.loc}`);
    console.log(`               was lastmod ${fmt(entry.lastmod)} — Google will keep it indexed until it 404s or is de-listed`);
  }
  for (const entry of changed) {
    console.log(`  ~ changed  ${entry.loc}`);
    for (const field of entry.fields) {
      console.log(`               ${field}: ${fmt(entry.prev[field])} → ${fmt(entry.next[field])}`);
    }
  }
  if (added.length || removed.length || changed.length) {
    console.log(
      `  summary: ${added.length} added, ${removed.length} removed, ` +
        `${changed.length} changed, ${unchanged.length} unchanged.`,
    );
    if (changed.some((entry) => entry.fields.includes("lastmod"))) {
      console.log("  → publish this build so Google fetches the new lastmod values.");
    }
  }
  console.log("─".repeat(72));
}

function buildMarkdown(baseline, diff, currentEntries) {
  const { added, removed, changed, unchanged } = diff;
  const lines = [
    "# Sitemap diff report",
    "",
    "<!-- GENERATED FILE — written by scripts/diff-sitemap.mjs on each build. -->",
    "",
    `- Baseline: ${baseline.label}`,
    `- Current: \`public/sitemap.xml\` (${currentEntries.size} URLs)`,
    `- Result: **${added.length} added, ${removed.length} removed, ${changed.length} changed, ${unchanged.length} unchanged**`,
    "",
  ];

  if (added.length) {
    lines.push("## Added URLs", "", "| URL | lastmod | changefreq | priority |", "| --- | --- | --- | --- |");
    for (const e of added) lines.push(`| ${e.loc} | ${fmt(e.lastmod)} | ${fmt(e.changefreq)} | ${fmt(e.priority)} |`);
    lines.push("");
  }
  if (removed.length) {
    lines.push("## Removed URLs", "", "| URL | previous lastmod |", "| --- | --- |");
    for (const e of removed) lines.push(`| ${e.loc} | ${fmt(e.lastmod)} |`);
    lines.push("");
  }
  if (changed.length) {
    lines.push("## Changed URLs", "", "| URL | field | before | after |", "| --- | --- | --- | --- |");
    for (const e of changed) {
      for (const field of e.fields) {
        lines.push(`| ${e.loc} | ${field} | ${fmt(e.prev[field])} | ${fmt(e.next[field])} |`);
      }
    }
    lines.push("");
  }
  if (!added.length && !removed.length && !changed.length) {
    lines.push("No differences — the deployed sitemap is already current.", "");
  }
  return lines.join("\n");
}

const main = async () => {
  if (!existsSync(CURRENT_PATH)) {
    console.error("✗ public/sitemap.xml is missing — run scripts/generate-sitemap.mjs first.");
    process.exit(1);
  }
  const currentXml = readFileSync(CURRENT_PATH, "utf8");
  const isIndex = /<sitemapindex\b/.test(currentXml);
  const currentEntries = await expandSitemap(currentXml, localChildLoader);
  if (isIndex) {
    const shards = [...currentXml.matchAll(/<sitemap>[\s\S]*?<loc>/g)].length;
    console.log(`  current sitemap is an index of ${shards} shard(s); diffing all URLs.`);
  }

  const baseline = await resolveBaseline();
  if (baseline.source === "none") {
    console.log(
      `\nsitemap diff: no baseline yet (first run) — recording ${currentEntries.size} URL(s) ` +
        "as the baseline for the next build.",
    );
  } else {
    const baselineEntries = await expandSitemap(baseline.xml, baseline.loadChild);
    const diff = diffSitemaps(baselineEntries, currentEntries);
    printReport(baseline, diff);

    if (WRITE) {
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, buildMarkdown(baseline, diff, currentEntries));
      console.log(`  report: docs/generated/sitemap-diff.md`);
    }
    if (STRICT && (diff.added.length || diff.removed.length || diff.changed.length)) {
      console.error("✗ --strict: sitemap changed since the last deploy.");
      process.exit(1);
    }
  }

  if (WRITE) {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    // Snapshot the flattened URL set so the next run can diff it directly,
    // regardless of how the URLs were sharded in this build.
    writeFileSync(SNAPSHOT_PATH, flattenToXml(currentEntries));
  }

};

main();
