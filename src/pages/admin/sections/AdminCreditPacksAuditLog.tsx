import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type AuditRow = {
  id: string;
  pack_id: string;
  action: "insert" | "update" | "delete";
  changed_fields: string[];
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
};

type ProfileMap = Record<string, { email: string | null; full_name: string | null }>;

const ACTION_STYLES: Record<AuditRow["action"], string> = {
  insert: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  update: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  delete: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function describe(row: AuditRow): string {
  if (row.action === "insert") return "Created pack";
  if (row.action === "delete") return "Deleted pack";
  if (row.changed_fields.includes("active")) {
    const nowActive = (row.new_value as any)?.active;
    return nowActive ? "Unhid pack" : "Hid pack";
  }
  if (row.changed_fields.length === 0) return "Updated pack";
  return `Updated ${row.changed_fields.join(", ")}`;
}

export function AdminCreditPacksAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("credit_packs_audit")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(100);
    if (error) {
      setError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const audit = (data ?? []) as AuditRow[];
    setRows(audit);

    const adminIds = Array.from(new Set(audit.map((r) => r.changed_by).filter(Boolean))) as string[];
    if (adminIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, email, full_name")
        .in("user_id", adminIds);
      const map: ProfileMap = {};
      (profs ?? []).forEach((p: any) => {
        map[p.user_id] = { email: p.email, full_name: p.full_name };
      });
      setProfiles(map);
    } else {
      setProfiles({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Historical credit-pack audit log</h3>
          <Badge variant="outline">Read-only · {rows.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {error && (
        <div className="text-sm text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-md p-3">
          {error}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-sm text-muted-foreground">No credit pack changes recorded yet.</div>
      )}

      <div className="space-y-2 max-h-[520px] overflow-y-auto">
        {rows.map((row) => {
          const admin = row.changed_by ? profiles[row.changed_by] : null;
          const adminLabel = admin?.full_name || admin?.email || row.changed_by || "system";
          const at = new Date(row.changed_at);
          return (
            <div
              key={row.id}
              className="border border-border/60 rounded-md p-3 flex items-start gap-3 text-sm"
            >
              <Badge className={`${ACTION_STYLES[row.action]} border shrink-0`}>{row.action}</Badge>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">{describe(row)}</span>
                  <span className="text-muted-foreground">·</span>
                  <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded">{row.pack_id}</code>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  by <span className="text-foreground/80">{adminLabel}</span> ·{" "}
                  <span title={at.toISOString()}>{formatDistanceToNow(at, { addSuffix: true })}</span>
                </div>
                {row.action === "update" && row.changed_fields.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Diff ({row.changed_fields.length} field{row.changed_fields.length === 1 ? "" : "s"})
                    </summary>
                    <div className="mt-2 space-y-1 text-xs font-mono">
                      {row.changed_fields.map((f) => (
                        <div key={f} className="grid grid-cols-[120px_1fr] gap-2">
                          <span className="text-muted-foreground">{f}</span>
                          <span>
                            <span className="text-rose-400">{JSON.stringify((row.old_value as any)?.[f])}</span>
                            {" → "}
                            <span className="text-emerald-400">{JSON.stringify((row.new_value as any)?.[f])}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
