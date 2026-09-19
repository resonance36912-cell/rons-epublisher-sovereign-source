import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SlideChapter, type Source } from "@/components/storyforge/StoryForgeContext";
import { loadLocalProjectBackup, upsertLocalProjectBackup } from "@/lib/local-project-backup";

describe("local project backup integrity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves citation and verification metadata while bounding extracted source text", () => {
    const source: Source = {
      id: "source-1",
      type: "search",
      title: "Ashley Uys - Medical Diagnostech",
      url: "https://www.youtube.com/watch?v=Y5-j2AXueDI",
      canonicalUrl: "https://www.youtube.com/watch?v=Y5-j2AXueDI",
      provider: "youtube-public-search",
      extractionProvider: "rons-local-whisper-youtube",
      retrievedAt: "2026-09-19T16:07:08.477216+00:00",
      publishedAt: "2014-01-01",
      creator: "ABN Digital",
      relevantTimestamp: "00:42",
      contentHash: "abc123",
      verified: true,
      transcriptAvailable: true,
      relevance: "direct",
      relevanceReason: "Direct subject interview",
      contentAvailability: "speech_to_text",
      evidenceReview: "reviewed",
      sourceKind: "video",
      content: "x".repeat(6000),
      status: "ready",
    };
    const chapter: SlideChapter = {
      id: "chapter-1",
      title: "Diagnostics",
      body: "A source-grounded chapter.",
      references: ["Ashley Uys - Medical Diagnostech (2014) https://www.youtube.com/watch?v=Y5-j2AXueDI"],
      evidenceClaims: [{
        id: "claim-1",
        claim: "Medical Diagnostech developed rapid diagnostic products.",
        sourceIndexes: [0],
        sourceIds: ["source-1"],
        sourceTitles: ["Ashley Uys - Medical Diagnostech"],
        timestamps: ["00:42"],
        verificationStatus: "supported",
        editorialTreatment: "include",
      }],
      imageProvider: "local",
      ttsProvider: "local",
      imageLoading: true,
      imageUpgrading: true,
      autoOptimizing: true,
    };

    upsertLocalProjectBackup({
      id: "project-1",
      title: "Citation backup",
      config: { ...DEFAULT_CONFIG, topic: "Ashley Uys Medical Diagnostech" },
      sources: [source],
      chapters: [chapter],
      storyline: "Diagnostics",
      storyline_accepted: true,
      step: 6,
      overall_rating: 5,
    });

    const loaded = loadLocalProjectBackup("project-1");
    expect(loaded).not.toBeNull();

    const restoredSource = loaded!.sources[0];
    expect(restoredSource.url).toBe(source.url);
    expect(restoredSource.canonicalUrl).toBe(source.canonicalUrl);
    expect(restoredSource.provider).toBe(source.provider);
    expect(restoredSource.extractionProvider).toBe(source.extractionProvider);
    expect(restoredSource.retrievedAt).toBe(source.retrievedAt);
    expect(restoredSource.publishedAt).toBe(source.publishedAt);
    expect(restoredSource.creator).toBe(source.creator);
    expect(restoredSource.relevantTimestamp).toBe(source.relevantTimestamp);
    expect(restoredSource.contentHash).toBe(source.contentHash);
    expect(restoredSource.verified).toBe(true);
    expect(restoredSource.contentAvailability).toBe("speech_to_text");
    expect(restoredSource.evidenceReview).toBe("reviewed");
    expect(restoredSource.sourceKind).toBe("video");
    expect(restoredSource.content).toHaveLength(5000);

    const restoredChapter = loaded!.chapters[0];
    expect(restoredChapter.references).toEqual(chapter.references);
    expect(restoredChapter.evidenceClaims).toEqual(chapter.evidenceClaims);
    expect(restoredChapter.imageProvider).toBe("local");
    expect(restoredChapter.ttsProvider).toBe("local");
    expect(restoredChapter.imageLoading).toBe(false);
    expect(restoredChapter.imageUpgrading).toBe(false);
    expect(restoredChapter.autoOptimizing).toBe(false);
  });
});
