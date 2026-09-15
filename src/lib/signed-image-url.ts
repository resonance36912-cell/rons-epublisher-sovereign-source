// Short-lived signed URL helpers for the private `chapter-images` bucket.
//
// The bucket is private. The `sign-chapter-images` edge function is the only
// authority that issues signed URLs — it enforces per-user folder ownership
// (admins can sign anything), rejects the reserved `tts-cache` namespace for
// non-admins, clamps TTL, and audits every request to `storage_access_logs`.
//
// Client-side we batch sign-requests, cache the resulting signed URLs in
// memory per page load, and refresh them shortly before the TTL expires.
import { supabase } from "@/integrations/supabase/client";

export const CHAPTER_IMAGES_BUCKET = "chapter-images";
const FALLBACK_TTL_SECONDS = 15 * 60; // used until app_settings is fetched
const REFRESH_BEFORE_MS = 60 * 1000; // re-sign when <60s left
const MARKER = `/${CHAPTER_IMAGES_BUCKET}/`;

// Per-user viewer override (chosen via the in-app image viewer settings).
// Stored in localStorage; takes precedence over the admin-configured value
// when set. Cleared by selecting "Use server default".
const VIEWER_TTL_LS_KEY = "resonance.viewer.signed_url_ttl_seconds";
const VIEWER_TTL_CHANGED_AT_LS_KEY = "resonance.viewer.signed_url_ttl_changed_at";
export type ViewerTtlOption = "default" | 300 | 600 | 900 | 1800 | 3600;
export const VIEWER_TTL_PRESETS: { label: string; value: ViewerTtlOption }[] = [
  { label: "Use server default", value: "default" },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes", value: 600 },
  { label: "15 minutes", value: 900 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
];

export function getViewerTtlOverride(): number | null {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(VIEWER_TTL_LS_KEY) : null;
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 60 && n <= 3600 ? Math.floor(n) : null;
  } catch { return null; }
}

/** ISO timestamp of when the viewer TTL was last changed, or null if never. */
export function getViewerTtlChangedAt(): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(VIEWER_TTL_CHANGED_AT_LS_KEY)
      : null;
  } catch { return null; }
}

export function setViewerTtlOverride(value: ViewerTtlOption): void {
  try {
    if (value === "default") window.localStorage.removeItem(VIEWER_TTL_LS_KEY);
    else window.localStorage.setItem(VIEWER_TTL_LS_KEY, String(value));
    window.localStorage.setItem(VIEWER_TTL_CHANGED_AT_LS_KEY, new Date().toISOString());
    // Notify listeners in the same tab (the `storage` event only fires cross-tab).
    window.dispatchEvent(new CustomEvent("resonance:viewer-ttl-changed"));
    ttlCache = null; // force re-resolve on next sign call
    cache.clear();   // drop already-signed URLs so the new TTL takes effect
  } catch { /* ignore */ }
}

// ---- Countdown badge visibility (per-user, localStorage) -------------------
// Controls whether the SignedUrlCountdown chip is rendered in the image viewer.
// Default: visible. Stored as "0" when hidden; absent = visible.
const COUNTDOWN_VISIBLE_LS_KEY = "resonance.viewer.signed_url_countdown_visible";

export function getCountdownBadgeVisible(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(COUNTDOWN_VISIBLE_LS_KEY);
    return v !== "0";
  } catch { return true; }
}

export function setCountdownBadgeVisible(visible: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (visible) window.localStorage.removeItem(COUNTDOWN_VISIBLE_LS_KEY);
    else window.localStorage.setItem(COUNTDOWN_VISIBLE_LS_KEY, "0");
    window.dispatchEvent(new CustomEvent("resonance:viewer-countdown-visibility-changed"));
  } catch { /* ignore */ }
}

/** Subscribe to same-tab and cross-tab changes to the badge visibility setting. */
export function subscribeCountdownBadgeVisible(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== window.localStorage) return;
    if (e.key !== COUNTDOWN_VISIBLE_LS_KEY) return;
    fn();
  };
  const onCustom = () => fn();
  window.addEventListener("storage", onStorage);
  window.addEventListener("resonance:viewer-countdown-visibility-changed", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resonance:viewer-countdown-visibility-changed", onCustom);
  };
}

