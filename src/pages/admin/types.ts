import type { TierPreset } from "@/lib/usage-limits";
import type { UserTier } from "@/hooks/useUserTier";
import { Crown, Star, Sparkles } from "lucide-react";

export type Profile = { id: string; user_id: string; email: string | null; full_name: string | null; created_at: string };
export type Job = { id: string; topic: string; status: string; progress: number; created_at: string };
export type BetaSignup = { id: string; email: string; created_at: string };
export type StorageFile = { name: string; path: string; size: number; created_at: string };

export type PayfastPayment = {
  id: string;
  user_id: string;
  stripe_session_id: string;
  stripe_customer_id: string;
  product_id: string;
  price_id: string;
  amount_total: number;
  currency: string;
  environment: string;
  created_at: string | null;
};

export type ElevenLabsUsage = {
  configured: boolean;
  error?: string;
  tier?: string;
  characterCount?: number;
  characterLimit?: number;
  characterUsagePercent?: number;
  voiceCount?: number;
  voiceLimit?: number;
  status?: string;
  nextCharacterCountResetUnix?: number;
  nextInvoiceAmount?: number | null;
  currency?: string;
  userName?: string | null;
};

export type ServiceStatus = {
  configured: boolean;
  error?: string;
  note?: string;
};

export type ApiUsageData = {
  elevenlabs: ElevenLabsUsage;
  tavily: ServiceStatus;
  firecrawl: ServiceStatus;
  timestamp: string;
};

export type QuotaSettings = {
  image: number;
  tts: number;
};

export type UsageLog = {
  id: string;
  service: string;
  tokens_or_chars: number;
  duration_ms: number;
  cost_estimate: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
};

export type { TierPreset };

export const TIER_ORDER: UserTier[] = ["free", "standard", "premium"];

export const TIER_META: Record<UserTier, { label: string; icon: typeof Sparkles; color: string }> = {
  free: { label: "Free", icon: Sparkles, color: "text-muted-foreground" },
  standard: { label: "Standard", icon: Star, color: "text-yellow-500" },
  premium: { label: "Premium", icon: Crown, color: "text-amber-500" },
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
