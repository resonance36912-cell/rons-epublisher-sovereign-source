import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { Search, Replace, ChevronDown, ChevronUp, Save, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SlideChapter } from "../StoryForgeContext";
import { ChapterImagesEditor } from "./ChapterImagesEditor";

type Props = {
  chapter: SlideChapter;
  onUpdate: (updates: Partial<SlideChapter>) => void;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
};

export function ChapterEditPanel({ chapter, onUpdate, onClose, onSave, saving }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findMode, setFindMode] = useState<"find" | "replace">("find");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const escaped = findText.trim() ? findText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";

  const bodyMatchCount = escaped
    ? (chapter.body.match(new RegExp(escaped, "gi")) || []).length
    : 0;
  const titleMatchCount = escaped
    ? (chapter.title.match(new RegExp(escaped, "gi")) || []).length
    : 0;
  const matchCount = bodyMatchCount + titleMatchCount;

  const handleReplaceAll = () => {
    if (!escaped || matchCount === 0) return;
    const updates: Partial<SlideChapter> = {};
    if (bodyMatchCount > 0) updates.body = chapter.body.replace(new RegExp(escaped, "gi"), replaceText);
    if (titleMatchCount > 0) updates.title = chapter.title.replace(new RegExp(escaped, "gi"), replaceText);
    onUpdate(updates);
    toast({
      title: "✓ Replacement complete",
      description: `Replaced ${matchCount} occurrence${matchCount !== 1 ? "s" : ""} of "${findText}" with "${replaceText}" in this chapter.`,
    });
    setFindText("");
    setReplaceText("");
  };

  const handleReplaceFirst = () => {
    if (!escaped || matchCount === 0) return;
    if (titleMatchCount > 0) {
      onUpdate({ title: chapter.title.replace(new RegExp(escaped, "i"), replaceText) });
    } else {
      onUpdate({ body: chapter.body.replace(new RegExp(escaped, "i"), replaceText) });
    }
    toast({ title: "Replaced 1 occurrence" });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="space-y-3 overflow-hidden"
    >
      <Input
        value={chapter.title}
        onChange={(e) => onUpdate({ title: e.target.value })}
        className="font-serif text-sm font-semibold"
        placeholder={t("visual.chapterTitle")}
      />
      <Textarea
        value={chapter.body}
        onChange={(e) => onUpdate({ body: e.target.value })}
        className="min-h-[120px] resize-none text-xs"
        placeholder={t("visual.chapterContent")}
      />

      {/* Multi-image manager (Phase A) */}
      <ChapterImagesEditor chapter={chapter} onUpdate={onUpdate} />

      {/* Search & Replace toggle */}
      <button
        onClick={() => setShowFindReplace(!showFindReplace)}
        className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
      >
        <Search className="w-3 h-3" />
        Search & Replace
        {showFindReplace ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {showFindReplace && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3"
        >
          {/* Mode tabs */}
          <div className="flex gap-1 mb-1">
            <button
              onClick={() => setFindMode("find")}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors ${
                findMode === "find"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              Find
            </button>
            <button
              onClick={() => setFindMode("replace")}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors ${
                findMode === "replace"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              Replace
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Search text…"
                className="text-xs h-8 pl-7"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && findText.trim() && findMode === "replace") {
                    e.preventDefault();
                    handleReplaceFirst();
                  }
                }}
              />
            </div>
            {escaped && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
                {titleMatchCount > 0 && ` (${titleMatchCount} in title)`}
              </span>
            )}
          </div>

          {findMode === "replace" && (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Replace className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <Input
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="Replace with…"
                    className="text-xs h-8 pl-7"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && findText.trim()) {
                        e.preventDefault();
                        handleReplaceFirst();
                      }
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-xs h-7"
                  disabled={!escaped || matchCount === 0}
                  onClick={handleReplaceFirst}
                >
                  Replace
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-xs h-7"
                  disabled={!escaped || matchCount === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  Replace All ({matchCount})
                </Button>
              </div>
            </>
          )}

          {escaped && matchCount === 0 && (
            <p className="text-[10px] text-muted-foreground italic">No matches found</p>
          )}
        </motion.div>
      )}

      <div className="flex items-center gap-2">
        {onSave && (
          <Button variant="default" size="sm" onClick={onSave} disabled={saving} className="text-xs gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
          {t("visual.doneEditing")}
        </Button>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Replace All</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace <span className="font-semibold">{matchCount}</span> occurrence{matchCount !== 1 ? "s" : ""} of "<span className="font-semibold">{findText}</span>" with "<span className="font-semibold">{replaceText}</span>" in this chapter. This action cannot be undone.
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
    </motion.div>
  );
}
