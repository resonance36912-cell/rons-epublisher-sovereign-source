import { useState, useCallback, useEffect } from "react";
import { Search, Replace, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Eye, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SlideChapter } from "../StoryForgeContext";

type MatchLocation = {
  chapterIdx: number;
  chapterId: string;
  field: "title" | "body";
  matchIndex: number; // which occurrence within that field
  offset: number; // character offset
  snippet: string;
};

type Props = {
  chapters: SlideChapter[];
  onUpdateChapters: React.Dispatch<React.SetStateAction<SlideChapter[]>>;
  onScrollToChapter?: (chapterId: string) => void;
  onSearchChange?: (searchTerm: string) => void;
};

/** Build all match locations across chapters */
function buildMatchLocations(chapters: SlideChapter[], escaped: string): MatchLocation[] {
  if (!escaped) return [];
  const locations: MatchLocation[] = [];
  chapters.forEach((ch, chIdx) => {
    // Title matches
    const titleRegex = new RegExp(escaped, "gi");
    let m: RegExpExecArray | null;
    let mi = 0;
    while ((m = titleRegex.exec(ch.title)) !== null) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(ch.title.length, m.index + m[0].length + 30);
      locations.push({
        chapterIdx: chIdx,
        chapterId: ch.id,
        field: "title",
        matchIndex: mi++,
        offset: m.index,
        snippet: (start > 0 ? "…" : "") + ch.title.slice(start, end) + (end < ch.title.length ? "…" : ""),
      });
    }
    // Body matches
    const bodyRegex = new RegExp(escaped, "gi");
    mi = 0;
    while ((m = bodyRegex.exec(ch.body)) !== null) {
      const start = Math.max(0, m.index - 25);
      const end = Math.min(ch.body.length, m.index + m[0].length + 35);
      locations.push({
        chapterIdx: chIdx,
        chapterId: ch.id,
        field: "body",
        matchIndex: mi++,
        offset: m.index,
        snippet: (start > 0 ? "…" : "") + ch.body.slice(start, end) + (end < ch.body.length ? "…" : ""),
      });
    }
  });
  return locations;
}

