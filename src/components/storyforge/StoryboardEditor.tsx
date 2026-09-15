import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStoryForge, type SlideChapter } from "./StoryForgeContext";
import { processSources, generateStoryboard } from "@/lib/storyforge-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, RefreshCw, GripVertical, Plus, Trash2, Sparkles, Square, Undo2, Redo2, Save, Check, Loader2, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { hasFreeGenerationBeenUsed, markFreeGenerationUsed } from "@/hooks/use-free-generation";
import { useI18n } from "@/lib/i18n";
import { useLastSavedLabel } from "./projectmanager/useLastSavedLabel";
import { GenerationStepper, type GenerationStep } from "./GenerationStepper";
import { useChapterImageViewAudit } from "@/hooks/useChapterImageViewAudit";
import { RequestIdBadge } from "./RequestIdBadge";
import { StoryboardError } from "@/lib/storyforge-api";

type StepId = GenerationStep["id"];
const INITIAL_STEPS: GenerationStep[] = [
  { id: "review", label: "Review sources", status: "idle" },
  { id: "transcribe", label: "Transcribe", status: "idle" },
  { id: "search", label: "Search", status: "idle" },
  { id: "generate", label: "Generate storyboard", status: "idle" },
];

function classifyGenerationFailure(
  err: unknown,
  ctx: { topicLength: number; sourceCount: number; activeStepId: StepId | null },
): {
  title: string;
  message: string;
  suggestions: string[];
  category: "timeout" | "size" | "rate" | "auth" | "content" | "generic";
} {
  const raw = String((err as { message?: string })?.message ?? err ?? "");
  const m = raw.toLowerCase();
  const stepLabel =
    ctx.activeStepId === "transcribe" ? "transcribing sources" :
    ctx.activeStepId === "search" ? "researching sources" :
    ctx.activeStepId === "generate" ? "writing the storyboard" : "generating";

  if (m.includes("timed out") || m.includes("timeout") || m.includes("network") || m.includes("failed to fetch") || m.includes("502") || m.includes("503") || m.includes("504") || m.includes("gateway")) {
    return {
      category: "timeout",
      title: `Generation timed out while ${stepLabel}`,
      message: "We retried automatically but the AI service kept timing out. This usually clears up within a minute or two.",
      suggestions: [
        "Wait 30–60 seconds and tap Try Again — the upstream model may be temporarily overloaded.",
        ctx.topicLength > 1500 ? `Shorten your topic (currently ~${ctx.topicLength} chars) to under 1,500 characters.` : "Trim very long source pages or remove the largest one and retry.",
        ctx.sourceCount > 6 ? `Reduce sources to 5 or fewer (currently ${ctx.sourceCount}) to lighten the request.` : "Switch depth to Summary for a faster first pass, then expand.",
      ],
    };
  }
  if (m.includes("413") || m.includes("too large") || m.includes("exceeds") || m.includes("payload") || m.includes("max length") || m.includes("limit")) {
    return {
      category: "size",
      title: "Input is too large for the AI model",
      message: "The combined topic + sources exceeded the model's input limit.",
      suggestions: [
        ctx.topicLength > 1500 ? `Shorten your topic (currently ~${ctx.topicLength} chars).` : "Trim long source content or remove the largest source.",
        "Remove duplicate or low-value sources before retrying.",
        "Switch depth from Extensive to Standard or Summary.",
      ],
    };
  }
  if (m.includes("429") || m.includes("rate limit") || m.includes("quota") || m.includes("daily limit") || m.includes("too many requests")) {
    return {
      category: "rate",
      title: "Daily limit or rate cap reached",
      message: "You've hit a usage limit on the AI service.",
      suggestions: [
        "Wait a few minutes and try again — short bursts often clear quickly.",
        "Check your plan in Pricing — upgrading lifts the daily cap.",
        "If you just generated several books in a row, wait until the daily window resets.",
      ],
    };
  }
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden") || m.includes("sign in")) {
    return {
      category: "auth",
      title: "Your session expired",
      message: "We couldn't authenticate the request to the AI service.",
      suggestions: [
        "Sign out and sign back in, then retry the generation.",
        "If you're on a shared device, refresh the page to renew your session.",
      ],
    };
  }
  if (m.includes("no storyboard") || m.includes("no chapters") || m.includes("empty") || m.includes("blocked") || m.includes("safety")) {
    return {
      category: "content",
      title: "The AI returned no usable content",
      message: "The model couldn't produce chapters from the current inputs. Sometimes this is a safety filter, sometimes the sources didn't contain enough text.",
      suggestions: [
        "Rephrase your topic to be more specific or descriptive.",
        "Add at least one source with substantive text (a long article or a transcribed video).",
        "Try a different Theme or Tone in Story Settings.",
      ],
    };
  }
  return {
    category: "generic",
    title: `Generation failed while ${stepLabel}`,
    message: raw || "An unexpected error occurred.",
    suggestions: [
      "Try Again — most failures clear on a second attempt.",
      "If it fails again, reduce sources or shorten the topic and retry.",
      "Copy the Request ID below and share it with support if the problem persists.",
    ],
  };
}

