#!/usr/bin/env node
/**
 * Post-deploy SEO submission.
 *
 * Run this right after a publish. It calls the `seo-submit-sitemap` backend
 * function, which verifies production is serving the current robots.txt and
 * sitemap.xml, then re-submits sitemap.xml to Google Search Console so Google
 * fetches the newest <lastmod> values instead of waiting for its own schedule.
 *
 *   node scripts/post-deploy-seo.mjs                      # uses SEO_ADMIN_TOKEN
 *   node scripts/post-deploy-seo.mjs --token <jwt>
 *   node scripts/post-deploy-seo.mjs --site https://resonance.example
 *
 * The token must be an admin user's access token (the same JWT the admin panel
 * uses). Nothing is printed from it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function envFromDotEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(resolve(".env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

const token = arg("token") ?? process.env.SEO_ADMIN_TOKEN;
const site = arg("site") ?? "https://www.resonanceonline.life";
const projectId = envFromDotEnv("VITE_SUPABASE_PROJECT_ID");
const anonKey = envFromDotEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

if (!token) {
  console.error(
    "✗ Missing admin token. Pass --token <jwt> or set SEO_ADMIN_TOKEN.\n" +
      "  Get it from the admin panel session (Admin → SEO → Submit to Google also runs this).",
  );
  process.exit(1);
}
if (!projectId || !anonKey) {
  console.error("✗ Missing backend project config (.env).");
  process.exit(1);
}

const endpoint = `https://${projectId}.supabase.co/functions/v1/seo-submit-sitemap`;

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ site_url: site }),
});

const result = await response.json().catch(() => ({}));

if (!response.ok) {
  if (result.status === "selection_required") {
    console.error("✗ Multiple verified Search Console properties match this site:");
    for (const candidate of result.candidates ?? []) console.error(`  - ${candidate}`);
    console.error("  Re-run with --property <exact value> once you pick one.");
  } else {
    console.error(`✗ Submission failed [${response.status}]: ${result.error ?? "unknown error"}`);
    if (result.details) console.error(`  ${result.details}`);
  }
  process.exit(1);
}

const { property, submitted, live, sitemap_status: status } = result;
console.log(`✓ Submitted ${submitted} to Search Console property ${property}`);
console.log(
  `  live sitemap: HTTP ${live.sitemap.status}, ${live.sitemap.urls} URLs, newest lastmod ${live.sitemap.newest_lastmod ?? "none"}`,
);
console.log(`  live robots.txt: HTTP ${live.robots.status}, ${live.robots.bytes} bytes`);
if (status) {
  console.log(
    `  Search Console state: lastSubmitted ${status.lastSubmitted ?? "n/a"}, ` +
      `errors ${status.errors ?? 0}, warnings ${status.warnings ?? 0}`,
  );
}
console.log("  robots.txt has no submission API — Google re-crawls it on its own schedule.");
