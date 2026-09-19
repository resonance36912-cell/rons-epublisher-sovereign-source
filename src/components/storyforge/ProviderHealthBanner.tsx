import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";
import {
  fetchFreeCloudStatus,
  getFreeCloudQualityEnabled,
  readyFreeCloudProviders,
  setFreeCloudQualityEnabled,
  type FreeCloudStatus,
} from "@/lib/free-cloud-quality";

/**
 * Surfaces a small inline banner when a high proportion of recent free-tier
 * image or TTS calls have failed — likely indicating Pollinations / HuggingFace
 * upstream degradation. Free-tier users depend on these providers, so a clear
 * signal prevents "the app is broken" support tickets.
 *
 * Reads from api_usage_logs (last 10 minutes). Admin-relaxed RLS lets users
 * see their own rows; this is a best-effort signal — silently no-ops on error.
 */
export function ProviderHealthBanner() {
  const [degraded, setDegraded] = useState<null | "image" | "tts" | "both">(null);
  const [freeCloudEnabled, setFreeCloudEnabled] = useState(() => getFreeCloudQualityEnabled());
  const [freeCloudStatus, setFreeCloudStatus] = useState<FreeCloudStatus | null>(null);

  useEffect(() => {
    if (!OPEN_NOVA_LOCAL_ONLY) return;
    let cancelled = false;
    const refresh = async () => {
      const status = await fetchFreeCloudStatus();
      if (!cancelled) setFreeCloudStatus(status);
    };
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (OPEN_NOVA_LOCAL_ONLY) return;
    let cancelled = false;

    async function check() {
      try {
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("api_usage_logs")
          .select("service, metadata")
          .gte("created_at", since)
          .limit(200);
        if (cancelled || !data?.length) return;

        const buckets = { image: { ok: 0, fail: 0 }, tts: { ok: 0, fail: 0 } };
        for (const row of data) {
          const meta = (row.metadata ?? {}) as Record<string, unknown>;
          const provider = String(meta.provider ?? "");
          const success = meta.success === true;
          const isFree =
            provider === "pollinations" || provider === "huggingface" || provider === "flux";
          if (!isFree) continue;
          const key = row.service === "elevenlabs-tts" ? "tts" : "image";
          if (success) buckets[key].ok++;
          else buckets[key].fail++;
        }

        const ratio = (b: { ok: number; fail: number }) => {
          const total = b.ok + b.fail;
          return total >= 5 && b.fail / total > 0.5;
        };
        const img = ratio(buckets.image);
        const tts = ratio(buckets.tts);
        setDegraded(img && tts ? "both" : img ? "image" : tts ? "tts" : null);
      } catch {
        /* non-fatal */
      }
    }

    check();
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (OPEN_NOVA_LOCAL_ONLY) {
    const readyCloud = readyFreeCloudProviders(freeCloudStatus);
    const providerLabel = readyCloud.length
      ? `${readyCloud.length} ready: ${readyCloud.map((provider) => provider.name).join(", ")}`
      : "No free-cloud provider key configured; RONS local fallback remains active";
    return (
      <div className="w-full bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
        <div className="container px-4 sm:px-6 py-1.5 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            {FREE_PROMOTION_ACTIVE ? "Free access promotion — no payment is required; public research and local models run through governed services." : "Sovereign local — billing/cloud auth remain bypassed; public research and local models run through governed services."}
          </span>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <Cloud className="w-3.5 h-3.5" />
            <span>Free-cloud quality boost</span>
            <Switch checked={freeCloudEnabled} onCheckedChange={(enabled) => {
              setFreeCloudEnabled(enabled);
              setFreeCloudQualityEnabled(enabled);
            }} aria-label="Free-cloud quality boost" className="scale-75" />
          </label>
          <span className="text-[10px] opacity-80">{providerLabel}</span>
        </div>
      </div>
    );
  }

  if (!degraded) return null;

  const label =
    degraded === "both" ? "Free-tier image & narration providers are degraded"
    : degraded === "image" ? "Free-tier image generation is degraded"
    : "Free-tier narration is degraded";

  return (
    <div className="w-full bg-amber-500/10 border-b border-amber-500/30 text-amber-700 dark:text-amber-300">
      <div className="container px-4 sm:px-6 py-1.5 flex items-center gap-2 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{label} — {FREE_PROMOTION_ACTIVE ? "enhanced-provider fallback remains included; local/open output may be slow or fail temporarily." : "Premium users are unaffected. Standard/Eco output may be slow or fail temporarily."}</span>
      </div>
    </div>
  );
}
