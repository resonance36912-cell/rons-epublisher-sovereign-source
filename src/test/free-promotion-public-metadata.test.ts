import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_PROMOTION_ACTIVE } from "../lib/promotion";

describe("free promotion public metadata", () => {
  it("publishes only free promotional pricing while free access is active", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    if (!FREE_PROMOTION_ACTIVE) return;

    expect(html).toContain('"priceRange": "Free during temporary promotion"');
    expect(html).toContain('"price": "0"');
    expect(html).toContain('"name": "Free promotion"');
    expect(html).not.toMatch(/"price"\s*:\s*"(?:149|349|499)"/);
    expect(html).not.toMatch(/"priceRange"\s*:\s*"R/i);
  });
});