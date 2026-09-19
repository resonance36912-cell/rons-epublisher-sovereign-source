import { describe, expect, it } from "vitest";
import { normaliseExtractedSources, qualifyDiscoverySources, repairMissingSourceCitations, RESEARCH_SOURCE_LIMIT } from "@/lib/research-source-quality";
import type { Source } from "@/components/storyforge/StoryForgeContext";

const topic = "The History of Cape Coloured People";
const fixture = [
  { url: "https://history.google.com/", title: "Welcome to My Activity", description: "Google activity controls", type: "web" as const },
  { url: "https://www.history.com/", title: "HISTORY", description: "American history and television", type: "web" as const },
  { url: "https://en.wikipedia.org/wiki/History", title: "History", description: "The systematic study of the past", type: "web" as const },
  { url: "https://www.youtube.com/@history", title: "HISTORY", description: "Official HISTORY channel", type: "web" as const },
  { url: "https://sahistory.org.za/", title: "South African History Online", description: "South African history archive", type: "web" as const },
  { url: "https://en.wikipedia.org/wiki/Cape_Coloureds", title: "Cape Coloureds", description: "Cape Coloured community in South Africa", type: "web" as const },
  { url: "https://en.wikipedia.org/wiki/Coloureds", title: "Coloureds", description: "Multiracial communities in Southern Africa including the Cape", type: "web" as const },
  { url: "https://en.wikipedia.org/wiki/Cape_Malays", title: "Cape Malays", description: "Cape Malay community and history", type: "web" as const },
  { url: "https://en.wikipedia.org/wiki/Hanover_Park,_Cape_Town", title: "Hanover Park, Cape Town", description: "Cape Town community", type: "web" as const },
  { url: "https://www.youtube.com/watch?v=cape001", title: "History of Cape Coloured People", description: "Cape Coloured history documentary", type: "youtube" as const },
  { url: "https://www.youtube.com/watch?v=griqua1", title: "Griqua People of the Cape", description: "Griqua history in the Cape", type: "youtube" as const },
  { url: "https://www.youtube.com/watch?v=cape002", title: "Cape Coloured Identity", description: "History and identity in Cape Town", type: "youtube" as const },
  { url: "https://example.org/namibia-coloureds", title: "Coloured communities in Namibia", description: "Regional context beyond the Cape", type: "web" as const },
  { url: "https://example.org/rehoboth-basters", title: "Rehoboth Basters", description: "Regional mixed-heritage history", type: "web" as const },
];

describe("sovereign research source quality", () => {
  it("filters generic noise, preserves topical candidates, deduplicates, and respects the governed selection limit", () => {
    const ranked = qualifyDiscoverySources(topic, [...fixture, fixture[5]]);
    expect(ranked.filter((s) => s.selected).length).toBeLessThanOrEqual(RESEARCH_SOURCE_LIMIT);
    expect(ranked.filter((s) => s.canonicalUrl.includes("Cape_Coloureds"))).toHaveLength(1);

    const byTitle = new Map(ranked.map((s) => [s.title, s]));
    expect(byTitle.get("Welcome to My Activity")?.reviewGroup).toBe("excluded");
    expect(byTitle.get("History")?.reviewGroup).toBe("excluded");
    expect(byTitle.get("HISTORY")?.selected).toBe(false);
    expect(byTitle.get("South African History Online")?.reviewGroup).toBe("needs_review");
    expect(byTitle.get("Cape Coloureds")?.reviewGroup).toBe("recommended");
    expect(byTitle.get("History of Cape Coloured People")?.selected).toBe(true);
    expect(byTitle.get("Coloureds")?.reviewGroup).toBe("needs_review");
    expect(byTitle.get("Cape Malays")?.reviewGroup).toBe("needs_review");
    expect(byTitle.get("Hanover Park, Cape Town")?.reviewGroup).toBe("needs_review");
    expect(byTitle.get("Coloured communities in Namibia")?.reviewGroup).toBe("needs_review");
  });

  it("classifies YouTube channel pages separately and never as web articles", () => {
    const ranked = qualifyDiscoverySources(topic, fixture);
    const channel = ranked.find((s) => s.url.includes("youtube.com/@history"));
    expect(channel?.sourceKind).toBe("channel");
    expect(channel?.type).toBe("youtube");
    expect(channel?.reviewGroup).toBe("excluded");
  });
});

