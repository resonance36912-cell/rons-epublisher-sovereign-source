import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Loader2, Activity, Sparkles, Globe, ChevronDown, HardDrive, Target, History, RefreshCw, Trash2, Download, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useBrowserStt, isBrowserSttSupported } from "@/hooks/use-browser-stt";
import { useWhisperStt, isWhisperSttSupported, WHISPER_MODELS, type WhisperModelSize } from "@/hooks/use-whisper-stt";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface EngineMetrics {
  firstResultMs: number | null;
  finalResultMs: number | null;
  charCount: number;
  wordCount: number;
}

const emptyMetrics: EngineMetrics = {
  firstResultMs: null,
  finalResultMs: null,
  charCount: 0,
  wordCount: 0,
};

// Normalize text for WER: lowercase, strip punctuation, collapse whitespace.
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Levenshtein distance over word arrays → WER = edits / max(refLen, 1).
function computeWer(reference: string, hypothesis: string): number | null {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0) return null;
  const m = ref.length;
  const n = hyp.length;
  // Rolling 1-D DP for memory efficiency.
  let prev = new Array(n + 1).fill(0).map((_, j) => j);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] / m;
}

function formatWer(wer: number | null): string {
  if (wer == null) return "—";
  return `${(wer * 100).toFixed(1)}%`;
}

function werTone(wer: number | null): string {
  if (wer == null) return "text-muted-foreground";
  if (wer <= 0.1) return "text-emerald-500";
  if (wer <= 0.25) return "text-amber-500";
  return "text-destructive";
}

function werBorderTone(wer: number | null): string {
  if (wer == null) return "border-border/60";
  if (wer <= 0.1) return "border-emerald-500/60";
  if (wer <= 0.25) return "border-amber-500/60";
  return "border-destructive/60";
}

type DiffOp = { type: "equal" | "insert" | "delete" | "substitute"; ref?: string; hyp?: string };

