#!/usr/bin/env node
/**
 * Post-build deployment gate for the sitemap.
 *
 * `vite build` copies public/ into dist/, so the freshly generated sitemap
 * files are what ship to production. This verifies the build output actually
 * carries the current sitemap set (index + every shard) and robots.txt — a
 * stale or missing dist copy means Google would keep fetching old <lastmod>
 * values, and a missing shard means an index entry that 404s.
 *
 * Runs automatically via the `postbuild` npm hook.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const PUBLIC_DIR = resolve("public");
const DIST_DIR = resolve("dist");

/** sitemap.xml, robots.txt, and every generated shard. */
const sitemapFiles = existsSync(PUBLIC_DIR)
  ? readdirSync(PUBLIC_DIR).filter(
      (name) => name === "sitemap.xml" || /^sitemap-\d+\.xml$/.test(name),
    )
  : [];
const plainFiles = [...sitemapFiles, "robots.txt"];
/** Pre-compressed siblings must ship too, or gzip-capable crawlers 404. */
const gzipFiles = plainFiles.map((name) => `${name}.gz`).filter((name) => existsSync(resolve(PUBLIC_DIR, name)));
const CHECKS = [...plainFiles, ...gzipFiles].map((name) => ({
  source: `public/${name}`,
  output: `dist/${name}`,
  binary: name.endsWith(".gz"),
}));

const errors = [];

for (const { source, output, binary } of CHECKS) {
  const sourcePath = resolve(source);
  const outputPath = resolve(output);

  if (!existsSync(sourcePath)) {
    errors.push(`${source} is missing — generation did not run.`);
    continue;
  }
  if (!existsSync(outputPath)) {
    errors.push(`${output} is missing — it will not be deployed.`);
    continue;
  }
  const same = binary
    ? readFileSync(sourcePath).equals(readFileSync(outputPath))
    : readFileSync(sourcePath, "utf8") === readFileSync(outputPath, "utf8");
  if (!same) {
    errors.push(`${output} differs from ${source} — the build shipped a stale copy.`);
  }
}

// Every child sitemap referenced by an index must exist in dist/.
const distSitemap = resolve(DIST_DIR, "sitemap.xml");
let shardCount = 0;
if (existsSync(distSitemap)) {
  const xml = readFileSync(distSitemap, "utf8");
  if (/<sitemapindex\b/.test(xml)) {
    for (const [, loc] of xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)) {
      shardCount += 1;
      let name;
      try {
        name = basename(new URL(loc).pathname);
      } catch {
        errors.push(`dist/sitemap.xml lists an invalid child sitemap URL: ${loc}`);
        continue;
      }
      if (!existsSync(resolve(DIST_DIR, name))) {
        errors.push(`dist/sitemap.xml references ${loc} but dist/${name} will not be deployed.`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("✗ sitemap deployment check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

/** Newest lastmod across the index and all shards. */
const lastmods = [];
for (const { output } of CHECKS) {
  if (!output.endsWith(".xml")) continue;
  const xml = readFileSync(resolve(output), "utf8");
  lastmods.push(...[...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]));
}
const newest = [...lastmods].sort().at(-1) ?? "none";

console.log(
  `✓ ${CHECKS.map((c) => c.output).join(", ")} are current and will deploy ` +
    (shardCount > 0 ? `(sitemap index with ${shardCount} shards, ` : "(") +
    `${lastmods.length} lastmod values, newest ${newest}).`,
);
console.log(
  "  Live at https://www.resonanceonline.life/sitemap.xml once this build is published.",
);
