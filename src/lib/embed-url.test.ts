import { describe, it, expect } from "vitest";
import { resolveWatchUrl } from "@/lib/embed-url";

describe("resolveWatchUrl — YouTube", () => {
  it("converts a standard /embed/ID to a watch URL", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://www.youtube.com/embed/-1SjoH9KFVg",
    );
    expect(providerLabel).toBe("YouTube");
    expect(watchUrl).toBe("https://www.youtube.com/watch?v=-1SjoH9KFVg");
  });

  it("handles the privacy-enhanced (nocookie) host", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(providerLabel).toBe("YouTube");
    expect(watchUrl).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("preserves start time from ?start= and ?t=…s", () => {
    const a = resolveWatchUrl(
      "https://www.youtube.com/embed/abc123?start=42",
    );
    expect(a.watchUrl).toBe("https://www.youtube.com/watch?v=abc123&t=42");
    const b = resolveWatchUrl("https://youtu.be/abc123?t=90s");
    expect(b.watchUrl).toBe("https://www.youtube.com/watch?v=abc123&t=90");
  });

  it("preserves playlist context", () => {
    const { watchUrl } = resolveWatchUrl(
      "https://www.youtube.com/embed/abc123?list=PL12345&index=2",
    );
    expect(watchUrl).toBe(
      "https://www.youtube.com/watch?v=abc123&list=PL12345",
    );
  });

  it("handles youtu.be short links", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://youtu.be/abc123",
    );
    expect(providerLabel).toBe("YouTube");
    expect(watchUrl).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("handles /shorts/, /v/, /live/ and m./music. subdomains", () => {
    expect(resolveWatchUrl("https://www.youtube.com/shorts/abc123").watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123");
    expect(resolveWatchUrl("https://www.youtube.com/v/abc123").watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123");
    expect(resolveWatchUrl("https://www.youtube.com/live/abc123").watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123");
    expect(resolveWatchUrl("https://m.youtube.com/watch?v=abc123").watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123");
    expect(resolveWatchUrl("https://music.youtube.com/watch?v=abc123").watchUrl)
      .toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("falls back to a playlist URL for embed/videoseries", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://www.youtube.com/embed/videoseries?list=PLxyz",
    );
    expect(providerLabel).toBe("YouTube");
    expect(watchUrl).toBe("https://www.youtube.com/playlist?list=PLxyz");
  });

  it("keeps the original watch URL untouched when already canonical", () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    expect(resolveWatchUrl(url).watchUrl).toBe(url);
  });
});

describe("resolveWatchUrl — Vimeo", () => {
  it("converts player.vimeo.com/video/ID", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://player.vimeo.com/video/76979871",
    );
    expect(providerLabel).toBe("Vimeo");
    expect(watchUrl).toBe("https://vimeo.com/76979871");
  });

  it("preserves the unlisted hash from /video/ID/HASH", () => {
    const { watchUrl } = resolveWatchUrl(
      "https://player.vimeo.com/video/76979871/abc1234",
    );
    expect(watchUrl).toBe("https://vimeo.com/76979871/abc1234");
  });

  it("preserves the unlisted hash from ?h= query param", () => {
    const { watchUrl } = resolveWatchUrl(
      "https://player.vimeo.com/video/76979871?h=deadbeef",
    );
    expect(watchUrl).toBe("https://vimeo.com/76979871/deadbeef");
  });

  it("normalises /channels/<name>/ID", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://vimeo.com/channels/staffpicks/76979871",
    );
    expect(providerLabel).toBe("Vimeo");
    expect(watchUrl).toBe("https://vimeo.com/76979871");
  });

  it("leaves an already-canonical vimeo.com/ID untouched", () => {
    const url = "https://vimeo.com/76979871";
    expect(resolveWatchUrl(url).watchUrl).toBe(url);
  });
});

describe("resolveWatchUrl — unknown / invalid", () => {
  it("returns 'source' label for unknown hosts", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl(
      "https://example.com/embed/whatever",
    );
    expect(providerLabel).toBe("source");
    expect(watchUrl).toBe("https://example.com/embed/whatever");
  });

  it("returns the original input for unparsable URLs", () => {
    const { watchUrl, providerLabel } = resolveWatchUrl("not a url");
    expect(providerLabel).toBe("source");
    expect(watchUrl).toBe("not a url");
  });
});
