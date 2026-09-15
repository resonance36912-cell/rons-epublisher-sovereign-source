import { useState, useMemo, useEffect, useCallback } from "react";
import { Server, CheckCircle2, Circle, ChevronRight, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useAdmin } from "../AdminContext";
import type { UsageLog } from "../types";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

type Row = {
  key: string;
  service: string;
  category: string;
  pricing: string;
  monthlySpend: number | null;
  fixedNote?: string;
  ossAlternative: string;
  status: "primary" | "fallback" | "active";
  logService?: "elevenlabs-tts" | "generate-chapter-image"; // present = expandable
  /** If set, row supports the admin "switch primary provider" toggle. */
  toggle?: {
    configService: string;       // value of service_provider_config.service
    primaryProvider: string;     // e.g. "elevenlabs"
    fallbackProvider: string;    // e.g. "pollinations"
    fallbackLabel: string;       // human label, e.g. "Free OSS chain"
  };
};

function buildDrilldown(logs: UsageLog[], service: string, perUserNames: Map<string, string>) {
  const cutoff = Date.now() - 30 * 86400000;
  const filtered = logs.filter((l) => l.service === service && new Date(l.created_at).getTime() >= cutoff);

  // Daily spend
  const dayMap = new Map<string, number>();
  for (const l of filtered) {
    const day = l.created_at.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + (l.cost_estimate ?? 0));
  }
  const daily = Array.from(dayMap.entries())
    .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(4)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top 3 users
  const userMap = new Map<string, { calls: number; cost: number }>();
  for (const l of filtered) {
    const uid = l.user_id || "anonymous";
    const e = userMap.get(uid) ?? { calls: 0, cost: 0 };
    e.calls += 1;
    e.cost += l.cost_estimate ?? 0;
    userMap.set(uid, e);
  }
  const topUsers = Array.from(userMap.entries())
    .map(([uid, d]) => ({
      uid,
      name: perUserNames.get(uid) || (uid === "anonymous" ? "Anonymous" : uid.slice(0, 8) + "…"),
      ...d,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);

  // Success / failure
  let success = 0;
  let failure = 0;
  for (const l of filtered) {
    if ((l.metadata as { success?: boolean })?.success) success += 1;
    else failure += 1;
  }
  const total = success + failure;
  const failureRate = total > 0 ? (failure / total) * 100 : 0;

  return { daily, topUsers, success, failure, total, failureRate };
}

export function ServiceCostBreakdown() {
  const { costSummary, usageLogs, perUserCosts } = useAdmin();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] = useState<Record<string, string>>({});
  const [savingService, setSavingService] = useState<string | null>(null);

  // Load admin overrides from service_provider_config (RLS allows authenticated read).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("service_provider_config")
        .select("service, primary_provider");
      if (cancelled || error || !data) return;
      const map: Record<string, string> = {};
      for (const r of data as Array<{ service: string; primary_provider: string }>) {
        map[r.service] = r.primary_provider;
      }
      setProviderConfig(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPrimary = useCallback(
    async (configService: string, provider: string) => {
      setSavingService(configService);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const updatedBy = userRes?.user?.id ?? null;
        const { error } = await supabase
          .from("service_provider_config")
          .upsert(
            { service: configService, primary_provider: provider, updated_by: updatedBy },
            { onConflict: "service" },
          );
        if (error) throw error;
        setProviderConfig((p) => ({ ...p, [configService]: provider }));
        toast({
          title: "Primary provider updated",
          description: `${configService} → ${provider}`,
        });
      } catch (e) {
        toast({
          title: "Could not save provider",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        setSavingService(null);
      }
    },
    [],
  );

  const userNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of perUserCosts) m.set(u.userId, u.name);
    return m;
  }, [perUserCosts]);

  const ttsSpend = costSummary.last30.ttsCost;
  const imgSpend = costSummary.last30.imgCost;

  const rows: Row[] = [
    {
      key: "elevenlabs",
      service: "ElevenLabs TTS",
      category: "Narration",
      pricing: "$0.30 / 1K chars",
      monthlySpend: ttsSpend,
      ossAlternative: "Pollinations.ai → HuggingFace Kokoro-82M (free fallback wired)",
      status: "primary",
      logService: "elevenlabs-tts",
      toggle: {
        configService: "elevenlabs-tts",
        primaryProvider: "elevenlabs",
        fallbackProvider: "pollinations",
        fallbackLabel: "Free chain (Pollinations + HF)",
      },
    },
    {
      key: "gemini-image",
      service: "Gemini Image (Flash)",
      category: "Image generation",
      pricing: "~$0.04 / image",
      monthlySpend: imgSpend,
      ossAlternative: "FLUX-schnell → Pollinations.ai (free fallback wired)",
      status: "primary",
      logService: "generate-chapter-image",
      toggle: {
        configService: "generate-chapter-image",
        primaryProvider: "gemini",
        fallbackProvider: "flux",
        fallbackLabel: "Free chain (FLUX + Pollinations)",
      },
    },
    {
      key: "gemini-text",
      service: "Gemini 2.5/3 (text)",
      category: "Storyboard / rewrite",
      pricing: "Lovable AI Gateway",
      monthlySpend: null,
      fixedNote: "Included in AI balance",
      ossAlternative: "Llama 3 / Mistral via OpenRouter (not wired)",
      status: "primary",
    },
    {
      key: "tavily",
      service: "Tavily Search + Extract",
      category: "Research discovery",
      pricing: "1K free/mo, then paid",
      monthlySpend: null,
      fixedNote: "Free tier",
      ossAlternative: "Brave Search API — 2K free/mo (fallback wired)",
      status: "primary",
    },
    {
      key: "brave",
      service: "Brave Search",
      category: "Research fallback",
      pricing: "2K free/mo",
      monthlySpend: null,
      fixedNote: "Free tier",
      ossAlternative: "SearXNG (self-host, not wired)",
      status: "fallback",
    },
    {
      key: "firecrawl",
      service: "Firecrawl",
      category: "Web scraping",
      pricing: "500 free pages/mo",
      monthlySpend: null,
      fixedNote: "Free tier",
      ossAlternative: "Playwright + Readability (self-host)",
      status: "fallback",
    },
    {
      key: "payfast",
      service: "PayFast",
      category: "Payments (ZAR)",
      pricing: "3.5% + R2 / txn",
      monthlySpend: null,
      fixedNote: "Per transaction",
      ossAlternative: "None (regulated payment rail)",
      status: "active",
    },
    {
      key: "supabase",
      service: "Supabase (Lovable Cloud)",
      category: "DB / Auth / Storage / Functions",
      pricing: "Usage-based",
      monthlySpend: null,
      fixedNote: "$25 free Cloud balance",
      ossAlternative: "Self-hosted Supabase / Postgres",
      status: "active",
    },
  ];

  const trackedTotal = rows.reduce((s, r) => s + (r.monthlySpend ?? 0), 0);

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center gap-2">
        <Server className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">External Service Cost Breakdown</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          Tracked spend (30d): <span className="font-semibold text-foreground">${trackedTotal.toFixed(2)}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="w-6"></th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Service</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Category</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Pricing</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Spend (30d)</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Free / OSS Alternative</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Status</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Primary Provider</th>
            </tr>
          </thead>
          {rows.map((r) => {
            const wired = /wired/i.test(r.ossAlternative);
            const isExpandable = !!r.logService;
            const isOpen = expanded === r.key;
            const drill = isOpen && r.logService ? buildDrilldown(usageLogs, r.logService, userNames) : null;
            return (
              <tbody key={r.key} className="divide-y border-t">
                <tr
                  className={`transition-colors ${isExpandable ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20"}`}
                  onClick={() => isExpandable && setExpanded(isOpen ? null : r.key)}
                >
                    <td className="pl-3 pr-1 py-2.5">
                      {isExpandable ? (
                        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium">{r.service}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.category}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.pricing}</td>
                    <td className="px-4 py-2.5 text-xs text-right font-mono">
                      {r.monthlySpend !== null
                        ? <span className={r.monthlySpend > 0 ? "font-semibold" : "text-muted-foreground"}>${r.monthlySpend.toFixed(2)}</span>
                        : <span className="text-muted-foreground italic">{r.fixedNote ?? "—"}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        {wired
                          ? <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                          : <Circle className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <span className={wired ? "text-foreground" : "text-muted-foreground"}>{r.ossAlternative}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        r.status === "primary"
                          ? "bg-primary/15 text-primary"
                          : r.status === "fallback"
                          ? "bg-amber-500/15 text-amber-600"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {r.toggle ? (() => {
                        const cfg = providerConfig[r.toggle.configService];
                        const isPrimaryActive = !cfg || cfg === r.toggle.primaryProvider;
                        const saving = savingService === r.toggle.configService;
                        return (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={isPrimaryActive}
                              disabled={saving}
                              onCheckedChange={(checked) => {
                                setPrimary(
                                  r.toggle!.configService,
                                  checked ? r.toggle!.primaryProvider : r.toggle!.fallbackProvider,
                                );
                              }}
                              aria-label={`Use ${r.service} as primary`}
                            />
                            <span className="text-[11px] text-muted-foreground leading-tight">
                              {saving ? (
                                <Loader2 className="w-3 h-3 animate-spin inline" />
                              ) : isPrimaryActive ? (
                                <span className="text-foreground font-medium">{r.service}</span>
                              ) : (
                                <span className="text-amber-600 font-medium">{r.toggle.fallbackLabel}</span>
                              )}
                            </span>
                          </div>
                        );
                      })() : (
                        <span className="text-[11px] text-muted-foreground italic">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && drill && (
                    <tr key={`${r.key}-drill`} className="bg-muted/10">
                      <td colSpan={8} className="px-6 py-4">
                        {drill.total === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No usage logs in the last 30 days for this service.</p>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Daily spend trend */}
                            <div className="bg-card border rounded-lg p-3">
                              <p className="text-[11px] font-medium text-muted-foreground mb-2">Daily spend (30d)</p>
                              <div className="h-[120px]">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={drill.daily} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis
                                      dataKey="date"
                                      tick={{ fontSize: 9 }}
                                      tickFormatter={(v: string) => {
                                        const d = new Date(v);
                                        return `${d.getMonth() + 1}/${d.getDate()}`;
                                      }}
                                      className="fill-muted-foreground"
                                    />
                                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} className="fill-muted-foreground" />
                                    <ReTooltip
                                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                      labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
                                      formatter={(v: number) => [`$${v.toFixed(4)}`, "Spend"]}
                                    />
                                    <Line type="monotone" dataKey="cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Top 3 users */}
                            <div className="bg-card border rounded-lg p-3">
                              <p className="text-[11px] font-medium text-muted-foreground mb-2">Top 3 users by cost (30d)</p>
                              {drill.topUsers.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">No users yet.</p>
                              ) : (
                                <ul className="space-y-2">
                                  {drill.topUsers.map((u, i) => (
                                    <li key={u.uid} className="flex items-center gap-2 text-xs">
                                      <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
                                        {i + 1}
                                      </span>
                                      <span className="flex-1 truncate">{u.name}</span>
                                      <span className="text-[10px] text-muted-foreground">{u.calls} calls</span>
                                      <span className="font-mono font-semibold">${u.cost.toFixed(2)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            {/* Reliability */}
                            <div className="bg-card border rounded-lg p-3">
                              <p className="text-[11px] font-medium text-muted-foreground mb-2">Reliability (30d)</p>
                              <div className="space-y-2">
                                <div className="flex items-baseline justify-between">
                                  <span className="text-xs text-muted-foreground">Total calls</span>
                                  <span className="text-sm font-semibold">{drill.total.toLocaleString()}</span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                  <span className="text-xs text-muted-foreground">Success</span>
                                  <span className="text-sm font-semibold text-green-600">{drill.success.toLocaleString()}</span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                  <span className="text-xs text-muted-foreground">Failure</span>
                                  <span className="text-sm font-semibold text-red-600">{drill.failure.toLocaleString()}</span>
                                </div>
                                <div className="pt-1 border-t">
                                  <div className="flex items-baseline justify-between">
                                    <span className="text-xs font-medium">Failure rate</span>
                                    <span className={`text-base font-bold ${
                                      drill.failureRate > 5 ? "text-destructive" : drill.failureRate > 1 ? "text-amber-600" : "text-green-600"
                                    }`}>
                                      {drill.failureRate.toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full ${
                                        drill.failureRate > 5 ? "bg-destructive" : drill.failureRate > 1 ? "bg-amber-500" : "bg-green-500"
                                      }`}
                                      style={{ width: `${Math.min(100, drill.failureRate)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="px-6 py-3 border-t bg-muted/20 text-[11px] text-muted-foreground">
        ✓ = OSS / free alternative is wired and active as a fallback. Toggle <strong>Primary Provider</strong> to demote the paid service and route all new requests through the free chain (persists in <code>service_provider_config</code>).
      </div>
    </div>
  );
}
