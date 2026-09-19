import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Edit3, Info,
  ShieldCheck, Volume2, Wrench, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SlideChapter, Source, StoryConfig } from "./StoryForgeContext";
import {
  READINESS_CATEGORY_LABELS,
  analysePublicationReadiness,
  applyReadinessAutofix,
  computeManuscriptRevision,
  summarisePublicationReadiness,
  type PublicationReadinessIssue,
  type ReadinessCategory,
} from "@/lib/publication-readiness";

type Props = {
  chapters: SlideChapter[];
  sources: Source[];
  config: StoryConfig;
  setConfig: React.Dispatch<React.SetStateAction<StoryConfig>>;
  setChapters: React.Dispatch<React.SetStateAction<SlideChapter[]>>;
  onJumpToChapter?: (chapterIndex: number) => void;
};

const CATEGORY_ORDER: ReadinessCategory[] = [
  "source_integrity",
  "attribution",
  "factual_consistency",
  "editorial_quality",
  "structure",
  "presentation",
  "production",
];

function severityClass(severity: PublicationReadinessIssue["severity"]) {
  if (severity === "critical") return "border-red-500/35 bg-red-500/5";
  if (severity === "warning") return "border-amber-500/35 bg-amber-500/5";
  return "border-sky-500/30 bg-sky-500/5";
}

