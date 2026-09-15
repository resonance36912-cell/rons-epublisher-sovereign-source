import type { DailyPoint } from "./types";

export function Sparkline({ data, flagged }: { data: DailyPoint[]; flagged: boolean }) {
  const w = 220;
  const h = 36;
  const max = Math.max(0.001, ...data.map((d) => d.spend));
  const stepX = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = h - (d.spend / max) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = flagged ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  const areaPath = `M0,${h} L${points.join(" L")} L${w},${h} Z`;
  const linePath = `M${points.join(" L")}`;
  const total = data.reduce((s, d) => s + d.spend, 0);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-muted-foreground">Last 14 days · daily spend</span>
        <span className="text-[10px] text-muted-foreground">${total.toFixed(2)} total · max ${max.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" preserveAspectRatio="none" aria-hidden="true">
        <path d={areaPath} fill={stroke} fillOpacity={0.12} />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = i * stepX;
          const y = h - (d.spend / max) * (h - 4) - 2;
          return <circle key={d.day} cx={x} cy={y} r={d.spend > 0 ? 1.4 : 0.8} fill={stroke} opacity={d.spend > 0 ? 0.9 : 0.4}><title>{`${d.day}: $${d.spend.toFixed(3)}`}</title></circle>;
        })}
      </svg>
    </div>
  );
}
