import { describe, it, expect } from "vitest";
import { buildEmbedEventProps, validateEmbedEventProps } from "./embedEvents";

describe("buildEmbedEventProps", () => {
  describe("empty / invalid provider", () => {
    it("returns null for empty string provider", () => {
      expect(buildEmbedEventProps("", "https://youtu.be/abc")).toBeNull();
    });
    it("returns null for whitespace-only provider", () => {
      expect(buildEmbedEventProps("   ", "https://youtu.be/abc")).toBeNull();
    });
    it("returns null for non-string provider", () => {
      expect(buildEmbedEventProps(null, "https://youtu.be/abc")).toBeNull();
      expect(buildEmbedEventProps(undefined, "https://youtu.be/abc")).toBeNull();
      expect(buildEmbedEventProps(42, "https://youtu.be/abc")).toBeNull();
    });
    it("trims provider and caps at 64 chars", () => {
      const long = "a".repeat(200);
      const res = buildEmbedEventProps(`  ${long}  `, "https://x.com/v");
      expect(res?.provider).toHaveLength(64);
    });
  });

  describe("empty / invalid embed_url", () => {
    it("returns null for empty url", () => {
      expect(buildEmbedEventProps("YouTube", "")).toBeNull();
    });
    it("returns null for whitespace-only url", () => {
      expect(buildEmbedEventProps("YouTube", "   ")).toBeNull();
    });
    it("returns null for malformed url", () => {
      expect(buildEmbedEventProps("YouTube", "not a url")).toBeNull();
      expect(buildEmbedEventProps("YouTube", "://broken")).toBeNull();
    });
    it("returns null for non-string url", () => {
      expect(buildEmbedEventProps("YouTube", null)).toBeNull();
      expect(buildEmbedEventProps("YouTube", 123)).toBeNull();
    });
  });

  describe("http/https protocol enforcement", () => {
    it("accepts https", () => {
      const res = buildEmbedEventProps("YouTube", "https://youtu.be/abc");
      expect(res?.embed_url).toBe("https://youtu.be/abc");
    });
    it("accepts http", () => {
      const res = buildEmbedEventProps("YouTube", "http://example.com/v");
      expect(res?.embed_url).toBe("http://example.com/v");
    });
    it("rejects javascript:", () => {
      expect(buildEmbedEventProps("YouTube", "javascript:alert(1)")).toBeNull();
    });
    it("rejects data:", () => {
      expect(buildEmbedEventProps("YouTube", "data:text/html,<script>")).toBeNull();
    });
    it("rejects ftp:", () => {
      expect(buildEmbedEventProps("YouTube", "ftp://example.com/file")).toBeNull();
    });
    it("rejects file:", () => {
      expect(buildEmbedEventProps("YouTube", "file:///etc/passwd")).toBeNull();
    });
  });

  describe("hash stripping", () => {
    it("strips a simple hash fragment", () => {
      const res = buildEmbedEventProps("YouTube", "https://youtu.be/abc#t=30");
      expect(res?.embed_url).toBe("https://youtu.be/abc");
      expect(res?.embed_url).not.toContain("#");
    });
    it("strips hash but keeps query string", () => {
      const res = buildEmbedEventProps("YouTube", "https://y.com/watch?v=x#frag");
      expect(res?.embed_url).toBe("https://y.com/watch?v=x");
    });
    it("leaves urls without a hash unchanged (modulo URL canonicalization)", () => {
      const res = buildEmbedEventProps("YouTube", "https://youtu.be/abc");
      expect(res?.embed_url).toBe("https://youtu.be/abc");
    });
  });

  describe("happy path", () => {
    it("returns normalized provider + url", () => {
      const res = buildEmbedEventProps("  YouTube  ", "https://youtu.be/abc#x");
      expect(res).toEqual({ provider: "YouTube", embed_url: "https://youtu.be/abc" });
    });
    it("caps embed_url at 500 chars", () => {
      const long = "https://example.com/" + "a".repeat(600);
      const res = buildEmbedEventProps("YouTube", long);
      expect(res?.embed_url.length).toBe(500);
    });
  });
});

describe("validateEmbedEventProps (reason codes)", () => {
  it("reports provider_invalid_type for non-string provider", () => {
    expect(validateEmbedEventProps(null, "https://x.com/v")).toEqual({ ok: false, reason: "provider_invalid_type" });
    expect(validateEmbedEventProps(42, "https://x.com/v")).toEqual({ ok: false, reason: "provider_invalid_type" });
  });
  it("reports provider_missing for empty/whitespace provider", () => {
    expect(validateEmbedEventProps("", "https://x.com/v")).toEqual({ ok: false, reason: "provider_missing" });
    expect(validateEmbedEventProps("   ", "https://x.com/v")).toEqual({ ok: false, reason: "provider_missing" });
  });
  it("reports url_invalid_type for non-string url", () => {
    expect(validateEmbedEventProps("YouTube", null)).toEqual({ ok: false, reason: "url_invalid_type" });
    expect(validateEmbedEventProps("YouTube", 123)).toEqual({ ok: false, reason: "url_invalid_type" });
  });
  it("reports url_missing for empty/whitespace url", () => {
    expect(validateEmbedEventProps("YouTube", "")).toEqual({ ok: false, reason: "url_missing" });
    expect(validateEmbedEventProps("YouTube", "   ")).toEqual({ ok: false, reason: "url_missing" });
  });
  it("reports url_malformed for unparseable url", () => {
    expect(validateEmbedEventProps("YouTube", "not a url")).toEqual({ ok: false, reason: "url_malformed" });
  });
  it("reports url_protocol_unsupported for non-http(s) schemes", () => {
    expect(validateEmbedEventProps("YouTube", "javascript:alert(1)")).toEqual({ ok: false, reason: "url_protocol_unsupported" });
    expect(validateEmbedEventProps("YouTube", "ftp://example.com/v")).toEqual({ ok: false, reason: "url_protocol_unsupported" });
    expect(validateEmbedEventProps("YouTube", "data:text/html,x")).toEqual({ ok: false, reason: "url_protocol_unsupported" });
  });
  it("returns ok:true with normalized fields on success", () => {
    const res = validateEmbedEventProps("  YouTube  ", "https://youtu.be/abc#t=1");
    expect(res).toEqual({ ok: true, provider: "YouTube", embed_url: "https://youtu.be/abc" });
  });
});
