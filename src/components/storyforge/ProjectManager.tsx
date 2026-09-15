import { useState, useCallback, useEffect } from "react";
import { useStoryForge, DEFAULT_CONFIG } from "./StoryForgeContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { Save, FolderOpen, Loader2, Clock } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import {
  listProjects, loadProject, saveProject, deleteProject,
  type ProjectListItem,
} from "@/lib/project-storage";
import { notifyProjectSaveError } from "@/lib/notifyProjectSaveError";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProjectAutosave } from "./projectmanager/useProjectAutosave";
import { useLastSavedLabel } from "./projectmanager/useLastSavedLabel";
import { ProjectListPanel } from "./projectmanager/ProjectListPanel";
import { NewProjectDialog } from "./projectmanager/NewProjectDialog";

export function ProjectManager() {
  const {
    config, setConfig,
    sources, setSources,
    chapters, setChapters,
    storyline, setStoryline,
    storylineAccepted, setStorylineAccepted,
    step, setStep,
    projectId, setProjectId,
    projectDirty, setProjectDirty,
    setReferenceImage,
    lastSavedAt, setLastSavedAt,
    overallRating, setOverallRating,
  } = useStoryForge();
  const { t } = useI18n();
  const { toast } = useToast();
  const [showPanel, setShowPanel] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const lastSavedLabel = useLastSavedLabel(lastSavedAt);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err: any) {
      toast({ title: t("project.loadFailed"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (showPanel) {
      setProjects([]);
      fetchProjects();
    }
  }, [showPanel, fetchProjects]);

  useEffect(() => {
    const handleFocus = () => { if (showPanel) fetchProjects(); };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchProjects, showPanel]);

  // Allow other surfaces (e.g. the project-cap toast) to open this panel.
  useEffect(() => {
    const open = () => setShowPanel(true);
    window.addEventListener("open-project-manager", open);
    return () => window.removeEventListener("open-project-manager", open);
  }, []);

  useProjectAutosave({
    projectDirty, projectId, config, sources, chapters, storyline,
    storylineAccepted, step, overallRating,
    setProjectId, setProjectDirty, setLastSavedAt,
  });

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const title = config.topic || "Untitled Project";
      const { id, reassigned, reassignReason } = await saveProject({
        id: projectId || undefined,
        title, config, sources, chapters, storyline,
        storyline_accepted: storylineAccepted,
        step,
        overall_rating: overallRating,
      });
      setProjectId(id);
      setProjectDirty(false);
      setLastSavedAt(new Date());
      await fetchProjects();
      if (reassigned && reassignReason === "deleted") {
        toast({ title: "Project was deleted — saved as a new project", description: "The original project no longer exists, so your changes were saved as a new project." });
      } else if (reassigned) {
        toast({ title: "Saved as a new copy", description: "The original project belongs to another account, so we saved your changes as a new project." });
      } else {
        toast({ title: t("project.saved"), description: title });
      }
    } catch (err: any) {
      if (!notifyProjectSaveError(err)) {
        toast({ title: t("project.saveFailed"), description: err.message, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }, [chapters, config, fetchProjects, overallRating, projectId, setLastSavedAt, setProjectDirty, setProjectId, sources, step, storyline, storylineAccepted, t, toast]);

  const handleLoad = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const project = await loadProject(id);
      setConfig(project.config);
      setSources(project.sources);
      setChapters(project.chapters);
      setStoryline(project.storyline);
      setStorylineAccepted(project.storyline_accepted);
      setStep(project.step);
      setOverallRating(project.overall_rating || 0);
      setProjectId(project.id);
      setReferenceImage(null);
      setProjectDirty(false);
      setLastSavedAt(null);
      setShowPanel(false);
      toast({ title: t("project.loaded"), description: project.title });
    } catch (err: any) {
      toast({ title: t("project.loadFailed"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [setConfig, setSources, setChapters, setStoryline, setStorylineAccepted, setStep, setOverallRating, setProjectId, setReferenceImage, setProjectDirty, setLastSavedAt, toast, t]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (projectId === id) {
        setProjectId(null);
        setConfig({ ...DEFAULT_CONFIG });
        setSources([]);
        setChapters([]);
        setStoryline("");
        setStorylineAccepted(false);
        setStep(0);
        setOverallRating(0);
        setReferenceImage(null);
        setProjectDirty(false);
        setLastSavedAt(null);
      }
      toast({ title: t("project.deleted") });
    } catch (err: any) {
      toast({ title: t("project.deleteFailed"), description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }, [projectId, setProjectId, setConfig, setSources, setChapters, setStoryline, setStorylineAccepted, setStep, setOverallRating, setReferenceImage, setProjectDirty, setLastSavedAt, toast, t]);

  const handleConfirmNew = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const freshConfig = { ...DEFAULT_CONFIG, topic: name };
    setConfig(freshConfig);
    setSources([]);
    setChapters([]);
    setStoryline("");
    setStorylineAccepted(false);
    setStep(0);
    setOverallRating(0);
    setProjectId(null);
    setReferenceImage(null);
    setLastSavedAt(null);
    setShowPanel(false);
    setShowNewDialog(false);
    setNewProjectName("");

    try {
      const { id } = await saveProject({
        title: name,
        config: freshConfig,
        sources: [], chapters: [], storyline: "",
        storyline_accepted: false,
        step: 0,
        overall_rating: 0,
      });
      setProjectId(id);
      setProjectDirty(false);
      setLastSavedAt(new Date());
      toast({ title: t("project.newCreated"), description: name });
    } catch (err: any) {
      setProjectDirty(true);
      if (!notifyProjectSaveError(err)) {
        toast({ title: t("project.saveFailed"), description: err.message, variant: "destructive" });
      }
    }
  }, [newProjectName, setConfig, setSources, setChapters, setStoryline, setStorylineAccepted, setStep, setOverallRating, setProjectId, setReferenceImage, setProjectDirty, setLastSavedAt, toast, t]);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {lastSavedLabel && (
          <span className="text-[10px] text-muted-foreground hidden sm:inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {lastSavedLabel}
          </span>
        )}
        <Button
          variant="ghost" size="sm"
          onClick={handleSave}
          disabled={saving || (!config.topic && chapters.length === 0)}
          className="gap-1.5 text-xs"
          title={t("project.save")}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{t("project.save")}</span>
          {projectDirty && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
        </Button>
        <Button
          variant="ghost" size="sm"
          onClick={() => setShowPanel(!showPanel)}
          className="gap-1.5 text-xs"
          title={t("project.myProjects")}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t("project.myProjects")}</span>
        </Button>
      </div>

      <AnimatePresence>
        {showPanel && (
          <ProjectListPanel
            projects={projects}
            loading={loading}
            currentProjectId={projectId}
            deletingId={deletingId}
            onLoad={handleLoad}
            onRequestDelete={(id) => setConfirmDeleteId(id)}
            onNew={() => { setNewProjectName(""); setShowNewDialog(true); }}
          />
        )}
      </AnimatePresence>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The project and all its images will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteId) {
                  handleDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewProjectDialog
        open={showNewDialog}
        value={newProjectName}
        onChange={setNewProjectName}
        onCancel={() => { setShowNewDialog(false); setNewProjectName(""); }}
        onConfirm={handleConfirmNew}
      />
    </>
  );
}
