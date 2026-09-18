import { supabase } from "@/integrations/supabase/client";
import { AI_INPUT_LIMITS, assertMaxLength } from "@/lib/ai-input-limits";
import { friendlyTooLargeFromResponseStatus } from "@/lib/edge-error";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { getTtsMode } from "@/lib/cost-mode";

export type NarrationRequest = {
  text: string;
  voiceId: string;
  language?: string;
  speed?: number;
  demeanour?: string;
};

export type TtsFallbackPayload = {
  error?: string;
  fallback?: boolean;
  message?: string;
  provider?: "browser";
  status?: number;
  code?: string;
};

export type TtsAudioResult =
  | { kind: "audio"; blob: Blob; provider?: string; freeTier?: boolean; correlationId?: string }
  | { kind: "fallback"; payload: TtsFallbackPayload };

let _freeTierTtsToastShown = false;
let _ecoLimitationsToastShown = false;

type PlaybackProvider = "elevenlabs" | "browser";

const PLAYBACK_PROVIDER_KEY = "storyforge-playback-provider";

function readPlaybackProvider(): PlaybackProvider {
  if (typeof window === "undefined") return "elevenlabs";
  const stored = window.sessionStorage.getItem(PLAYBACK_PROVIDER_KEY);
  return stored === "browser" ? "browser" : "elevenlabs";
}

function extractErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (typeof payload === "string" && payload.trim()) {
    if (payload.includes("quota_exceeded") || payload.includes("credits remaining")) {
      return "ElevenLabs narration credits are exhausted. Top up ElevenLabs or switch to browser narration.";
    }
    return payload;
  }

  if (payload && typeof payload === "object") {
    const error = "error" in payload ? payload.error : undefined;
    const message = "message" in payload ? payload.message : undefined;
    const code = "code" in payload ? payload.code : undefined;

    if (code === "quota_exceeded") {
      return typeof message === "string" && message.trim()
        ? message
        : "ElevenLabs narration credits are exhausted. Top up ElevenLabs or switch to browser narration.";
    }

    if (typeof message === "string" && message.trim()) return message;
    if (typeof error === "string" && error.trim()) {
      if (error.includes("quota_exceeded") || error.includes("credits remaining")) {
        return "ElevenLabs narration credits are exhausted. Top up ElevenLabs or switch to browser narration.";
      }
      return error;
    }
  }

  return fallbackMessage;
}

export function getPreferredPlaybackProvider(): PlaybackProvider {
  return readPlaybackProvider();
}

export function setPreferredPlaybackProvider(provider: PlaybackProvider) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PLAYBACK_PROVIDER_KEY, provider);
}

