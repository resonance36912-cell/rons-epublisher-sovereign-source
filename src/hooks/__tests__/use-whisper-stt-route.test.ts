import { describe, expect, it } from "vitest";
import { resolveWhisperSttRoute } from "@/hooks/use-whisper-stt";

describe("RONS microphone STT routing", () => {
  it("keeps sovereign builds on the same-origin local proxy by default", () => {
    expect(resolveWhisperSttRoute(true, undefined, undefined)).toEqual({
      baseUrl: "/open-nova-stt",
      mode: "local",
    });
  });

  it("honors an explicit sovereign local endpoint override", () => {
    expect(
      resolveWhisperSttRoute(true, "http://127.0.0.1:7869/", "https://ignored.example"),
    ).toEqual({
      baseUrl: "http://127.0.0.1:7869",
      mode: "local",
    });
  });

  it("requires an explicit hosted endpoint in cloud mode", () => {
    expect(resolveWhisperSttRoute(false, "http://127.0.0.1:7869", undefined)).toEqual({
      baseUrl: null,
      mode: "hosted",
    });
    expect(
      resolveWhisperSttRoute(false, undefined, "https://stt.example.test/"),
    ).toEqual({
      baseUrl: "https://stt.example.test",
      mode: "hosted",
    });
  });
});
