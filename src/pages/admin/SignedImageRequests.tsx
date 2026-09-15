// Admin page: audit log of `sign-chapter-images` requests.
//
// Reads from `storage_access_logs` (RLS already restricts SELECT to admins)
// filtered to action='sign' and bucket='chapter-images'. Surfaces the same
// metadata the edge function records: user, scope path, TTL, requested /
// succeeded counts, UI action, project id, request id, timestamp.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-admin";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import resonanceLogo from "@/assets/resonance-logo.png";

type Row = {
  id: string;
  created_at: string;
  user_id: string;
  actor_role: string;
  scope_path: string;
  file_count: number;
  metadata: Record<string, unknown> | null;
};

type Profile = { user_id: string; email: string | null; full_name: string | null };

const PAGE_SIZE = 200;

function toIsoStart(d: string) { return d ? new Date(`${d}T00:00:00`).toISOString() : null; }
function toIsoEnd(d: string)   { return d ? new Date(`${d}T23:59:59.999`).toISOString() : null; }

export default function SignedImageRequests() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useIsAdmin();

  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [scopePath, setScopePath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate("/admin/login", { replace: true });
  }, [isAdmin, roleLoading, navigate]);

  // Load profile lookup once (admin RLS allows reading all profiles).
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      const { data } = await supabase.from("profiles").select("user_id,email,full_name").limit(1000);
      setProfiles((data ?? []) as Profile[]);
    })();
  }, [isAdmin]);

  const fetchRows = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let q = supabase
        .from("storage_access_logs")
        .select("id,created_at,user_id,actor_role,scope_path,file_count,metadata")
        .eq("bucket", "chapter-images")
        .eq("action", "sign")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (userId.trim()) q = q.eq("user_id", userId.trim());
      if (scopePath.trim()) q = q.ilike("scope_path", `%${scopePath.trim()}%`);
      if (projectId.trim()) q = q.eq("metadata->>project_id", projectId.trim());
      if (requestId.trim()) q = q.eq("metadata->>request_id", requestId.trim());
      const f = toIsoStart(from); const t = toIsoEnd(to);
      if (f) q = q.gte("created_at", f);
      if (t) q = q.lte("created_at", t);

      const { data, error: err } = await q;
      if (err) throw err;
      setRows((data ?? []) as Row[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Failed to load: ${msg}`);
    } finally { setLoading(false); }
  }, [userId, scopePath, projectId, requestId, from, to]);

  useEffect(() => { if (isAdmin) void fetchRows(); /* eslint-disable-next-line */ }, [isAdmin]);

  const profileLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.user_id, p.email || p.full_name || p.user_id);
    return (uid: string) => m.get(uid) ?? uid;
  }, [profiles]);

  const reset = () => {
    setUserId(""); setScopePath(""); setProjectId(""); setRequestId("");
    setFrom(""); setTo("");
  };

  // CSV-quote a cell: stringifies objects, doubles inner quotes, wraps when
  // it contains a delimiter / quote / newline.
  const csvCell = (v: unknown): string => {
    const s = v === null || v === undefined
      ? ""
      : typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Build + download a CSV of the currently visible (filtered) rows. We use
  // the same rows shown in the table so the export matches what the admin
  // sees — including the resolved actor email from the profiles cache.
  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("Nothing to export — no rows match the current filters.");
      return;
    }
    const header = [
      "timestamp_iso", "timestamp_local",
      "user_id", "actor_email", "actor_role",
      "scope_path", "ttl_seconds", "expires_at_iso",
      "requested", "succeeded",
      "ui_action", "project_id", "request_id",
    ];
    const body = rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const ttl = typeof m.ttl === "number" ? m.ttl : Number(m.ttl);
      const requested = typeof m.requested === "number" ? m.requested : Number(m.requested) || 0;
      const ua = typeof m.ui_action === "string" ? m.ui_action : "";
      const pid = typeof m.project_id === "string" ? m.project_id : "";
      const rid = typeof m.request_id === "string" ? m.request_id : "";
      const createdMs = new Date(r.created_at).getTime();
      const expiresIso = Number.isFinite(ttl)
        ? new Date(createdMs + ttl * 1000).toISOString()
        : "";
      const email = profileLabel(r.user_id);
      return [
        new Date(r.created_at).toISOString(),
        new Date(r.created_at).toLocaleString(),
        r.user_id,
        email === r.user_id ? "" : email,
        r.actor_role,
        r.scope_path,
        Number.isFinite(ttl) ? ttl : "",
        expiresIso,
        requested,
        r.file_count,
        ua,
        pid,
        rid,
      ].map(csvCell).join(",");
    });
    const csv = [header.join(","), ...body].join("\n") + "\n";

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `signed-image-requests-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
  };

  if (roleLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-2">
            <img src={resonanceLogo} alt="Resonance ePublisher" width={36} height={36} className="w-9 h-9 object-contain" />
            <span className="font-display text-xl font-semibold gradient-text">Signed Image Requests</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back to Admin
          </Button>
        </div>
      </header>

      <div className="container px-6 py-8 space-y-6">
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">sign-chapter-images audit</h2>
              <p className="text-xs text-muted-foreground">
                Every call to the signed URL issuer for the private chapter-images bucket.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
                <X className="w-3.5 h-3.5" /> Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={loading || rows.length === 0}
                className="gap-1.5"
                title="Download the currently filtered rows as a CSV"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button size="sm" onClick={fetchRows} disabled={loading} className="gap-1.5">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
              </Button>
            </div>
          </div>

          <div className="px-6 py-4 border-b grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="sir-user" className="text-xs">User ID (exact)</Label>
              <Input id="sir-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="sir-scope" className="text-xs">Scope path contains</Label>
              <Input id="sir-scope" value={scopePath} onChange={(e) => setScopePath(e.target.value)} placeholder="uid or *" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="sir-project" className="text-xs">Project ID (exact)</Label>
              <Input id="sir-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="storybook project uuid" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="sir-req" className="text-xs">Request ID (exact)</Label>
              <Input id="sir-req" value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="correlation id" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sir-from" className="text-xs">From</Label>
              <Input id="sir-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sir-to" className="text-xs">To</Label>
              <Input id="sir-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 lg:col-span-1 flex flex-col">
              <Label className="text-xs">&nbsp;</Label>
              <Button onClick={fetchRows} disabled={loading} className="w-full gap-1.5">
                <Search className="w-3.5 h-3.5" /> Apply
              </Button>
            </div>
          </div>

          {error && <div className="px-6 py-4 text-sm text-destructive">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">No signed image requests match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">When</th>
                    <th className="text-left px-4 py-2 font-medium">User</th>
                    <th className="text-left px-4 py-2 font-medium">Role</th>
                    <th className="text-left px-4 py-2 font-medium">Scope path</th>
                    <th className="text-right px-4 py-2 font-medium">TTL</th>
                    <th className="text-right px-4 py-2 font-medium">Req</th>
                    <th className="text-right px-4 py-2 font-medium">OK</th>
                    <th className="text-left px-4 py-2 font-medium">UI action</th>
                    <th className="text-left px-4 py-2 font-medium">Project / Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = (r.metadata ?? {}) as Record<string, unknown>;
                    const ttl = typeof m.ttl === "number" ? m.ttl : Number(m.ttl);
                    const requested = typeof m.requested === "number" ? m.requested : Number(m.requested) || 0;
                    const ua = typeof m.ui_action === "string" ? m.ui_action : "";
                    const pid = typeof m.project_id === "string" ? m.project_id : "";
                    const rid = typeof m.request_id === "string" ? m.request_id : "";
                    const expires = Number.isFinite(ttl)
                      ? new Date(new Date(r.created_at).getTime() + ttl * 1000).toLocaleString()
                      : null;
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground" title={`Expires ~${expires}`}>
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 max-w-[220px] truncate" title={r.user_id}>{profileLabel(r.user_id)}</td>
                        <td className="px-4 py-2">
                          <span className={r.actor_role === "admin" ? "text-primary font-medium" : ""}>{r.actor_role}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs max-w-[280px] truncate" title={r.scope_path}>
                          {r.scope_path || <span className="text-muted-foreground italic">(root)</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {Number.isFinite(ttl) ? `${ttl}s` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{requested || "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.file_count}</td>
                        <td className="px-4 py-2 text-xs max-w-[220px] truncate" title={ua}>{ua || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2 text-xs space-y-0.5 max-w-[220px]">
                          {pid && (
                            <button type="button" className="font-mono text-[10px] text-primary hover:underline truncate block max-w-full"
                              title={`Filter by project ${pid}`} onClick={() => { setProjectId(pid); void fetchRows(); }}>
                              proj {pid.slice(0, 8)}…
                            </button>
                          )}
                          {rid && (
                            <button type="button" className="font-mono text-[10px] text-muted-foreground hover:underline truncate block max-w-full"
                              title={`Filter by request ${rid}`} onClick={() => { setRequestId(rid); void fetchRows(); }}>
                              req {rid.slice(0, 8)}…
                            </button>
                          )}
                          {!pid && !rid && <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                Showing {rows.length} most recent {rows.length === PAGE_SIZE ? `(capped at ${PAGE_SIZE})` : "entries"}.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
