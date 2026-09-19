import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/components/storyforge/StoryForgeContext";
import { recoverYouTubeEvidenceSources } from "@/lib/youtube-evidence-recovery";

const video: Source = {
  id: "yt-1", type: "search", title: "Cape history documentary",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  extractionProvider: "youtube-public-metadata", transcriptAvailable: false,
  contentAvailability: "metadata_only", status: "error",
};
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
const queued = () => response({ jobId: "job-1", status: "queued", stage: "queued" }, 202);
const complete = () => response({ jobId: "job-1", status: "complete", result: {
  text: "Recovered local speech with provenance", content_hash: "hash", retrieved_at: "2026-09-19T00:00:00Z",
  quality: { provider: "rons-local-whisper" },
} });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("queued YouTube evidence recovery", () => {
  it("polls queued and running jobs, retaining provenance without implying factual review", async () => {
    const mock = vi.fn().mockResolvedValueOnce(queued())
      .mockResolvedValueOnce(response({ jobId: "job-1", status: "running", stage: "transcribing" }))
      .mockResolvedValueOnce(complete());
    vi.stubGlobal("fetch", mock);
    const progress = vi.fn();
    const pending = recoverYouTubeEvidenceSources([video], progress);
    await vi.runAllTimersAsync();
    const [result] = await pending;
    expect(mock.mock.calls.map((call) => call[1].method)).toEqual(["POST", "GET", "GET"]);
    expect(mock.mock.calls[0][0]).toMatch(/\/transcription-jobs$/);
    expect(result.status).toBe("ready");
    expect(result.contentAvailability).toBe("speech_to_text");
    expect(result.evidenceReview).toBe("not_reviewed");
    expect(result.contentHash).toBe("hash");
    expect(progress.mock.calls.some(([item]) => item.stage === "transcribing")).toBe(true);
  });

  it("retries a transport 524 using the same submission payload", async () => {
    const mock = vi.fn().mockResolvedValueOnce(response(null, 524))
      .mockResolvedValueOnce(queued()).mockResolvedValueOnce(complete());
    vi.stubGlobal("fetch", mock);
    const pending = recoverYouTubeEvidenceSources([video]);
    await vi.runAllTimersAsync();
    expect((await pending)[0].status).toBe("ready");
    expect(mock.mock.calls[0][1].body).toBe(mock.mock.calls[1][1].body);
  });

  it("retries a failed poll without submitting another transcription", async () => {
    const mock = vi.fn().mockResolvedValueOnce(queued())
      .mockResolvedValueOnce(response(null, 502)).mockResolvedValueOnce(complete());
    vi.stubGlobal("fetch", mock);
    const pending = recoverYouTubeEvidenceSources([video]);
    await vi.runAllTimersAsync();
    expect((await pending)[0].status).toBe("ready");
    expect(mock.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(1);
  });

  it("preserves metadata-only state and the actionable denial reason", async () => {
    const mock = vi.fn().mockResolvedValueOnce(queued()).mockResolvedValueOnce(response({
      jobId: "job-1", status: "failed", error: "source_download_denied", reason: "Supply an authorized transcript.",
    }));
    vi.stubGlobal("fetch", mock);
    const pending = recoverYouTubeEvidenceSources([video]);
    await vi.runAllTimersAsync();
    const [result] = await pending;
    expect(result.status).toBe("error");
    expect(result.contentAvailability).toBe("metadata_only");
    expect(result.transcriptAvailable).toBe(false);
    expect(result.diagnostic).toContain("Supply an authorized transcript.");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty completed transcript", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(queued()).mockResolvedValueOnce(response({
      jobId: "job-1", status: "complete", result: { text: " " },
    })));
    const pending = recoverYouTubeEvidenceSources([video]);
    await vi.runAllTimersAsync();
    expect((await pending)[0].status).toBe("error");
  });

  it("stops polling on cancellation without promoting evidence", async () => {
    const mock = vi.fn().mockResolvedValue(queued());
    vi.stubGlobal("fetch", mock);
    const controller = new AbortController();
    const pending = recoverYouTubeEvidenceSources([video], undefined, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("bounds waiting and never re-submits the active job", async () => {
    const mock = vi.fn().mockResolvedValue(queued());
    vi.stubGlobal("fetch", mock);
    const pending = recoverYouTubeEvidenceSources([video]);
    await vi.runAllTimersAsync();
    const [result] = await pending;
    expect(result.status).toBe("error");
    expect(result.diagnostic).toContain("reconnect to the existing job");
    expect(mock.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(1);
  });

  it("does not fall back to synchronous work if the job endpoint is missing", async () => {
    const mock = vi.fn().mockResolvedValue(response(null, 404));
    vi.stubGlobal("fetch", mock);
    const [result] = await recoverYouTubeEvidenceSources([video]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    expect(result.diagnostic).toContain("service is updated");
  });

  it("never submits articles or lookalike YouTube domains", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const sources = [
      { ...video, url: "https://example.org/article" },
      { ...video, url: "https://notyoutube.com/watch?v=abcdefghijk" },
    ];
    expect(await recoverYouTubeEvidenceSources(sources)).toEqual(sources);
    expect(mock).not.toHaveBeenCalled();
  });
});
