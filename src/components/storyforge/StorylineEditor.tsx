import { useState, useEffect, useRef, useMemo } from "react";
import { useStoryForge, type SlideChapter, DEFAULT_CONFIG } from "./StoryForgeContext";
import { RewriteDiffDialog } from "./RewriteDiffDialog";
import { RewritePreviewDialog } from "./RewritePreviewDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, ArrowRight, Sparkles, Loader2, Check, Pencil, Palette, Mic as MicIcon, RefreshCw, AlertTriangle, CheckCircle2, ListChecks, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { AI_INPUT_LIMITS, AiInputTooLargeError, assertMaxCount, assertMaxLength } from "@/lib/ai-input-limits";
import { friendlyEdgeErrorMessage } from "@/lib/edge-error";
import { AiInputLimitNotice } from "./AiInputLimitNotice";
import { oversizedToast } from "./AiOversizedBanner";
import { ThemeTonePreview } from "./ThemeTonePreview";
import { ThemeTonePresets } from "./ThemeTonePresets";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { getFreeCloudQualityEnabled, parseHybridJson, requestHybridText } from "@/lib/free-cloud-quality";


const AUTO_SYNC_KEY = "storyline.autoSync";
const AUTO_SYNC_DEBOUNCE_MS = 4000;
const LAST_REWRITE_THEME_KEY = "resonance.lastRewriteTheme";
const LAST_REWRITE_TONE_KEY = "resonance.lastRewriteTone";

const THEMES = [
  { value: "autobiography", labelKey: "theme.autobiography" },
  { value: "documentary", labelKey: "theme.documentary" },
  { value: "scientific", labelKey: "theme.scientific" },
  { value: "fantasy", labelKey: "theme.fantasy" },
  { value: "thriller", labelKey: "theme.thriller" },
  { value: "motivation", labelKey: "theme.motivation" },
  { value: "professional", labelKey: "theme.professional" },
  { value: "adventure", labelKey: "theme.adventure" },
  { value: "poetic", labelKey: "theme.poetic" },
  { value: "philosophical", labelKey: "theme.philosophical" },
  { value: "emotional", labelKey: "theme.emotional" },
];

const TONES = [
  { value: "professional", labelKey: "tone.professional" },
  { value: "conversational", labelKey: "tone.conversational" },
  { value: "academic", labelKey: "tone.academic" },
  { value: "dramatic", labelKey: "tone.dramatic" },
  { value: "inspirational", labelKey: "tone.inspirational" },
];

