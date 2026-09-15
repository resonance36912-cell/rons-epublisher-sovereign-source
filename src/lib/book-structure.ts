import type {
  ChapterImage,
  ChapterImageLayout,
  SlideChapter,
  Source,
  StoryConfig,
} from "@/components/storyforge/StoryForgeContext";

export const BOOK_STRUCTURE_SCHEMA = "resonance-book-structure@1" as const;

export type BookStoryPage = {
  id: string;
  order: number;
  title: string;
  body: string;
  imagePrompt?: string;
  imageUrl?: string;
  images?: ChapterImage[];
  imageLayout?: ChapterImageLayout;
  references?: string[];
  notes?: string;
};

export type BookChapter = {
  id: string;
  title: string;
  storyPageIds: string[];
};
export type BookCover = {
  title: string;
  imageUrl: string | null;
  subtitle?: string;
};

export type BookSourceNote = {
  id: string;
  title: string;
  url?: string;
  provider?: string;
  retrievedAt?: string;
  contentHash?: string;
  verified?: boolean;
};

export type BookStructure = {
  schema: typeof BOOK_STRUCTURE_SCHEMA;
  cover: BookCover;
  storyPages: BookStoryPage[];
  chapters: BookChapter[];
  sourceNotes: BookSourceNote[];
  targetStoryPages?: number;
};

export type BookStructurePolicy = {
  expectedStoryPages?: number;
  maxStoryPages?: number;
  minWordsPerStoryPage?: number;
  maxWordsPerStoryPage?: number;
  requireImagePerStoryPage?: boolean;
  allowChapters?: boolean;
};
export type BookStructureIssue = {
  code: string;
  path: string;
  message: string;
};

export type BookStructureValidation = {
  ok: boolean;
  issues: BookStructureIssue[];
  warnings: BookStructureIssue[];
};

export function governedStoryPageLimit(config: Pick<StoryConfig, "depth">): number {
  if (config.depth === "summary") return 6;
  if (config.depth === "extensive") return 20;
  return 12;
}

export function defaultBookStructurePolicy(config: StoryConfig): BookStructurePolicy {
  return {
    expectedStoryPages: config.targetStoryPages,
    maxStoryPages: governedStoryPageLimit(config),
    minWordsPerStoryPage: config.storyPageMinWords,
    maxWordsPerStoryPage: config.storyPageMaxWords,
    requireImagePerStoryPage: config.requireStoryPageImage === true,
    allowChapters: true,
  };
}

function sourceNoteFromSource(source: Source): BookSourceNote {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    provider: source.provider,
    retrievedAt: source.retrievedAt,
    contentHash: source.contentHash,
    verified: source.verified,
  };
}
export function buildBookStructure(input: {
  pages: SlideChapter[];
  config: StoryConfig;
  sources?: Source[];
  referenceImage?: string | null;
}): BookStructure {
  const storyPages = input.pages.map((page, index): BookStoryPage => ({
    id: page.id,
    order: index + 1,
    title: page.title,
    body: page.body,
    imagePrompt: page.imagePrompt,
    imageUrl: page.imageUrl,
    images: page.images,
    imageLayout: page.imageLayout,
    references: page.references,
    notes: page.notes,
  }));

  return {
    schema: BOOK_STRUCTURE_SCHEMA,
    cover: {
      title: input.config.topic || storyPages[0]?.title || "Untitled Project",
      imageUrl: input.referenceImage || null,
    },
    storyPages,
    chapters: [],
    sourceNotes: (input.sources || [])
      .filter((source) => source.status === "ready")
      .map(sourceNoteFromSource),
    targetStoryPages: input.config.targetStoryPages,
  };
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
function looksLikeStructuralNoise(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^(true|false|null|undefined)$/i.test(v)) return true;
  if (/^\d{5,}$/.test(v)) return true;
  if (/^(main menu|google apps|send feedback|search in help|help)$/i.test(v)) return true;
  return false;
}

