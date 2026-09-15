import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Info, ChevronDown, ChevronUp, Check, ShieldCheck } from "lucide-react";
import { validateThemeAndTone, summariseIssues, type ValidationIssue } from "@/lib/theme-tone-validator";
import type { SlideChapter } from "@/components/storyforge/StoryForgeContext";

type Props = {
  chapters: SlideChapter[];
  theme: string;
  tone: string;
  /** Jump to a chapter slide (1-based index of chapter in chapters[]). */
  onJumpToChapter?: (chapterIndex: number) => void;
};

export function ThemeToneValidator({ chapters, theme, tone, onJumpToChapter }: Props) {
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(
    () => validateThemeAndTone(chapters, theme, tone),
    [chapters, theme, tone],
  );
  const { warningCount, infoCount, affectedChapterIds } = useMemo(
    () => summariseIssues(issues),
    [issues],
  );

  const clean = issues.length === 0;

  // Group issues by chapter
  const grouped = useMemo(() => {
    const byCh = new Map<string, ValidationIssue[]>();
    for (const i of issues) {
      const arr = byCh.get(i.chapterId) || [];
      arr.push(i);
      byCh.set(i.chapterId, arr);
    }
    return byCh;
  }, [issues]);

  if (chapters.length === 0) return null;

  return (
    <div
      className={`rounded-xl border ${
        clean
          ? "border-primary/30 bg-primary/5"
          : warningCount > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-sky-500/30 bg-sky-500/5"
      } p-3 sm:p-4 space-y-2`}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {clean ? (
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          ) : warningCount > 0 ? (
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-sky-500 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {clean
                ? "Theme & tone check passed"
                : `Theme & tone check — ${warningCount} warning${warningCount === 1 ? "" : "s"}${
                    infoCount > 0 ? `, ${infoCount} note${infoCount === 1 ? "" : "s"}` : ""
                  }`}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {clean
                ? `No contradictions detected for "${theme}" / "${tone}" across ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}.`
                : `${affectedChapterIds.size} chapter${affectedChapterIds.size === 1 ? "" : "s"} affected · target: "${theme}" / "${tone}"`}
            </p>
          </div>
        </div>
        {!clean && (
          expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && !clean && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ul className="mt-2 space-y-2">
              {Array.from(grouped.entries()).map(([chId, list]) => {
                const first = list[0];
                return (
                  <li key={chId} className="rounded-lg border border-border/40 bg-card/60 p-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-foreground truncate">
                        Ch. {first.chapterIndex} · {first.chapterTitle}
                      </span>
                      {onJumpToChapter && (
                        <button
                          type="button"
                          onClick={() => onJumpToChapter(first.chapterIndex)}
                          className="text-[10px] uppercase tracking-wider text-primary hover:underline shrink-0"
                        >
                          Jump to slide →
                        </button>
                      )}
                    </div>
                    <ul className="space-y-1.5">
                      {list.map((iss, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs">
                          {iss.severity === "warning" ? (
                            <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />
                          ) : (
                            <Info className="w-3 h-3 mt-0.5 text-sky-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-foreground/90">{iss.message}</span>
                            {iss.snippet && (
                              <p className="text-[10px] text-muted-foreground italic mt-0.5">
                                "{iss.snippet}"
                              </p>
                            )}
                            <span className="inline-block ml-1 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                              · {iss.category}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-muted-foreground mt-2">
              These checks are heuristics — review flagged passages, then continue if you're happy with the voice.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {clean && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pl-6">
          <Check className="w-3 h-3 text-primary" /> Voice consistent across all chapters.
        </p>
      )}
    </div>
  );
}
