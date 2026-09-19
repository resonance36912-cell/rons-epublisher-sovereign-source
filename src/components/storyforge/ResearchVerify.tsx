import { useState, useEffect, useRef } from "react";
import { useStoryForge } from "./StoryForgeContext";
import { startResearchJob, getJobStatus, discoverSources } from "@/lib/storyforge-api";
import { recoverYouTubeEvidenceSources } from "@/lib/youtube-evidence-recovery";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, Globe, Youtube, Search, Loader2, CheckCircle2, AlertCircle, ShieldCheck, FileText, Mic } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import {
  RESEARCH_SOURCE_LIMIT,
  canonicalizeResearchUrl,
  normaliseExtractedSources,
  sourceQualitySummary,
  type QualifiedDiscoverySource,
} from "@/lib/research-source-quality";

type DiscoveredSource = QualifiedDiscoverySource;

type VerifyPhase = "discovering" | "review" | "transcribing" | "done";

function pipelineStageLabel(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("search")) return "Discovering sources…";
  if (lower.includes("extract") || lower.includes("scraping") || lower.includes("fetching")) return "Extracting content…";
  if (lower.includes("chunk") || lower.includes("splitting")) return "Chunking documents…";
  if (lower.includes("index") || lower.includes("final")) return "Indexing cited research…";
  if (lower.includes("complete") || lower.includes("done")) return "Finalizing…";
  return "Processing…";
}

