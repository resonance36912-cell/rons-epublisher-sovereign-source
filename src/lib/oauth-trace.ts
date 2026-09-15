/**
 * OAuth callback tracer.
 *
 * When enabled, instruments the browser to record everything that happens
 * around a Supabase / Lovable OAuth callback so we can prove whether:
 *   - the token was actually written to localStorage (sb-<ref>-auth-token)
 *   - the /auth/v1/* fetches succeeded, and what status they returned
 *   - the response is being blocked by CSP or X-Frame-Options / frame-ancestors
 *   - the OAuth broker delivered its web_message postMessage into the iframe
 *
 * Activation: `?debug=auth` in the URL, or localStorage["auth_debug"] === "1".
 * Also active on any URL that looks like an OAuth callback (`?code=`, `#access_token=`,
 * or `/~oauth`) so the FIRST callback after enabling debug still gets captured.
 *
 * Output:
 *   - console.info("[oauth-trace] …") for live tailing in devtools
 *   - in-memory ring buffer readable via getOAuthTrace() / window.__oauthTrace
 */

export type OAuthTraceEntry = {
  ts: string;                 // ISO timestamp
  kind:
    | "init"
    | "storage.write"
    | "storage.remove"
    | "fetch.request"
    | "fetch.response"
    | "fetch.error"
    | "postmessage"
    | "csp.violation"
    | "frame.blocked"
    | "auth.state";
  detail: Record<string, unknown>;
};

const RING_MAX = 200;
const ring: OAuthTraceEntry[] = [];
let installed = false;

function push(entry: OAuthTraceEntry) {
  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  // Also mirror to console for live tailing.
  // eslint-disable-next-line no-console
  console.info(`[oauth-trace] ${entry.kind}`, entry.detail);
}

function now() {
  return new Date().toISOString();
}

function isAuthUrl(u: string) {
  return (
    /\/auth\/v1\//.test(u) ||
    /\/~oauth\//.test(u) ||
    /oauth\.lovable\.app/.test(u) ||
    /accounts\.google\.com/.test(u)
  );
}

