import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, RefreshCw, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface Finding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  remediation: string;
  created_at: string;
}

interface Scan {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  totals: Record<string, number>;
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const SEVERITY_STYLES: Record<Severity, { badge: string; icon: JSX.Element; label: string }> = {
  critical: { badge: "bg-destructive text-destructive-foreground", icon: <AlertOctagon className="w-4 h-4" />, label: "Critical" },
  high:     { badge: "bg-destructive/80 text-destructive-foreground", icon: <AlertOctagon className="w-4 h-4" />, label: "High" },
  medium:   { badge: "bg-amber-500/90 text-white", icon: <AlertTriangle className="w-4 h-4" />, label: "Medium" },
  low:      { badge: "bg-yellow-500/80 text-black", icon: <AlertTriangle className="w-4 h-4" />, label: "Low" },
  info:     { badge: "bg-muted text-muted-foreground", icon: <Info className="w-4 h-4" />, label: "Info" },
};

export function AdminSecurityScanSection() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const { data: scans } = await supabase
      .from("security_scans")
      .select("id, started_at, finished_at, status, totals")
      .order("started_at", { ascending: false })
      .limit(1);
    const latest = scans?.[0] as Scan | undefined;
    if (latest) {
      setScan(latest);
      const { data } = await supabase
        .from("security_findings")
        .select("id, severity, category, title, description, remediation, created_at")
        .eq("scan_id", latest.id);
      setFindings((data ?? []) as Finding[]);
    } else {
      setScan(null);
      setFindings([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const runScan = useCallback(async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-security-scan");
      if (error) throw error;
      toast.success("Security scan complete", {
        description: `${data?.count ?? 0} finding${data?.count === 1 ? "" : "s"} recorded.`,
      });
      await loadLatest();
    } catch (e) {
      toast.error("Scan failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }, [loadLatest]);

  const grouped = useMemo(() => {
    const map: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [], info: [] };
    for (const f of findings) map[f.severity]?.push(f);
    return map;
  }, [findings]);

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Security Scan</h2>
          {scan && (
            <span className="text-xs text-muted-foreground">
              Last run {new Date(scan.finished_at ?? scan.started_at).toLocaleString()} · {scan.status}
            </span>
          )}
        </div>
        <Button onClick={runScan} disabled={running} size="sm" className="gap-1.5">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {running ? "Scanning…" : "Re-run scan"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading findings…
        </div>
      ) : !scan ? (
        <p className="text-sm text-muted-foreground">No scans yet. Click "Re-run scan" to perform one.</p>
      ) : findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No findings recorded in the latest scan.</p>
      ) : (
        <div className="space-y-5">
          {SEVERITY_ORDER.map((sev) => {
            const items = grouped[sev];
            if (!items.length) return null;
            const style = SEVERITY_STYLES[sev];
            return (
              <div key={sev} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={`gap-1 ${style.badge}`}>
                    {style.icon}{style.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{items.length} finding{items.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="space-y-2">
                  {items.map((f) => (
                    <li key={f.id} className="rounded-md border bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm">{f.title}</div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{f.category}</span>
                      </div>
                      {f.description && (
                        <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{f.description}</p>
                      )}
                      {f.remediation && (
                        <p className="mt-2 text-xs"><span className="font-medium">Fix: </span>{f.remediation}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
