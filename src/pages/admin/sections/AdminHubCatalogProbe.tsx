import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  PlugZap,
  History,
  RefreshCw,
  Filter,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HUB_URL, APP_KEY } from "@/lib/hub";
import { LOCAL_PLAN_PRICES, type PlanKey } from "@/lib/hub-pricing-check";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Row = {
  plan: PlanKey;
  local: number;
  hub: number | null;
  currency: string;
  hubCurrency: string | null;
  match: boolean;
};

type DiffPayload = {
  rows: Row[];
  missingOnHub: PlanKey[];
  extraOnHub: string[];
};

type ProbeResult = {
  ok: boolean;
  allMatch: boolean;
  status: number | null;
  ms: number;
  error?: string;
  raw?: unknown;
  diff?: DiffPayload;
};

type HistoryRow = {
  id: string;
  ran_at: string;
  ok: boolean;
  all_match: boolean;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
  raw: any;
  diff: any;
};

const CATALOG_URL = `${HUB_URL}/api/billing/catalog?app=${APP_KEY}`;
const PLAN_KEYS = Object.keys(LOCAL_PLAN_PRICES) as PlanKey[];

type StatusFilter = "all" | "ok" | "error";
type MismatchFilter =
  | "all"
  | "all_match"
  | "has_mismatches"
  | "missing_on_hub"
  | "extra_on_hub"
  | "has_drift";

function computeDiff(json: any): { diff: DiffPayload; allMatch: boolean } {
  const hubMap = new Map<string, { amount: number; currency: string }>();
  for (const p of json?.plans ?? []) {
    if (p?.plan && p?.period)
      hubMap.set(`${p.plan}_${p.period}`, {
        amount: Number(p.amount),
        currency: String(p.currency),
      });
  }
  const rows: Row[] = PLAN_KEYS.map((key) => {
    const local = LOCAL_PLAN_PRICES[key];
    const hub = hubMap.get(key);
    return {
      plan: key,
      local: local.amount,
      hub: hub ? hub.amount : null,
      currency: local.currency,
      hubCurrency: hub ? hub.currency : null,
      match: !!hub && hub.amount === local.amount && hub.currency === local.currency,
    };
  });
  const localKeys = new Set<string>(PLAN_KEYS);
  const extraOnHub = [...hubMap.keys()].filter((k) => !localKeys.has(k));
  const missingOnHub = rows.filter((r) => r.hub === null).map((r) => r.plan);
  const allMatch = rows.every((r) => r.match) && missingOnHub.length === 0;
  return { diff: { rows, missingOnHub, extraOnHub }, allMatch };
}

function hasPlanIssue(row: HistoryRow, plan: PlanKey): boolean {
  const diffRows: Row[] | undefined = row.diff?.rows;
  if (!diffRows) return false;
  const found = diffRows.find((r) => r.plan === plan);
  if (!found) return false;
  return !found.match;
}

function matchesMismatchFilter(row: HistoryRow, filter: MismatchFilter): boolean {
  if (filter === "all") return true;
  if (filter === "all_match") return row.ok && row.all_match;
  if (filter === "has_mismatches") return row.ok && !row.all_match;
  if (filter === "missing_on_hub") {
    const missing: string[] | undefined = row.diff?.missingOnHub;
    return !!missing && missing.length > 0;
  }
  if (filter === "extra_on_hub") {
    const extra: string[] | undefined = row.diff?.extraOnHub;
    return !!extra && extra.length > 0;
  }
  return true; // "has_drift" handled separately
}

function computeDriftFlags(rows: HistoryRow[]): boolean[] {
  return rows.map((row, i) => {
    const prev = rows[i + 1];
    return prev !== undefined && prev.all_match !== row.all_match;
  });
}