export function PublicationReadinessPanel({
  chapters, sources, config, setConfig, setChapters, onJumpToChapter,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const allIssues = useMemo(
    () => analysePublicationReadiness(chapters, sources, config),
    [chapters, sources, config],
  );
  const dismissals = config.readinessDismissals || {};
  const currentRevision = useMemo(() => computeManuscriptRevision(chapters), [chapters]);
  const issues = useMemo(
    () => allIssues.filter((item) => !dismissals[item.id + "@" + currentRevision]?.trim()),
    [allIssues, dismissals, currentRevision],
  );
  const dismissedCount = allIssues.length - issues.length;
  const summary = useMemo(() => summarisePublicationReadiness(issues), [issues]);
  const evidenceSummary = useMemo(() => {
    const claims = chapters.flatMap((chapter) => chapter.evidenceClaims || []);
    return {
      total: claims.length,
      unresolved: claims.filter((claim) => claim.verificationStatus !== "supported").length,
      sourced: claims.filter((claim) => claim.sourceIndexes.length > 0).length,
    };
  }, [chapters]);
  const approved = config.approvedManuscriptRevision === currentRevision;

  const grouped = useMemo(() => {
    const map = new Map<ReadinessCategory, PublicationReadinessIssue[]>();
    for (const category of CATEGORY_ORDER) map.set(category, []);
    for (const item of issues) map.get(item.category)?.push(item);
    return map;
  }, [issues]);

  const dismissIssue = (item: PublicationReadinessIssue) => {
    const reason = window.prompt(
      "Why are you dismissing this readiness finding? The reason is stored with the project.",
      "",
    );
    if (!reason?.trim()) return;
    setConfig((c) => ({
      ...c,
      readinessDismissals: { ...(c.readinessDismissals || {}), [item.id + "@" + currentRevision]: reason.trim() },
    }));
  };

  const applyFix = (item: PublicationReadinessIssue) => {
    if (!item.autofix || !item.chapterId) return;
    setChapters((prev) => prev.map((ch) =>
      ch.id === item.chapterId ? applyReadinessAutofix(ch, item.autofix!) : ch
    ));
  };

  const approveRevision = () => {
    setConfig((c) => ({ ...c, approvedManuscriptRevision: currentRevision }));
  };

  if (chapters.length === 0) return null;

  const headerStyle = summary.critical > 0
    ? "border-red-500/40 bg-red-500/5"
    : summary.warning > 0
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-primary/35 bg-primary/5";

  return (
    <section className={"rounded-xl border p-3 sm:p-4 space-y-3 " + headerStyle} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {summary.critical > 0 ? (
            <AlertTriangle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
          ) : summary.warning > 0 ? (
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {summary.publicationReady
                ? "Publication-ready checks passed"
                : summary.critical > 0
                  ? "Publication readiness — critical issues require review"
                  : "Publication readiness — editorial review required"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Source integrity · attribution · facts · editorial quality · structure · presentation · production
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {summary.critical} critical · {summary.warning} warning · {summary.info} note
              {dismissedCount > 0 ? " · " + dismissedCount + " dismissed with reason for this revision" : ""}
            </p>
            {evidenceSummary.total > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Evidence ledger: {evidenceSummary.sourced}/{evidenceSummary.total} claims source-linked
                {evidenceSummary.unresolved > 0 ? " · " + evidenceSummary.unresolved + " conflicting/unresolved" : " · all marked supported"}
              </p>
            )}
          </div>
        </button>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="p-1 text-muted-foreground">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-primary" />
            Approved manuscript revision for narration
          </p>
          <p className="text-[10px] text-muted-foreground mt-1 break-all">
            {approved
              ? "Approved: " + currentRevision
              : config.approvedManuscriptRevision
                ? "Approval is stale; current revision is " + currentRevision
                : "Not approved yet. Audiovisual exports remain gated."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={approved ? "outline" : "default"}
          disabled={approved || summary.critical > 0}
          onClick={approveRevision}
          className="gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {approved ? "Current revision approved" : "Approve current revision"}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3">
          {CATEGORY_ORDER.map((category) => {
            const list = grouped.get(category) || [];
            if (list.length === 0) return null;
            return (
              <div key={category} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {READINESS_CATEGORY_LABELS[category]}
                  </h3>
                  <span className="text-[10px] text-muted-foreground">{list.length} finding{list.length === 1 ? "" : "s"}</span>
                </div>
                {list.map((item) => (
                  <ReadinessFinding
                    key={item.id}
                    item={item}
                    onApply={() => applyFix(item)}
                    onEdit={() => item.chapterIndex && onJumpToChapter?.(item.chapterIndex)}
                    onDismiss={() => dismissIssue(item)}
                    canEdit={!!item.chapterIndex && !!onJumpToChapter}
                  />
                ))}
              </div>
            );
          })}

          {issues.length === 0 && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground flex gap-2">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              <p>
                No unresolved readiness findings were detected. Automated checks do not independently prove factual accuracy;
                source review and human editorial approval remain authoritative.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ReadinessFinding({
  item, onApply, onEdit, onDismiss, canEdit,
}: {
  item: PublicationReadinessIssue;
  onApply: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  canEdit: boolean;
}) {
  return (
    <div className={"rounded-lg border p-3 " + severityClass(item.severity)}>
      <div className="flex items-start gap-2">
        {item.severity === "critical" ? (
          <XCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
        ) : item.severity === "warning" ? (
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
        ) : (
          <Info className="w-4 h-4 mt-0.5 text-sky-500 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-foreground">{item.title}</p>
            {item.chapterIndex && (
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[9px] text-muted-foreground">
                Chapter {item.chapterIndex}
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/80 mt-1">{item.message}</p>
          {item.evidence && (
            <p className="text-[10px] italic text-muted-foreground mt-1.5">“{item.evidence}”</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Suggested correction: {item.suggestion}
          </p>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {item.autofix && (
              <Button type="button" size="sm" variant="outline" onClick={onApply} className="h-7 px-2 text-[10px] gap-1">
                <Wrench className="w-3 h-3" /> Apply safe fix
              </Button>
            )}
            {canEdit && (
              <Button type="button" size="sm" variant="outline" onClick={onEdit} className="h-7 px-2 text-[10px] gap-1">
                <Edit3 className="w-3 h-3" /> Edit / inspect
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={onDismiss} className="h-7 px-2 text-[10px]">
              Dismiss with reason
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

