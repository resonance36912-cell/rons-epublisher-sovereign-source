// User-facing cost-saving mode preferences. Persisted to localStorage so the
// preference survives reloads. The edge functions (`elevenlabs-tts` and
// `generate-chapter-image`) accept a `mode` body param and route accordingly:
//
//   TTS modes:    "auto" (default — auto-eco at 80% budget) | "eco" (always free) | "premium" (force ElevenLabs)
//   Image modes:  "auto" (default — auto-eco at 80% budget) | "draft" (always Pollinations) | "premium" (force Gemini)

export type TtsMode = "auto" | "eco" | "premium";
export type ImageMode = "auto" | "draft" | "premium";

const TTS_KEY = "resonance_tts_mode";
const IMAGE_KEY = "resonance_image_mode";

export function getTtsMode(): TtsMode {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem(TTS_KEY);
  return v === "eco" || v === "premium" ? v : "auto";
}

export function setTtsMode(mode: TtsMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TTS_KEY, mode);
  window.dispatchEvent(new CustomEvent("cost-mode-changed", { detail: { tts: mode } }));
}

export function getImageMode(): ImageMode {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem(IMAGE_KEY);
  return v === "draft" || v === "premium" ? v : "auto";
}

export function setImageMode(mode: ImageMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IMAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent("cost-mode-changed", { detail: { image: mode } }));
}

export const TTS_MODE_LABELS: Record<TtsMode, string> = {
  auto: "Auto (Smart)",
  eco: "Eco (Always Free)",
  premium: "Premium (ElevenLabs)",
};

export const IMAGE_MODE_LABELS: Record<ImageMode, string> = {
  auto: "Auto (Smart)",
  draft: "Draft (Free, Upgradeable)",
  premium: "Premium (Gemini)",
};
