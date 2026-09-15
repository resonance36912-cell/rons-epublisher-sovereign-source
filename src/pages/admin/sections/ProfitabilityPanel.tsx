import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, DollarSign, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TIER_ORDER, TIER_META } from "../types";
import type { UserTier } from "@/hooks/useUserTier";
import {
  AMORT_MONTHS,
  LIFETIME_PRICE_ZAR,
  PAYFAST_PCT,
  PAYFAST_FIXED_ZAR,
  computeProfitability,
  type TierRow,
} from "./profitabilityMath";

// USD→ZAR conversion for API costs (admin can tweak via input)
const DEFAULT_FX = 18.5;

type SortKey = "tier" | "users" | "revenueZar" | "marginZar" | "marginPct";
type SortDir = "asc" | "desc";

const SORT_ACCESSORS: Record<SortKey, (r: TierRow) => number> = {
  tier: (r) => TIER_ORDER.indexOf(r.tier),
  users: (r) => r.users,
  revenueZar: (r) => r.revenueZar,
  marginZar: (r) => r.marginZar,
  marginPct: (r) => r.marginPct,
};




export function ProfitabilityPanel() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TierRow[]>([]);
  const [fx, setFx] = useState<number>(DEFAULT_FX);
  const [totals, setTotals] = useState<{ revenue: number; cost: number; margin: number; users: number }>({
    revenue: 0, cost: 0, margin: 0, users: 0,
  });
  const [sortKey, setSortKey] = useState<SortKey>("tier");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hideEmpty, setHideEmpty] = useState<boolean>(false);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      // Numeric columns default to descending on first click; tier defaults ascending.
      setSortDir(key === "tier" ? "asc" : "desc");
      return key;
    });
  }, []);

  const displayedRows = useMemo(() => {
    const filtered = hideEmpty ? rows.filter((r) => r.users > 0) : rows;
    const accessor = SORT_ACCESSORS[sortKey];
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (accessor(a) - accessor(b)) * sign);
  }, [rows, sortKey, sortDir, hideEmpty]);



  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();

      const [profilesRes, purchasesRes, logsRes] = await Promise.all([
        supabase.from("profiles").select("user_id"),
        supabase.from("purchases").select("user_id, price_id, amount_total, created_at"),
        supabase.from("api_usage_logs").select("user_id, cost_estimate, created_at").gte("created_at", cutoff),
      ]);

      const built = computeProfitability({
        profiles: (profilesRes.data ?? []) as Array<{ user_id: string }>,
        purchases: (purchasesRes.data ?? []) as Array<{
          user_id: string;
          price_id: string;
          amount_total: number | null;
          created_at: string;
        }>,
        logs: (logsRes.data ?? []) as Array<{ user_id: string | null; cost_estimate: number | null }>,
        fxUsdToZar: fx,
      });

      setRows(built);
      const tRev = built.reduce((a: number, r: TierRow) => a + r.revenueZar, 0);
      const tCost = built.reduce((a: number, r: TierRow) => a + r.costZar + r.payfastZar, 0);
      setTotals({
        revenue: tRev,
        cost: tCost,
        margin: tRev - tCost,
        users: built.reduce((a: number, r: TierRow) => a + r.users, 0),
      });

    } finally {
      setLoading(false);
    }
  }, [fx]);

  useEffect(() => { void load(); }, [load]);

  const fmt = (n: number) => `R${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" />
          <div>
            <h2 className="font-semibold">Profitability by Tier (Last 30 Days)</h2>
            <p className="text-xs text-muted-foreground">
              Once-off lifetime unlocks amortized over {AMORT_MONTHS} months + 30d credit-pack revenue, minus realized API costs and Payfast fees.
            </p>

          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="h-3.5 w-3.5"
              aria-label="Hide empty tiers"
            />
            Hide empty tiers
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            USD→ZAR
            <input
              type="number"
              step="0.1"
              min="1"
              value={fx}
              onChange={(e) => setFx(Math.max(1, Number(e.target.value) || DEFAULT_FX))}
              className="w-16 h-7 text-xs border rounded px-2 bg-background"
            />
          </label>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Users" value={totals.users.toString()} />
            <Stat label="Revenue (30d)" value={fmt(totals.revenue)} />
            <Stat label="Cost (API + fees)" value={fmt(totals.cost)} />
            <Stat
              label="Net Margin"
              value={fmt(totals.margin)}
              tone={totals.margin >= 0 ? "positive" : "negative"}
            />
          </div>

          {/* Per-tier table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <SortableTh label="Tier" align="left" active={sortKey === "tier"} dir={sortDir} onClick={() => toggleSort("tier")} />
                  <SortableTh label="Users" active={sortKey === "users"} dir={sortDir} onClick={() => toggleSort("users")} />
                  <SortableTh label="Revenue" active={sortKey === "revenueZar"} dir={sortDir} onClick={() => toggleSort("revenueZar")} />
                  <th className="text-right px-3 py-2 font-medium">API Cost</th>
                  <th className="text-right px-3 py-2 font-medium">Payfast</th>
                  <th className="text-right px-3 py-2 font-medium">Cost / user</th>
                  <SortableTh label="Margin" active={sortKey === "marginZar"} dir={sortDir} onClick={() => toggleSort("marginZar")} />
                  <SortableTh label="Margin %" active={sortKey === "marginPct"} dir={sortDir} onClick={() => toggleSort("marginPct")} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayedRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No tiers to display.</td></tr>
                ) : displayedRows.map((r) => {

                  const meta = TIER_META[r.tier];
                  const TierIcon = meta.icon;
                  const positive = r.marginZar >= 0;
                  return (
                    <tr key={r.tier} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <TierIcon className={`w-4 h-4 ${meta.color}`} />
                          <span className="font-medium text-xs">{meta.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.users}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(r.revenueZar)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(r.costZar)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(r.payfastZar)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.costPerUserZar)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${positive ? "text-emerald-500" : "text-destructive"}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {fmt(r.marginZar)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${positive ? "text-emerald-500" : "text-destructive"}`}>
                        {r.revenueZar > 0 ? `${r.marginPct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Revenue model: once-off lifetime unlocks (Starter R99, Creator R249, Pro R499, Business R699) amortized over {AMORT_MONTHS} months, plus credit-pack top-ups (Taste R49, Starter R99, Creator R249, Studio R599) counted in the 30d window.
            Costs from <code>api_usage_logs</code> (TTS $0.0003/char, Image $0.04/img) converted at the FX rate above. Payfast fee {(PAYFAST_PCT * 100).toFixed(1)}% + R{PAYFAST_FIXED_ZAR} per paying user/mo.
            Lovable Cloud infra overhead and free-tier eco usage are not included.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "";
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SortableTh({
  label,
  align = "right",
  active,
  dir,
  onClick,
}: {
  label: string;
  align?: "left" | "right";
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={onClick}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          align === "right" ? "ml-auto" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        {label}
        <Icon className="w-3 h-3" />
      </button>
    </th>
  );
}


