import { motion } from "framer-motion";
import { BookOpen, Clock, FilePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { ProjectListItem } from "@/lib/project-storage";
import { formatRelativeDate } from "./useLastSavedLabel";

const STEP_LABELS = ["Topic", "Research", "Configure", "Storyboard", "Storyline", "Preview", "Visual"];

type Props = {
  projects: ProjectListItem[];
  loading: boolean;
  currentProjectId: string | null;
  deletingId: string | null;
  onLoad: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onNew: () => void;
};

export function ProjectListPanel({
  projects, loading, currentProjectId, deletingId, onLoad, onRequestDelete, onNew,
}: Props) {
  const { t } = useI18n();

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="absolute top-full right-0 mt-2 z-50 w-[380px] max-h-[480px] overflow-hidden glass-card border border-border rounded-xl shadow-2xl"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold text-foreground">{t("project.myProjects")}</h3>
        <Button variant="ghost" size="sm" onClick={onNew} className="gap-1.5 text-xs">
          <FilePlus className="w-3.5 h-3.5" /> {t("project.new")}
        </Button>
      </div>

      <div className="overflow-y-auto max-h-[400px] p-2 space-y-1.5">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t("project.noProjects")}
          </div>
        )}

        {!loading && projects.map((project) => (
          <div
            key={project.id}
            className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer ${
              currentProjectId === project.id ? "bg-primary/10 border border-primary/20" : ""
            }`}
            onClick={() => onLoad(project.id)}
          >
            <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{project.topic || project.title}</div>
              {project.localOnly && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full mt-0.5 w-fit">
                  Recovered locally
                </span>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatRelativeDate(project.updated_at)}
                </span>
                <span>·</span>
                <span>{project.chapter_count} ch.</span>
                <span>·</span>
                <span className="text-accent">{STEP_LABELS[project.step] || `Step ${project.step}`}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 h-11 w-11 sm:h-7 sm:w-7"
              onClick={(e) => { e.stopPropagation(); onRequestDelete(project.id); }}
              disabled={deletingId === project.id}
            >
              {deletingId === project.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5 text-destructive" />}
            </Button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
