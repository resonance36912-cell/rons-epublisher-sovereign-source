import { describe, it, expect } from "vitest";
import {
  DEFAULT_BROWSER_VOICE,
  DEFAULT_DEMEANOUR,
  DEFAULT_ELEVENLABS_VOICE,
  isElevenLabsVoiceId,
  normalizeNarrationForTier,
  type NarrationConfigSlice,
} from "./narration-config";

const base = (overrides: Partial<NarrationConfigSlice> = {}): NarrationConfigSlice => ({
  narrationProvider: "browser",
  narrationVoice: DEFAULT_BROWSER_VOICE,
  narrationDemeanour: "calm",
  narrationSpeed: 1,
  ...overrides,
});

describe("isElevenLabsVoiceId", () => {
  it("recognizes known ElevenLabs ids", () => {
    expect(isElevenLabsVoiceId("JBFqnCBsd6RMkjVDRZzb")).toBe(true);
  });
  it("rejects unknown / empty ids", () => {
    expect(isElevenLabsVoiceId(DEFAULT_BROWSER_VOICE)).toBe(false);
    expect(isElevenLabsVoiceId("")).toBe(false);
    expect(isElevenLabsVoiceId(undefined)).toBe(false);
  });
});

describe("normalizeNarrationForTier — Free tier", () => {
  it("clears ElevenLabs provider/voice/demeanour and switches to browser", () => {
    const out = normalizeNarrationForTier(
      base({ narrationProvider: "elevenlabs", narrationVoice: "JBFqnCBsd6RMkjVDRZzb", narrationDemeanour: "energetic" }),
      "free",
    );
    expect(out.narrationProvider).toBe("browser");
    expect(out.narrationVoice).toBe(DEFAULT_BROWSER_VOICE);
    expect(out.narrationDemeanour).toBe(DEFAULT_DEMEANOUR);
  });

  it("clears even when provider is browser but voice id is an ElevenLabs id (stale state)", () => {
    const out = normalizeNarrationForTier(
      base({ narrationProvider: "browser", narrationVoice: "EXAVITQu4vr4xnSDxMaL" }),
      "free",
    );
    expect(out.narrationVoice).toBe(DEFAULT_BROWSER_VOICE);
  });

  it("clears 'custom' (premium-only feature) on Free", () => {
    const out = normalizeNarrationForTier(
      base({ narrationVoice: "custom" }),
      "free",
    );
    expect(out.narrationVoice).toBe(DEFAULT_BROWSER_VOICE);
  });

  it("preserves narrationSpeed", () => {
    const out = normalizeNarrationForTier(
      base({ narrationProvider: "elevenlabs", narrationVoice: "JBFqnCBsd6RMkjVDRZzb", narrationSpeed: 0.8 }),
      "free",
    );
    expect(out.narrationSpeed).toBe(0.8);
  });

  it("returns the same reference when no changes are needed (no-op)", () => {
    const cfg = base();
    expect(normalizeNarrationForTier(cfg, "free")).toBe(cfg);
  });
});

describe("normalizeNarrationForTier — Premium tier", () => {
  it("hydrates a default ElevenLabs voice when provider is elevenlabs but voice is browser placeholder", () => {
    const out = normalizeNarrationForTier(
      base({ narrationProvider: "elevenlabs", narrationVoice: DEFAULT_BROWSER_VOICE }),
      "premium",
    );
    expect(out.narrationVoice).toBe(DEFAULT_ELEVENLABS_VOICE);
  });

  it("hydrates default voice when provider is elevenlabs but voice id is empty/junk", () => {
    const out = normalizeNarrationForTier(
      base({ narrationProvider: "elevenlabs", narrationVoice: "" }),
      "premium",
    );
    expect(out.narrationVoice).toBe(DEFAULT_ELEVENLABS_VOICE);
  });

  it("leaves an existing valid ElevenLabs voice untouched", () => {
    const cfg = base({ narrationProvider: "elevenlabs", narrationVoice: "EXAVITQu4vr4xnSDxMaL" });
    expect(normalizeNarrationForTier(cfg, "premium")).toBe(cfg);
  });

  it("does not touch browser-only configs on Premium", () => {
    const cfg = base({ narrationProvider: "browser", narrationVoice: DEFAULT_BROWSER_VOICE });
    expect(normalizeNarrationForTier(cfg, "premium")).toBe(cfg);
  });
});

describe("normalizeNarrationForTier — round-trip Premium ↔ Free", () => {
  it("loses the ElevenLabs voice when going Premium → Free, then keeps browser settings going Free → Premium", () => {
    const premium = base({ narrationProvider: "elevenlabs", narrationVoice: "TX3LPaxmHKxFdv7VOQHJ", narrationDemeanour: "playful" });
    const free = normalizeNarrationForTier(premium, "free");
    expect(free.narrationProvider).toBe("browser");
    expect(free.narrationVoice).toBe(DEFAULT_BROWSER_VOICE);

    // Going back to Premium does NOT silently re-enable ElevenLabs — user
    // must explicitly toggle Premium Narration on.
    const backToPremium = normalizeNarrationForTier(free, "premium");
    expect(backToPremium.narrationProvider).toBe("browser");
    expect(backToPremium.narrationVoice).toBe(DEFAULT_BROWSER_VOICE);
  });
});
