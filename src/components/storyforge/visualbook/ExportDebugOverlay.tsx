import { useState, useEffect, useRef, useCallback } from "react";
import { Bug, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  active: boolean;
  step: string;
  stage: string;
  current: number;
  total: number;
};

type LogEntry = { time: number; step: string; stage: string; heap?: number };
type HeapSample = { time: number; bytes: number };

const MAX_SAMPLES = 120; // 2 minutes at 1s intervals
const SPARKLINE_W = 260;
const SPARKLINE_H = 40;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function HeapSparkline({ samples, limit }: { samples: HeapSample[]; limit: number | null }) {
  if (samples.length < 2) return null;

  const maxVal = limit || Math.max(...samples.map((s) => s.bytes)) * 1.2;
  const minVal = 0;
  const range = maxVal - minVal || 1;

  const points = samples.map((s, i) => {
    const x = (i / (samples.length - 1)) * SPARKLINE_W;
    const y = SPARKLINE_H - ((s.bytes - minVal) / range) * SPARKLINE_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lastSample = samples[samples.length - 1];
  const pct = limit ? Math.round((lastSample.bytes / limit) * 100) : null;
  const strokeColor =
    pct && pct > 80
      ? "hsl(var(--destructive))"
      : pct && pct > 60
        ? "hsl(45 93% 47%)"
        : "hsl(var(--primary))";

  // Fill area under the line
  const fillPoints = `0,${SPARKLINE_H} ${points.join(" ")} ${SPARKLINE_W},${SPARKLINE_H}`;

  // Threshold lines at 60% and 80%
  const thresholds = limit
    ? [
        { pct: 60, color: "hsl(45 93% 47% / 0.25)" },
        { pct: 80, color: "hsl(var(--destructive) / 0.25)" },
      ]
    : [];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Heap Trend</span>
        <span>
          {formatBytes(lastSample.bytes)}
          {limit && ` / ${formatBytes(limit)}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
        className="w-full rounded bg-background/60 border border-border/30"
        style={{ height: SPARKLINE_H }}
        preserveAspectRatio="none"
      >
        {/* Threshold lines */}
        {thresholds.map((t) => {
          const y = SPARKLINE_H - (t.pct / 100) * SPARKLINE_H;
          return (
            <line
              key={t.pct}
              x1={0}
              y1={y}
              x2={SPARKLINE_W}
              y2={y}
              stroke={t.color}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          );
        })}
        {/* Fill */}
        <polygon points={fillPoints} fill={strokeColor} opacity={0.12} />
        {/* Line */}
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Current dot */}
        {(() => {
          const lastX = SPARKLINE_W;
          const lastY =
            SPARKLINE_H - ((lastSample.bytes - minVal) / range) * SPARKLINE_H;
          return <circle cx={lastX} cy={lastY} r={2.5} fill={strokeColor} />;
        })()}
      </svg>
      {/* Scale labels */}
      <div className="flex justify-between text-[9px] text-muted-foreground/50">
        <span>0</span>
        {limit && <span className="text-yellow-500/60">60%</span>}
        {limit && <span className="text-destructive/60">80%</span>}
        <span>{limit ? "100%" : formatBytes(maxVal)}</span>
      </div>
    </div>
  );
}

export function ExportDebugOverlay({ active, step, stage, current, total }: Props) {
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [heap, setHeap] = useState<number | null>(null);
  const [heapSamples, setHeapSamples] = useState<HeapSample[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef("");

  // Poll memory usage & collect sparkline samples
  useEffect(() => {
    if (!active || !visible) return;
    const id = setInterval(() => {
      const mem = (performance as any).memory;
      if (mem) {
        const bytes = mem.usedJSHeapSize;
        setHeap(bytes);
        setHeapSamples((prev) => [
          ...prev.slice(-(MAX_SAMPLES - 1)),
          { time: Date.now(), bytes },
        ]);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, visible]);

  // Log step changes
  useEffect(() => {
    if (!active || !step) return;
    const key = `${step}|${stage}`;
    if (key === lastStepRef.current) return;
    lastStepRef.current = key;
    const mem = (performance as any).memory;
    setLogs((prev) => [
      ...prev.slice(-100),
      { time: Date.now(), step, stage, heap: mem?.usedJSHeapSize },
    ]);
  }, [active, step, stage]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Show button when export starts, clear logs + samples
  useEffect(() => {
    if (active) {
      setVisible(true);
      setLogs([]);
      setHeapSamples([]);
      lastStepRef.current = "";
    }
  }, [active]);

  if (!visible) return null;

  const heapLimit: number | null = (performance as any).memory?.jsHeapSizeLimit ?? null;
  const heapPct = heap && heapLimit ? Math.round((heap / heapLimit) * 100) : null;
  const elapsed = logs.length > 0 ? ((Date.now() - logs[0].time) / 1000).toFixed(1) : "0";

  return (
    <div className="fixed bottom-4 right-4 z-[200] w-80 rounded-lg border border-border/60 bg-card/95 backdrop-blur-md shadow-xl text-xs font-mono animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-1.5 text-foreground font-semibold text-[11px]">
          <Bug className="w-3.5 h-3.5 text-primary" />
          Export Debug
          {active && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(!collapsed)} className="h-5 w-5 p-0 text-muted-foreground">
            {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setVisible(false)} className="h-5 w-5 p-0 text-muted-foreground">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-2">
          {/* Current state */}
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Step</span>
              <span className="text-foreground font-medium">{step || "idle"}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Progress</span>
              <span className="text-foreground">{current}/{total}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Elapsed</span>
              <span className="text-foreground">{elapsed}s</span>
            </div>
            {heap !== null && (
              <div className="flex justify-between text-muted-foreground">
                <span>JS Heap</span>
                <span className={`font-medium ${heapPct && heapPct > 80 ? "text-destructive" : heapPct && heapPct > 60 ? "text-yellow-500" : "text-foreground"}`}>
                  {formatBytes(heap)} {heapPct !== null && `(${heapPct}%)`}
                </span>
              </div>
            )}
          </div>

          {/* Heap sparkline */}
          <HeapSparkline samples={heapSamples} limit={heapLimit} />

          {/* Stage text */}
          {stage && (
            <div className="rounded bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground truncate">
              {stage}
            </div>
          )}

          {/* Log */}
          <div className="max-h-32 overflow-y-auto rounded bg-background/60 border border-border/30">
            {logs.length === 0 ? (
              <div className="px-2 py-3 text-center text-muted-foreground/60">Waiting for export…</div>
            ) : (
              logs.map((entry, i) => {
                const t = new Date(entry.time);
                const ts = `${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`;
                return (
                  <div key={i} className="flex gap-2 px-2 py-0.5 border-b border-border/20 last:border-0">
                    <span className="text-muted-foreground/60 shrink-0">{ts}</span>
                    <span className="text-primary shrink-0">{entry.step}</span>
                    {entry.heap && <span className="text-muted-foreground/50 ml-auto shrink-0">{formatBytes(entry.heap)}</span>}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