function shouldEnable(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "auth") return true;
    if (localStorage.getItem("auth_debug") === "1") return true;
    // Always trace during a live callback so the first one is captured.
    if (params.get("code") || params.get("error") || params.get("state")) return true;
    if (/#.*access_token=/.test(window.location.hash)) return true;
    if (/\/~oauth/.test(window.location.pathname)) return true;
    // Also trace on the sign-in / auth pages so email+password failures inside
    // the preview iframe are captured on the first attempt.
    if (/^\/(auth|sign-?in|login)(\/|$)/.test(window.location.pathname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function projectRef(): string {
  const supaUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  return supaUrl?.match(/https?:\/\/([^.]+)\./)?.[1] ?? "";
}

function isAuthTokenKey(key: string): boolean {
  const ref = projectRef();
  if (!ref) return key.startsWith("sb-") && key.endsWith("-auth-token");
  return key === `sb-${ref}-auth-token` || key.startsWith(`sb-${ref}-`);
}

export function installOAuthTrace() {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!shouldEnable()) return;
  installed = true;

  // ── 1. localStorage.setItem / removeItem instrumentation ──────────────
  try {
    const origSet = Storage.prototype.setItem;
    const origRemove = Storage.prototype.removeItem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (isAuthTokenKey(key)) {
        let parsed: any = null;
        try { parsed = JSON.parse(value); } catch { /* ignore */ }
        push({
          ts: now(),
          kind: "storage.write",
          detail: {
            key,
            storage: this === window.localStorage ? "local" : "session",
            bytes: value?.length ?? 0,
            hasAccessToken: !!parsed?.access_token,
            hasRefreshToken: !!parsed?.refresh_token,
            expiresAt: parsed?.expires_at
              ? new Date(parsed.expires_at * 1000).toISOString()
              : null,
            user: parsed?.user?.email ?? parsed?.currentSession?.user?.email ?? null,
            provider: parsed?.user?.app_metadata?.provider ?? null,
          },
        });
      }
      return origSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (isAuthTokenKey(key)) {
        push({
          ts: now(),
          kind: "storage.remove",
          detail: { key, storage: this === window.localStorage ? "local" : "session" },
        });
      }
      return origRemove.call(this, key);
    };
  } catch (e) {
    push({ ts: now(), kind: "init", detail: { warning: "storage-wrap-failed", error: String(e) } });
  }

  // ── 2. fetch instrumentation (auth endpoints only) ────────────────────
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const traced = isAuthUrl(url);
      const started = performance.now();
      if (traced) {
        push({
          ts: now(),
          kind: "fetch.request",
          detail: {
            url,
            method: init?.method ?? (input instanceof Request ? input.method : "GET"),
            hasCredentials: (init?.credentials ?? (input instanceof Request ? input.credentials : "")) || "default",
          },
        });
      }
      try {
        const res = await origFetch(input as any, init);
        if (traced) {
          // Peek at framing-related headers where CORS lets us (same-origin or exposed).
          let xfo: string | null = null;
          let csp: string | null = null;
          try { xfo = res.headers.get("x-frame-options"); } catch { /* ignore */ }
          try { csp = res.headers.get("content-security-policy"); } catch { /* ignore */ }
          push({
            ts: now(),
            kind: "fetch.response",
            detail: {
              url,
              status: res.status,
              ok: res.ok,
              type: res.type,
              redirected: res.redirected,
              durationMs: Math.round(performance.now() - started),
              xFrameOptions: xfo,
              cspHint: csp ? csp.slice(0, 200) : null,
            },
          });
          // Email/password + magic-link heuristic: a 200 from /auth/v1/token
          // (grant_type=password) or /auth/v1/verify should be followed by a
          // storage.write within ~4s. If it isn't AND we're in an iframe, the
          // token write is being blocked (storage partitioning / 3rd-party
          // cookie block). Emit frame.blocked so the panel's new-tab fallback
          // can trigger for password flows too — not just OAuth callbacks.
          if (
            res.ok &&
            window.top !== window.self &&
            /\/auth\/v1\/(token|verify|otp|signup)/.test(url)
          ) {
            const writesBefore = ring.filter((e) => e.kind === "storage.write").length;
            setTimeout(() => {
              const writesAfter = ring.filter((e) => e.kind === "storage.write").length;
              const alreadyBlocked = ring.some(
                (e) => e.kind === "frame.blocked" && (e.detail as any)?.flow === "password"
              );
              if (writesAfter === writesBefore && !alreadyBlocked) {
                push({
                  ts: now(),
                  kind: "frame.blocked",
                  detail: {
                    flow: "password",
                    hint: "Auth endpoint returned 200 but no token write reached localStorage within 4s — iframe storage is likely partitioned or 3rd-party cookies blocked.",
                    url,
                  },
                });
              }
            }, 4000);
          }
        }
        return res;
      } catch (err: any) {
        if (traced) {
          push({
            ts: now(),
            kind: "fetch.error",
            detail: {
              url,
              error: String(err?.message ?? err),
              name: err?.name ?? null,
              durationMs: Math.round(performance.now() - started),
            },
          });
          // Network-level failure on an auth endpoint inside an iframe is a
          // strong "embedding blocked" signal for password / magic-link flows.
          if (window.top !== window.self && /\/auth\/v1\//.test(url)) {
            push({
              ts: now(),
              kind: "frame.blocked",
              detail: {
                flow: "password",
                hint: "Auth fetch failed inside iframe — likely CSP/connect-src, CORS, or network partitioning block.",
                url,
                error: String(err?.message ?? err),
              },
            });
          }
        }
        throw err;
      }
    };
  } catch (e) {
    push({ ts: now(), kind: "init", detail: { warning: "fetch-wrap-failed", error: String(e) } });
  }

  // ── 3. postMessage listener (OAuth broker uses web_message) ───────────
  try {
    window.addEventListener("message", (ev) => {
      const data = ev.data;
      const looksAuth =
        (typeof data === "string" && /access_token|error|code/.test(data)) ||
        (data && typeof data === "object" &&
          ("access_token" in (data as any) ||
            "session" in (data as any) ||
            (data as any).type?.toString?.().includes("auth") ||
            (data as any).source?.toString?.().includes("oauth")));
      if (!looksAuth) return;
      push({
        ts: now(),
        kind: "postmessage",
        detail: {
          origin: ev.origin,
          isTrusted: ev.isTrusted,
          hasSession: !!(data as any)?.session,
          type: (data as any)?.type ?? null,
          source: (data as any)?.source ?? null,
        },
      });
    });
  } catch { /* ignore */ }

  // ── 4. CSP violation reports ──────────────────────────────────────────
  try {
    window.addEventListener("securitypolicyviolation", (ev: SecurityPolicyViolationEvent) => {
      push({
        ts: now(),
        kind: "csp.violation",
        detail: {
          blockedURI: ev.blockedURI,
          violatedDirective: ev.violatedDirective,
          effectiveDirective: ev.effectiveDirective,
          disposition: ev.disposition,
          documentURI: ev.documentURI,
          sourceFile: ev.sourceFile,
        },
      });
    });
  } catch { /* ignore */ }

  // ── 5. Detect X-Frame-Options / frame-ancestors block via iframe error ──
  // Browsers don't fire a load event when a top-level frame is blocked, but
  // they log to console. We can't intercept the console message reliably;
  // instead, if we're inside an iframe and a same-origin postMessage never
  // arrives within 15s of a callback, flag it as a probable frame block.
  try {
    const inIframe = window.top !== window.self;
    const looksLikeCallback =
      /[?#].*(code=|access_token=|error=)/.test(window.location.href) ||
      /\/~oauth/.test(window.location.pathname);
    if (inIframe && looksLikeCallback) {
      const t0 = performance.now();
      const timer = setTimeout(() => {
        const gotPost = ring.some((e) => e.kind === "postmessage");
        const gotStore = ring.some((e) => e.kind === "storage.write");
        if (!gotPost && !gotStore) {
          push({
            ts: now(),
            kind: "frame.blocked",
            detail: {
              hint: "No auth postMessage or token write within 15s of iframe callback — likely X-Frame-Options / frame-ancestors block, third-party cookie block, or storage partitioning.",
              waitedMs: Math.round(performance.now() - t0),
              topOrigin: (() => { try { return window.top?.location.origin; } catch { return "(cross-origin)"; } })(),
              selfOrigin: window.location.origin,
            },
          });
        }
      }, 15_000);
      window.addEventListener("beforeunload", () => clearTimeout(timer));
    }
  } catch { /* ignore */ }

  push({
    ts: now(),
    kind: "init",
    detail: {
      href: window.location.href,
      inIframe: window.top !== window.self,
      projectRef: projectRef(),
      supabaseUrl: (import.meta as any).env?.VITE_SUPABASE_URL ?? null,
    },
  });

  // Expose for ad-hoc console inspection.
  (window as any).__oauthTrace = () => ring.slice();
}

export function getOAuthTrace(): OAuthTraceEntry[] {
  return ring.slice();
}

export function clearOAuthTrace() {
  ring.length = 0;
}
