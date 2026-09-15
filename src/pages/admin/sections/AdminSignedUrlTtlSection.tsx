// Admin control for the chapter-images signed URL TTL. Reads/writes the
// `signed_url_ttl_seconds` row in `app_settings`. Since each environment
// (dev/staging/prod) has its own backend, the value here is naturally
// per-environment and changes take effect without redeploying.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Download, ExternalLink, Eye, Loader2, Lock, Search, X } from "lucide-react";
import {
  TTL_I18N_KEYS,
  useTtlMessages,
  captureTtlServerError,
  formatTtlServerErrorDescription,
  ttlFieldError,
  type TtlServerError,
} from "@/lib/ttlMessages";

type ActionFilter = "all" | "insert" | "update" | "delete";
const UUID_PREFIX_RE = /^[0-9a-f-]+$/i;

const KEY = "signed_url_ttl_seconds";
const OVERRIDE_KEY = "signed_url_ttl_user_override_allowed";
const MIN = 60;
const MAX = 3600;
const DEFAULT = 900;
const AUDIT_PAGE_SIZE = 20;

type AuditRow = {
  id: string;
  old_value: unknown;
  new_value: unknown;
  action: string;
  changed_by: string | null;
  changed_at: string;
  actor_email?: string | null;
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return `${v}s (~${Math.round(v / 60)} min)`;
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function AdminSignedUrlTtlSection() {
  const m = useTtlMessages();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seconds, setSeconds] = useState<number>(DEFAULT);
  const [overrideAllowed, setOverrideAllowed] = useState<boolean>(true);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditTotal, setAuditTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Track the most-recent audit entry id we've already shown the admin so
  // the cross-session change notifier only toasts for genuinely new rows
  // (not re-fetches of the same data). Also remember the current user's id
  // so we don't double-toast for the local save (which already toasts).
  const lastSeenAuditIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      currentUserIdRef.current = data.user?.id ?? null;
    });
  }, []);

  const [selectedEntry, setSelectedEntry] = useState<AuditRow | null>(null);

  // Deferred-refetch timer. After a successful save we immediately re-pull
  // the audit history, then schedule one more refresh ~3s later so the table
  // reflects the new entry even if the audit row is slightly behind the
  // settings write (defensive — the trigger is in-tx, but this is cheap).
  const REFRESH_DELAY_MS = 3000;
  const refreshTimerRef = useRef<number | null>(null);
  const scheduleDeferredRefresh = () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadAudit(true);
    }, REFRESH_DELAY_MS);
  };
  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  // History filters (server-side). Action = exact match. Actor query matches
  // either a user_id (UUID-ish prefix) or an email substring via profiles.
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [actorQuery, setActorQuery] = useState<string>("");
  const [debouncedActor, setDebouncedActor] = useState<string>("");
  const trimmedActor = useMemo(() => debouncedActor.trim(), [debouncedActor]);

  // Attach actor emails in-place. Admins can read all profiles.
  const attachEmails = async (rows: AuditRow[]): Promise<void> => {
    const userIds = Array.from(new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x)));
    if (userIds.length === 0) return;
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id, email")
      .in("user_id", userIds);
    const map = new Map<string, string | null>(((profs ?? []) as Array<{ user_id: string; email: string | null }>).map((p) => [p.user_id, p.email]));
    rows.forEach((r) => { r.actor_email = r.changed_by ? map.get(r.changed_by) ?? null : null; });
  };

  // Wraps a value for CSV: doubles inner quotes and quotes anything risky.
  const csvCell = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      // Pull the full history for both KEY rows (TTL value + override flag).
      const { data, error } = await supabase
        .from("app_settings_audit")
        .select("id, key, old_value, new_value, action, changed_by, changed_at")
        .in("key", [KEY, OVERRIDE_KEY])
        .order("changed_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<AuditRow & { key: string }>;

      // Resolve actor emails in one batch.
      const userIds = Array.from(new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x)));
      const emailMap = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, email")
          .in("user_id", userIds);
        for (const p of (profs ?? []) as Array<{ user_id: string; email: string | null }>) {
          emailMap.set(p.user_id, p.email);
        }
      }

      const header = ["changed_at", "key", "action", "old_value", "new_value", "changed_by", "actor_email"];
      const body = rows.map((r) => [
        new Date(r.changed_at).toISOString(),
        r.key,
        r.action,
        r.old_value,
        r.new_value,
        r.changed_by ?? "",
        r.changed_by ? (emailMap.get(r.changed_by) ?? "") : "",
      ].map(csvCell).join(","));
      const csv = [header.join(","), ...body].join("\n") + "\n";

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `signed-url-ttl-history-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: `${rows.length} row${rows.length === 1 ? "" : "s"} downloaded.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // Fetch one page of audit rows. `reset` truthy clears + starts at offset 0
  // (used on initial load + after a setting change). Otherwise appends the
  // next page after `audit.length`.
  const loadAudit = async (reset = true) => {
    const from = reset ? 0 : audit.length;
    const to = from + AUDIT_PAGE_SIZE - 1;
    if (reset) setAuditLoading(true); else setLoadingMore(true);

    // Build the actor filter. Empty = no constraint. UUID-ish = prefix match
    // on changed_by. Anything else is treated as an email substring: resolve
    // matching user_ids via profiles first; no matches => zero rows.
    let actorUserIds: string[] | null = null;
    if (trimmedActor) {
      if (UUID_PREFIX_RE.test(trimmedActor)) {
        actorUserIds = null; // handled via .ilike below
      } else {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id")
          .ilike("email", `%${trimmedActor}%`)
          .limit(500);
        actorUserIds = ((profs ?? []) as Array<{ user_id: string }>).map((p) => p.user_id);
        if (actorUserIds.length === 0) {
          setAudit(reset ? [] : (prev) => prev);
          setAuditTotal(0);
          if (reset) setAuditLoading(false); else setLoadingMore(false);
          return;
        }
      }
    }

    let q = supabase
      .from("app_settings_audit")
      .select("id, old_value, new_value, action, changed_by, changed_at", { count: "exact" })
      .eq("key", KEY);
    if (actionFilter !== "all") q = q.eq("action", actionFilter);
    if (trimmedActor) {
      if (actorUserIds) q = q.in("changed_by", actorUserIds);
      else q = q.ilike("changed_by::text", `${trimmedActor}%`);
    }
    const { data, count } = await q
      .order("changed_at", { ascending: false })
      .range(from, to);
    const rows = (data ?? []) as AuditRow[];
    await attachEmails(rows);

    setAudit((prev) => (reset ? rows : [...prev, ...rows]));
    if (typeof count === "number") setAuditTotal(count);
    if (reset) setAuditLoading(false); else setLoadingMore(false);

    // Cross-session change notifier. If the newest row in this reset fetch
    // wasn't the one we last surfaced, and it wasn't authored by the local
    // user (whose save() already toasts), let the admin know another admin
    // changed the TTL. Skip the very first load so we just baseline.
    if (reset && rows.length > 0) {
      const newest = rows[0];
      const baseline = lastSeenAuditIdRef.current;
      const isLocalActor = newest.changed_by && newest.changed_by === currentUserIdRef.current;
      if (baseline && baseline !== newest.id && !isLocalActor) {
        const who = newest.actor_email
          ?? (newest.changed_by ? `${newest.changed_by.slice(0, 8)}…` : "system");
        toast({
          title: "Signed URL TTL changed",
          description: `${who} ${newest.action}d: ${formatValue(newest.old_value)} → ${formatValue(newest.new_value)}`,
        });
      }
      lastSeenAuditIdRef.current = newest.id;
    }
  };

  // Debounce the actor search box so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedActor(actorQuery), 300);
    return () => window.clearTimeout(id);
  }, [actorQuery]);

  // Re-query (resetting pagination) whenever a filter changes.
  useEffect(() => {
    void loadAudit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, trimmedActor]);

  // Pull the current TTL + override flag. Used both on mount and by the
  // auto-refresh poller so the status tiles stay in sync with edits made
  // from another tab / by another admin.
  const loadSettings = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [KEY, OVERRIDE_KEY]);
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.key === KEY) {
        const n = typeof row.value === "number" ? row.value : Number(row.value);
        if (Number.isFinite(n) && n > 0) setSeconds(Math.floor(n));
      } else if (row.key === OVERRIDE_KEY) {
        if (typeof row.value === "boolean") setOverrideAllowed(row.value);
      }
    }
  };

  useEffect(() => {
    (async () => {
      await loadSettings();
      setLoading(false);
      // Initial audit fetch is handled by the filter-watching effect above.
    })();
  }, []);

  // Auto-refresh status tiles (TTL, last-updated time, admin email) every
  // 15s so admins see edits from other sessions without reloading. Skip
  // when the tab is hidden, while saving, or while the user is loading
  // more pages — those would clobber in-flight state.
  const AUTO_REFRESH_MS = 15000;
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      if (saving || overrideSaving || loadingMore) return;
      void loadSettings();
      void loadAudit(true);
    };
    const id = window.setInterval(tick, AUTO_REFRESH_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, overrideSaving, loadingMore, actionFilter, trimmedActor]);

  const saveOverrideAllowed = async (next: boolean) => {
    setOverrideSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: OVERRIDE_KEY, value: next, updated_at: new Date().toISOString() } as never);
    setOverrideSaving(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    setOverrideAllowed(next);
    toast({
      title: next ? "Per-user overrides enabled" : "Per-user overrides disabled",
      description: next
        ? "Users can choose their own image link expiry."
        : "Everyone is forced to the server default. Live within ~60s.",
    });
    void loadAudit();
    scheduleDeferredRefresh();
  };

  // Server-side rejection captured from the last save attempt. Rendered as
  // a persistent inline panel under the input (in addition to the toast) so
  // the admin can read the trigger's hint/details after the toast dismisses.
  const [serverError, setServerError] = useState<TtlServerError | null>(null);
  // When a server error appears we move focus to the inline panel so
  // screen-reader and keyboard users land on the full Hint/Details/SQLSTATE
  // content instead of being stranded on the (now-disabled) Save button
  // while an ephemeral toast scrolls past. Also stash the previously-focused
  // element so dismissing the panel can return focus to the TTL input.
  const serverErrorPanelRef = useRef<HTMLDivElement | null>(null);
  const preErrorFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!serverError) return;
    // Remember where focus was at the moment the error surfaced (typically
    // the Save button) so we can restore on dismiss.
    const active = document.activeElement;
    preErrorFocusRef.current = active instanceof HTMLElement ? active : null;
    // Defer one frame so the panel is in the DOM before we focus it.
    const id = window.requestAnimationFrame(() => {
      serverErrorPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [serverError]);
  const dismissServerError = () => {
    setServerError(null);
    // Return focus to the input the admin was editing (preferred) or to
    // the element they were on before the error fired.
    const ttlInput = document.getElementById("ttl-seconds") as HTMLInputElement | null;
    (ttlInput ?? preErrorFocusRef.current)?.focus();
  };

  const save = async () => {
    // Defensive pre-flight: Save is disabled while the inline error shows,
    // but we still run the same shared classifier here so the wording in
    // any edge-case toast matches the inline panel character-for-character.
    const preflight = ttlFieldError(m, seconds, { min: MIN, max: MAX });
    if (preflight) {
      // Map the rule kind to the right toast title (action-flavoured) while
      // the description reuses the exact inline message.
      const title =
        preflight.kind === "tooLow" || preflight.kind === "tooHigh"
          ? m(TTL_I18N_KEYS.toastOutT)
          : m(TTL_I18N_KEYS.toastInvalidT);
      toast({ title, description: preflight.message, variant: "destructive" });
      return;
    }
    const n = Math.floor(seconds);
    setSaving(true);
    // New attempt — drop any prior server error so the panel doesn't show
    // stale info while the request is in flight.
    setServerError(null);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: KEY, value: n, updated_at: new Date().toISOString() } as never);
    setSaving(false);
    if (error) {
      // Capture + format the server reason through the shared helper so the
      // toast description and the inline panel use identical labels
      // ("Hint:", "Details:", "SQLSTATE") — change wording in ttlMessages.ts
      // and both surfaces stay in sync.
      const captured = captureTtlServerError(m, error);
      setServerError(captured);
      toast({
        title: m(TTL_I18N_KEYS.toastFailedT),
        description: formatTtlServerErrorDescription(m, captured),
        variant: "destructive",
      });
      return;
    }
    setSeconds(n);
    setServerError(null);
    toast({
      title: m(TTL_I18N_KEYS.toastSavedT),
      description: m(TTL_I18N_KEYS.toastSavedD, { min: MIN, max: MAX, value: n }),
    });
    // The database trigger writes the audit row; pull the fresh entry in.
    void loadAudit();
    scheduleDeferredRefresh();
  };

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Signed URL TTL</h2>
        <p className="text-sm text-muted-foreground">
          How long signed URLs for chapter images remain valid in this environment.
          Range {MIN}–{MAX} seconds. Edge function refreshes within ~60s.
        </p>
      </div>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current TTL</div>
              <div className="font-mono font-medium">{seconds}s <span className="text-muted-foreground">(~{Math.round(seconds / 60)} min)</span></div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last updated</div>
              <div className="font-mono">{audit[0] ? new Date(audit[0].changed_at).toLocaleString() : "—"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Updated by</div>
              <div className="font-mono truncate" title={audit[0]?.changed_by ?? ""}>
                {audit[0]
                  ? (audit[0].actor_email ?? (audit[0].changed_by ? `${audit[0].changed_by.slice(0, 8)}…` : "system"))
                  : "—"}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {(() => {
              // Single source of truth for field validity. The Save button,
              // the inline error message, the blur toast and the save guard
              // all read through `ttlFieldError()` — wording is defined once
              // in `ttlMessages.ts` so the surfaces can never disagree.
              const fe = ttlFieldError(m, seconds, { min: MIN, max: MAX });
              const fieldError: string | null = fe?.message ?? null;
              return (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ttl-seconds">Seconds</Label>
                    {(() => {
                      // Stable, consistent IDs referenced from both the
                      // input's aria-describedby and the rendered messages.
                      // describedby is space-joined and conditional so SR
                      // users hear only descriptions that are visible.
                      const HELP_ID = "ttl-seconds-help";
                      const FIELD_ERR_ID = "ttl-seconds-error";
                      const SERVER_ERR_ID = "ttl-seconds-server-error";
                      const describedBy = [
                        HELP_ID,
                        fieldError ? FIELD_ERR_ID : null,
                        serverError ? SERVER_ERR_ID : null,
                      ].filter(Boolean).join(" ");
                      // Input is invalid whenever a client-side rule fails
                      // OR the server rejected the most recent save attempt
                      // — both states should announce to assistive tech.
                      const isInvalid = fieldError !== null || serverError !== null;
                      return (
                        <>
                          <Input
                            id="ttl-seconds"
                            type="number"
                            min={MIN}
                            max={MAX}
                            step={30}
                            value={seconds}
                            aria-invalid={isInvalid}
                            aria-errormessage={
                              fieldError ? FIELD_ERR_ID : serverError ? SERVER_ERR_ID : undefined
                            }
                            aria-describedby={describedBy}
                            onChange={(e) => {
                              // Editing implies the admin acknowledges the
                              // prior failure — clear the server-error panel.
                              if (serverError) setServerError(null);
                              const raw = e.target.value;
                              if (raw === "") { setSeconds(NaN as unknown as number); return; }
                              const n = Number(raw);
                              if (!Number.isFinite(n)) return;
                              setSeconds(n);
                            }}
                            onBlur={() => {
                              // Re-classify (state may have changed since
                              // last render) and reuse the SAME message for
                              // the toast description that the inline panel
                              // shows — blur and inline can never diverge.
                              const err = ttlFieldError(m, seconds, { min: MIN, max: MAX });
                              if (!err) return;
                              if (err.kind === "empty") {
                                toast({ title: m(TTL_I18N_KEYS.toastInvalidT), description: err.message, variant: "destructive" });
                                setSeconds(DEFAULT);
                                return;
                              }
                              if (err.kind === "tooLow" || err.kind === "tooHigh") {
                                const clamped = Math.max(MIN, Math.min(MAX, Math.floor(seconds)));
                                toast({ title: m(TTL_I18N_KEYS.toastOutT), description: err.message, variant: "destructive" });
                                setSeconds(clamped);
                                return;
                              }
                              // decimal
                              const floored = Math.floor(seconds);
                              toast({ title: m(TTL_I18N_KEYS.toastRoundT), description: err.message, variant: "destructive" });
                              setSeconds(floored);
                            }}
                            className={`w-32 ${isInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          />
                          {/* Help text always renders so describedby points
                              to a stable element regardless of validity. */}
                          <p id={HELP_ID} className="text-xs text-muted-foreground">
                            {m(TTL_I18N_KEYS.helpRange, { min: MIN, max: MAX })}
                          </p>
                          {fieldError && (
                            <p
                              id={FIELD_ERR_ID}
                              role="alert"
                              aria-live="polite"
                              className="text-xs text-destructive font-medium"
                            >
                              {fieldError}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className="text-sm text-muted-foreground pb-2.5">
                    ≈ {Number.isFinite(seconds) ? Math.round(seconds / 60) : 0} min
                  </div>
                  <Button
                    onClick={save}
                    // Tied directly to the field-level error: whenever the
                    // inline message is visible, Save is disabled.
                    disabled={saving || fieldError !== null}
                    title={fieldError ?? undefined}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/admin/signed-image-requests" className="gap-1.5">
                      <ExternalLink className="w-4 h-4" /> View signed-URL audit log
                    </Link>
                  </Button>
                </div>
              );
            })()}

            {/* Persistent inline panel showing the verbatim trigger output
                from the last failed save. Stays visible until the admin
                edits the input or saves successfully — toasts dismiss on
                their own, this doesn't. */}
            {serverError && (
              <div
                id="ttl-seconds-server-error"
                ref={serverErrorPanelRef}
                role="alert"
                aria-live="polite"
                aria-atomic="true"
                tabIndex={-1}
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-destructive">
                    {m(TTL_I18N_KEYS.serverPanelT)}
                  </p>
                  <button
                    type="button"
                    onClick={dismissServerError}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss server error"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="font-mono text-xs break-words">{serverError.message}</p>
                {serverError.hint && (
                  <p className="text-xs"><span className="font-semibold">{m(TTL_I18N_KEYS.serverHintLabel)}</span> {serverError.hint}</p>
                )}
                {serverError.details && (
                  <p className="text-xs"><span className="font-semibold">{m(TTL_I18N_KEYS.serverDetLabel)}</span> {serverError.details}</p>
                )}
                {serverError.code && (
                  <p className="text-[11px] text-muted-foreground">{m(TTL_I18N_KEYS.serverCodeLabel)} {serverError.code}</p>
                )}
              </div>
            )}

            {/* Visual slider locked to the server-enforced 60–3600 range.
                Step matches the number input (30s) so both controls move in
                lockstep. Tick labels mark common presets. */}
            <div className="space-y-2 max-w-xl">
              <Slider
                aria-label="Signed URL TTL in seconds"
                min={MIN}
                max={MAX}
                step={30}
                value={[Number.isFinite(seconds) ? Math.max(MIN, Math.min(MAX, seconds)) : DEFAULT]}
                onValueChange={(vals) => {
                  const v = vals[0];
                  if (typeof v === "number") setSeconds(v);
                }}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>1 min</span>
                <span>15 min</span>
                <span>30 min</span>
                <span>45 min</span>
                <span>1 hr</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
            <Lock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="override-allowed" className="text-sm font-medium cursor-pointer">
                  Allow per-user expiry overrides
                </Label>
                <Switch
                  id="override-allowed"
                  checked={overrideAllowed}
                  disabled={overrideSaving}
                  onCheckedChange={(v) => void saveOverrideAllowed(v)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {overrideAllowed
                  ? "Users can choose their own image link expiry in the image viewer."
                  : "Disabled — everyone is forced to use the server default above. Their selector is read-only."}
              </p>
            </div>
          </div>
        </>
      )}

      <div className="pt-2 border-t border-border/40 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Change history</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {auditTotal === null
                ? `Showing ${audit.length}`
                : `Showing ${audit.length} of ${auditTotal}`}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => audit[0] && setSelectedEntry(audit[0])}
              disabled={auditLoading || audit.length === 0}
              className="h-7 gap-1.5 text-xs"
              title="Open the most recent change in a details drawer"
            >
              <Eye className="w-3.5 h-3.5" />
              View latest
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={exporting}
              className="h-7 gap-1.5 text-xs"
              title="Download the full TTL + override change history as CSV"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="insert">Insert</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              placeholder="Search actor email or user id…"
              className="h-8 text-xs pl-7 pr-7"
              aria-label="Search by actor email or user id"
            />
            {actorQuery && (
              <button
                type="button"
                onClick={() => setActorQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear actor search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {(actionFilter !== "all" || actorQuery) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => { setActionFilter("all"); setActorQuery(""); }}
            >
              Reset
            </Button>
          )}
        </div>

        {auditLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {actionFilter !== "all" || trimmedActor
              ? "No changes match the current filters."
              : "No changes recorded yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="font-medium py-1.5 pr-3">When</th>
                  <th className="font-medium py-1.5 pr-3">Action</th>
                  <th className="font-medium py-1.5 pr-3">Old</th>
                  <th className="font-medium py-1.5 pr-3">New</th>
                  <th className="font-medium py-1.5 pr-3">By</th>
                  <th className="font-medium py-1.5 pr-3 w-8"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {audit.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedEntry(r)}
                    className="border-t border-border/30 cursor-pointer hover:bg-muted/40 focus-within:bg-muted/40"
                  >
                    <td className="py-1.5 pr-3 font-mono">{new Date(r.changed_at).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 uppercase tracking-wide">{r.action}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatValue(r.old_value)}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatValue(r.new_value)}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground" title={r.changed_by ?? ""}>
                      {r.actor_email ?? (r.changed_by ? `${r.changed_by.slice(0, 8)}…` : "system")}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedEntry(r); }}
                        className="text-muted-foreground hover:text-foreground p-1"
                        aria-label="View change details"
                        title="View change details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!auditLoading && audit.length > 0 && auditTotal !== null && audit.length < auditTotal && (
          <div className="flex justify-center pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadAudit(false)}
              disabled={loadingMore}
              className="h-7 gap-1.5 text-xs"
            >
              {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Load {Math.min(AUDIT_PAGE_SIZE, auditTotal - audit.length)} more
            </Button>
          </div>
        )}
      </div>

      {/* Details drawer for a single audit entry. Shows old vs new side by
          side, the action, the actor (resolved email + full uuid), and a raw
          JSON dump for completeness. */}
      <Sheet open={selectedEntry !== null} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {selectedEntry && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="uppercase tracking-wide text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {selectedEntry.action}
                  </span>
                  Signed URL TTL change
                </SheetTitle>
                <SheetDescription>
                  {new Date(selectedEntry.changed_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Old value</div>
                    <div className="font-mono text-sm break-all">{formatValue(selectedEntry.old_value)}</div>
                  </div>
                  <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">New value</div>
                    <div className="font-mono text-sm break-all">{formatValue(selectedEntry.new_value)}</div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Changed by</div>
                  <div className="font-mono text-sm break-all">
                    {selectedEntry.actor_email
                      ?? (selectedEntry.changed_by ? selectedEntry.changed_by : "system")}
                  </div>
                  {selectedEntry.changed_by && selectedEntry.actor_email && (
                    <div className="font-mono text-[11px] text-muted-foreground break-all">
                      {selectedEntry.changed_by}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Entry ID</div>
                  <div className="font-mono text-[11px] text-muted-foreground break-all">{selectedEntry.id}</div>
                </div>

                <details className="rounded-md border border-border/50 bg-muted/20 p-3">
                  <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-muted-foreground">
                    Raw JSON
                  </summary>
                  <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-all">
{JSON.stringify({
  old_value: selectedEntry.old_value,
  new_value: selectedEntry.new_value,
  action: selectedEntry.action,
  changed_at: selectedEntry.changed_at,
  changed_by: selectedEntry.changed_by,
}, null, 2)}
                  </pre>
                </details>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
