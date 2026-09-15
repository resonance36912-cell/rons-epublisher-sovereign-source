import { useEffect, useMemo, useState } from "react";
// Card primitive not available in this project â€” use plain divs styled to match.
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, ExternalLink, ShieldCheck, RotateCcw } from "lucide-react";
import { toast } from "sonner";

/**
 * Pre-deploy checklist for verifying that the current preview / published origins
 * are whitelisted in Supabase Auth (Site URL + Redirect URLs) and in the Google
 * OAuth client (Authorized JS Origins + Redirect URIs). Checked state is
 * persisted per-origin in localStorage so the list survives reloads.
 */

const CHECKLIST: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "supabase-site-url",
    label: "Supabase Auth â†’ Site URL matches the published origin",
    hint: "Cloud â†’ Users â†’ Auth Settings â†’ URL Configuration",
  },
  {
    id: "supabase-redirects",
    label: "Preview + published + localhost origins are in Additional Redirect URLs",
    hint: "Include /** suffix for each origin",
  },
  {
    id: "supabase-custom-domain",
    label: "Custom domain (if any) is in Additional Redirect URLs",
    hint: "https://yourdomain.com/**",
  },
  {
    id: "google-js-origins",
    label: "Google OAuth client â†’ Authorized JavaScript origins include preview + published",
    hint: "Only needed if using BYO Google OAuth. Managed Google OAuth is automatic.",
  },
  {
    id: "google-redirect-uris",
    label: "Google OAuth client â†’ Authorized redirect URIs include the Supabase callback",
    hint: "http://127.0.0.1:58680/auth/callback",
  },
  {
    id: "signin-redirect-target",
    label: "signInWithOAuth uses window.location.origin (not a hardcoded prod URL)",
    hint: "Grep for redirect_uri / emailRedirectTo / resetPasswordForEmail",
  },
  {
    id: "signin-not-protected-route",
    label: "redirect_uri points to a public route (never /app, /dashboard, invite pages)",
    hint: "Store intended destination separately; navigate after session hydrates",
  },
  {
    id: "no-iframe-workarounds",
    label: "No custom window.open / iframe-detection wrappers around sign-in",
    hint: "RONS local auth handles the application session natively",
  },
];

const STORAGE_KEY = "admin.auth_origins_checklist.v1";

export function AdminAuthOriginsChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [customDomain, setCustomDomain] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setChecked(parsed.checked ?? {});
        setCustomDomain(parsed.customDomain ?? "");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ checked, customDomain }));
    } catch {
      /* ignore */
    }
  }, [checked, customDomain]);

  const origins = useMemo(() => {
    const previewOrigin = typeof window !== "undefined" ? window.location.origin : "";
    const supaUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
    const projectRef = supaUrl?.match(/https?:\/\/([^.]+)\./)?.[1] ?? "";
    const supaCallback = projectRef ? `http://127.0.0.1:58680/auth/callback` : "(unknown)";
    return {
      preview: previewOrigin,
      published: "https://resonanceonline.life",
      customDomains: ["https://www.resonanceonline.life", "https://resonanceonline.life"],
      localhost: "http://localhost:8080",
      supaCallback,
      projectRef,
    };
  }, []);

  const redirectList = useMemo(() => {
    const list = [origins.preview, origins.published, ...origins.customDomains, origins.localhost]
      .filter(Boolean)
      .map((o) => `${o}/**`);
    if (customDomain.trim()) list.push(`${customDomain.trim().replace(/\/+$/, "")}/**`);
    return Array.from(new Set(list));
  }, [origins, customDomain]);

  const jsOrigins = useMemo(() => {
    const list = [origins.preview, origins.published, ...origins.customDomains].filter(Boolean);
    if (customDomain.trim()) list.push(customDomain.trim().replace(/\/+$/, ""));
    return Array.from(new Set(list));
  }, [origins, customDomain]);

  const total = CHECKLIST.length;
  const done = CHECKLIST.filter((c) => checked[c.id]).length;
  const allDone = done === total;

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

  const reset = () => {
    setChecked({});
    toast.success("Checklist reset");
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-6 border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Auth Origins â€” Pre-Deploy Checklist
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              Verify every origin (preview, published, custom domain) is whitelisted in Supabase Auth and Google
              OAuth before shipping. Prevents same-tab sign-in from silently falling back to a new-tab popup.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={allDone ? "default" : "secondary"}>
              {done} / {total}
            </Badge>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Detected origins */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="text-sm font-medium">Detected values</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
            <Row label="Preview origin" value={origins.preview} onCopy={(v) => copy(v, "preview")} copied={copied === "preview"} />
            <Row label="Published" value={origins.published} onCopy={(v) => copy(v, "pub")} copied={copied === "pub"} />
            <Row label="Custom domain (primary)" value={origins.customDomains[0]} onCopy={(v) => copy(v, "cd")} copied={copied === "cd"} />
            <Row label="Supabase project ref" value={origins.projectRef || "(unknown)"} onCopy={(v) => copy(v, "ref")} copied={copied === "ref"} />
            <Row label="Supabase callback URL" value={origins.supaCallback} onCopy={(v) => copy(v, "cb")} copied={copied === "cb"} />
          </div>
          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1">
              <Label htmlFor="extra-domain" className="text-xs">Additional custom domain (optional)</Label>
              <Input
                id="extra-domain"
                placeholder="https://example.com"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>
        </div>

        {/* Whitelist blocks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WhitelistBlock
            title="Supabase â†’ Additional Redirect URLs"
            hint="Paste each on a separate line"
            values={redirectList}
            onCopy={() => copy(redirectList.join("\n"), "redir")}
            copied={copied === "redir"}
          />
          <WhitelistBlock
            title="Google OAuth â†’ Authorized JS Origins"
            hint="Only needed for BYO Google OAuth"
            values={jsOrigins}
            onCopy={() => copy(jsOrigins.join("\n"), "js")}
            copied={copied === "js"}
          />
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          {CHECKLIST.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40 cursor-pointer transition-colors"
            >
              <Checkbox
                checked={!!checked[item.id]}
                onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [item.id]: v === true }))}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.hint}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            {allDone ? (
              <span className="text-primary font-medium">All checks passed â€” safe to deploy.</span>
            ) : (
              <span>Complete all items before publishing.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Google Console
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-background/60 px-2 py-1.5 border">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-sans">{label}</div>
        <div className="truncate">{value}</div>
      </div>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => onCopy(value)}>
        {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
}

function WhitelistBlock({
  title,
  hint,
  values,
  onCopy,
  copied,
}: {
  title: string;
  hint: string;
  values: string[];
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={onCopy}>
          {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy all"}
        </Button>
      </div>
      <pre className="text-xs font-mono bg-background/60 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {values.join("\n")}
      </pre>
    </div>
  );
}

