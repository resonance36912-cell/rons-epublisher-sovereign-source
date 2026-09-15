import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Image as ImageIcon, Mic, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PLAN_CREDITS_CHANGED } from "@/lib/plan-credits-events";

type UsageRow = {
  id: string;
  service: string;
  created_at: string;
  tokens_or_chars: number | null;
  metadata: Record<string, any> | null;
};

// Plan-credit cost per generation when free/tier quota is exhausted.
// Mirrors the values used in supabase/functions/_shared/credits.ts callers:
//   elevenlabs-tts        → 5 credits
//   generate-chapter-image → 3 credits
const CREDIT_COST: Record<string, number> = {
  "elevenlabs-tts": 5,
  "generate-chapter-image": 3,
};

const SERVICE_LABEL: Record<string, string> = {
  "elevenlabs-tts": "Narration",
  "generate-chapter-image": "Chapter image",
};

function ServiceIcon({ service }: { service: string }) {
  if (service === "generate-chapter-image") return <ImageIcon className="w-4 h-4 text-muted-foreground" />;
  if (service === "elevenlabs-tts") return <Mic className="w-4 h-4 text-muted-foreground" />;
  return <Coins className="w-4 h-4 text-muted-foreground" />;
}

function relativeTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CreditUsageHistory() {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRows([]); return; }
    const { data, error: err } = await supabase
      .from("api_usage_logs")
      .select("id, service, created_at, tokens_or_chars, metadata")
      .eq("user_id", user.id)
      .in("service", ["elevenlabs-tts", "generate-chapter-image"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (err) { setError(err.message); setRows([]); return; }
    setRows((data ?? []) as UsageRow[]);
  }

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(PLAN_CREDITS_CHANGED, handler);
    return () => window.removeEventListener(PLAN_CREDITS_CHANGED, handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading recent activity…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Couldn't load usage history: {error}</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recent generations yet. Once you create narration or chapter images,
        they'll appear here with the plan credits each one used.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-md border border-border bg-muted/20">
        {rows.map((r) => {
          const meta = r.metadata ?? {};
          const success = meta.success !== false;
          const cacheHit = !!meta.cacheHit;
          const freeTier = !!meta.freeTier;
          const cost = CREDIT_COST[r.service] ?? 0;
          // Plan credits are only consumed when the free tier quota was
          // exhausted and the request didn't come from cache or eco fallback.
          const chargedFromPlan = success && !cacheHit && !freeTier && cost > 0;
          const label = SERVICE_LABEL[r.service] ?? r.service;
          const chars = r.service === "elevenlabs-tts" && r.tokens_or_chars
            ? `${r.tokens_or_chars.toLocaleString()} chars`
            : null;

          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <ServiceIcon service={r.service} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{label}</div>
                  <div className="text-xs text-muted-foreground">
                    {relativeTime(r.created_at)}
                    {chars ? ` · ${chars}` : ""}
                    {cacheHit ? " · cached" : ""}
                    {freeTier ? " · free tier" : ""}
                    {!success ? " · failed" : ""}
                  </div>
                </div>
              </div>
              <Badge
                variant={chargedFromPlan ? "default" : "outline"}
                className="shrink-0 gap-1"
                title={chargedFromPlan
                  ? `${cost} plan credits consumed`
                  : "No plan credits used (covered by free tier, cache, or quota)"}
              >
                <Coins className="w-3 h-3" />
                {chargedFromPlan ? `-${cost}` : "0"}
              </Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Plan credits are only deducted when your daily tier quota is exhausted.
        Cached results, eco/free-tier fallbacks, and failed requests don't cost credits.
      </p>
    </div>
  );
}
