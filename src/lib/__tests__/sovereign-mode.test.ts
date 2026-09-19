import { describe, expect, it } from "vitest";
import { resolveOpenNovaLocalOnly } from "@/lib/sovereign-mode";

describe("sovereign-mode build default", () => {
  it("defaults clean builds to sovereign local mode", () => {
    expect(resolveOpenNovaLocalOnly(undefined)).toBe(true);
    expect(resolveOpenNovaLocalOnly("")).toBe(true);
    expect(resolveOpenNovaLocalOnly("1")).toBe(true);
  });

  it("requires an explicit zero to enable the hosted/cloud path", () => {
    expect(resolveOpenNovaLocalOnly("0")).toBe(false);
  });
});
