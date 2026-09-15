import { supabase } from "@/integrations/supabase/client";
import type { UserTier } from "@/hooks/useUserTier";

export const DEFAULT_TTS_DAILY_LIMIT = 100;
export const DEFAULT_IMAGE_DAILY_LIMIT = 50;

export type QuotaPeriod = "daily" | "lifetime" | "blocked";

export type QuotaStatus = {
  allowed: boolean;
  used: number;
  limit: number;
  period: QuotaPeriod;
  tier: UserTier;
};

export type UsageLimitMap = {
  image: number;
  tts: number;
};

export type TierPreset = {
  tier: UserTier;
  service: string;
  daily_limit: number;
  quota_period?: QuotaPeriod;
};

const SERVICES = {
  tts: "elevenlabs-tts",
  image: "generate-chapter-image",
} as const;

/** Unified quota check via the new tier-aware RPC. */
export async function getQuotaStatus(
  service: "elevenlabs-tts" | "generate-chapter-image"
): Promise<QuotaStatus | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("check_user_quota", {
    _user_id: user.id,
    _service: service,
  });

  if (error || !data || typeof data !== "object") return null;
  const q = data as Record<string, unknown>;
  return {
    allowed: !!q.allowed,
    used: Number(q.used ?? 0),
    limit: Number(q.limit ?? 0),
    period: (q.period as QuotaPeriod) || "daily",
    tier: (q.tier as UserTier) || "free",
  };
}

export async function getQuotaStatuses(): Promise<{ tts: QuotaStatus | null; image: QuotaStatus | null }> {
  const [tts, image] = await Promise.all([
    getQuotaStatus(SERVICES.tts),
    getQuotaStatus(SERVICES.image),
  ]);
  return { tts, image };
}

/** Legacy: get just the limit number for the current user. Kept for back-compat. */
async function fetchUserDailyLimit(service: string, fallback: number): Promise<number> {
  const status = await getQuotaStatus(service as "elevenlabs-tts" | "generate-chapter-image");
  if (!status) return fallback;
  return status.limit;
}

export async function getUsageLimits(): Promise<UsageLimitMap> {
  const [tts, image] = await Promise.all([
    fetchUserDailyLimit(SERVICES.tts, DEFAULT_TTS_DAILY_LIMIT),
    fetchUserDailyLimit(SERVICES.image, DEFAULT_IMAGE_DAILY_LIMIT),
  ]);
  return { tts, image };
}

export async function getUsageLimit(service: "elevenlabs-tts" | "generate-chapter-image"): Promise<number> {
  const fallback = service === "elevenlabs-tts" ? DEFAULT_TTS_DAILY_LIMIT : DEFAULT_IMAGE_DAILY_LIMIT;
  return fetchUserDailyLimit(service, fallback);
}

/** Fetch all tier quota presets (admin only). */
export async function getTierQuotaPresets(): Promise<TierPreset[]> {
  const { data, error } = await supabase
    .from("tier_quota_presets")
    .select("tier,service,daily_limit,quota_period")
    .order("tier")
    .order("service");

  if (error || !data) return [];
  return data as TierPreset[];
}

/** Save a single tier quota preset (admin only, upserts). */
export async function saveTierQuotaPreset(
  tier: string,
  service: string,
  daily_limit: number,
  quota_period: QuotaPeriod = "daily"
) {
  const { error } = await supabase
    .from("tier_quota_presets")
    .upsert({ tier, service, daily_limit, quota_period }, { onConflict: "tier,service" });
  if (error) throw error;
}
