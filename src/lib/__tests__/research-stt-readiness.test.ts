import { describe, expect, it } from "vitest";
import type { Source } from "@/components/storyforge/StoryForgeContext";
import { normaliseExtractedSources } from "@/lib/research-source-quality";

describe("speech-to-text research readiness", () => {
  it("preserves the speech_to_text provenance label after quality normalization", () => {
    const content = Array.from({ length: 35 }, (_, i) =>
      `Cape Coloured community history and identity are discussed in locally transcribed evidence segment ${i + 1}, with substantive topic context retained for review.`,
    ).join(" ");
    const source: Source = {
      id: "stt-1",
      type: "search",
      title: "Cape Coloured documentary",
      url: "https://www.youtube.com/watch?v=abc123",
      content,
      status: "ready",
      transcriptAvailable: true,
      contentAvailability: "speech_to_text",
      extractionProvider: "rons-local-whisper-youtube",
      evidenceReview: "not_reviewed",
    };
    const [result] = normaliseExtractedSources("Cape Coloured history", [source]);
    expect(result.status).toBe("ready");
    expect(result.contentAvailability).toBe("speech_to_text");
    expect(result.evidenceReview).toBe("not_reviewed");
  });
});
