#!/usr/bin/env node
/**
 * Fails the build when the generated sitemap is malformed or lists a URL that
 * robots.txt disallows. Runs on `prebuild` (after generation) and at the start
 * of `vite build` via the verify-sitemap plugin.
 *
 * public/sitemap.xml is either a <urlset> (small route sets) or a
 * <sitemapindex> pointing at public/sitemap-N.xml shards (large route sets).
 * Both shapes are validated, and every shard is validated as a urlset.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const PUBLIC_DIR = resolve("public");
const SITEMAP_PATH = resolve(PUBLIC_DIR, "sitemap.xml");
const ROBOTS_PATH = resolve(PUBLIC_DIR, "robots.txt");
const errors = [];

if (!existsSync(SITEMAP_PATH)) {
  console.error("✗ public/sitemap.xml is missing — run `npm run generate:sitemap`.");
  process.exit(1);
}

const CHANGEFREQ = new Set([
  "always", "hourly", "daily", "weekly", "monthly", "yearly", "never",
]);
const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(value);

/** Shared document-level checks (declaration, entities, root element). */
function checkDocument(xml, file, rootTag) {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    errors.push(`${file}: missing or malformed XML declaration on line 1.`);
  }
  if (
    !new RegExp(`<${rootTag}\\s+xmlns="http://www\\.sitemaps\\.org/schemas/sitemap/0\\.9"`).test(xml)
  ) {
    errors.push(`${file}: missing <${rootTag}> element with the sitemaps.org 0.9 namespace.`);
  }
  if (!xml.trimEnd().endsWith(`</${rootTag}>`)) {
    errors.push(`${file}: document does not close with </${rootTag}>.`);
  }
  const stripped = xml.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "");
  if (stripped.includes("&")) {
    errors.push(`${file}: unescaped '&' found — entities must be escaped (&amp;).`);
  }
}

function checkBalanced(xml, file, tag) {
  const open = (xml.match(new RegExp(`<${tag}>`, "g")) || []).length;
  const close = (xml.match(new RegExp(`</${tag}>`, "g")) || []).length;
  if (open !== close) {
    errors.push(`${file}: unbalanced <${tag}> tags: ${open} opening vs ${close} closing.`);
  }
}

function checkLoc(loc, label) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    errors.push(`${label}: <loc> is not an absolute URL (${loc}).`);
    return null;
  }
  if (url.protocol !== "https:") errors.push(`${label}: <loc> must use https (${loc}).`);
  return url;
}

/** Validates a <urlset> document and returns its locs. */
function validateUrlset(xml, file) {
  checkDocument(xml, file, "urlset");
  checkBalanced(xml, file, "url");

  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  if (blocks.length === 0) errors.push(`${file}: contains no <url> entries.`);
  if (blocks.length > 50000) {
    errors.push(`${file}: too many URLs (${blocks.length}); the limit is 50,000 per sitemap.`);
  }

  const locs = [];
  for (const [i, block] of blocks.entries()) {
    const label = `${file} URL #${i + 1}`;
    const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1];
    if (!loc) {
      errors.push(`${label}: missing <loc>.`);
      continue;
    }
    locs.push(loc);
    if (!checkLoc(loc, label)) continue;

    const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1];
    if (lastmod !== undefined && !isValidDate(lastmod)) {
      errors.push(`${label}: <lastmod> "${lastmod}" is not a valid W3C date.`);
    }
    const changefreq = block.match(/<changefreq>([^<]*)<\/changefreq>/)?.[1];
    if (changefreq !== undefined && !CHANGEFREQ.has(changefreq)) {
      errors.push(`${label}: invalid <changefreq> "${changefreq}".`);
    }
    const priority = block.match(/<priority>([^<]*)<\/priority>/)?.[1];
    if (priority !== undefined) {
      const value = Number(priority);
      if (Number.isNaN(value) || value < 0 || value > 1) {
        errors.push(`${label}: <priority> "${priority}" must be between 0.0 and 1.0.`);
      }
    }
  }
  return locs;
}

/** Validates a <sitemapindex> document and returns its child sitemap locs. */
function validateIndex(xml, file) {
  checkDocument(xml, file, "sitemapindex");
  checkBalanced(xml, file, "sitemap");

  const blocks = [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)].map((m) => m[1]);
  if (blocks.length === 0) errors.push(`${file}: sitemap index lists no child sitemaps.`);
  if (blocks.length > 50000) {
    errors.push(`${file}: too many child sitemaps (${blocks.length}); the limit is 50,000.`);
  }
  if (/<url>/.test(xml)) {
    errors.push(`${file}: a sitemap index must not contain <url> entries.`);
  }

  const children = [];
  for (const [i, block] of blocks.entries()) {
    const label = `${file} sitemap #${i + 1}`;
    const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1];
    if (!loc) {
      errors.push(`${label}: missing <loc>.`);
      continue;
    }
    if (!checkLoc(loc, label)) continue;
    const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1];
    if (lastmod !== undefined && !isValidDate(lastmod)) {
      errors.push(`${label}: <lastmod> "${lastmod}" is not a valid W3C date.`);
    }
    children.push(loc);
  }
  return children;
}

// --- validate the published tree ---------------------------------------------
const rootXml = readFileSync(SITEMAP_PATH, "utf8");
const isIndex = /<sitemapindex\b/.test(rootXml);
const locs = [];
const validatedFiles = ["sitemap.xml"];

if (isIndex) {
  for (const childLoc of validateIndex(rootXml, "sitemap.xml")) {
    const name = basename(new URL(childLoc).pathname);
    const childPath = resolve(PUBLIC_DIR, name);
    if (!existsSync(childPath)) {
      errors.push(`sitemap.xml references ${childLoc} but public/${name} does not exist.`);
      continue;
    }
    validatedFiles.push(name);
    locs.push(...validateUrlset(readFileSync(childPath, "utf8"), name));
  }
} else {
  locs.push(...validateUrlset(rootXml, "sitemap.xml"));
}

const duplicates = locs.filter((loc, i) => locs.indexOf(loc) !== i);
for (const dup of new Set(duplicates)) {
  errors.push(`Duplicate <loc> across the sitemap set: ${dup}`);
}

// --- robots.txt compliance ---------------------------------------------------
if (existsSync(ROBOTS_PATH)) {
  const robots = readFileSync(ROBOTS_PATH, "utf8");

  /** Disallow rules that apply to the wildcard (`*`) user-agent group. */
  const disallowed = new Set();
  let inWildcardGroup = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inWildcardGroup = value === "*";
    } else if (key === "disallow" && inWildcardGroup && value) {
      disallowed.add(value);
    }
  }

  for (const loc of locs) {
    let path;
    try {
      path = new URL(loc).pathname;
    } catch {
      continue;
    }
    for (const rule of disallowed) {
      const blocksPath =
        rule === "/" ? true : path === rule || path.startsWith(`${rule}/`);
      if (blocksPath) {
        errors.push(`${loc} is blocked by robots.txt rule "Disallow: ${rule}".`);
      }
    }
  }
} else {
  console.warn("! public/robots.txt not found — skipping robots compliance checks.");
}

// --- report ------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`✗ sitemap validation failed (${errors.length} problem(s)):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  isIndex
    ? `✓ sitemap index valid (${validatedFiles.length - 1} shards, ${locs.length} URLs, robots.txt compliant)`
    : `✓ sitemap.xml valid (${locs.length} URLs, robots.txt compliant)`,
);
