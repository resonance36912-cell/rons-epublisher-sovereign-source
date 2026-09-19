import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_PROMOTION_ACTIVE } from "../lib/promotion";

describe("free promotion public metadata", () => {
  it("publishes only free promotional acquisition metadata", () => {
    expect(FREE_PROMOTION_ACTIVE).toBe(true);
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const llms = readFileSync(resolve(process.cwd(), "public/llms.txt"), "utf8");
    const pricing = readFileSync(resolve(process.cwd(), "src/pages/Pricing.tsx"), "utf8");
    const landing = readFileSync(resolve(process.cwd(), "src/pages/Landing.tsx"), "utf8");

    expect(html).toContain('"priceRange": "Free during temporary promotion"');
    expect(html).toContain('"price": "0"');
    expect(llms).toContain("no charge");
    expect(llms).not.toMatch(/R\s?\d/);
    expect(llms).not.toContain("/checkout");
    expect(llms).not.toContain("Hub checkout");
    expect(pricing).not.toMatch(/R\s?\d/);
    expect(pricing).not.toContain("hubPackCheckoutUrl");
    expect(landing).not.toMatch(/R\s?\d/);
    expect(landing).not.toContain("View pack");
    expect(landing).toContain("Open ePublisher free");
  });
});
