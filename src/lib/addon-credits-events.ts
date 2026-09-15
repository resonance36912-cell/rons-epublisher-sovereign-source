// Lightweight pub/sub for add-on credit changes so widgets can refresh live.
export const ADDON_CREDITS_CHANGED = "addon-credits-changed";

export function notifyAddonCreditsChanged(detail?: { type?: "image" | "tts" }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADDON_CREDITS_CHANGED, { detail }));
}
