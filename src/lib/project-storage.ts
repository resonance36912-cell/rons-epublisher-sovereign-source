import { supabase } from "@/integrations/supabase/client";
import type { Source, SlideChapter, StoryConfig } from "@/components/storyforge/StoryForgeContext";
import { DEFAULT_CONFIG } from "@/components/storyforge/StoryForgeContext";
import {
  deleteLocalProjectBackup,
  listLocalProjectBackups,
  loadLocalProjectBackup,
  upsertLocalProjectBackup,
} from "@/lib/local-project-backup";
import {
  createAuditRequestId,
  logUserStorageListing,
  logUserStorageView,
} from "@/lib/storage-audit";
import { signChapterImageUrl, signChapterImageUrls } from "@/lib/signed-image-url";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

// ── Image helpers ────────────────────────────────────────────────────────

function isDataUrl(url: string): boolean {
  return url.startsWith("data:");
}


function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/png";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function uploadChapterImage(
  userId: string,
  projectId: string,
  chapterId: string,
  dataUrl: string,
  suffix?: string
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  // Preserve common image and video extensions so the signer + <video>
  // element can negotiate the right MIME type. Anything unrecognized falls
  // back to jpg (legacy default).
  const t = blob.type.toLowerCase();
  const ext =
    t.includes("png") ? "png" :
    t.includes("webp") ? "webp" :
    t.includes("gif") ? "gif" :
    t === "video/mp4" ? "mp4" :
    t === "video/webm" ? "webm" :
    t === "video/quicktime" ? "mov" :
    t === "video/x-m4v" || t === "video/mp4v-es" ? "m4v" :
    "jpg";
  const name = suffix ? `${chapterId}-${suffix}` : chapterId;
  const path = `${userId}/${projectId}/${name}.${ext}`;

  const { error } = await supabase.storage
    .from("chapter-images")
    .upload(path, blob, { upsert: true, contentType: blob.type });

  if (error) throw new Error(`Image upload failed: ${error.message}`);

  // Bucket is private — return a short-lived signed URL the UI can use.
  return signChapterImageUrl(path);
}

// ── Types ────────────────────────────────────────────────────────────────

export type StoredProject = {
  id: string;
  title: string;
  config: StoryConfig;
  sources: Source[];
  chapters: SlideChapter[];
  storyline: string;
  storyline_accepted: boolean;
  step: number;
  overall_rating: number;
  created_at: string;
  updated_at: string;
};

export type ProjectListItem = {
  id: string;
  title: string;
  step: number;
  created_at: string;
  updated_at: string;
  chapter_count: number;
  topic: string;
  localOnly?: boolean;
};

// ── API ──────────────────────────────────────────────────────────────────

/** List all projects for current user (lightweight) */
export async function listProjects(): Promise<ProjectListItem[]> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    return listLocalProjectBackups().map((backup) => ({
      id: backup.id,
      title: backup.title,
      step: backup.step,
      created_at: backup.created_at,
      updated_at: backup.updated_at,
      chapter_count: backup.chapters.length,
      topic: backup.config?.topic || backup.title,
      localOnly: true,
    }));
  }

  const { data, error } = await supabase
    .from("storybook_projects")
    .select("id, title, step, created_at, updated_at, config, chapters")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  const remoteProjects = (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    step: row.step,
    created_at: row.created_at,
    updated_at: row.updated_at,
    chapter_count: Array.isArray(row.chapters) ? row.chapters.length : 0,
    topic: (row.config as any)?.topic || row.title,
  }));

  const merged = new Map<string, ProjectListItem>(remoteProjects.map((project) => [project.id, project]));

  for (const backup of listLocalProjectBackups()) {
    if (!merged.has(backup.id)) {
      merged.set(backup.id, {
        id: backup.id,
        title: backup.title,
        step: backup.step,
        created_at: backup.created_at,
        updated_at: backup.updated_at,
        chapter_count: Array.isArray(backup.chapters) ? backup.chapters.length : 0,
        topic: backup.config?.topic || backup.title,
        localOnly: true,
      });
    }
  }

  const sorted = Array.from(merged.values()).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  // Audit: the gallery surfaces chapter-image thumbnails for every project
  // the user owns. Log a single aggregated "view" row. Best-effort.
  const totalChapters = sorted.reduce((s, p) => s + (p.chapter_count || 0), 0);
  void logUserStorageView({
    bucket: "chapter-images",
    scopePath: "",
    fileCount: totalChapters,
    uiAction: "Open project gallery",
    requestId: createAuditRequestId(),
    metadata: {
      reason: "listProjects",
      project_count: sorted.length,
    },
  });

  return sorted;
}

