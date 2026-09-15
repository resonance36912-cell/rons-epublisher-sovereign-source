import { useMemo } from "react";
import { Film, AlertTriangle, CheckCircle2 } from "lucide-react";

type UsageLog = {
  id: string;
  service: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
};

type Props = { usageLogs: UsageLog[] };

const DRIFT_THRESHOLD_SECS = 0.5;

export function VideoExportDriftMonitor({ usageLogs }: Props) {
  const stats = useMemo(() => {
    const driftLogs = usageLogs.filter((l) => l.service === "video-export-av-drift");
    const drifts = driftLogs
      .map((l) => Number((l.metadata as any)?.absDriftSecs))
      .filter((n) => Number.isFinite(n));

    if (drifts.length === 0) return null;

    const total = drifts.length;
    const exceeded = drifts.filter((d) => d > DRIFT_THRESHOLD_SECS).length;
    const avg = drifts.reduce((s, d) => s + d, 0) / total;
    const max = Math.max(...drifts);
    const exceedRate = exceeded / total;

    // Group by user to find chronic offenders
    const byUser = new Map<string, { total: number; exceeded: number }>();
    for (const log of driftLogs) {
      const uid = log.user_id || "unknown";
      const entry = byUser.get(uid) || { total: 0, exceeded: 0 };
      entry.total += 1;
      if ((log.metadata as any)?.exceededThreshold) entry.exceeded += 1;
      byUser.set(uid, entry);
    }
    const chronic = Array.from(byUser.entries())
      .filter(([, v]) => v.total >= 3 && v.exceeded / v.total >= 0.5)
      .map(([uid, v]) => ({ uid, ...v }));

    // Last 20 events
    const recent = [...driftLogs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    return { total, exceeded, avg, max, exceedRate, chronic, recent };
  }, [usageLogs]);

  if (!stats) {
    return (
      <p className="text-sm text-muted-foreground">
        No video exports recorded yet. A/V drift metrics will appear here once users export MP4s.
      </p>
    );
  }

  const healthOk = stats.exceedRate < 0.1;

  return (
    <div className="space-y-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Exports</div>
          <div className="text-xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg drift</div>
          <div className="text-xl font-semibold">{stats.avg.toFixed(2)}s</div>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Max drift</div>
          <div className="text-xl font-semibold">{stats.max.toFixed(2)}s</div>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 ${
            healthOk ? "bg-green-500/10 border-green-500/30" : "bg-destructive/10 border-destructive/30"
          }`}
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Over threshold</div>
          <div className="text-xl font-semibold flex items-center gap-1.5">
            {healthOk ? (
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-destructive" />
            )}
            {(stats.exceedRate * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Chronic offenders */}
      {stats.chronic.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
            <AlertTriangle className="w-4 h-4" />
            Chronic sync issues — {stats.chronic.length} user{stats.chronic.length > 1 ? "s" : ""}
          </div>
          <div className="space-y-1 text-xs">
            {stats.chronic.slice(0, 5).map((c) => (
              <div key={c.uid} className="flex justify-between font-mono">
                <span className="truncate text-muted-foreground">{c.uid.slice(0, 12)}…</span>
                <span className="text-destructive">
                  {c.exceeded}/{c.total} exports drifted
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent events */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Recent exports <span className="text-xs font-normal">(last {stats.recent.length})</span>
        </h3>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">When</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Quality</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Chapters</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Video</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Audio</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Drift</th>
                <th className="text-center px-3 py-1.5 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.recent.map((log) => {
                const m = (log.metadata as any) || {};
                const drift = Number(m.driftSecs ?? 0);
                const exceeded = Boolean(m.exceededThreshold);
                return (
                  <tr key={log.id} className="hover:bg-muted/30">
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">{m.quality || "—"}</td>
                    <td className="px-3 py-1.5">{m.totalChapters ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {Number(m.videoDurationSecs ?? 0).toFixed(2)}s
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {Number(m.audioDurationSecs ?? 0).toFixed(2)}s
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono font-medium ${
                        exceeded ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {drift >= 0 ? "+" : ""}
                      {drift.toFixed(2)}s
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          exceeded
                            ? "bg-destructive/15 text-destructive"
                            : "bg-green-500/15 text-green-600"
                        }`}
                      >
                        {exceeded ? (
                          <>
                            <AlertTriangle className="w-2.5 h-2.5" /> Fail
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-2.5 h-2.5" /> Pass
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Re-export icon for the panel header convenience
export { Film as VideoExportDriftIcon };
