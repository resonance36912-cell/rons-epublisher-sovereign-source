import { useMemo, useState, useEffect } from "react";
import { diffWordsWithSpace, type Change } from "diff";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Check, X, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { SlideChapter } from "./StoryForgeContext";

type Props = {
  open: boolean;
  before: SlideChapter[];
  after: SlideChapter[];
  /** Called with the per-chapter selection: true = keep rewrite, false = keep original. */
  onApply: (decisions: boolean[]) => void;
  onDiscard: () => void;
};

function DiffInline({ oldText, newText, side }: { oldText: string; newText: string; side: "old" | "new" }) {
  const parts: Change[] = useMemo(
    () => diffWordsWithSpace(oldText || "", newText || ""),
    [oldText, newText]
  );

  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (side === "old" && part.added) return null;
        if (side === "new" && part.removed) return null;
        if (part.added) {
          return (
            <span key={i} className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded px-0.5">
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span key={i} className="bg-rose-500/15 text-rose-700 dark:text-rose-300 line-through rounded px-0.5">
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}

function changeStats(oldText: string, newText: string) {
  const parts = diffWordsWithSpace(oldText || "", newText || "");
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const words = p.value.trim().split(/\s+/).filter(Boolean).length;
    if (p.added) added += words;
    else if (p.removed) removed += words;
  }
  return { added, removed };
}

export function RewriteDiffDialog({ open, before, after, onApply, onDiscard }: Props) {
  const pairs = useMemo(() => {
    const max = Math.max(before.length, after.length);
    return Array.from({ length: max }, (_, i) => ({
      old: before[i],
      next: after[i],
      stats: changeStats(before[i]?.body || "", after[i]?.body || ""),
      hasChanges:
        (before[i]?.title || "") !== (after[i]?.title || "") ||
        (before[i]?.body || "") !== (after[i]?.body || ""),
    }));
  }, [before, after]);

  // Per-chapter decisions: true = accept rewrite, false = keep original.
  // Default: accept everything that actually changed; keep originals for unchanged chapters.
  const [decisions, setDecisions] = useState<boolean[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDecisions(pairs.map((p) => p.hasChanges));
    setIndex(0);
  }, [open, pairs]);

  const safeIndex = Math.min(index, Math.max(0, pairs.length - 1));
  const pair = pairs[safeIndex];
  const accepted = decisions[safeIndex] ?? true;

  const summary = useMemo(() => {
    let acceptedCount = 0;
    let rejectedCount = 0;
    let added = 0;
    let removed = 0;
    pairs.forEach((p, i) => {
      if (decisions[i]) {
        acceptedCount += 1;
        added += p.stats.added;
        removed += p.stats.removed;
      } else {
        rejectedCount += 1;
      }
    });
    return { acceptedCount, rejectedCount, added, removed };
  }, [pairs, decisions]);

  const setDecision = (i: number, value: boolean) => {
    setDecisions((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const acceptAll = () => setDecisions(pairs.map(() => true));
  const rejectAll = () => setDecisions(pairs.map(() => false));

  if (!pair) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDiscard(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Review chapter rewrite
            <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-300 bg-emerald-500/15">
              {summary.acceptedCount} accepted
            </Badge>
            <Badge variant="secondary" className="text-rose-700 dark:text-rose-300 bg-rose-500/15">
              {summary.rejectedCount} kept original
            </Badge>
            <Badge variant="outline" className="font-normal">
              +{summary.added} / −{summary.removed} words
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Review each chapter and choose whether to keep the rewrite or the original. Only accepted chapters will be replaced when you apply.
          </DialogDescription>
        </DialogHeader>

        {/* Chapter pager + per-chapter decision */}
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
            Chapter {safeIndex + 1} of {pairs.length}
            <span className="ml-2 text-xs text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">+{pair.stats.added}</span>
              {" / "}
              <span className="text-rose-600 dark:text-rose-400">−{pair.stats.removed}</span>
            </span>
            {!pair.hasChanges && (
              <Badge variant="outline" className="ml-2 text-xs font-normal">unchanged</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={accepted ? "default" : "outline"}
              size="sm"
              onClick={() => setDecision(safeIndex, true)}
              disabled={!pair.hasChanges}
              className="gap-1"
              title={pair.hasChanges ? "Use the rewrite for this chapter" : "No changes to accept"}
            >
              <Check className="w-3.5 h-3.5" /> Accept
            </Button>
            <Button
              variant={!accepted ? "default" : "outline"}
              size="sm"
              onClick={() => setDecision(safeIndex, false)}
              className="gap-1"
              title="Keep the original for this chapter"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Keep original
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIndex((i) => Math.min(pairs.length - 1, i + 1))}
            disabled={safeIndex === pairs.length - 1}
            className="gap-1"
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
          <div className={`flex flex-col border rounded-lg overflow-hidden ${!accepted ? "border-primary/40 ring-1 ring-primary/30" : ""}`}>
            <div className="px-3 py-2 bg-muted/40 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
              <span>Before {!accepted && <span className="text-primary normal-case font-normal">· will be kept</span>}</span>
            </div>
            <ScrollArea className="flex-1 max-h-[55vh]">
              <div className="p-4 space-y-2">
                <h4 className="font-serif font-semibold text-base">
                  <DiffInline oldText={pair.old?.title || ""} newText={pair.next?.title || ""} side="old" />
                </h4>
                <DiffInline oldText={pair.old?.body || ""} newText={pair.next?.body || ""} side="old" />
              </div>
            </ScrollArea>
          </div>

          <div className={`flex flex-col border rounded-lg overflow-hidden ${accepted ? "border-primary/40 ring-1 ring-primary/30" : ""}`}>
            <div className="px-3 py-2 bg-primary/10 border-b text-xs font-semibold text-primary uppercase tracking-wide flex items-center justify-between">
              <span>After (rewrite) {accepted && pair.hasChanges && <span className="normal-case font-normal">· will be applied</span>}</span>
            </div>
            <ScrollArea className="flex-1 max-h-[55vh]">
              <div className="p-4 space-y-2">
                <h4 className="font-serif font-semibold text-base">
                  <DiffInline oldText={pair.old?.title || ""} newText={pair.next?.title || ""} side="new" />
                </h4>
                <DiffInline oldText={pair.old?.body || ""} newText={pair.next?.body || ""} side="new" />
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={acceptAll}>Accept all</Button>
            <Button variant="ghost" size="sm" onClick={rejectAll}>Reject all</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDiscard} className="gap-2">
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button onClick={() => onApply(decisions)} className="gap-2" disabled={summary.acceptedCount === 0}>
              <Check className="w-4 h-4" /> Apply {summary.acceptedCount} {summary.acceptedCount === 1 ? "change" : "changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