/** Load a full project by ID */
export async function loadProject(projectId: string): Promise<StoredProject> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    const localBackup = loadLocalProjectBackup(projectId);
    if (!localBackup) throw new Error("Local project not found");
    return {
      id: localBackup.id,
      title: localBackup.title,
      config: { ...DEFAULT_CONFIG, ...localBackup.config },
      sources: localBackup.sources,
      chapters: localBackup.chapters,
      storyline: localBackup.storyline || "",
      storyline_accepted: localBackup.storyline_accepted || false,
      step: localBackup.step || 0,
      overall_rating: localBackup.overall_rating || 0,
      created_at: localBackup.created_at,
      updated_at: localBackup.updated_at,
    };
  }

  const { data, error } = await supabase
    .from("storybook_projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(error.message);

  if (!data) {
    const localBackup = loadLocalProjectBackup(projectId);
    if (!localBackup) throw new Error("Project not found");

    return {
      id: localBackup.id,
      title: localBackup.title,
      config: { ...DEFAULT_CONFIG, ...localBackup.config },
      sources: localBackup.sources,
      chapters: localBackup.chapters,
      storyline: localBackup.storyline || "",
      storyline_accepted: localBackup.storyline_accepted || false,
      step: localBackup.step || 0,
      overall_rating: localBackup.overall_rating || 0,
      created_at: localBackup.created_at,
      updated_at: localBackup.updated_at,
    };
  }

  // Batch-sign every chapter-images URL in one round-trip.
  const rawChapters = data.chapters as unknown as SlideChapter[];
  const toSign: string[] = [];
  rawChapters.forEach((ch) => {
    if (ch.imageUrl) toSign.push(ch.imageUrl);
    if (Array.isArray(ch.images)) ch.images.forEach((img) => img?.url && toSign.push(img.url));
  });
  const signed = await signChapterImageUrls(toSign, {
    uiAction: "loadProject",
    projectId: data.id,
  });
  let cursor = 0;
  const chapters: SlideChapter[] = rawChapters.map((ch) => {
    const next: SlideChapter = { ...ch };
    if (ch.imageUrl) {
      next.imageUrl = signed[cursor++];
    }
    if (Array.isArray(ch.images)) {
      next.images = ch.images.map((img) =>
        img?.url ? { ...img, url: signed[cursor++] } : img
      );
    }
    return next;
  });

  // Audit: viewing a project materializes all of its chapter-image URLs
  // (preview, storyboard generation, visual book, exports). Best-effort.
  const imageCount = chapters.reduce((sum, ch) => {
    const primary = ch.imageUrl && !ch.imageUrl.startsWith("data:") ? 1 : 0;
    const extras = Array.isArray(ch.images)
      ? ch.images.filter((i) => i?.url && !i.url.startsWith("data:")).length
      : 0;
    return sum + primary + extras;
  }, 0);
  void logUserStorageView({
    bucket: "chapter-images",
    scopePath: `${data.user_id}/${data.id}`,
    fileCount: imageCount,
    projectId: data.id,
    uiAction: "Open project",
    requestId: createAuditRequestId(),
    metadata: {
      reason: "loadProject",
      chapter_count: chapters.length,
    },
  });

  return {
    id: data.id,
    title: data.title,
    config: { ...DEFAULT_CONFIG, ...(data.config as unknown as StoryConfig) },
    sources: data.sources as unknown as Source[],
    chapters,
    storyline: data.storyline || "",
    storyline_accepted: data.storyline_accepted || false,
    step: data.step || 0,
    overall_rating: data.overall_rating || 0,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/** Save a new project or update an existing one */
export async function saveProject(
  project: {
    id?: string;
    title: string;
    config: StoryConfig;
    sources: Source[];
    chapters: SlideChapter[];
    storyline: string;
    storyline_accepted: boolean;
    step: number;
    overall_rating?: number;
  }
): Promise<{ id: string; reassigned: boolean; reassignReason?: "deleted" | "owned-by-other" }> {
  if (OPEN_NOVA_LOCAL_ONLY) {
    const projectId = project.id || crypto.randomUUID();
    upsertLocalProjectBackup({
      id: projectId,
      title: project.title,
      config: project.config,
      sources: project.sources,
      chapters: project.chapters,
      storyline: project.storyline,
      storyline_accepted: project.storyline_accepted,
      step: project.step,
      overall_rating: project.overall_rating || 0,
    });
    return { id: projectId, reassigned: false };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated. Please sign in again.");
  let reassigned = false;
  let reassignReason: "deleted" | "owned-by-other" | undefined;

  // Determine project ID early so we can use it for image paths.
  // If an ID was supplied, verify it belongs to the current user — otherwise
  // the upsert will trigger an UPDATE that violates RLS. In that case we
  // fall back to a fresh UUID so the save always succeeds as a new project.
  let projectId = project.id || crypto.randomUUID();
  if (project.id) {
    const { data: existing, error: lookupErr } = await supabase
      .from("storybook_projects")
      .select("id, user_id")
      .eq("id", project.id)
      .maybeSingle();
    if (lookupErr) {
      console.warn("Project ownership check failed:", lookupErr.message);
    }
    if (!existing) {
      // Project was deleted (or never persisted). Don't resurrect it — save as new.
      console.warn(`Project ${project.id} no longer exists — saving as a new project.`);
      projectId = crypto.randomUUID();
      reassigned = true;
      reassignReason = "deleted";
    } else if (existing.user_id !== user.id) {
      console.warn(`Project ${project.id} is owned by another user — saving as a new project.`);
      projectId = crypto.randomUUID();
      reassigned = true;
      reassignReason = "owned-by-other";
    }
  }

  // Upload any data-URL images to storage in parallel (cover + multi-image gallery)
  const chaptersWithUrls = await Promise.all(
    project.chapters.map(async (ch) => {
      // Multi-image array: upload each data: URL with a stable per-image suffix
      let images = ch.images;
      if (Array.isArray(images) && images.length > 0) {
        images = await Promise.all(
          images.map(async (img, idx) => {
            if (!img?.url || !isDataUrl(img.url)) return img;
            try {
              const url = await uploadChapterImage(
                user.id, projectId, ch.id, img.url, `${idx}-${img.id || idx}`
              );
              return { ...img, url };
            } catch (e) {
              console.warn(`Failed to upload image ${idx} for chapter ${ch.id}:`, e);
              return img; // fallback: keep data URL
            }
          })
        );
      }

      // Legacy cover URL: keep in sync with images[0] if present, otherwise upload as before
      let imageUrl = ch.imageUrl;
      if (Array.isArray(images) && images.length > 0 && images[0]?.url && !isDataUrl(images[0].url)) {
        imageUrl = images[0].url;
      } else if (imageUrl && isDataUrl(imageUrl)) {
        try {
          imageUrl = await uploadChapterImage(user.id, projectId, ch.id, imageUrl);
        } catch (e) {
          console.warn(`Failed to upload cover image for chapter ${ch.id}:`, e);
        }
      }
      return { ...ch, imageUrl, images };
    })
  );

  // Strip transient fields from chapters before saving
  const cleanChapters = chaptersWithUrls.map((ch) => ({
    id: ch.id,
    title: ch.title,
    body: ch.body,
    imagePrompt: ch.imagePrompt,
    diagramPrompt: ch.diagramPrompt,
    notes: ch.notes,
    imageUrl: ch.imageUrl,
    images: ch.images,
    imageLayout: ch.imageLayout,
    references: ch.references,
    rating: ch.rating,
    ratingComment: ch.ratingComment,
  }));

  // Strip file content from sources to reduce payload size
  const cleanSources = project.sources.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    content: s.content ? s.content.slice(0, 5000) : undefined,
    status: s.status,
  }));

  const payload = {
    id: projectId,
    user_id: user.id,
    title: project.title,
    config: project.config as any,
    sources: cleanSources as any,
    chapters: cleanChapters as any,
    storyline: project.storyline,
    storyline_accepted: project.storyline_accepted,
    step: project.step,
    overall_rating: project.overall_rating || 0,
    last_accessed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  upsertLocalProjectBackup({
    id: projectId,
    title: project.title,
    config: project.config,
    sources: cleanSources as Source[],
    chapters: cleanChapters as SlideChapter[],
    storyline: project.storyline,
    storyline_accepted: project.storyline_accepted,
    step: project.step,
    overall_rating: project.overall_rating || 0,
  });

  const { data, error } = await supabase
    .from("storybook_projects")
    .upsert(payload, { onConflict: "id" })
    .select("id")
    .single();

  if (error) {
    const msg = error.message || "";
    const friendly = msg.includes("Project limit reached")
      ? msg
      : msg.includes("row-level security")
      ? "Could not save project — permission denied. Please sign out and sign in again, then retry."
      : msg || "Failed to save project";
    throw new Error(friendly);
  }
  deleteLocalProjectBackup(projectId);
  return { id: data.id, reassigned, reassignReason };
}

/**
 * Best-effort delete of one or more chapter image objects from the
 * `chapter-images` bucket. Accepts the public URLs that we store on
 * `ChapterImage.url` (with optional `?t=` cache-buster). Silently ignores
 * data: URLs, blob: URLs, and any URL that does not point at our bucket.
 *
 * Used when the user removes an image from a chapter so storage doesn't
 * accumulate orphans.
 */
export async function deleteChapterImagesFromBucket(urls: string[]): Promise<void> {
  if (OPEN_NOVA_LOCAL_ONLY) return;
  const paths: string[] = [];
  for (const raw of urls) {
    if (!raw || typeof raw !== "string") continue;
    if (raw.startsWith("data:") || raw.startsWith("blob:")) continue;
    // Public URL shape: …/storage/v1/object/public/chapter-images/<path>?t=…
    const marker = "/chapter-images/";
    const i = raw.indexOf(marker);
    if (i === -1) continue;
    const tail = raw.slice(i + marker.length).split("?")[0].split("#")[0];
    if (tail) paths.push(decodeURIComponent(tail));
  }
  if (paths.length === 0) return;
  try {
    await supabase.storage.from("chapter-images").remove(paths);
  } catch (e) {
    // Non-fatal — orphaned objects can be GC'd later.
    console.warn("[deleteChapterImagesFromBucket] remove failed:", e);
  }
}

/** Delete a project and all associated storage files */
export async function deleteProject(projectId: string): Promise<void> {
  deleteLocalProjectBackup(projectId);
  if (OPEN_NOVA_LOCAL_ONLY) return;

  // Get current user to build storage path
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  // Delete chapter images from storage
  if (userId) {
    const folderPath = `${userId}/${projectId}`;
    const { data: files } = await supabase.storage
      .from("chapter-images")
      .list(folderPath);

    // Audit the listing (fire-and-forget, never blocks deletion).
    void logUserStorageListing({
      bucket: "chapter-images",
      scopePath: folderPath,
      fileCount: files?.length ?? 0,
      projectId,
      uiAction: "Delete project",
      requestId: createAuditRequestId(),
      metadata: { reason: "deleteProject" },
    });

    if (files && files.length > 0) {
      const filePaths = files.map((f) => `${folderPath}/${f.name}`);
      await supabase.storage.from("chapter-images").remove(filePaths);
    }
  }

  // Delete the project record
  const { error } = await supabase
    .from("storybook_projects")
    .delete()
    .eq("id", projectId);
  if (error) throw new Error(error.message);
}