export function ResearchVerify() {
  const { config, setConfig, sources, setSources, setStep } = useStoryForge();
  const { toast } = useToast();
  const { t } = useI18n();
  const suppliedOnly = (config.sourcePolicy || "supplementary_research") === "supplied_only";
  const suppliedUrls = sources.filter((source) => source.type === "url");
  const readySuppliedSources = sources.filter((source) => source.type !== "search" && source.status === "ready" && !!source.content?.trim());
  const initialPhase: VerifyPhase = suppliedOnly
    ? (suppliedUrls.length === 0 && readySuppliedSources.length > 0 ? "done" : "review")
    : "discovering";
  const [phase, setPhase] = useState<VerifyPhase>(initialPhase);
  const [discovered, setDiscovered] = useState<DiscoveredSource[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [topicOnlyConfirmed, setTopicOnlyConfirmed] = useState(false);
  const [userExcludedUrls, setUserExcludedUrls] = useState<Set<string>>(() => new Set());
  const recoveryAbortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enforce the source policy before any network discovery is attempted.
  useEffect(() => {
    if (suppliedOnly) {
      setDiscovered([]);
      setError("");
      if (suppliedUrls.length === 0 && readySuppliedSources.length > 0) {
        setProgress(100);
        setStatusMsg(`${readySuppliedSources.length} supplied evidence source(s) ready; public discovery was not run.`);
        setPhase("done");
      } else {
        setProgress(0);
        setStatusMsg("Supplied sources only — public discovery disabled by policy.");
        setPhase("review");
      }
    } else if (phase === "discovering") {
      runDiscovery();
    }
    return () => {
      recoveryAbortRef.current?.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runDiscovery = async (forcePublic = false) => {
    if (suppliedOnly && !forcePublic) {
      setDiscovered([]);
      setError("");
      if (suppliedUrls.length === 0 && readySuppliedSources.length > 0) {
        setProgress(100);
        setStatusMsg(`${readySuppliedSources.length} supplied evidence source(s) ready; public discovery was not run.`);
        setPhase("done");
      } else {
        setProgress(0);
        setStatusMsg("Supplied sources only — public discovery disabled by policy.");
        setPhase("review");
      }
      return;
    }
    setPhase("discovering");
    setProgress(10);
    setStatusMsg("Opening the governed Open Nova research gateway…");
    setError("");
    setTopicOnlyConfirmed(false);

    try {
      setProgress(30);
      setStatusMsg("Searching credential-free web indexes…");

      await new Promise((r) => setTimeout(r, 500));
      setProgress(50);
      setStatusMsg("Searching public YouTube results without an API key…");

      // Hard safety timeout so the spinner can never lock up if the edge
      // function or Firecrawl hangs past its own timeout.
      const result = await Promise.race([
        discoverSources(config.topic),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Discovery timed out after 45s. Please retry.")), 45_000),
        ),
      ]);

      setProgress(80);
      setStatusMsg("Normalizing source citations locally…");
      await new Promise((r) => setTimeout(r, 400));

      const manualUrls = new Set(sources.filter((s) => s.type === "url").map((s) => canonicalizeResearchUrl(s.url || s.title)));
      const availableSlots = Math.max(0, RESEARCH_SOURCE_LIMIT - manualUrls.size);
      let selected = 0;
      const adjusted = result.sources.map((source) => {
        const canonical = source.canonicalUrl || canonicalizeResearchUrl(source.url);
        const alreadyManual = manualUrls.has(canonical);
        const explicitlyExcluded = userExcludedUrls.has(canonical);
        const choose = source.reviewGroup === "recommended" && !alreadyManual && !explicitlyExcluded && selected < availableSlots;
        if (choose) selected += 1;
        return {
          ...source,
          selected: choose,
          reviewGroup: alreadyManual ? "excluded" as const : source.reviewGroup,
          relevanceReason: alreadyManual ? "Already added manually; counted separately toward the governed limit" : source.relevanceReason,
        };
      });
      setDiscovered(adjusted);
      setProgress(100);
      setPhase("review");

      if (!result.sources || result.sources.length === 0) {
        setError(
          "We couldn't find any sources for that topic right now. Try the Re-search button, refine the topic wording, or paste a URL/document on the previous step.",
        );
      }
    } catch (err: any) {
      const msg = err?.message || "Discovery failed";
      setError(msg);
      setPhase("review");
      toast({ title: "Discovery error", description: msg, variant: "destructive" });
    }
  };

  const toggleSource = (url: string) => {
    const current = discovered.find((item) => item.url === url);
    if (!current || current.reviewGroup === "excluded") return;
    const manualCount = new Set(sources.filter((s) => s.type === "url").map((s) => canonicalizeResearchUrl(s.url || s.title))).size;
    const selectedCount = discovered.filter((item) => item.selected).length;
    if (!current.selected && manualCount + selectedCount >= RESEARCH_SOURCE_LIMIT) {
      toast({ title: "Source limit reached", description: `The governed research limit is ${RESEARCH_SOURCE_LIMIT} URLs including manually added links.`, variant: "destructive" });
      return;
    }
    setDiscovered((prev) => prev.map((item) => item.url === url ? { ...item, selected: !item.selected } : item));
    setUserExcludedUrls((prev) => {
      const next = new Set(prev); const key = current.canonicalUrl || canonicalizeResearchUrl(current.url);
      if (current.selected) next.add(key); else next.delete(key);
      return next;
    });
  };

  const selectRecommended = () => {
    const manualCount = new Set(sources.filter((s) => s.type === "url").map((s) => canonicalizeResearchUrl(s.url || s.title))).size;
    let remaining = Math.max(0, RESEARCH_SOURCE_LIMIT - manualCount);
    setDiscovered((prev) => prev.map((item) => {
      const excluded = userExcludedUrls.has(item.canonicalUrl);
      const selected = item.reviewGroup === "recommended" && !excluded && remaining > 0;
      if (selected) remaining -= 1;
      return { ...item, selected };
    }));
  };
  const deselectAll = () => {
    setUserExcludedUrls((prev) => new Set([...prev, ...discovered.filter((d) => d.selected).map((d) => d.canonicalUrl)]));
    setDiscovered((prev) => prev.map((d) => ({ ...d, selected: false })));
  };

  const handleTranscribe = async () => {
    recoveryAbortRef.current?.abort();
    const controller = new AbortController();
    recoveryAbortRef.current = controller;
    setPhase("transcribing");
    setProgress(0);
    setStatusMsg("Starting research pipeline…");

    try {
      // Collect user-provided URLs from sources
      const requestedUrls = [
        ...sources.filter((s) => s.type === "url").map((s) => s.url || s.title),
        ...(!suppliedOnly ? discovered.filter((source) => source.selected).map((source) => source.url) : []),
      ].map(canonicalizeResearchUrl).filter(Boolean);
      const userUrls = Array.from(new Set(requestedUrls));
      if (userUrls.length === 0) {
        setPhase("review");
        setError("Select at least one research source before extraction.");
        return;
      }
      if (userUrls.length > RESEARCH_SOURCE_LIMIT) {
        setPhase("review");
        setError(`Selected ${userUrls.length} URLs; the governed extraction limit is ${RESEARCH_SOURCE_LIMIT}. Deselect sources and retry.`);
        return;
      }

      const { jobId: newJobId } = await startResearchJob(config.topic, config, userUrls);

      if (controller.signal.aborted) return;
      let polling = false;
      // Poll for progress without overlapping requests.
      pollRef.current = setInterval(async () => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        try {
          const status = await getJobStatus(newJobId, false);
          if (controller.signal.aborted) return;
          setProgress(status.progress || 0);
          setStatusMsg(status.statusMessage || "Processing…");

          if (["complete", "partial_complete"].includes(status.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;

            // Fetch final results
            const finalStatus = await getJobStatus(newJobId, true);
            if (controller.signal.aborted) return;
            setProgress(85);
            const recoveredSources = await recoverYouTubeEvidenceSources(finalStatus.processedSources || [], (item) => {
              setStatusMsg(`${item.stage || "queued"} — YouTube speech (${item.current}/${item.total}): ${item.title}`);
            }, controller.signal);
            if (controller.signal.aborted) return;
            const processedSources = normaliseExtractedSources(config.topic, recoveredSources, discovered, userUrls);
            const fileSources = sources.filter((s) => s.type === "file");
            setSources([...fileSources, ...processedSources]);
            const usable = processedSources.filter((source) => source.status === "ready").length;
            const unavailable = processedSources.length - usable;
            setProgress(100);
            setPhase("done");
            setStatusMsg(`${usable} usable evidence source(s); ${unavailable} excluded after extraction.`);
          } else if (status.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            throw new Error(status.error || "Research pipeline failed");
          }
        } catch (pollErr: any) {
          if (controller.signal.aborted) return;
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          toast({ title: "Transcription failed", description: pollErr.message, variant: "destructive" });
          setPhase("review");
        } finally {
          polling = false;
        }
      }, 2000);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      toast({ title: "Transcription failed", description: err.message, variant: "destructive" });
      setPhase("review");
    }
  };

  const selectedCount = discovered.filter((d) => d.selected).length;
  const manualUrlCount = new Set(
    sources.filter((s) => s.type === "url").map((s) => canonicalizeResearchUrl(s.url || s.title)),
  ).size;
  const totalRequested = selectedCount + manualUrlCount;
  const quality = sourceQualitySummary(discovered);
  const usableCount = sources.filter((s) => s.status === "ready").length;
  const extractedResearch = sources.filter((s) => s.type === "search");
  const metadataOnlyCount = extractedResearch.filter((s) => s.contentAvailability === "metadata_only").length;
  const approveShortSource = (id: string) => {
    setSources((previous) => previous.map((source) => source.id === id && source.status === "processing"
      ? { ...source, status: "ready" as const, evidenceReview: "reviewed" as const, diagnostic: "Short extract manually accepted for generation; factual verification remains separate." }
      : source));
  };
  const reviewAlternativeSources = () => {
    const unavailableUrls = new Set(
      extractedResearch
        .filter((source) => source.status !== "ready")
        .map((source) => canonicalizeResearchUrl(source.canonicalUrl || source.url || source.title)),
    );
    setDiscovered((previous) => previous.map((source) => (
      unavailableUrls.has(source.canonicalUrl) ? { ...source, selected: false } : source
    )));
    setUserExcludedUrls((previous) => new Set([...previous, ...unavailableUrls]));
    setTopicOnlyConfirmed(false);
    setError("The unavailable sources were deselected. Choose a specific web article or another video with public captions, then extract again.");
    setPhase("review");
  };
  const continueTopicOnly = () => {
    if (!topicOnlyConfirmed) return;
    setConfig((current) => ({ ...current, researchBasis: "topic_only" }));
    setStep(2);
  };
  const continueWithEvidence = () => {
    setConfig((current) => ({ ...current, researchBasis: "evidence" }));
    setStep(2);
  };
  const recoverMetadataOnlyYouTube = async () => {
    recoveryAbortRef.current?.abort();
    const controller = new AbortController();
    recoveryAbortRef.current = controller;
    setPhase("transcribing");
    setProgress(10);
    setStatusMsg("Preparing local YouTube speech-to-text recovery…");
    try {
      const nonResearchSources = sources.filter((source) => source.type !== "search");
      const researchSources = sources.filter((source) => source.type === "search");
      const recovered = await recoverYouTubeEvidenceSources(researchSources, (item) => {
        setProgress(Math.min(90, 15 + Math.round((item.current / Math.max(item.total, 1)) * 70)));
        setStatusMsg(`${item.stage || "queued"} — YouTube speech (${item.current}/${item.total}): ${item.title}`);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const processed = normaliseExtractedSources(config.topic, recovered, discovered);
      setSources([...nonResearchSources, ...processed]);
      const usable = processed.filter((source) => source.status === "ready").length;
      const unavailable = processed.length - usable;
      setProgress(100);
      setStatusMsg(`${usable} usable evidence source(s); ${unavailable} excluded after extraction.`);
      setPhase("done");
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setPhase("done");
      toast({ title: "Local YouTube recovery failed", description: err?.message || "Recovery failed", variant: "destructive" });
    }
  };
  const reviewGroups = [
    { key: "recommended" as const, label: "Recommended", help: "Direct-topic candidates, selected within the governed limit." },
    { key: "needs_review" as const, label: "Needs review", help: "Potential context; inspect before selecting." },
    { key: "excluded" as const, label: "Excluded", help: "Duplicate, irrelevant, generic, or unsuitable page types." },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-5xl mx-auto space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-serif font-semibold">{t("research.title")}</h2>
        <p className="text-muted-foreground">
          {suppliedOnly
            ? `Supplied-source verification for “${config.topic}”`
            : phase === "discovering"
              ? `Discovering sources for “${config.topic}”`
              : `Discovery complete — review sources for “${config.topic}”`}
        </p>
        <p className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/5 px-3 py-1 text-[11px] text-green-400">
          <ShieldCheck className="h-3.5 w-3.5" /> {suppliedOnly ? "Locally hosted · Supplied sources only · Public discovery disabled" : "Locally hosted · Supplementary public research enabled"}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <VerifyStep step={1} label={suppliedOnly ? "Source policy" : "Discover"} desc={suppliedOnly ? "Use supplied evidence only" : "Find public candidates"} status={phase === "discovering" ? "active" : "done"} />
        <VerifyStep step={2} label="Review sources" desc="Select relevant evidence" status={phase === "review" ? "active" : phase === "transcribing" || phase === "done" ? "done" : "pending"} />
        <VerifyStep step={3} label="Extract content" desc="Text or public captions" status={phase === "transcribing" ? "active" : phase === "done" ? "done" : "pending"} />
      </div>

      {phase === "discovering" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="glass-card p-6 space-y-4 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground animate-pulse">{statusMsg}</p>
            <Progress value={progress} className="h-2" />
            <Button variant="destructive" size="sm" onClick={() => {
              setPhase("review");
              toast({ title: "Discovery stopped", description: "You can re-search or review results already returned." });
            }} className="gap-2 mt-2">
              <AlertCircle className="w-4 h-4" /> Stop discovery
            </Button>
          </div>
        </motion.div>
      )}

      {phase === "review" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1"><p className="text-sm text-destructive">{error}</p></div>
            </div>
          )}

          <div className="glass-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium">
              {suppliedOnly
                ? `${manualUrlCount} supplied URL${manualUrlCount === 1 ? "" : "s"} · ${readySuppliedSources.length} supplied source${readySuppliedSources.length === 1 ? "" : "s"} already ready`
                : `${quality.discovered} discovered · ${totalRequested} selected · Limit ${RESEARCH_SOURCE_LIMIT}`}
            </div>
            <div className="text-xs text-muted-foreground">
              {suppliedOnly
                ? "Public discovery is disabled by the selected source policy."
                : `${quality.recommended} recommended · ${quality.needsReview} needs review · ${quality.excluded} excluded`}
            </div>
          </div>
          {suppliedOnly && manualUrlCount === 0 && readySuppliedSources.length === 0 && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">No supplied evidence is available</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  This topic has no URL or uploaded evidence, so supplied-only mode has nothing to verify. Enable supplementary public research to discover relevant public sources, or go back and add your own source.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setConfig((current) => ({ ...current, sourcePolicy: "supplementary_research" }));
                    void runDiscovery(true);
                  }}
                  className="gap-2"
                >
                  <Search className="w-4 h-4" /> Enable public research
                </Button>
                <Button variant="outline" onClick={() => setStep(0)} className="gap-2">
                  <FileText className="w-4 h-4" /> Add URL or file
                </Button>
              </div>
            </div>
          )}
          {!suppliedOnly && (
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={selectRecommended}>Select recommended</Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>Clear selection</Button>
              <Button variant="outline" size="sm" onClick={runDiscovery} className="gap-1.5">
                <Search className="w-3.5 h-3.5" /> Re-search
              </Button>
            </div>
          )}

          {reviewGroups.map((group) => {
            const items = discovered.filter((item) => item.reviewGroup === group.key);
            if (!items.length) return null;
            return (
              <section key={group.key} className="space-y-2">
                <div className="flex items-end justify-between gap-3">
                  <div><h3 className="text-sm font-semibold">{group.label} <span className="text-muted-foreground font-normal">({items.length})</span></h3>
                  <p className="text-xs text-muted-foreground">{group.help}</p></div>
                </div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {items.map((d, i) => (
                      <motion.div key={d.canonicalUrl} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.015, 0.25) }}
                        className={`rounded-lg border px-4 py-3 ${d.selected ? "bg-primary/5 border-primary/30" : "bg-card border-border"}`}>
                        <div className="flex items-start gap-3">
                          <Checkbox checked={d.selected} disabled={d.reviewGroup === "excluded"}
                            onClick={(e) => e.stopPropagation()} onCheckedChange={() => toggleSource(d.url)} className="mt-1" />
                          {d.type === "youtube" ? <Youtube className="w-4 h-4 text-red-400 shrink-0 mt-1" /> : <Globe className="w-4 h-4 text-accent shrink-0 mt-1" />}
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium">{d.title}</p>
                            <p className="text-xs text-muted-foreground break-all">{d.domain} · {d.sourceKind} · {d.provider || "public web"}</p>
                            {d.description && <p className="text-xs text-muted-foreground/80 line-clamp-2">{d.description}</p>}
                            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Relevance:</span> {d.relevance} — {d.relevanceReason}</p>
                            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Content:</span> Not checked · <span className="font-medium text-foreground/80">Evidence review:</span> Not reviewed</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            );
          })}
          <div className="sticky bottom-3 z-20 rounded-xl border border-primary/20 bg-background/95 backdrop-blur px-4 py-3 shadow-lg flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{totalRequested} source{totalRequested === 1 ? "" : "s"} selected</p>
              <p className="text-xs text-muted-foreground">Only successfully extracted, on-topic text or captions enter the evidence set.</p>
            </div>
            <Button onClick={handleTranscribe} disabled={totalRequested === 0 || totalRequested > RESEARCH_SOURCE_LIMIT} size="lg" className="gap-2">
              <ArrowRight className="w-4 h-4" /> Extract content from {totalRequested} selected source{totalRequested === 1 ? "" : "s"}
            </Button>
          </div>
        </motion.div>
      )}

      {phase === "transcribing" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-8 space-y-5">
          <div className="text-center space-y-2">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
            <p className="text-sm font-medium text-foreground">{statusMsg}</p>
            <p className="text-xs text-muted-foreground">Extraction determines readiness; selection alone does not.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground"><span>{pipelineStageLabel(statusMsg)}</span><span>{progress}%</span></div>
            <Progress value={progress} className="h-2.5" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {[{ label: "Extracting", threshold: 25 }, { label: "Filtering", threshold: 65 }, { label: "Evidence set", threshold: 90 }].map((stage) => {
              const done = progress >= stage.threshold + 15; const active = progress >= stage.threshold && !done;
              return <span key={stage.label} className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${done ? "bg-green-500/10 text-green-400 border-green-500/30" : active ? "bg-primary/10 text-primary border-primary/30" : "bg-muted/30 text-muted-foreground border-border/40"}`}>
                {done ? <CheckCircle2 className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3 opacity-50" />}{stage.label}
              </span>;
            })}
          </div>
          <div className="flex justify-center"><Button variant="destructive" size="sm" onClick={() => {
            recoveryAbortRef.current?.abort();
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setPhase("review");
            toast({ title: "Stopped waiting for extraction", description: "Queued transcription may finish in the background. Retry recovery to reconnect; this stopped run will not update your evidence." });
          }} className="gap-2"><AlertCircle className="w-4 h-4" /> Stop extraction</Button></div>
        </motion.div>
      )}
      {phase === "done" && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
          <div className="glass-card p-6 text-center space-y-2">
            {usableCount > 0 ? <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" /> : <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />}
            <h3 className="text-lg font-semibold">{usableCount > 0 ? "Extraction complete" : "Extraction failed — no usable evidence"}</h3>
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
            <p className="text-xs text-muted-foreground">Usable means extracted text/captions or locally recovered speech-to-text passed the sovereign relevance and contamination checks. Evidence review is still separate.</p>
            {metadataOnlyCount > 0 && (
              <div className="pt-2 flex flex-col items-center gap-1.5">
                <Button onClick={recoverMetadataOnlyYouTube} variant="outline" className="gap-2">
                  <Mic className="w-4 h-4" /> Recover {metadataOnlyCount} YouTube source{metadataOnlyCount === 1 ? "" : "s"} locally
                </Button>
                <p className="text-[11px] text-muted-foreground">Downloads public video audio temporarily and transcribes it on this PC with local Whisper. This is not factual verification.</p>
              </div>
            )}
          </div>
          {extractedResearch.length > 0 && (
            <div className="space-y-2">
              {extractedResearch.map((source) => (
                <div key={source.id} className="glass-card px-4 py-3 text-left">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{source.title}</p>
                    <span className={`text-[10px] px-2 py-1 rounded-full border ${source.status === "ready" ? "text-green-400 border-green-500/30 bg-green-500/5" : "text-amber-400 border-amber-500/30 bg-amber-500/5"}`}>
                      {source.contentAvailability || (source.status === "ready" ? "text_extracted" : "failed")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Relevance: {source.relevance || "unassessed"} · Evidence review: {source.evidenceReview || "not_reviewed"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{source.provider || "public web"} · {source.extractionProvider || "no extraction provider"}</p>
                  {source.diagnostic && <p className="text-xs text-amber-400/90 mt-1">{source.diagnostic}</p>}
                  {source.status === "processing" && <Button size="sm" variant="outline" className="mt-2" onClick={() => approveShortSource(source.id)}>Approve short extract for generation</Button>}
                  {source.content && <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">Preview extracted content</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{source.content.slice(0, 1200)}{source.content.length > 1200 ? "…" : ""}</p></details>}
                </div>
              ))}
            </div>
          )}
          {usableCount === 0 && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-5 space-y-4" role="alert">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-amber-300">No usable evidence was recovered</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Captionless video metadata can remain as provenance, but it cannot support a researched manuscript. Choose another source path or explicitly create an unresearched topic-only draft.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={reviewAlternativeSources} className="gap-1.5">
                  <Search className="w-3.5 h-3.5" /> Review other sources
                </Button>
                <Button variant="outline" size="sm" onClick={() => setStep(0)} className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Add URL or file
                </Button>
                {!suppliedOnly && (
                  <Button variant="outline" size="sm" onClick={runDiscovery} className="gap-1.5">
                    <Search className="w-3.5 h-3.5" /> Re-search
                  </Button>
                )}
              </div>
              <label htmlFor="topic-only-confirmation" className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3 cursor-pointer">
                <Checkbox
                  id="topic-only-confirmation"
                  checked={topicOnlyConfirmed}
                  onCheckedChange={(checked) => setTopicOnlyConfirmed(checked === true)}
                  className="mt-0.5"
                />
                <span className="text-xs text-muted-foreground">
                  I understand that a topic-only draft is not research-backed and must not present the excluded video metadata as factual evidence.
                </span>
              </label>
              <Button onClick={continueTopicOnly} disabled={!topicOnlyConfirmed} className="gap-2">
                Continue to Story Settings — topic-only <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </motion.div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setStep(0)} className="gap-2"><ArrowLeft className="w-4 h-4" /> {t("nav.back")}</Button>
        {phase === "done" && usableCount > 0 && (
          <Button onClick={continueWithEvidence} className="gap-2">
            {t("research.configureStory")} <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function VerifyStep({
  step,
  label,
  desc,
  status,
}: {
  step: number;
  label: string;
  desc: string;
  status: "pending" | "active" | "done";
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-center transition-all ${
        status === "active"
          ? "border-primary bg-primary/5"
          : status === "done"
          ? "border-green-500/30 bg-green-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-center gap-2 mb-1">
        {status === "done" ? (
          <CheckCircle2 className="w-4 h-4 text-green-400" />
        ) : (
          <span className={`text-xs font-bold ${status === "active" ? "text-primary" : "text-muted-foreground"}`}>{step}</span>
        )}
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="text-[10px] text-muted-foreground">{desc}</p>
    </div>
  );
}
