#!/usr/bin/env node
/**
 * Writes a pre-compressed `.gz` sibling for every generated sitemap file
 * (public/sitemap.xml plus any public/sitemap-N.xml shards) and robots.txt.
 *
 * Runs on `predev` / `prebuild` right after generation, so the compressed
 * copies can never be stale relative to the XML they mirror. Stale `.gz`
 * files whose source no longer exists are removed.
 *
 * Serving: the dev/preview server (see the sitemapHeadersPlugin in
 * vite.config.ts) and the `public/_headers` rules hand these out with
 * `Content-Encoding: gzip` and `Content-Type: application/xml; charset=utf-8`
 * when the crawler advertises gzip support, and fall back to the plain XML
 * otherwise.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const PUBLIC_DIR = resolve("public");

const isSitemap = (name) => name === "sitemap.xml" || /^sitemap-\d+\.xml$/.test(name);

const sources = existsSync(PUBLIC_DIR)
  ? readdirSync(PUBLIC_DIR).filter((name) => isSitemap(name) || name === "robots.txt")
  : [];

const written = [];
for (const name of sources) {
  const source = resolve(PUBLIC_DIR, name);
  const target = `${source}.gz`;
  // Level 9: these files are generated once per build and fetched by crawlers.
  const gz = gzipSync(readFileSync(source), { level: 9 });
  writeFileSync(target, gz);
  written.push({ name, raw: statSync(source).size, gzipped: gz.length });
}

// Drop .gz files whose source was removed (e.g. shards from a larger build).
const keep = new Set(written.map((file) => `${file.name}.gz`));
for (const name of existsSync(PUBLIC_DIR) ? readdirSync(PUBLIC_DIR) : []) {
  if (name.endsWith(".gz") && !keep.has(name) && (isSitemap(name.slice(0, -3)) || name === "robots.txt.gz")) {
    rmSync(resolve(PUBLIC_DIR, name));
    console.log(`removed stale public/${name}`);
  }
}

if (written.length === 0) {
  console.warn("! no sitemap/robots files found to compress");
} else {
  console.log(`gzip written (${written.length} file(s)):`);
  for (const file of written) {
    const saved = Math.round((1 - file.gzipped / file.raw) * 100);
    console.log(
      `  · public/${file.name}.gz — ${file.gzipped}B from ${file.raw}B (-${saved}%)`,
    );
  }
}
