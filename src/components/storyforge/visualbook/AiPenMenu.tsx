import { useState, useCallback } from "react";
import { PenTool, X, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import type { SlideChapter } from "../StoryForgeContext";
import { AI_INPUT_LIMITS } from "@/lib/ai-input-limits";
import { AiInputLimitNotice } from "../AiInputLimitNotice";

export type AiEditMode = "improve" | "shorten" | "expand" | "tone_formal" | "tone_casual" | "remove_object" | "replace_object" | "regenerate_image" | "custom";

const NEEDS_INSTRUCTION = new Set<AiEditMode>(["remove_object", "replace_object", "regenerate_image"]);

const AI_MODES: { mode: AiEditMode; label: string; icon: string }[] = [
  { mode: "improve", label: "Improve Writing", icon: "✨" },
  { mode: "expand", label: "Add More Detail", icon: "📝" },
  { mode: "shorten", label: "Make Concise", icon: "✂️" },
  { mode: "tone_formal", label: "Formal Tone", icon: "🎩" },
  { mode: "tone_casual", label: "Casual Tone", icon: "💬" },
  { mode: "remove_object", label: "Remove Object", icon: "🗑️" },
  { mode: "replace_object", label: "Replace Object", icon: "🔄" },
  { mode: "regenerate_image", label: "Regenerate Image", icon: "🖼️" },
];

type Props = {
  chapter: SlideChapter;
  onRewrite: (mode: AiEditMode, instruction?: string) => void;
  isRewriting: boolean;
  onClose: () => void;
};

export function AiPenMenu({ chapter, onRewrite, isRewriting, onClose }: Props) {
  const [instruction, setInstruction] = useState("");
  const [pendingMode, setPendingMode] = useState<AiEditMode | null>(null);
  const instructionTooLong = instruction.length > AI_INPUT_LIMITS.rewriteInstruction;
  const bodyTooLong = (chapter.body?.length ?? 0) > AI_INPUT_LIMITS.rewriteBody;

  const handleModeClick = useCallback((mode: AiEditMode) => {
    if (NEEDS_INSTRUCTION.has(mode)) {
      setPendingMode(mode);
      setInstruction("");
    } else {
      onRewrite(mode);
    }
  }, [onRewrite]);

  const handleSubmit = useCallback(() => {
    if (pendingMode) {
      onRewrite(pendingMode, instruction);
      setPendingMode(null);
    } else {
      onRewrite("custom", instruction);
    }
    setInstruction("");
  }, [pendingMode, instruction, onRewrite]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      className="absolute right-0 top-full mt-2 z-20 w-64 glass-card p-3 space-y-2 shadow-xl"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-primary flex items-center gap-1">
          <PenTool className="w-3 h-3" /> AI Pen
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />
        </button>
      </div>

      {AI_MODES.map((m) => (
        <button
          key={m.mode}
          disabled={isRewriting}
          onClick={() => handleModeClick(m.mode)}
          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium hover:bg-primary/10 transition-colors flex items-center gap-2 disabled:opacity-50 ${pendingMode === m.mode ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
        >
          <span>{m.icon}</span>
          {m.label}
        </button>
      ))}

      <div className="border-t border-border/30 pt-2 space-y-1.5">
        <Input
          placeholder={
            pendingMode === "remove_object" ? "What to remove… e.g. 'the red car'" :
            pendingMode === "regenerate_image" ? "Extra guidance… e.g. 'make it nighttime'" :
            pendingMode === "replace_object" ? "Old → New… e.g. 'sword → laser gun'" :
            "Custom instruction…"
          }
          value={instruction}
          maxLength={AI_INPUT_LIMITS.rewriteInstruction + 200}
          aria-invalid={instructionTooLong}
          aria-describedby={instructionTooLong ? "ai-pen-instruction-error" : undefined}
          onChange={(e) => setInstruction(e.target.value)}
          className="text-xs h-8"
          disabled={isRewriting}
          autoFocus={!!pendingMode}
          onKeyDown={(e) => {
            if (e.key === "Enter" && instruction.trim() && !instructionTooLong && !bodyTooLong) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div id="ai-pen-instruction-error">
          <AiInputLimitNotice
            field="instruction"
            current={instruction.length}
            limit={AI_INPUT_LIMITS.rewriteInstruction}
          />
        </div>
        <AiInputLimitNotice
          field="chapter body"
          current={chapter.body?.length ?? 0}
          limit={AI_INPUT_LIMITS.rewriteBody}
        />
        <Button
          size="sm"
          className="w-full text-xs h-7 gap-1"
          disabled={isRewriting || !instruction.trim() || instructionTooLong || bodyTooLong}
          onClick={handleSubmit}
        >
          {isRewriting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {isRewriting ? "Processing…" :
            pendingMode === "remove_object" ? "Remove" :
            pendingMode === "regenerate_image" ? "Regenerate" :
            pendingMode === "replace_object" ? "Replace" :
            "Apply"}
        </Button>
      </div>
    </motion.div>
  );
}