function ChapterCard({
  chapter,
  index,
  onUpdate,
  onDelete,
  draggable,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  chapter: SlideChapter;
  index: number;
  onUpdate: (updates: Partial<SlideChapter>) => void;
  onDelete: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: isDragging ? 1 : 1, scale: isDragging ? 1.01 : 1 }}
      exit={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.5 }}
      className={`slide-card p-3 sm:p-6 space-y-3 sm:space-y-4 ${isDragging ? "ring-2 ring-primary/40 shadow-lg opacity-90" : ""}`}
    >
      {chapter.imageUrl && (
        <div className="rounded-lg overflow-hidden border">
          <img
            src={chapter.imageUrl}
            alt={chapter.title}
            className="w-full h-48 object-cover"
            loading="lazy"
          />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div
          className="flex items-center gap-2 pt-2 select-none"
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <GripVertical className={`w-4 h-4 ${draggable ? "text-muted-foreground cursor-grab active:cursor-grabbing hover:text-foreground" : "text-muted-foreground cursor-default"}`} />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Ch. {index + 1}
          </span>
        </div>
        <div className="flex-1 space-y-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Title</span>
            <Input
              value={chapter.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="Chapter title…"
              className="font-serif text-lg font-semibold bg-background mt-1"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Summary</span>
            <Textarea
              value={chapter.body}
              onChange={(e) => onUpdate({ body: e.target.value })}
              placeholder="What happens in this chapter…"
              className="min-h-[120px] resize-y bg-background mt-1"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Scene beats</span>
            <Textarea
              value={chapter.notes || ""}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder={"• Beat 1 — opening moment\n• Beat 2 — rising action\n• Beat 3 — turning point"}
              className="min-h-[90px] resize-y bg-background mt-1 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Image prompt</span>
            <Input
              value={chapter.imagePrompt || ""}
              onChange={(e) => onUpdate({ imagePrompt: e.target.value })}
              placeholder="Cinematic image prompt…"
              className="text-sm bg-background mt-1"
            />
          </label>
        </div>
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
          aria-label="Delete chapter"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

type HistoryEntry = { chapters: SlideChapter[]; label: string; at: number };
const MAX_HISTORY = 50;

export function StoryboardEditor() {
  const {
    sources, setSources, config, chapters, setChapters, setStep,
    setStoryline, setStorylineAccepted, isGenerating, setIsGenerating, projectDirty, lastSavedAt, projectId,
  } = useStoryForge();
  useChapterImageViewAudit("Render storyboard editor", projectId, chapters);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [generationRequestId, setGenerationRequestId] = useState<string | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; reason: string } | null>(null);
  const [failureInfo, setFailureInfo] = useState<{
    title: string;
    message: string;
    suggestions: string[];
    requestId?: string | null;
    category: "timeout" | "size" | "rate" | "auth" | "content" | "generic";
  } | null>(null);
  const [showSourceList, setShowSourceList] = useState(false);
  const [steps, setSteps] = useState<GenerationStep[]>(INITIAL_STEPS);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const collectedSourcesRef = useRef<typeof sources>([]);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();

  // ── Drag-and-drop reordering ────────────────────────────────────
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dragGhostRef = useRef<{ id: string; index: number } | null>(null);

  // ── Step controller helpers ──────────────────────────────────────
  const updateStep = useCallback((id: StepId, patch: Partial<GenerationStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const startStep = useCallback((id: StepId, hint?: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status: "active", hint, startedAt: s.startedAt ?? Date.now(), endedAt: undefined, error: undefined }
          : s
      )
    );
  }, []);
  const completeStep = useCallback((id: StepId) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "done", endedAt: Date.now(), hint: undefined } : s))
    );
  }, []);
  const failStep = useCallback((id: StepId, error: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "error", endedAt: Date.now(), error } : s))
    );
  }, []);
  const resetSteps = useCallback(() => {
    // Re-seed; "review" is auto-completed when we have configured sources.
    setSteps(INITIAL_STEPS.map((s) => ({ ...s })));
  }, []);

  // ── Undo / Redo history ──────────────────────────────────────────
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const suppressHistoryRef = useRef(false);
  const lastSnapshotRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceTick] = useState(0);
  const bumpHistoryUI = useCallback(() => forceTick((n) => n + 1), []);

  const snapshotChapters = useCallback((label: string) => {
    if (suppressHistoryRef.current) return;
    const sig = JSON.stringify(chapters);
    if (sig === lastSnapshotRef.current) return;
    undoStack.current.push({ chapters: JSON.parse(sig), label, at: Date.now() });
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    lastSnapshotRef.current = sig;
    bumpHistoryUI();
  }, [chapters, bumpHistoryUI]);

  // Seed first snapshot whenever we receive a fresh chapter set
  useEffect(() => {
    const sig = JSON.stringify(chapters);
    if (!lastSnapshotRef.current && chapters.length > 0) {
      lastSnapshotRef.current = sig;
      undoStack.current = [{ chapters: JSON.parse(sig), label: "Initial", at: Date.now() }];
      redoStack.current = [];
      bumpHistoryUI();
    }
  }, [chapters, bumpHistoryUI]);

  const undo = useCallback(() => {
    if (undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    suppressHistoryRef.current = true;
    setChapters(prev.chapters);
    lastSnapshotRef.current = JSON.stringify(prev.chapters);
    setTimeout(() => { suppressHistoryRef.current = false; }, 0);
    bumpHistoryUI();
  }, [setChapters, bumpHistoryUI]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    suppressHistoryRef.current = true;
    setChapters(next.chapters);
    lastSnapshotRef.current = JSON.stringify(next.chapters);
    setTimeout(() => { suppressHistoryRef.current = false; }, 0);
    bumpHistoryUI();
  }, [setChapters, bumpHistoryUI]);

  // Keyboard shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z (redo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);


  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  const checkAuthGate = useCallback(async (): Promise<boolean> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return true;
    if (!hasFreeGenerationBeenUsed()) return true;
    toast({
      title: "Free generation used",
      description: "Sign in or create an account to continue generating storybooks.",
    });
    navigate("/auth");
    return false;
  }, [toast, navigate]);

  const startProgress = useCallback((target: number, durationMs: number) => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    const clampedTarget = Math.min(Math.max(target, 0), 100);
    const steps = Math.max(1, Math.floor(durationMs / 200));
    let tick = 0;
    progressTimer.current = setInterval(() => {
      tick++;
      setProgressPercent((prev) => {
        const increment = (clampedTarget - prev) / Math.max(1, steps - tick);
        const next = Math.min(clampedTarget, prev + Math.max(0.1, increment));
        if (next >= clampedTarget || tick >= steps) {
          if (progressTimer.current) clearInterval(progressTimer.current);
          return clampedTarget;
        }
        return Math.min(100, Math.max(0, next));
      });
    }, 200);
  }, []);

  const doGenerate = useCallback(async () => {
    const allowed = await checkAuthGate();
    if (!allowed) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setProgressPercent(0);
    setShowSourceList(false);
    setRetryInfo(null);
    setFailureInfo(null);
    collectedSourcesRef.current = [];

    // Reset & seed steps. "Review sources" is complete the moment we kick off
    // generation because the user has already curated their source list.
    resetSteps();
    const reviewStart = Date.now();
    updateStep("review", { status: "done", startedAt: reviewStart, endedAt: reviewStart });

    let activeStepId: StepId | null = null;
    try {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

      // ── Transcribe ──────────────────────────────────────────────
      activeStepId = "transcribe";
      startStep("transcribe", "Pulling text from uploaded files & web pages…");
      setProgressMsg("Transcribing files & scraping URLs…");
      startProgress(20, 8000);

      const allSources = [...sources];
      const hasYouTubeSearch = allSources.some(
        (s) => s.type === "search" && s.title.toLowerCase().includes("youtube")
      );
      if (!hasYouTubeSearch && config.topic.trim()) {
        // Source titles are capped at AI_INPUT_LIMITS.sourceTitle (2000), but
        // topics can be up to 5000 chars. Truncate the query portion so the
        // synthetic YouTube search source doesn't trip the 413 guard.
        const SUFFIX = " site:youtube.com";
        const MAX_TITLE = 2000 - SUFFIX.length - 1;
        const topicTrimmed = config.topic.trim();
        const shortTopic = topicTrimmed.length > MAX_TITLE
          ? topicTrimmed.slice(0, MAX_TITLE)
          : topicTrimmed;
        allSources.push({
          id: crypto.randomUUID(),
          type: "search",
          title: `${shortTopic}${SUFFIX}`,
          status: "pending",
        });
      }

      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

      // ── Search (rolled into the same call by the API; we surface it
      // as its own step so the user sees the discovery work happening).
      activeStepId = "search";
      startStep("search", "Discovering YouTube & web sources…");
      setProgressMsg("Researching sources, scraping content & YouTube…");
      startProgress(45, 15000);
      const processedSources = await processSources(allSources);
      setSources(processedSources);
      collectedSourcesRef.current = processedSources;
      completeStep("transcribe");
      completeStep("search");

      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

      // ── Generate storyboard ─────────────────────────────────────
      activeStepId = "generate";
      startStep("generate", `Writing storyboard from ${processedSources.length} sources…`);
      setProgressMsg("Generating in-depth storyboard with AI…");
      if (progressTimer.current) clearInterval(progressTimer.current);
      setProgressPercent(50);
      setGenerationRequestId(null);
      const result = await generateStoryboard(processedSources, config, ({ message, percent, requestId, retrying, attempt, maxAttempts, retryReason }) => {
        setProgressMsg(message);
        setProgressPercent(Math.min(96, Math.max(50, percent)));
        updateStep("generate", { hint: message });
        if (requestId) setGenerationRequestId(requestId);
        if (retrying && attempt && maxAttempts) {
          setRetryInfo({ attempt, maxAttempts, reason: retryReason || "Timed out" });
        } else {
          setRetryInfo(null);
        }
      });
      setChapters(result);
      setStoryline("");
      setStorylineAccepted(false);
      markFreeGenerationUsed();
      completeStep("generate");

      if (progressTimer.current) clearInterval(progressTimer.current);
      setProgressPercent(100);
      setProgressMsg("Complete!");
      setTimeout(() => setProgressMsg(""), 1500);
    } catch (err: any) {
      if (progressTimer.current) clearInterval(progressTimer.current);

      if (err.name === "AbortError" || controller.signal.aborted) {
        setProgressPercent(0);
        setProgressMsg("");
        setShowSourceList(true);
        if (activeStepId) {
          updateStep(activeStepId, { status: "idle", endedAt: Date.now(), hint: "Stopped by user" });
        }
        toast({
          title: "Generation stopped",
          description: `Stopped with ${collectedSourcesRef.current.length} sources collected.`,
        });
      } else {
        console.error("Generation failed:", err);
        setProgressPercent(0);
        setProgressMsg("");
        setRetryInfo(null);
        const classified = classifyGenerationFailure(err, {
          topicLength: (config.topic || "").trim().length,
          sourceCount: sources.length,
          activeStepId,
        });
        if (activeStepId) {
          failStep(activeStepId, classified.message);
        }
        const reqId = err instanceof StoryboardError ? err.requestId : generationRequestId;
        setFailureInfo({ ...classified, requestId: reqId });
        toast({
          title: classified.title,
          description: classified.suggestions[0],
          variant: "destructive",
        });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [
    checkAuthGate, sources, config, setSources, setChapters, setStoryline, setStorylineAccepted, setIsGenerating,
    startProgress, toast, resetSteps, startStep, completeStep, failStep, updateStep,
  ]);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (progressTimer.current) clearInterval(progressTimer.current);
    setIsGenerating(false);
    setShowSourceList(true);
  }, [setIsGenerating]);

  useEffect(() => {
    if (chapters.length === 0 && !isGenerating) {
      doGenerate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateChapter = useCallback((id: string, updates: Partial<SlideChapter>) => {
    // Snapshot before applying so undo restores the previous text exactly
    snapshotChapters(`Edit ${Object.keys(updates).join(", ")}`);
    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    // Debounce a label refresh for the autosave indicator
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => bumpHistoryUI(), 600);
  }, [setChapters, snapshotChapters, bumpHistoryUI]);

  const deleteChapter = useCallback((id: string) => {
    snapshotChapters("Delete chapter");
    setChapters((prev) => prev.filter((c) => c.id !== id));
  }, [setChapters, snapshotChapters]);

  const addChapter = useCallback(() => {
    snapshotChapters("Add chapter");
    const newChapter: SlideChapter = {
      id: crypto.randomUUID(),
      title: "New Chapter",
      body: "Describe what happens in this chapter…",
      notes: "",
    };
    setChapters((prev) => [...prev, newChapter]);
  }, [setChapters, snapshotChapters]);

  // ── Drag-and-drop handlers ───────────────────────────────────────
  const handleDragStart = useCallback((index: number, id: string) => (e: React.DragEvent) => {
    dragGhostRef.current = { id, index };
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);
  }, []);

  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDropTargetIndex(index);
  }, [draggedIndex]);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIndex = draggedIndex;
    if (sourceIndex === null || sourceIndex === targetIndex) {
      setDraggedIndex(null);
      setDropTargetIndex(null);
      dragGhostRef.current = null;
      return;
    }
    snapshotChapters("Reorder chapters");
    setChapters((prev) => {
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedIndex(null);
    setDropTargetIndex(null);
    dragGhostRef.current = null;
  }, [draggedIndex, setChapters, snapshotChapters]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
    dragGhostRef.current = null;
  }, []);

  const savedLabel = useLastSavedLabel(lastSavedAt);
  const canUndo = undoStack.current.length > 1;
  const canRedo = redoStack.current.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-3xl mx-auto space-y-4 sm:space-y-8 px-2 sm:px-0"
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl sm:text-2xl font-serif font-semibold">{t("storyboard.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {chapters.length} {t("storyboard.chaptersGenerated")}
        </p>
      </div>

      {/* Controls + Autosave + Undo/Redo */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {isGenerating ? (
          <Button variant="destructive" onClick={stopGeneration} className="gap-2" size="sm">
            <Square className="w-4 h-4" /> {t("storyboard.stopGeneration")}
          </Button>
        ) : (
          <Button variant="outline" onClick={doGenerate} className="gap-2" size="sm">
            <RefreshCw className="w-4 h-4" /> {t("storyboard.regenerateAll")}
          </Button>
        )}

        <div className="w-px h-6 bg-border/50 hidden sm:block" />

        <Button
          variant="outline"
          size="sm"
          onClick={undo}
          disabled={!canUndo || isGenerating}
          className="gap-1.5"
          title="Undo (⌘/Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" /> Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={redo}
          disabled={!canRedo || isGenerating}
          className="gap-1.5"
          title="Redo (⌘/Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" /> Redo
        </Button>

        <span
          className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${
            projectDirty
              ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
              : "bg-primary/10 text-primary border-primary/25"
          }`}
          title={projectDirty ? "Edits queued — autosaving shortly" : (savedLabel || "All changes saved")}
        >
          {projectDirty ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
          ) : lastSavedAt ? (
            <><Check className="w-3 h-3" /> {savedLabel || "Saved"}</>
          ) : (
            <><Save className="w-3 h-3" /> Idle</>
          )}
        </span>
      </div>

      {/* Source list after stopping */}
      {showSourceList && !isGenerating && collectedSourcesRef.current.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border rounded-xl p-6 space-y-4"
        >
          <h3 className="text-sm font-semibold">
            {collectedSourcesRef.current.length} Sources Available for Transcription
          </h3>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {collectedSourcesRef.current.map((s, i) => (
              <div key={s.id || i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/50">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  s.type === "url" ? "bg-blue-500/10 text-blue-600" :
                  s.type === "search" ? "bg-amber-500/10 text-amber-600" :
                  "bg-green-500/10 text-green-600"
                }`}>
                  {s.type === "url" ? "URL" : s.type === "search" ? "Search" : "File"}
                </span>
                <span className="truncate flex-1">{s.title}</span>
                <span className={`text-[10px] ${s.status === "ready" ? "text-green-600" : "text-muted-foreground"}`}>
                  {s.status === "ready" ? "✓ Ready" : s.status}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => { setShowSourceList(false); doGenerate(); }} className="gap-1">
              <Sparkles className="w-3 h-3" /> Resume Generation
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowSourceList(false)}>
              Dismiss
            </Button>
          </div>
        </motion.div>
      )}

      {/* Multi-step progress + skeletons (also shown after errors so users see which step failed) */}
      {(isGenerating || steps.some((s) => s.status === "error")) && (
        <div className="space-y-6">
          {retryInfo && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
            >
              <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-amber-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  Retrying after timeout — attempt {retryInfo.attempt} of {retryInfo.maxAttempts}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {retryInfo.reason}
                </div>
              </div>
            </div>
          )}
          <GenerationStepper steps={steps} />
          {failureInfo && !isGenerating && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 mt-0.5 text-destructive shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-destructive">{failureInfo.title}</div>
                  <div className="text-sm text-foreground/80 mt-1">{failureInfo.message}</div>
                </div>
              </div>
              <div className="pl-8">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Suggested next steps
                </div>
                <ul className="space-y-1.5 text-sm">
                  {failureInfo.suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-destructive font-bold shrink-0">{i + 1}.</span>
                      <span className="text-foreground/90">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 pl-8">
                <Button size="sm" onClick={() => { setFailureInfo(null); doGenerate(); }} className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Try Again
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setFailureInfo(null); setStep(2); }}>
                  Edit Story Settings
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setFailureInfo(null); setStep(1); }}>
                  Manage Sources
                </Button>
                {failureInfo.requestId && (
                  <div className="ml-auto">
                    <RequestIdBadge requestId={failureInfo.requestId} />
                  </div>
                )}
              </div>
            </div>
          )}
          {isGenerating && (
            <div className="bg-card border rounded-xl p-4 sm:p-5 space-y-2">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-muted-foreground font-medium truncate mr-2">{progressMsg || "Preparing…"}</span>
                <span className="text-primary font-semibold shrink-0 tabular-nums">{Math.round(progressPercent)}%</span>
              </div>
              <Progress value={progressPercent} className="h-2 sm:h-3" />
              {generationRequestId && (
                <div className="flex justify-end pt-1">
                  <RequestIdBadge requestId={generationRequestId} />
                </div>
              )}
            </div>
          )}
          {isGenerating && [1, 2, 3].map((i) => (
            <div key={i} className="bg-card border rounded-lg p-6 animate-pulse space-y-3">
              <div className="h-5 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-4/5" />
              <div className="h-3 bg-muted rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Chapters */}
      <AnimatePresence mode="popLayout">
        {chapters.map((chapter, index) => (
          <div key={chapter.id}>
            {dropTargetIndex === index && draggedIndex !== index && (
              <div className="h-1 rounded-full bg-primary my-2 animate-pulse" aria-hidden="true" />
            )}
            <div
              onDragOver={handleDragOver(index)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(index)}
            >
              <ChapterCard
                chapter={chapter}
                index={index}
                onUpdate={(updates) => updateChapter(chapter.id, updates)}
                onDelete={() => deleteChapter(chapter.id)}
                draggable={!isGenerating}
                onDragStart={handleDragStart(index, chapter.id)}
                onDragEnd={handleDragEnd}
                isDragging={draggedIndex === index}
              />
            </div>
          </div>
        ))}
      </AnimatePresence>

      {/* Add chapter */}
      {chapters.length > 0 && (
        <button
          onClick={addChapter}
          className="w-full border-2 border-dashed rounded-lg py-4 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> {t("storyboard.addChapter")}
        </button>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setStep(2)} className="gap-2" size="sm">
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">{t("nav.back")}</span>
        </Button>
        <Button
          onClick={() => setStep(4)}
          disabled={chapters.length === 0}
          className="gap-2"
          size="sm"
        >
          {t("storyboard.storyline")} <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}
