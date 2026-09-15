/**
 * post_login_redirect helper
 *
 * Stores the user's intended in-app path in sessionStorage before an auth
 * hand-off (Google OAuth, magic link, password sign-in), then hands it back
 * to `/auth/callback` (or the sign-in page) to navigate after the session is
 * hydrated.
 *
 * Critically: OAuth `redirectTo` / `redirect_uri` values must ALWAYS point at
 * the public `/auth/callback` route — never at a protected route like `/app`,
 * `/account`, `/admin`, etc. Protected routes would blank-flash on their auth
 * guard before the Supabase session finishes hydrating, and some providers
 * refuse to complete the token exchange on a redirect that then bounces.
 */

const STORAGE_KEY = "post_login_redirect";

// Anything the auth flow itself owns — never redirect back into these.
const AUTH_PATHS = ["/auth", "/auth/callback", "/reset-password", "/admin-login"];

const DEFAULT_TARGET = "/app";

/** Sanitize a candidate path to a same-origin in-app route. */
export function sanitizePostLoginPath(input: string | null | undefined): string {
  if (!input) return DEFAULT_TARGET;
  const raw = String(input).trim();
  if (!raw) return DEFAULT_TARGET;

  // Must be a same-origin absolute path. Reject full URLs, protocol-relative
  // paths, and anything that could exfiltrate the session to another origin.
  if (!raw.startsWith("/")) return DEFAULT_TARGET;
  if (raw.startsWith("//")) return DEFAULT_TARGET;
  if (raw.startsWith("/\\")) return DEFAULT_TARGET;

  // Strip control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_TARGET;

  // Don't loop back into the auth flow itself.
  const pathOnly = raw.split("?")[0].split("#")[0];
  if (AUTH_PATHS.some((p) => pathOnly === p || pathOnly.startsWith(`${p}/`))) {
    return DEFAULT_TARGET;
  }

  return raw;
}

/** Save an intended in-app destination for after sign-in completes. */
export function savePostLoginRedirect(path: string | null | undefined): void {
  try {
    const safe = sanitizePostLoginPath(path);
    sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* sessionStorage unavailable — silently ignore */
  }
}

/** Peek without removing. */
export function peekPostLoginRedirect(): string {
  try {
    return sanitizePostLoginPath(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_TARGET;
  }
}

/** Read + clear. Call this right before navigating post-auth. */
export function consumePostLoginRedirect(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return sanitizePostLoginPath(stored);
  } catch {
    return DEFAULT_TARGET;
  }
}

/**
 * Public callback URL to hand to Supabase / OAuth providers as `redirectTo`
 * / `redirect_uri`. Always the unguarded `/auth/callback` route on the
 * current origin — never a protected route.
 */
export function oauthCallbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/**
 * Capture the *current* location (path + search + hash) as the post-login
 * redirect, then navigate to `/auth`. Use from route guards on protected
 * pages so the user lands back where they were after signing in.
 */
export function captureCurrentAsPostLoginRedirect(): void {
  try {
    const { pathname, search, hash } = window.location;
    savePostLoginRedirect(`${pathname}${search}${hash}`);
  } catch {
    /* noop */
  }
}
