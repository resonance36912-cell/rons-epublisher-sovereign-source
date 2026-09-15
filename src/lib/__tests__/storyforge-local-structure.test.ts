import { describe, expect, it } from "vitest";
import { localFormatChapters, processSources, generateStoryboard } from "../storyforge-api";
import { DEFAULT_CONFIG } from "@/components/storyforge/StoryForgeContext";

const substantive = Array.from({ length: 1199 }, (_, index) =>
  `Ashley Uys scientific diagnostics substantive source paragraph ${index + 1}. ` +
  "This source material discusses rapid diagnostic development, local manufacturing, research context, evidence review, and a clear educational explanation for regression testing."
);

const noise = [
  "true",
  "false",
  "8022288326482758397",
  "Google apps",
  "Main menu",
  "Send feedback about Help. This navigation-only prompt exists solely as website chrome and should never become story content in the generated book structure.",
];

const corpus = [...substantive, ...noise].join("\n\n");

describe("local StoryForge governed structure", () => {
  it.each([
    ["summary", 6],
    ["standard", 12],
    ["extensive", 20],
  ] as const)("bounds a 1,199-item corpus in %s mode", (depth, limit) => {
    const chapters = localFormatChapters(corpus, { topic: "Ashley Uys diagnostics", depth });
    expect(chapters).toHaveLength(limit);
    expect(chapters.map((chapter) => chapter.id)).toEqual(
      Array.from({ length: limit }, (_, index) => `local-page-${index + 1}`),
    );
  });

  it("preserves substantive material while dropping known web chrome", () => {
    const chapters = localFormatChapters(corpus, { topic: "Ashley Uys diagnostics", depth: "standard" });
    const joined = chapters.map((chapter) => chapter.body).join("\n\n");
    const markers = joined.match(/substantive source paragraph \d+\./g) || [];

    expect(markers).toHaveLength(1199);
    expect(new Set(markers)).toHaveLength(1199);
    expect(joined).toContain("substantive source paragraph 1.");
    expect(joined).toContain("substantive source paragraph 1199.");
    expect(joined).not.toContain("Send feedback about Help");
    expect(joined).not.toContain("8022288326482758397");
  });
});


describe("local StoryForge exact story-page brief", () => {
  it("honors an explicit story-page target within the governed depth", () => {
    const pages = localFormatChapters(corpus, { topic: "Ashley Uys diagnostics", depth: "standard", targetStoryPages: 6 });
    expect(pages).toHaveLength(6);
  });

  it("rejects an explicit target above the selected depth ceiling", () => {
    expect(() => localFormatChapters(corpus, { topic: "Ashley Uys diagnostics", depth: "summary", targetStoryPages: 7 }))
      .toThrow(/exceeds the 6-page summary limit/);
  });

  it("fails instead of inventing empty pages when source material cannot satisfy the target", () => {
    const thin = "A single compact source statement with too little structure to support six distinct story pages without fabricating additional content.";
    expect(() => localFormatChapters(thin, { topic: "Thin source", depth: "summary", targetStoryPages: 6, storyPageMinWords: 40 }))
      .toThrow(/requires at least 240 words/);
  });
});

describe("local StoryForge source readiness", () => {
  it("does not relabel metadata-only or empty search results as ready", async () => {
    const processed = await processSources([
      { id: "usable", type: "search", title: "Usable", content: "Substantive extracted evidence.", status: "ready", contentAvailability: "text_extracted" },
      { id: "video", type: "search", title: "Video", status: "error", contentAvailability: "metadata_only" },
      { id: "empty", type: "search", title: "Empty", status: "pending" },
      { id: "short", type: "search", title: "Short", content: "Short topical extract", status: "processing", contentAvailability: "text_extracted" },
    ]);

    expect(processed.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "usable", status: "ready" },
      { id: "video", status: "error" },
      { id: "empty", status: "error" },
      { id: "short", status: "processing" },
    ]);
  });

  it("creates an explicitly labelled topic-only draft without promoting metadata-only sources", async () => {
    const chapters = await generateStoryboard([
      {
        id: "video-metadata",
        type: "search",
        title: "Ashley Uys interview without captions",
        url: "https://www.youtube.com/watch?v=metadata",
        status: "error",
        contentAvailability: "metadata_only",
      },
    ], {
      ...DEFAULT_CONFIG,
      topic: "Ashley Uys",
      depth: "summary",
      researchBasis: "topic_only",
    });

    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters.every((chapter) => chapter.references?.length === 0)).toBe(true);
    expect(chapters.every((chapter) => chapter.notes?.includes("topic-only draft"))).toBe(true);
    expect(chapters.map((chapter) => chapter.body).join("\n")).not.toContain("interview without captions");
  });
});
