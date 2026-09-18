import { z } from "zod";
import type { SlideChapter, StoryConfig, Source } from "@/components/storyforge/StoryForgeContext";
import { CANONICAL_STORYBOARD_SCHEMA, CanonicalStoryboardV3Schema } from "@/lib/canonical-storyboard";

/** Latest schema version this build writes. Bump when the export shape changes. */
export const CURRENT_SCHEMA_VERSION = 3;
/** Oldest schema version this build can still read. */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;
export const SCHEMA_PREFIX = "resonance-storyboard@";

/**
 * Human-readable changelog describing what each schema bump introduced.
 * Keyed by the *target* version (i.e. SCHEMA_CHANGELOG[2] explains v1 → v2).
 * Surfaced in the import review modal whenever an older file is auto-migrated.
 */
export const SCHEMA_CHANGELOG: Record<number, { title: string; changes: string[] }> = {
  2: {
    title: "v2 — Sources & reference image persistence",
    changes: [
      "Added a deduplicated `sources` list so citations re-link on import.",
      "Added an `assets` list capturing every chapter image URL for restore.",
      "Added top-level `referenceImage` so the visual style anchor survives round-trips.",
      "Added `exportedAt` timestamp and stricter schema validation.",
    ],
  },  3: {
    title: "v3 — Canonical book structure",
    changes: [
      "Added `bookStructure` with distinct story pages, chapters, cover, and source notes.",
      "Kept legacy `chapters` as an editor compatibility layer during migration.",
      "Added exact story-page targets and release-gate metadata through config.",
    ],
  },
};

/** Returns changelog entries for every version newer than `from`, up to `to`. */
export function getSchemaChangelog(from: number, to: number) {
  const entries: Array<{ version: number; title: string; changes: string[] }> = [];
  for (let v = from + 1; v <= to; v++) {
    const entry = SCHEMA_CHANGELOG[v];
    if (entry) entries.push({ version: v, ...entry });
  }
  return entries;
}

/**
 * Map a zod issue path (e.g. ["chapters", 3, "title"]) to a friendly UI
 * section label so users know exactly where in the editor to look.
 * Falls back to "General" for anything we don't recognize.
 */
export function pathToUISection(path: ReadonlyArray<string | number>): {
  section: string;
  hint: string;
} {
  const root = String(path[0] ?? "");
  switch (root) {
    case "schema":
    case "exportedAt":
    case "projectId":
      return { section: "File metadata", hint: "Top of the JSON file (schema/exportedAt/projectId)." };
    case "title":
      return { section: "Project title", hint: "Top-level `title` field." };
    case "config":
      return { section: "Project Settings", hint: "Step 1 — Settings panel (config.* fields)." };
    case "storyline":
    case "storylineAccepted":
      return { section: "Storyline editor", hint: "Step 3 — Storyline panel." };
    case "overallRating":
      return { section: "eBook rating", hint: "Star rating shown above the Visual Book." };
    case "chapters": {
      const idx = typeof path[1] === "number" ? path[1] : null;
      const field = path[2] != null ? String(path[2]) : null;
      const where = idx !== null ? ` — Chapter ${idx + 1}${field ? ` › ${field}` : ""}` : "";
      return { section: "Chapters list", hint: `Step 5 — Visual Book chapter cards${where}.` };
    }
    case "sources": {
      const idx = typeof path[1] === "number" ? path[1] : null;
      const where = idx !== null ? ` — Source ${idx + 1}` : "";
      return { section: "Sources panel", hint: `Step 2 — Discovery / Sources${where}.` };
    }
    case "referenceImage":
      return { section: "Reference image", hint: "Step 4 — Reference image picker (top of Visual Book)." };
    case "assets":
      return { section: "Asset list", hint: "Auto-built list of chapter image URLs (assets[])." };
    default:
      return { section: "General", hint: "Top-level field of the JSON payload." };
  }
}

/** Error thrown by `parseStoryboardJson`. `kind` lets the UI tailor the message. */
export class StoryboardImportError extends Error {
  kind:
    | "not-json"
    | "not-object"
    | "missing-schema"
    | "wrong-schema"
    | "outdated-schema"
    | "future-schema"
    | "validation";
  details?: string[];
  schemaVersion?: number;
  /** Validation issues grouped by UI section. Only set when `kind === "validation"`. */
  groupedIssues?: Array<{
    section: string;
    hint: string;
    issues: Array<{ path: string; message: string }>;
  }>;

  constructor(opts: {
    kind: StoryboardImportError["kind"];
    message: string;
    details?: string[];
    schemaVersion?: number;
    groupedIssues?: StoryboardImportError["groupedIssues"];
  }) {
    super(opts.message);
    this.name = "StoryboardImportError";
    this.kind = opts.kind;
    this.details = opts.details;
    this.schemaVersion = opts.schemaVersion;
    this.groupedIssues = opts.groupedIssues;
  }
}

