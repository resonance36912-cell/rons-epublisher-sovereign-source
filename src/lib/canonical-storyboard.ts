import { z } from "zod";
import type { SlideChapter, Source, StoryConfig } from "@/components/storyforge/StoryForgeContext";

export const CANONICAL_STORYBOARD_SCHEMA = "epublisher.storyboard.v3" as const;

const TimeRangeSchema = z.object({
  start: z.string().nullable(),
  end: z.string().nullable(),
});

export const CanonicalStoryboardV3Schema = z.object({
  schema: z.literal(CANONICAL_STORYBOARD_SCHEMA),
  project: z.object({
    title: z.string(),
    projectId: z.string().nullable().optional(),
    sourceType: z.string(),
    sourceSha256: z.string().nullable(),
    sourceHashes: z.array(z.string()),
    generatedAt: z.string(),
  }).passthrough(),
  settings: z.object({
    mode: z.enum(["summary", "standard", "extensive"]),
    pageCeiling: z.number().int().positive(),
    sceneDensity: z.literal("relevance-controlled"),
    inventedEventsAllowed: z.literal(false),
  }).passthrough(),
  scenes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    title: z.string(),
    sourceRange: z.object({ startChar: z.number().int().nonnegative(), endChar: z.number().int().nonnegative() }),
    timeRange: TimeRangeSchema,
    sourceText: z.string(),
    summary: z.string(),
    summarySource: z.enum(["chapter-notes", "source-excerpt", "title-only"]),
    storyboardPrompt: z.string(),
    visualFrameDescription: z.string(),
    dialogue: z.array(z.string()),
    evidenceStatus: z.enum(["source-grounded", "topic-only"]),
    relevanceScore: z.number().min(0).max(1).nullable(),
    qualityFlags: z.array(z.string()),
    frame: z.object({ url: z.string(), kind: z.string() }).nullable(),
  }).passthrough()).min(1).max(200),
  editorState: z.object({
    schema: z.string(),
    chapters: z.array(z.any()),
    config: z.record(z.string(), z.any()),
  }).passthrough(),
}).passthrough();

export type CanonicalStoryboardV3 = z.infer<typeof CanonicalStoryboardV3Schema>;

const PAGE_CEILINGS: Record<StoryConfig["depth"], number> = {
  summary: 6,
  standard: 12,
  extensive: 20,
};
function deriveSourceType(sources: Source[]): string {
  const kinds = new Set(sources.map((source) => source.sourceKind || source.type));
  if (kinds.size === 0) return "text";
  if (kinds.size === 1) return String(Array.from(kinds)[0]);
  return "mixed";
}

function sceneSummary(chapter: SlideChapter): { text: string; source: "chapter-notes" | "source-excerpt" | "title-only" } {
  const notes = (chapter.notes || "").trim();
  if (notes) return { text: notes.slice(0, 600), source: "chapter-notes" };
  const body = (chapter.body || "").trim();
  if (body) return { text: body.replace(/\s+/g, " ").slice(0, 600), source: "source-excerpt" };
  return { text: chapter.title || "Untitled scene", source: "title-only" };
}

export type BuildCanonicalStoryboardInput = {
  projectId?: string | null;
  title: string;
  config: StoryConfig;
  chapters: SlideChapter[];
  sources: Source[];
  editorState: Record<string, unknown>;
};

export function buildCanonicalStoryboard(input: BuildCanonicalStoryboardInput): CanonicalStoryboardV3 {
  let cursor = 0;
  const evidenceStatus = input.config.researchBasis === "evidence" ? "source-grounded" : "topic-only";
  const sourceHashes = input.sources.map((source) => source.contentHash).filter((hash): hash is string => Boolean(hash));
  const scenes = input.chapters.map((chapter, index) => {
    const sourceText = chapter.body || "";
    const startChar = cursor;
    const endChar = startChar + sourceText.length;
    cursor = endChar + 2;
    const summary = sceneSummary(chapter);
    const prompt = (chapter.imagePrompt || "").trim();
    const flags: string[] = [];
    if (!prompt) flags.push("missing-image-prompt");
    if (!chapter.references?.length && evidenceStatus === "source-grounded") flags.push("missing-scene-reference");
    if (!sourceText.trim()) flags.push("empty-source-text");
    const firstMedia = chapter.images?.[0];
    const frameUrl = firstMedia?.url || chapter.imageUrl || null;
    return {
      sceneNumber: index + 1,
      title: chapter.title || `Scene ${index + 1}`,
      sourceRange: { startChar, endChar },
      timeRange: { start: null, end: null },
      sourceText,
      summary: summary.text,
      summarySource: summary.source,
      storyboardPrompt: prompt,
      visualFrameDescription: prompt,
      dialogue: [],
      evidenceStatus,
      relevanceScore: null,
      qualityFlags: flags,
      frame: frameUrl ? { url: frameUrl, kind: firstMedia?.kind || "image" } : null,
    };
  });
  const payload: CanonicalStoryboardV3 = {
    schema: CANONICAL_STORYBOARD_SCHEMA,
    project: {
      title: input.title || "Untitled Project",
      projectId: input.projectId || null,
      sourceType: deriveSourceType(input.sources),
      sourceSha256: sourceHashes.length === 1 ? sourceHashes[0] : null,
      sourceHashes,
      generatedAt: new Date().toISOString(),
    },
    settings: {
      mode: input.config.depth,
      pageCeiling: PAGE_CEILINGS[input.config.depth],
      sceneDensity: "relevance-controlled",
      inventedEventsAllowed: false,
      orientation: input.config.orientation,
      visualMode: input.config.visualMode,
      researchBasis: input.config.researchBasis || "topic_only",
    },
    scenes,
    editorState: input.editorState,
  };
  return CanonicalStoryboardV3Schema.parse(payload);
}
