import { useMemo, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle, Clock, XCircle, ShieldAlert, TrendingDown } from "lucide-react";
import { toast } from "sonner";

type UsageLog = {
  id: string;
  service: string;
  tokens_or_chars: number;
  duration_ms: number;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
};

type Alert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  timestamp: string;
};

// Thresholds
const LATENCY_SPIKE_MS = { "elevenlabs-tts": 1000000, "generate-chapter-image": 30000 };
const ERROR_RATE_THRESHOLD = 0.2; // 20% failure rate
const HOURLY_ERROR_BURST = 5; // 5+ errors in 1 hour

export function EdgeFunctionMonitor({ usageLogs }: { usageLogs: UsageLog[] }) {
  const alerts = useMemo(() => {
    if (usageLogs.length === 0) return [];
    const result: Alert[] = [];
    const now = Date.now();
    const last24h = usageLogs.filter(l => now - new Date(l.created_at).getTime() < 86400000);
    const last1h = usageLogs.filter(l => now - new Date(l.created_at).getTime() < 3600000);

    // Per-service analysis
    for (const service of ["elevenlabs-tts", "generate-chapter-image"] as const) {
      const svcLogs24h = last24h.filter(l => l.service === service);
      const svcLogs1h = last1h.filter(l => l.service === service);
      const label = service === "elevenlabs-tts" ? "TTS" : "Image Gen";

      // Error rate (last 24h)
      if (svcLogs24h.length >= 5) {
        const failures = svcLogs24h.filter(l => !(l.metadata as any)?.success).length;
        const rate = failures / svcLogs24h.length;
        if (rate >= ERROR_RATE_THRESHOLD) {
          result.push({
            id: `err-rate-${service}`,
            severity: rate >= 0.5 ? "critical" : "warning",
            title: `High ${label} failure rate`,
            detail: `${(rate * 100).toFixed(0)}% of ${svcLogs24h.length} calls failed in the last 24h (${failures} failures)`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Error burst (last hour)
      const errors1h = svcLogs1h.filter(l => !(l.metadata as any)?.success).length;
      if (errors1h >= HOURLY_ERROR_BURST) {
        result.push({
          id: `err-burst-${service}`,
          severity: "critical",
          title: `${label} error burst`,
          detail: `${errors1h} failures in the last hour — possible service outage`,
          timestamp: new Date().toISOString(),
        });
      }

      // Latency spikes (last 24h)
      const threshold = LATENCY_SPIKE_MS[service];
      const slowCalls = svcLogs24h.filter(l => l.duration_ms > threshold && (l.metadata as any)?.success);
      if (slowCalls.length >= 3) {
        const avgSlow = Math.round(slowCalls.reduce((s, l) => s + l.duration_ms, 0) / slowCalls.length / 1000);
        result.push({
          id: `latency-${service}`,
          severity: "warning",
          title: `${label} latency spikes`,
          detail: `${slowCalls.length} calls exceeded ${threshold / 1000}s threshold (avg ${avgSlow}s) in the last 24h`,
          timestamp: new Date().toISOString(),
        });
      }

      // P95 latency check
      const successLogs = svcLogs24h.filter(l => (l.metadata as any)?.success && l.duration_ms > 0);
      if (successLogs.length >= 10) {
        const sorted = successLogs.map(l => l.duration_ms).sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        if (p95 > threshold * 0.8) {
          result.push({
            id: `p95-${service}`,
            severity: "info",
            title: `${label} P95 latency elevated`,
            detail: `P50: ${(p50 / 1000).toFixed(1)}s · P95: ${(p95 / 1000).toFixed(1)}s across ${successLogs.length} calls`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // ── A/V sync drift exceed-rate (video exports) ──
    // Drift logs use service="video-export-av-drift" with metadata.exceededThreshold:boolean.
    const driftLogs24h = last24h.filter(l => l.service === "video-export-av-drift");
    if (driftLogs24h.length >= 5) {
      const exceeded = driftLogs24h.filter(l => (l.metadata as any)?.exceededThreshold === true).length;
      const rate = exceeded / driftLogs24h.length;
      if (rate >= ERROR_RATE_THRESHOLD) {
        const exceededLogs = driftLogs24h.filter(l => (l.metadata as any)?.exceededThreshold === true);
        const avgAbs = exceededLogs.length
          ? exceededLogs.reduce((s, l) => {
              const m = l.metadata as any;
              return s + Math.abs(Number(m?.absDriftSecs ?? m?.driftSecs ?? 0));
            }, 0) / exceededLogs.length
          : 0;
        result.push({
          id: "av-drift-rate",
          severity: rate >= 0.5 ? "critical" : "warning",
          title: "High video A/V sync drift rate",
          detail: `${(rate * 100).toFixed(0)}% of ${driftLogs24h.length} video exports drifted >0.5s in the last 24h${avgAbs ? ` (avg ±${avgAbs.toFixed(2)}s)` : ""}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Rate limit hits
    const rateLimited = last24h.filter(l => {
      const meta = l.metadata as any;
      return meta?.error === 429 || meta?.code === "rate_limit";
    });
    if (rateLimited.length > 0) {
      result.push({
        id: "rate-limit",
        severity: "warning",
        title: "Rate limit hits detected",
        detail: `${rateLimited.length} rate-limited requests in the last 24h`,
        timestamp: new Date().toISOString(),
      });
    }

    return result.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  }, [usageLogs]);

  // Fire toast notifications for new critical/warning alerts
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const alert of alerts) {
      if (alert.severity === "info") continue;
      if (notifiedRef.current.has(alert.id)) continue;
      notifiedRef.current.add(alert.id);
      if (alert.severity === "critical") {
        toast.error(alert.title, { description: alert.detail, duration: 10000 });
      } else {
        toast.warning(alert.title, { description: alert.detail, duration: 8000 });
      }
    }
  }, [alerts]);

  const serviceHealth = useMemo(() => {
    const now = Date.now();
    const last1h = usageLogs.filter(l => now - new Date(l.created_at).getTime() < 3600000);
    return (["elevenlabs-tts", "generate-chapter-image"] as const).map(service => {
      const logs = last1h.filter(l => l.service === service);
      const label = service === "elevenlabs-tts" ? "TTS Narration" : "Image Generation";
      if (logs.length === 0) return { service: label, status: "idle" as const, detail: "No calls in last hour" };
      const failures = logs.filter(l => !(l.metadata as any)?.success).length;
      const rate = failures / logs.length;
      const avgMs = Math.round(logs.filter(l => l.duration_ms > 0).reduce((s, l) => s + l.duration_ms, 0) / Math.max(logs.filter(l => l.duration_ms > 0).length, 1));
      if (rate >= 0.5) return { service: label, status: "down" as const, detail: `${(rate * 100).toFixed(0)}% errors · ${logs.length} calls` };
      if (rate >= 0.2) return { service: label, status: "degraded" as const, detail: `${(rate * 100).toFixed(0)}% errors · avg ${(avgMs / 1000).toFixed(1)}s` };
      return { service: label, status: "healthy" as const, detail: `${logs.length} calls · avg ${(avgMs / 1000).toFixed(1)}s` };
    });
  }, [usageLogs]);

  const severityConfig = {
    critical: { icon: XCircle, bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-600", badge: "bg-red-500/15 text-red-600" },
    warning: { icon: AlertTriangle, bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-600", badge: "bg-yellow-500/15 text-yellow-600" },
    info: { icon: Clock, bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-600", badge: "bg-blue-500/15 text-blue-600" },
  };

  const statusConfig = {
    healthy: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-500/15", label: "Healthy" },
    degraded: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-500/15", label: "Degraded" },
    down: { icon: XCircle, color: "text-red-600", bg: "bg-red-500/15", label: "Down" },
    idle: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted", label: "Idle" },
  };

  return (
    <div className="space-y-4">
      {/* Service Health Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {serviceHealth.map(({ service, status, detail }) => {
          const cfg = statusConfig[status];
          const Icon = cfg.icon;
          return (
            <div key={service} className="flex items-center gap-3 bg-muted/20 border rounded-lg p-4">
              <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-4 h-4 ${cfg.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{service}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alerts */}
      {alerts.length === 0 ? (
        <div className="flex items-center gap-3 bg-green-500/5 border border-green-500/20 rounded-lg p-4">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-700">All systems nominal</p>
            <p className="text-xs text-muted-foreground">No errors or latency spikes detected in the last 24 hours</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => {
            const cfg = severityConfig[alert.severity];
            const Icon = cfg.icon;
            return (
              <div key={alert.id} className={`flex items-start gap-3 ${cfg.bg} border ${cfg.border} rounded-lg p-4`}>
                <Icon className={`w-4 h-4 ${cfg.text} mt-0.5 shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{alert.title}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${cfg.badge}`}>{alert.severity}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
