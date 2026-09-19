import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SlideChapter, type Source, type StoryConfig } from "@/components/storyforge/StoryForgeContext";
import {
  analysePublicationReadiness,
  applyReadinessAutofix,
  computeManuscriptRevision,
  manuscriptApprovedForNarration,
  splitDenseParagraphs,
} from "@/lib/publication-readiness";

const source: Source = {
  id: "s1",
  type: "url",
  title: "Interview source",
  url: "https://example.com/interview",
  content: "Verified interview transcript with relevant evidence.",
  status: "ready",
  verified: true,
};

function chapter(overrides: Partial<SlideChapter> = {}): SlideChapter {
  return {
    id: overrides.id || "c1",
    title: overrides.title || "A Distinct Chapter",
    body: overrides.body || "A grounded paragraph about a documented event.",
    references: overrides.references || ["Publisher · Interview source · https://example.com/interview"],
    ...overrides,
  };
}

function config(overrides: Partial<StoryConfig> = {}): StoryConfig {
  return { ...DEFAULT_CONFIG, topic: "Ashley Uys", ...overrides };
}

describe("publication readiness", () => {
  it("flags transcript artifacts and provides a safe cleanup", () => {
    const ch = chapter({
      body: "00:15 Host: Good morning. Welcome to the programme.\n\nGuest: The laboratory opened after the pilot.",
    });
    const issues = analysePublicationReadiness([ch], [source], config());
    const finding = issues.find((item) => item.id.includes("transcript-artifact"));

    expect(finding?.severity).toBe("critical");
    expect(finding?.autofix).toBe("clean_transcript");

    const fixed = applyReadinessAutofix(ch, "clean_transcript");
    expect(fixed.body).not.toMatch(/Host:|Guest:|00:15/);
    expect(fixed.body).toContain("The laboratory opened after the pilot.");
  });

  it("blocks unapproved first-person autobiography framing", () => {
    const issues = analysePublicationReadiness(
      [chapter()],
      [source],
      config({
        publicationType: "autobiography",
        narrativePerspective: "first_person",
        firstPersonSubjectApproved: false,
      }),
    );

    expect(issues.some((item) => item.id.includes("first-person-unapproved") && item.severity === "critical")).toBe(true);
  });

  it("flags possible name, age and relative-date inconsistencies without choosing a correction", () => {
    const chapters = [
      chapter({
        id: "c1",
        body: "Ashley Uys said the venture began at age 23 seven years ago.",
      }),
      chapter({
        id: "c2",
        title: "Building the Venture",
        body: "Ashley Ace later described having started the business at age 24.",
      }),
    ];
    const issues = analysePublicationReadiness(chapters, [source], config());

    expect(issues.some((item) => item.id.includes("name-variant-ashley"))).toBe(true);
    expect(issues.some((item) => item.id.includes("milestone-age-conflict"))).toBe(true);
    expect(issues.some((item) => item.id.includes("relative-date"))).toBe(true);
  });

  it("ties narration approval to the exact current manuscript revision", () => {
    const chapters = [chapter()];
    const revision = computeManuscriptRevision(chapters);
    const approved = config({ approvedManuscriptRevision: revision });

    expect(manuscriptApprovedForNarration(chapters, approved)).toBe(true);
    expect(manuscriptApprovedForNarration(
      [{ ...chapters[0], body: chapters[0].body + " Changed." }],
      approved,
    )).toBe(false);
  });

  it("splits dense prose into readable paragraphs without changing sentence text", () => {
    const input = [
      "Sentence one.", "Sentence two.", "Sentence three.",
      "Sentence four.", "Sentence five.", "Sentence six.",
    ].join(" ");
    const output = splitDenseParagraphs(input, 3);

    expect(output).toContain("Sentence one. Sentence two. Sentence three.");
    expect(output).toContain("\n\n");
    expect(output.replace(/\n\n/g, " ")).toBe(input);
  });

  it("flags and safely removes search-query bibliography placeholders", () => {
    const ch = chapter({
      references: [
        "Search: Ashley biotech interview",
        "Publisher · Interview source · 2020 · https://example.com/interview",
      ],
    });
    const issues = analysePublicationReadiness([ch], [source], config());
    const finding = issues.find((item) => item.id.includes("search-reference"));
    expect(finding?.severity).toBe("critical");
    expect(finding?.autofix).toBe("remove_search_reference");

    const fixed = applyReadinessAutofix(ch, "remove_search_reference");
    expect(fixed.references).toEqual([
      "Publisher · Interview source · 2020 · https://example.com/interview",
    ]);
  });

  it("hard-fails chapters that are predominantly verbatim from one source", () => {
    const verbatim = "I built the first prototype in a small workshop before the team expanded the process into a validated production method for regional diagnostic access.";
    const src = { ...source, content: verbatim + " " + verbatim };
    const ch = chapter({ body: verbatim + " " + verbatim });
    const issues = analysePublicationReadiness([ch], [src], config());
    expect(issues.some((item) => item.id.includes("verbatim-source") && item.severity === "critical")).toBe(true);
  });

  it("detects interviewer leakage, chronology regression and sensitive content", () => {
    const ch = chapter({
      body: "Welcome to this week's episode. In 2021 the programme expanded. In 2018 my sister died after violence in the community.",
    });
    const issues = analysePublicationReadiness([ch], [source], config());
    expect(issues.some((item) => item.id.includes("interviewer-marker"))).toBe(true);
    expect(issues.some((item) => item.id.includes("chronology-regression"))).toBe(true);
    expect(issues.some((item) => item.id.includes("sensitive-content"))).toBe(true);
  });

  it("requires strong first-person consistency for approved autobiography mode", () => {
    const body = Array.from({ length: 12 }, (_, i) => i < 2
      ? "I remember building the laboratory with my team."
      : "The company expanded its work across the region.").join(" ");
    const issues = analysePublicationReadiness(
      [chapter({ body })],
      [source],
      config({ publicationType: "autobiography", narrativePerspective: "first_person", firstPersonSubjectApproved: true }),
    );
    expect(issues.some((item) => item.id.includes("first-person-ratio") && item.severity === "critical")).toBe(true);
  });

  it("warns when reference metadata lacks a publication date", () => {
    const datedSource = { ...source, publishedAt: undefined };
    const ch = chapter({ references: ["Interview source · https://example.com/interview"] });
    const issues = analysePublicationReadiness([ch], [datedSource], config());
    expect(issues.some((item) => item.id.includes("incomplete-reference"))).toBe(true);
  });

  it("requires source linkage for claims marked supported and surfaces unresolved evidence", () => {
    const ch = chapter({
      evidenceClaims: [
        {
          id: "claim-1",
          claim: "The company launched the assay.",
          sourceIndexes: [],
          verificationStatus: "supported",
          editorialTreatment: "include",
        },
        {
          id: "claim-2",
          claim: "The milestone year is disputed.",
          sourceIndexes: [0],
          verificationStatus: "conflicting",
          editorialTreatment: "qualify",
        },
      ],
    });
    const issues = analysePublicationReadiness([ch], [source], config());
    expect(issues.some((item) => item.id.includes("claim-without-source") && item.severity === "critical")).toBe(true);
    expect(issues.some((item) => item.id.includes("evidence-conflicting") && item.severity === "warning")).toBe(true);
  });
});

