#!/usr/bin/env node
/**
 * Generates public/sitemap.xml. Runs automatically via the `predev` and
 * `prebuild` npm hooks, so `lastmod` never needs a manual edit.
 *
 * Output shape scales with the route count:
 *   - Up to MAX_URLS_PER_SITEMAP URLs → a single public/sitemap.xml <urlset>.
 *   - Above that → public/sitemap-1.xml … sitemap-N.xml shards plus a
 *     public/sitemap.xml <sitemapindex> pointing at them. The advertised URL
 *     never changes, so robots.txt and Search Console keep working either way.
 * Stale shards from a previous, larger build are deleted.
 *
 * `lastmod` source of truth (in priority order, per URL):
 *   1. The git author date of the last commit touching that page's source
 *      file(s) — a real, page-specific content-change timestamp.
 *   2. The value already present in the published sitemap (used when git
 *      history is unavailable, e.g. a shallow CI checkout) so we never regress
 *      to a build-time "now" stamp.
 *   3. Omitted entirely. An absent <lastmod> is correct; a fabricated one
 *      (build time / current date) is a lie that trains crawlers to ignore it.
 *
 * Routes are read from scripts/site-routes.mjs — the same module
 * scripts/generate-robots.mjs uses — so disallowed routes are excluded here
 * and blocked there from one source of truth.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { BASE_URL, HUB_URL, hubCanonical, publicRoutes } from "./site-routes.mjs";

const PUBLIC_DIR = resolve("public");
const SITEMAP_PATH = resolve(PUBLIC_DIR, "sitemap.xml");

/**
 * Sitemaps.org caps a single file at 50,000 URLs (and 50MB). Override with
 * --max-urls=N or SITEMAP_MAX_URLS to exercise the split path locally.
 */
const MAX_URLS_PER_SITEMAP = (() => {
  const flag = process.argv.find((arg) => arg.startsWith("--max-urls="))?.split("=")[1];
  const value = Number(flag ?? process.env.SITEMAP_MAX_URLS ?? 50000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50000;
})();

const shardName = (index) => `sitemap-${index + 1}.xml`;

// --- lastmod resolution ------------------------------------------------------
/**
 * Returns { date, file, perFile, failures } for the newest git commit date
 * across `files`. `perFile` records every file's own last-commit date and
 * `failures` records files git could not date (untracked, missing, no git).
 */
function gitLastModified(files) {
  let newest = null;
  let newestFile = null;
  const perFile = {};
  const failures = [];
  for (const file of files) {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) {
        perFile[file] = out;
        if (!newest || out > newest) {
          newest = out;
          newestFile = file;
        }
      } else {
        failures.push({ file, reason: "no commit history for path" });
      }
    } catch (error) {
      failures.push({ file, reason: (error?.message ?? "git failed").split("\n")[0] });
    }
  }
  return { date: newest, file: newestFile, perFile, failures };
}

/** Existing sitemap files on disk (root plus any shards from a previous run). */
function existingSitemapFiles() {
  if (!existsSync(PUBLIC_DIR)) return [];
  return readdirSync(PUBLIC_DIR)
    .filter((name) => name === "sitemap.xml" || /^sitemap-\d+\.xml$/.test(name))
    .map((name) => resolve(PUBLIC_DIR, name));
}

/** Previously published lastmod values, keyed by absolute loc (all shards). */
function existingLastmods() {
  const map = {};
  for (const file of existingSitemapFiles()) {
    const xml = readFileSync(file, "utf8");
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
      map[m[1]] = m[2];
    }
  }
  return map;
}

// --- build -------------------------------------------------------------------
const VERBOSE = process.argv.includes("--verbose") || process.env.SITEMAP_AUDIT === "1";
const previous = existingLastmods();
const entries = publicRoutes();

/** Per-URL provenance rows, printed as an audit table after generation. */
const audit = [];