describe("truthful extraction readiness", () => {
  it("keeps metadata-only video results out of the usable evidence set", () => {
    const source: Source = {
      id: "video-1", type: "search", title: "Cape Coloured documentary", url: "https://www.youtube.com/watch?v=cape001",
      provider: "youtube-public", extractionProvider: "youtube-public-metadata", transcriptAvailable: false,
      content: "Cape Coloured documentary\n\nOpen Nova note: no usable public caption track was available; this source contains video metadata only.",
      status: "ready",
    };
    const [result] = normaliseExtractedSources(topic, [source], qualifyDiscoverySources(topic, fixture));
    expect(result.status).toBe("error");
    expect(result.contentAvailability).toBe("metadata_only");
    expect(result.content).toBeUndefined();
  });


  it("recovers a canonical citation from a unique discovery-title match", () => {
    const source: Source = {
      id: "legacy-title-only",
      type: "search",
      title: "History of Cape Coloured People",
      status: "error",
    };
    const [result] = normaliseExtractedSources(topic, [source], qualifyDiscoverySources(topic, fixture));
    expect(result.url).toBe("https://www.youtube.com/watch?v=cape001");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=cape001");
  });

  it("repairs legacy title-only search records without altering already cited sources", () => {
    const discovered = qualifyDiscoverySources(topic, fixture);
    const legacy: Source = {
      id: "legacy-repair",
      type: "search",
      title: "History of Cape Coloured People",
      status: "ready",
      content: "Evidence content",
    };
    const cited: Source = {
      id: "already-cited",
      type: "search",
      title: "Cape Coloured Identity",
      url: "https://example.org/already-cited",
      status: "ready",
      content: "Evidence content",
    };
    const result = repairMissingSourceCitations([legacy, cited], discovered);
    expect(result.repairedCount).toBe(1);
    expect(result.sources[0].canonicalUrl).toBe("https://www.youtube.com/watch?v=cape001");
    expect(result.sources[1].url).toBe("https://example.org/already-cited");
  });

  it("recovers a missing citation from the requested URL order when extraction preserves job order", () => {
    const source: Source = {
      id: "legacy-request-only",
      type: "search",
      title: "Recovered source title",
      status: "error",
    };
    const [result] = normaliseExtractedSources(topic, [source], [], ["https://example.org/recovered?utm_source=test"]);
    expect(result.url).toBe("https://example.org/recovered");
    expect(result.canonicalUrl).toBe("https://example.org/recovered");
  });

  it("routes short topical extracts to manual review instead of treating length as credibility", () => {
    const text = Array.from({ length: 8 }, (_, i) => `Cape Coloured history source note ${i + 1} describes community formation and change in the Cape.`).join(" ");
    const source: Source = { id: "short", type: "search", title: "Cape Coloured note", url: "https://example.org/short", content: text, status: "ready" };
    const [result] = normaliseExtractedSources(topic, [source]);
    expect(result.status).toBe("processing");
    expect(result.contentAvailability).toBe("text_extracted");
    expect(result.content).toContain("Cape Coloured");
    expect(result.diagnostic).toMatch(/manual review/i);
  });

  it("rejects teaser-heavy index pages and strips diagnostics/promotional prose", () => {
    const teasers = Array.from({ length: 8 }, (_, i) => `Headline ${i + 1} about Cape community…`).join("\n\n");
    const index: Source = { id: "index", type: "search", title: "Cape history index", url: "https://example.org/cape", content: teasers, status: "ready" };
    const [indexResult] = normaliseExtractedSources(topic, [index]);
    expect(indexResult.status).toBe("error");
    expect(indexResult.contentAvailability).toBe("failed");

    const prose = Array.from({ length: 12 }, (_, i) => `Cape Coloured communities developed through a complex history at the Cape, with social and political changes shaping identity across period ${i + 1}. This paragraph provides substantive historical context and is intentionally long enough for the extraction-quality threshold.`).join("\n\n");
    const cleanable: Source = { id: "clean", type: "search", title: "Cape Coloured history", url: "https://example.org/article", content: `Open Nova note: internal diagnostic\n\nPlease visit our Patreon and subscribe.\n\n${prose}`, status: "ready" };
    const [cleaned] = normaliseExtractedSources(topic, [cleanable]);
    expect(cleaned.status).toBe("ready");
    expect(cleaned.content).not.toMatch(/Open Nova|Patreon/i);
  });
});
