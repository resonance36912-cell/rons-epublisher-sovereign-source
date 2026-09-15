/**
 * Narration config normalization.
 *
 * Free plan users cannot use ElevenLabs voices. When a user moves between
 * Premium and Free (or a stale persisted project loads on a Free account),
 * we must coerce narration settings to a safe, valid combination before they
 * are used downstream (preview, storyboard generation, exports).
 *
 * Premium → Free: clear the ElevenLabs voice id and demeanour, switch
 *   provider to "browser", keep speed.
 * Free → Premium: leave settings alone (user opts in via the Premium
 *   Narration toggle, which restores a sensible default voice if missing).
 */

export type NarrationTier = "free" | "standard" | "premium";

export const DEFAULT_BROWSER_VOICE = "browser-default";
export const DEFAULT_ELEVENLABS_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George
export const DEFAULT_DEMEANOUR = "calm" as const;

export const ELEVENLABS_VOICE_IDS = new Set<string>([
  "JBFqnCBsd6RMkjVDRZzb", // George
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "pFZP5JQG7iQjIQuC4Bku", // Lily
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
]);

export type NarrationConfigSlice = {
  narrationProvider: "browser" | "elevenlabs";
  narrationVoice: string;
  narrationDemeanour: "calm" | "energetic" | "warm" | "authoritative" | "playful";
  narrationSpeed: number;
};

export function isElevenLabsVoiceId(voiceId: string | undefined | null): boolean {
  if (!voiceId) return false;
  return ELEVENLABS_VOICE_IDS.has(voiceId);
}

/**
 * Returns a safely normalized narration config for the given tier. Pure
 * function — does not mutate the input. If no changes are needed, returns
 * the input by reference so callers can cheaply detect "nothing to do".
 */
export function normalizeNarrationForTier<T extends NarrationConfigSlice>(
  config: T,
  tier: NarrationTier,
): T {
  if (tier === "free") {
    const needsReset =
      config.narrationProvider === "elevenlabs" ||
      isElevenLabsVoiceId(config.narrationVoice) ||
      config.narrationVoice === "custom";
    if (!needsReset) return config;
    return {
      ...config,
      narrationProvider: "browser",
      narrationVoice: DEFAULT_BROWSER_VOICE,
      narrationDemeanour: DEFAULT_DEMEANOUR,
    };
  }

  // Premium / Standard: if the user has the Premium toggle on but the voice
  // is empty or stuck on the browser placeholder, hydrate a default voice so
  // generation has a valid id to send.
  if (config.narrationProvider === "elevenlabs") {
    const voiceMissing =
      !config.narrationVoice ||
      config.narrationVoice === DEFAULT_BROWSER_VOICE ||
      (!isElevenLabsVoiceId(config.narrationVoice) && config.narrationVoice !== "custom");
    if (voiceMissing) {
      return { ...config, narrationVoice: DEFAULT_ELEVENLABS_VOICE };
    }
  }
  return config;
}
