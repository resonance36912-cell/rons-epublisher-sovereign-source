#!/usr/bin/env node
/**
 * Build-time check: confirm that favicon, og:image, twitter:image, apple-touch-icon,
 * manifest icons, and JSON-LD `logo`/`image` references in index.html all point to
 * brand assets that actually exist in /public.
 *
 * Exits non-zero (failing the build) when a reference is missing on disk.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const indexHtml = path.join(root, "index.html");
const manifestPath = path.join(publicDir, "manifest.webmanifest");

// Site origins that map to /public.
const SITE_ORIGINS = [
  "https://www.resonanceonline.life",
  "https://resonanceonline.life",
  "https://resonanceonline.lovable.app",
];

/** Turn a URL/path reference into a relative /public path, or null if external. */
function toPublicPath(ref) {
  if (!ref) return null;
  let url = ref.trim();
  for (const origin of SITE_ORIGINS) {
    if (url.startsWith(origin)) {
      url = url.slice(origin.length) || "/";
      break;
    }
  }
  if (/^https?:\/\//i.test(url)) return null; // external (e.g. fonts.gstatic.com)
  if (url.startsWith("data:")) return null;
  if (!url.startsWith("/")) return null;
  return url.split("?")[0].split("#")[0];
}

const issues = [];
function check(source, ref) {
  const rel = toPublicPath(ref);
  if (!rel) return;
  const abs = path.join(publicDir, rel);
  if (!existsSync(abs)) {
    issues.push(`  ✗ ${source}: ${ref} → missing ${path.relative(root, abs)}`);
  }
}

// ---- index.html ----
const html = readFileSync(indexHtml, "utf8");

// <link ... href="...">
for (const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
  const tag = m[0];
  if (/\brel=["'](?:icon|apple-touch-icon|manifest|shortcut icon|mask-icon)["']/i.test(tag)) {
    check("link " + (tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? "?"), m[1]);
  }
}

// <meta property="og:image" | name="twitter:image" content="...">
for (const m of html.matchAll(
  /<meta\b[^>]*(?:property|name)=["'](og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/gi,
)) {
  check(`meta ${m[1]}`, m[2]);
}
// content-first ordering
for (const m of html.matchAll(
  /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](og:image(?::secure_url)?|twitter:image)["']/gi,
)) {
  check(`meta ${m[2]}`, m[1]);
}

// JSON-LD logo/image fields
for (const m of html.matchAll(
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
)) {
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    issues.push(`  ✗ JSON-LD parse error: ${err.message}`);
    continue;
  }
  const blocks = Array.isArray(data) ? data : [data];
  for (const block of blocks) {
    const type = block?.["@type"] ?? "(unknown)";
    for (const field of ["logo", "image"]) {
      const val = block?.[field];
      if (typeof val === "string") check(`JSON-LD ${type}.${field}`, val);
      else if (val && typeof val === "object" && typeof val.url === "string") {
        check(`JSON-LD ${type}.${field}.url`, val.url);
      }
    }
  }
}

// ---- manifest.webmanifest icons ----
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const icon of manifest.icons ?? []) {
      check(`manifest icon ${icon.sizes ?? ""}`.trim(), icon.src);
    }
  } catch (err) {
    issues.push(`  ✗ manifest.webmanifest parse error: ${err.message}`);
  }
} else {
  issues.push(`  ✗ manifest.webmanifest not found at ${path.relative(root, manifestPath)}`);
}

if (issues.length > 0) {
  console.error("\n✗ Brand asset verification failed:\n" + issues.join("\n") + "\n");
  process.exit(1);
}
console.log("✓ Brand asset references verified (favicon, og:image, JSON-LD logo, manifest icons).");
