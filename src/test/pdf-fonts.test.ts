import { describe, it, expect } from "vitest";
import { ALL_PDF_FONTS, cssFontFamily, googleFontsLinkUrl } from "@/lib/pdf-fonts";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

describe("pdf-fonts sovereign contract", () => {
  it("keeps the three built-in PDF fonts available", () => {
    const builtins = ALL_PDF_FONTS.filter((f) => !f.isGoogle);
    expect(builtins).toHaveLength(3);
  });

  it("does not expose remote Google fonts in sovereign-local mode", () => {
    const google = ALL_PDF_FONTS.filter((f) => f.isGoogle);
    if (OPEN_NOVA_LOCAL_ONLY) {
      expect(google).toHaveLength(0);
      expect(googleFontsLinkUrl()).toBe("");
      expect(cssFontFamily("inter")).toBe("sans-serif");
    } else {
      expect(google.length).toBeGreaterThanOrEqual(8);
      expect(googleFontsLinkUrl()).toBe("");
      expect(cssFontFamily("inter")).toContain("Inter");
    }
  });

  it("keeps built-in CSS families and a safe unknown fallback", () => {
    expect(cssFontFamily("helvetica")).toContain("Helvetica");
    expect(cssFontFamily("times")).toContain("Times");
    expect(cssFontFamily("courier")).toContain("Courier");
    expect(cssFontFamily("unknown-font")).toBe("sans-serif");
  });
});
