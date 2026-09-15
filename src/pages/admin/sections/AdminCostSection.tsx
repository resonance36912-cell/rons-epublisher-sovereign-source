import { Loader2, RefreshCw, TrendingUp, Headphones, Zap, DollarSign, ShieldAlert, Users, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { EdgeFunctionMonitor } from "@/components/storyforge/EdgeFunctionMonitor";
import { VideoExportDriftMonitor } from "@/components/storyforge/VideoExportDriftMonitor";
import { useAdmin } from "../AdminContext";
import { ServiceCostBreakdown } from "./ServiceCostBreakdown";
import { CostForecastWidget } from "./CostForecastWidget";
import { TtsCacheHitRateWidget } from "./TtsCacheHitRateWidget";

export function AdminCostSection() {
  const {
    usageLogs, usageLogsLoading, fetchUsageLogs,
    usageChartData, driftChartData, usageSummary, costSummary, perUserCosts, projectedMonthlyCost,
    costThreshold, setCostThreshold, editingThreshold, setEditingThreshold,
    thresholdInput, setThresholdInput, costThresholdExceeded,
  } = useAdmin();

  return (
    <>
      {/* Per-service cost & OSS alternatives */}
      <ServiceCostBreakdown />

      {/* Per-service forecast (7d vs 30d) */}
      <CostForecastWidget />

      {/* TTS server-side cache savings */}
      <TtsCacheHitRateWidget usageLogs={usageLogs} />

      {/* Usage Trends */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="font-semibold">Usage Trends (Last 30 Days)</h2>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={fetchUsageLogs} disabled={usageLogsLoading}>
            <RefreshCw className={`w-3.5 h-3.5 ${usageLogsLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        {usageLogsLoading && usageLogs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : usageLogs.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No usage data yet</p>
            <p className="text-xs mt-1">Data will appear here after TTS or image generation calls are made</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{usageSummary.totalTts}</p>
                <p className="text-[11px] text-muted-foreground">TTS Calls</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{usageSummary.totalImages}</p>
                <p className="text-[11px] text-muted-foreground">Image Generations</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{usageSummary.totalChars.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">Characters Narrated</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{usageSummary.avgDurationTts > 0 ? `${(usageSummary.avgDurationTts / 1000).toFixed(1)}s` : "—"}</p>
                <p className="text-[11px] text-muted-foreground">Avg TTS Latency</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{usageSummary.avgDurationImg > 0 ? `${(usageSummary.avgDurationImg / 1000).toFixed(1)}s` : "—"}</p>
                <p className="text-[11px] text-muted-foreground">Avg Image Latency</p>
              </div>
            </div>

            {/* Cost Summary */}
            <div className="bg-muted/20 border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Estimated Cost Breakdown</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {([
                  { label: "Last 7 Days", data: costSummary.last7 },
                  { label: "Last 30 Days", data: costSummary.last30 },
                  { label: "All Time", data: costSummary.allTime },
                ] as const).map(({ label, data }) => (
                  <div key={label} className="bg-card border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">${data.total.toFixed(2)}</p>
                    <div className="flex gap-3 text-[11px] text-muted-foreground">
                      <span>TTS: ${data.ttsCost.toFixed(2)}</span>
                      <span>Images: ${data.imgCost.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Estimates based on ElevenLabs ~$0.30/1K chars and Gemini Flash ~$0.04/image. Actual costs may vary by plan.
              </p>
            </div>

            {/* Per-User Cost Breakdown */}
            {perUserCosts.length > 0 && (
              <div className="bg-muted/20 border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Per-User Cost Breakdown</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{perUserCosts.length} users</span>
                </div>
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">User</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">TTS Calls</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Images</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Characters</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">TTS Cost</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Image Cost</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {perUserCosts.map((u) => (
                        <tr key={u.userId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 text-xs font-medium">{u.name}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right">{u.ttsCalls}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right">{u.imgCalls}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right">{u.chars.toLocaleString()}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right">${u.ttsCost.toFixed(2)}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right">${u.imgCost.toFixed(2)}</td>
                          <td className="px-4 py-2 text-xs font-semibold text-right">${u.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Cost Threshold Alert */}
            <div className={`border rounded-lg p-4 space-y-3 ${costThresholdExceeded ? "bg-destructive/10 border-destructive/30" : "bg-muted/20"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className={`w-4 h-4 ${costThresholdExceeded ? "text-destructive" : "text-muted-foreground"}`} />
                  <h3 className="text-sm font-semibold">Monthly Cost Alert</h3>
                </div>
                {!editingThreshold ? (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setThresholdInput(costThreshold.toString()); setEditingThreshold(true); }}>
                    Threshold: ${costThreshold.toFixed(2)}/mo — Edit
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={thresholdInput}
                      onChange={(e) => setThresholdInput(e.target.value)}
                      className="w-20 h-7 text-xs border rounded px-2 bg-background"
                      autoFocus
                    />
                    <span className="text-xs text-muted-foreground">/mo</span>
                    <Button variant="outline" size="sm" className="text-xs h-7 px-2" onClick={() => {
                      const val = parseFloat(thresholdInput);
                      if (!isNaN(val) && val >= 0) {
                        setCostThreshold(val);
                        toast.success(`Cost threshold set to $${val.toFixed(2)}/mo`);
                      }
                      setEditingThreshold(false);
                    }}>Save</Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setEditingThreshold(false)}>Cancel</Button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Projected Monthly</p>
                  <p className={`text-lg font-bold ${costThresholdExceeded ? "text-destructive" : ""}`}>
                    ${projectedMonthlyCost.toFixed(2)}
                  </p>
                </div>
                <div className="flex-1">
                  <Progress value={Math.min(100, costThreshold > 0 ? (projectedMonthlyCost / costThreshold) * 100 : 0)} className="h-2" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Budget</p>
                  <p className="text-sm font-medium">${costThreshold.toFixed(2)}</p>
                </div>
              </div>
              {costThresholdExceeded && (
                <p className="text-xs text-destructive font-medium">
                  ⚠ Projected cost exceeds your monthly threshold by ${(projectedMonthlyCost - costThreshold).toFixed(2)}
                </p>
              )}
            </div>

            {/* Chart */}
            {usageChartData.length > 0 && (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={usageChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => {
                        const d = new Date(v);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                      className="fill-muted-foreground"
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <ReTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(v: string) => new Date(v).toLocaleDateString()} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tts" name="TTS Calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="images" name="Image Generations" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Recent logs */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Recent Calls</h3>
              <div className="overflow-x-auto max-h-[250px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Service</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Characters</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Duration</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Status</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...usageLogs].reverse().slice(0, 50).map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1 text-xs">
                            {log.service === "elevenlabs-tts" ? <Headphones className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                            {log.service === "elevenlabs-tts" ? "TTS" : "Image Gen"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{log.tokens_or_chars > 0 ? log.tokens_or_chars.toLocaleString() : "—"}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{log.duration_ms > 0 ? `${(log.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            (log.metadata as any)?.success ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"
                          }`}>
                            {(log.metadata as any)?.success ? "OK" : "Failed"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edge Function Health */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Edge Function Health & Alerts</h2>
          <span className="text-xs text-muted-foreground ml-auto">Last 24h analysis</span>
        </div>
        <div className="p-6">
          <EdgeFunctionMonitor usageLogs={usageLogs} />
        </div>
      </div>

      {/* Video Export A/V Sync */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <Film className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Video Export A/V Sync Health</h2>
          <span className="text-xs text-muted-foreground ml-auto">Last 30 days</span>
        </div>
        <div className="p-6 space-y-6">
          {driftChartData.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium">Daily A/V drift (avg & P95)</h3>
                <span className="text-[11px] text-muted-foreground">
                  {driftChartData.reduce((s, d) => s + d.count, 0)} exports across {driftChartData.length} days
                </span>
              </div>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={driftChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => {
                        const d = new Date(v);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                      className="fill-muted-foreground"
                    />
                    <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" tickFormatter={(v: number) => `${v.toFixed(2)}s`} />
                    <ReTooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
                      formatter={(v: number, name: string) => [`±${v.toFixed(3)}s`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="avg" name="Avg |drift|" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="p95" name="P95 |drift|" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <VideoExportDriftMonitor usageLogs={usageLogs} />
        </div>
      </div>
    </>
  );
}