// Configured TTL + per-user-override flag are fetched from `app_settings`
// on first use and refreshed periodically. Admins can change either without
// redeploying. When `userOverrideAllowed` is false, the viewer's localStorage
// override is ignored and everyone uses the server default.
let ttlCache: { value: number; userOverrideAllowed: boolean; expiresAt: number } | null = null;
async function resolveSettings(): Promise<{ value: number; userOverrideAllowed: boolean }> {
  if (ttlCache && ttlCache.expiresAt > Date.now()) {
    return { value: ttlCache.value, userOverrideAllowed: ttlCache.userOverrideAllowed };
  }
  let resolved = FALLBACK_TTL_SECONDS;
  let userOverrideAllowed = true;
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["signed_url_ttl_seconds", "signed_url_ttl_user_override_allowed"]);
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.key === "signed_url_ttl_seconds") {
        const n = typeof row.value === "number" ? row.value : typeof row.value === "string" ? Number(row.value) : NaN;
        if (Number.isFinite(n) && n > 0) resolved = Math.floor(n);
      } else if (row.key === "signed_url_ttl_user_override_allowed") {
        if (typeof row.value === "boolean") userOverrideAllowed = row.value;
      }
    }
  } catch { /* fall back silently */ }
  resolved = Math.max(60, Math.min(3600, resolved));
  ttlCache = { value: resolved, userOverrideAllowed, expiresAt: Date.now() + 60_000 };
  return { value: resolved, userOverrideAllowed };
}

/** Returns true if the admin currently permits per-user TTL overrides. */
export async function isViewerTtlOverrideAllowed(): Promise<boolean> {
  return (await resolveSettings()).userOverrideAllowed;
}

async function getConfiguredTtlSeconds(): Promise<number> {
  const settings = await resolveSettings();
  if (settings.userOverrideAllowed) {
    const override = getViewerTtlOverride();
    if (override) return override;
  }
  return settings.value;
}

// ---- Cross-tab sync ---------------------------------------------------------
// localStorage `storage` events fire in *other* tabs (not the writer). When the
// viewer override changes in another tab, drop our in-process caches and force
// any on-screen images to re-sign with the new TTL so the change is immediate.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.storageArea !== window.localStorage) return;
    if (e.key !== VIEWER_TTL_LS_KEY && e.key !== VIEWER_TTL_CHANGED_AT_LS_KEY) return;
    // Invalidate resolver + signed-URL caches.
    ttlCache = null;
    // Cancel all pending refresh timers, then clear cache so the next render
    // (triggered by the resign loop below) issues a fresh signing request.
    for (const entry of cache.values()) {
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    }
    const subscribedPaths = Array.from(subscribers.keys()).filter(
      (p) => (subscribers.get(p)?.size ?? 0) > 0,
    );
    cache.clear();
    // Notify same-tab listeners (settings panel, tooltip hook, etc.).
    window.dispatchEvent(new CustomEvent("resonance:viewer-ttl-changed"));
    // Re-sign anything currently on screen so URLs reflect the new TTL.
    for (const path of subscribedPaths) {
      void (async () => {
        try {
          const ttl = await getConfiguredTtlSeconds();
          const signed = await callSignEndpoint([path], undefined, ttl);
          const url = signed.get(path);
          if (!url) return;
          cache.set(path, { url, expiresAt: Date.now() + ttl * 1000, ttl });
          notify(path, url);
          scheduleRefresh(path);
        } catch { /* ignore */ }
      })();
    }
  });
}

type CacheEntry = { url: string; expiresAt: number; ttl: number; ctx?: SignContext; timer?: ReturnType<typeof setTimeout> };
const cache = new Map<string, CacheEntry>();

// Path -> set of subscriber callbacks. Used by useSignedImageUrl to receive
// a fresh URL whenever the auto-refresh scheduler re-signs a cached path.
const subscribers = new Map<string, Set<(url: string) => void>>();
function notify(path: string, url: string): void {
  const subs = subscribers.get(path);
  if (!subs) return;
  for (const cb of subs) { try { cb(url); } catch { /* ignore */ } }
}
export function subscribeSignedUrl(path: string, cb: (url: string) => void): () => void {
  let set = subscribers.get(path);
  if (!set) { set = new Set(); subscribers.set(path, set); }
  set.add(cb);
  // Kick off the refresh loop if we already have a cached entry but no timer.
  const entry = cache.get(path);
  if (entry && !entry.timer) scheduleRefresh(path);
  return () => {
    const s = subscribers.get(path);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      subscribers.delete(path);
      const e = cache.get(path);
      if (e?.timer) { clearTimeout(e.timer); e.timer = undefined; }
    }
  };
}

/** Returns the cached signed-URL expiry timestamp (ms) for a path, or null. */
export function getSignedUrlExpiry(path: string): number | null {
  return cache.get(path)?.expiresAt ?? null;
}

/** Threshold (ms) at which the auto-refresh scheduler re-signs. Exported so
 * UI indicators (countdowns, "expires soon" badges) stay consistent. */
export const SIGNED_URL_REFRESH_BEFORE_MS = REFRESH_BEFORE_MS;

