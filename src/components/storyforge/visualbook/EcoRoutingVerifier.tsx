import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Copy, Check, LogIn, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generateChapterImage } from "@/lib/storyforge-api";
import { requestNarrationAudio } from "@/lib/tts-client";
import { getTtsMode, getImageMode } from "@/lib/cost-mode";
import { Link } from "react-router-dom";

type CheckRow = {
  service: "image" | "tts";
  expectedMode: string;
  correlationId?: string;
  clientProvider?: string;
  clientFreeTier?: boolean;
  loggedProvider?: string;
  loggedMode?: string;
  loggedAutoEco?: boolean;
  pass: boolean;
  error?: string;
};

async function fetchLogged(correlationId: string, service: string) {
  // Poll up to 6s — edge function fire-and-forgets the log insert.
  for (let i = 0; i < 6; i++) {
    const { data } = await supabase
      .from("api_usage_logs")
      .select("metadata, service, created_at")
      .eq("service", service)
      .order("created_at", { ascending: false })
      .limit(50);
    const hit = (data || []).find((r) => {
      const md = r.metadata as Record<string, unknown> | null;
      return md && md.correlation_id === correlationId;
    });
    if (hit) {
      const md = hit.metadata as Record<string, unknown>;
      return {
        provider: typeof md.provider === "string" ? md.provider : undefined,
        mode: typeof md.mode === "string" ? md.mode : undefined,
        autoEco: !!md.auto_eco,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export function EcoRoutingVerifier() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CheckRow[]>([]);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionEmail(data.session?.user?.email ?? null);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null);
      setSessionLoading(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const expectedImageProvider = (mode: string) =>
    mode === "premium" ? "gemini" : mode === "draft" ? "free" : "any";
  const expectedTtsProvider = (mode: string) =>
    mode === "premium" ? "elevenlabs" : mode === "eco" ? "free" : "any";

  const providerMatches = (logged: string | undefined, expectedFamily: string) => {
    if (!logged) return false;
    if (expectedFamily === "any") return true;
    if (expectedFamily === "gemini") return logged.includes("gemini");
    if (expectedFamily === "elevenlabs") return logged.includes("elevenlabs");
    if (expectedFamily === "free") {
      return ["pollinations", "flux", "huggingface", "browser"].some((p) => logged.toLowerCase().includes(p));
    }
    return logged === expectedFamily;
  };

  const handleRun = async () => {
    // Hard-gate: refuse to run probes without an authenticated session, since
    // edge functions require JWT and api_usage_logs rows are user-scoped.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toast({
        title: "Sign in required",
        description: "Log in inside the preview before running the Eco routing test.",
        variant: "destructive",
      });
      return;
    }
    setRunning(true);
    setResults([]);
    const ttsMode = getTtsMode();
    const imageMode = getImageMode();
    const rows: CheckRow[] = [];

    // 1) Image probe
    try {
      const imgRes = await generateChapterImage(
        "verify-probe",
        "A small abstract geometric pattern, soft pastel colors, minimalist test illustration",
        undefined,
        "cinematic",
      );
      const logged = imgRes.correlationId ? await fetchLogged(imgRes.correlationId, "generate-chapter-image") : null;
      const expected = expectedImageProvider(imageMode);
      const pass = providerMatches(logged?.provider, expected);
      rows.push({
        service: "image",
        expectedMode: imageMode,
        correlationId: imgRes.correlationId,
        clientProvider: imgRes.provider,
        clientFreeTier: imgRes.freeTier,
        loggedProvider: logged?.provider,
        loggedMode: logged?.mode,
        loggedAutoEco: logged?.autoEco,
        pass: pass || (imageMode === "auto"),
      });
    } catch (e: any) {
      rows.push({ service: "image", expectedMode: imageMode, pass: false, error: e?.message || "Image probe failed" });
    }
    setResults([...rows]);

    // 2) TTS probe
    try {
      const ttsRes = await requestNarrationAudio({
        text: "Eco routing verification probe. This is a short test sentence.",
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
      });
      if (ttsRes.kind === "fallback") {
        // Browser SpeechSynthesis is a legitimate free-tier provider, so a
        // `fallback: provider:browser` response satisfies eco/auto modes.
        // In premium mode it means the user's premium quota is exhausted —
        // surface an actionable message instead of a generic outage line.
        const isBrowserFallback = ttsRes.payload.provider === "browser";
        const acceptable = isBrowserFallback && (ttsMode === "eco" || ttsMode === "auto");
        const premiumExhausted = isBrowserFallback && ttsMode === "premium";
        rows.push({
          service: "tts",
          expectedMode: ttsMode,
          clientProvider: ttsRes.payload.provider,
          clientFreeTier: isBrowserFallback,
          loggedProvider: isBrowserFallback ? "browser" : undefined,
          pass: acceptable,
          error: acceptable
            ? undefined
            : premiumExhausted
              ? "Premium narration quota is exhausted. Top up add-on credits or switch to Eco mode."
              : (ttsRes.payload.message || "TTS fallback"),
        });
      } else {
        const logged = ttsRes.correlationId ? await fetchLogged(ttsRes.correlationId, "elevenlabs-tts") : null;
        const expected = expectedTtsProvider(ttsMode);
        const pass = providerMatches(logged?.provider, expected);
        rows.push({
          service: "tts",
          expectedMode: ttsMode,
          correlationId: ttsRes.correlationId,
          clientProvider: ttsRes.provider,
          clientFreeTier: ttsRes.freeTier,
          loggedProvider: logged?.provider,
          loggedMode: logged?.mode,
          loggedAutoEco: logged?.autoEco,
          pass: pass || (ttsMode === "auto"),
        });
      }
    } catch (e: any) {
      rows.push({ service: "tts", expectedMode: ttsMode, pass: false, error: e?.message || "TTS probe failed" });
    }
    setResults([...rows]);

    const allPass = rows.every((r) => r.pass);
    toast({
      title: allPass ? "Eco routing verified ✓" : "Routing mismatch detected",
      description: allPass
        ? `Image: ${imageMode} • Narration: ${ttsMode} — providers match expectations.`
        : "One or more providers did not match the configured mode. See details below.",
      variant: allPass ? "default" : "destructive",
    });
    setRunning(false);
  };

  const copy = (cid: string) => {
    navigator.clipboard?.writeText(cid).then(() => {
      setCopiedCid(cid);
      setTimeout(() => setCopiedCid((c) => (c === cid ? null : c)), 1500);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-semibold">Eco Routing Verification</h4>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleRun}
          disabled={running || sessionLoading || !sessionEmail}
        >
          {running ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Running…</> : "Run check"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Generates a tiny test image + narration, then queries{" "}
        <code className="text-[10px] bg-muted px-1 rounded">api_usage_logs.metadata.provider</code> to confirm the
        configured mode actually routed to the expected provider.
      </p>

      {/* Session gate */}
      {sessionLoading ? (
        <div className="flex items-center gap-2 rounded border border-border/40 bg-muted/30 p-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking session…
        </div>
      ) : sessionEmail ? (
        <div className="flex items-center gap-2 rounded border border-primary/30 bg-primary/5 p-2 text-[11px]">
          <UserCheck className="h-3 w-3 text-primary" />
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-mono text-foreground truncate">{sessionEmail}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px]">
          <div className="flex items-center gap-2 text-destructive">
            <LogIn className="h-3 w-3" />
            <span>Sign in required to run the routing test.</span>
          </div>
          <Button asChild size="sm" variant="default" className="h-6 text-[11px] px-2 gap-1">
            <Link to={`/auth?redirect=${encodeURIComponent(window.location.pathname)}`}>
              <LogIn className="h-3 w-3" /> Sign in
            </Link>
          </Button>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <div
              key={r.service}
              className={`rounded border p-2 text-[11px] space-y-1 ${
                r.pass ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {r.pass ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className="font-semibold uppercase tracking-wide">{r.service}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1">mode: {r.expectedMode}</Badge>
                {r.loggedAutoEco && <Badge variant="outline" className="text-[9px] h-4 px-1 border-accent/40">auto-eco</Badge>}
              </div>
              {r.error ? (
                <p className="text-destructive">{r.error}</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
                  <span>Client provider:</span>
                  <span className="font-mono text-foreground">{r.clientProvider ?? "—"}</span>
                  <span>Logged provider:</span>
                  <span className="font-mono text-foreground">{r.loggedProvider ?? "(not found)"}</span>
                  <span>Logged mode:</span>
                  <span className="font-mono text-foreground">{r.loggedMode ?? "—"}</span>
                  <span>Free tier:</span>
                  <span className="font-mono text-foreground">{r.clientFreeTier ? "yes" : "no"}</span>
                </div>
              )}
              {r.correlationId && (
                <button
                  type="button"
                  onClick={() => copy(r.correlationId!)}
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  title="Copy correlation ID"
                >
                  cid: {r.correlationId.slice(0, 8)}
                  {copiedCid === r.correlationId ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