/** Schema for the JSON file produced by `onDownloadStoryboardJson`. */
export const StoryboardImportSchema = z.object({
  schema: z.string().refine((s) => s.startsWith("resonance-storyboard@"), {
    message: "Unsupported schema. Expected a resonance-storyboard@N file.",
  }),
  exportedAt: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().max(500).optional(),
  config: z.record(z.string(), z.any()),
  storyline: z.string().max(200_000).optional().default(""),
  storylineAccepted: z.boolean().optional().default(false),
  overallRating: z.number().min(0).max(5).optional().default(0),
  bookStructure: z.object({
    schema: z.literal("resonance-book-structure@1"),
    cover: z.object({ title: z.string().max(500), imageUrl: z.string().nullable(), subtitle: z.string().max(1000).optional() }),
    storyPages: z.array(z.object({ id: z.string(), order: z.number().int().positive(), title: z.string().max(500), body: z.string().max(200_000) }).passthrough()).max(200),
    chapters: z.array(z.object({ id: z.string(), title: z.string().max(500), storyPageIds: z.array(z.string()) })).max(100),
    sourceNotes: z.array(z.object({ id: z.string(), title: z.string().max(2000), url: z.string().optional() }).passthrough()).max(500),
    targetStoryPages: z.number().int().positive().max(200).optional(),
  }).optional(),
  chapters: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().max(500),
        body: z.string().max(200_000),
        imagePrompt: z.string().max(4000).optional(),
        diagramPrompt: z.string().max(4000).optional(),
        notes: z.string().max(20_000).optional(),
        imageUrl: z.string().optional(),
        images: z.array(z.any()).optional(),
        imageLayout: z.string().optional(),
        imageProvider: z.string().optional(),
        references: z.array(z.string().max(2000)).optional(),
        rating: z.number().min(0).max(5).optional(),
        ratingComment: z.string().max(2000).optional(),
      }).passthrough()
    )
    .min(1, { message: "Storyboard must contain at least one chapter." })
    .max(200, { message: "Storyboard exceeds the 200-chapter import cap." }),
  // ── v2 additions (optional for back-compat with v1 exports) ───────
  sources: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.enum(["url", "file", "search"]),
        title: z.string().max(2000),
        content: z.string().max(2_000_000).optional(),
        status: z.enum(["pending", "processing", "ready", "error"]).optional(),
      }).passthrough()
    )
    .max(500)
    .optional(),
  referenceImage: z.string().nullable().optional(),
  assets: z
    .array(
      z.object({
        url: z.string().max(4000),
        kind: z.string().max(50).optional(),
      }).passthrough()
    )
    .max(2000)
    .optional(),
});

export type StoryboardImportPayload = z.infer<typeof StoryboardImportSchema>;

export type NormalizedImport = {
  config: Partial<StoryConfig>;
  storyline: string;
  storylineAccepted: boolean;
  overallRating: number;
  chapters: SlideChapter[];
  sources: Source[];
  referenceImage: string | null;
  assets: { url: string; kind?: string }[];
  bookStructure?: StoryboardImportPayload["bookStructure"];
  title?: string;
  exportedAt?: string;
  schemaVersion: number;
  /** Original schema version, before any internal v1→v2 migration. */
  originalSchemaVersion: number;
  /** Human-readable migration notes (empty when no migration ran). */
  migrationNotes: string[];
};

/**
 * Migrate a v1 payload up to v2 in-place: derive `assets` from chapter
 * imageUrls, promote `config.referenceImage` if present, and synthesize
 * URL-typed `sources` from any `chapter.references[]` entries that look
 * like URLs. Returns the list of human-readable changes applied.
 */