export function validateBookStructure(
  structure: BookStructure,
  policy: BookStructurePolicy = {},
): BookStructureValidation {
  const issues: BookStructureIssue[] = [];
  const warnings: BookStructureIssue[] = [];
  const addIssue = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const addWarning = (code: string, path: string, message: string) => warnings.push({ code, path, message });

  if (structure.schema !== BOOK_STRUCTURE_SCHEMA) {
    addIssue("schema", "schema", `Expected ${BOOK_STRUCTURE_SCHEMA}.`);
  }
  if (!structure.cover.title.trim()) {
    addIssue("cover-title", "cover.title", "Cover title is required.");
  }
  if (structure.storyPages.length === 0) {
    addIssue("no-story-pages", "storyPages", "At least one story page is required.");
  }
  if (policy.expectedStoryPages != null && structure.storyPages.length !== policy.expectedStoryPages) {
    addIssue("story-page-count", "storyPages", `Expected exactly ${policy.expectedStoryPages} story pages; found ${structure.storyPages.length}.`);
  }
  if (policy.maxStoryPages != null && structure.storyPages.length > policy.maxStoryPages) {
    addIssue("story-page-limit", "storyPages", `Maximum is ${policy.maxStoryPages} story pages; found ${structure.storyPages.length}. Regenerate instead of truncating.`);
  }
  if (policy.allowChapters === false && structure.chapters.length > 0) {
    addIssue("chapters-not-allowed", "chapters", "This book specification does not permit chapter containers.");
  }
  if (policy.minWordsPerStoryPage != null && policy.maxWordsPerStoryPage != null && policy.minWordsPerStoryPage > policy.maxWordsPerStoryPage) {
    addIssue("word-range", "policy", `Minimum words (${policy.minWordsPerStoryPage}) cannot exceed maximum words (${policy.maxWordsPerStoryPage}).`);
  }

  const ids = new Set<string>();
  structure.storyPages.forEach((page, index) => {
    const path = `storyPages.${index}`;
    if (!page.id.trim()) addIssue("page-id", `${path}.id`, "Story page id is required.");
    if (ids.has(page.id)) addIssue("duplicate-page-id", `${path}.id`, `Duplicate story page id: ${page.id}.`);
    ids.add(page.id);
    if (page.order !== index + 1) addIssue("page-order", `${path}.order`, `Expected order ${index + 1}; found ${page.order}.`);
    if (!page.title.trim()) addIssue("page-title", `${path}.title`, "Story page title is required.");
    if (looksLikeStructuralNoise(page.title) || looksLikeStructuralNoise(page.body)) {
      addIssue("structural-noise", path, "Story page contains navigation, boolean, id, or UI-chrome noise.");
    }

    const words = countWords(page.body);
    if (policy.minWordsPerStoryPage != null && words < policy.minWordsPerStoryPage) {
      addIssue("page-too-short", `${path}.body`, `Expected at least ${policy.minWordsPerStoryPage} words; found ${words}.`);
    }
    if (policy.maxWordsPerStoryPage != null && words > policy.maxWordsPerStoryPage) {
      addIssue("page-too-long", `${path}.body`, `Expected at most ${policy.maxWordsPerStoryPage} words; found ${words}.`);
    }
    if (policy.requireImagePerStoryPage && !page.imageUrl && !(page.images && page.images.length > 0)) {
      addIssue("page-image-required", path, "This release profile requires one approved image per story page.");
    } else if (!page.imageUrl && !(page.images && page.images.length > 0)) {
      addWarning("page-image-missing", path, "Story page has no image asset yet.");
    }
  });
  for (const [chapterIndex, chapter] of structure.chapters.entries()) {
    const chapterPath = `chapters.${chapterIndex}`;
    if (!chapter.id.trim()) addIssue("chapter-id", `${chapterPath}.id`, "Chapter id is required.");
    if (!chapter.title.trim()) addIssue("chapter-title", `${chapterPath}.title`, "Chapter title is required.");
    for (const pageId of chapter.storyPageIds) {
      if (!ids.has(pageId)) {
        addIssue("chapter-page-ref", `${chapterPath}.storyPageIds`, `Unknown story page id: ${pageId}.`);
      }
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

export function assertBookStructureReadyForExport(
  structure: BookStructure,
  policy: BookStructurePolicy = {},
): BookStructureValidation {
  const result = validateBookStructure(structure, policy);
  if (!result.ok) {
    const summary = result.issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Book release gate failed. ${summary}`);
  }
  return result;
}
