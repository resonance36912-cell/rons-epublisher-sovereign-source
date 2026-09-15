import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, RefreshCw, Loader2, Leaf, Sparkles, Filter, Copy, Check, Zap, History, AlertTriangle, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AUTO_REFRESH_INTERVALS = [3, 5, 10, 30] as const;
type RefreshInterval = typeof AUTO_REFRESH_INTERVALS[number];

type LogRow = {
  id: string;
  service: string;
  created_at: string;
  cost_estimate: number | null;
  tokens_or_chars: number | null;
  duration_ms: number | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
};

type Filter = "all" | "eco" | "premium";

const ECO_PROVIDERS = ["pollinations", "flux", "huggingface", "browser", "cache"];
const PREMIUM_PROVIDERS = ["elevenlabs", "gemini"];

function classify(provider: string | undefined): "eco" | "premium" | "unknown" {
  if (!provider) return "unknown";
  const p = provider.toLowerCase();
  if (ECO_PROVIDERS.some((x) => p.includes(x))) return "eco";
  if (PREMIUM_PROVIDERS.some((x) => p.includes(x))) return "premium";
  return "unknown";
}

/** Detect mismatches between mode/tier metadata and the actual provider routing. */
function detectMismatch(provider: string, mode: string, autoEco: boolean): string | null {
  const tier = classify(provider);
  const m = (mode || "").toLowerCase();
  const declaredEco = m === "eco" || m === "draft" || autoEco;
  const declaredPremium = m === "premium" || m === "quality" || m === "hd";
  if (declaredEco && tier === "premium") return `Mode "${mode}" expects eco but provider "${provider}" is premium`;
  if (declaredPremium && tier === "eco") return `Mode "${mode}" expects premium but provider "${provider}" is eco`;
  if (autoEco && tier !== "eco" && tier !== "unknown") return `auto_eco flag set but provider "${provider}" is not eco`;
  return null;
}

