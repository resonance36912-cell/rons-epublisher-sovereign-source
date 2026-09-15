// Premium over-quota consent gate.
//
// When the user explicitly selects Premium TTS/Image mode, we must protect the
// platform's profitability: if their daily quota is exhausted AND they have no
// addon credits, we surface a consent dialog explaining the per-unit overage
// charge before allowing the request to proceed. Consent is cached per-day per
// service in sessionStorage so each request doesn't re-prompt.
import { getQuotaStatus } from "@/lib/usage-limits";
import { supabase } from "@/integrations/supabase/client";

export type PremiumService = "elevenlabs-tts" | "generate-chapter-image";

// Per-unit overage costs surfaced to the user (USD, billed in ZAR via add-on credits).
// Keep in sync with API Usage Tracking memory: TTS $0.0003/char, Image $0.04/img.
export const PREMIUM_OVERAGE_COST = {
  "elevenlabs-tts":      { perUnit: 0.0003, unit: "character", label: "ElevenLabs narration" },
  "generate-chapter-image": { perUnit: 0.04,   unit: "image",     label: "Gemini image" },
} as const;

// Plan-credit cost per premium call. MUST match the edge-function values in
// supabase/functions/_shared/credits.ts. TTS is character-priced (1 credit
// per 100 chars, min 1) so platform margin stays positive on long narrations;
// images are a flat 3 credits per call.
export const PLAN_CREDIT_TTS_CHARS_PER_CREDIT = 100;
export const PLAN_CREDIT_COST_PER_IMAGE = 3;
export function computePlanCreditCost(
  service: PremiumService,
  estimatedUnits?: number,
): number {
  if (service === "generate-chapter-image") return PLAN_CREDIT_COST_PER_IMAGE;
  const chars = Number(estimatedUnits ?? 0);
  if (!Number.isFinite(chars) || chars <= 0) return 1;
  return Math.max(1, Math.ceil(chars / PLAN_CREDIT_TTS_CHARS_PER_CREDIT));
}

export type OverQuotaConsentRequest = {
  service: PremiumService;
  used: number;
  limit: number;
  addonRemaining: number;
  planCreditsRemaining: number;
  planCreditCost: number;
  perUnitCost: number;
  unit: string;
  label: string;
  estimatedUnits?: number;
  resolve: (consent: boolean) => void;
};

const CONSENT_EVENT = "premium-overquota-consent-request";

function consentKey(service: PremiumService): string {
  const day = new Date().toISOString().slice(0, 10);
  return `premium-overquota-consent:${service}:${day}`;
}

function hasCachedConsent(service: PremiumService): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(consentKey(service)) === "1";
}

function rememberConsent(service: PremiumService) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(consentKey(service), "1");
}

/**
 * Gate a premium-mode call. Resolves true if the request may proceed
 * (within quota, has addon credits, or user authorized overage), false if
 * the user declined. Never throws — failing open on RPC errors keeps the
 * user unblocked when our check itself misbehaves.
 */
export async function ensurePremiumQuota(
  service: PremiumService,
  options: { estimatedUnits?: number } = {},
): Promise<boolean> {
  // Anonymous calls bypass — they'll be denied server-side anyway.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return true;

  const status = await getQuotaStatus(service);
  if (!status) return true; // fail open

  // Pull addon_remaining (not in QuotaStatus type yet, but RPC returns it).
  const { data: raw } = await supabase.rpc("check_user_quota", {
    _user_id: user.id,
    _service: service,
  });
  const addonRemaining = Number((raw as Record<string, unknown> | null)?.addon_remaining ?? 0);

  // Within daily limit, or covered by addon credits → no prompt needed.
  if (status.used < status.limit || addonRemaining > 0) return true;

  // Quota exhausted + no addon credits — see if plan credits cover the call.
  // The edge function will auto-debit via tryConsumeOnQuotaBlock.
  const planCost = computePlanCreditCost(service, options.estimatedUnits);
  let planCreditsRemaining = 0;
  try {
    const { data: planRaw } = await supabase.rpc("get_credits_remaining", { _user_id: user.id });
    planCreditsRemaining = Number(planRaw ?? 0);
  } catch { /* fail open below */ }
  if (planCreditsRemaining >= planCost) return true;

  // Already consented today for this service.
  if (hasCachedConsent(service)) return true;

  // Surface dialog and await user decision.
  const cost = PREMIUM_OVERAGE_COST[service];
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") { resolve(false); return; }
    const payload: OverQuotaConsentRequest = {
      service,
      used: status.used,
      limit: status.limit,
      addonRemaining,
      planCreditsRemaining,
      planCreditCost: planCost,
      perUnitCost: cost.perUnit,
      unit: cost.unit,
      label: cost.label,
      estimatedUnits: options.estimatedUnits,
      resolve: (consent) => {
        if (consent) rememberConsent(service);
        resolve(consent);
      },
    };
    window.dispatchEvent(new CustomEvent<OverQuotaConsentRequest>(CONSENT_EVENT, { detail: payload }));
  });
}

export function subscribePremiumOverQuotaRequests(
  cb: (req: OverQuotaConsentRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<OverQuotaConsentRequest>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener(CONSENT_EVENT, handler as EventListener);
  return () => window.removeEventListener(CONSENT_EVENT, handler as EventListener);
}
