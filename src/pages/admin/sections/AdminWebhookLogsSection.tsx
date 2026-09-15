import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, Webhook, Trash2, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";

type LogRow = {
  id: string;
  provider: "paystack" | "payfast";
  event_type: string | null;
  reference: string | null;
  user_id: string | null;
  outcome: string;
  http_status: number;
  signature_valid: boolean | null;
  amount_kobo: number | null;
  currency: string | null;
  source_ip: string | null;
  payload: unknown;
  response_body: string | null;
  error_message: string | null;
  created_at: string;
};

const SUCCESS_OUTCOMES = new Set(["credits_granted", "lifetime_unlocked", "hub_forwarded", "duplicate", "event_ignored"]);
const HARD_FAIL = new Set(["invalid_signature", "hmac_compute_failed", "purchase_write_failed", "bundle_grant_failed", "credit_grant_partial", "proxy_failed", "hub_error"]);

function outcomeStyle(outcome: string): string {
  if (SUCCESS_OUTCOMES.has(outcome)) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (HARD_FAIL.has(outcome))        return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

function providerStyle(p: LogRow["provider"]): string {
  return p === "paystack"
    ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
    : "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30";
}

function formatZar(kobo: number | null): string {
  if (kobo == null) return "—";
  return `R${(kobo / 100).toFixed(2)}`;
}

export function AdminWebhookLogsSection() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"all" | "paystack" | "payfast">("all");
  const [outcome, setOutcome] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("webhook_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (provider !== "all") q = q.eq("provider", provider);
    const { data, error } = await q;
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as LogRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);

  const outcomes = useMemo(() => Array.from(new Set(rows.map((r) => r.outcome))).sort(), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (outcome !== "all" && r.outcome !== outcome) return false;
      if (!term) return true;
      return (r.reference ?? "").toLowerCase().includes(term)
          || (r.error_message ?? "").toLowerCase().includes(term)
          || (r.user_id ?? "").toLowerCase().includes(term);
    });
  }, [rows, outcome, search]);

  async function clearAll() {
    setClearing(true);
    const { error } = await supabase
      .from("webhook_logs")
      .delete()
      .not("id", "is", null);
    setClearing(false);
    setConfirmClear(false);
    if (error) {
      toast({ title: "Failed to clear logs", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Webhook logs cleared" });
      load();
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Webhook className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Payment webhook logs</h3>
          <Badge variant="outline">{filtered.length}/{rows.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-rose-400 border-rose-500/40 hover:bg-rose-500/10"
            onClick={() => setConfirmClear(true)}
            disabled={loading || rows.length === 0}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete All
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={provider} onValueChange={(v) => setProvider(v as any)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="paystack">Paystack</SelectItem>
            <SelectItem value="payfast">Payfast</SelectItem>
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {outcomes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search reference, user, or error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {error && (
        <div className="text-sm text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-md p-3">
          {error}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="text-sm text-muted-foreground">No webhook callbacks recorded.</div>
      )}

      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {filtered.map((row) => {
          const at = new Date(row.created_at);
          const isOpen = expanded === row.id;
          const SigIcon = row.signature_valid === true
            ? ShieldCheck
            : row.signature_valid === false
            ? ShieldOff
            : ShieldAlert;
          const sigColor = row.signature_valid === true
            ? "text-emerald-400"
            : row.signature_valid === false
            ? "text-rose-400"
            : "text-muted-foreground";
          return (
            <div key={row.id} className="border border-border/60 rounded-md p-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <Badge className={`${providerStyle(row.provider)} border shrink-0`}>{row.provider}</Badge>
                <Badge className={`${outcomeStyle(row.outcome)} border shrink-0`}>{row.outcome}</Badge>
                <Badge variant="outline" className="shrink-0">HTTP {row.http_status}</Badge>
                <SigIcon className={`w-4 h-4 mt-1 shrink-0 ${sigColor}`} aria-label="signature status" />
                <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[280px]">
                  {row.reference ?? "(no reference)"}
                </code>
                <span className="text-xs text-muted-foreground ml-auto" title={at.toISOString()}>
                  {formatDistanceToNow(at, { addSuffix: true })}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                {row.event_type && <span>event: <span className="text-foreground/80">{row.event_type}</span></span>}
                <span>amount: <span className="text-foreground/80">{formatZar(row.amount_kobo)} {row.currency?.toUpperCase() ?? ""}</span></span>
                {row.user_id && <span>user: <code className="text-foreground/80">{row.user_id.slice(0, 8)}…</code></span>}
                {row.source_ip && <span>ip: <span className="text-foreground/80">{row.source_ip}</span></span>}
              </div>
              {row.error_message && (
                <div className="mt-2 text-xs text-rose-400 break-all">{row.error_message}</div>
              )}
              <button
                className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => setExpanded(isOpen ? null : row.id)}
              >
                {isOpen ? "Hide payload" : "Show payload"}
              </button>
              {isOpen && (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Payload</div>
                    <pre className="text-xs bg-muted/30 border border-border/40 rounded p-2 overflow-x-auto max-h-64">
{JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </div>
                  {row.response_body && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Response body</div>
                      <pre className="text-xs bg-muted/30 border border-border/40 rounded p-2 overflow-x-auto max-h-40">
{row.response_body}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all webhook logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes all {rows.length} recorded Paystack and Payfast callbacks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={clearAll}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
