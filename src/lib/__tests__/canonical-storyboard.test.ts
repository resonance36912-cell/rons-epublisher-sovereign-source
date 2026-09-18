import { describe, expect, it } from "vitest";
import { buildCanonicalStoryboard, CANONICAL_STORYBOARD_SCHEMA } from "../canonical-storyboard";
import { parseStoryboardJson } from "../storyboard-import";

const config = {
  topic: "Evidence book",
  researchBasis: "evidence",
  depth: "standard",
  orientation: "portrait",
  visualMode: true,
} as any;

const chapters = [{
  id: "scene-1",
  title: "Opening",
  body: "Verified source text for the opening scene.",
  imagePrompt: "A source-grounded opening frame",
  references: ["https://example.test/source"],
}] as any;

const sources = [{
  id: "source-1", type: "url", title: "Source", status: "ready",
  sourceKind: "article", contentHash: "a".repeat(64), content: "Verified source text",
}] as any;
const editorState = {
  schema: "resonance-storyboard@3",
  config,
  storyline: "",
  storylineAccepted: false,
  overallRating: 0,
  chapters,
  sources,
  referenceImage: null,
  assets: [],
};

describe("canonical storyboard v3", () => {
  it("builds one source-grounded canonical scene with governed page ceiling", () => {
    const result = buildCanonicalStoryboard({
      title: "Evidence book", config, chapters, sources, editorState,
    });
    expect(result.schema).toBe(CANONICAL_STORYBOARD_SCHEMA);
    expect(result.settings.pageCeiling).toBe(12);
    expect(result.settings.inventedEventsAllowed).toBe(false);
    expect(result.project.sourceSha256).toBe("a".repeat(64));
    expect(result.scenes[0].evidenceStatus).toBe("source-grounded");
    expect(result.scenes[0].sourceText).toBe(chapters[0].body);
  });
  it("round-trips the embedded editor state through the existing importer", () => {
    const result = buildCanonicalStoryboard({
      title: "Evidence book", config, chapters, sources, editorState,
    });
    const parsed = parseStoryboardJson(JSON.stringify(result));
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe("Opening");
    expect(parsed.migrationNotes[0]).toContain(CANONICAL_STORYBOARD_SCHEMA);
  });
});
