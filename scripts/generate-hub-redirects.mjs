#!/usr/bin/env node
/**
 * Emits the edge 301 rule set that consolidates spoke URLs onto reson8.life.
 *
 * Lovable hosting does not process `_redirects` / `vercel.json`, so these
 * rules must be applied on the layer in front of the spoke (Cloudflare Bulk
 * Redirects, a Cloudflare Worker, or the Hub's nginx/edge config).
 *
 *   node scripts/generate-hub-redirects.mjs
 *
 * Writes: docs/generated/hub-redirects.csv, docs/generated/hub-redirects.conf
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../docs/generated");

// Mirrors src/lib/hub-redirect-map.ts (kept in sync by
// src/lib/__tests__/hub-redirect-map.test.ts).
const SPOKE_ORIGINS = [
  "https://www.resonanceonline.life",
  "https://resonanceonline.life",
  "https://resonanceonline.lovable.app",
];
const HUB_URL = "https://reson8.life";
const HUB_FALLBACK_PATH = "/apps/epublisher";
const HUB_PATH_MAP = {
  "/": "/apps/epublisher",
  "/about": "/about",
  "/contact": "/support",
  "/pricing": "/pricing",
  "/terms": "/terms",
  "/privacy": "/privacy",
};
const NO_REDIRECT_PREFIXES = [
  "/app",
  "/auth",
  "/admin",
  "/account",
  "/billing",
  "/checkout",
  "/reset-password",
  "/privacy/access",
  "/__test",
  "/lovable",
  "/assets",
  "/api",
];

// --- Cloudflare Bulk Redirects CSV -----------------------------------------
const csv = ["source_url,target_url,status,preserve_query_string"];
for (const origin of SPOKE_ORIGINS) {
  for (const [from, to] of Object.entries(HUB_PATH_MAP)) {
    csv.push(`${origin}${from},${HUB_URL}${to},301,true`);
  }
  // Catch-all for any other public path.
  csv.push(`${origin}/*,${HUB_URL}${HUB_FALLBACK_PATH},301,false`);
}

// --- nginx / edge conf ------------------------------------------------------
const conf = [
  "# Spoke -> Hub 301 consolidation (generated: scripts/generate-hub-redirects.mjs)",
  "# Apply on the proxy in FRONT of the spoke. Order matters: the exclusions",
  "# must be evaluated before the catch-all.",
  "",
  "# 1. Never redirect the application, auth or payment routes.",
  ...NO_REDIRECT_PREFIXES.map((p) => `location ^~ ${p} { proxy_pass http://spoke_origin; }`),
  "",
  "# 2. Explicit page mappings.",
  ...Object.entries(HUB_PATH_MAP).map(
    ([from, to]) => `location = ${from} { return 301 ${HUB_URL}${to}$is_args$args; }`,
  ),
  "",
  "# 3. Everything else public consolidates to the app page.",
  `location / { return 301 ${HUB_URL}${HUB_FALLBACK_PATH}; }`,
  "",
].join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "hub-redirects.csv"), `${csv.join("\n")}\n`);
writeFileSync(resolve(outDir, "hub-redirects.conf"), conf);
console.log(`Wrote ${csv.length - 1} redirect rules to docs/generated/`);