function migrateV1ToV2(payload: any): string[] {
  const notes: string[] = [];

  // 1) Reference image: v1 sometimes stashed it on config.
  if (payload.referenceImage == null && payload.config && typeof payload.config.referenceImage === "string") {
    payload.referenceImage = payload.config.referenceImage;
    notes.push("Promoted config.referenceImage → top-level referenceImage.");
  }
  if (payload.referenceImage === undefined) payload.referenceImage = null;

  // 2) Assets: rebuild from chapter image data so importers get the same
  //    pre-warm/restore behaviour as native v2 exports.
  if (!Array.isArray(payload.assets) || payload.assets.length === 0) {
    const urls = new Set<string>();
    for (const ch of payload.chapters || []) {
      if (typeof ch?.imageUrl === "string" && ch.imageUrl) urls.add(ch.imageUrl);
      if (Array.isArray(ch?.images)) {
        for (const img of ch.images) {
          if (img && typeof img.url === "string" && img.url) urls.add(img.url);
        }
      }
    }
    if (typeof payload.referenceImage === "string" && payload.referenceImage) {
      urls.add(payload.referenceImage);
    }
    if (urls.size > 0) {
      payload.assets = Array.from(urls).map((url) => ({
        url,
        kind: url === payload.referenceImage ? "reference" : "chapter-image",
      }));
      notes.push(`Rebuilt ${payload.assets.length} asset link(s) from chapter images.`);
    }
  }

  // 3) Sources: v1 had no sources block. Best-effort: synthesize URL-typed
  //    sources from any chapter.references entries that look like URLs so
  //    citation popovers still have something to link to.
  if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
    const urlSources: any[] = [];
    const seen = new Set<string>();
    for (const ch of payload.chapters || []) {
      const refs = Array.isArray(ch?.references) ? ch.references : [];
      for (const r of refs) {
        if (typeof r !== "string") continue;
        const trimmed = r.trim();
        if (!/^https?:\/\//i.test(trimmed)) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        urlSources.push({
          type: "url",
          title: trimmed,
          content: "",
          status: "ready",
        });
      }
    }
    if (urlSources.length > 0) {
      payload.sources = urlSources;
      notes.push(`Synthesized ${urlSources.length} URL source(s) from chapter references.`);
    }
  }

  return notes;
}


function migrateV2ToV3(payload: any): string[] {
  if (payload.bookStructure?.schema === "resonance-book-structure@1") return [];
  const storyPages = (payload.chapters || []).map((ch: any, index: number) => ({
    id: ch.id || `migrated-page-${index + 1}`, order: index + 1, title: ch.title || `Page ${index + 1}`,
    body: ch.body || "", imagePrompt: ch.imagePrompt, imageUrl: ch.imageUrl,
    images: ch.images, imageLayout: ch.imageLayout, references: ch.references, notes: ch.notes,
  }));
  payload.bookStructure = {
    schema: "resonance-book-structure@1",
    cover: { title: payload.title || payload.config?.topic || storyPages[0]?.title || "Untitled Project", imageUrl: payload.referenceImage || null },
    storyPages, chapters: [],
    sourceNotes: (payload.sources || []).filter((source: any) => source?.status === "ready").map((source: any) => ({
      id: source.id || source.title || "source", title: source.title || "Source", url: source.url,
      provider: source.provider, retrievedAt: source.retrievedAt, contentHash: source.contentHash, verified: source.verified,
    })),
    targetStoryPages: payload.config?.targetStoryPages,
  };
  return [`Derived canonical bookStructure with ${storyPages.length} story page(s); legacy chapters remain for editor compatibility.`];
}

