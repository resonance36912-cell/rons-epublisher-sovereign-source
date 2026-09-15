import { useEffect, useRef } from "react";
import {
  createAuditRequestId,
  logUserStorageView,
} from "@/lib/storage-audit";
import type { SlideChapter } from "@/components/storyforge/StoryForgeContext";

/**
 * Fires a single chapter-image "view" audit row when a UI surface that
 * renders chapter images mounts (or when the project / chapter set
 * changes). Best-effort and silent — never blocks rendering.
 *
 * @param uiAction Human-readable label shown in the admin audit viewer
 *   (e.g. "Open story preview", "Render storyboard editor").
 * @param projectId Project the surface is bound to, when known.
 * @param chapters Current chapter list — used to count materialized
 *   chapter-image URLs.
 */
export function useChapterImageViewAudit(
  uiAction: string,
  projectId: string | null | undefined,
  chapters: SlideChapter[] | undefined,
): void {
  // Deduplicate so a single mount of a surface logs at most one row per
  // (project, chapter-fingerprint) combination, even across React strict-
  // mode double effects.
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!projectId || !Array.isArray(chapters) || chapters.length === 0) return;

    let imageCount = 0;
    for (const ch of chapters) {
      if (ch?.imageUrl && !ch.imageUrl.startsWith("data:")) imageCount += 1;
      if (Array.isArray(ch?.images)) {
        for (const img of ch.images) {
          if (img?.url && !img.url.startsWith("data:")) imageCount += 1;
        }
      }
    }
    if (imageCount === 0) return;

    const key = `${projectId}:${uiAction}:${chapters.length}:${imageCount}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    void logUserStorageView({
      bucket: "chapter-images",
      scopePath: `*/${projectId}`,
      fileCount: imageCount,
      projectId,
      uiAction,
      requestId: createAuditRequestId(),
      metadata: {
        reason: "ui-surface",
        chapter_count: chapters.length,
      },
    });
  }, [projectId, uiAction, chapters]);
}
