/**
 * Single source of truth for spoke â†’ Hub URL consolidation.
 *
 * Used by:
 *  - `src/components/Seo.tsx` to emit canonical / og:url
 *  - `scripts/generate-hub-redirects.mjs` to emit the edge 301 rule set
 *    (Cloudflare Bulk Redirects CSV + nginx/Worker snippets)
 *
 * Keeping both derived from one map guarantees the 301 target and the
 * canonical never drift apart, which is what makes consolidation fast.
 */

export const SPOKE_ORIGINS = [
  "https://www.resonanceonline.life",
  "https://resonanceonline.life",
  "https://resonanceonline.life",
] as const;

/** Primary spoke origin (used for absolute asset URLs). */
export const SPOKE_URL = SPOKE_ORIGINS[0];

export const HUB_URL = "https://reson8.life";

/** Fallback Hub target for any public route without an explicit mapping. */
export const HUB_FALLBACK_PATH = "/apps/epublisher";

/** Public spoke routes and their Hub equivalents. */
export const HUB_PATH_MAP: Record<string, string> = {
  "/": "/apps/epublisher",
  "/about": "/about",
  "/contact": "/support",
  "/pricing": "/pricing",
  "/terms": "/terms",
  "/privacy": "/privacy",
};

/**
 * Routes that must NEVER 301 to the Hub: the application itself, auth flows
 * and payment returns live on the spoke. Redirecting these would break the
 * product. Prefixes are matched with `startsWith`.
 */
export const NO_REDIRECT_PREFIXES = [
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
] as const;

export function isRedirectableRoute(path: string): boolean {
  const clean = path.split("?")[0].split("#")[0];
  return !NO_REDIRECT_PREFIXES.some(
    (p) => clean === p || clean.startsWith(`${p}/`),
  );
}

/** Absolute Hub URL a given spoke path consolidates to. */
export function hubCanonical(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  const mapped = HUB_PATH_MAP[clean] ?? HUB_FALLBACK_PATH;
  return `${HUB_URL}${mapped}`;
}

