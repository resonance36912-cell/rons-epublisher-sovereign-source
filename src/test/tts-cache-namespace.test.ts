import { describe, expect, it } from "vitest";
import { requestNarrationAudio } from "@/lib/tts-client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

describe("sovereign-local narration", () => {
  it("routes narration to the browser fallback without invoking hosted ElevenLabs", async () => {
    expect(OPEN_NOVA_LOCAL_ONLY).toBe(true);
    const result = await requestNarrationAudio({ text: "Sovereign local narration test", voiceId: "local" });
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.payload.provider).toBe("browser");
      expect(result.payload.fallback).toBe(true);
      expect(result.payload.message).toMatch(/cloud TTS is disabled/i);
    }
  });
});
