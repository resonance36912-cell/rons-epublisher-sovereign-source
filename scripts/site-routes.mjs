/**
 * Single source of truth for public routes and crawler-blocked paths.
 *
 * Both scripts/generate-sitemap.mjs and scripts/generate-robots.mjs import
 * from here, so a route can never appear in the sitemap while being blocked
 * in robots.txt (or vice-versa) — the two files cannot drift.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE_URL = "https://www.resonanceonline.life";
export const HUB_URL = "https://reson8.life";

/** Sitemap URL advertised in robots.txt (the Hub owns canonical indexing). */
export const SITEMAP_DIRECTIVE_URL = `${HUB_URL}/sitemap.xml`;

/**
 * Sitemap directives for robots.txt, resolved from the sitemap files actually
 * on disk (robots generation runs AFTER sitemap generation on predev/prebuild,
 * so this always reflects the newest build):
 *   - Hub sitemap first — it owns canonical indexing.
 *   - public/sitemap.xml when it is a <sitemapindex> (sharding on) or a plain
 *     <urlset> (sharding off); shards are discovered through the index, so they
 *     are not advertised individually.
 *   - If no root sitemap.xml exists but shards do, advertise sitemap-1.xml…N.
 */
export function sitemapDirectiveUrls() {
  const urls = [SITEMAP_DIRECTIVE_URL];
  const publicDir = resolve("public");
  const root = resolve(publicDir, "sitemap.xml");

  if (existsSync(root)) {
    urls.push(`${BASE_URL}/sitemap.xml`);
    return urls;
  }

  const shards = existsSync(publicDir)
    ? readdirSync(publicDir)
        .filter((name) => /^sitemap-\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    : [];
  for (const shard of shards) urls.push(`${BASE_URL}/${shard}`);
  return urls;
}

/** Hub canonical each spoke URL consolidates to (mirrors src/lib/hub-redirect-map.ts). */
export const HUB_PATH_MAP = {
  "/": "/apps/epublisher",
  "/about": "/about",
  "/contact": "/support",
  "/pricing": "/pricing",
  "/terms": "/terms",
  "/privacy": "/privacy",
};
export const HUB_FALLBACK_PATH = "/apps/epublisher";

export const hubCanonical = (path) =>
  `${HUB_URL}${HUB_PATH_MAP[path] ?? HUB_FALLBACK_PATH}`;

/**
 * Public, indexable routes. `sources` lists every file whose change means the
 * page's content changed; the newest commit date across them wins as lastmod.
 */
export const ROUTES = [
  { path: "/", changefreq: "weekly", priority: "1.0", sources: ["src/pages/Landing.tsx"] },
  { path: "/about", changefreq: "monthly", priority: "0.8", sources: ["src/pages/About.tsx"] },
  { path: "/pricing", changefreq: "monthly", priority: "0.9", sources: ["src/pages/Pricing.tsx", "src/lib/credit-packs.ts"] },
  { path: "/contact", changefreq: "monthly", priority: "0.7", sources: ["src/pages/Contact.tsx"] },
  { path: "/terms", changefreq: "yearly", priority: "0.3", sources: ["src/pages/Terms.tsx"] },
  { path: "/privacy", changefreq: "yearly", priority: "0.3", sources: ["src/pages/Privacy.tsx"] },
  { path: "/sitemap", changefreq: "weekly", priority: "0.2", sources: ["src/pages/SitemapPreview.tsx"] },
];

/**
 * Non-public routes. Every entry is emitted as a `Disallow:` in robots.txt and
 * excluded from the sitemap. Add an app route here and both files update.
 */
export const DISALLOWED_PATHS = [
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
  "/not-found",
];

/** User-agent groups written to robots.txt, in order. `*` is always emitted last. */
export const ROBOTS_USER_AGENTS = [
  "Googlebot",
  "Bingbot",
  "Twitterbot",
  "facebookexternalhit",
  "*",
];

// --- Dynamic sample routes, read from the same module the page renders from --
const SAMPLES_SOURCE = "src/pages/SamplePreview.tsx";
export function sampleRoutes() {
  const src = readFileSync(resolve(SAMPLES_SOURCE), "utf8");
  const slugs = [...src.matchAll(/^\s*slug:\s*"([^"]+)"/gm)].map((m) => m[1]);
  return slugs.map((slug) => ({
    path: `/samples/${slug}`,
    changefreq: "monthly",
    priority: "0.7",
    sources: [SAMPLES_SOURCE],
  }));
}

/** True when `path` is not covered by any DISALLOWED_PATHS prefix. */
export const isAllowed = (path) =>
  !DISALLOWED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** Every public route (static + dynamic) that belongs in the sitemap. */
export function publicRoutes() {
  return [...ROUTES, ...sampleRoutes()].filter((route) => isAllowed(route.path));
}
