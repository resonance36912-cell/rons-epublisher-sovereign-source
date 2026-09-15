import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLocalVideoFunction } from "./rons-local-video";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RONS local MuseTalk adapter", () => {
  it("submits an image and narration as a local lip-sync job", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      job_id: "a".repeat(32),
      status: "queued",
      output_url: null,
    }, 202));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLocalVideoFunction("submit-video-job", {
      image: new Blob([new Uint8Array(2048)], { type: "image/png" }),
      audio: new Blob([new Uint8Array(1024)], { type: "audio/wav" }),
      duration: 3,
      aspectRatio: "9:16",
    });

    expect(result).toMatchObject({
      success: true,
      local: true,
      provider: "rons-local-musetalk-1.5",
      jobId: "a".repeat(32),
      status: "queued",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:7863/api/jobs");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect(JSON.parse(String(form.get("metadata")))).toMatchObject({
      source: "epublisher-sovereign-local",
      operation: "submit-video-job",
      lip_sync: true,
      duration: 3,
      aspect_ratio: "9:16",
    });
  });

  it("normalizes completed job output to an absolute local URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      job_id: "b".repeat(32),
      status: "succeeded",
      output_url: `/api/jobs/${"b".repeat(32)}/output`,
    })));

    const result = await invokeLocalVideoFunction("check-job-status", { jobId: "b".repeat(32) });
    expect(result.outputUrl).toBe(`http://127.0.0.1:7863/api/jobs/${"b".repeat(32)}/output`);
    expect(result.videoUrl).toBe(result.outputUrl);
  });

  it("routes cancellation to the job cancel endpoint without requiring media", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      job_id: "c".repeat(32),
      status: "canceled",
      output_url: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLocalVideoFunction("cancel-lipsync-job", { jobId: "c".repeat(32) });
    expect(result.status).toBe("canceled");
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:7863/api/jobs/${"c".repeat(32)}/cancel`,
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
  });

  it("rejects path-like job IDs before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeLocalVideoFunction("check-job-status", { jobId: "../health" }))
      .rejects.toThrow("valid local MuseTalk job ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses remote media URLs in sovereign-local mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeLocalVideoFunction("generate-video", { imageUrl: "https://example.com/remote.png" }))
      .rejects.toThrow("must be a local Blob");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves unrelated compatibility functions untouched", async () => {
    await expect(invokeLocalVideoFunction("generate-chapter-image", {})).resolves.toBeUndefined();
  });
});
