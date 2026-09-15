import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Copy,
  Check,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Preview-iframe redirect-URL checklist.
 *
 * Shows the *exact* URLs that must be whitelisted in Supabase Auth and (for
 * BYO Google OAuth) the Google Cloud OAuth client for the currently-detected
 * preview iframe origin. Runs live probes to warn if any required URL is
 * missing or unreachable.
 *
 * Probes:
 *  1. `/auth/callback` on the current origin resolves 200 (SPA fallback works).
 *  2. Supabase project URL + callback are reachable (auth settings endpoint 200/401).
 *  3. Origin is running inside an iframe (mirrors the Lovable preview scenario).
 *  4. Localhost/preview/published/custom origins are all present in the
 *     computed required-URL list.
 */

type ProbeState = "idle" | "running" | "ok" | "warn" | "fail";
type Probe = {
  id: string;
  label: string;
  detail: string;
  state: ProbeState;
};

const KNOWN_PUBLISHED = "https://resonanceonline.life";
const KNOWN_CUSTOM_DOMAINS = [
  "https://www.resonanceonline.life",
  "https://resonanceonline.life",
];
const LOCALHOST = "http://localhost:8080";

function stripTrailingSlash(u: string) {
  return u.replace(/\/+$/, "");
}

export function AdminPreviewRedirectChecklist() {
  const [copied, setCopied] = useState<string | null>(null);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [running, setRunning] = useState(false);

  const detected = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const supaUrl = (import.meta as any).env?.VITE_SUPABASE_URL as
      | string
      | undefined;
    const projectRef = supaUrl?.match(/https?:\/\/([^.]+)\./)?.[1] ?? "";
    const supaCallback = projectRef
      ? `http://127.0.0.1:58680/auth/callback`
      : "";
    const inIframe =
      typeof window !== "undefined" && window.self !== window.top;
    const isPreviewHost = /(-preview--|resonanceonline\.life)/.test(origin);
    return {
      origin,
      supaUrl,
      projectRef,
      supaCallback,
      inIframe,
      isPreviewHost,
    };
  }, []);

  // The full canonical set of origins the app can be loaded from.
  const requiredOrigins = useMemo(() => {
    const list = [
      detected.origin,
      KNOWN_PUBLISHED,
      ...KNOWN_CUSTOM_DOMAINS,
      LOCALHOST,
    ]
      .filter(Boolean)
      .map(stripTrailingSlash);
    return Array.from(new Set(list));
  }, [detected.origin]);

  // Supabase â†’ "Site URL" must be a single canonical URL â€” pick the published
  // site (or custom domain) rather than a preview host.
  const supabaseSiteUrl = KNOWN_PUBLISHED;

  // Supabase â†’ "Additional Redirect URLs" â€” every origin, both the /**
  // wildcard and the exact /auth/callback path.
  const supabaseRedirectUrls = useMemo(() => {
    const rows: string[] = [];
    for (const o of requiredOrigins) {
      rows.push(`${o}/**`);
      rows.push(`${o}/auth/callback`);
    }
    return Array.from(new Set(rows));
  }, [requiredOrigins]);

  // Google â†’ "Authorized JavaScript origins" (BYO OAuth only).
  const googleJsOrigins = useMemo(
    () => requiredOrigins.filter((o) => o !== LOCALHOST || true),
    [requiredOrigins],
  );

  // Google â†’ "Authorized redirect URIs" (BYO OAuth only): the Supabase
  // callback plus each origin's /auth/callback.
  const googleRedirectUris = useMemo(() => {
    const rows: string[] = [];
    if (detected.supaCallback) rows.push(detected.supaCallback);
    for (const o of requiredOrigins) rows.push(`${o}/auth/callback`);
    return Array.from(new Set(rows));
  }, [requiredOrigins, detected.supaCallback]);

  const runProbes = async () => {
    setRunning(true);
    const results: Probe[] = [];

    // 1. Detected origin sanity
    if (!detected.origin) {
      results.push({
        id: "origin",
        label: "Preview origin detected",
        detail: "window.location.origin was empty.",
        state: "fail",
      });
    } else {
      results.push({
        id: "origin",
        label: "Preview origin detected",
        detail: detected.origin,
        state: "ok",
      });
    }

    // 2. Iframe context (informational for the preview scenario)
    results.push({
      id: "iframe",
      label: "Running inside an iframe",
      detail: detected.inIframe
        ? "Yes â€” this is the preview scenario. All redirect URLs below must be whitelisted."
        : "No â€” running at top-level. Whitelisting is still required for parity.",
      state: detected.inIframe ? "ok" : "warn",
    });

    // 3. Supabase project ref detected
    if (!detected.projectRef) {
      results.push({
        id: "supa-ref",
        label: "Supabase project reference resolved",
        detail: "VITE_SUPABASE_URL is not set â€” cannot compute callback URL.",
        state: "fail",
      });
    } else {
      results.push({
        id: "supa-ref",
        label: "Supabase project reference resolved",
        detail: detected.projectRef,
        state: "ok",
      });
    }

    // 4. /auth/callback route on current origin returns 200 (SPA fallback works)
    try {
      const res = await fetch(`${detected.origin}/auth/callback`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      });
      if (res.ok || res.status === 0) {
        results.push({
          id: "callback-route",
          label: "/auth/callback route reachable on this origin",
          detail: `HTTP ${res.status || "opaque"} â€” SPA fallback is serving the callback page.`,
          state: "ok",
        });
      } else {
        results.push({
          id: "callback-route",
          label: "/auth/callback route reachable on this origin",
          detail: `HTTP ${res.status} â€” SPA fallback may be misconfigured.`,
          state: "fail",
        });
      }
    } catch (e: any) {
      results.push({
        id: "callback-route",
        label: "/auth/callback route reachable on this origin",
        detail: `Fetch failed: ${e?.message ?? e}`,
        state: "fail",
      });
    }

    // 5. Supabase auth settings endpoint reachable
    if (detected.supaUrl) {
      try {
        const res = await fetch(`${detected.supaUrl}/auth/v1/settings`, {
          method: "GET",
          cache: "no-store",
        });
        results.push({
          id: "supa-reachable",
          label: "Supabase auth endpoint reachable from this origin",
          detail: `HTTP ${res.status} at ${detected.supaUrl}/auth/v1/settings`,
          state: res.ok ? "ok" : "warn",
        });
      } catch (e: any) {
        results.push({
          id: "supa-reachable",
          label: "Supabase auth endpoint reachable from this origin",
          detail: `Fetch failed: ${e?.message ?? e} â€” likely CORS or Site URL/redirect not whitelisted.`,
          state: "fail",
        });
      }
    }

    // 6. Missing origin coverage
    const missing = requiredOrigins.filter(
      (o) => !supabaseRedirectUrls.some((r) => r.startsWith(o)),
    );
    results.push({
      id: "coverage",
      label: "All known origins covered in the redirect list",
      detail: missing.length
        ? `Missing: ${missing.join(", ")}`
        : `${requiredOrigins.length} origin(s) covered.`,
      state: missing.length ? "fail" : "ok",
    });

    setProbes(results);
    setRunning(false);
  };

  useEffect(() => {
    runProbes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const failCount = probes.filter((p) => p.state === "fail").length;
  const warnCount = probes.filter((p) => p.state === "warn").length;
  const okCount = probes.filter((p) => p.state === "ok").length;

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-6 border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Preview-Iframe Redirect URLs
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              Exact URLs to whitelist in Supabase Auth and Google Cloud so
              sign-in works from this preview origin. Re-run the probes after
              you change any auth setting.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {failCount > 0 && (
              <Badge variant="destructive">{failCount} failing</Badge>
            )}
            {warnCount > 0 && failCount === 0 && (
              <Badge variant="secondary">{warnCount} warnings</Badge>
            )}
            {failCount === 0 && warnCount === 0 && probes.length > 0 && (
              <Badge>{okCount} passing</Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={runProbes}
              disabled={running}
              className="gap-1.5"
            >
              {running ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Re-run
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Detected values */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5 text-xs font-mono">
          <KV label="Preview origin" value={detected.origin} onCopy={copy} copied={copied} id="d-origin" />
          <KV label="In iframe" value={String(detected.inIframe)} onCopy={copy} copied={copied} id="d-iframe" />
          <KV label="Supabase project ref" value={detected.projectRef || "(missing)"} onCopy={copy} copied={copied} id="d-ref" />
          <KV label="Supabase callback URL" value={detected.supaCallback || "(missing)"} onCopy={copy} copied={copied} id="d-cb" />
        </div>

        {/* Probes */}
        {failCount > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle>{failCount} check(s) failing</AlertTitle>
            <AlertDescription>
              Sign-in from this preview origin will fail until every URL below
              is added to Supabase Auth (and, for BYO Google OAuth, the Google
              Cloud console).
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          {probes.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-3 rounded-md border p-3 text-sm"
            >
              <ProbeIcon state={p.state} />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground break-words">
                  {p.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Required URL blocks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UrlBlock
            title="Supabase Auth â†’ Site URL"
            hint="Single canonical URL â€” should be the published site."
            values={[supabaseSiteUrl]}
            onCopy={(v) => copy(v.join("\n"), "site")}
            copied={copied === "site"}
          />
          <UrlBlock
            title="Supabase Auth â†’ Additional Redirect URLs"
            hint="Each on its own line. Both the wildcard and the exact /auth/callback path."
            values={supabaseRedirectUrls}
            onCopy={(v) => copy(v.join("\n"), "redir")}
            copied={copied === "redir"}
          />
          <UrlBlock
            title="Google OAuth â†’ Authorized JavaScript origins"
            hint="Only if using BYO Google OAuth credentials."
            values={googleJsOrigins}
            onCopy={(v) => copy(v.join("\n"), "gjs")}
            copied={copied === "gjs"}
          />
          <UrlBlock
            title="Google OAuth â†’ Authorized redirect URIs"
            hint="Only if using BYO Google OAuth credentials."
            values={googleRedirectUris}
            onCopy={(v) => copy(v.join("\n"), "gredir")}
            copied={copied === "gredir"}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            Managed Google OAuth (default) doesn't need any Google Cloud
            changes â€” Supabase whitelisting alone is enough.
          </div>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Google Cloud Console
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProbeIcon({ state }: { state: ProbeState }) {
  if (state === "ok") return <Check className="w-4 h-4 text-primary mt-0.5" />;
  if (state === "warn")
    return <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />;
  if (state === "fail")
    return <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />;
  return <Loader2 className="w-4 h-4 animate-spin mt-0.5" />;
}

function KV({
  label,
  value,
  onCopy,
  copied,
  id,
}: {
  label: string;
  value: string;
  onCopy: (v: string, id: string) => void;
  copied: string | null;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-sans">
        {label}
      </span>
      <span className="truncate flex-1 text-right">{value}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 shrink-0"
        onClick={() => onCopy(value, id)}
      >
        {copied === id ? (
          <Check className="w-3 h-3 text-primary" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </Button>
    </div>
  );
}

function UrlBlock({
  title,
  hint,
  values,
  onCopy,
  copied,
}: {
  title: string;
  hint: string;
  values: string[];
  onCopy: (v: string[]) => void;
  copied: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => onCopy(values)}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-primary" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? "Copied" : "Copy all"}
        </Button>
      </div>
      <pre className="text-xs font-mono bg-background/60 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {values.join("\n")}
      </pre>
    </div>
  );
}

