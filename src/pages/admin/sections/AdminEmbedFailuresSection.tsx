import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Calendar as CalendarIcon, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { normalizeEmbedUrl } from "@/lib/embedEvents";

type ProviderFilter = "all" | "YouTube" | "Vimeo" | "source";

interface EventRow {
  id: string;
  created_at: string;
  properties: { provider?: string; embed_url?: string } | null;
}

interface DailyBucket {
  date: string;       // YYYY-MM-DD
  YouTube: number;
  Vimeo: number;
  source: number;
  total: number;
}

const EVENT_NAME = "demo_video_embed_failed";
const RETRY_EVENT_NAME = "demo_video_embed_retry";

type CombinedRow = EventRow & { kind: "failure" | "retry"; normalizedUrl: string | null };


export function AdminEmbedFailuresSection() {
  const [from, setFrom] = useState<Date>(() => subDays(new Date(), 30));
  const [to, setTo] = useState<Date>(() => new Date());
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [embedUrlInput, setEmbedUrlInput] = useState("");
  const [embedUrlFilter, setEmbedUrlFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [retryRows, setRetryRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    // Inclusive end of day.
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const buildQuery = (eventName: string) => {
      let q = supabase
        .from("analytics_events")
        .select("id, created_at, properties")
        .eq("event", eventName)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (provider !== "all") {
        q = q.eq("properties->>provider", provider);
      }
      if (embedUrlFilter) {
        q = q.eq("properties->>embed_url", embedUrlFilter);
      }
      return q;
    };

    const [failRes, retryRes] = await Promise.all([
      buildQuery(EVENT_NAME),
      buildQuery(RETRY_EVENT_NAME),
    ]);

    if (failRes.error) {
      setError(failRes.error.message);
      setRows([]);
    } else {
      setRows((failRes.data ?? []) as EventRow[]);
    }
    if (retryRes.error) {
      setRetryRows([]);
    } else {
      setRetryRows((retryRes.data ?? []) as EventRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, provider, embedUrlFilter]);

  // Aggregate per-day per-provider.
  const { byDay, totals } = useMemo(() => {
    const buckets = new Map<string, DailyBucket>();
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    // Pre-fill so the chart shows zero-days too.
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = format(d, "yyyy-MM-dd");
      buckets.set(key, { date: key, YouTube: 0, Vimeo: 0, source: 0, total: 0 });
    }
    const tot = { YouTube: 0, Vimeo: 0, source: 0, total: 0 };
    for (const r of rows) {
      const key = format(new Date(r.created_at), "yyyy-MM-dd");
      const b = buckets.get(key) ?? { date: key, YouTube: 0, Vimeo: 0, source: 0, total: 0 };
      const p = (r.properties?.provider ?? "source") as keyof typeof tot;
      const bucketKey = (p === "YouTube" || p === "Vimeo") ? p : "source";
      b[bucketKey] += 1;
      b.total += 1;
      buckets.set(key, b);
      tot[bucketKey] += 1;
      tot.total += 1;
    }
    return {
      byDay: Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date)),
      totals: tot,
    };
  }, [rows, from, to]);

  // Build a set of normalized retry URLs so failures can be joined against
  // retries using the canonical (hash-stripped, length-capped) URL form.
  const retryUrlSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of retryRows) {
      const n = normalizeEmbedUrl(r.properties?.embed_url);
      if (n) set.add(n);
    }
    return set;
  }, [retryRows]);

  // How many distinct failed URLs in-window were followed by a retry?
  const matchedFailureUrls = useMemo(() => {
    const failed = new Set<string>();
    const matched = new Set<string>();
    for (const r of rows) {
      const n = normalizeEmbedUrl(r.properties?.embed_url);
      if (!n) continue;
      failed.add(n);
      if (retryUrlSet.has(n)) matched.add(n);
    }
    return { matched: matched.size, totalDistinct: failed.size };
  }, [rows, retryUrlSet]);

  // Merge failures + retries for the recent events table, newest first.
  const combinedRows = useMemo<CombinedRow[]>(() => {
    const merged: CombinedRow[] = [
      ...rows.map((r) => ({ ...r, kind: "failure" as const, normalizedUrl: normalizeEmbedUrl(r.properties?.embed_url) })),
      ...retryRows.map((r) => ({ ...r, kind: "retry" as const, normalizedUrl: normalizeEmbedUrl(r.properties?.embed_url) })),
    ];
    merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return merged;
  }, [rows, retryRows]);


  function applyUrlFilter() {
    const trimmed = embedUrlInput.trim();
    if (!trimmed) {
      setEmbedUrlFilter(null);
      return;
    }
    const normalized = normalizeEmbedUrl(trimmed);
    if (!normalized) {
      setError("Embed URL must be a valid http(s) URL.");
      return;
    }
    setError(null);
    setEmbedUrlInput(normalized);
    setEmbedUrlFilter(normalized);
  }

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Demo video embed failures
          </h2>
          <p className="text-sm text-muted-foreground">
            Tracks how often the landing-page demo player falls back to the
            "Watch on…" CTA, broken down by provider.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      <div className="p-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="From" date={from} onChange={setFrom} maxDate={to} />
          <DateField label="To" date={to} onChange={setTo} minDate={from} maxDate={new Date()} />
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">Provider</label>
            <Select value={provider} onValueChange={(v) => setProvider(v as ProviderFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                <SelectItem value="YouTube">YouTube</SelectItem>
                <SelectItem value="Vimeo">Vimeo</SelectItem>
                <SelectItem value="source">Other / unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[260px]">
            <label className="text-xs text-muted-foreground block">
              Embed URL (normalized: hash stripped, ≤500 chars)
            </label>
            <div className="flex gap-2">
              <Input
                value={embedUrlInput}
                onChange={(e) => setEmbedUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyUrlFilter(); }}
                placeholder="https://youtu.be/abc123"
                className="h-9"
              />
              <Button size="sm" variant="secondary" onClick={applyUrlFilter}>Apply</Button>
              {embedUrlFilter && (
                <Button size="sm" variant="ghost" onClick={() => { setEmbedUrlInput(""); setEmbedUrlFilter(null); }}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">Failed to load events: {error}</p>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label="Total failures" value={totals.total} />
          <StatTile label="YouTube" value={totals.YouTube} />
          <StatTile label="Vimeo" value={totals.Vimeo} />
          <StatTile label="Other / unknown" value={totals.source} />
          <StatTile
            label="URLs w/ matched retry"
            value={matchedFailureUrls.matched}
            hint={`of ${matchedFailureUrls.totalDistinct} distinct failed URLs`}
          />
        </div>

        {/* Trend */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={byDay} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <ReTooltip />
              <Legend />
              {(provider === "all" || provider === "YouTube") && (
                <Line type="monotone" dataKey="YouTube" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              )}
              {(provider === "all" || provider === "Vimeo") && (
                <Line type="monotone" dataKey="Vimeo" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
              )}
              {(provider === "all" || provider === "source") && (
                <Line type="monotone" dataKey="source" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Recent events table */}
        <div>
          <h4 className="text-sm font-semibold mb-2">
            Recent events{" "}
            <span className="text-xs text-muted-foreground font-normal">
              (failures + retries
              {rows.length >= 1000 || retryRows.length >= 1000
                ? ", showing latest 1000 of each"
                : ""}
              )
            </span>
          </h4>
          {combinedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures or retries recorded in this window.</p>
          ) : (
            <div className="rounded-lg border max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Event</th>
                    <th className="text-left px-3 py-2">Provider</th>
                    <th className="text-left px-3 py-2">Embed URL (normalized)</th>
                    <th className="text-left px-3 py-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {combinedRows.slice(0, 200).map((r) => {
                    const hasMatch = r.normalizedUrl ? retryUrlSet.has(r.normalizedUrl) : false;
                    return (
                      <tr key={`${r.kind}-${r.id}`} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
                              r.kind === "failure"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-primary/10 text-primary",
                            )}
                          >
                            {r.kind === "failure" ? "Failure" : "Retry"}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.properties?.provider ?? "—"}</td>
                        <td className="px-3 py-2 truncate max-w-[420px] text-muted-foreground">
                          {r.normalizedUrl ?? r.properties?.embed_url ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {r.kind === "failure" && hasMatch ? (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                              retry seen
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value.toLocaleString()}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function DateField({
  label, date, onChange, minDate, maxDate,
}: {
  label: string;
  date: Date;
  onChange: (d: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground block">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("w-[160px] justify-start text-left font-normal")}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {format(date, "PPP")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => d && onChange(d)}
            disabled={(d) =>
              (minDate ? d < new Date(minDate.toDateString()) : false) ||
              (maxDate ? d > new Date(maxDate.toDateString()) : false)
            }
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
