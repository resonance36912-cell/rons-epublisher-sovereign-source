// Admin tool: request a sample signed URL from the `sign-chapter-images`
// edge function for a chosen chapter image path, and show the expected
// expiration time (derived from the configured TTL).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react";

type SignResult = { path: string; signedUrl?: string; error?: string };

const TTL_KEY = "signed_url_ttl_seconds";
const DEFAULT_TTL = 900;

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function AdminSignedUrlTesterSection() {
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState<number | null>(null);
  const [ttl, setTtl] = useState<number>(DEFAULT_TTL);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Load configured TTL (admins have read access to app_settings).
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", TTL_KEY)
        .maybeSingle();
      const raw = (data as { value?: unknown } | null)?.value;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n > 0) setTtl(Math.floor(n));
    })();
  }, []);

  // Tick once per second while a signed URL is live (for countdown).
  useEffect(() => {
    if (!signedUrl || !issuedAt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [signedUrl, issuedAt]);

  const request = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      toast({ title: "Path required", description: "Enter a chapter-images path or full URL.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setSignedUrl(null);
    setIssuedAt(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "sign-chapter-images",
        { body: { paths: [trimmed] } },
      );
      if (error) throw error;
      const result = (data as { results?: SignResult[] } | null)?.results?.[0];
      if (!result) throw new Error("No result returned");
      if (result.error || !result.signedUrl) {
        setErrorMsg(result.error || "Failed to sign URL");
        toast({ title: "Sign failed", description: result.error || "Failed to sign URL", variant: "destructive" });
      } else {
        setSignedUrl(result.signedUrl);
        setIssuedAt(Date.now());
        toast({ title: "Signed URL issued", description: `Expires in ~${Math.round(ttl / 60)} min.` });
      }
    } catch (e) {
      const msg = (e as Error).message || "Request failed";
      setErrorMsg(msg);
      toast({ title: "Request failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!signedUrl) return;
    try {
      await navigator.clipboard.writeText(signedUrl);
      toast({ title: "Copied", description: "Signed URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const expiresAt = issuedAt ? issuedAt + ttl * 1000 : null;
  const remainingMs = expiresAt ? expiresAt - Date.now() : 0;

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> Signed URL Tester
        </h2>
        <p className="text-sm text-muted-foreground">
          Request a short-lived signed URL for any object in the <code>chapter-images</code> bucket
          via the <code>sign-chapter-images</code> edge function. Admins can sign any path; the
          response uses the currently configured TTL.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sign-path">Storage path or full URL</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="sign-path"
            placeholder="<user-id>/<project-id>/chapter-1.png"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="flex-1 min-w-[280px] font-mono text-xs"
          />
          <Button onClick={request} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request signed URL"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Accepts a bare path, a legacy public URL, or a previously-signed URL — anything containing <code>/chapter-images/</code>.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {signedUrl && expiresAt && (
        <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Issued at</div>
              <div className="font-mono">{new Date(issuedAt!).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Expires at</div>
              <div className="font-mono">{new Date(expiresAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Remaining</div>
              <div className="font-mono font-medium">
                {fmtCountdown(remainingMs)} <span className="text-muted-foreground">/ {ttl}s TTL</span>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Signed URL</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all text-xs bg-background border border-border/40 rounded p-2 font-mono">
                {signedUrl}
              </code>
              <div className="flex flex-col gap-1">
                <Button size="sm" variant="outline" onClick={copy} title="Copy URL">
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="outline" asChild title="Open in new tab">
                  <a href={signedUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