const urls = entries.map((entry) => {
  const loc = `${BASE_URL}${entry.path}`;
  const git = gitLastModified(entry.sources);
  const fallback = previous[loc] ?? null;

  let lastmod = null;
  let source = "omitted";
  let detail = "no git date and no previously published value";

  if (git.date) {
    lastmod = git.date;
    source = "git";
    detail = `last commit touching ${git.file}`;
  } else if (fallback) {
    lastmod = fallback;
    source = "fallback";
    detail = "carried over from the previously published sitemap.xml";
  }

  audit.push({ loc, path: entry.path, lastmod, source, detail, git, fallback });

  return {
    lastmod,
    xml: [
      `  <!-- canonical: ${hubCanonical(entry.path)} -->`,
      `  <url>`,
      `    <loc>${loc}</loc>`,
      lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
});

const banner = (extra) =>
  [
    `<!--`,
    `  GENERATED FILE — do not edit by hand.`,
    `  Source: scripts/generate-sitemap.mjs (runs on predev/prebuild).`,
    `  Each URL serves a <link rel="canonical"> pointing at its Hub equivalent on`,
    `  ${HUB_URL} (see src/components/Seo.tsx and index.html), so crawlers`,
    `  discover the spoke pages here and consolidate indexing onto the Hub.`,
    `  <lastmod> is the last git commit date of that page's source file(s).`,
    `  Routes disallowed in robots.txt are excluded.`,
    ...(extra ? [`  ${extra}`] : []),
    `-->`,
  ].join("\n");

const urlsetDocument = (chunk, extra) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    banner(extra),
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...chunk.map((url) => url.xml),
    `</urlset>`,
    ``,
  ].join("\n");

const indexDocument = (shards) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    banner(
      `This is a sitemap index: the URLs live in the ${shards.length} child sitemaps below ` +
        `(split at ${MAX_URLS_PER_SITEMAP} URLs each).`,
    ),
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...shards.map(({ name, lastmod }) =>
      [
        `  <sitemap>`,
        `    <loc>${BASE_URL}/${name}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        `  </sitemap>`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `</sitemapindex>`,
    ``,
  ].join("\n");

/** Split into chunks of at most MAX_URLS_PER_SITEMAP entries. */
const chunks = [];
for (let i = 0; i < urls.length; i += MAX_URLS_PER_SITEMAP) {
  chunks.push(urls.slice(i, i + MAX_URLS_PER_SITEMAP));
}

const written = [];
if (chunks.length <= 1) {
  writeFileSync(SITEMAP_PATH, urlsetDocument(urls));
  written.push({ name: "sitemap.xml", count: urls.length, kind: "urlset" });
} else {
  const shards = chunks.map((chunk, i) => {
    const name = shardName(i);
    writeFileSync(
      resolve(PUBLIC_DIR, name),
      urlsetDocument(chunk, `Shard ${i + 1} of ${chunks.length}; indexed by /sitemap.xml.`),
    );
    written.push({ name, count: chunk.length, kind: "urlset" });
    // Newest page date in the shard — tells crawlers whether to refetch it.
    const lastmod = chunk
      .map((url) => url.lastmod)
      .filter(Boolean)
      .sort()
      .at(-1);
    return { name, lastmod };
  });
  writeFileSync(SITEMAP_PATH, indexDocument(shards));
  written.push({ name: "sitemap.xml", count: shards.length, kind: "sitemapindex" });
}

/** Delete shards left over from a build that produced more of them. */
const keep = new Set(written.map((file) => file.name));
for (const path of existingSitemapFiles()) {
  const name = basename(path);
  if (name !== "sitemap.xml" && !keep.has(name)) {
    rmSync(path);
    console.log(`removed stale shard public/${name}`);
  }
}

// --- lastmod provenance audit log -------------------------------------------
const ICON = { git: "✓", fallback: "~", omitted: "·" };
const counts = { git: 0, fallback: 0, omitted: 0 };
const pad = Math.max(...audit.map((row) => row.path.length));

if (chunks.length <= 1) {
  console.log(`sitemap.xml written (${entries.length} entries, single urlset)`);
} else {
  console.log(
    `sitemap.xml written as a sitemap index (${entries.length} entries across ` +
      `${chunks.length} shards, max ${MAX_URLS_PER_SITEMAP} URLs each):`,
  );
  for (const file of written.filter((f) => f.kind === "urlset")) {
    console.log(`  · public/${file.name} — ${file.count} URLs`);
  }
}
console.log("lastmod provenance:");
for (const row of audit) {
  counts[row.source] += 1;
  console.log(
    `  ${ICON[row.source]} ${row.path.padEnd(pad)}  ${(row.lastmod ?? "—").padEnd(10)}` +
      `  [${row.source}] ${row.detail}`,
  );

  const staleFallback = row.source === "fallback";
  if (VERBOSE || staleFallback || row.source === "omitted") {
    for (const [file, date] of Object.entries(row.git.perFile)) {
      console.log(`      · ${file} → ${date}`);
    }
    for (const failure of row.git.failures) {
      console.log(`      ! ${failure.file} → no git date (${failure.reason})`);
    }
    if (staleFallback && row.fallback) {
      console.log(`      ! previous value ${row.fallback} reused — verify it is still accurate`);
    }
  }
}
console.log(
  `summary: ${counts.git} git-derived, ${counts.fallback} carried-over, ${counts.omitted} omitted` +
    (VERBOSE ? "" : "  (run with --verbose for per-source-file dates)"),
);
if (counts.fallback > 0) {
  console.warn(
    `! ${counts.fallback} URL(s) fall back to a previously published lastmod — ` +
      `git history is unavailable for their sources (e.g. a shallow CI checkout).`,
  );
}
