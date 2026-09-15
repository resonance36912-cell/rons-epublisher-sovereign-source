import { useEffect, useRef } from "react";
import { useStoryForge, DEFAULT_CONFIG } from "@/components/storyforge/StoryForgeContext";
import { supabase } from "@/integrations/supabase/client";
import { listProjects, loadProject } from "@/lib/project-storage";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import type { StoryConfig, Source, SlideChapter } from "@/components/storyforge/StoryForgeContext";

/**
 * Automatically loads the user's most recently updated project on mount,
 * so they resume exactly where they left off after logging in.
 */
export function useAutoResumeProject() {
  const {
    setConfig, setSources, setChapters, setStoryline,
    setStorylineAccepted, setStep, setProjectId,
    setReferenceImage, setProjectDirty, setLastSavedAt,
    setOverallRating, projectId,
  } = useStoryForge();

  const ran = useRef(false);

  useEffect(() => {
    // Only run once, and only if no project is already loaded
    if (ran.current || projectId) return;
    ran.current = true;

    (async () => {
      try {
        if (OPEN_NOVA_LOCAL_ONLY) {
          const projects = await listProjects();
          const latest = projects.sort((a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )[0];
          if (!latest) return;
          const project = await loadProject(latest.id);
          setConfig(project.config as StoryConfig);
          setSources(project.sources as Source[]);
          setChapters(project.chapters as SlideChapter[]);
          setStoryline(project.storyline);
          setStorylineAccepted(project.storyline_accepted);
          setStep(project.step);
          setOverallRating(project.overall_rating || 0);
          setProjectId(project.id);
          setReferenceImage(null);
          setProjectDirty(false);
          setLastSavedAt(null);
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch the single most-recently-updated project ID
        const { data, error } = await supabase
          .from("storybook_projects")
          .select("id")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error || !data) return;

        const project = await loadProject(data.id);

        setConfig(project.config as StoryConfig);
        setSources(project.sources as Source[]);
        setChapters(project.chapters as SlideChapter[]);
        setStoryline(project.storyline);
        setStorylineAccepted(project.storyline_accepted);
        setStep(project.step);
        setOverallRating(project.overall_rating || 0);
        setProjectId(project.id);
        setReferenceImage(null);
        // Mark clean so autosave doesn't immediately re-save
        setProjectDirty(false);
        setLastSavedAt(null);
      } catch {
        // Silent fail – user starts fresh
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
