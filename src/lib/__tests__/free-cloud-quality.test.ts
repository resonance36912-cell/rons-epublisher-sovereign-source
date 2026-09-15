import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FREE_CLOUD_QUALITY_KEY,
  getFreeCloudQualityEnabled,
  parseHybridJson,
  requestHybridText,
  setFreeCloudQualityEnabled,
} from "@/lib/free-cloud-quality";

describe("free-cloud quality router", () => {
  beforeEach(() => {
    localStorage.removeItem(FREE_CLOUD_QUALITY_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(FREE_CLOUD_QUALITY_KEY);
  });

  it("is opt-in and defaults off", () => {
    expect(getFreeCloudQualityEnabled()).toBe(false);
    setFreeCloudQualityEnabled(true);
    expect(getFreeCloudQualityEnabled()).toBe(true);
    setFreeCloudQualityEnabled(false);
    expect(getFreeCloudQualityEnabled()).toBe(false);
  });
  it("parses fenced JSON without accepting surrounding prose", () => {
    expect(parseHybridJson<{ chapters: number[] }>("```json\n{\"chapters\":[1,2]}\n```"))
      .toEqual({ chapters: [1, 2] });
  });

  it("sends external approval only when the local user opted in", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({
        provider: body.human_approved_external ? "gemini-free" : "rons-local",
        route: body.human_approved_external ? "free-cloud" : "local-fallback",
        text: "ok",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const local = await requestHybridText({ prompt: "test", allowCloud: false });
    const cloud = await requestHybridText({ prompt: "test", allowCloud: true });
    expect(local.provider).toBe("rons-local");
    expect(cloud.provider).toBe("gemini-free");
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.human_approved_external).toBe(false);
    expect(second.human_approved_external).toBe(true);
  });
});
