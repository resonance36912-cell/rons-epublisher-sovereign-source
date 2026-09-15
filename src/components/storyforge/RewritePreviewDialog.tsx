import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Eye,
  X,
  Palette,
  Mic as MicIcon,
} from "lucide-react";
import type { SlideChapter } from "./StoryForgeContext";
import { wordDiff, THEME_STYLES, TONE_STYLES, excerpt } from "./ThemeTonePreview";

type Props = {
  open: boolean;
  chapters: SlideChapter[];
  theme: string;
  tone: string;
  themeLabel: string;
  toneLabel: string;
  topic: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Step-before-confirm preview: shows a per-chapter, client-side, heuristic
 * diff of what the selected theme + tone would do to each chapter. No AI
 * calls — just a directional preview so the user can decide whether to
 * commit to the (more expensive) AI rewrite.
 */
export function RewritePreviewDialog({
  open,
  chapters,
  theme,
  tone,
  themeLabel,
  toneLabel,
  topic,
  onConfirm,
  onCancel,
}: Props) {
  const themeStyle = THEME_STYLES[theme] || THEME_STYLES.documentary;
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.professional;

  const previews = useMemo(() => {
    return chapters.map((ch, idx) => {
      const baseBody = ch?.body?.trim() || themeStyle.sampleOpening(topic || ch?.title || "your subject");
      const before = excerpt(baseBody, 320);
      const after = toneStyle.transform(before);
      const diff = wordDiff(before, after);
      let added = 0;
      let removed = 0;
      for (const t of diff) {
        const w = t.text.trim().split(/\s+/).filter(Boolean).length;
        if (t.type === "add") added += w;
        else if (t.type === "rem") removed += w;
      }
      return {
        idx,
        title: ch?.title || `Chapter ${idx + 1}`,
        before,
        after,
        diff,
        added,
        removed,
      };
    });
  }, [chapters, themeStyle, toneStyle, topic]);

  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const safeIndex = Math.min(index, Math.max(0, previews.length - 1));
  const current = previews[safeIndex];

  const totals = useMemo(() => {
    let a = 0;
    let r = 0;
    for (const p of previews) {
      a += p.added;
      r += p.removed;
    }
    return { added: a, removed: r };
  }, [previews]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Eye className="w-4 h-4 text-primary" />
            Preview rewrite
            <Badge variant="secondary" className="gap-1">
              <Palette className="w-3 h-3" /> {themeLabel}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <MicIcon className="w-3 h-3" /> {toneLabel}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {previews.length} {previews.length === 1 ? "chapter" : "chapters"}
            </Badge>
            <Badge variant="outline" className="font-normal">
              ~+{totals.added} / −{totals.removed} words
            </Badge>
          </DialogTitle>
          <DialogDescription>
            A directional, instant preview of how each chapter would shift. The actual AI rewrite
            may go further — you'll review the real result chapter-by-chapter before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {/* Pager */}
        <div className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 bg-muted/30 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            className="gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <div className="text-sm font-medium text-center flex-1 min-w-[140px] truncate">
            Chapter {safeIndex + 1} of {previews.length}
            <span className="ml-2 text-xs text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">+{current.added}</span>
              {" / "}
              <span className="text-rose-600 dark:text-rose-400">−{current.removed}</span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIndex((i) => Math.min(previews.length - 1, i + 1))}
            disabled={safeIndex === previews.length - 1}
            className="gap-1"
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Diff */}
        <div className="flex-1 min-h-0 border rounded-lg overflow-hidden flex flex-col">
          <div className="px-3 py-2 bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {current.title}
          </div>
          <ScrollArea className="flex-1 max-h-[55vh]">
            <p className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {current.diff.map((t, i) => {
                if (t.type === "eq") return <span key={i}>{t.text}</span>;
                if (t.type === "add") {
                  return (
                    <span
                      key={i}
                      className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded px-0.5"
                    >
                      {t.text}
                    </span>
                  );
                }
                return (
                  <span
                    key={i}
                    className="bg-rose-500/15 text-rose-700 dark:text-rose-300 line-through rounded px-0.5"
                  >
                    {t.text}
                  </span>
                );
              })}
            </p>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">
            This is a fast local preview. Confirm to generate the real AI rewrite.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} className="gap-2">
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button onClick={onConfirm} className="gap-2">
              <Sparkles className="w-4 h-4" /> Confirm &amp; rewrite {previews.length}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
