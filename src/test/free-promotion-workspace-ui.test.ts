import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_PROMOTION_ACTIVE } from "../lib/promotion";

const source = (file: string) =>
  readFileSync(resolve(process.cwd(), "src/components/storyforge", file), "utf8");

describe("free promotion workspace UI", () => {
  it("keeps generation and export surfaces payment-free while promotion is active", () => {
    expect(FREE_PROMOTION_ACTIVE).toBe(true);

    const storyline = source("StorylineEditor.tsx");
    const configure = source("ReviewConfigure.tsx");
    const provider = source("ProviderHealthBanner.tsx");
    const costMode = source("visualbook/CostModePanel.tsx");
    const compare = source("visualbook/FreeVsPremiumCompare.tsx");
    const music = source("visualbook/BackgroundMusicPicker.tsx");
    const narration = source("visualbook/NarrationCostEstimator.tsx");
    const eco = source("visualbook/AutoEcoBanner.tsx");
    const quota = source("visualbook/QuotaAndCreditsCard.tsx");

    expect(storyline).toContain("!FREE_PROMOTION_ACTIVE && (");
    expect(storyline).toContain("promotional access remains free");
    expect(configure).toContain("included during the free-access promotion");
    expect(provider).toContain("no payment is required");
    expect(costMode).toContain("Quality & Provider Preferences");
    expect(compare).toContain("no payment is required");
    expect(music).toContain("All music tracks are included during promotional access");
    expect(narration).toContain("no payment required");
    expect(eco).toContain("Access remains free during the promotion");
    expect(quota).toContain("all ePublisher features are available without payment");
  });
});
