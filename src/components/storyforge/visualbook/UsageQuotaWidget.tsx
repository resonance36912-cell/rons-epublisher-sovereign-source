import { useEffect, useState, useMemo, useRef } from "react";
import { Mic, ImageIcon, RefreshCw, Clock, Crown, Infinity as InfinityIcon, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getQuotaStatuses, type QuotaStatus, type QuotaPeriod } from "@/lib/usage-limits";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";

type Quotas = {
  tts: QuotaStatus | null;
  image: QuotaStatus | null;
  loading: boolean;
};

const tierLabels: Record<string, string> = {
  free: "Free",
  standard: "Standard",
  premium: "Premium",
};

function getResetTime() {
  const now = new Date();
  const resetUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const diffMs = resetUtc.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  const localReset = resetUtc.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { hours, minutes, localReset };
}

function formatNumber(n: number) {
  return n.toLocaleString();
}

export function UsageQuotaWidget() {
  const [quotas, setQuotas] = useState<Quotas>({ tts: null, image: null, loading: true });
  const [now, setNow] = useState(Date.now());
  const warnedRef = useRef<{ tts: boolean; image: boolean }>({ tts: false, image: false });

  const fetchUsage = async () => {
    setQuotas((q) => ({ ...q, loading: true }));
    try {
      const { tts, image } = await getQuotaStatuses();
      setQuotas({ tts, image, loading: false });
    } catch {
      setQuotas((q) => ({ ...q, loading: false }));
    }
  };

  useEffect(() => { fetchUsage(); }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const reset = useMemo(() => getResetTime(), [Math.floor(now / 60_000)]);

  const ttsPercent = quotas.tts && quotas.tts.limit > 0 ? (quotas.tts.used / quotas.tts.limit) * 100 : 0;
  const imagePercent = quotas.image && quotas.image.limit > 0 ? (quotas.image.used / quotas.image.limit) * 100 : 0;

  // Pick the tier badge from whichever quota returned (they share the same tier)
  const tier = quotas.image?.tier || quotas.tts?.tier || "free";

  // Are any quotas daily? (drives whether to show the "Resets in…" timer)
  const hasDaily = quotas.tts?.period === "daily" || quotas.image?.period === "daily";

  // Warn once per session when usage hits 80% or 100%
  useEffect(() => {
    if (quotas.loading) return;
    const tts = quotas.tts;
    const image = quotas.image;

    if (tts && tts.period !== "blocked") {
      if (ttsPercent >= 100 && !warnedRef.current.tts) {
        warnedRef.current.tts = true;
        const desc = tts.period === "lifetime"
          ? `You've used all ${formatNumber(tts.limit)} narration characters. Upgrade to Premium for daily resets.`
          : `You've used all ${formatNumber(tts.limit)} TTS calls today. Resets at ${reset.localReset}.`;
        toast.error("Premium narration quota reached", { description: desc });
      } else if (ttsPercent >= 80 && !warnedRef.current.tts) {
        warnedRef.current.tts = true;
        toast.warning("Narration quota almost full", {
          description: `${formatNumber(tts.used)}/${formatNumber(tts.limit)} (${Math.round(ttsPercent)}%) used.`,
        });
      }
    }

    if (image && image.period !== "blocked") {
      if (imagePercent >= 100 && !warnedRef.current.image) {
        warnedRef.current.image = true;
        const desc = image.period === "lifetime"
          ? `You've used all ${image.limit} lifetime images. Upgrade to Premium for daily resets.`
          : `You've used all ${image.limit} image generations today. Resets at ${reset.localReset}.`;
        toast.error("Image quota reached", { description: desc });
      } else if (imagePercent >= 80 && !warnedRef.current.image) {
        warnedRef.current.image = true;
        toast.warning("Image quota almost full", {
          description: `${image.used}/${image.limit} (${Math.round(imagePercent)}%) used.`,
        });
      }
    }
  }, [quotas.loading, ttsPercent, imagePercent]);

  const barColor = (pct: number) =>
    pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-primary";

  function periodLabel(period: QuotaPeriod | undefined): string {
    if (period === "daily") return "Daily";
    if (period === "lifetime") return "Lifetime";
    return "Quota";
  }

  function renderQuotaBar(q: QuotaStatus | null, percent: number, Icon: typeof Mic, label: string) {
    if (!q || quotas.loading) {
      return (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden" />
          </div>
          <span className="tabular-nums text-muted-foreground shrink-0">…</span>
        </div>
      );
    }

    if (q.period === "blocked") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/pricing"
              className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity"
            >
              <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground truncate flex-1">{label}: locked</span>
              <span className="tabular-nums text-primary text-[10px] font-medium shrink-0">Upgrade →</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">{label} not available</p>
            <p>{tier === "free"
              ? "Upgrade to Standard or Premium to unlock."
              : "Upgrade to Premium to unlock."}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    const remaining = Math.max(0, q.limit - q.used);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor(percent)}`}
                  style={{ width: `${Math.min(percent, 100)}%` }}
                />
              </div>
            </div>
            <span className="tabular-nums text-muted-foreground shrink-0 flex items-center gap-1">
              {q.period === "lifetime" && <InfinityIcon className="w-3 h-3" />}
              {formatNumber(q.used)}/{formatNumber(q.limit)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-medium">{label} ({periodLabel(q.period)})</p>
          <p>{formatNumber(q.used)} used of {formatNumber(q.limit)}</p>
          <p>{formatNumber(remaining)} remaining</p>
          {q.period === "lifetime" && (
            <p className="text-[10px] text-muted-foreground mt-1">Upgrade to Premium for daily resets.</p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 bg-muted/30 border rounded-lg px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">
            {hasDaily ? "Quota" : "Usage"}
          </span>
          {!quotas.loading && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 font-medium">
              {tier !== "free" && <Crown className="w-2.5 h-2.5 text-yellow-500" />}
              {tierLabels[tier] || tier}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {hasDaily ? (
            <>
              <Clock className="w-3 h-3" />
              <span className="tabular-nums">
                Resets in {reset.hours}h {reset.minutes}m
              </span>
              <span className="text-muted-foreground/60">({reset.localReset})</span>
            </>
          ) : (
            <span className="text-[10px]">Lifetime allowance — no daily reset</span>
          )}
          <button
            onClick={fetchUsage}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh quota"
          >
            <RefreshCw className={`w-3 h-3 ${quotas.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
        {renderQuotaBar(quotas.tts, ttsPercent, Mic, "Premium narration")}
        <div className="hidden sm:block w-px h-4 bg-border" />
        {renderQuotaBar(quotas.image, imagePercent, ImageIcon, "Image generation")}
      </div>
    </div>
  );
}
