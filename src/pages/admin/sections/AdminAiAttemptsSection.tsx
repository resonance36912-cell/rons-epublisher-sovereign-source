import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Trash2, RefreshCw, Download } from "lucide-react";
import {
  subscribeAiAttempts,
  clearAiAttempts,
  type AiAttemptEntry,
} from "@/lib/ai-attempt-log";

function fmtClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}
function fmtDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function statusVariant(s: AiAttemptEntry["status"]): "default" | "destructive" | "secondary" | "outline" {
  if (s === "succeeded") return "default";
  if (s === "failed") return "destructive";
  if (s === "retrying") return "secondary";
  return "outline";
}

export function AdminAiAttemptsSection() {
  const [entries, setEntries] = useState<AiAttemptEntry[]>([]);
  const [fnFilter, setFnFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => subscribeAiAttempts(setEntries), []);

  const fnOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.fn));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) =>
      (fnFilter === "all" || e.fn === fnFilter) &&
      (statusFilter === "all" || e.status === statusFilter),
    );
  }, [entries, fnFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = entries.length;
    const failed = entries.filter((e) => e.status === "failed").length;
    const retried = entries.filter((e) => e.status === "retrying").length;
    const timedOut = entries.filter((e) => e.timedOut).length;
    const avgMs = (() => {
      const done = entries.filter((e) => typeof e.durationMs === "number");
      if (!done.length) return 0;
      return Math.round(done.reduce((s, e) => s + (e.durationMs || 0), 0) / done.length);
    })();
    return { total, failed, retried, timedOut, avgMs };
  }, [entries]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-attempts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-card border rounded-xl p-5 sm:p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">AI Call Diagnostics</h2>
            <p className="text-xs text-muted-foreground">
              Per-attempt timing, retries, timeouts, and status codes for AI edge-function calls (current session).
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportJson} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearAiAttempts()} className="gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: "Attempts", value: stats.total },
          { label: "Failed", value: stats.failed },
          { label: "Retried", value: stats.retried },
          { label: "Timed out", value: stats.timedOut },
          { label: "Avg duration", value: fmtDuration(stats.avgMs) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border bg-background p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Function:</span>
          <select
            value={fnFilter}
            onChange={(e) => setFnFilter(e.target.value)}
            className="bg-background border rounded px-2 py-1"
          >
            {fnOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border rounded px-2 py-1"
          >
            <option value="all">all</option>
            <option value="started">started</option>
            <option value="succeeded">succeeded</option>
            <option value="retrying">retrying</option>
            <option value="failed">failed</option>
          </select>
        </label>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed rounded-lg p-6 text-center flex flex-col items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          No AI call attempts recorded yet. Trigger a generation to populate this panel.
        </div>
      ) : (
        <ScrollArea className="h-[420px] rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Function</th>
                <th className="px-3 py-2 font-medium">Attempt</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Timeout</th>
                <th className="px-3 py-2 font-medium">Request ID / Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={`${e.id}-${e.attempt}-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{fmtClock(e.startedAt)}</td>
                  <td className="px-3 py-2 font-mono">{e.fn}</td>
                  <td className="px-3 py-2 tabular-nums">{e.attempt}/{e.maxAttempts}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(e.status)} className="capitalize">
                      {e.status}
                    </Badge>
                    {e.timedOut && (
                      <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-600">timeout</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{e.statusCode ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDuration(e.durationMs)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtDuration(e.timeoutMs)}</td>
                  <td className="px-3 py-2 max-w-[320px]">
                    {e.requestId && (
                      <div className="font-mono text-[10px] text-muted-foreground truncate" title={e.requestId}>
                        {e.requestId}
                      </div>
                    )}
                    {e.message && (
                      <div className="text-foreground/80 truncate" title={e.message}>{e.message}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </section>
  );
}