export function StorylineEditor() {
  const { chapters, config, setConfig, storyline, setStoryline, storylineAccepted, setStorylineAccepted, setStep, setChapters, setIsGenerating, isGenerating, asIsMode } = useStoryForge();
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [rewriteSnapshot, setRewriteSnapshot] = useState<{ before: SlideChapter[]; after: SlideChapter[] } | null>(null);
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  // Which chapters the user has opted into for the next rewrite. Defaults to
  // all current chapter ids; stays in sync as chapters are added/removed.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(chapters.map((c) => c.id)));
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set<string>();
      const existing = new Set(chapters.map((c) => c.id));
      for (const id of prev) if (existing.has(id)) valid.add(id);
      // Auto-include any brand-new chapters we haven't seen yet.
      for (const c of chapters) if (!prev.has(c.id) && !valid.has(c.id)) valid.add(c.id);
      return valid;
    });
  }, [chapters]);
  const selectedCount = selectedIds.size;
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(chapters.map((c) => c.id)));
  const selectNone = () => setSelectedIds(new Set());
  const invertSelection = () => setSelectedIds((prev) => new Set(chapters.filter((c) => !prev.has(c.id)).map((c) => c.id)));
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(AUTO_SYNC_KEY) === "1";
  });
  const { toast } = useToast();
  const { t } = useI18n();

  // Fingerprint of current chapters — changes whenever titles/bodies are edited.
  const chaptersFingerprint = useMemo(
    () => chapters.map((c) => `${c.title}::${(c.body || "").length}::${(c.body || "").slice(0, 80)}`).join("|"),
    [chapters]
  );
  const lastSyncedFingerprint = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Over-limit guards: disable submit/regenerate buttons whenever any input
  // exceeds its cap so we never even attempt the request.
  const chapterSummariesChars = useMemo(
    () => chapters.reduce((s, c) => s + (c.title?.length || 0) + (c.body?.length || 0) + 4, 0),
    [chapters],
  );
  const summariesOverLimit = chapterSummariesChars > AI_INPUT_LIMITS.storyboardChapterTitlesChars;
  const storylineOverLimit = storyline.length > AI_INPUT_LIMITS.storyboardStorylineGuide;
  const chapterCountOverLimit = chapters.length > AI_INPUT_LIMITS.storyboardMaxExistingChapters;
  const rewriteBlocked = summariesOverLimit || storylineOverLimit || chapterCountOverLimit;

  // Auto-generate storyline on mount if not already done
  useEffect(() => {
    if (!storyline && !generating) {
      generateStoryline();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore last-used theme/tone defaults from a previous rewrite
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedTheme = localStorage.getItem(LAST_REWRITE_THEME_KEY);
    const savedTone = localStorage.getItem(LAST_REWRITE_TONE_KEY);
    setConfig((c) => {
      let next = c;
      if (savedTheme && c.theme === DEFAULT_CONFIG.theme) {
        next = { ...next, theme: savedTheme };
      }
      if (savedTone && c.tone === DEFAULT_CONFIG.tone) {
        next = { ...next, tone: savedTone };
      }
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync: regenerate the storyline (debounced) whenever chapters change
  // while the toggle is on. Skips the first run so we only react to *future*
  // edits, not the current state at mount/toggle-on.
  useEffect(() => {
    if (!autoSync) return;
    if (chapters.length === 0) return;
    if (lastSyncedFingerprint.current === null) {
      lastSyncedFingerprint.current = chaptersFingerprint;
      return;
    }
    if (lastSyncedFingerprint.current === chaptersFingerprint) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastSyncedFingerprint.current = chaptersFingerprint;
      generateStoryline({ silent: true });
    }, AUTO_SYNC_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [autoSync, chaptersFingerprint, chapters.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAutoSyncToggle = (next: boolean) => {
    setAutoSync(next);
    try { localStorage.setItem(AUTO_SYNC_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) {
      lastSyncedFingerprint.current = chaptersFingerprint;
      toast({ title: "Auto-sync on", description: "The storyline will refresh automatically when you edit chapters." });
    }
  };

  const generateStoryline = async (opts: { silent?: boolean } = {}) => {
    setGenerating(true);
    try {
      const localLimit = config.depth === "summary" ? 6 : config.depth === "extensive" ? 20 : 12;
      if (OPEN_NOVA_LOCAL_ONLY && chapters.length > localLimit) {
        throw new Error(`Storyboard has ${chapters.length} items; governed ${config.depth || "standard"} mode allows at most ${localLimit}. Regenerate the storyboard before creating a storyline.`);
      }
      const chapterSummaries = chapters.map((c, i) => `${i + 1}. ${c.title}\n${c.body}`).join("\n\n");
      try {
        assertMaxLength("chapter summaries", chapterSummaries, AI_INPUT_LIMITS.storyboardChapterTitlesChars);
      } catch (err) {
        if (err instanceof AiInputTooLargeError) {
          toast(oversizedToast(err, "Too much content to summarise"));
          setGenerating(false);
          return;
        }
        throw err;
      }

      if (OPEN_NOVA_LOCAL_ONLY) {
        let sl = chapters.map((c, i) => `**Story unit ${i + 1}: ${c.title}** — ${(c.body || "").replace(/\s+/g, " ").slice(0, 220)}${(c.body || "").length > 220 ? "…" : ""}`).join("\n\n");
        let provider = "RONS local";
        if (getFreeCloudQualityEnabled() && chapters.length > 0) {
          try {
            const refined = await requestHybridText({
              allowCloud: true,
              timeoutMs: 60_000,
              system: "Write a concise, cohesive storyline arc from the supplied approved story units. Use only supplied facts and events. Do not invent dialogue, claims, people, dates or scenes. Preserve the order. Return plain markdown, not JSON.",
              prompt: JSON.stringify({ topic: config.topic, theme: config.theme, tone: config.tone, chapters: chapters.map((c) => ({ title: c.title, body: c.body })) }),
            });
            const candidate = refined.text.trim();
            if (candidate.length >= 40 && candidate.length <= AI_INPUT_LIMITS.storyboardStorylineGuide) {
              sl = candidate;
              provider = refined.provider;
            }
          } catch (error) {
            console.warn("Free-cloud storyline refinement unavailable; using local storyline:", error);
          }
        }
        setStoryline(sl);
        if (opts.silent && storylineAccepted) setStorylineAccepted(false);
        if (opts.silent) toast({ title: "Storyline updated", description: `Re-synced via ${provider}.` });
        return;
      }

      const storylinePrompt = asIsMode
        ? "You are a master storyteller. The user has provided their own text which must be kept exactly as written. Create a concise markdown storyline summary that describes the narrative arc of their existing content — the key themes, flow, turning points, and conclusion. Do NOT suggest changes to the text. The storyline is a descriptive overview, not a rewrite guide."
        : "You are a master storyteller. Create a concise markdown storyline that ties the chapter titles into one cohesive arc with theme, turning points, and conclusion.";

      const { data, error } = await supabase.functions.invoke("generate-storyboard", {
        body: {
          sources: [],
          config: { ...config, depth: "summary" },
          storylineMode: true,
          chapterTitles: chapterSummaries,
          asIsMode,
          customStorylinePrompt: storylinePrompt,
        },
      });
      if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to generate storyline"));
      if (data?.storyline) {
        setStoryline(data.storyline);
        // When auto-syncing, an accepted storyline is no longer "in sync"
        // with the user's intent until they re-accept the new version.
        if (opts.silent && storylineAccepted) setStorylineAccepted(false);
      } else if (data?.chapters) {
        const sl = data.chapters.map((c: any, i: number) => `**Chapter ${i + 1}: ${c.title}** — ${c.body.slice(0, 150)}…`).join("\n\n");
        setStoryline(sl);
      }
      if (opts.silent) {
        toast({ title: "Storyline updated", description: "Re-synced from your latest chapter edits." });
      }
    } catch (err: any) {
      toast({ title: "Failed to generate storyline", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = () => {
    setStorylineAccepted(true);
    setEditing(false);
  };

  const handleRewriteChapters = async () => {
    setIsGenerating(true);
    // Remember the theme & tone used for this rewrite as future defaults
    try {
      localStorage.setItem(LAST_REWRITE_THEME_KEY, config.theme);
      localStorage.setItem(LAST_REWRITE_TONE_KEY, config.tone);
    } catch { /* ignore quota errors */ }
    // Snapshot current chapters BEFORE the rewrite so we can show a diff and revert.
    const before = chapters.map((c) => ({ ...c }));
    // Only the chapters the user opted into go through the AI rewrite.
    const selectedSubset = before.filter((c) => selectedIds.has(c.id));
    if (selectedSubset.length === 0) {
      toast({ title: "Nothing selected", description: "Pick at least one chapter to rewrite.", variant: "destructive" });
      setIsGenerating(false);
      return;
    }
    try {
      try {
        assertMaxCount("existing chapters", selectedSubset.length, AI_INPUT_LIMITS.storyboardMaxExistingChapters);
        assertMaxLength("storyline guide", storyline, AI_INPUT_LIMITS.storyboardStorylineGuide);
        const existingTotal = selectedSubset.reduce((s, c) => s + (c.title?.length || 0) + (c.body?.length || 0), 0);
        if (existingTotal > AI_INPUT_LIMITS.storyboardChapterTitlesChars) {
          throw new AiInputTooLargeError("existing chapters", existingTotal, AI_INPUT_LIMITS.storyboardChapterTitlesChars, "chars");
        }
      } catch (err) {
        if (err instanceof AiInputTooLargeError) {
          toast(oversizedToast(err, "Too much content to rewrite"));
          setIsGenerating(false);
          return;
        }
        throw err;
      }
      if (OPEN_NOVA_LOCAL_ONLY && getFreeCloudQualityEnabled()) {
        const refined = await requestHybridText({
          allowCloud: true,
          timeoutMs: 90_000,
          system: "Rewrite only the supplied chapters to follow the supplied storyline, theme and tone. Preserve factual meaning and chapter count. Never invent facts, dates, names, quotations or events. Return JSON only as {\"chapters\":[{\"title\":string,\"body\":string,\"imagePrompt\":string}]}. No markdown fences.",
          prompt: JSON.stringify({ topic: config.topic, theme: config.theme, tone: config.tone, storyline, chapters: selectedSubset.map((c) => ({ title: c.title, body: c.body, imagePrompt: c.imagePrompt })) }),
        });
        const parsed = parseHybridJson<{ chapters?: Array<{ title?: string; body?: string; imagePrompt?: string }> }>(refined.text);
        const rewritten = parsed?.chapters;
        if (!Array.isArray(rewritten) || rewritten.length !== selectedSubset.length || rewritten.some((c) => !c?.title?.trim() || !c?.body?.trim())) {
          throw new Error("Free-cloud rewrite returned an invalid chapter schema; original chapters were kept.");
        }
        const rewrittenById = new Map<string, (typeof rewritten)[number]>();
        selectedSubset.forEach((original, index) => rewrittenById.set(original.id, rewritten[index]));
        const after: SlideChapter[] = before.map((original) => {
          const chapter = rewrittenById.get(original.id);
          if (!chapter) return { ...original };
          return {
            ...original,
            title: chapter.title?.trim() || original.title,
            body: chapter.body?.trim() || original.body,
            imagePrompt: chapter.imagePrompt?.trim() || original.imagePrompt,
            notes: `${original.notes || ""} Quality rewrite: ${refined.provider}.`.trim(),
          };
        });
        setRewriteSnapshot({ before, after });
        setShowDiff(true);
        return;
      }
      const { data, error } = await supabase.functions.invoke("generate-storyboard", {
        body: {
          sources: [],
          config,
          storylineMode: false,
          storylineGuide: storyline,
          existingChapters: selectedSubset.map((c) => ({ title: c.title, body: c.body })),
        },
      });
      if (error) throw new Error(await friendlyEdgeErrorMessage(error, "Failed to rewrite chapters"));
      if (data?.chapters && Array.isArray(data.chapters) && data.chapters.length > 0) {
        // Map rewritten results back into their original positions by id.
        // Unselected chapters are left untouched in both `before` and `after`.
        const rewrittenById = new Map<string, any>();
        selectedSubset.forEach((orig, i) => {
          const ch = data.chapters[i];
          if (ch) rewrittenById.set(orig.id, ch);
        });
        const after: SlideChapter[] = before.map((original) => {
          const ch = rewrittenById.get(original.id);
          if (!ch) return { ...original };
          return {
            ...original,
            title: ch.title ?? original.title ?? "",
            body: ch.body ?? original.body ?? "",
            imagePrompt: ch.imagePrompt ?? original.imagePrompt,
            diagramPrompt: ch.diagramPrompt ?? original.diagramPrompt,
            notes: ch.notes ?? original.notes,
            references: ch.references ?? original.references,
          };
        });
        setRewriteSnapshot({ before, after });
        setShowDiff(true);
      } else {
        toast({ title: "No changes returned", description: "The rewrite produced no chapters.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Rewrite failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyRewrite = (decisions: boolean[]) => {
    if (!rewriteSnapshot) return;
    const { before, after } = rewriteSnapshot;
    const max = Math.max(before.length, after.length);
    const merged: SlideChapter[] = Array.from({ length: max }, (_, i) => {
      const keepRewrite = decisions[i] ?? false;
      return keepRewrite ? (after[i] ?? before[i]) : (before[i] ?? after[i]);
    }).filter(Boolean) as SlideChapter[];
    const acceptedCount = decisions.filter(Boolean).length;
    setChapters(merged);
    setShowDiff(false);
    setRewriteSnapshot(null);
    toast({
      title: acceptedCount > 0 ? "Rewrite applied" : "No changes applied",
      description: `${acceptedCount} of ${max} chapters updated.`,
    });
    // Auto-advance to the export/visual book panel so the user can generate right away
    setStep(5);
  };

  const handleDiscardRewrite = () => {
    setShowDiff(false);
    setRewriteSnapshot(null);
    toast({ title: "Rewrite discarded", description: "Your original chapters were kept." });
  };


  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-3xl mx-auto space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-serif font-semibold">{t("storylineEd.title")}</h2>
        <p className="text-muted-foreground">
          {asIsMode ? "Your text is preserved as-is. The storyline describes the narrative arc." : `${t("storylineEd.subtitle")} ${chapters.length} ${t("storylineEd.chapters")}`}
        </p>
      </div>

      {/* Theme & Tone selectors — always visible so user can direct writing style */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Palette className="w-3 h-3" /> {t("home.theme")}
          </label>
          <Select value={config.theme} onValueChange={(v) => setConfig((c) => ({ ...c, theme: v }))}>
            <SelectTrigger className="bg-card/60 border-glass-border text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((th) => (
                <SelectItem key={th.value} value={th.value}>{t(th.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <MicIcon className="w-3 h-3" /> {t("home.tone")}
          </label>
          <Select value={config.tone} onValueChange={(v) => setConfig((c) => ({ ...c, tone: v }))}>
            <SelectTrigger className="bg-card/60 border-glass-border text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((tn) => (
                <SelectItem key={tn.value} value={tn.value}>{t(tn.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
      </div>

      {/* Saved presets — quick recall of favourite theme/tone combos */}
      <ThemeTonePresets
        theme={config.theme}
        tone={config.tone}
        onApply={(theme, tone) => setConfig((c) => ({ ...c, theme, tone }))}
      />

      {/* Live, client-side preview of how the chosen theme & tone will shape the story */}
      <ThemeTonePreview
        theme={config.theme}
        tone={config.tone}
        topic={config.topic || ""}
        chapters={chapters}
      />

      </div>

      {/* Auto-sync toggle — keeps the storyline aligned whenever chapters are edited */}
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card/40 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <RefreshCw className={`w-4 h-4 mt-0.5 ${autoSync ? "text-primary" : "text-muted-foreground"}`} />
          <div>
            <Label htmlFor="storyline-auto-sync" className="text-sm font-medium cursor-pointer">
              Auto-sync storyline
            </Label>
            <p className="text-xs text-muted-foreground">
              Regenerates the storyline a few seconds after you edit any chapter, so the two never drift.
            </p>
          </div>
        </div>
        <Switch
          id="storyline-auto-sync"
          checked={autoSync}
          onCheckedChange={handleAutoSyncToggle}
        />
      </div>

      {/* Storyline content */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        {generating ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground animate-pulse">Generating storyline…</p>
          </div>
        ) : editing ? (
          <>
            <Textarea
              value={storyline}
              onChange={(e) => setStoryline(e.target.value)}
              className="min-h-[300px] resize-none bg-background text-sm leading-relaxed"
              placeholder="Describe how the story should flow…"
              aria-invalid={storyline.length > AI_INPUT_LIMITS.storyboardStorylineGuide}
            />
            <AiInputLimitNotice
              field="storyline guide"
              current={storyline.length}
              limit={AI_INPUT_LIMITS.storyboardStorylineGuide}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleAccept}
                className="gap-2"
                disabled={storyline.length > AI_INPUT_LIMITS.storyboardStorylineGuide}
              >
                <Check className="w-4 h-4" /> {t("storylineEd.acceptStoryline")}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>{t("nav.back")}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {storyline || "No storyline generated yet."}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="w-4 h-4" /> {t("storylineEd.editStoryline")}
              </Button>
              <Button
                variant="outline"
                onClick={() => generateStoryline()}
                disabled={generating || summariesOverLimit}
                title={summariesOverLimit ? "Chapter content exceeds the summarisation limit" : undefined}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" /> {t("storylineEd.regenerate")}
              </Button>
              {!storylineAccepted && (
                <Button onClick={handleAccept} className="gap-2">
                  <Check className="w-4 h-4" /> {t("storylineEd.acceptStoryline")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Accepted: option to rewrite chapters */}
      {storylineAccepted && (() => {
        const themeLabel = t(THEMES.find((th) => th.value === config.theme)?.labelKey || "") || config.theme;
        const toneLabel = t(TONES.find((tn) => tn.value === config.tone)?.labelKey || "") || config.tone;
        const chapterCount = chapters.length;
        return (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" /> {t("storylineEd.storylineAccepted")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {asIsMode
                ? "Your original text is preserved. You can continue to the storybook preview."
                : "You can rewrite all chapters to match this storyline, or export the storybook as-is."}
            </p>

            {!asIsMode && (
              <div className="rounded-lg border bg-background/60 p-3 space-y-3 text-xs">
                {/* Theme / Tone / Count row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-0.5">
                      <Palette className="w-3 h-3" /> Theme to apply
                    </div>
                    <div className="font-semibold text-foreground">{themeLabel}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-0.5">
                      <MicIcon className="w-3 h-3" /> Tone to apply
                    </div>
                    <div className="font-semibold text-foreground">{toneLabel}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-0.5">
                      <RefreshCw className="w-3 h-3" /> Total chapters
                    </div>
                    <div className="font-semibold text-foreground">
                      {chapterCount} {chapterCount === 1 ? "chapter" : "chapters"}
                    </div>
                  </div>
                </div>

                {/* Limit breakdown */}
                <div className="border-t pt-3 space-y-2">
                  {/* Chapter count limit */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                        <span>Chapter limit</span>
                        <span className={chapterCountOverLimit ? "text-destructive font-semibold" : "text-emerald-600 dark:text-emerald-400"}>
                          {chapterCount} / {AI_INPUT_LIMITS.storyboardMaxExistingChapters}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${chapterCountOverLimit ? "bg-destructive" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, (chapterCount / AI_INPUT_LIMITS.storyboardMaxExistingChapters) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {chapterCountOverLimit ? (
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    )}
                  </div>

                  {/* Character limit */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                        <span>Character budget</span>
                        <span className={summariesOverLimit ? "text-destructive font-semibold" : "text-emerald-600 dark:text-emerald-400"}>
                          {chapterSummariesChars.toLocaleString()} / {AI_INPUT_LIMITS.storyboardChapterTitlesChars.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${summariesOverLimit ? "bg-destructive" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, (chapterSummariesChars / AI_INPUT_LIMITS.storyboardChapterTitlesChars) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {summariesOverLimit ? (
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    )}
                  </div>

                  {/* Storyline guide limit */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                        <span>Storyline guide</span>
                        <span className={storylineOverLimit ? "text-destructive font-semibold" : "text-emerald-600 dark:text-emerald-400"}>
                          {storyline.length.toLocaleString()} / {AI_INPUT_LIMITS.storyboardStorylineGuide.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${storylineOverLimit ? "bg-destructive" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, (storyline.length / AI_INPUT_LIMITS.storyboardStorylineGuide) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {storylineOverLimit ? (
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    )}
                  </div>
                </div>

                {/* Per-chapter selection — pick which chapters get rewritten */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ListChecks className="w-3 h-3" /> Chapters to rewrite
                      <span className="ml-1 normal-case tracking-normal text-foreground font-semibold">
                        {selectedCount} of {chapterCount} selected
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={selectAll} disabled={selectedCount === chapterCount}>All</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={selectNone} disabled={selectedCount === 0}>None</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={invertSelection} disabled={chapterCount === 0}>Invert</Button>
                    </div>
                  </div>
                  <ScrollArea className="max-h-44 rounded-md border bg-background/60">
                    <ul className="divide-y">
                      {chapters.map((ch, i) => {
                        const checked = selectedIds.has(ch.id);
                        return (
                          <li key={ch.id}>
                            <label className="flex items-start gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleSelected(ch.id)}
                                className="mt-0.5"
                              />
                              <span className="flex-1 min-w-0">
                                <span className="block text-xs font-medium text-foreground truncate">
                                  {i + 1}. {ch.title || `Chapter ${i + 1}`}
                                </span>
                                <span className={`block text-[10px] ${checked ? "text-primary" : "text-muted-foreground"}`}>
                                  {checked ? "Will be rewritten" : "Left unchanged"}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </div>

                {/* Verdict */}
                <div className={`flex flex-col gap-2 rounded-md px-3 py-2 text-xs font-medium ${rewriteBlocked ? "bg-destructive/10 text-destructive" : selectedCount === 0 ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
                  <div className="flex items-center gap-2">
                  {rewriteBlocked ? (
                    <>
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        Rewrite blocked: {chapterCountOverLimit
                          ? `${chapterCount - AI_INPUT_LIMITS.storyboardMaxExistingChapters} chapter${chapterCount - AI_INPUT_LIMITS.storyboardMaxExistingChapters === 1 ? "" : "s"} over the limit — all ${chapterCount} chapters will be left unchanged`
                          : summariesOverLimit
                          ? `${(chapterSummariesChars - AI_INPUT_LIMITS.storyboardChapterTitlesChars).toLocaleString()} characters over budget — all ${chapterCount} chapters will be left unchanged`
                          : storylineOverLimit
                          ? `${(storyline.length - AI_INPUT_LIMITS.storyboardStorylineGuide).toLocaleString()} characters over storyline limit — all ${chapterCount} chapters will be left unchanged`
                          : "limits exceeded"}
                      </span>
                    </>
                  ) : selectedCount === 0 ? (
                    <>
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>No chapters selected — all {chapterCount} will be left unchanged</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {selectedCount} of {chapterCount} chapter{chapterCount === 1 ? "" : "s"} will be rewritten
                        {selectedCount < chapterCount ? ` · ${chapterCount - selectedCount} left unchanged` : " — within all limits"}
                      </span>
                    </>
                  )}
                  </div>
                  {rewriteBlocked && summariesOverLimit && !chapterCountOverLimit && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-destructive/20 flex-wrap">
                      <span className="text-[11px] font-normal text-destructive/80">
                        Need a bigger budget? Top up credits to rewrite longer storybooks in one pass.
                      </span>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-[11px] gap-1 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Link to="/pricing">
                          <Plus className="w-3 h-3" />
                          Buy extra credits
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {!asIsMode && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmRewrite(true)}
                  disabled={isGenerating || rewriteBlocked || chapterCount === 0 || selectedCount === 0}
                  title={
                    rewriteBlocked
                      ? chapterCountOverLimit
                        ? "Too many chapters for a single rewrite"
                        : storylineOverLimit
                        ? "Storyline guide exceeds the limit"
                        : "Chapter content exceeds the rewrite limit"
                      : selectedCount === 0
                      ? "Select at least one chapter to rewrite"
                      : undefined
                  }
                  className="gap-2"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {t("storylineEd.rewriteChapters")} · {selectedCount}
                </Button>
              )}
              <Button onClick={() => setStep(5)} className="gap-2">
                {t("storylineEd.continueAsIs")} <ArrowRight className="w-4 h-4" />
              </Button>
            </div>

            <RewritePreviewDialog
              open={confirmRewrite}
              chapters={chapters.filter((c) => selectedIds.has(c.id))}
              theme={config.theme}
              tone={config.tone}
              themeLabel={themeLabel}
              toneLabel={toneLabel}
              topic={config.topic || ""}
              onCancel={() => setConfirmRewrite(false)}
              onConfirm={() => {
                setConfirmRewrite(false);
                handleRewriteChapters();
              }}
            />

          </motion.div>
        );
      })()}

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setStep(asIsMode ? 0 : 3)} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> {asIsMode ? "Back to Input" : t("storylineEd.backToEditor")}
        </Button>
        <Button
          onClick={() => setStep(5)}
          disabled={!storylineAccepted && !storyline}
          className="gap-2"
        >
          {t("storylineEd.previewStoryBook")} <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <RewriteDiffDialog
        open={showDiff && !!rewriteSnapshot}
        before={rewriteSnapshot?.before || []}
        after={rewriteSnapshot?.after || []}
        onApply={handleApplyRewrite}
        onDiscard={handleDiscardRewrite}
      />
    </motion.div>
  );
}
