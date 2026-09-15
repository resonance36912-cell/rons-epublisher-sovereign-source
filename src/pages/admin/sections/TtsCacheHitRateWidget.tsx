import { useMemo } from "react";
import { Database, TrendingDown } from "lucide-react";
import type { UsageLog } from "../types";

// Same per-character price used by the elevenlabs-tts edge function (Flash v2.5).
const TTS_COST_PER_CHAR = 0.0001;

type Props = {
  usageLogs: UsageLog[];
};

type Window = "24h" | "7d" | "30d";

function withinWindow(iso: string, window: Window): boolean {
  const ms = Date.now() - new Date(iso).getTime();
  switch (window) {
    case "24h": return ms <= 86_400_000;
    case "7d":  return ms <= 7 * 86_400_000;
    case "30d": return ms <= 30 * 86_400_000;
  }
}

function computeStats(logs: UsageLog[], window: Window) {
  let cacheHits = 0;
  let freshElevenLabs = 0;
  let freeTier = 0;
  let charsServedFromCache = 0;
  let charsBilledFresh = 0;

  for (const log of logs) {
    if (log.service !== "elevenlabs-tts") continue;
    if (!withinWindow(log.created_at, window)) continue;

    const md = (log.metadata ?? {}) as Record<string, unknown>;
    if (md.success === false) continue;

    const provider = String(md.provider ?? "");
    const cacheHit = md.cacheHit === true || provider === "cache";
    const isFreeTier = md.freeTier === true && !cacheHit;
    const chars = log.tokens_or_chars || 0;

    if (cacheHit) {
      cacheHits++;
      charsServedFromCache += chars;
    } else if (isFreeTier) {
      freeTier++;
    } else {
      freshElevenLabs++;
      charsBilledFresh += chars;
    }
  }

  const totalRequests = cacheHits + freshElevenLabs + freeTier;
  const cacheableTotal = cacheHits + freshElevenLabs; // free-tier doesn't count against ElevenLabs spend
  const hitRate = cacheableTotal > 0 ? (cacheHits / cacheableTotal) * 100 : 0;
  const saved = charsServedFromCache * TTS_COST_PER_CHAR;
  const wouldveSpent = (charsServedFromCache + charsBilledFresh) * TTS_COST_PER_CHAR;
  const savedPercent = wouldveSpent > 0 ? (saved / wouldveSpent) * 100 : 0;

  return {
    totalRequests, cacheHits, freshElevenLabs, freeTier,
    charsServedFromCache, charsBilledFresh,
    hitRate, saved, wouldveSpent, savedPercent,
  };
}

export function TtsCacheHitRateWidget({ usageLogs }: Props) {
  const w24 = useMemo(() => computeStats(usageLogs, "24h"), [usageLogs]);
  const w7  = useMemo(() => computeStats(usageLogs, "7d"),  [usageLogs]);
  const w30 = useMemo(() => computeStats(usageLogs, "30d"), [usageLogs]);

  const empty = w30.totalRequests === 0;

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center gap-2">
        <Database className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">TTS Cache Hit Rate</h2>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Server-side mp3 cache (chapter-images/tts-cache)
        </span>
      </div>

      {empty ? (
        <div className="text-center text-muted-foreground py-12">
          <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No TTS calls in the last 30 days</p>
          <p className="text-xs mt-1">Cache stats will appear after narration is generated.</p>
        </div>
      ) : (
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              { label: "Last 24h", data: w24 },
              { label: "Last 7 Days", data: w7 },
              { label: "Last 30 Days", data: w30 },
            ] as const).map(({ label, data }) => (
              <div key={label} className="bg-muted/20 border rounded-lg p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {data.totalRequests} req
                  </span>
                </div>

                {/* Hit-rate ring/bar */}
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-2xl font-bold tabular-nums">
                      {data.hitRate.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">hit rate</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, data.hitRate)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="bg-card border rounded px-1.5 py-1.5">
                    <p className="text-sm font-bold text-primary tabular-nums">{data.cacheHits}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Hits</p>
                  </div>
                  <div className="bg-card border rounded px-1.5 py-1.5">
                    <p className="text-sm font-bold tabular-nums">{data.freshElevenLabs}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Fresh</p>
                  </div>
                  <div className="bg-card border rounded px-1.5 py-1.5">
                    <p className="text-sm font-bold text-accent tabular-nums">{data.freeTier}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Free</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
                  <TrendingDown className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    ${data.saved.toFixed(4)} saved
                  </span>
                  {data.wouldveSpent > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                      of ${data.wouldveSpent.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Cache hits return identical audio for the same text + voice + speed + demeanour combo, billed at $0.
            Savings = (cached chars × $0.0001/char) — the ElevenLabs Flash v2.5 rate. Free-tier requests
            (Pollinations / FLUX) are excluded from the hit-rate denominator since they never cost anything.
          </p>
        </div>
      )}
    </div>
  );
}
