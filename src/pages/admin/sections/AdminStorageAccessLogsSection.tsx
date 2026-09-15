import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAdmin } from "../AdminContext";

/**
 * Admin-only viewer for the storage_access_logs audit table.
 * RLS already restricts SELECT on this table to admins, so a plain client
 * query is safe.
 */

type AccessLogRow = {
  id: string;
  user_id: string;
  actor_role: string;
  bucket: string;
  scope_path: string;
  action: string;
  file_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const PAGE_SIZE = 100;
const ROLE_OPTIONS = ["all", "admin", "user"] as const;

function toIsoStart(d: string) {
  // <input type="date"> returns YYYY-MM-DD in local time.
  return d ? new Date(`${d}T00:00:00`).toISOString() : null;
}
function toIsoEnd(d: string) {
  return d ? new Date(`${d}T23:59:59.999`).toISOString() : null;
}

export function AdminStorageAccessLogsSection() {
  const { profiles } = useAdmin();

  const [rows, setRows] = useState<AccessLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [userId, setUserId] = useState<string>("all");
  const [bucket, setBucket] = useState<string>("chapter-images");
  const [actorRole, setActorRole] =
    useState<(typeof ROLE_OPTIONS)[number]>("all");
  const [scopePath, setScopePath] = useState<string>("");
  const [requestId, setRequestId] = useState<string>("");
  const [uiAction, setUiAction] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from("storage_access_logs")
        .select(
          "id,user_id,actor_role,bucket,scope_path,action,file_count,metadata,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (userId !== "all") q = q.eq("user_id", userId);
      if (bucket.trim()) q = q.eq("bucket", bucket.trim());
      if (actorRole !== "all") q = q.eq("actor_role", actorRole);
      if (scopePath.trim()) q = q.ilike("scope_path", `%${scopePath.trim()}%`);
      if (requestId.trim()) q = q.eq("metadata->>request_id", requestId.trim());
      if (uiAction.trim()) q = q.ilike("metadata->>ui_action", `%${uiAction.trim()}%`);
      if (projectId.trim()) q = q.eq("metadata->>project_id", projectId.trim());
      const fromIso = toIsoStart(from);
      const toIso = toIsoEnd(to);
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);

      const { data, error: err } = await q;
      if (err) throw err;
      setRows((data ?? []) as AccessLogRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Failed to load access logs: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [userId, bucket, actorRole, scopePath, requestId, uiAction, projectId, from, to]);

  useEffect(() => {
    void fetchLogs();
    // initial load only — re-runs are user-driven via Apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) {
      m.set(p.user_id, p.email || p.full_name || p.user_id);
    }
    return m;
  }, [profiles]);

  const resetFilters = () => {
    setUserId("all");
    setBucket("chapter-images");
    setActorRole("all");
    setScopePath("");
    setRequestId("");
    setUiAction("");
    setProjectId("");
    setFrom("");
    setTo("");
  };

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Storage Access Logs</h2>
          <p className="text-xs text-muted-foreground">
            Audit trail of admin and user storage listing requests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
            <X className="w-3.5 h-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={fetchLogs} disabled={loading} className="gap-1.5">
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 border-b grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="acl-user" className="text-xs">User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="acl-user"><SelectValue placeholder="All users" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All users</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.email || p.full_name || p.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acl-bucket" className="text-xs">Bucket</Label>
          <Input
            id="acl-bucket"
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            placeholder="chapter-images"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acl-role" className="text-xs">Actor role</Label>
          <Select value={actorRole} onValueChange={(v) => setActorRole(v as typeof actorRole)}>
            <SelectTrigger id="acl-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acl-from" className="text-xs">From</Label>
          <Input id="acl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acl-to" className="text-xs">To</Label>
          <Input id="acl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="space-y-1.5 lg:col-span-3">
          <Label htmlFor="acl-scope" className="text-xs">Scope path contains</Label>
          <Input
            id="acl-scope"
            value={scopePath}
            onChange={(e) => setScopePath(e.target.value)}
            placeholder="e.g. 11111111-1111-1111-1111-111111111111 or /project-id"
          />
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="acl-request" className="text-xs">Request ID (exact)</Label>
          <Input
            id="acl-request"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="correlation id from a single action"
          />
        </div>

        <div className="space-y-1.5 lg:col-span-1 flex flex-col">
          <Label className="text-xs">&nbsp;</Label>
          <Button onClick={fetchLogs} disabled={loading} className="w-full gap-1.5">
            <Search className="w-3.5 h-3.5" /> Apply
          </Button>
        </div>

        <div className="space-y-1.5 lg:col-span-3">
          <Label htmlFor="acl-ui-action" className="text-xs">UI action contains</Label>
          <Input
            id="acl-ui-action"
            value={uiAction}
            onChange={(e) => setUiAction(e.target.value)}
            placeholder="e.g. Open project gallery"
          />
        </div>

        <div className="space-y-1.5 lg:col-span-3">
          <Label htmlFor="acl-project" className="text-xs">Project ID (exact)</Label>
          <Input
            id="acl-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="storybook project uuid"
          />
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="px-6 py-4 text-sm text-destructive">{error}</div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No access log entries match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Actor</th>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-4 py-2 font-medium">Bucket</th>
                <th className="text-left px-4 py-2 font-medium">Scope path</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Trace</th>
                <th className="text-right px-4 py-2 font-medium">Files</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className={
                      r.actor_role === "admin"
                        ? "text-primary font-medium"
                        : "text-foreground"
                    }>
                      {r.actor_role}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-[220px] truncate" title={r.user_id}>
                    {profileById.get(r.user_id) ?? r.user_id}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.bucket}</td>
                  <td className="px-4 py-2 font-mono text-xs max-w-[320px] truncate" title={r.scope_path}>
                    {r.scope_path || <span className="text-muted-foreground italic">(bucket root)</span>}
                  </td>
                  <td className="px-4 py-2">{r.action}</td>
                  <td className="px-4 py-2 text-xs max-w-[260px]">
                    {(() => {
                      const m = (r.metadata ?? {}) as Record<string, unknown>;
                      const rid = typeof m.request_id === "string" ? m.request_id : null;
                      const ua = typeof m.ui_action === "string" ? m.ui_action : null;
                      const pid = typeof m.project_id === "string" ? m.project_id : null;
                      if (!rid && !ua && !pid) {
                        return <span className="text-muted-foreground italic">—</span>;
                      }
                      return (
                        <div className="space-y-0.5">
                          {ua && <div className="truncate" title={ua}>{ua}</div>}
                          {rid && (
                            <button
                              type="button"
                              className="font-mono text-[10px] text-primary hover:underline truncate block max-w-full"
                              title={`Filter by request_id ${rid}`}
                              onClick={() => { setRequestId(rid); void fetchLogs(); }}
                            >
                              req {rid.slice(0, 8)}…
                            </button>
                          )}
                          {pid && (
                            <button
                              type="button"
                              className="font-mono text-[10px] text-muted-foreground hover:underline truncate block max-w-full"
                              title={`Filter by project_id ${pid}`}
                              onClick={() => { setProjectId(pid); void fetchLogs(); }}
                            >
                              proj {pid.slice(0, 8)}…
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.file_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            Showing {rows.length} most recent {rows.length === PAGE_SIZE ? `(capped at ${PAGE_SIZE})` : "entries"}.
          </div>
        </div>
      )}
    </div>
  );
}
