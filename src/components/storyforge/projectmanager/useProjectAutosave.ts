import { useEffect, useRef } from "react";
import { saveProject } from "@/lib/project-storage";
import { useToast } from "@/hooks/use-toast";
import { notifyProjectSaveError } from "@/lib/notifyProjectSaveError";

type AutosaveArgs = {
  projectDirty: boolean;
  projectId: string | null;
  config: any;
  sources: any[];
  chapters: any[];
  storyline: string;
  storylineAccepted: boolean;
  step: number;
  overallRating: number;
  setProjectId: (id: string) => void;
  setProjectDirty: (dirty: boolean) => void;
  setLastSavedAt: (d: Date | null) => void;
};

/**
 * Silently autosaves the current project every 30 seconds when dirty.
 * Surfaces a toast only when the server reassigned the project id (orphan/deleted).
 */
export function useProjectAutosave(args: AutosaveArgs) {
  const { toast } = useToast();
  const savingRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    const timer = setInterval(() => {
      const a = argsRef.current;
      if (savingRef.current) return;
      if (!a.projectDirty) return;
      if (!a.config?.topic && a.chapters.length === 0) return;

      savingRef.current = true;
      const title = a.config?.topic || "Untitled Project";
      saveProject({
        id: a.projectId || undefined,
        title,
        config: a.config,
        sources: a.sources,
        chapters: a.chapters,
        storyline: a.storyline,
        storyline_accepted: a.storylineAccepted,
        step: a.step,
        overall_rating: a.overallRating,
      })
        .then(({ id, reassigned, reassignReason }) => {
          a.setProjectId(id);
          a.setProjectDirty(false);
          a.setLastSavedAt(new Date());
          if (reassigned && reassignReason === "deleted") {
            toast({
              title: "Project was deleted — saved as a new project",
              description: "The original project no longer exists, so your changes were saved as a new project.",
            });
          } else if (reassigned) {
            toast({
              title: "Saved as a new copy",
              description: "The original project belongs to another account, so we saved your changes as a new project.",
            });
          }
        })
        .catch((err) => {
          // Surface cap errors even in autosave so users learn why saves stop.
          notifyProjectSaveError(err);
        })
        .finally(() => {
          savingRef.current = false;
        });
    }, 30_000);

    return () => clearInterval(timer);
  }, [toast]);
}
