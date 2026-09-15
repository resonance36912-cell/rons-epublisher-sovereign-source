import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SlideChapter } from "@/components/storyforge/StoryForgeContext";
import {
  buildBookStructure,
  validateBookStructure,
  type BookStructurePolicy,
} from "../book-structure";

function makePage(index: number, wordCount = 50): SlideChapter {
  return {
    id: `page-${index}`,
    title: `Story page ${index}`,
    body: Array.from({ length: wordCount }, (_, i) => `word${i + 1}`).join(" "),
    imageUrl: `data:image/png;base64,page${index}`,
    references: [`source-${index}`],
  };
}

const sixPagePolicy: BookStructurePolicy = {
  expectedStoryPages: 6,
  maxStoryPages: 6,
  minWordsPerStoryPage: 40,
  maxWordsPerStoryPage: 70,
  requireImagePerStoryPage: true,
  allowChapters: false,
};
describe("BookStructure release contract", () => {
  it("represents six story pages separately from chapter containers", () => {
    const config = { ...DEFAULT_CONFIG, depth: "summary" as const, targetStoryPages: 6 };
    const structure = buildBookStructure({ pages: Array.from({ length: 6 }, (_, i) => makePage(i + 1)), config });

    expect(structure.storyPages).toHaveLength(6);
    expect(structure.chapters).toHaveLength(0);
    expect(structure.cover.title).toBe("Story page 1");
    expect(structure.targetStoryPages).toBe(6);
    expect(validateBookStructure(structure, sixPagePolicy)).toMatchObject({ ok: true, issues: [] });
  });

  it("fails rather than silently truncating an oversized book", () => {
    const config = { ...DEFAULT_CONFIG, depth: "summary" as const, targetStoryPages: 6 };
    const structure = buildBookStructure({ pages: Array.from({ length: 7 }, (_, i) => makePage(i + 1)), config });
    const result = validateBookStructure(structure, sixPagePolicy);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("story-page-count");
    expect(result.issues.map((issue) => issue.code)).toContain("story-page-limit");
    expect(structure.storyPages).toHaveLength(7);
  });
  it("enforces approved word range and image requirements", () => {
    const config = { ...DEFAULT_CONFIG, depth: "summary" as const, targetStoryPages: 6 };
    const pages = Array.from({ length: 6 }, (_, i) => makePage(i + 1));
    pages[1] = { ...makePage(2, 20), imageUrl: undefined };
    const result = validateBookStructure(buildBookStructure({ pages, config }), sixPagePolicy);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("page-too-short");
    expect(result.issues.map((issue) => issue.code)).toContain("page-image-required");
  });

  it("rejects UI chrome and raw ids as story content", () => {
    const config = { ...DEFAULT_CONFIG, depth: "summary" as const, targetStoryPages: 1 };
    const page = makePage(1);
    page.title = "8022288326482758397";
    page.body = "true";
    const result = validateBookStructure(buildBookStructure({ pages: [page], config }), {
      expectedStoryPages: 1,
      maxStoryPages: 6,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("structural-noise");
  });
});