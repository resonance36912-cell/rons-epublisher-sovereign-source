import type { DailyPoint, ServiceForecast, UsageLog } from "./types";

export function buildDaily14(logs: UsageLog[], service: string): DailyPoint[] {
  const now = new Date();
  const buckets = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }
  const cutoff = Date.now() - 14 * 86400000;
  for (const l of logs) {
    if (l.service !== service) continue;
    const t = new Date(l.created_at).getTime();
    if (t < cutoff) continue;
    const key = new Date(l.created_at).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + (l.cost_estimate ?? 0));
  }
  return Array.from(buckets.entries()).map(([day, spend]) => ({ day, spend }));
}

export function buildForecast(
  logs: UsageLog[],
  service: string,
  label: string,
  manualBudget: number | null,
): ServiceForecast {
  const now = Date.now();
  const cutoff7 = now - 7 * 86400000;
  const cutoff30 = now - 30 * 86400000;
  const cutoff90 = now - 90 * 86400000;

  let spend7 = 0;
  let spend30 = 0;
  let spend90 = 0;
  for (const l of logs) {
    if (l.service !== service) continue;
    const t = new Date(l.created_at).getTime();
    if (t >= cutoff90) spend90 += l.cost_estimate ?? 0;
    if (t >= cutoff30) spend30 += l.cost_estimate ?? 0;
    if (t >= cutoff7) spend7 += l.cost_estimate ?? 0;
  }

  const rate7d = spend7 / 7;
  const rate30d = spend30 / 30;
  const rate90d = spend90 / 90;
  const blendedRate = rate30d > 0 ? rate7d * 0.7 + rate30d * 0.3 : rate7d;
  const projected = blendedRate * 30;

  const trendPct = rate30d > 0 ? ((rate7d - rate30d) / rate30d) * 100 : rate7d > 0 ? 100 : 0;
  // Smarter auto-budget: max of 1.2× last-30d spend and 2× projected-from-90d-average,
  // so a single-week spike on a young service doesn't push the budget unrealistically low.
  const budget30Heuristic = spend30 * 1.2;
  const budget90Heuristic = rate90d * 30 * 2;
  const autoBudget = Math.max(1, budget30Heuristic, budget90Heuristic);
  const budget = manualBudget !== null && manualBudget > 0 ? manualBudget : autoBudget;
  const overBudgetPct = ((projected - budget) / budget) * 100;

  return {
    key: service,
    label,
    spend7d: spend7,
    spend30d: spend30,
    rate7d,
    rate30d,
    projected,
    trendPct,
    budget,
    autoBudget,
    budget30Heuristic,
    budget90Heuristic,
    manualBudget,
    overBudgetPct,
    daily14: buildDaily14(logs, service),
  };
}