/** Highlight matched text within a snippet */
function HighlightSnippet({ text, escaped }: { text: string; escaped: string }) {
  if (!escaped) return <span>{text}</span>;
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        new RegExp(`^${escaped}$`, "gi").test(part) ? (
          <mark key={i} className="bg-accent/30 text-foreground rounded-sm px-0.5 font-medium">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export function GlobalFindReplace({ chapters, onUpdateChapters, onScrollToChapter, onSearchChange }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [mode, setMode] = useState<"find" | "replace">("find");
  const [showResults, setShowResults] = useState(true);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  const escaped = findText.trim() ? findText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";

  const matchLocations = buildMatchLocations(chapters, escaped);
  const totalMatches = matchLocations.length;
  const chapterHits = escaped
    ? new Set(matchLocations.map((l) => l.chapterId)).size
    : 0;

  // Reset current match and notify parent when search text changes
  useEffect(() => {
    setCurrentMatchIdx(0);
    onSearchChange?.(escaped);
  }, [findText, escaped, onSearchChange]);

  // Clear highlight when panel closes
  useEffect(() => {
    if (!open) onSearchChange?.("");
  }, [open, onSearchChange]);

  // Scroll to the current match's chapter
  const navigateToMatch = useCallback((idx: number) => {
    if (idx < 0 || idx >= matchLocations.length) return;
    setCurrentMatchIdx(idx);
    const loc = matchLocations[idx];
    onScrollToChapter?.(loc.chapterId);
  }, [matchLocations, onScrollToChapter]);

  const goNext = useCallback(() => {
    if (totalMatches === 0) return;
    const next = (currentMatchIdx + 1) % totalMatches;
    navigateToMatch(next);
  }, [currentMatchIdx, totalMatches, navigateToMatch]);

  const goPrev = useCallback(() => {
    if (totalMatches === 0) return;
    const prev = (currentMatchIdx - 1 + totalMatches) % totalMatches;
    navigateToMatch(prev);
  }, [currentMatchIdx, totalMatches, navigateToMatch]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleReplaceAll = () => {
    if (!escaped) return;
    let totalReplaced = 0;
    const updated = chapters.map((ch) => {
      const bodyCount = (ch.body.match(new RegExp(escaped, "gi")) || []).length;
      const titleCount = (ch.title.match(new RegExp(escaped, "gi")) || []).length;
      totalReplaced += bodyCount + titleCount;
      return {
        ...ch,
        body: ch.body.replace(new RegExp(escaped, "gi"), replaceText),
        title: ch.title.replace(new RegExp(escaped, "gi"), replaceText),
      };
    });

    if (totalReplaced === 0) {
      toast({ title: "No matches found" });
    } else {
      onUpdateChapters(updated);
      toast({
        title: "✓ Replacement complete",
        description: `Replaced ${totalReplaced} occurrence${totalReplaced !== 1 ? "s" : ""} of "${findText}" with "${replaceText}" across all chapters.`,
      });
      setFindText("");
      setReplaceText("");
    }
  };

  const currentLocation = matchLocations[currentMatchIdx] || null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10"
      >
        <Search className="w-3.5 h-3.5" />
        Search & Replace
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2 rounded-lg border border-border/40 bg-muted/30 p-4">
              {/* Mode tabs */}
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setMode("find")}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                    mode === "find"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Search className="w-3 h-3 inline mr-1" />
                  Find
                </button>
                <button
                  onClick={() => setMode("replace")}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                    mode === "replace"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Replace className="w-3 h-3 inline mr-1" />
                  Find & Replace
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground font-medium">
                Search across all {chapters.length} chapters (titles & body)
              </p>

              {/* Search input */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                    placeholder="Search text…"
                    className="text-xs h-9 pl-8"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.shiftKey) goPrev();
                        else if (mode === "find") goNext();
                        else if (escaped && totalMatches > 0) setConfirmOpen(true);
                      }
                    }}
                  />
                </div>

                {/* Match counter + navigation */}
                {escaped && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap min-w-fit">
                      {totalMatches > 0 ? `${currentMatchIdx + 1}/${totalMatches}` : "0"} in {chapterHits} ch.
                    </span>
                    <button
                      onClick={goPrev}
                      disabled={totalMatches === 0}
                      className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Previous match (Shift+Enter)"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={goNext}
                      disabled={totalMatches === 0}
                      className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Next match (Enter)"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Replace input (only in replace mode) */}
              {mode === "replace" && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Replace className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={replaceText}
                      onChange={(e) => setReplaceText(e.target.value)}
                      placeholder="Replace with…"
                      className="text-xs h-9 pl-8"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && findText.trim()) {
                          e.preventDefault();
                          handleReplaceAll();
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {mode === "replace" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8 gap-1.5"
                    disabled={!escaped || totalMatches === 0}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Replace className="w-3 h-3" />
                    Replace All ({totalMatches})
                  </Button>
                )}
                {escaped && matchLocations.length > 0 && (
                  <button
                    onClick={() => setShowResults(!showResults)}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
                  >
                    <Eye className="w-3 h-3" />
                    {showResults ? "Hide" : "Show"} results
                  </button>
                )}
              </div>

              {/* Search results list */}
              <AnimatePresence>
                {escaped && showResults && matchLocations.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-1 max-h-52 overflow-y-auto space-y-1 rounded-md border border-border/30 bg-background/50 p-2">
                      {matchLocations.map((loc, i) => (
                        <button
                          key={`${loc.chapterId}-${loc.field}-${loc.matchIndex}`}
                          onClick={() => navigateToMatch(i)}
                          className={`w-full text-left rounded-md px-2.5 py-1.5 transition-colors ${
                            i === currentMatchIdx
                              ? "bg-primary/10 border border-primary/30"
                              : "border border-transparent hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-accent whitespace-nowrap">
                              Ch.{loc.chapterIdx + 1}
                            </span>
                            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                              {loc.field}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                              #{i + 1}
                            </span>
                          </div>
                          <p className="text-[10px] text-foreground/80 leading-relaxed mt-0.5">
                            <HighlightSnippet text={loc.snippet} escaped={escaped} />
                          </p>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {escaped && totalMatches === 0 && (
                <p className="text-[10px] text-muted-foreground italic">No matches found</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Replace All</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace <span className="font-semibold">{totalMatches}</span> occurrence{totalMatches !== 1 ? "s" : ""} of "<span className="font-semibold">{findText}</span>" with "<span className="font-semibold">{replaceText}</span>" across {chapterHits} chapter{chapterHits !== 1 ? "s" : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReplaceAll}>
              <CheckCircle className="w-4 h-4 mr-1" /> Replace All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