/** Word-level diff via Levenshtein backtrace (insert/delete/substitute). Uses normalized tokenize() for equality. */
function diffWords(reference: string, hypothesis: string): DiffOp[] {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  const m = ref.length;
  const n = hyp.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const eq = ref[i - 1] === hyp[j - 1];
      dp[i][j] = eq
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      ops.push({ type: "equal", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: "substitute", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: "delete", ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ type: "insert", hyp: hyp[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

function WordDiff({ reference, hypothesis }: { reference: string; hypothesis: string }) {
  const ops = useMemo(() => diffWords(reference, hypothesis), [reference, hypothesis]);
  const counts = useMemo(() => {
    let ins = 0, del = 0, sub = 0, eq = 0;
    for (const o of ops) {
      if (o.type === "insert") ins++;
      else if (o.type === "delete") del++;
      else if (o.type === "substitute") sub++;
      else eq++;
    }
    return { ins, del, sub, eq };
  }, [ops]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span><span className="text-foreground font-mono">{counts.eq}</span> match</span>
        <span className="text-emerald-500"><span className="font-mono">{counts.ins}</span> ins</span>
        <span className="text-destructive"><span className="font-mono">{counts.del}</span> del</span>
        <span className="text-amber-500"><span className="font-mono">{counts.sub}</span> sub</span>
      </div>
      <div className="rounded-md border bg-background/50 p-3 text-sm leading-7">
        {ops.length === 0 && <span className="italic text-muted-foreground">No content to compare.</span>}
        {ops.map((op, idx) => {
          if (op.type === "equal") {
            return <span key={idx} className="mr-1">{op.ref}</span>;
          }
          if (op.type === "insert") {
            return (
              <span key={idx} className="mr-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1 py-0.5">
                +{op.hyp}
              </span>
            );
          }
          if (op.type === "delete") {
            return (
              <span key={idx} className="mr-1 rounded bg-destructive/15 text-destructive px-1 py-0.5 line-through">
                {op.ref}
              </span>
            );
          }
          return (
            <span key={idx} className="mr-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1 py-0.5">
              <span className="line-through opacity-70">{op.ref}</span>
              <span className="mx-0.5">→</span>
              <span>{op.hyp}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MetricsRow({ label, metrics, wer }: { label: string; metrics: EngineMetrics; wer: number | null }) {
  return (
    <div className="grid grid-cols-5 gap-2 text-xs items-center">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono">
        {metrics.firstResultMs != null ? `${metrics.firstResultMs} ms` : "—"}
      </div>
      <div className="font-mono">
        {metrics.finalResultMs != null ? `${metrics.finalResultMs} ms` : "—"}
      </div>
      <div className="font-mono">
        {metrics.wordCount} words · {metrics.charCount} chars
      </div>
      <div className={`font-mono font-medium ${werTone(wer)}`}>
        {formatWer(wer)}
      </div>
    </div>
  );
}

export function AdminSttDiagnosticsSection() {
  const { toast } = useToast();
  const browserSupported = useMemo(() => isBrowserSttSupported(), []);
  const whisperSupported = useMemo(() => isWhisperSttSupported(), []);
  const [running, setRunning] = useState(false);
  const [connectingPremium, setConnectingPremium] = useState(false);
  const [whisperSize, setWhisperSize] = useState<WhisperModelSize>("base");

  const startRef = useRef<number | null>(null);
  const browserFirstRef = useRef<number | null>(null);
  const premiumFirstRef = useRef<number | null>(null);
  const whisperStopRef = useRef<number | null>(null);

  const [browserMetrics, setBrowserMetrics] = useState<EngineMetrics>(emptyMetrics);
  const [premiumMetrics, setPremiumMetrics] = useState<EngineMetrics>(emptyMetrics);
  const [whisperMetrics, setWhisperMetrics] = useState<EngineMetrics>(emptyMetrics);
  const [premiumTranscript, setPremiumTranscript] = useState("");
  const [reference, setReference] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const persistedRunRef = useRef(false);
  const [engineFilter, setEngineFilter] = useState<"all" | "browser" | "whisper" | "premium">("all");
  const [modelFilter, setModelFilter] = useState<"all" | "tiny" | "base" | "small">("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [detailRun, setDetailRun] = useState<any | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyText = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }, [toast]);

  const filteredHistory = useMemo(() => {
    return history.filter((r) => {
      if (engineFilter !== "all" && r.engine !== engineFilter) return false;
      if (modelFilter !== "all" && r.model_size !== modelFilter) return false;
      if (dateFrom && new Date(r.created_at) < dateFrom) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(r.created_at) > end) return false;
      }
      return true;
    });
  }, [history, engineFilter, modelFilter, dateFrom, dateTo]);

  const summaryStats = useMemo(() => {
    const engines: Array<"browser" | "whisper" | "premium"> = ["browser", "whisper", "premium"];
    return engines.map((engine) => {
      const rows = filteredHistory.filter((r) => r.engine === engine);
      const wers = rows.map((r) => r.wer).filter((w): w is number => typeof w === "number");
      const lats = rows.map((r) => r.latency_ms).filter((l): l is number => typeof l === "number");
      const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      return {
        engine,
        count: rows.length,
        avgWer: avg(wers),
        avgLatencyMs: avg(lats),
      };
    });
  }, [filteredHistory]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from("stt_diagnostic_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Could not load history", description: error.message, variant: "destructive" });
    } else {
      setHistory(data ?? []);
    }
    setLoadingHistory(false);
  }, [toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const deleteRun = useCallback(async (id: string) => {
    const { error } = await supabase.from("stt_diagnostic_runs").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      setHistory((h) => h.filter((r) => r.id !== id));
    }
  }, [toast]);

  const clearAllHistory = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("stt_diagnostic_runs").delete().eq("user_id", user.id);
    if (error) {
      toast({ title: "Clear failed", description: error.message, variant: "destructive" });
    } else {
      setHistory([]);
      toast({ title: "History cleared", description: "All your STT diagnostic runs have been deleted." });
    }
  }, [toast]);

  const exportCsv = useCallback(() => {
    if (filteredHistory.length === 0) {
      toast({ title: "Nothing to export", description: "No runs match the current filters.", variant: "destructive" });
      return;
    }
    const headers = ["created_at", "engine", "model_size", "latency_ms", "wer", "reference_text", "transcript", "success"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };
    const csv = [
      headers.join(","),
      ...filteredHistory.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stt-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [filteredHistory, toast]);

  const browserStt = useBrowserStt({
    onError: (msg) => toast({ title: "Browser STT", description: msg, variant: "destructive" }),
  });

  const whisperStt = useWhisperStt({
    modelSize: whisperSize,
    onError: (msg) => toast({ title: "Whisper STT", description: msg, variant: "destructive" }),
  });

  const browserWer = useMemo(() => computeWer(reference, browserStt.fullTranscript), [reference, browserStt.fullTranscript]);
  const whisperWer = useMemo(() => computeWer(reference, whisperStt.fullTranscript), [reference, whisperStt.fullTranscript]);
  const premiumWer = useMemo(() => computeWer(reference, premiumTranscript), [reference, premiumTranscript]);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    onPartialTranscript: () => {
      if (premiumFirstRef.current == null && startRef.current != null) {
        premiumFirstRef.current = Date.now() - startRef.current;
        setPremiumMetrics((m) => ({ ...m, firstResultMs: premiumFirstRef.current }));
      }
    },
    onCommittedTranscript: (data) => {
      setPremiumTranscript((prev) => (prev ? `${prev} ${data.text}` : data.text));
    },
    onError: (error) => {
      const msg = typeof error === "string" ? error : (error as any)?.message || "Scribe error";
      toast({ title: "Scribe error", description: msg, variant: "destructive" });
    },
    onDisconnect: () => {},
  });

  // Track browser STT first/full latency by watching transcripts.
  const browserPartial = browserStt.partialTranscript;
  const browserFull = browserStt.fullTranscript;
  if (
    running &&
    browserFirstRef.current == null &&
    startRef.current != null &&
    (browserPartial.length > 0 || browserFull.length > 0)
  ) {
    browserFirstRef.current = Date.now() - startRef.current;
    setBrowserMetrics((m) => ({ ...m, firstResultMs: browserFirstRef.current }));
  }

  // When Whisper finishes transcribing (offline mode: no live partials), record metrics.
  useEffect(() => {
    if (!whisperStt.isTranscribing && whisperStopRef.current != null && whisperStt.fullTranscript) {
      const text = whisperStt.fullTranscript.trim();
      const transcribeMs = Date.now() - whisperStopRef.current;
      const totalMs = startRef.current != null ? Date.now() - startRef.current : null;
      setWhisperMetrics({
        firstResultMs: transcribeMs, // time from stop → first/only result
        finalResultMs: totalMs,
        charCount: text.length,
        wordCount: text ? text.split(/\s+/).length : 0,
      });
      whisperStopRef.current = null;
    }
  }, [whisperStt.isTranscribing, whisperStt.fullTranscript]);

  const reset = useCallback(() => {
    startRef.current = null;
    browserFirstRef.current = null;
    premiumFirstRef.current = null;
    whisperStopRef.current = null;
    setBrowserMetrics(emptyMetrics);
    setPremiumMetrics(emptyMetrics);
    setWhisperMetrics(emptyMetrics);
    setPremiumTranscript("");
    browserStt.reset();
    whisperStt.reset();
  }, [browserStt, whisperStt]);

  const handleStart = useCallback(async () => {
    if (!browserSupported) {
      toast({
        title: "Browser STT not supported",
        description: "Use Chrome, Edge, or Safari to run this comparison.",
        variant: "destructive",
      });
      return;
    }
    reset();
    persistedRunRef.current = false;
    setConnectingPremium(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-scribe-token");
      if (error) throw new Error(error.message);
      if (!data?.token) throw new Error("No Scribe token received");

      // Start premium first (network handshake), then browser + Whisper, then mark t=0.
      await scribe.connect({
        token: data.token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });

      browserStt.start();
      if (whisperSupported) {
        // Fire-and-forget — Whisper opens its own mic stream and records until stop.
        whisperStt.start().catch(() => {});
      }
      startRef.current = Date.now();
      setRunning(true);
    } catch (err: any) {
      toast({
        title: "Could not start diagnostics",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConnectingPremium(false);
    }
  }, [browserSupported, whisperSupported, reset, scribe, browserStt, whisperStt, toast]);

  const handleStop = useCallback(() => {
    setRunning(false);
    const elapsed = startRef.current != null ? Date.now() - startRef.current : null;

    browserStt.stop();
    try {
      scribe.disconnect();
    } catch {
      // ignore
    }
    if (whisperSupported) {
      whisperStopRef.current = Date.now();
      whisperStt.stop();
    }

    setBrowserMetrics((m) => {
      const text = browserStt.fullTranscript.trim();
      return {
        ...m,
        finalResultMs: elapsed,
        charCount: text.length,
        wordCount: text ? text.split(/\s+/).length : 0,
      };
    });
    setPremiumMetrics((m) => {
      const text = premiumTranscript.trim();
      return {
        ...m,
        finalResultMs: elapsed,
        charCount: text.length,
        wordCount: text ? text.split(/\s+/).length : 0,
      };
    });
  }, [browserStt, scribe, whisperStt, whisperSupported, premiumTranscript]);

  // Persist a 3-row run after stop, once Whisper has finished (or immediately if unsupported).
  useEffect(() => {
    if (running || persistedRunRef.current) return;
    if (browserMetrics.finalResultMs == null && premiumMetrics.finalResultMs == null) return;
    if (whisperSupported && whisperStt.isTranscribing) return;
    persistedRunRef.current = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const ref = reference.trim() || null;
      const rows = [
        {
          user_id: user.id,
          engine: "browser",
          model_size: null,
          latency_ms: browserMetrics.finalResultMs,
          wer: browserWer,
          transcript: browserStt.fullTranscript || null,
          reference_text: ref,
          success: !!browserStt.fullTranscript,
        },
        {
          user_id: user.id,
          engine: "whisper",
          model_size: whisperSize,
          latency_ms: whisperMetrics.finalResultMs,
          wer: whisperWer,
          transcript: whisperStt.fullTranscript || null,
          reference_text: ref,
          success: !!whisperStt.fullTranscript,
        },
        {
          user_id: user.id,
          engine: "premium",
          model_size: "scribe_v2_realtime",
          latency_ms: premiumMetrics.finalResultMs,
          wer: premiumWer,
          transcript: premiumTranscript || null,
          reference_text: ref,
          success: !!premiumTranscript,
        },
      ];
      const { error } = await supabase.from("stt_diagnostic_runs").insert(rows);
      if (error) {
        toast({ title: "Could not save run", description: error.message, variant: "destructive" });
        persistedRunRef.current = false;
      } else {
        loadHistory();
      }
    })();
  }, [running, whisperStt.isTranscribing, whisperSupported, browserMetrics.finalResultMs, premiumMetrics.finalResultMs, whisperMetrics.finalResultMs, browserWer, whisperWer, premiumWer, browserStt.fullTranscript, whisperStt.fullTranscript, premiumTranscript, reference, whisperSize, toast, loadHistory]);

  return (
    <section className="rounded-2xl border bg-card/40 backdrop-blur-sm">
      <Accordion type="single" collapsible>
        <AccordionItem value="stt-diag" className="border-none">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-left">
              <Activity className="w-4 h-4 text-primary" />
              <div>
                <h2 className="text-lg font-semibold">STT Diagnostics</h2>
                <p className="text-xs text-muted-foreground font-normal">
                  Compare Browser, Offline Whisper &amp; ElevenLabs Scribe side-by-side
                </p>
              </div>
              <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground transition-transform" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              {!running ? (
                <Button onClick={handleStart} disabled={connectingPremium} className="gap-2">
                  {connectingPremium ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                  {connectingPremium ? "Connecting…" : "Start comparison"}
                </Button>
              ) : (
                <Button onClick={handleStop} variant="destructive" className="gap-2">
                  <MicOff className="w-4 h-4" /> Stop
                </Button>
              )}
              <Button onClick={reset} variant="ghost" size="sm" disabled={running || whisperStt.isTranscribing}>
                Reset
              </Button>
              {running && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                  </span>
                  Recording — speak the same sentence to compare.
                </span>
              )}
              {whisperStt.isLoadingModel && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Whisper model loading… {whisperStt.loadProgress?.progress ?? 0}%
                </span>
              )}
              {whisperStt.isTranscribing && !running && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Whisper transcribing…
                </span>
              )}
            </div>

            {whisperSupported && (
              <div className="rounded-lg border bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Whisper model size
                  </div>
                  <div className="inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5 text-xs">
                    {(["tiny", "base", "small"] as const).map((size) => {
                      const info = WHISPER_MODELS[size];
                      const active = whisperSize === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => !running && !whisperStt.isLoadingModel && !whisperStt.isTranscribing && setWhisperSize(size)}
                          disabled={running || whisperStt.isLoadingModel || whisperStt.isTranscribing}
                          className={`px-2.5 py-1 rounded-full transition-colors ${
                            active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={info.description}
                        >
                          {info.label} <span className="opacity-70">({info.sizeLabel})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  {WHISPER_MODELS[whisperSize].description} Switching size triggers a one-time download per model.
                </p>
              </div>
            )}

            <div className="rounded-lg border bg-background/50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Target className="w-3.5 h-3.5 text-primary" /> Reference sentence (for WER)
              </div>
              <Textarea
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Type or paste the exact sentence(s) you'll read aloud. WER is computed per engine after stop."
                rows={2}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground/70">
                WER = word edit distance ÷ reference word count. Lower is better. Color: ≤10% green, ≤25% amber, &gt;25% red.
              </p>
            </div>

            <div className="rounded-lg border bg-background/50 p-3 space-y-2">
              <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <div>Engine</div>
                <div>First result</div>
                <div>Total time</div>
                <div>Output size</div>
                <div>WER</div>
              </div>
              <MetricsRow label="Browser (Web Speech API)" metrics={browserMetrics} wer={browserWer} />
              <MetricsRow
                label={`Offline Whisper ${WHISPER_MODELS[whisperSize].label} (${WHISPER_MODELS[whisperSize].sizeLabel})`}
                metrics={whisperMetrics}
                wer={whisperWer}
              />
              <MetricsRow label="ElevenLabs Scribe" metrics={premiumMetrics} wer={premiumWer} />
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-lg border bg-background/50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Globe className="w-3.5 h-3.5 text-primary" /> Browser transcript
                </div>
                <div className="text-sm leading-relaxed min-h-[6rem] max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {browserStt.fullTranscript || (
                    <span className="text-muted-foreground italic">No transcript yet.</span>
                  )}
                  {browserStt.partialTranscript && (
                    <span className="text-muted-foreground italic"> {browserStt.partialTranscript}</span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-background/50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <HardDrive className="w-3.5 h-3.5 text-primary" /> Offline Whisper transcript
                </div>
                <div className="text-sm leading-relaxed min-h-[6rem] max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {whisperStt.fullTranscript || (
                    <span className="text-muted-foreground italic">
                      {whisperStt.isTranscribing
                        ? "Transcribing on-device…"
                        : whisperSupported
                          ? "No transcript yet."
                          : "Not supported in this browser."}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-background/50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> ElevenLabs Scribe transcript
                </div>
                <div className="text-sm leading-relaxed min-h-[6rem] max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {premiumTranscript || (
                    <span className="text-muted-foreground italic">No transcript yet.</span>
                  )}
                  {scribe.partialTranscript && (
                    <span className="text-muted-foreground italic"> {scribe.partialTranscript}</span>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/70">
              All three engines capture the same spoken session. Browser &amp; Scribe stream live partials;
              Whisper records locally and transcribes on stop (its "First result" column shows
              transcription time, not streaming latency). Compare outputs for accuracy on accents,
              punctuation, and domain vocabulary.
            </p>

            <div className="rounded-lg border bg-background/50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <History className="w-3.5 h-3.5 text-primary" /> Run history
                  <span className="text-muted-foreground font-normal">
                    ({filteredHistory.length}
                    {filteredHistory.length !== history.length && ` of ${history.length}`})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button onClick={exportCsv} variant="ghost" size="sm" disabled={filteredHistory.length === 0} className="gap-1.5 h-7">
                    <Download className="w-3 h-3" /> Export CSV
                  </Button>
                  <Button onClick={loadHistory} variant="ghost" size="sm" disabled={loadingHistory} className="gap-1.5 h-7">
                    <RefreshCw className={`w-3 h-3 ${loadingHistory ? "animate-spin" : ""}`} /> Refresh
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={history.length === 0}
                        className="gap-1.5 h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3 h-3" /> Clear all
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all diagnostic runs?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes all {history.length} of your persisted STT diagnostic runs.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={clearAllHistory}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete all
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Engine</span>
                  <div className="inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5">
                    {(["all", "browser", "whisper", "premium"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setEngineFilter(opt)}
                        className={`px-2.5 py-0.5 rounded-full capitalize transition-colors ${
                          engineFilter === opt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Model</span>
                  <div className="inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5">
                    {(["all", "tiny", "base", "small"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setModelFilter(opt)}
                        className={`px-2.5 py-0.5 rounded-full capitalize transition-colors ${
                          modelFilter === opt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">From</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 px-2 gap-1.5 font-normal">
                        <CalendarIcon className="w-3 h-3" />
                        {dateFrom ? format(dateFrom, "MMM d, yyyy") : <span className="text-muted-foreground">Any</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">To</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 px-2 gap-1.5 font-normal">
                        <CalendarIcon className="w-3 h-3" />
                        {dateTo ? format(dateTo, "MMM d, yyyy") : <span className="text-muted-foreground">Any</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>

                {(engineFilter !== "all" || modelFilter !== "all" || dateFrom || dateTo) && (
                  <Button
                    onClick={() => { setEngineFilter("all"); setModelFilter("all"); setDateFrom(undefined); setDateTo(undefined); }}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground"
                  >
                    Clear filters
                  </Button>
                )}
              </div>

              {filteredHistory.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {summaryStats.map((s) => (
                    <div key={s.engine} className={`rounded-md border-2 bg-background/40 p-2.5 transition-colors ${werBorderTone(s.avgWer)}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium capitalize">{s.engine}</span>
                        <span className="text-[10px] text-muted-foreground">{s.count} run{s.count === 1 ? "" : "s"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg WER</div>
                          <div className={`font-mono font-medium ${werTone(s.avgWer)}`}>{formatWer(s.avgWer)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg latency</div>
                          <div className="font-mono font-medium">
                            {s.avgLatencyMs != null ? `${Math.round(s.avgLatencyMs)} ms` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filteredHistory.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span className="uppercase tracking-wide">WER thresholds:</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 border-emerald-500/60" />
                    ≤10% excellent
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 border-amber-500/60" />
                    ≤25% acceptable
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 border-destructive/60" />
                    &gt;25% poor
                  </span>
                </div>
              )}

              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No runs persisted yet. Stop a comparison to record one.</p>
              ) : filteredHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No runs match the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="text-left py-1.5 pr-2 font-medium">When</th>
                        <th className="text-left py-1.5 pr-2 font-medium">Engine</th>
                        <th className="text-left py-1.5 pr-2 font-medium">Model</th>
                        <th className="text-right py-1.5 pr-2 font-medium">Latency</th>
                        <th className="text-right py-1.5 pr-2 font-medium">WER</th>
                        <th className="text-left py-1.5 pr-2 font-medium">Transcript</th>
                        <th className="py-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => setDetailRun(row)}
                          className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                        >
                          <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                            {new Date(row.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-1.5 pr-2 capitalize">{row.engine}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{row.model_size ?? "—"}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{row.latency_ms != null ? `${row.latency_ms} ms` : "—"}</td>
                          <td className={`py-1.5 pr-2 text-right font-mono ${werTone(row.wer)}`}>{formatWer(row.wer)}</td>
                          <td className="py-1.5 pr-2 max-w-[20rem] truncate text-muted-foreground" title={row.transcript ?? ""}>
                            {row.transcript || <span className="italic">—</span>}
                          </td>
                          <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                            <Button onClick={() => deleteRun(row.id)} variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Sheet open={!!detailRun} onOpenChange={(o) => !o && setDetailRun(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {detailRun && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 capitalize">
                  {detailRun.engine}
                  {detailRun.model_size && (
                    <span className="text-xs font-normal text-muted-foreground">· {detailRun.model_size}</span>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {new Date(detailRun.created_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div className="rounded-md border bg-background/50 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Latency</div>
                  <div className="font-mono font-medium">
                    {detailRun.latency_ms != null ? `${detailRun.latency_ms} ms` : "—"}
                  </div>
                </div>
                <div className="rounded-md border bg-background/50 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">WER</div>
                  <div className={`font-mono font-medium ${werTone(detailRun.wer)}`}>{formatWer(detailRun.wer)}</div>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Reference</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5"
                    disabled={!detailRun.reference_text}
                    onClick={() => copyText(detailRun.reference_text ?? "", "ref")}
                  >
                    {copiedField === "ref" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedField === "ref" ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="rounded-md border bg-background/50 p-3 text-sm whitespace-pre-wrap min-h-[3rem]">
                  {detailRun.reference_text || <span className="italic text-muted-foreground">No reference recorded.</span>}
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Transcript</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5"
                    disabled={!detailRun.transcript}
                    onClick={() => copyText(detailRun.transcript ?? "", "tx")}
                  >
                    {copiedField === "tx" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedField === "tx" ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="rounded-md border bg-background/50 p-3 text-sm whitespace-pre-wrap min-h-[6rem]">
                  {detailRun.transcript || <span className="italic text-muted-foreground">No transcript captured.</span>}
                </div>
              </div>

              {detailRun.reference_text && detailRun.transcript && (
                <div className="mt-4 space-y-1.5">
                  <span className="text-xs font-medium">Word-level diff</span>
                  <WordDiff reference={detailRun.reference_text} hypothesis={detailRun.transcript} />
                </div>
              )}

              {detailRun.error && (
                <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  {detailRun.error}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
