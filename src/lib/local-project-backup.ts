import type { Source, SlideChapter, StoryConfig } from "@/components/storyforge/StoryForgeContext";

const LOCAL_PROJECTS_KEY = "storyforge:local-projects:v1";

export type LocalProjectBackup = {
  id: string;
  title: string;
  config: StoryConfig;
  sources: Source[];
  chapters: SlideChapter[];
  storyline: string;
  storyline_accepted: boolean;
  step: number;
  overall_rating?: number;
  created_at: string;
  updated_at: string;
};

type LocalProjectStore = Record<string, LocalProjectBackup>;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readStore(): LocalProjectStore {
  if (!canUseLocalStorage()) return {};

  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: LocalProjectStore) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(store));
}

function sanitizeSources(sources: Source[]): Source[] {
  return sources.map((source) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    content: source.content ? source.content.slice(0, 5000) : undefined,
    status: source.status,
  }));
}

function sanitizeChapters(chapters: SlideChapter[]): SlideChapter[] {
  return chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    body: chapter.body,
    imagePrompt: chapter.imagePrompt,
    diagramPrompt: chapter.diagramPrompt,
    notes: chapter.notes,
    imageUrl: chapter.imageUrl,
    images: chapter.images,
    imageLayout: chapter.imageLayout,
    references: chapter.references,
    rating: chapter.rating,
    ratingComment: chapter.ratingComment,
  }));
}

export function hasMeaningfulProjectContent(project: {
  title: string;
  sources: Source[];
  chapters: SlideChapter[];
  storyline: string;
  config: StoryConfig;
}): boolean {
  return Boolean(
    project.title.trim() ||
    project.config.topic.trim() ||
    project.sources.length ||
    project.chapters.length ||
    project.storyline.trim()
  );
}

export function upsertLocalProjectBackup(project: {
  id: string;
  title: string;
  config: StoryConfig;
  sources: Source[];
  chapters: SlideChapter[];
  storyline: string;
  storyline_accepted: boolean;
  step: number;
  overall_rating?: number;
}) {
  if (!canUseLocalStorage() || !hasMeaningfulProjectContent(project)) return;

  const store = readStore();
  const existing = store[project.id];
  const timestamp = new Date().toISOString();

  store[project.id] = {
    id: project.id,
    title: project.title,
    config: project.config,
    sources: sanitizeSources(project.sources),
    chapters: sanitizeChapters(project.chapters),
    storyline: project.storyline,
    storyline_accepted: project.storyline_accepted,
    step: project.step,
    overall_rating: project.overall_rating || 0,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };

  writeStore(store);
}

export function listLocalProjectBackups(): LocalProjectBackup[] {
  return Object.values(readStore()).sort((a, b) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export function loadLocalProjectBackup(projectId: string): LocalProjectBackup | null {
  return readStore()[projectId] || null;
}

export function deleteLocalProjectBackup(projectId: string) {
  if (!canUseLocalStorage()) return;

  const store = readStore();
  if (!store[projectId]) return;

  delete store[projectId];
  writeStore(store);
}