function scheduleRefresh(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  // Re-sign slightly before expiry. Only refresh while something is subscribed
  // (i.e. an on-screen image is using this URL) to avoid background churn.
  const delay = Math.max(1000, entry.expiresAt - Date.now() - REFRESH_BEFORE_MS);
  entry.timer = setTimeout(async () => {
    if (!subscribers.get(path)?.size) { entry.timer = undefined; return; }
    try {
      const signed = await callSignEndpoint([path], entry.ctx, entry.ttl);
      const url = signed.get(path);
      if (!url) return;
      const next: CacheEntry = { url, expiresAt: Date.now() + entry.ttl * 1000, ttl: entry.ttl, ctx: entry.ctx };
      cache.set(path, next);
      notify(path, url);
      scheduleRefresh(path);
    } catch { /* ignore — next access will re-sign */ }
  }, delay);
}

/**
 * Best-effort extraction of the storage object path from a raw path
 * (`uid/projectId/chapter.png`), a legacy public URL, or a previously
 * signed URL. Returns `null` for inputs we shouldn't touch (data:, blob:,
 * external URLs, app-relative fallbacks).
 */
export function extractChapterImagePath(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  if (input.startsWith("data:") || input.startsWith("blob:")) return null;

  const markerIdx = input.indexOf(MARKER);
  if (markerIdx !== -1) {
    const tail = input.slice(markerIdx + MARKER.length).split("?")[0].split("#")[0];
    try { return decodeURIComponent(tail); } catch { return tail; }
  }
  if (/^[^/]+\/[^/]+\/.+\.(png|jpe?g|webp|gif|mp3|m4a|ogg|wav|mp4|webm|mov|m4v)$/i.test(input)) {
    return input;
  }
  return null;
}

function isFresh(entry: CacheEntry | undefined): boolean {
  return !!entry && entry.expiresAt - Date.now() > REFRESH_BEFORE_MS;
}

type SignContext = { uiAction?: string; projectId?: string };

async function callSignEndpoint(
  paths: string[],
  ctx: SignContext | undefined,
  ttl: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await supabase.functions.invoke("sign-chapter-images", {
    body: {
      paths,
      ttl,
      ui_action: ctx?.uiAction,
      project_id: ctx?.projectId,
    },
  });
  if (error) {
    console.warn("[signed-image-url] edge sign failed:", error.message);
    return out;
  }
  const results = (data as { results?: Array<{ path?: string; signedUrl?: string }> })?.results ?? [];
  for (const r of results) {
    if (r?.path && r.signedUrl) out.set(r.path, r.signedUrl);
  }
  return out;
}

/** Sign a single chapter-images URL or path. Pass-through for inputs we can't parse. */
export async function signChapterImageUrl(input: string, ctx?: SignContext): Promise<string> {
  if (!input) return input;
  const path = extractChapterImagePath(input);
  if (!path) return input;

  const cached = cache.get(path);
  if (isFresh(cached)) return cached!.url;

  const ttl = await getConfiguredTtlSeconds();
  const signed = await callSignEndpoint([path], ctx, ttl);
  const url = signed.get(path);
  if (!url) return input;
  cache.set(path, { url, expiresAt: Date.now() + ttl * 1000, ttl, ctx });
  if (subscribers.get(path)?.size) scheduleRefresh(path);
  return url;
}

/** Batch-sign many URLs/paths. Returns an array aligned with `inputs`. */
export async function signChapterImageUrls(
  inputs: string[],
  ctx?: SignContext,
): Promise<string[]> {
  const results = new Array<string>(inputs.length);
  const toFetch: { idx: number; path: string }[] = [];

  inputs.forEach((raw, idx) => {
    if (!raw) { results[idx] = raw; return; }
    const path = extractChapterImagePath(raw);
    if (!path) { results[idx] = raw; return; }
    const cached = cache.get(path);
    if (isFresh(cached)) { results[idx] = cached!.url; return; }
    toFetch.push({ idx, path });
  });

  if (toFetch.length === 0) return results;

  const ttl = await getConfiguredTtlSeconds();
  const uniquePaths = Array.from(new Set(toFetch.map((t) => t.path)));
  const signed = await callSignEndpoint(uniquePaths, ctx, ttl);

  const expiresAt = Date.now() + ttl * 1000;
  for (const [path, url] of signed) {
    cache.set(path, { url, expiresAt, ttl, ctx });
    if (subscribers.get(path)?.size) scheduleRefresh(path);
  }

  toFetch.forEach(({ idx, path }) => {
    results[idx] = signed.get(path) ?? inputs[idx];
  });
  return results;
}

/** Clear the in-memory cache (e.g. after sign-out). */
export function clearSignedUrlCache(): void {
  for (const entry of cache.values()) if (entry.timer) clearTimeout(entry.timer);
  cache.clear();
}
