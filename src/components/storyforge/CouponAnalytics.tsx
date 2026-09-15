import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, TrendingUp, Ticket, Users, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";

type Redemption = {
  id: string;
  coupon_id: string;
  user_id: string;
  granted_tier: string | null;
  redeemed_at: string;
};

type Coupon = {
  id: string;
  code: string;
  coupon_type: string;
  discount_value: number;
  target_tier: string;
  max_redemptions: number;
  active: boolean;
};

const TIER_COLORS: Record<string, string> = {
  standard: "hsl(45, 93%, 47%)",
  premium: "hsl(217, 91%, 60%)",
  ultimate: "hsl(36, 100%, 50%)",
};

const TYPE_COLORS: Record<string, string> = {
  free_access: "hsl(142, 71%, 45%)",
  percentage: "hsl(262, 83%, 58%)",
  fixed: "hsl(24, 95%, 53%)",
};

export function CouponAnalytics({ profiles }: { profiles: { user_id: string; email: string | null; full_name: string | null }[] }) {
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes] = await Promise.all([
        supabase.from("coupon_redemptions").select("*").order("redeemed_at", { ascending: true }),
        supabase.from("coupons").select("*"),
      ]);
      setRedemptions((rRes.data || []) as Redemption[]);
      setCoupons((cRes.data || []) as Coupon[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Redemptions over time (daily)
  const dailyChart = useMemo(() => {
    const dayMap = new Map<string, { date: string; count: number }>();
    for (const r of redemptions) {
      const day = r.redeemed_at.slice(0, 10);
      const entry = dayMap.get(day) || { date: day, count: 0 };
      entry.count += 1;
      dayMap.set(day, entry);
    }
    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [redemptions]);

  // By tier
  const tierBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of redemptions) {
      const tier = r.granted_tier || "unknown";
      map[tier] = (map[tier] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [redemptions]);

  // By coupon type
  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of redemptions) {
      const coupon = coupons.find(c => c.id === r.coupon_id);
      const type = coupon?.coupon_type || "unknown";
      map[type] = (map[type] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [redemptions, coupons]);

  // Top coupons
  const topCoupons = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of redemptions) map.set(r.coupon_id, (map.get(r.coupon_id) || 0) + 1);
    return Array.from(map.entries())
      .map(([id, count]) => {
        const c = coupons.find(cp => cp.id === id);
        return { code: c?.code || id.slice(0, 8), count, type: c?.coupon_type || "—", tier: c?.target_tier || "—" };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [redemptions, coupons]);

  // Unique users
  const uniqueUsers = useMemo(() => new Set(redemptions.map(r => r.user_id)).size, [redemptions]);

  if (loading) {
    return (
      <div className="bg-card border rounded-xl p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (redemptions.length === 0) {
    return (
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold text-lg">Coupon Analytics</h2>
        </div>
        <p className="text-sm text-muted-foreground">No redemptions yet. Analytics will appear once coupons are redeemed.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold text-lg">Coupon Analytics</h2>
          <Badge variant="outline" className="text-xs">{redemptions.length} redemptions</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={fetch} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Ticket className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xl font-bold">{redemptions.length}</p>
            <p className="text-xs text-muted-foreground">Total Redemptions</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xl font-bold">{uniqueUsers}</p>
            <p className="text-xs text-muted-foreground">Unique Users</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xl font-bold">{coupons.filter(c => c.active).length}</p>
            <p className="text-xs text-muted-foreground">Active Coupons</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xl font-bold">
              {dailyChart.length > 0
                ? (redemptions.length / dailyChart.length).toFixed(1)
                : "0"}
            </p>
            <p className="text-xs text-muted-foreground">Avg/Day</p>
          </div>
        </div>
      </div>

      {/* Redemptions over time chart */}
      <div className="px-6 py-4 border-b">
        <h3 className="text-sm font-medium mb-3">Redemptions Over Time</h3>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" name="Redemptions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown row: tier + type pie charts + top coupons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x">
        {/* By tier */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-medium mb-3">By Tier</h3>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={tierBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {tierBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={TIER_COLORS[entry.name] || "hsl(var(--muted-foreground))"} />
                  ))}
                </Pie>
                <ReTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* By type */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-medium mb-3">By Type</h3>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {typeBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={TYPE_COLORS[entry.name] || "hsl(var(--muted-foreground))"} />
                  ))}
                </Pie>
                <ReTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top coupons */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-medium mb-3">Top Coupons</h3>
          <div className="space-y-2">
            {topCoupons.map((c, i) => (
              <div key={c.code} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-4">{i + 1}.</span>
                  <span className="font-mono font-semibold text-primary">{c.code}</span>
                  <Badge variant="outline" className="text-[9px] capitalize">{c.tier}</Badge>
                </div>
                <span className="font-medium">{c.count}×</span>
              </div>
            ))}
            {topCoupons.length === 0 && (
              <p className="text-xs text-muted-foreground">No data yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