export function AdminProviderRoutingAudit() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [serviceFilter, setServiceFilter] = useState<"all" | "elevenlabs-tts" | "generate-chapter-image">("all");
  const [cidQuery, setCidQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<LogRow | null>(null);
  const [relatedRows, setRelatedRows] = useState<LogRow[]>([]);
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState<RefreshInterval>(5);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tickKey, setTickKey] = useState(0);
  const fetchInFlight = useRef(false);

  const fetch = useCallback(async (silent = false) => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    if (!silent) setLoading(true);
    let q = supabase
      .from("api_usage_logs")
      .select("id, service, created_at, cost_estimate, tokens_or_chars, duration_ms, user_id, metadata")
      .in("service", ["elevenlabs-tts", "generate-chapter-image"])
      .order("created_at", { ascending: false })
      .limit(100);
    const { data, error } = await q;
    if (error) {
      if (!silent) toast.error("Failed to load logs: " + error.message);
    } else {
      setRows((data || []) as LogRow[]);
      setLastRefreshed(new Date());
    }
    if (!silent) setLoading(false);
    fetchInFlight.current = false;
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Auto-refresh ticker — re-renders trigger silent fetch via tickKey effect.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => setTickKey((k) => k + 1), intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, intervalSec]);

  useEffect(() => {
    if (autoRefresh && tickKey > 0) fetch(true);
  }, [tickKey, autoRefresh, fetch]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (serviceFilter !== "all" && r.service !== serviceFilter) return false;
      const provider = (r.metadata?.provider as string) || "";
      const mode = (r.metadata?.mode as string) || "";
      const autoEco = !!r.metadata?.auto_eco;
      const tier = classify(provider);
      if (filter === "eco" && tier !== "eco") return false;
      if (filter === "premium" && tier !== "premium") return false;
      if (onlyMismatches && !detectMismatch(provider, mode, autoEco)) return false;
      if (cidQuery.trim()) {
        const cid = (r.metadata?.correlation_id as string) || "";
        if (!cid.toLowerCase().includes(cidQuery.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filter, serviceFilter, cidQuery, onlyMismatches]);

  const counts = useMemo(() => {
    let eco = 0, premium = 0, unknown = 0, mismatch = 0;
    for (const r of rows) {
      const provider = (r.metadata?.provider as string) || "";
      const mode = (r.metadata?.mode as string) || "";
      const autoEco = !!r.metadata?.auto_eco;
      const c = classify(provider);
      if (c === "eco") eco++;
      else if (c === "premium") premium++;
      else unknown++;
      if (detectMismatch(provider, mode, autoEco)) mismatch++;
    }
    return { eco, premium, unknown, mismatch, total: rows.length };
  }, [rows]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    });
  };

  const loadLastChapter = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in required to load your last chapter");
      return;
    }
    const { data, error } = await supabase
      .from("api_usage_logs")
      .select("metadata, created_at")
      .eq("user_id", user.id)
      .in("service", ["elevenlabs-tts", "generate-chapter-image"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error("Failed to load last chapter: " + error.message);
      return;
    }
    const latestCid = (data || [])
      .map((r) => (r.metadata as Record<string, unknown> | null)?.correlation_id as string | undefined)
      .find((c) => typeof c === "string" && c.length > 0);
    if (!latestCid) {
      toast.error("No correlation_id found in your recent calls");
      return;
    }
    setCidQuery(latestCid);
    setFilter("all");
    setServiceFilter("all");
    toast.success(`Filtered to correlation ${latestCid.slice(0, 8)}…`);
    fetch(true);
  }, [fetch]);

  const exportCsv = useCallback(() => {
    if (filtered.length === 0) {
      toast.error("Nothing to export — adjust filters first");
      return;
    }
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "created_at", "service", "provider", "mode", "tier", "auto_eco",
      "mismatch", "cost_estimate", "tokens_or_chars", "duration_ms",
      "correlation_id", "user_id", "id", "metadata_json",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const md = (r.metadata || {}) as Record<string, unknown>;
      const provider = (md.provider as string) || "";
      const mode = (md.mode as string) || "";
      const autoEco = !!md.auto_eco;
      const tier = classify(provider);
      const mismatch = detectMismatch(provider, mode, autoEco) || "";
      lines.push([
        r.created_at, r.service, provider, mode, tier, autoEco,
        mismatch, r.cost_estimate ?? "", r.tokens_or_chars ?? "", r.duration_ms ?? "",
        (md.correlation_id as string) || "", r.user_id || "", r.id, JSON.stringify(md),
      ].map(escape).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `provider-routing-audit-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? "" : "s"}`);
  }, [filtered]);

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Provider Routing Audit</h2>
          <Badge variant="outline" className="text-[10px]">last 100 calls</Badge>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-2 py-1">
            <Zap className={`w-3 h-3 ${autoRefresh ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-[11px] text-muted-foreground">Auto</span>
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75" />
            {autoRefresh && (
              <div className="flex items-center gap-0.5 ml-1">
                {AUTO_REFRESH_INTERVALS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIntervalSec(s)}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      intervalSec === s
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            )}
            {lastRefreshed && (
              <span className="text-[10px] text-muted-foreground font-mono ml-1">
                {lastRefreshed.toLocaleTimeString().slice(0, 8)}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={loadLastChapter} disabled={loading}>
            <History className="w-3.5 h-3.5" /> Load last chapter
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCsv} disabled={loading || filtered.length === 0}>
            <Download className="w-3.5 h-3.5" /> Export CSV ({filtered.length})
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => fetch(false)} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Summary */}
        <div className="grid grid-cols-5 gap-2 text-center">
          <div className="rounded-lg bg-muted/30 p-2">
            <p className="text-lg font-bold">{counts.total}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
          </div>
          <div className="rounded-lg bg-accent/10 border border-accent/30 p-2">
            <p className="text-lg font-bold text-accent">{counts.eco}</p>
            <p className="text-[10px] text-accent uppercase tracking-wide">Eco</p>
          </div>
          <div className="rounded-lg bg-primary/10 border border-primary/30 p-2">
            <p className="text-lg font-bold text-primary">{counts.premium}</p>
            <p className="text-[10px] text-primary uppercase tracking-wide">Premium</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-2">
            <p className="text-lg font-bold text-muted-foreground">{counts.unknown}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Unknown</p>
          </div>
          <button
            type="button"
            onClick={() => setOnlyMismatches((v) => !v)}
            className={`rounded-lg p-2 border transition-colors text-left ${
              onlyMismatches
                ? "bg-destructive/20 border-destructive/60"
                : counts.mismatch > 0
                  ? "bg-destructive/10 border-destructive/40 hover:bg-destructive/15"
                  : "bg-muted/30 border-transparent hover:bg-muted/50"
            }`}
            title={onlyMismatches ? "Click to show all rows" : "Click to filter to mismatches only"}
          >
            <p className={`text-lg font-bold flex items-center justify-center gap-1 ${counts.mismatch > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {counts.mismatch > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
              {counts.mismatch}
            </p>
            <p className={`text-[10px] uppercase tracking-wide ${counts.mismatch > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              Mismatch{onlyMismatches ? " ✓" : ""}
            </p>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground mr-1">Tier:</span>
            {(["all", "eco", "premium"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                className="h-7 px-2 text-[11px] capitalize gap-1"
                onClick={() => setFilter(f)}
              >
                {f === "eco" && <Leaf className="w-3 h-3" />}
                {f === "premium" && <Sparkles className="w-3 h-3" />}
                {f}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Service:</span>
            {(["all", "elevenlabs-tts", "generate-chapter-image"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={serviceFilter === s ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setServiceFilter(s)}
              >
                {s === "all" ? "all" : s === "elevenlabs-tts" ? "tts" : "image"}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Filter by correlation_id…"
            value={cidQuery}
            onChange={(e) => setCidQuery(e.target.value)}
            className="h-7 text-[11px] flex-1 min-w-[180px] font-mono"
          />
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">No matching log rows</p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5">Time</th>
                  <th className="text-left px-2 py-1.5">Service</th>
                  <th className="text-left px-2 py-1.5">Provider</th>
                  <th className="text-left px-2 py-1.5">Mode</th>
                  <th className="text-left px-2 py-1.5">Tier</th>
                  <th className="text-right px-2 py-1.5">Cost</th>
                  <th className="text-left px-2 py-1.5">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const md = r.metadata || {};
                  const provider = (md.provider as string) || "—";
                  const mode = (md.mode as string) || "—";
                  const cid = (md.correlation_id as string) || "";
                  const autoEco = !!md.auto_eco;
                  const tier = classify(provider);
                  const mismatch = detectMismatch(provider, mode, autoEco);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setSelectedRow(r);
                        const sameCid = cid ? rows.filter((x) => (x.metadata?.correlation_id as string) === cid && x.id !== r.id) : [];
                        setRelatedRows(sameCid);
                      }}
                      className={`border-t border-border/40 cursor-pointer ${mismatch ? "bg-destructive/10 hover:bg-destructive/15 border-l-2 border-l-destructive" : "hover:bg-muted/30"}`}
                      title={mismatch || "Click for full metadata"}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                        {mismatch && <AlertTriangle className="w-3 h-3 text-destructive inline mr-1" />}
                        {new Date(r.created_at).toLocaleTimeString()}
                      </td>
                      <td className="px-2 py-1.5">{r.service === "elevenlabs-tts" ? "tts" : "image"}</td>
                      <td className="px-2 py-1.5 font-mono">{provider}</td>
                      <td className={`px-2 py-1.5 font-mono ${mismatch ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{mode}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                          tier === "eco" ? "bg-accent/15 text-accent" :
                          tier === "premium" ? "bg-primary/15 text-primary" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {tier === "eco" && <Leaf className="w-2 h-2" />}
                          {tier === "premium" && <Sparkles className="w-2 h-2" />}
                          {tier}
                          {autoEco && <span className="ml-0.5 opacity-70">·auto</span>}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.cost_estimate != null ? `$${Number(r.cost_estimate).toFixed(4)}` : "—"}
                      </td>
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        {cid ? (
                          <button
                            type="button"
                            onClick={() => copy(cid)}
                            className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
                            title={cid}
                          >
                            {cid.slice(0, 8)}
                            {copied === cid ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!selectedRow} onOpenChange={(o) => { if (!o) { setSelectedRow(null); setRelatedRows([]); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRow && (() => {
            const md = (selectedRow.metadata || {}) as Record<string, unknown>;
            const provider = (md.provider as string) || "—";
            const mode = (md.mode as string) || "—";
            const cid = (md.correlation_id as string) || "";
            const autoEco = !!md.auto_eco;
            const tier = classify(provider);
            const mismatch = detectMismatch(provider, mode, autoEco);
            const knownKeys = new Set(["provider", "mode", "correlation_id", "auto_eco"]);
            const routingKeys = ["fallback_used", "fallback_reason", "primary_provider", "attempted_providers", "route_decision", "tier", "model"];
            const otherEntries = Object.entries(md).filter(([k]) => !knownKeys.has(k));
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Log entry · {selectedRow.service === "elevenlabs-tts" ? "TTS" : "Image"}
                    {mismatch && (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <AlertTriangle className="w-3 h-3" /> Mismatch
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription className="font-mono text-[11px]">
                    {new Date(selectedRow.created_at).toLocaleString()} · id {selectedRow.id.slice(0, 8)}
                  </DialogDescription>
                </DialogHeader>

                {mismatch && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <strong>Routing mismatch:</strong> {mismatch}
                  </div>
                )}

                {/* Key routing fields */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border p-2 bg-muted/20">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Provider</p>
                    <p className="font-mono font-semibold">{provider}</p>
                  </div>
                  <div className="rounded border p-2 bg-muted/20">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Mode</p>
                    <p className="font-mono font-semibold">{mode}</p>
                  </div>
                  <div className="rounded border p-2 bg-muted/20">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tier (derived)</p>
                    <p className={`font-mono font-semibold uppercase ${tier === "eco" ? "text-accent" : tier === "premium" ? "text-primary" : "text-muted-foreground"}`}>
                      {tier} {autoEco && <span className="opacity-60">· auto</span>}
                    </p>
                  </div>
                  <div className="rounded border p-2 bg-muted/20">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost · Tokens · Duration</p>
                    <p className="font-mono">
                      {selectedRow.cost_estimate != null ? `$${Number(selectedRow.cost_estimate).toFixed(4)}` : "—"}
                      {" · "}{selectedRow.tokens_or_chars ?? "—"}
                      {" · "}{selectedRow.duration_ms != null ? `${selectedRow.duration_ms}ms` : "—"}
                    </p>
                  </div>
                </div>

                {cid && (
                  <div className="rounded border p-2 bg-muted/20 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Correlation ID</p>
                        <p className="font-mono truncate">{cid}</p>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1 text-[10px] h-7" onClick={() => copy(cid)}>
                        {copied === cid ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
                      </Button>
                    </div>
                  </div>
                )}

                {/* Routing-specific fields if present */}
                {routingKeys.some((k) => k in md) && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Routing fields</p>
                    <div className="rounded border bg-muted/10 divide-y">
                      {routingKeys.filter((k) => k in md).map((k) => (
                        <div key={k} className="flex items-start gap-3 px-2 py-1.5 text-[11px]">
                          <span className="font-mono text-muted-foreground w-32 shrink-0">{k}</span>
                          <span className="font-mono break-all">{JSON.stringify(md[k])}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full metadata JSON */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Full metadata ({otherEntries.length + knownKeys.size} keys)</p>
                  <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-x-auto max-h-64">
{JSON.stringify(md, null, 2)}
                  </pre>
                </div>

                {/* Related rows with same correlation_id */}
                {cid && relatedRows.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Other calls in this chapter ({relatedRows.length})
                    </p>
                    <div className="rounded border divide-y">
                      {relatedRows.map((rel) => {
                        const rmd = rel.metadata || {};
                        const rp = (rmd.provider as string) || "—";
                        const rt = classify(rp);
                        return (
                          <button
                            key={rel.id}
                            type="button"
                            onClick={() => setSelectedRow(rel)}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] hover:bg-muted/40 text-left"
                          >
                            <span className="font-mono text-muted-foreground">
                              {new Date(rel.created_at).toLocaleTimeString()}
                            </span>
                            <span>{rel.service === "elevenlabs-tts" ? "tts" : "image"}</span>
                            <span className="font-mono flex-1 truncate">{rp}</span>
                            <span className={`text-[9px] uppercase font-semibold ${rt === "eco" ? "text-accent" : rt === "premium" ? "text-primary" : "text-muted-foreground"}`}>
                              {rt}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
