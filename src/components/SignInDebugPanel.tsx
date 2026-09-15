import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, Copy, X, ExternalLink } from "lucide-react";
import { getOAuthTrace, clearOAuthTrace, type OAuthTraceEntry } from "@/lib/oauth-trace";

const OPEN_NEW_TAB_KEY = "auth_open_new_tab_on_block";

/** Open the current URL in a fresh top-level tab, stripping ?debug flags loops. */
function openInNewTab() {
  try {
    const w = window.open(window.location.href, "_blank", "noopener,noreferrer");
    if (!w) console.warn("[auth] popup blocked; user must allow popups");
  } catch (e) {
    console.warn("[auth] openInNewTab failed", e);
  }
}

/**
 * Diagnostic panel for auth/OAuth issues. Renders only when:
 *   - URL has ?debug=auth, OR
 *   - localStorage["auth_debug"] === "1"
 *
 * Shows: session state, storage/cookie presence for the Supabase auth token,
 * intended redirect target, and the OAuth callback origin the browser will use.
 */
export function SignInDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [tick, setTick] = useState(0);
  const [session, setSession] = useState<any>(null);
  const [event, setEvent] = useState<string>("(none)");

  const [openNewTab, setOpenNewTab] = useState<boolean>(
    () => (typeof localStorage !== "undefined" && localStorage.getItem(OPEN_NEW_TAB_KEY) === "1")
  );
  const autoOpenedRef = useRef(false);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const on =
      params.get("debug") === "auth" ||
      localStorage.getItem("auth_debug") === "1";
    setEnabled(on);
    if (on) localStorage.setItem("auth_debug", "1");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setEvent(e);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [enabled, tick]);

  // Escape the iframe to a new top-level tab when embedding blocks either flow:
  //   - OAuth: `frame.blocked` (no postmessage/token write after callback)
  //   - Password / magic-link: `frame.blocked` with flow=password, auth fetch
  //     errors, or CSP violations against a Supabase auth endpoint.
  useEffect(() => {
    if (!openNewTab || autoOpenedRef.current) return;
    const inIframe = window.top !== window.self;
    if (!inIframe) return;
    const check = () => {
      const trace = getOAuthTrace();
      const blocked = trace.some((e) => {
        if (e.kind === "frame.blocked") return true;
        if (e.kind === "fetch.error") {
          const url = String((e.detail as any)?.url ?? "");
          return /\/auth\/v1\//.test(url);
        }
        if (e.kind === "csp.violation") {
          const uri = String((e.detail as any)?.blockedURI ?? "");
          return /auth\/v1|supabase\.co|oauth\.lovable\.app/.test(uri);
        }
        return false;
      });
      if (blocked && !autoOpenedRef.current) {
        autoOpenedRef.current = true;
        openInNewTab();
      }
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [openNewTab, enabled]);

  if (!enabled) return null;

  const url = new URL(window.location.href);
  const supaUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const projectRef = supaUrl?.match(/https?:\/\/([^.]+)\./)?.[1] ?? "(unknown)";
  const storageKey = `sb-${projectRef}-auth-token`;
  const lsRaw = (() => { try { return localStorage.getItem(storageKey); } catch { return null; } })();
  const ssRaw = (() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } })();
  const cookies = document.cookie.split(";").map(c => c.trim()).filter(Boolean);
  const authCookies = cookies.filter(c => c.startsWith(`sb-${projectRef}-`) || c.startsWith("sb-"));

  const redirectTarget = `${window.location.origin}/app`;
  const oauthCallbackOrigin = window.location.origin;
  const parsedLs = (() => { try { return lsRaw ? JSON.parse(lsRaw) : null; } catch { return "(unparseable)"; } })();
  const expiresAt = session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;

  const rows: Array<[string, string]> = [
    ["Current URL", url.href],
    ["Origin", window.location.origin],
    ["In iframe", String(window.top !== window.self)],
    ["OAuth callback origin", oauthCallbackOrigin],
    ["Post-sign-in redirect", redirectTarget],
    ["Supabase URL", supaUrl ?? "(missing)"],
    ["Project ref", projectRef],
    ["Storage key", storageKey],
    ["Auth event (last)", event],
    ["Session present", String(!!session)],
    ["User", session?.user?.email ?? "(none)"],
    ["User id", session?.user?.id ?? "(none)"],
    ["Provider", session?.user?.app_metadata?.provider ?? "(none)"],
    ["Access token", session?.access_token ? `${session.access_token.slice(0, 12)}… (${session.access_token.length} chars)` : "(none)"],
    ["Refresh token", session?.refresh_token ? "present" : "(none)"],
    ["Expires at", expiresAt ?? "(none)"],
    ["localStorage token", lsRaw ? `present (${lsRaw.length} chars)` : "MISSING"],
    ["sessionStorage token", ssRaw ? `present (${ssRaw.length} chars)` : "(none)"],
    ["Cookies (all count)", String(cookies.length)],
    ["sb-* cookies", authCookies.length ? authCookies.map(c => c.split("=")[0]).join(", ") : "(none)"],
    ["3rd-party cookies blocked?", "Check DevTools → Application → Cookies"],
    ["User agent", navigator.userAgent],
  ];

  const dump = rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nlocalStorage session (parsed):\n${JSON.stringify(parsedLs, null, 2)}`;

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-md w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-background/95 backdrop-blur shadow-xl text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold">Sign-in debug</span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={openInNewTab} title="Open preview in new tab">
            <ExternalLink className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setTick(t => t + 1)} title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigator.clipboard.writeText(dump)} title="Copy">
            <Copy className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { localStorage.removeItem("auth_debug"); setEnabled(false); }} title="Close">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <label htmlFor="auth-open-new-tab" className="flex items-center gap-2 cursor-pointer">
          <input
            id="auth-open-new-tab"
            type="checkbox"
            className="h-3 w-3"
            checked={openNewTab}
            onChange={(e) => {
              const v = e.target.checked;
              setOpenNewTab(v);
              autoOpenedRef.current = false;
              if (v) localStorage.setItem(OPEN_NEW_TAB_KEY, "1");
              else localStorage.removeItem(OPEN_NEW_TAB_KEY);
            }}
          />
          <span>Open in new tab when auth embedding is blocked</span>
        </label>
        <button
          className="text-[10px] underline text-muted-foreground hover:text-foreground"
          onClick={openInNewTab}
        >
          open now
        </button>
      </div>
      <div className="max-h-[60vh] overflow-auto p-3 space-y-3 font-mono">
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[10rem_1fr] gap-2">
              <span className="text-muted-foreground truncate" title={k}>{k}</span>
              <span className="break-all">{v}</span>
            </div>
          ))}
        </div>
        <OAuthTraceList tick={tick} />
      </div>
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        Enable anywhere: append <code>?debug=auth</code> to the URL. Close to disable.
      </div>
    </div>
  );
}

function OAuthTraceList({ tick }: { tick: number }) {
  const [entries, setEntries] = useState<OAuthTraceEntry[]>([]);
  useEffect(() => {
    setEntries(getOAuthTrace());
    const id = setInterval(() => setEntries(getOAuthTrace()), 1000);
    return () => clearInterval(id);
  }, [tick]);

  const color = (k: OAuthTraceEntry["kind"]) => {
    if (k === "fetch.error" || k === "csp.violation" || k === "frame.blocked") return "text-destructive";
    if (k === "storage.write" || k === "storage.remove") return "text-primary";
    if (k === "postmessage") return "text-blue-500";
    return "text-muted-foreground";
  };

  return (
    <div className="border-t border-border pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-[11px]">OAuth trace ({entries.length})</span>
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground underline"
          onClick={() => { clearOAuthTrace(); setEntries([]); }}
        >
          clear
        </button>
      </div>
      {entries.length === 0 ? (
        <div className="text-[10px] text-muted-foreground italic">
          No callback events yet. Trigger a sign-in and watch this fill.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.slice(-40).map((e, i) => (
            <div key={i} className="text-[10px] leading-tight">
              <div className={`${color(e.kind)} font-semibold`}>
                {e.ts.slice(11, 19)} · {e.kind}
              </div>
              <div className="pl-2 text-muted-foreground break-all">
                {Object.entries(e.detail)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                  .join("  ")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