/** Parse + validate raw JSON text. Throws `StoryboardImportError` with a friendly message on failure. */
export function parseStoryboardJson(text: string): NormalizedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StoryboardImportError({
      kind: "not-json",
      message: "This file isn't valid JSON. Make sure you're importing the .json file you exported from Resonance ePublisher.",
    });
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StoryboardImportError({
      kind: "not-object",
      message: "Unexpected file shape — the JSON root must be an object exported by Resonance ePublisher.",
    });
  }

  // ── Pre-flight: identify the schema version BEFORE running zod so we can
  // give a much friendlier error than a generic schema mismatch.
  const schemaTag = (raw as { schema?: unknown }).schema;
  if (typeof schemaTag !== "string" || schemaTag.length === 0) {
    throw new StoryboardImportError({
      kind: "missing-schema",
      message: "This file is missing a `schema` tag. Only storyboards exported from Resonance ePublisher can be imported.",
    });
  }
  if (schemaTag === CANONICAL_STORYBOARD_SCHEMA) {
    const canonical = CanonicalStoryboardV3Schema.safeParse(raw);
    if (!canonical.success) {
      throw new StoryboardImportError({
        kind: "validation",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        message: "Canonical storyboard JSON failed validation.",
        details: canonical.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      });
    }
    const normalized = parseStoryboardJson(JSON.stringify(canonical.data.editorState));
    return {
      ...normalized,
      title: canonical.data.project.title || normalized.title,
      exportedAt: canonical.data.project.generatedAt || normalized.exportedAt,
      migrationNotes: [`Imported ${CANONICAL_STORYBOARD_SCHEMA} canonical wrapper.`, ...normalized.migrationNotes],
    };
  }
  if (!schemaTag.startsWith(SCHEMA_PREFIX)) {
    throw new StoryboardImportError({
      kind: "wrong-schema",
      message: `Unrecognized schema "${schemaTag}". Expected "${CANONICAL_STORYBOARD_SCHEMA}" or a "${SCHEMA_PREFIX}N" file from Resonance ePublisher.`,
    });
  }
  const versionPart = schemaTag.slice(SCHEMA_PREFIX.length);
  const detectedVersion = parseInt(versionPart, 10);
  if (!Number.isFinite(detectedVersion) || detectedVersion <= 0) {
    throw new StoryboardImportError({
      kind: "wrong-schema",
      message: `Unrecognized schema version "${versionPart}".`,
    });
  }
  if (detectedVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    throw new StoryboardImportError({
      kind: "outdated-schema",
      schemaVersion: detectedVersion,
      message: `This storyboard was exported with an outdated format (v${detectedVersion}). Re-export it from a newer build (current: v${CURRENT_SCHEMA_VERSION}).`,
    });
  }
  if (detectedVersion > CURRENT_SCHEMA_VERSION) {
    throw new StoryboardImportError({
      kind: "future-schema",
      schemaVersion: detectedVersion,
      message: `This storyboard was exported with a newer format (v${detectedVersion}) than this build understands (max v${CURRENT_SCHEMA_VERSION}). Update Resonance ePublisher and try again.`,
    });
  }

  // ── Migrate older payloads UP to the current shape BEFORE schema validation
  // so the current schema sees a current-shaped object. The `raw` clone we mutate
  // here is what zod will validate.
  const migrationNotes: string[] = [];
  if (detectedVersion < CURRENT_SCHEMA_VERSION) {
    if (detectedVersion === 1) {
      migrationNotes.push(...migrateV1ToV2(raw as any));
    }
    if (detectedVersion <= 2) {
      migrationNotes.push(...migrateV2ToV3(raw as any));
    }
    // Stamp the raw payload so the schema check passes with the upgraded tag.
    (raw as any).schema = `${SCHEMA_PREFIX}${CURRENT_SCHEMA_VERSION}`;
    migrationNotes.unshift(`Auto-migrated from v${detectedVersion} → v${CURRENT_SCHEMA_VERSION}.`);
  }

  const result = StoryboardImportSchema.safeParse(raw);
  if (!result.success) {
    // Group issues by the UI section they belong to so the user can jump
    // straight to the panel that needs fixing.
    const groups = new Map<string, {
      section: string;
      hint: string;
      issues: Array<{ path: string; message: string }>;
    }>();
    for (const iss of result.error.issues) {
      const { section, hint } = pathToUISection(iss.path);
      const path = iss.path.length ? iss.path.map(String).join(".") : "(root)";
      const bucket = groups.get(section) ?? { section, hint, issues: [] };
      bucket.issues.push({ path, message: iss.message });
      groups.set(section, bucket);
    }
    const groupedIssues = Array.from(groups.values());
    const details: string[] = [];
    for (const g of groupedIssues) {
      details.push(`📍 ${g.section} — ${g.hint}`);
      for (const it of g.issues.slice(0, 5)) {
        details.push(`   • ${it.path}: ${it.message}`);
      }
      if (g.issues.length > 5) {
        details.push(`   • …and ${g.issues.length - 5} more in this section`);
      }
    }
    throw new StoryboardImportError({
      kind: "validation",
      schemaVersion: detectedVersion,
      message: `Storyboard JSON failed validation (v${detectedVersion}). Fix these sections in your file:\n${details.join("\n")}`,
      details,
      groupedIssues,
    });
  }

  const data = result.data;
  // Re-mint chapter ids so they can't collide with anything currently in the editor.
  const chapters: SlideChapter[] = data.chapters.map((ch) => ({
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    title: ch.title,
    body: ch.body,
    imagePrompt: ch.imagePrompt,
    diagramPrompt: ch.diagramPrompt,
    notes: ch.notes,
    imageUrl: ch.imageUrl,
    images: ch.images as SlideChapter["images"],
    imageLayout: ch.imageLayout as SlideChapter["imageLayout"],
    imageProvider: ch.imageProvider,
    references: ch.references,
    rating: ch.rating,
    ratingComment: ch.ratingComment,
  }));

  // Re-mint source ids the same way we re-mint chapter ids.
  const mkId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const sources: Source[] = (data.sources || []).map((s) => ({
    id: mkId(),
    type: s.type,
    title: s.title,
    content: s.content,
    status: s.status ?? "ready",
  }));

  // After migration the working schema version is always CURRENT_SCHEMA_VERSION.
  const schemaVersion = CURRENT_SCHEMA_VERSION;

  return {
    config: data.config as Partial<StoryConfig>,
    storyline: data.storyline,
    storylineAccepted: data.storylineAccepted,
    overallRating: data.overallRating,
    chapters,
    sources,
    referenceImage: data.referenceImage ?? null,
    assets: (data.assets ?? []).map((a) => ({ url: String(a.url), kind: a.kind })),
    bookStructure: data.bookStructure,
    title: data.title,
    exportedAt: data.exportedAt,
    schemaVersion,
    originalSchemaVersion: detectedVersion,
    migrationNotes,
  };
}

