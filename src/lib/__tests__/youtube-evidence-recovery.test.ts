import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/components/storyforge/StoryForgeContext";
import { recoverYouTubeEvidenceSources } from "@/lib/youtube-evidence-recovery";

const video: Source = {
  id: "yt-1",
  type: "search",
  title: "Cape Coloured documentary",
  url: "https://www.youtube.com/watch?v=abc123",
  extractionProvider: "youtube-public-metadata",
  transcriptAvailable: false,
  contentAvailability: "metadata_only",
  status: "error",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local YouTube evidence recovery", () => {
  it("replaces metadata-only state with provenance-labelled local speech-to-text", async () => {
    const text = Array.from({ length: 40 }, (_, i) => `Cape Coloured history evidence sentence ${i + 1}.`).join(" ");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text, retrieved_at: "2026-09-12T00:00:00Z", content_hash: "abc", quality: { provider: "rons-local-whisper" } }),
    }));
    const [result] = await recoverYouTubeEvidenceSources([video]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    expect(result.contentAvailability).toBe("speech_to_text");
    expect(result.extractionProvider).toBe("rons-local-whisper-youtube");
    expect(result.transcriptAvailable).toBe(true);
    expect(result.content).toBe(text);
    expect(result.evidenceReview).toBe("not_reviewed");
    expect(result.diagnostic).toMatch(/factual verification remains separate/i);
  });

  it("does not send non-YouTube sources to local speech-to-text", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const article: Source = {
      id: "web-1", type: "search", title: "Cape history", url: "https://example.org/cape",
      content: "Cape Coloured historical evidence.", status: "ready", contentAvailability: "text_extracted",
    };
    const [result] = await recoverYouTubeEvidenceSources([article]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(article);
  });

  it("retries a transient 502 once and keeps the recovered transcript", async () => {
    const text = "Recovered transcript after a transient YouTube acquisition failure.";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: "upstream_acquisition_failed" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text, quality: { provider: "rons-local-whisper" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await recoverYouTubeEvidenceSources([video]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ready");
    expect(result.content).toBe(text);
    expect(result.contentAvailability).toBe("speech_to_text");
  });

  it("keeps metadata-only truthfulness when local recovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "audio unavailable" }),
    }));
    const [result] = await recoverYouTubeEvidenceSources([video]);
    expect(result.status).toBe("error");
    expect(result.contentAvailability).toBe("metadata_only");
    expect(result.transcriptAvailable).toBe(false);
    expect(result.diagnostic).toMatch(/recovery failed/i);
    expect(result.diagnostic).toMatch(/audio unavailable/i);
  });
});