export function canUseBrowserNarration(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function stopBrowserNarration() {
  if (!canUseBrowserNarration()) return;
  window.speechSynthesis.cancel();
}

export function isNarrationAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function speakWithBrowserNarration(
  text: string,
  options: { language?: string; speed?: number; onBoundary?: (charIndex: number) => void } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!canUseBrowserNarration()) {
      reject(new Error("Browser narration is not supported in this browser"));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const langMap: Record<string, string> = { af: "af-ZA", zu: "zu-ZA", xh: "xh-ZA", st: "st-ZA" };
    utterance.lang = langMap[options.language || ""] || "en-US";
    utterance.rate = Math.max(0.7, Math.min(1.2, options.speed ?? 1));

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    if (options.onBoundary) {
      utterance.onboundary = (event) => {
        if (event.name === "word") {
          options.onBoundary!(event.charIndex);
        }
      };
    }

    utterance.onend = () => finish(resolve);
    utterance.onerror = (event) => {
      const code = "error" in event ? event.error : undefined;
      if (code === "canceled" || code === "interrupted") {
        finish(() => reject(new DOMException("Narration cancelled", "AbortError")));
        return;
      }

      finish(() => reject(new Error(code || "Browser narration failed")));
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

// Reuse auth token across rapid successive calls (e.g. batch narration)
let _ttsAuthToken: string | null = null;
let _ttsAuthExpiry = 0;

async function getTtsAuthToken(): Promise<string> {
  if (_ttsAuthToken && Date.now() < _ttsAuthExpiry) return _ttsAuthToken;
  const { data: { session } } = await supabase.auth.getSession();
  _ttsAuthToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  _ttsAuthExpiry = Date.now() + 5 * 60 * 1000;
  return _ttsAuthToken;
}

export async function requestNarrationAudio(request: NarrationRequest): Promise<TtsAudioResult> {
  assertMaxLength("narration text", request.text, AI_INPUT_LIMITS.ttsText);
  if (OPEN_NOVA_LOCAL_ONLY) {
    return {
      kind: "fallback",
      payload: {
        fallback: true,
        provider: "browser",
        message: "Sovereign local mode uses the browser speech engine; cloud TTS is disabled.",
      },
    };
  }
  const token = await getTtsAuthToken();
  const ttsMode = getTtsMode();

  // Premium mode: gate against profitability — confirm overage charge if the
  // user has blown through both their daily quota and any add-on credits.
  if (ttsMode === "premium") {
    const { ensurePremiumQuota } = await import("./premium-quota-gate");
    const ok = await ensurePremiumQuota("elevenlabs-tts", { estimatedUnits: request.text.length });
    if (!ok) {
      return { kind: "fallback", payload: { fallback: true, message: "Premium narration cancelled — quota exceeded and overage charge not authorized.", provider: "browser" } };
    }
  }

  // Client-generated correlation ID — round-trips so the chapter card can show
  // "this audio was logged in api_usage_logs row with correlation_id = X".
  const correlationId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: request.text,
        voiceId: request.voiceId,
        language: request.language,
        speed: request.speed,
        demeanour: request.demeanour,
        mode: ttsMode,
        correlationId,
      }),
    }
  );

  const contentType = response.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({ error: `TTS failed (${response.status})` })) as TtsFallbackPayload;

    if (payload.fallback) {
      return { kind: "fallback", payload };
    }

    if (!response.ok) {
      const tooLarge = friendlyTooLargeFromResponseStatus(response.status, payload);
      throw new Error(tooLarge || extractErrorMessage(payload, `TTS failed (${response.status})`));
    }

    throw new Error(extractErrorMessage(payload, "Narration service returned an unexpected response"));
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    const tooLarge = friendlyTooLargeFromResponseStatus(response.status, rawText ? { error: rawText } : undefined);
    throw new Error(tooLarge || extractErrorMessage(rawText, `TTS failed (${response.status})`));
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("audio/")) {
    throw new Error("Narration service returned invalid audio");
  }

  const provider = response.headers.get("X-Tts-Provider") || "elevenlabs";
  const freeTier = response.headers.get("X-Tts-Free-Tier") === "1";
  const autoEco = response.headers.get("X-Auto-Eco") === "1";
  const ecoLimitations = (response.headers.get("X-Eco-Limitations") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const serverCorrelationId = response.headers.get("X-Correlation-Id") || correlationId;

  // Broadcast auto-eco activation so the VisualBook banner can surface why quality dropped.
  if (autoEco && freeTier && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auto-eco-active", { detail: { service: "tts", provider } }));
  }

  // One-shot toast when Eco mode silently dropped voice/speed/demeanour controls.
  if (freeTier && ecoLimitations.length > 0 && !_ecoLimitationsToastShown) {
    _ecoLimitationsToastShown = true;
    try {
      const { toast } = await import("sonner");
      const labelMap: Record<string, string> = {
        voice: "voice (free provider uses a generic voice)",
        "voice-approx": "voice (matched to closest free equivalent)",
        speed: "playback speed",
        demeanour: "demeanour",
      };
      const items = ecoLimitations.map((k) => labelMap[k] || k).join(", ");
      toast.info("Some narration controls were skipped", {
        description: `Eco mode doesn't support: ${items}. Switch to Premium to use them.`,
        duration: 8000,
      });
    } catch { /* ignore */ }
  }

  // Notify widgets that premium narration succeeded — add-on TTS credits
  // may have been deducted server-side. Skip when free-tier (no credits used).
  if (!freeTier) {
    try {
      const { notifyAddonCreditsChanged } = await import("./addon-credits-events");
      notifyAddonCreditsChanged({ type: "tts" });
    } catch { /* ignore */ }
  }

  // Plan-credit refresh: the server tells us how many monthly plan credits
  // were debited (only when the user was over daily quota). Fire the event
  // so PlanCreditsBadge / CreditUsageHistory refresh in real time.
  const planConsumed = parseInt(response.headers.get("X-Plan-Credits-Consumed") || "0", 10);
  const planRemainingHeader = response.headers.get("X-Plan-Credits-Remaining");
  if (planConsumed > 0) {
    try {
      const { notifyPlanCreditsChanged } = await import("./plan-credits-events");
      notifyPlanCreditsChanged({
        consumed: planConsumed,
        remaining: planRemainingHeader ? Number(planRemainingHeader) : undefined,
      });
    } catch { /* ignore */ }
  }

  // Free-tier transparency: one-shot toast nudging upgrade.
  if (freeTier && !_freeTierTtsToastShown) {
    _freeTierTtsToastShown = true;
    try {
      const { toast } = await import("sonner");
      toast.info("Narration generated with free tier", {
        description: "This audio was created with a free provider. Upgrade for premium ElevenLabs voices.",
        duration: 7000,
        action: { label: "Upgrade", onClick: () => { window.location.href = "/pricing"; } },
      });
    } catch { /* ignore */ }
  }

  return { kind: "audio", blob, provider, freeTier, correlationId: serverCorrelationId };
}