export function AdminHubCatalogProbe() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanKey | "all">("all");
  const [mismatchFilter, setMismatchFilter] = useState<MismatchFilter>("all");
  const [showFilters, setShowFilters] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    let query = supabase
      .from("hub_catalog_probe_runs")
      .select("id, ran_at, ok, all_match, http_status, latency_ms, error, raw, diff")
      .order("ran_at", { ascending: false })
      .limit(200);

    if (dateFrom) {
      query = query.gte("ran_at", `${dateFrom}T00:00:00Z`);
    }
    if (dateTo) {
      query = query.lte("ran_at", `${dateTo}T23:59:59Z`);
    }
    if (statusFilter !== "all") {
      query = query.eq("ok", statusFilter === "ok");
    }

    const { data, error } = await query;
    if (error) {
      toast.error(`Failed to load probe history: ${error.message}`);
    } else {
      setHistory((data ?? []) as HistoryRow[]);
    }
    setHistoryLoading(false);
  }, [dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const persistRun = async (r: ProbeResult) => {
    const { data: auth } = await supabase.auth.getUser();
    const ran_by = auth?.user?.id ?? null;
    const { error } = await supabase.from("hub_catalog_probe_runs").insert({
      ran_by,
      ok: r.ok,
      all_match: r.allMatch,
      http_status: r.status,
      latency_ms: r.ms,
      error: r.error ?? null,
      raw: (r.raw ?? {}) as any,
      diff: (r.diff ?? {}) as any,
    });
    if (error) toast.error(`Could not save run: ${error.message}`);
    else void loadHistory();
  };

  const run = async () => {
    setBusy(true);
    setResult(null);
    setSelectedId(null);
    const started = performance.now();
    let outcome: ProbeResult;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(CATALOG_URL, { signal: ctrl.signal, credentials: "omit" });
      clearTimeout(t);
      const ms = Math.round(performance.now() - started);
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not json */
      }

      if (!res.ok) {
        outcome = {
          ok: false,
          allMatch: false,
          status: res.status,
          ms,
          error: `HTTP ${res.status} — ${text.slice(0, 200)}`,
          raw: json ?? text,
        };
      } else if (!json || !Array.isArray(json.plans)) {
        outcome = {
          ok: false,
          allMatch: false,
          status: res.status,
          ms,
          error: "Response is not the expected { app, plans:[] } shape.",
          raw: json ?? text,
        };
      } else {
        const { diff, allMatch } = computeDiff(json);
        outcome = { ok: true, allMatch, status: res.status, ms, raw: json, diff };
      }
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      const msg =
        e?.name === "AbortError"
          ? "Timed out after 8s"
          : e?.message ?? "Network/CORS error";
      outcome = { ok: false, allMatch: false, status: null, ms, error: msg };
    }
    setResult(outcome);
    setBusy(false);
    await persistRun(outcome);
  };

  const loadFromHistory = (row: HistoryRow) => {
    setSelectedId(row.id);
    setResult({
      ok: row.ok,
      allMatch: row.all_match,
      status: row.http_status,
      ms: row.latency_ms ?? 0,
      error: row.error ?? undefined,
      raw: row.raw,
      diff: row.diff && row.diff.rows ? (row.diff as DiffPayload) : undefined,
    });
  };

  const filteredHistory = useMemo(() => {
    let rows = history;

    if (planFilter !== "all") {
      rows = rows.filter((r) => hasPlanIssue(r, planFilter));
    }

    if (mismatchFilter !== "all" && mismatchFilter !== "has_drift") {
      rows = rows.filter((r) => matchesMismatchFilter(r, mismatchFilter));
    }

    const driftFlags = computeDriftFlags(rows);
    if (mismatchFilter === "has_drift") {
      rows = rows.filter((_, i) => driftFlags[i]);
    }

    return rows.map((row, i) => ({ row, drift: driftFlags[i] }));
  }, [history, planFilter, mismatchFilter]);

  const previous = history.find((h) => h.id !== (selectedId ?? history[0]?.id));
  const current = selectedId ? history.find((h) => h.id === selectedId) : history[0];
  const driftFromPrev = previous && current && previous.all_match !== current.all_match;

  const activeFilterCount = [
    dateFrom,
    dateTo,
    statusFilter !== "all",
    planFilter !== "all",
    mismatchFilter !== "all",
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setPlanFilter("all");
    setMismatchFilter("all");
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-semibold flex items-center gap-2">
            <PlugZap className="w-5 h-5 text-primary" aria-hidden="true" />
            Hub Catalog Probe
          </h2>
          <p className="text-xs text-muted-foreground mt-1 font-mono break-all">GET {CATALOG_URL}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadHistory} disabled={historyLoading} size="sm" variant="outline">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${historyLoading ? "animate-spin" : ""}`} />
            Refresh history
          </Button>
          <Button onClick={run} disabled={busy} size="sm" className="bg-gradient-brand text-white">
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Probing…
              </>
            ) : (
              "Test Hub catalog"
            )}
          </Button>
        </div>
      </div>

      {driftFromPrev && (
        <div className="mb-3 text-xs rounded-lg px-3 py-2 border bg-amber-500/10 border-amber-500/30 text-amber-200 inline-flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          Drift since previous run: was {previous!.all_match ? "all matching" : "mismatched"}, now{" "}
          {current!.all_match ? "all matching" : "mismatched"}.
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
              result.ok
                ? result.allMatch
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-200"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {result.ok ? (
              result.allMatch ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span className="font-medium">
              {result.ok
                ? result.allMatch
                  ? "Catalog reachable — all prices match local UI."
                  : "Catalog reachable — mismatches detected."
                : `Catalog unreachable: ${result.error}`}
            </span>
            <span className="ml-auto text-xs opacity-80 font-mono">
              {result.status ?? "ERR"} · {result.ms}ms
              {selectedId && <span className="ml-2 opacity-70">(viewing saved run)</span>}
            </span>
          </div>

          {result.ok && result.diff && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b border-white/10">
                    <th className="py-1.5 pr-3 font-medium">Plan</th>
                    <th className="py-1.5 pr-3 font-medium">Local (UI)</th>
                    <th className="py-1.5 pr-3 font-medium">Hub</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.diff.rows.map((r) => (
                    <tr key={r.plan} className="border-b border-white/5">
                      <td className="py-1.5 pr-3">{r.plan}</td>
                      <td className="py-1.5 pr-3">
                        {r.currency} {r.local}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.hub !== null ? `${r.hubCurrency} ${r.hub}` : "—"}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.hub === null ? (
                          <span className="text-amber-300">missing on Hub</span>
                        ) : r.match ? (
                          <span className="text-emerald-300 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            match
                          </span>
                        ) : (
                          <span className="text-destructive inline-flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            mismatch
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.ok && result.diff && result.diff.extraOnHub.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-amber-300">Extra on Hub (not in local UI):</span>{" "}
              <span className="font-mono">{result.diff.extraOnHub.join(", ")}</span>
            </p>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Raw response
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-background/60 border border-white/10 overflow-x-auto max-h-64">
              {typeof result.raw === "string" ? result.raw : JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {!result && !busy && (
        <p className="text-xs text-muted-foreground mb-4">
          Click <strong>Test Hub catalog</strong> to fetch <code>{CATALOG_URL}</code>, diff each price against
          the local pricing UI, and save the run.
        </p>
      )}

      <div className="mt-6 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Run history</h3>
          <span className="text-xs text-muted-foreground">({filteredHistory.length})</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 text-xs"
            onClick={() => setShowFilters((s) => !s)}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>

        {showFilters && (
          <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-3 rounded-xl border border-white/10 bg-background/40">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                From
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                To
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Status
              </label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="ok">OK</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                App plan
              </label>
              <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as PlanKey | "all")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All plans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All plans</SelectItem>
                  {PLAN_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Mismatch / drift
              </label>
              <Select
                value={mismatchFilter}
                onValueChange={(v) => setMismatchFilter(v as MismatchFilter)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="all_match">All matching</SelectItem>
                  <SelectItem value="has_mismatches">Has mismatches</SelectItem>
                  <SelectItem value="missing_on_hub">Missing on Hub</SelectItem>
                  <SelectItem value="extra_on_hub">Extra on Hub</SelectItem>
                  <SelectItem value="has_drift">Has drift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeFilterCount > 0 && (
              <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        )}

        {filteredHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {activeFilterCount > 0
              ? "No runs match the selected filters."
              : "No saved runs yet. Run a probe to start building history."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-white/10">
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">HTTP</th>
                  <th className="py-1.5 pr-3 font-medium">Latency</th>
                  <th className="py-1.5 pr-3 font-medium">Mismatches</th>
                  <th className="py-1.5 pr-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {filteredHistory.map(({ row, drift }) => {
                  const mismatchCount =
                    row.ok && row.diff?.rows
                      ? (row.diff.rows as Row[]).filter((r) => !r.match).length
                      : null;
                  const isSelected = selectedId
                    ? selectedId === row.id
                    : row.id === history[0]?.id && result?.status === row.http_status;
                  return (
                    <tr key={row.id} className={`border-b border-white/5 ${isSelected ? "bg-primary/5" : ""}`}>
                      <td className="py-1.5 pr-3">{new Date(row.ran_at).toLocaleString()}</td>
                      <td className="py-1.5 pr-3">
                        {row.ok ? (
                          row.all_match ? (
                            <span className="text-emerald-300 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              ok
                            </span>
                          ) : (
                            <span className="text-amber-300 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              drift
                            </span>
                          )
                        ) : (
                          <span className="text-destructive inline-flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            error
                          </span>
                        )}
                        {drift && <span className="ml-2 text-amber-300 text-[10px]">Δ</span>}
                      </td>
                      <td className="py-1.5 pr-3">{row.http_status ?? "—"}</td>
                      <td className="py-1.5 pr-3">{row.latency_ms ?? "—"}ms</td>
                      <td className="py-1.5 pr-3">{mismatchCount === null ? "—" : mismatchCount}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <button onClick={() => loadFromHistory(row)} className="text-primary hover:underline">
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
