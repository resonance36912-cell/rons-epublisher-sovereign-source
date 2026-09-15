import { describe, expect, it } from "vitest";
import { parseStoryboardJson } from "../storyboard-import";

function legacyPayload(version: 2 | 3) {
  return {
    schema: `resonance-storyboard@${version}`,
    title: "Pilot book",
    config: { topic: "Pilot book", depth: "summary", targetStoryPages: 1 },
    storyline: "",
    storylineAccepted: false,
    overallRating: 0,
    chapters: [{ id: "legacy-1", title: "Opening", body: "A substantive opening story page for schema migration testing." }],
    sources: [],
    referenceImage: null,
    assets: [],
  };
}

describe("storyboard schema v3", () => {
  it("migrates v2 editor chapters into canonical story pages", () => {
    const parsed = parseStoryboardJson(JSON.stringify(legacyPayload(2)));
    expect(parsed.originalSchemaVersion).toBe(2);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.bookStructure?.schema).toBe("resonance-book-structure@1");
    expect(parsed.bookStructure?.storyPages).toHaveLength(1);
    expect(parsed.bookStructure?.chapters).toHaveLength(0);
    expect(parsed.migrationNotes.join(" ")).toContain("canonical bookStructure");
  });
  it("accepts native v3 bookStructure without migration", () => {
    const payload = legacyPayload(3) as any;
    payload.bookStructure = {
      schema: "resonance-book-structure@1",
      cover: { title: "Pilot book", imageUrl: null },
      storyPages: [{ id: "page-1", order: 1, title: "Opening", body: "A substantive opening story page for native schema testing." }],
      chapters: [],
      sourceNotes: [],
      targetStoryPages: 1,
    };
    const parsed = parseStoryboardJson(JSON.stringify(payload));
    expect(parsed.originalSchemaVersion).toBe(3);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.migrationNotes).toEqual([]);
    expect(parsed.bookStructure?.storyPages[0].id).toBe("page-1");
  });
});