import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast as sonnerToast } from "sonner";
import { useStoryForge, getChapterImages, isRtlBookLanguage, type SlideChapter, type BookLanguage } from "./StoryForgeContext";
import { ChapterImageMosaic } from "./visualbook/ChapterImageMosaic";
import { generateChapterImage } from "@/lib/storyforge-api";
import { AI_INPUT_LIMITS, AiInputTooLargeError, assertMaxLength, assertMaxCount } from "@/lib/ai-input-limits";
import { oversizedToast } from "./AiOversizedBanner";
import { friendlyEdgeErrorMessage, friendlyTooLargeFromResponseStatus } from "@/lib/edge-error";
import { useChapterImageViewAudit } from "@/hooks/useChapterImageViewAudit";
import { saveProject } from "@/lib/project-storage";
import { notifyProjectSaveError } from "@/lib/notifyProjectSaveError";
import { prepareExportImages } from "@/lib/export-image-utils";
import { mapWithConcurrencyLimit } from "@/lib/async-utils";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_PREFIX,
  StoryboardImportError,
  getSchemaChangelog,
  parseStoryboardJson,
  type NormalizedImport,
} from "@/lib/storyboard-import";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { readStrictSchemaPref, writeStrictSchemaPref, isImportBlocked } from "@/lib/strict-schema-import";
import { SchemaVersionHelper } from "./SchemaVersionHelper";
import {
  ImageIcon, Loader2, Check, Play, Film, PenTool,
  Info, LayoutGrid, GalleryHorizontalEnd, Volume2, Square, ChevronDown, ChevronUp, RefreshCw, Type, StopCircle,
  Lock, Crown, ArrowRight, AlertTriangle, Undo2, Search, Settings2,
} from "lucide-react";
import { useUserTier } from "@/hooks/useUserTier";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { BookReader } from "./BookReader";
import { SceneRating } from "./SceneRating";
import { OverallBookRating } from "./OverallBookRating";
import { supabase } from "@/integrations/supabase/client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { buildBookStructure } from "@/lib/book-structure";
import { buildCanonicalStoryboard } from "@/lib/canonical-storyboard";

// Extracted sub-components
import { AiPenMenu, type AiEditMode } from "./visualbook/AiPenMenu";
import { ChapterEditPanel } from "./visualbook/ChapterEditPanel";
import { VisualBookConfig } from "./visualbook/VisualBookConfig";
import { VisualBookActions } from "./visualbook/VisualBookActions";
import { ExportProgressBar } from "./visualbook/ExportProgressBar";
import { ExportDebugOverlay } from "./visualbook/ExportDebugOverlay";
import { VisualBookLightbox } from "./visualbook/VisualBookLightbox";
import { VisualBookGallery } from "./visualbook/VisualBookGallery";
import { GlobalFindReplace } from "./visualbook/GlobalFindReplace";
import { useVisualBookExports } from "./visualbook/useVisualBookExports";
import { PdfPreviewModal } from "./visualbook/PdfPreviewModal";
import { QuotaAndCreditsCard } from "./visualbook/QuotaAndCreditsCard";
import { AutoEcoBanner } from "./visualbook/AutoEcoBanner";

/** Probe a URL by attempting to load it as an Image. 8s timeout. */
function probeImageUrl(url: string): Promise<{ url: string; ok: boolean }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !url) return resolve({ url, ok: false });
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; resolve({ url, ok }); };
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    } catch { finish(false); }
    setTimeout(() => finish(false), 8000);
  });
}

/** Highlight search matches in text */
function HighlightText({ text, search, className }: { text: string; search: string; className?: string }) {
  if (!search) return <span className={className}>{text}</span>;
  const regex = new RegExp(`(${search})`, "gi");
  const parts = text.split(regex);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        new RegExp(`^${search}$`, "gi").test(part) ? (
          <mark key={i} className="bg-accent/30 text-foreground rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export function VisualBook() {
  const { chapters, setChapters, config, setConfig, setStep, referenceImage, setReferenceImage, sources, setSources, storyline, storylineAccepted, setStoryline, setStorylineAccepted, step, projectId, setProjectId, setProjectDirty, overallRating, setOverallRating } = useStoryForge();
  const { t } = useI18n();
  const { toast } = useToast();
  const { canGenerateImages, canUseNarration, tier } = useUserTier();
  useChapterImageViewAudit("Open visual book", projectId, chapters);

  // Build ref character details from config metadata
  const refCharacterDetails = referenceImage ? (() => {
    const g = (config as any).refGender;
    const a = (config as any).refAge;
    const d = (config as any).refDetails;
    if ((g && g !== "unspecified") || a || d) return { gender: g, age: a, details: d };
    return undefined;
  })() : undefined;

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [viewMode, setViewMode] = useState<"grid" | "gallery">("grid");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showReader, setShowReader] = useState(false);
  const [aiPenOpen, setAiPenOpen] = useState<string | null>(null);
  const [editingChapter, setEditingChapter] = useState<string | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoScrollPaused = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const stopGenerationRef = useRef(false);
  const [searchHighlight, setSearchHighlight] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPhotoOnly, setPdfPhotoOnly] = useState(false);
  const [translating, setTranslating] = useState(false);
  // Pending JSON-import preview shown in a confirmation modal before commit.
  const [pendingImport, setPendingImport] = useState<NormalizedImport | null>(null);
  // Snapshot of the exact payload that failed the last apply, so "Retry apply"
  // works even if pendingImport was replaced/cleared by other input panels.
  const [lastFailedImport, setLastFailedImport] = useState<NormalizedImport | null>(null);
  // Ref to the inline error banner so we can auto-scroll it into view on failure.
  const importErrorRef = useRef<HTMLDivElement | null>(null);
  // When set, the next AlertDialog close will keep importError + lastFailedImport
  // intact so the user can fix inputs and re-open the review with the failed payload.
  const preserveImportErrorOnCloseRef = useRef(false);
  // When true, imports whose schema version differs from the current build's
  // (i.e. anything that needed auto-migration) are blocked unless the user
  // ticks the per-import override checkbox in the review modal. Persisted so
  // the preference survives reloads.
  const [strictSchemaImport, setStrictSchemaImport] = useState<boolean>(() => readStrictSchemaPref());
  useEffect(() => { writeStrictSchemaPref(strictSchemaImport); }, [strictSchemaImport]);
  // Persist the override choice across consecutive imports in the same session.
  // It only resets when the modal is dismissed (see AlertDialog onOpenChange)
  // or on a full page reload (component remount → state default false).
  const [schemaOverrideAck, setSchemaOverrideAck] = useState(false);
  // Second confirmation when an import will overwrite chapters or storyline.
  const [overwriteAck, setOverwriteAck] = useState(false);
  // Per-key opt-out for incoming project settings — keys in this set are
  // skipped when commitImport merges data.config. Defaults to empty (apply all).
  // Reset whenever the staged import changes so a fresh import starts clean.
  const [excludedConfigKeys, setExcludedConfigKeys] = useState<Set<string>>(new Set());
  // Quick-filter for the per-key diff list in the warning panel.
  // Persisted per-project (or per-URL pathname when no project is open) so
  // switching contexts doesn't mix filters between projects.
  const CFG_FILTER_LS_PREFIX = "vb.configKeyFilter.v2:";
  const cfgFilterScope = useMemo(() => {
    if (projectId) return `proj:${projectId}`;
    if (typeof window !== "undefined") return `url:${window.location.pathname}`;
    return "global";
  }, [projectId]);
  const cfgFilterKey = CFG_FILTER_LS_PREFIX + cfgFilterScope;
  type PersistedFilter = {
    q?: string;
    regex?: boolean;
    sort?: "status" | "az" | "za";
    status?: Array<"new" | "changed" | "removed">;
  };
  const readPersistedFilter = (key: string): PersistedFilter | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as PersistedFilter;
    } catch { return null; }
  };
  const _persisted = readPersistedFilter(cfgFilterKey);
  const [configKeyFilter, setConfigKeyFilter] = useState(_persisted?.q ?? "");
  const [configKeyRegex, setConfigKeyRegex] = useState(_persisted?.regex ?? false);
  const [configKeySort, setConfigKeySort] = useState<"status" | "az" | "za">(_persisted?.sort ?? "status");
  const [configStatusFilter, setConfigStatusFilter] = useState<Set<"new" | "changed" | "removed">>(
    new Set(_persisted?.status ?? ["new", "changed", "removed"])
  );
  const [cfgExportBusy, setCfgExportBusy] = useState<null | "csv" | "json">(null);
  // Export options dialog — user-level preference (not per-project) so the
  // chosen columns/highlight setting persists across all warning panels.
  type CfgExportCol = "key" | "status" | "before" | "after";
  type CfgExportScope = "page" | "all";
  type CfgCsvDelimiter = "," | ";" | "\t";
  type CfgExportOptions = {
    cols: CfgExportCol[];
    highlight: boolean;
    scope: CfgExportScope;
    csvDelimiter: CfgCsvDelimiter;
    csvBom: boolean;
    csvAlwaysQuote: boolean;
  };
  const CFG_EXPORT_OPTS_LS = "vb.cfgExportOptions.v1";
  const DEFAULT_CFG_EXPORT_OPTS: CfgExportOptions = {
    cols: ["key", "status", "before", "after"],
    highlight: true,
    scope: "all",
    csvDelimiter: ",",
    csvBom: true,
    csvAlwaysQuote: false,
  };
  const readCfgExportOpts = (): CfgExportOptions => {
    if (typeof window === "undefined") return DEFAULT_CFG_EXPORT_OPTS;
    try {
      const raw = window.localStorage.getItem(CFG_EXPORT_OPTS_LS);
      if (!raw) return DEFAULT_CFG_EXPORT_OPTS;
      const p = JSON.parse(raw) as Partial<CfgExportOptions>;
      const allowed: CfgExportCol[] = ["key", "status", "before", "after"];
      const cols = Array.isArray(p.cols)
        ? (p.cols.filter((c): c is CfgExportCol => allowed.includes(c as CfgExportCol)))
        : DEFAULT_CFG_EXPORT_OPTS.cols;
      const delim: CfgCsvDelimiter =
        p.csvDelimiter === ";" || p.csvDelimiter === "\t" || p.csvDelimiter === "," ? p.csvDelimiter : ",";
      return {
        cols: cols.length ? cols : DEFAULT_CFG_EXPORT_OPTS.cols,
        highlight: typeof p.highlight === "boolean" ? p.highlight : true,
        scope: p.scope === "page" || p.scope === "all" ? p.scope : "all",
        csvDelimiter: delim,
        csvBom: typeof p.csvBom === "boolean" ? p.csvBom : true,
        csvAlwaysQuote: typeof p.csvAlwaysQuote === "boolean" ? p.csvAlwaysQuote : false,
      };
    } catch { return DEFAULT_CFG_EXPORT_OPTS; }
  };
  const [cfgExportOpts, setCfgExportOpts] = useState<CfgExportOptions>(() => readCfgExportOpts());
  const [cfgExportOptsOpen, setCfgExportOptsOpen] = useState(false);
  // Saved presets — global (cross-project) so a preferred config is reusable
  // anywhere the diff list appears.
  type CfgExportPreset = { id: string; name: string; opts: CfgExportOptions; updatedAt: number };
  const CFG_EXPORT_PRESETS_LS = "vb.cfgExportPresets.v1";
  const readCfgPresets = (): CfgExportPreset[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(CFG_EXPORT_PRESETS_LS);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.opts);
    } catch { return []; }
  };
  const [cfgPresets, setCfgPresets] = useState<CfgExportPreset[]>(() => readCfgPresets());
  const [cfgPresetName, setCfgPresetName] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CFG_EXPORT_PRESETS_LS, JSON.stringify(cfgPresets)); }
    catch { /* quota / privacy mode — ignore */ }
  }, [cfgPresets]);
  // Pagination for the diff list — enables a meaningful "visible page" export scope.
  const CFG_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
  const CFG_PAGE_SIZE_LS = "vb.cfgPageSize.v1";
  const [cfgPageSize, setCfgPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return 25;
    const raw = Number(window.localStorage.getItem(CFG_PAGE_SIZE_LS));
    return (CFG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : 25;
  });
  const CFG_PAGE_SIZE = cfgPageSize;
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CFG_PAGE_SIZE_LS, String(cfgPageSize)); } catch { /* ignore */ }
  }, [cfgPageSize]);
  const [cfgPage, setCfgPage] = useState(0);
  // Reset to first page whenever the filtered set could shift.
  useEffect(() => { setCfgPage(0); }, [
    configKeyFilter, configKeyRegex, configKeySort, configStatusFilter, pendingImport, cfgPageSize,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CFG_EXPORT_OPTS_LS, JSON.stringify(cfgExportOpts)); }
    catch { /* quota / privacy mode — ignore */ }
  }, [cfgExportOpts]);
  // When the active scope (project) changes, rehydrate filters from that
  // scope's saved state so each project keeps its own workflow context.
  const lastLoadedScopeRef = useRef(cfgFilterScope);
  useEffect(() => {
    if (lastLoadedScopeRef.current === cfgFilterScope) return;
    lastLoadedScopeRef.current = cfgFilterScope;
    const next = readPersistedFilter(cfgFilterKey);
    setConfigKeyFilter(next?.q ?? "");
    setConfigKeyRegex(next?.regex ?? false);
    setConfigKeySort(next?.sort ?? "status");
    setConfigStatusFilter(new Set(next?.status ?? ["new", "changed", "removed"]));
  }, [cfgFilterScope, cfgFilterKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(cfgFilterKey, JSON.stringify({
        q: configKeyFilter,
        regex: configKeyRegex,
        sort: configKeySort,
        status: Array.from(configStatusFilter),
      }));
    } catch { /* quota / privacy mode — ignore */ }
  }, [cfgFilterKey, configKeyFilter, configKeyRegex, configKeySort, configStatusFilter]);
  useEffect(() => {
    // Per-import selection (which keys to skip) still resets — but search/status
    // filters intentionally persist so the user keeps their workflow context.
    setExcludedConfigKeys(new Set());
  }, [pendingImport]);

  // Keyboard shortcuts for the warning panel filters. Only active while
  // the import review modal (pendingImport) is open. Inputs are ignored
  // unless the user pressed Escape.
  const cfgFilterInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!pendingImport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tgt = e.target as HTMLElement | null;
      const inField =
        !!tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "SELECT" ||
          tgt.isContentEditable);
      // Escape: blur the filter input (always works).
      if (e.key === "Escape" && document.activeElement === cfgFilterInputRef.current) {
        e.preventDefault();
        cfgFilterInputRef.current?.blur();
        return;
      }
      // Slash: focus search (works even when other fields are focused, except the search itself).
      if (e.key === "/" && document.activeElement !== cfgFilterInputRef.current) {
        if (cfgFilterInputRef.current) {
          e.preventDefault();
          cfgFilterInputRef.current.focus();
          cfgFilterInputRef.current.select();
        }
        return;
      }
      if (inField) return;
      // r: toggle regex
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setConfigKeyRegex((v) => !v);
        return;
      }
      // s / S: cycle sort forward/back (status → az → za)
      if (e.key === "s") {
        e.preventDefault();
        setConfigKeySort((s) => (s === "status" ? "az" : s === "az" ? "za" : "status"));
        return;
      }
      if (e.key === "S") {
        e.preventDefault();
        setConfigKeySort((s) => (s === "status" ? "za" : s === "za" ? "az" : "status"));
        return;
      }
      // 1/2/3: toggle status checkboxes (new/changed/removed)
      const statusForKey: Record<string, "new" | "changed" | "removed"> = {
        "1": "new", "2": "changed", "3": "removed",
      };
      const status = statusForKey[e.key];
      if (status) {
        e.preventDefault();
        setConfigStatusFilter((prev) => {
          const out = new Set(prev);
          if (out.has(status)) out.delete(status); else out.add(status);
          return out;
        });
        return;
      }
      // 0: reset all status filters
      if (e.key === "0") {
        e.preventDefault();
        setConfigStatusFilter(new Set(["new", "changed", "removed"]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingImport]);

  // Result of probing every asset/reference URL in the staged import. Surfaced
  // in the confirmation modal so users can see — and copy — broken links
  // BEFORE applying the import.
  const [pendingProbe, setPendingProbe] = useState<
    | { loading: true; total: number }
    | { loading: false; total: number; broken: string[]; refBroken: boolean }
    | null
  >(null);
  useEffect(() => { if (!pendingImport) setPendingProbe(null); }, [pendingImport]);

  // Tracks the "Apply import" click so the button shows a spinner, the
  // dialog can't be dismissed mid-commit, and double-submits are blocked.
  const [applyingImport, setApplyingImport] = useState(false);
  // Step-by-step progress shown inside the confirmation modal while
  // commitImport runs. `null` when no apply is in flight.
  const IMPORT_STEPS = [
    "Validating payload",
    "Updating settings & storyline",
    "Restoring chapters & images",
    "Linking sources & references",
    "Refreshing preview",
  ] as const;
  const [importProgress, setImportProgress] = useState<number | null>(null);
  // Tracks the last apply failure so the modal can stay open and offer "Retry apply".
  const [importError, setImportError] = useState<string | null>(null);
  // Scroll the inline error banner into view whenever a fresh apply failure surfaces.
  useEffect(() => {
    if (!importError) return;
    const id = window.requestAnimationFrame(() => {
      importErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      importErrorRef.current?.focus?.();
    });
    return () => window.cancelAnimationFrame(id);
  }, [importError]);
  // Full error details for the collapsible diagnostics panel.
  const [importErrorDetails, setImportErrorDetails] = useState<{
    name?: string;
    phase?: string;
    message?: string;
    stack?: string;
    groupedIssues?: Array<{ section: string; hint: string; issues: Array<{ path: string; message: string }> }>;
    raw?: string;
  } | null>(null);

  // ── Single source of truth for the JSON export payload. Used by both the
  // Download button and the Preview dialog so they stay in lockstep.
  const buildExportPayload = useCallback((selectedChapterIds?: string[]) => {
    const safeTitle = (config.topic || "storyboard").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) || "storyboard";
    const isPartial = Array.isArray(selectedChapterIds) && selectedChapterIds.length > 0 && selectedChapterIds.length < chapters.length;
    const selectedSet = isPartial ? new Set(selectedChapterIds) : null;
    const exportedChapters = selectedSet ? chapters.filter((c) => selectedSet.has(c.id)) : chapters;

    const assetUrls = new Set<string>();
    for (const ch of exportedChapters) {
      if (ch.imageUrl) assetUrls.add(ch.imageUrl);
      if (Array.isArray(ch.images)) {
        for (const img of ch.images) if (img?.url) assetUrls.add(img.url);
      }
    }
    if (referenceImage) assetUrls.add(referenceImage);

    const dedupedSources: typeof sources = [];
    const seenIds = new Set<string>();
    const seenSig = new Set<string>();
    let droppedDuplicates = 0;
    let missingContent = 0;
    for (const s of sources) {
      if (!s) continue;
      if (seenIds.has(s.id)) { droppedDuplicates++; continue; }
      const sig = `${s.type}::${(s.title || "").trim().toLowerCase()}::${(s.content || "").length}::${(s.content || "").slice(0, 80)}`;
      if (seenSig.has(sig)) { droppedDuplicates++; continue; }
      seenIds.add(s.id); seenSig.add(sig);
      if (!s.content || !s.content.trim()) missingContent++;
      dedupedSources.push({
        id: s.id, type: s.type, title: s.title || "",
        url: s.url,
        provider: s.provider,
        retrievedAt: s.retrievedAt,
        contentHash: s.contentHash,
        verified: s.verified,
        description: s.description,
        canonicalUrl: s.canonicalUrl,
        extractionProvider: s.extractionProvider,
        transcriptAvailable: s.transcriptAvailable,
        relevance: s.relevance,
        relevanceReason: s.relevanceReason,
        contentAvailability: s.contentAvailability,
        evidenceReview: s.evidenceReview,
        sourceKind: s.sourceKind,
        diagnostic: s.diagnostic,
        error: s.error,
        status: s.status || (s.content?.trim() ? "ready" : "error"),
        content: s.content || "",
      });
    }

    const bookStructure = buildBookStructure({ pages: exportedChapters, config, sources: dedupedSources, referenceImage });

    const editorState = {
      schema: `${SCHEMA_PREFIX}${CURRENT_SCHEMA_VERSION}`,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      generatedBy: "Resonance ePublisher",
      projectId: projectId || null,
      title: config.topic || "Untitled Project",
      config, storyline, storylineAccepted, overallRating,
      bookStructure,
      chapters: exportedChapters,
      selection: isPartial
        ? { partial: true, selectedChapterIds: exportedChapters.map((c) => c.id), totalChaptersInProject: chapters.length }
        : { partial: false, totalChaptersInProject: chapters.length },
      sources: dedupedSources,
      sourcesMeta: { originalCount: sources.length, dedupedCount: dedupedSources.length, droppedDuplicates, missingContentCount: missingContent },
      referenceImage: referenceImage || null,
      assets: Array.from(assetUrls).map((url) => ({ url, kind: url === referenceImage ? "reference" : "chapter-image" })),
    };
    const payload = buildCanonicalStoryboard({
      projectId: projectId || null,
      title: config.topic || "Untitled Project",
      config,
      chapters: exportedChapters,
      sources: dedupedSources,
      editorState,
    });

    const suffix = isPartial ? `-selection-${exportedChapters.length}of${chapters.length}` : "";
    const filename = `${safeTitle}${suffix}-storyboard.json`;
    return { payload, filename, isPartial, exportedChapters, dedupedSources, droppedDuplicates, missingContent, assetUrls };
  }, [chapters, config, sources, referenceImage, storyline, storylineAccepted, overallRating, projectId]);

  // Pre-download preview state (opens dialog showing schema, version, JSON sample).
  const [previewExport, setPreviewExport] = useState<ReturnType<typeof buildExportPayload> | null>(null);

  // Commit a previously-parsed JSON import after the user confirms via the
  // import-summary modal. Extracted so the handler can defer the heavy state
  // mutation until the user clicks "Apply import" in the dialog.
  // Parse raw JSON text (from a file or pasted by the user) and stage it for
  // the import review modal. Shared by file-input and paste-JSON flows.
  const processImportText = useCallback(async (text: string) => {
    try {
      let data: NormalizedImport;
      try {
        data = parseStoryboardJson(text);
      } catch (err) {
        if (err instanceof StoryboardImportError) {
          const TITLE_BY_KIND: Record<string, string> = {
            "not-json": "Couldn't parse JSON",
            "not-object": "Wrong file shape",
            "missing-schema": "Missing schema tag",
            "wrong-schema": "Unrecognized format",
            "outdated-schema": "Outdated storyboard format",
            "future-schema": "Newer format — please update",
            "validation": `Storyboard failed validation${err.schemaVersion ? ` (v${err.schemaVersion})` : ""}`,
          };
          // For validation errors, render a structured per-section breakdown
          // so users can jump straight to the panel that needs fixing.
          if (err.kind === "validation" && err.groupedIssues && err.groupedIssues.length > 0) {
            toast({
              title: TITLE_BY_KIND[err.kind] || "Import failed",
              description: (
                <div className="space-y-2 text-xs max-h-64 overflow-y-auto">
                  <div className="text-muted-foreground">
                    Fix the highlighted sections in your JSON, then re-import:
                  </div>
                  {err.groupedIssues.map((g, i) => (
                    <div key={i} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                      <div className="font-medium">📍 {g.section}</div>
                      <div className="text-muted-foreground italic mb-1">{g.hint}</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {g.issues.slice(0, 5).map((it, j) => (
                          <li key={j}>
                            <code className="font-mono text-[10px]">{it.path}</code>: {it.message}
                          </li>
                        ))}
                        {g.issues.length > 5 && (
                          <li className="text-muted-foreground">…and {g.issues.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              ) as any,
              variant: "destructive",
            });
            return;
          }
          toast({
            title: TITLE_BY_KIND[err.kind] || "Import failed",
            description: err.message,
            variant: "destructive",
          });
          return;
        }
        throw err;
      }
      // Reset any leftover apply-state from a previous import before reopening.
      setApplyingImport(false);
      setImportProgress(null);
      setImportError(null);
      setImportErrorDetails(null);
      setLastFailedImport(null);
      setSchemaOverrideAck(false);
      setOverwriteAck(false);
      setPendingImport(data);
      // Kick off background probing of every asset/reference URL so the modal
      // can show — and let the user copy — broken links before applying.
      const urls = new Set<string>((data.assets ?? []).map((a) => a.url).filter(Boolean));
      if (data.referenceImage) urls.add(data.referenceImage);
      if (urls.size === 0) {
        setPendingProbe({ loading: false, total: 0, broken: [], refBroken: false });
      } else {
        setPendingProbe({ loading: true, total: urls.size });
        void Promise.all(Array.from(urls).map(probeImageUrl)).then((results) => {
          const broken = results.filter((r) => !r.ok).map((r) => r.url);
          const refBroken = !!data.referenceImage && broken.includes(data.referenceImage);
          setPendingProbe({ loading: false, total: results.length, broken, refBroken });
        });
      }
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message || "Could not read storyboard JSON.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const commitImport = useCallback(async (data: NormalizedImport) => {
    // Yield to React between phases so the modal's progress indicator can
    // repaint between each step instead of jumping from 0 → done.
    const tick = () => new Promise<void>((r) => setTimeout(r, 60));

    // Step 0 — Validating payload (lightweight sanity checks)
    setImportProgress(0);
    if (!data || !Array.isArray(data.chapters)) {
      throw new Error("Import payload is missing chapters.");
    }
    // Snapshot pre-import state so the success toast can offer Undo.
    const snapshot = {
      chapters,
      sources,
      storyline,
      storylineAccepted,
      overallRating,
      referenceImage,
      config,
      projectId,
    };
    await tick();

    // Step 1 — Updating settings & storyline
    setImportProgress(1);
    setConfig((c) => ({ ...c, ...data.config }));
    setStoryline(data.storyline || "");
    setStorylineAccepted(!!data.storylineAccepted);
    setOverallRating(data.overallRating || 0);
    await tick();

    // Step 2 — Restoring chapters & images
    setImportProgress(2);
    const assetUrlSet = new Set<string>((data.assets ?? []).map((a) => a.url).filter(Boolean));
    let hydratedCount = 0;
    const hydratedChapters = data.chapters.map((ch) => {
      const imgs = Array.isArray(ch.images) ? ch.images : [];
      const firstImgUrl = imgs.find((i: any) => i?.url)?.url as string | undefined;
      if (!ch.imageUrl && firstImgUrl) {
        hydratedCount++;
        return { ...ch, imageUrl: firstImgUrl };
      }
      return ch;
    });
    setChapters(hydratedChapters);
    await tick();

    // Step 3 — Linking sources & references (kicks off background probing)
    setImportProgress(3);
    const probeUrl = (url: string) =>
      new Promise<{ url: string; ok: boolean }>((resolve) => {
        if (typeof window === "undefined" || !url) return resolve({ url, ok: false });
        let settled = false;
        const finish = (ok: boolean) => { if (settled) return; settled = true; resolve({ url, ok }); };
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.referrerPolicy = "no-referrer";
          img.onload = () => finish(true);
          img.onerror = () => finish(false);
          img.src = url;
        } catch { finish(false); }
        setTimeout(() => finish(false), 8000);
      });

    let prewarmCount = 0;
    if (typeof window !== "undefined" && assetUrlSet.size > 0) {
      prewarmCount = assetUrlSet.size;
      void Promise.all(Array.from(assetUrlSet).map(probeUrl)).then((results) => {
        const broken = results.filter((r) => !r.ok).map((r) => r.url);
        let referenceImageCleared = false;
        if (data.referenceImage && broken.includes(data.referenceImage)) {
          setReferenceImage(null);
          referenceImageCleared = true;
        }
        if (broken.length > 0) {
          toast({
            title: `${broken.length} broken image link${broken.length === 1 ? "" : "s"} skipped`,
            description: `${results.length - broken.length} of ${results.length} asset URLs reachable.${referenceImageCleared ? " Reference image was unreachable and has been cleared." : " Affected chapters will show a fallback image until regenerated."}`,
            variant: "destructive",
          });
        }
      });
    }

    if (data.sources && data.sources.length > 0) setSources(data.sources);
    if (data.referenceImage !== undefined) setReferenceImage(data.referenceImage);
    setProjectId(null);
    setProjectDirty(true);
    await tick();

    // Step 4 — Refreshing preview
    setImportProgress(4);
    await tick();

    const extras: string[] = [];
    if (data.sources?.length) extras.push(`${data.sources.length} source${data.sources.length === 1 ? "" : "s"}`);
    if (prewarmCount > 0) extras.push(`${prewarmCount} image${prewarmCount === 1 ? "" : "s"} probing in background`);
    if (hydratedCount > 0) extras.push(`${hydratedCount} chapter image${hydratedCount === 1 ? "" : "s"} restored from assets`);
    const wasMigrated = data.originalSchemaVersion !== data.schemaVersion;
    if (wasMigrated) extras.push(`auto-migrated v${data.originalSchemaVersion} → v${data.schemaVersion}`);
    const versionLabel = wasMigrated ? `v${data.originalSchemaVersion} → v${data.schemaVersion}` : `v${data.schemaVersion}`;
    const undoImport = () => {
      setChapters(snapshot.chapters);
      setSources(snapshot.sources);
      setStoryline(snapshot.storyline || "");
      setStorylineAccepted(!!snapshot.storylineAccepted);
      setOverallRating(snapshot.overallRating || 0);
      setReferenceImage(snapshot.referenceImage ?? null);
      setConfig(() => snapshot.config);
      setProjectId(snapshot.projectId ?? null);
      setProjectDirty(true);
      toast({
        title: (
          <span className="flex items-center gap-1.5">
            <Undo2 className="w-3.5 h-3.5 text-emerald-500" />
            Import undone
          </span>
        ) as any,
        description: `Restored ${snapshot.chapters.length} chapter(s) and previous project settings.`,
      });
    };
    toast({
      title: (
        <span className="flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          Storyboard imported ({versionLabel})
        </span>
      ) as any,
      description: `Loaded ${hydratedChapters.length} chapter(s)${extras.length ? ` • ${extras.join(", ")}` : ""}${data.exportedAt ? ` • exported ${new Date(data.exportedAt).toLocaleString()}` : ""}.${wasMigrated && data.migrationNotes.length ? `\n${data.migrationNotes.join(" ")}` : ""}`,
      duration: 15000,
      action: (
        <ToastAction
          altText="Undo import and restore previous chapters and sources"
          onClick={undoImport}
          className="gap-1.5"
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo
        </ToastAction>
      ),
    });
  }, [chapters, sources, storyline, storylineAccepted, overallRating, referenceImage, config, projectId, setConfig, setStoryline, setStorylineAccepted, setOverallRating, setChapters, setSources, setReferenceImage, setProjectId, setProjectDirty, toast]);
  // Store original English chapters for round-trip translation
  const originalChaptersRef = useRef<{ title: string; body: string }[] | null>(null);

  const chaptersWithPrompts = chapters.filter((c) => c.imagePrompt);
  const chaptersWithImages = chapters.filter((c) => c.imageUrl);
  const allDone = chaptersWithPrompts.length > 0 && chaptersWithImages.length >= chaptersWithPrompts.length;

  const { downloading, downloadProgress, segmentInfo, narrationEta, exportStep, pendingDownload, lastAvDrift, manualDownload, dismissPendingDownload, downloadAsEbook, downloadAsEpub, downloadAsPdf, downloadAsAudio, downloadAsVideo, downloadAsTextBook, stopExport, clearTtsCache, ttsCacheSize, cachedChapterCount, canResume, previewNarration, previewAllNarration, stopPreview, previewingChapter, previewAllActive, isChapterCached, hasCachedVideo, cachedVideoFilename, cachedVideoSize, cachedVideoSavedAt, redownloadLastVideo } = useVisualBookExports(chapters, config, referenceImage, sources);

  // Pause auto-scroll on user scroll, resume after 4s idle
  useEffect(() => {
    if (!previewAllActive) return;
    const pauseToastId = "auto-scroll-paused";
    const handleUserScroll = () => {
      if (!autoScrollPaused.current) {
        sonnerToast("Auto-scroll paused", { id: pauseToastId, description: "Resumes in a few seconds", duration: 4000 });
      }
      autoScrollPaused.current = true;
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => { autoScrollPaused.current = false; sonnerToast.dismiss(pauseToastId); }, 4000);
    };
    window.addEventListener("wheel", handleUserScroll, { passive: true });
    window.addEventListener("touchmove", handleUserScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleUserScroll);
      window.removeEventListener("touchmove", handleUserScroll);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      autoScrollPaused.current = false;
    };
  }, [previewAllActive]);

  // Auto-scroll to the currently playing chapter card
  useEffect(() => {
    if (previewingChapter && !autoScrollPaused.current && chapterRefs.current[previewingChapter]) {
      chapterRefs.current[previewingChapter]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [previewingChapter]);

  // ── Language Translation ────────────────────────────────────────────
  const LANG_NAMES: Record<string, string> = {
    af: "Afrikaans", zu: "isiZulu", xh: "isiXhosa", st: "Sesotho",
  };

  const translateChapters = useCallback(async (targetLang: BookLanguage) => {
    if (chapters.length === 0) return;

    // Switching to English — restore originals
    if (targetLang === "en" && originalChaptersRef.current) {
      setChapters((prev) =>
        prev.map((ch, i) => {
          const orig = originalChaptersRef.current?.[i];
          return orig ? { ...ch, title: orig.title, body: orig.body } : ch;
        })
      );
      originalChaptersRef.current = null;
      toast({ title: "Restored English text" });
      return;
    }

    // Switching to a non-English language — save originals & translate
    if (targetLang !== "en") {
      if (OPEN_NOVA_LOCAL_ONLY) {
        if (!originalChaptersRef.current) {
          originalChaptersRef.current = chapters.map((ch) => ({ title: ch.title, body: ch.body }));
        }
        setTranslating(true);
        const langLabel = LANG_NAMES[targetLang] || targetLang;
        try {
          const response = await fetch("http://127.0.0.1:7866/v1/translate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chapters: chapters.map((ch) => ({ title: ch.title, body: ch.body })), targetLanguage: langLabel }),
          });
          if (!response.ok) throw new Error(`Local translation failed (${response.status})`);
          const data = await response.json();
          const translated = data.chapters || [];
          setChapters((prev) => prev.map((ch, idx) => translated[idx] ? { ...ch, ...translated[idx] } : ch));
          toast({ title: `Translated locally to ${langLabel}`, description: `RONS Ollama · ${data.model || "local model"}` });
        } catch (err) {
          toast({ title: "Local translation unavailable", description: err instanceof Error ? err.message : "RONS local LLM service is not ready." });
        } finally {
          setTranslating(false);
        }
        return;
      }
      // Save originals before translating
      if (!originalChaptersRef.current) {
        originalChaptersRef.current = chapters.map((ch) => ({ title: ch.title, body: ch.body }));
      }

      setTranslating(true);
      const langLabel = LANG_NAMES[targetLang] || targetLang;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        // Translate in batches of 5
        const BATCH_SIZE = 5;
        for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
          const batch = chapters.slice(i, i + BATCH_SIZE);
          try {
            assertMaxCount("chapters", batch.length, AI_INPUT_LIMITS.translateMaxChapters);
            const totalChars = batch.reduce((s, c) => s + (c.title?.length || 0) + (c.body?.length || 0), 0);
            if (totalChars > AI_INPUT_LIMITS.translateTotalChars) {
              throw new AiInputTooLargeError("translation batch", totalChars, AI_INPUT_LIMITS.translateTotalChars, "chars");
            }
          } catch (err) {
            if (err instanceof AiInputTooLargeError) {
              toast(oversizedToast(err, "Batch too large to translate"));
              setTranslating(false);
              return;
            }
            throw err;
          }
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-chapters`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                chapters: batch.map((ch) => ({ title: ch.title, body: ch.body })),
                targetLanguage: targetLang,
              }),
            }
          );

          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Translation failed" }));
            const tooLarge = friendlyTooLargeFromResponseStatus(response.status, err);
            throw new Error(tooLarge || err.error || `Translation failed (${response.status})`);
          }

          const data = await response.json();
          const translated = data.chapters || [];

          setChapters((prev) =>
            prev.map((ch, idx) => {
              const batchIdx = idx - i;
              if (batchIdx >= 0 && batchIdx < translated.length) {
                return { ...ch, title: translated[batchIdx].title, body: translated[batchIdx].body };
              }
              return ch;
            })
          );
        }

        toast({ title: `Translated to ${langLabel} ✓`, description: `All chapters translated to ${langLabel}` });
      } catch (err: any) {
        toast({ title: "Translation failed", description: err.message, variant: "destructive" });
        // Restore originals on failure
        if (originalChaptersRef.current) {
          setChapters((prev) =>
            prev.map((ch, i) => {
              const orig = originalChaptersRef.current?.[i];
              return orig ? { ...ch, title: orig.title, body: orig.body } : ch;
            })
          );
          originalChaptersRef.current = null;
        }
        setConfig((c) => ({ ...c, bookLanguage: "en" }));
      } finally {
        setTranslating(false);
      }
    }
  }, [chapters, setChapters, setConfig, toast]);

  // Trigger translation when language changes; also auto-set carousel autoplay
  // direction to reverse for RTL book languages (e.g. Arabic) so right-to-left
  // readers see slides flow in their natural reading direction. Users can still
  // override this manually in the Format & Preview panel afterwards.
  const prevLangRef = useRef(config.bookLanguage);
  useEffect(() => {
    if (prevLangRef.current !== config.bookLanguage) {
      const prev = prevLangRef.current;
      prevLangRef.current = config.bookLanguage;
      const wasRtl = isRtlBookLanguage(prev);
      const isRtl = isRtlBookLanguage(config.bookLanguage);
      if (wasRtl !== isRtl) {
        setConfig((c) => ({ ...c, carouselAutoplayReverse: isRtl }));
      }
      translateChapters(config.bookLanguage);
    }
  }, [config.bookLanguage, translateChapters, setConfig]);

  // ── AI Rewrite ──────────────────────────────────────────────────────
  const handleAiRewrite = useCallback(async (chapterId: string, mode: AiEditMode, instruction?: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) return;

    if (mode === "regenerate_image") {
      if (!chapter.imagePrompt) {
        toast({ title: "No image prompt", description: "This chapter has no image prompt to regenerate.", variant: "destructive" });
        return;
      }
      setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, imageLoading: true } : c));
      setAiPenOpen(null);
      try {
        const result = await generateChapterImage(
          chapterId, chapter.imagePrompt, referenceImage || undefined,
          config.imageStyle, !referenceImage ? config.characterDescription : undefined, instruction, refCharacterDetails, config.rawPromptMode, undefined, config.orientation, config.visualQuality
        );
        setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, imageUrl: result.imageUrl, imageLoading: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId } : c));
        toast({ title: "Image regenerated", description: `Updated visual for ${chapter.title}` });
      } catch (err: any) {
        setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, imageLoading: false } : c));
        toast({ title: "Image regeneration failed", description: err.message, variant: "destructive" });
      }
      return;
    }

    setRewritingId(chapterId);
    try {
      assertMaxLength("chapter body", chapter.body, AI_INPUT_LIMITS.rewriteBody);
      assertMaxLength("instruction", instruction, AI_INPUT_LIMITS.rewriteInstruction);
      assertMaxLength("chapter title", chapter.title, AI_INPUT_LIMITS.chapterTitle);
      const { data, error } = await supabase.functions.invoke("ai-rewrite-chapter", {
        body: { chapterTitle: chapter.title, chapterBody: chapter.body, mode, instruction },
      });
      if (error) throw new Error(await friendlyEdgeErrorMessage(error, "AI rewrite failed"));
      if (data?.error) throw new Error(data.error);
      setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, body: data.rewrittenText } : c));
      toast({ title: "Chapter rewritten", description: `Applied "${mode}" to ${chapter.title}` });
    } catch (err: any) {
      toast({ title: "AI rewrite failed", description: err.message, variant: "destructive" });
    } finally {
      setRewritingId(null);
      setAiPenOpen(null);
    }
  }, [chapters, referenceImage, config.imageStyle, config.characterDescription, setChapters, toast]);

  // ── Image Generation ────────────────────────────────────────────────
  const generateAllImages = useCallback(async () => {
    if (config.useImageAsIs && referenceImage) {
      const toApply = chaptersWithPrompts.filter((c) => !c.imageUrl);
      if (toApply.length === 0) { toast({ title: "All images already set" }); return; }
      setChapters((prev) => prev.map((c) => {
        const needs = toApply.find((t) => t.id === c.id);
        return needs ? { ...c, imageUrl: referenceImage } : c;
      }));
      toast({ title: "Image applied to all chapters!" });
      return;
    }

    const toGenerate = chaptersWithPrompts.filter((c) => !c.imageUrl);
    if (toGenerate.length === 0) { toast({ title: "All images already generated" }); return; }
    setGenerating(true);
    stopGenerationRef.current = false;
    setProgress({ current: 0, total: toGenerate.length });

    let completed = 0;
    await mapWithConcurrencyLimit(toGenerate, OPEN_NOVA_LOCAL_ONLY ? 2 : 6, async (ch) => {
      if (stopGenerationRef.current) return;
      setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageLoading: true } : c));
      try {
        const result = await generateChapterImage(ch.id, ch.imagePrompt!, referenceImage || undefined, config.imageStyle, !referenceImage ? config.characterDescription : undefined, undefined, refCharacterDetails, config.rawPromptMode, undefined, config.orientation, config.visualQuality);
        setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageUrl: result.imageUrl, imageLoading: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId } : c));
      } catch (err: any) {
        setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageLoading: false } : c));
        if (!stopGenerationRef.current) toast({ title: `Image failed: ${ch.title}`, description: err.message, variant: "destructive" });
      } finally {
        completed++;
        setProgress({ current: completed, total: toGenerate.length });
      }
    });

    // If Stop was pressed mid-run, `stopGeneration` has already toasted and
    // released the UI — don't double-toast and don't overwrite generating.
    if (stopGenerationRef.current) return;
    setGenerating(false);
    toast({ title: "Visual Book complete!", description: `${toGenerate.length} images generated.` });
  }, [chaptersWithPrompts, referenceImage, config.imageStyle, config.characterDescription, config.useImageAsIs, setChapters, toast]);

  // ── Regenerate ALL images (overwrite existing) ──────────────────────
  const regenerateAllImages = useCallback(async () => {
    const toRegen = chaptersWithPrompts;
    if (toRegen.length === 0) { toast({ title: "No chapters with image prompts" }); return; }
    setGenerating(true);
    stopGenerationRef.current = false;
    setProgress({ current: 0, total: toRegen.length });

    let completed = 0;
    await mapWithConcurrencyLimit(toRegen, 6, async (ch) => {
      if (stopGenerationRef.current) return;
      setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageLoading: true } : c));
      try {
        const result = await generateChapterImage(ch.id, ch.imagePrompt!, referenceImage || undefined, config.imageStyle, !referenceImage ? config.characterDescription : undefined, undefined, refCharacterDetails, config.rawPromptMode, undefined, config.orientation, config.visualQuality);
        setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageUrl: result.imageUrl, imageLoading: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId } : c));
      } catch (err: any) {
        setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, imageLoading: false } : c));
        if (!stopGenerationRef.current) toast({ title: `Image ${ch.title} failed`, description: err.message, variant: "destructive" });
      } finally {
        completed++;
        setProgress({ current: completed, total: toRegen.length });
      }
    });

    if (stopGenerationRef.current) return;
    setGenerating(false);
    toast({ title: "All images regenerated!", description: `${toRegen.length} images updated.` });
  }, [chaptersWithPrompts, referenceImage, config.imageStyle, config.characterDescription, setChapters, toast]);

  const stopGeneration = useCallback(() => {
    if (!stopGenerationRef.current) {
      stopGenerationRef.current = true;
      // Release the UI immediately. In-flight image requests (up to ~35s
      // each on the free tier) will finish in the background and still
      // save their results, but the user gets control back instantly.
      setGenerating(false);
      toast({ title: "Generation stopped", description: "In-flight images will finish in the background." });
    }
  }, [toast]);

  const generateSingleImage = useCallback(async (chapter: SlideChapter) => {
    if (!chapter.imagePrompt) return;
    setChapters((prev) => prev.map((c) => c.id === chapter.id ? { ...c, imageLoading: true } : c));
    try {
      const result = await generateChapterImage(chapter.id, chapter.imagePrompt, referenceImage || undefined, config.imageStyle, !referenceImage ? config.characterDescription : undefined, undefined, refCharacterDetails, config.rawPromptMode, undefined, config.orientation, config.visualQuality);
      setChapters((prev) => prev.map((c) => c.id === chapter.id ? { ...c, imageUrl: result.imageUrl, imageLoading: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId } : c));
    } catch (err: any) {
      setChapters((prev) => prev.map((c) => c.id === chapter.id ? { ...c, imageLoading: false } : c));
      toast({ title: "Image failed", description: err.message, variant: "destructive" });
    }
  }, [referenceImage, config.imageStyle, config.characterDescription, setChapters, toast]);

  // ── Upgrade a single draft image to premium (Gemini) on demand ──────
  const upgradeImageToPremium = useCallback(async (chapter: SlideChapter) => {
    if (!chapter.imagePrompt) {
      toast({ title: "No prompt", description: "This image has no prompt to re-render.", variant: "destructive" });
      return;
    }
    setChapters((prev) => prev.map((c) => c.id === chapter.id ? { ...c, imageUpgrading: true, imageLoading: true } : c));
    try {
      const result = await generateChapterImage(
        chapter.id, chapter.imagePrompt, referenceImage || undefined,
        config.imageStyle, !referenceImage ? config.characterDescription : undefined,
        undefined, refCharacterDetails, config.rawPromptMode,
        "premium", config.orientation, config.visualQuality,
      );
      setChapters((prev) => prev.map((c) => c.id === chapter.id
        ? { ...c, imageUrl: result.imageUrl, imageLoading: false, imageUpgrading: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId }
        : c));
      if (result.freeTier) {
        toast({ title: "Premium unavailable", description: "Free providers were used (premium quota exhausted or service down).", variant: "destructive" });
      } else {
        toast({ title: "Image upgraded", description: `${chapter.title} re-rendered with premium quality.` });
      }
    } catch (err: any) {
      setChapters((prev) => prev.map((c) => c.id === chapter.id ? { ...c, imageLoading: false, imageUpgrading: false } : c));
      toast({ title: "Upgrade failed", description: err.message, variant: "destructive" });
    }
  }, [referenceImage, config.imageStyle, config.characterDescription, config.rawPromptMode, setChapters, toast]);

  // ── Scene Rating with Auto-optimize ─────────────────────────────────
  const handleSceneRate = useCallback(async (chapterId: string, rating: number, comment: string) => {
    setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, rating, ratingComment: comment } : c));
    const chapter = chapters.find((c) => c.id === chapterId);
    if (rating <= 3 && comment && chapter?.imagePrompt && chapter?.imageUrl) {
      setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, autoOptimizing: true, imageLoading: true } : c));
      toast({ title: t("rating.autoOptimizeStarted"), description: t("rating.autoOptimizeDesc") });
      try {
        const optimizedPrompt = `${chapter.imagePrompt}. User feedback: ${comment}. Please improve based on this feedback.`;
        const result = await generateChapterImage(chapterId, optimizedPrompt, referenceImage || undefined, config.imageStyle, !referenceImage ? config.characterDescription : undefined, comment, refCharacterDetails, config.rawPromptMode, undefined, config.orientation, config.visualQuality);
        setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, imageUrl: result.imageUrl, imageLoading: false, autoOptimizing: false, imageProvider: result.provider, imageFreeTier: !!result.freeTier, imageCorrelationId: result.correlationId } : c));
        toast({ title: t("rating.optimizeSuccess"), description: `${chapter.title} — ${t("rating.optimizeSuccessDesc")}` });
      } catch (err: any) {
        setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, imageLoading: false, autoOptimizing: false } : c));
        toast({ title: t("rating.optimizeFailed"), description: err.message, variant: "destructive" });
      }
    } else {
      toast({ title: t("rating.saved"), description: `${rating} ⭐` });
    }
  }, [chapters, referenceImage, config.imageStyle, config.characterDescription, setChapters, toast, t]);

  const updateChapter = useCallback((id: string, updates: Partial<SlideChapter>) => {
    setChapters((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c));
  }, [setChapters]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-4xl mx-auto space-y-4 sm:space-y-8 px-1 sm:px-0"
    >
      {/* Header */}
      <div className="text-center space-y-2 sm:space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent/20 bg-accent/5 text-xs font-medium text-accent">
          <Film className="w-3 h-3" />
          {t("visual.studio")}
        </div>
        <h2 className="text-2xl sm:text-3xl font-serif font-bold gradient-text">{t("visual.title")}</h2>
        <p className="text-muted-foreground text-xs sm:text-sm max-w-md mx-auto">{t("visual.subtitle")}</p>
        <VisualBookConfig />
        <AutoEcoBanner />
        <div className="flex items-center justify-center gap-3 mt-2">
          <GlobalFindReplace
            chapters={chapters}
            onUpdateChapters={setChapters}
            onSearchChange={setSearchHighlight}
            onScrollToChapter={(chapterId) => {
              chapterRefs.current[chapterId]?.scrollIntoView({ behavior: "smooth", block: "center" });
              const el = chapterRefs.current[chapterId];
              if (el) {
                el.classList.add("ring-2", "ring-primary/50");
                setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 1500);
              }
            }}
          />
        </div>
      </div>

      {/* Translation progress */}
      {translating && (
        <div className="glass-card p-4 flex items-center gap-3 animate-in fade-in">
          <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Translating to Afrikaans…</p>
            <p className="text-xs text-muted-foreground">This may take a moment for longer books</p>
          </div>
        </div>
      )}

      {/* Stats & generate controls — gated for free users */}
      {!canGenerateImages ? (
        <div className="glass-card p-6 space-y-4 border-2 border-primary/20">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Crown className="w-6 h-6 text-primary" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold">Upgrade to Generate Images</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI image generation is available on Standard and Premium plans.
                Your chapters and text content are ready — upgrade to bring them to life visually.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => window.location.href = "/pricing"} className="gap-2">
              <ArrowRight className="w-4 h-4" /> View Plans & Pricing
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
              <Lock className="w-3.5 h-3.5" /> Free plan: text-only eBook export
            </Button>
          </div>
          <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What you can do on Free:</p>
            <p>✓ Edit chapter text and storylines</p>
            <p>✓ Export text-only eBook (PDF / EPUB)</p>
            <p>✗ AI image generation — requires Standard+</p>
            <p>✗ Narration & audio — requires Premium+</p>
          </div>
        </div>
      ) : (
        <div className="glass-card p-3 sm:p-6 space-y-3 sm:space-y-4">
          {/* Pre-generation character config reminder */}
          {chaptersWithImages.length === 0 && !config.useImageAsIs && (() => {
            const hasRef = !!referenceImage;
            const refGender = (config as any).refGender;
            const refAge = (config as any).refAge;
            const refDetails = (config as any).refDetails;
            const refIncomplete = hasRef && !((refGender && refGender !== "unspecified") || refAge || refDetails);
            const noCharacter = !hasRef && !config.characterDescription?.trim();
            if (!refIncomplete && !noCharacter) return null;
            return (
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-xs sm:text-sm font-medium text-foreground">
                    Set your main character before generating images
                  </p>
                  <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                    {refIncomplete
                      ? "Scroll up and choose the gender, age range, and any appearance details for the person in your reference photo so AI keeps them consistent across chapters."
                      : "Scroll up and either upload a reference photo (with gender / age) or describe your main character so every chapter looks consistent."}
                  </p>
                </div>
              </div>
            );
          })()}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium">{chaptersWithImages.length} / {chaptersWithPrompts.length} {t("visual.imagesGenerated")}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">{chaptersWithPrompts.length} {t("visual.chaptersWithPrompts")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  // Confirm if user hasn't configured a main character at all
                  const hasRef = !!referenceImage;
                  const refGender = (config as any).refGender;
                  const refAge = (config as any).refAge;
                  const refDetails = (config as any).refDetails;
                  const refIncomplete = hasRef && !((refGender && refGender !== "unspecified") || refAge || refDetails);
                  const noCharacter = !hasRef && !config.characterDescription?.trim();
                  if ((refIncomplete || noCharacter) && chaptersWithImages.length === 0 && !config.useImageAsIs) {
                    const ok = window.confirm(
                      "You haven't set your main character yet (gender, age, or description). Images may look inconsistent across chapters.\n\nGenerate anyway?"
                    );
                    if (!ok) return;
                  }
                  generateAllImages();
                }}
                disabled={generating || allDone}
                className="gap-2"
                size="sm"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : allDone ? <Check className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span className="truncate">
                  {generating ? `${progress.current}/${progress.total}…` : allDone ? t("visual.allDone") : t("visual.generateAll")}
                </span>
              </Button>
              {generating && (
                <Button variant="destructive" size="sm" onClick={stopGeneration} className="gap-1.5">
                  <StopCircle className="w-4 h-4" /> Stop
                </Button>
              )}
            </div>
          </div>
          {generating && <Progress value={(progress.current / progress.total) * 100} className="h-2" />}
        </div>
      )}

      {/* View mode toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {chaptersWithImages.length > 0 && viewMode === "gallery" && t("visual.galleryHint")}
        </p>
        <div className="flex items-center gap-1 bg-card/80 border border-border/40 rounded-full p-0.5">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-full transition-all flex items-center gap-1 text-xs ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="pr-1">{t("visual.gridView")}</span>
          </button>
          <button
            onClick={() => setViewMode("gallery")}
            className={`p-1.5 rounded-full transition-all flex items-center gap-1 text-xs ${viewMode === "gallery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <GalleryHorizontalEnd className="w-3.5 h-3.5" />
            <span className="pr-1">{t("visual.galleryView")}</span>
          </button>
        </div>
      </div>

      {/* Gallery view */}
      {viewMode === "gallery" && (
        <VisualBookGallery
          chapters={chapters}
          chaptersWithImages={chaptersWithImages}
          config={config}
          onOpenLightbox={(idx) => setLightboxIndex(idx)}
          onSceneRate={handleSceneRate}
          onUpgradeImage={upgradeImageToPremium}
          onChapterPatch={(chapterId, patch) =>
            setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, ...patch } : c))
          }
        />
      )}

      {/* Grid view (chapter cards) */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <AnimatePresence>
            {chapters.map((chapter, idx) => (
              <motion.div
                key={chapter.id}
                ref={(el) => { chapterRefs.current[chapter.id] = el; }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`glass-card overflow-hidden transition-shadow duration-300 ${previewingChapter === chapter.id ? "ring-2 ring-primary animate-glow-pulse" : ""}`}
              >
                {/* Image area */}
                <div
                  className={`relative bg-muted ${config.orientation === "portrait" ? "aspect-[3/4]" : "aspect-video"} flex items-center justify-center cursor-pointer group`}
                  onClick={() => {
                    if (chapter.imageUrl) {
                      const imgIdx = chaptersWithImages.findIndex((c) => c.id === chapter.id);
                      if (imgIdx >= 0) setLightboxIndex(imgIdx);
                    }
                  }}
                >
                  {chapter.imageUrl ? (
                    <>
                      <ChapterImageMosaic
                        images={getChapterImages(chapter)}
                        layout={chapter.imageLayout}
                        aspectClass="h-full"
                        alt={chapter.title}
                        onImageClick={() => {
                          const imgIdx = chaptersWithImages.findIndex((c) => c.id === chapter.id);
                          if (imgIdx >= 0) setLightboxIndex(imgIdx);
                        }}
                      />
                      {/* Regenerate image button overlay */}
                      {!chapter.imageLoading && !chapter.autoOptimizing && canGenerateImages && (
                        <button
                          onClick={(e) => { e.stopPropagation(); generateSingleImage(chapter); }}
                          disabled={generating}
                          className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-background/80 backdrop-blur-sm text-foreground px-2 py-1 rounded-md text-[11px] font-medium shadow-md hover:bg-background/95 border border-border/40"
                          title="Regenerate image"
                        >
                          <RefreshCw className="w-3 h-3" /> Regenerate
                        </button>
                      )}
                    </>
                  ) : chapter.imageLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">{t("visual.generating")}…</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ImageIcon className="w-8 h-8" />
                      {chapter.imagePrompt && canGenerateImages && (
                        <Button variant="secondary" size="sm" className="text-xs gap-1" onClick={(e) => { e.stopPropagation(); generateSingleImage(chapter); }}>
                          <Play className="w-3 h-3" /> {t("visual.generateImage")}
                        </Button>
                      )}
                      {chapter.imagePrompt && !canGenerateImages && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Upgrade to generate</p>
                      )}
                    </div>
                  )}
                  {chapter.autoOptimizing && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <div className="flex items-center gap-2 bg-card/90 px-3 py-2 rounded-lg border border-primary/30">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-xs font-medium">{t("rating.optimizing")}</span>
                      </div>
                    </div>
                  )}
                  {previewingChapter === chapter.id && (
                    <>
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent px-3 py-2.5 pointer-events-none"
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex items-end gap-[2px] h-3">
                            <span className="waveform-bar" />
                            <span className="waveform-bar" />
                            <span className="waveform-bar" />
                          </div>
                          <span className="text-xs font-medium text-foreground truncate">{chapter.title}</span>
                        </div>
                      </motion.div>
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={(e) => { e.stopPropagation(); stopPreview(); }}
                        className="absolute top-2 right-2 flex items-center gap-1.5 bg-destructive text-destructive-foreground px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-lg hover:bg-destructive/90 transition-colors"
                      >
                        <Square className="w-3 h-3" /> Stop
                      </motion.button>
                    </>
                  )}
                </div>

                {/* Chapter info */}
                <div className="p-3 sm:p-4 space-y-2">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Ch. {idx + 1}</span>
                    <div className="flex-1" />
                    <button onClick={() => setEditingChapter(editingChapter === chapter.id ? null : chapter.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      {editingChapter === chapter.id ? t("visual.cancel") : t("visual.edit")}
                    </button>
                    <div className="relative">
                      <button onClick={() => setAiPenOpen(aiPenOpen === chapter.id ? null : chapter.id)} className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                        <PenTool className="w-3 h-3" /> AI
                      </button>
                      <AnimatePresence>
                        {aiPenOpen === chapter.id && (
                          <AiPenMenu
                            chapter={chapter}
                            isRewriting={rewritingId === chapter.id}
                            onRewrite={(mode, instruction) => handleAiRewrite(chapter.id, mode, instruction)}
                            onClose={() => setAiPenOpen(null)}
                          />
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <h3 className="font-serif font-semibold text-sm">
                    <HighlightText text={chapter.title} search={searchHighlight} />
                  </h3>

                  <AnimatePresence>
                    {editingChapter === chapter.id && (
                      <ChapterEditPanel
                        chapter={chapter}
                        onUpdate={(updates) => updateChapter(chapter.id, updates)}
                        onClose={() => setEditingChapter(null)}
                        onSave={async () => {
                          setSaving(true);
                          try {
                            const title = config.topic || "Untitled Project";
                            const { id, reassigned, reassignReason } = await saveProject({
                              id: projectId || undefined,
                              title,
                              config,
                              sources,
                              chapters,
                              storyline,
                              storyline_accepted: storylineAccepted,
                              step,
                              overall_rating: overallRating,
                            });
                            setProjectId(id);
                            setProjectDirty(false);
                            if (reassigned && reassignReason === "deleted") {
                              toast({ title: "Project was deleted — saved as a new project", description: "The original project no longer exists, so your changes were saved as a new project." });
                            } else if (reassigned) {
                              toast({ title: "Saved as a new copy", description: "The original project belongs to another account, so we saved your changes as a new project." });
                            } else {
                              toast({ title: "Project saved!", description: "Chapter changes saved successfully." });
                            }
                          } catch (err: any) {
                            if (!notifyProjectSaveError(err)) {
                              toast({ title: "Save failed", description: err.message, variant: "destructive" });
                            }
                          } finally {
                            setSaving(false);
                          }
                        }}
                        saving={saving}
                      />
                    )}
                  </AnimatePresence>

                  {editingChapter !== chapter.id && (
                    <>
                      <p
                        className={`text-xs text-foreground/70 leading-relaxed whitespace-pre-wrap cursor-text hover:bg-muted/30 hover:ring-1 hover:ring-border/40 rounded-md px-1 py-0.5 -mx-1 transition-colors ${expandedChapters.has(chapter.id) ? "" : "line-clamp-3"}`}
                        onClick={() => setEditingChapter(chapter.id)}
                        title="Click to edit"
                      >
                        <HighlightText text={chapter.body} search={searchHighlight} />
                      </p>
                      {chapter.body && chapter.body.length > 150 && (
                        <button
                          onClick={() => setExpandedChapters((prev) => {
                            const next = new Set(prev);
                            next.has(chapter.id) ? next.delete(chapter.id) : next.add(chapter.id);
                            return next;
                          })}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                          {expandedChapters.has(chapter.id) ? (
                            <><ChevronUp className="w-3 h-3" /> Show less</>
                          ) : (
                            <><ChevronDown className="w-3 h-3" /> Read full chapter</>
                          )}
                        </button>
                      )}
                      {chapter.imagePrompt && (
                        <p className="text-[10px] text-muted-foreground italic line-clamp-2">🎨 {chapter.imagePrompt}</p>
                      )}
                      {/* Regenerate text & image buttons */}
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <button
                          onClick={() => handleAiRewrite(chapter.id, "improve")}
                          disabled={rewritingId === chapter.id}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-medium bg-muted/50 px-2 py-1 rounded-md"
                        >
                          {rewritingId === chapter.id ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Rewriting…</>
                          ) : (
                            <><Type className="w-3 h-3" /> Regenerate text</>
                          )}
                        </button>
                        {chapter.imagePrompt && canGenerateImages && (
                          <button
                            onClick={() => generateSingleImage(chapter)}
                            disabled={generating || !!chapter.imageLoading}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-medium bg-muted/50 px-2 py-1 rounded-md"
                          >
                            {chapter.imageLoading ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                            ) : (
                              <><ImageIcon className="w-3 h-3" /> Regenerate image</>
                            )}
                          </button>
                        )}
                      </div>
                      {/* Narration preview */}
                      {chapter.body && canUseNarration && (
                        <button
                          onClick={() => previewingChapter === chapter.id ? stopPreview() : previewNarration(chapter.id, chapter.body)}
                          disabled={downloading}
                          className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors ${
                            previewingChapter === chapter.id
                              ? "bg-primary/15 text-primary font-medium"
                              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          {previewingChapter === chapter.id ? (
                            <>
                              <div className="flex items-end gap-[2px] h-3">
                                <span className="waveform-bar" />
                                <span className="waveform-bar" />
                                <span className="waveform-bar" />
                                <span className="waveform-bar" />
                              </div>
                              Playing…
                              <Square className="w-2.5 h-2.5 ml-0.5" />
                            </>
                          ) : (
                            <><Volume2 className="w-3 h-3" /> Preview narration{isChapterCached(chapter.body) ? " ✓" : ""}</>
                          )}
                        </button>
                      )}
                      {chapter.body && !canUseNarration && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-muted/30 text-muted-foreground">
                          🔒 Narration requires Premium+
                        </span>
                      )}
                    </>
                  )}

                  {chapter.imageUrl && (
                    <SceneRating
                      rating={chapter.rating}
                      comment={chapter.ratingComment}
                      isOptimizing={chapter.autoOptimizing}
                      onRate={(rating, comment) => handleSceneRate(chapter.id, rating, comment)}
                    />
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Overall book rating */}
      <OverallBookRating chapters={chapters} overallRating={overallRating} onOverallRatingChange={(r) => {
        setOverallRating(r);
        if (r > 0) {
          sonnerToast.success("Thank you for rating your eBook!", { description: `You gave it ${r} star${r > 1 ? "s" : ""}.` });
        }
      }} />

      {/* Quota & Credits (unified collapsible card) */}
      <QuotaAndCreditsCard />

      {/* Optimization info banner */}
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-foreground">{t("rating.infoTitle")}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{t("rating.infoDesc")}</p>
        </div>
      </div>

      {/* Export progress bar */}
      <ExportProgressBar
        downloading={downloading}
        stage={downloadProgress.stage}
        current={downloadProgress.current}
        total={downloadProgress.total}
        onStop={stopExport}
        pendingDownload={pendingDownload}
        lastAvDrift={lastAvDrift}
        onManualDownload={manualDownload}
        onDismissPending={dismissPendingDownload}
        segmentInfo={segmentInfo}
        narrationEta={narrationEta}
        hasCachedVideo={hasCachedVideo}
        cachedVideoFilename={cachedVideoFilename}
        cachedVideoSize={cachedVideoSize}
        cachedVideoSavedAt={cachedVideoSavedAt}
        onRedownloadVideo={redownloadLastVideo}
      />
      <ExportDebugOverlay
        active={downloading && !!exportStep}
        step={exportStep}
        stage={downloadProgress.stage}
        current={downloadProgress.current}
        total={downloadProgress.total}
      />
      {generating && (
        <ExportProgressBar
          downloading={generating}
          stage={`Regenerating images`}
          current={progress.current}
          total={progress.total}
          onStop={() => stopGeneration?.()}
        />
      )}

      {/* Action bar */}
      <VisualBookActions
        canUseNarration={canUseNarration}
        chaptersCount={chapters.length}
        chaptersWithImagesCount={chaptersWithImages.length}
        totalNarrationChars={chapters.reduce((sum, c) => sum + (c.body?.length || 0), 0)}
        cachedNarrationChars={chapters.reduce((sum, c) => sum + (c.body && isChapterCached(c.body) ? c.body.length : 0), 0)}
        config={config}
        setConfig={setConfig}
        downloading={downloading}
        downloadProgress={downloadProgress}
        onBack={() => setStep(5)}
        onOpenReader={() => setShowReader(true)}
        onDownloadEbook={downloadAsEbook}
        onDownloadEpub={downloadAsEpub}
        onDownloadPdf={(photoOnly) => { setPdfPhotoOnly(photoOnly); setPdfPreviewOpen(true); }}
        chapterPickerItems={chapters.map((c, i) => ({ id: c.id, title: c.title || `Chapter ${i + 1}` }))}
        onPreviewStoryboardJson={(selectedChapterIds) => {
          setPreviewExport(buildExportPayload(selectedChapterIds));
        }}
        onDownloadStoryboardJson={(selectedChapterIds) => {
          const built = buildExportPayload(selectedChapterIds);
          const { payload, filename, isPartial, exportedChapters, dedupedSources, droppedDuplicates, missingContent, assetUrls } = built;
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
          const dupNote = droppedDuplicates > 0 ? ` (${droppedDuplicates} duplicate${droppedDuplicates === 1 ? "" : "s"} merged)` : "";
          const missingNote = missingContent > 0 ? `, ${missingContent} without snippet text` : "";
          toast({
            title: isPartial ? "Selection exported" : "Storyboard exported",
            description: isPartial
              ? `Exported ${exportedChapters.length} of ${chapters.length} chapters, ${dedupedSources.length} source${dedupedSources.length === 1 ? "" : "s"}${dupNote}${missingNote}, and ${assetUrls.size} asset link${assetUrls.size === 1 ? "" : "s"}.`
              : `Editable JSON downloaded — ${dedupedSources.length} source${dedupedSources.length === 1 ? "" : "s"}${dupNote}${missingNote} and ${assetUrls.size} asset link${assetUrls.size === 1 ? "" : "s"}.`,
          });
        }}
        onImportStoryboardJson={async (file) => {
          const text = await file.text();
          await processImportText(text);
        }}
        onImportStoryboardText={async (text) => {
          await processImportText(text);
        }}
        onDownloadVideo={(quality, speed) => downloadAsVideo(quality, speed)}
        onDownloadTextBook={downloadAsTextBook}
        onDownloadAudio={downloadAsAudio}
        onClearTtsCache={clearTtsCache}
        ttsCacheSize={ttsCacheSize}
        canResume={canResume}
        cachedChapterCount={cachedChapterCount}
        onPreviewAll={previewAllNarration}
        previewAllActive={previewAllActive}
        previewingChapter={previewingChapter}
        previewingChapterIndex={previewingChapter ? chapters.findIndex((c) => c.id === previewingChapter) : null}
        onSave={async () => {
          setSaving(true);
          try {
            const title = config.topic || "Untitled Project";
            const { id, reassigned, reassignReason } = await saveProject({
              id: projectId || undefined,
              title,
              config,
              sources,
              chapters,
              storyline,
              storyline_accepted: storylineAccepted,
              step,
              overall_rating: overallRating,
            });
            setProjectId(id);
            setProjectDirty(false);
            if (reassigned && reassignReason === "deleted") {
              toast({ title: "Project was deleted — saved as a new project", description: "The original project no longer exists, so your changes were saved as a new project." });
            } else if (reassigned) {
              toast({ title: "Saved as a new copy", description: "The original project belongs to another account, so we saved your changes as a new project." });
            } else {
              toast({ title: "Project saved!", description: `${chapters.filter(c => c.imageUrl).length} chapters with images saved` });
            }
          } catch (err: any) {
            if (!notifyProjectSaveError(err)) {
              toast({ title: "Save failed", description: err.message, variant: "destructive" });
            }
          } finally {
            setSaving(false);
          }
        }}
        saving={saving}
        onRegenerateAllImages={regenerateAllImages}
        onStopGeneration={stopGeneration}
        onStopExport={stopExport}
        regeneratingImages={generating}
        imageProgress={progress}
        onRefreshImages={() => {
          const withImages = chapters.filter(c => c.imageUrl);
          if (withImages.length === 0) return;
          setChapters(prev => prev.map(ch => {
            if (!ch.imageUrl) return ch;
            const base = ch.imageUrl.split("?")[0];
            return { ...ch, imageUrl: `${base}?t=${Date.now()}` };
          }));
          toast({ title: "Images refreshed", description: `${withImages.length} image${withImages.length !== 1 ? "s" : ""} reloaded.` });
        }}
        onResetImages={() => {
          const count = chapters.filter(c => c.imageUrl).length;
          if (count === 0) return;
          if (!confirm(`Reset all ${count} chapter images? This cannot be undone.`)) return;
          setChapters(prev => prev.map(ch => ({ ...ch, imageUrl: undefined, imageLoading: false })));
          toast({ title: "Images reset", description: `${count} chapter image${count !== 1 ? "s" : ""} cleared.` });
        }}
        onPrint={async () => {
          const printWin = window.open("", "_blank");
          if (!printWin) { toast({ title: "Print blocked", description: "Please allow pop-ups for this site.", variant: "destructive" }); return; }
          // Inline images as data URIs so the popup keeps working past the 1h signed-URL TTL.
          const { chapters: signedChapters } = await prepareExportImages(
            chapters, null,
            { embedAsDataUri: true, uiAction: "printStorybook" }
          );
          const coverImg = signedChapters.find((c) => c.imageUrl)?.imageUrl || "";
          const chaptersHtml = signedChapters.map((ch, i) => `
            <div class="chapter" style="page-break-after:always">
              ${ch.imageUrl ? `<img src="${ch.imageUrl}" style="width:100%;max-height:420px;object-fit:cover;border-radius:8px;margin-bottom:16px">` : ""}
              <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">Chapter ${i + 1} of ${signedChapters.length}</p>
              <h2 style="font-size:1.6em;margin-bottom:12px;color:#222">${ch.title.replace(/</g,"&lt;")}</h2>
              <div style="line-height:1.9;font-size:14px;white-space:pre-wrap;color:#333">${ch.body.replace(/</g,"&lt;")}</div>
            </div>`).join("");
          printWin.document.write(`<!DOCTYPE html><html><head><title>${(config.topic || "Storybook").replace(/</g,"&lt;")}</title>
            <style>@media print{.no-print{display:none}}body{font-family:Georgia,serif;margin:0;padding:0;color:#222}
            .cover{text-align:center;padding:60px 20px;page-break-after:always;position:relative;min-height:90vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
            .cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.2}
            .cover h1{position:relative;font-size:2.5em;margin-bottom:.3em}.cover p{position:relative;color:#666;font-size:1.1em}
            .chapter{padding:40px;max-width:700px;margin:0 auto}
            .print-btn{position:fixed;bottom:20px;right:20px;padding:12px 28px;font-size:16px;background:#222;color:#fff;border:none;border-radius:8px;cursor:pointer;z-index:99}
            </style></head><body>
            <div class="cover">${coverImg ? `<img src="${coverImg}">` : ""}<h1>${(config.topic || "Storybook").replace(/</g,"&lt;")}</h1><p>${(config.tone || "")} ${(config.theme || "")} book</p></div>
            ${chaptersHtml}
            <button class="print-btn no-print" onclick="window.print()">🖨️ Print</button>
          </body></html>`);
          printWin.document.close();
          setTimeout(() => printWin.print(), 600);
        }}
      />

      {/* Book Reader overlay */}
      <AnimatePresence>
        {showReader && <BookReader chapters={chapters} config={config} onClose={() => setShowReader(false)} />}
      </AnimatePresence>

      {/* Lightbox overlay */}
      <AnimatePresence>
        <VisualBookLightbox
          lightboxIndex={lightboxIndex}
          setLightboxIndex={setLightboxIndex}
          chaptersWithImages={chaptersWithImages}
          chapters={chapters}
          config={config}
        />
      </AnimatePresence>

      {/* PDF Preview Modal */}
      <PdfPreviewModal
        open={pdfPreviewOpen}
        onClose={() => setPdfPreviewOpen(false)}
        chapters={chapters}
        config={config}
        referenceImage={referenceImage}
        photoOnly={pdfPhotoOnly}
        onDownload={(editedChapters, photoOnly, pdfStyle) => {
          setChapters(editedChapters);
          downloadAsPdf(photoOnly, pdfStyle, editedChapters);
        }}

        onApplyEdits={(editedChapters) => {
          setChapters(editedChapters);
          toast({ title: "Edits applied", description: "Chapter changes saved to your project." });
        }}
      />

      {/* Confirmation modal: shows what an incoming JSON import will restore */}
      <AlertDialog open={!!pendingImport} onOpenChange={(open) => {
        if (!open && !applyingImport) {
          setPendingImport(null);
          setSchemaOverrideAck(false);
          setOverwriteAck(false);
          // Safety: clear any leftover apply-state so a later import isn't blocked.
          setApplyingImport(false);
          setImportProgress(null);
          if (preserveImportErrorOnCloseRef.current) {
            // User clicked "Fix inputs & retry" — keep the error + snapshot so
            // they can reopen the review and retry without re-uploading.
            preserveImportErrorOnCloseRef.current = false;
          } else {
            setImportError(null);
            setImportErrorDetails(null);
            setLastFailedImport(null);
          }
        }
      }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Review import: {pendingImport?.title || "Untitled storyboard"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {pendingImport && (
                  <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1">
                    <div className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-0.5 items-baseline">
                      <span className="text-muted-foreground">File tag</span>
                      <code className="font-mono break-all">{`${SCHEMA_PREFIX}${pendingImport.originalSchemaVersion}`}</code>
                      <span className="text-muted-foreground">Expected</span>
                      <code className="font-mono break-all">{`${SCHEMA_PREFIX}${CURRENT_SCHEMA_VERSION}`}</code>
                    </div>
                    <div className="text-muted-foreground pt-0.5 border-t border-border/60">
                      {pendingImport.originalSchemaVersion === pendingImport.schemaVersion
                        ? "Tags match — no migration needed."
                        : pendingImport.originalSchemaVersion < pendingImport.schemaVersion
                        ? `Auto-upgrade v${pendingImport.originalSchemaVersion} → v${pendingImport.schemaVersion} will run on apply.`
                        : `Downgrade v${pendingImport.originalSchemaVersion} → v${pendingImport.schemaVersion} — proceed with caution.`}
                      {pendingImport.exportedAt ? ` • exported ${new Date(pendingImport.exportedAt).toLocaleString()}` : ""}
                    </div>
                  </div>
                )}

                {pendingImport && (
                  <SchemaVersionHelper
                    fileVersion={pendingImport.originalSchemaVersion}
                    templateTitle={pendingImport.title}
                  />
                )}

                {pendingImport && isImportBlocked({
                  strict: strictSchemaImport,
                  originalSchemaVersion: pendingImport.originalSchemaVersion,
                  schemaVersion: pendingImport.schemaVersion,
                  overrideAck: schemaOverrideAck,
                }) && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Import blocked — schema mismatch
                    </div>
                    <div className="text-muted-foreground">
                      Strict mode is on and this file is{" "}
                      <code className="font-mono">v{pendingImport.originalSchemaVersion}</code>, but
                      this build expects{" "}
                      <code className="font-mono">v{pendingImport.schemaVersion}</code>. Applying it
                      anyway can corrupt chapters or drop fields.
                    </div>
                    <div className="text-foreground">To override, either:</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                      <li>Tick <span className="font-medium text-foreground">“Override schema mismatch”</span> in the warning below, or</li>
                      <li>Untick <span className="font-medium text-foreground">“Always block schema-mismatched imports”</span> to disable strict mode.</li>
                    </ul>
                  </div>
                )}

                {pendingImport && (() => {
                  const inc = pendingImport;
                  const incChapters = inc.chapters ?? [];
                  const incSources = inc.sources ?? [];
                  const incAssets = inc.assets ?? [];
                  const incConfig = (inc.config ?? {}) as Record<string, any>;
                  const curIds = new Set(chapters.map((c) => c.id));
                  const newChapters = incChapters.filter((c) => !curIds.has(c.id));
                  const replacedChapters = incChapters.filter((c) => curIds.has(c.id));
                  const curUrls = new Set((sources ?? []).map((s: any) => s.url).filter(Boolean));
                  const newSources = incSources.filter((s: any) => s.url && !curUrls.has(s.url));
                  const dupSources = incSources.filter((s: any) => s.url && curUrls.has(s.url));
                  const curCfg = (config ?? {}) as Record<string, any>;
                  const cfgKeys = Array.from(new Set([...Object.keys(curCfg), ...Object.keys(incConfig)])).sort();
                  const cfgChanges = cfgKeys
                    .map((k) => {
                      const before = curCfg[k];
                      const after = incConfig[k];
                      const sBefore = JSON.stringify(before);
                      const sAfter = JSON.stringify(after);
                      if (sBefore === sAfter) return null;
                      const status: "new" | "removed" | "changed" =
                        before === undefined ? "new" : after === undefined ? "removed" : "changed";
                      return { k, sBefore, sAfter, status };
                    })
                    .filter(Boolean) as { k: string; sBefore: string; sAfter: string; status: string }[];
                  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").trim();
                  const summarize = (s: string | null | undefined, n = 220) => {
                    const t = stripHtml(s ?? "");
                    return t.length <= n ? t : t.slice(0, n) + "…";
                  };
                  const Row = ({
                    label,
                    summary,
                    children,
                    defaultOpen = false,
                  }: {
                    label: string;
                    summary: React.ReactNode;
                    children: React.ReactNode;
                    defaultOpen?: boolean;
                  }) => (
                    <details className="group" open={defaultOpen}>
                      <summary className="cursor-pointer select-none flex items-center justify-between px-2 py-1.5 hover:bg-muted/40 rounded">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                          {label}
                        </span>
                        <span className="font-medium text-xs">{summary}</span>
                      </summary>
                      <div className="px-2 pb-2 pt-1 text-xs space-y-1">{children}</div>
                    </details>
                  );
                  const overwriteKeys = cfgChanges.filter((c) => c.status === "changed").map((c) => c.k);
                  const newKeys = cfgChanges.filter((c) => c.status === "new").map((c) => c.k);
                  const removedKeys = cfgChanges.filter((c) => c.status === "removed").map((c) => c.k);
                  // Reusable: apply current search/regex/status/sort to cfgChanges.
                  // Used by both the rendered list and the CSV/JSON export buttons
                  // so downloads always match exactly what the user sees.
                  const computeFilteredCfg = () => {
                    const raw = configKeyFilter.trim();
                    const q = raw.toLowerCase();
                    let regex: RegExp | null = null;
                    if (configKeyRegex && raw) {
                      try { regex = new RegExp(raw, "i"); } catch { regex = null; }
                    }
                    const textFiltered = !raw
                      ? cfgChanges
                      : regex
                        ? cfgChanges.filter((c) => regex!.test(c.k))
                        : cfgChanges.filter((c) => c.k.toLowerCase().includes(q));
                    const baseFiltered = textFiltered.filter((c) => configStatusFilter.has(c.status as any));
                    const order: Record<string, number> = { new: 0, changed: 1, removed: 2 };
                    return [...baseFiltered].sort((a, b) => {
                      if (configKeySort === "az") return a.k.localeCompare(b.k);
                      if (configKeySort === "za") return b.k.localeCompare(a.k);
                      return (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.k.localeCompare(b.k);
                    });
                  };
                  const buildMatchSpan = (key: string): { start: number; end: number } | null => {
                    const raw = configKeyFilter.trim();
                    if (!raw) return null;
                    if (configKeyRegex) {
                      try {
                        const m = key.match(new RegExp(raw, "i"));
                        if (m && m.index != null) return { start: m.index, end: m.index + m[0].length };
                      } catch { /* invalid */ }
                      return null;
                    }
                    const idx = key.toLowerCase().indexOf(raw.toLowerCase());
                    return idx >= 0 ? { start: idx, end: idx + raw.length } : null;
                  };
                  const triggerDownload = (
                    filename: string,
                    mime: string,
                    data: string,
                    opts?: { bom?: boolean },
                  ) => {
                    const parts: BlobPart[] = [];
                    if (opts?.bom) parts.push(new Uint8Array([0xef, 0xbb, 0xbf])); // UTF-8 BOM
                    parts.push(data);
                    const blob = new Blob(parts, { type: mime });
                    if (blob.size === 0) throw new Error("Generated file is empty");
                    const url = URL.createObjectURL(blob);
                    try {
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = filename;
                      a.rel = "noopener";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    } finally {
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }
                    return blob.size;
                  };
                  // RFC 4180 quoting. Always quotes when value contains the active
                  // delimiter, double-quote, CR, LF, or a leading/trailing whitespace
                  // (Excel trims those otherwise). `alwaysQuote` forces quoting on
                  // every cell for maximum compatibility with strict parsers.
                  const csvEscapeFor = (delim: string, alwaysQuote: boolean) => (v: string) => {
                    const s = v ?? "";
                    const needsQuote =
                      alwaysQuote ||
                      s.length === 0 && alwaysQuote ||
                      s.includes('"') ||
                      s.includes("\r") ||
                      s.includes("\n") ||
                      s.includes(delim) ||
                      /^\s|\s$/.test(s);
                    return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
                  };
                  const exportCfgDiff = async (format: "csv" | "json") => {
                    if (cfgExportBusy) return;
                    // Validate regex up-front so the user gets a clear error.
                    const raw = configKeyFilter.trim();
                    if (configKeyRegex && raw) {
                      try { new RegExp(raw, "i"); }
                      catch (e) {
                        sonnerToast.error("Invalid regex pattern", {
                          description: String((e as any)?.message ?? e),
                        });
                        return;
                      }
                    }
                    const allRows = computeFilteredCfg();
                    const usePage = cfgExportOpts.scope === "page";
                    const totalPages = Math.max(1, Math.ceil(allRows.length / CFG_PAGE_SIZE));
                    const safePage = Math.min(cfgPage, totalPages - 1);
                    const pageStart = safePage * CFG_PAGE_SIZE;
                    const rows = usePage
                      ? allRows.slice(pageStart, pageStart + CFG_PAGE_SIZE)
                      : allRows;
                    if (rows.length === 0) {
                      sonnerToast.warning("Nothing to export", {
                        description: cfgChanges.length === 0
                          ? "There are no changed settings keys."
                          : usePage && allRows.length > 0
                            ? "Current page is empty. Switch scope to “All filtered” in Options…"
                            : "No keys match the current filters. Adjust search or status checkboxes.",
                      });
                      return;
                    }
                    if (cfgExportOpts.cols.length === 0) {
                      sonnerToast.warning("Pick at least one column", {
                        description: "Open Options… to enable columns to include in the export.",
                        action: { label: "Options", onClick: () => setCfgExportOptsOpen(true) },
                      });
                      return;
                    }
                    setCfgExportBusy(format);
                    const scopeLabel = usePage
                      ? `page ${safePage + 1} (${rows.length} of ${allRows.length})`
                      : `all filtered (${allRows.length})`;
                    const toastId = sonnerToast.loading(
                      `Preparing ${format.toUpperCase()} export…`,
                      { description: scopeLabel }
                    );
                    try {
                      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                      const { cols, highlight } = cfgExportOpts;
                      const valueOf = (r: typeof rows[number], c: CfgExportCol): string => {
                        if (c === "key") return r.k;
                        if (c === "status") return r.status;
                        if (c === "before") return r.sBefore ?? "";
                        return r.sAfter ?? "";
                      };
                      let bytes = 0;
                      if (format === "csv") {
                        const delim = cfgExportOpts.csvDelimiter;
                        const csvEscape = csvEscapeFor(delim, cfgExportOpts.csvAlwaysQuote);
                        const header: string[] = [...cols];
                        if (highlight) header.push("match_start", "match_end", "match_text");
                        const lines = [header.map(csvEscape).join(delim)];
                        for (const r of rows) {
                          const m = highlight ? buildMatchSpan(r.k) : null;
                          const cells = cols.map((c) => csvEscape(valueOf(r, c)));
                          if (highlight) {
                            cells.push(
                              m ? csvEscape(String(m.start)) : "",
                              m ? csvEscape(String(m.end)) : "",
                              m ? csvEscape(r.k.slice(m.start, m.end)) : "",
                            );
                          }
                          lines.push(cells.join(delim));
                        }
                        // Excel hint: when delimiter ≠ comma, prepend "sep=…" so
                        // double-clicking opens with the right delimiter even on
                        // locales that default to comma.
                        const body = (delim === "," ? "" : `sep=${delim}\r\n`) + lines.join("\r\n");
                        const ext = delim === "\t" ? "tsv" : "csv";
                        const mime = delim === "\t"
                          ? "text/tab-separated-values;charset=utf-8"
                          : "text/csv;charset=utf-8";
                        bytes = triggerDownload(
                          `config-diff-${usePage ? `page${safePage + 1}-` : ""}${stamp}.${ext}`,
                          mime,
                          body,
                          { bom: cfgExportOpts.csvBom },
                        );
                      } else {
                        const payload = {
                          exportedAt: new Date().toISOString(),
                          filters: {
                            query: configKeyFilter,
                            regex: configKeyRegex,
                            sort: configKeySort,
                            status: Array.from(configStatusFilter),
                          },
                          options: { columns: cols, highlight, scope: cfgExportOpts.scope },
                          totals: {
                            all: cfgChanges.length,
                            filtered: allRows.length,
                            exported: rows.length,
                            page: usePage ? safePage + 1 : null,
                            pageSize: usePage ? CFG_PAGE_SIZE : null,
                          },
                          rows: rows.map((r) => {
                            const obj: Record<string, unknown> = {};
                            for (const c of cols) {
                              const k = c === "before" ? "before" : c === "after" ? "after" : c;
                              obj[k] = c === "before" ? r.sBefore : c === "after" ? r.sAfter : (r as any)[c === "key" ? "k" : c];
                            }
                            if (highlight) {
                              const m = buildMatchSpan(r.k);
                              obj.match = m ? { start: m.start, end: m.end, text: r.k.slice(m.start, m.end) } : null;
                            }
                            return obj;
                          }),
                        };
                        let json: string;
                        try { json = JSON.stringify(payload, null, 2); }
                        catch (e) { throw new Error(`Could not serialize JSON: ${(e as any)?.message ?? e}`); }
                        bytes = triggerDownload(
                          `config-diff-${usePage ? `page${safePage + 1}-` : ""}${stamp}.json`,
                          "application/json;charset=utf-8",
                          json,
                        );
                      }
                      const kb = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
                      sonnerToast.success(`Exported ${rows.length} ${rows.length === 1 ? "key" : "keys"}`, {
                        id: toastId,
                        description: `${format.toUpperCase()} · ${kb} · ${usePage ? `page ${safePage + 1}` : "all filtered"}`,
                      });
                    } catch (e) {
                      sonnerToast.error("Export failed", {
                        id: toastId,
                        description: String((e as any)?.message ?? e),
                      });
                    } finally {
                      setCfgExportBusy(null);
                    }
                  };
                  const filteredCfgCount = computeFilteredCfg().length;
                  const COL_LABELS: Record<CfgExportCol, string> = {
                    key: "Key",
                    status: "Status",
                    before: "Before value",
                    after: "After value",
                  };
                  const toggleCol = (c: CfgExportCol) => {
                    setCfgExportOpts((prev) => {
                      const has = prev.cols.includes(c);
                      const next = has ? prev.cols.filter((x) => x !== c) : [...prev.cols, c];
                      // Preserve canonical order
                      const order: CfgExportCol[] = ["key", "status", "before", "after"];
                      return { ...prev, cols: order.filter((x) => next.includes(x)) };
                    });
                  };
                  // Preset helpers
                  const savePreset = () => {
                    const name = cfgPresetName.trim();
                    if (!name) {
                      sonnerToast.warning("Name your preset", { description: "Enter a short name before saving." });
                      return;
                    }
                    setCfgPresets((prev) => {
                      const existing = prev.find((p) => p.name.toLowerCase() === name.toLowerCase());
                      const entry: CfgExportPreset = {
                        id: existing?.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                        name,
                        opts: cfgExportOpts,
                        updatedAt: Date.now(),
                      };
                      const out = existing
                        ? prev.map((p) => (p.id === existing.id ? entry : p))
                        : [...prev, entry];
                      sonnerToast.success(existing ? `Updated preset “${name}”` : `Saved preset “${name}”`);
                      return out.sort((a, b) => a.name.localeCompare(b.name));
                    });
                    setCfgPresetName("");
                  };
                  const applyPreset = (p: CfgExportPreset) => {
                    setCfgExportOpts({ ...DEFAULT_CFG_EXPORT_OPTS, ...p.opts });
                    sonnerToast.success(`Applied preset “${p.name}”`);
                  };
                  const deletePreset = (p: CfgExportPreset) => {
                    setCfgPresets((prev) => prev.filter((x) => x.id !== p.id));
                    sonnerToast.message(`Deleted preset “${p.name}”`);
                  };
                  // Detect whether current opts match a saved preset (deep-equal by JSON).
                  const currentOptsKey = JSON.stringify(cfgExportOpts);
                  const activePresetId = cfgPresets.find((p) => JSON.stringify(p.opts) === currentOptsKey)?.id ?? null;
                  return (
                    <>
                      <Dialog open={cfgExportOptsOpen} onOpenChange={setCfgExportOptsOpen}>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Export options</DialogTitle>
                            <DialogDescription>
                              Choose which columns and context to include in CSV/JSON exports of the diff list.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-medium text-foreground">Presets</div>
                                {activePresetId && (
                                  <span className="text-[10px] text-muted-foreground italic">
                                    matches “{cfgPresets.find((p) => p.id === activePresetId)?.name}”
                                  </span>
                                )}
                              </div>
                              {cfgPresets.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground italic">
                                  No saved presets yet. Configure the options below, give it a name, then click Save.
                                </p>
                              ) : (
                                <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                                  {cfgPresets.map((p) => {
                                    const active = p.id === activePresetId;
                                    return (
                                      <li
                                        key={p.id}
                                        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${active ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/40"}`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => applyPreset(p)}
                                          className="flex-1 text-left truncate hover:underline"
                                          title={`Apply preset: ${p.name}`}
                                          aria-label={`Apply preset ${p.name}`}
                                        >
                                          {p.name}
                                          <span className="ml-1 text-[10px] text-muted-foreground">
                                            · {p.opts.cols.length} cols · {p.opts.csvDelimiter === "\t" ? "tab" : p.opts.csvDelimiter} · {p.opts.scope}
                                          </span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (confirm(`Delete preset “${p.name}”?`)) deletePreset(p);
                                          }}
                                          className="text-[10px] px-1 py-0.5 rounded text-destructive hover:bg-destructive/10"
                                          aria-label={`Delete preset ${p.name}`}
                                          title="Delete preset"
                                        >
                                          ×
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div className="flex items-center gap-1.5 mt-2">
                                <input
                                  type="text"
                                  value={cfgPresetName}
                                  onChange={(e) => setCfgPresetName(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); savePreset(); } }}
                                  placeholder="Preset name…"
                                  className="flex-1 text-xs px-2 py-1 rounded border border-border/60 bg-background"
                                  aria-label="Preset name"
                                />
                                <button
                                  type="button"
                                  onClick={savePreset}
                                  disabled={!cfgPresetName.trim()}
                                  className="text-xs px-2 py-1 rounded border border-border/60 hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Save current
                                </button>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Saving with an existing name overwrites that preset.
                              </p>
                            </div>
                            <div className="border-t border-border/60 pt-3"></div>
                            <div>
                              <div className="text-xs font-medium mb-2 text-foreground">Columns</div>
                              <div className="space-y-2">
                                {(["key", "status", "before", "after"] as CfgExportCol[]).map((c) => {
                                  const checked = cfgExportOpts.cols.includes(c);
                                  return (
                                    <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={() => toggleCol(c)}
                                        aria-label={`Include ${COL_LABELS[c]} column`}
                                      />
                                      <span>{COL_LABELS[c]}</span>
                                    </label>
                                  );
                                })}
                                {cfgExportOpts.cols.length === 0 && (
                                  <p className="text-[11px] text-destructive">Select at least one column.</p>
                                )}
                              </div>
                            </div>
                            <div className="border-t border-border/60 pt-3">
                              <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={cfgExportOpts.highlight}
                                  onCheckedChange={(v) =>
                                    setCfgExportOpts((p) => ({ ...p, highlight: v === true }))
                                  }
                                  aria-label="Include highlight context"
                                />
                                <span className="space-y-0.5">
                                  <span className="block">Include highlight context</span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    Adds match offsets and matched text from your current search/regex filter.
                                  </span>
                                </span>
                              </label>
                            </div>
                            <div className="border-t border-border/60 pt-3">
                              <div className="text-xs font-medium mb-2 text-foreground">Scope</div>
                              <div className="space-y-2">
                                {([
                                  { v: "all" as const, label: "All filtered results", hint: `Export every row matching the current filters (${filteredCfgCount} ${filteredCfgCount === 1 ? "row" : "rows"}).` },
                                  { v: "page" as const, label: "Currently visible page only", hint: `Export only the rows on the current page — matches your “Rows per page” setting (${cfgPageSize}).` },
                                ]).map((opt) => (
                                  <label key={opt.v} className="flex items-start gap-2 text-sm cursor-pointer">
                                    <input
                                      type="radio"
                                      name="cfg-export-scope"
                                      className="mt-1 accent-primary"
                                      checked={cfgExportOpts.scope === opt.v}
                                      onChange={() => setCfgExportOpts((p) => ({ ...p, scope: opt.v }))}
                                    />
                                    <span className="space-y-0.5">
                                      <span className="block">{opt.label}</span>
                                      <span className="block text-[11px] text-muted-foreground">{opt.hint}</span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="border-t border-border/60 pt-3 space-y-3">
                              <div className="text-xs font-medium text-foreground">CSV options</div>
                              <div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">Field delimiter</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {([
                                    { v: "," as const, label: "Comma (,)" },
                                    { v: ";" as const, label: "Semicolon (;)" },
                                    { v: "\t" as const, label: "Tab (TSV)" },
                                  ]).map((opt) => {
                                    const active = cfgExportOpts.csvDelimiter === opt.v;
                                    return (
                                      <button
                                        key={opt.v}
                                        type="button"
                                        onClick={() => setCfgExportOpts((p) => ({ ...p, csvDelimiter: opt.v }))}
                                        aria-pressed={active}
                                        className={`text-xs px-2 py-1 rounded border ${active ? "bg-primary/15 border-primary/50 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                  Excel often expects semicolons in European locales. Tab produces a .tsv file.
                                  A <code className="font-mono">sep=…</code> hint is added automatically when needed.
                                </p>
                              </div>
                              <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={cfgExportOpts.csvBom}
                                  onCheckedChange={(v) =>
                                    setCfgExportOpts((p) => ({ ...p, csvBom: v === true }))
                                  }
                                  aria-label="Prepend UTF-8 BOM"
                                />
                                <span className="space-y-0.5">
                                  <span className="block">Prepend UTF-8 BOM</span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    Required for Excel to detect non-ASCII characters (accents, emoji, etc.) correctly.
                                  </span>
                                </span>
                              </label>
                              <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={cfgExportOpts.csvAlwaysQuote}
                                  onCheckedChange={(v) =>
                                    setCfgExportOpts((p) => ({ ...p, csvAlwaysQuote: v === true }))
                                  }
                                  aria-label="Always quote every field"
                                />
                                <span className="space-y-0.5">
                                  <span className="block">Always quote every field</span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    Forces RFC 4180 quoting on every cell. Useful for strict parsers; otherwise only fields containing the delimiter, quotes, newlines, or surrounding whitespace are quoted.
                                  </span>
                                </span>
                              </label>
                            </div>
                          </div>
                          <DialogFooter className="gap-2 sm:justify-between">
                            <button
                              type="button"
                              onClick={() => setCfgExportOpts(DEFAULT_CFG_EXPORT_OPTS)}
                              className="text-xs underline text-muted-foreground hover:text-foreground"
                            >
                              Reset to defaults
                            </button>
                            <Button size="sm" onClick={() => setCfgExportOptsOpen(false)}>Done</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      {cfgChanges.length > 0 && (
                        <div
                          role="alert"
                          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs space-y-1.5"
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Project settings will change ({cfgChanges.length})
                          </div>
                          <div className="text-muted-foreground">
                            Applying this import will modify the following Step 1 settings keys:
                          </div>
                          <ul className="space-y-1">
                            {overwriteKeys.length > 0 && (
                              <li className="flex flex-wrap items-baseline gap-1">
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                                  overwrite
                                </span>
                                <span className="text-muted-foreground">({overwriteKeys.length}):</span>
                                <span className="font-mono text-[11px] break-all">
                                  {overwriteKeys.join(", ")}
                                </span>
                              </li>
                            )}
                            {newKeys.length > 0 && (
                              <li className="flex flex-wrap items-baseline gap-1">
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 shrink-0">
                                  merge (new)
                                </span>
                                <span className="text-muted-foreground">({newKeys.length}):</span>
                                <span className="font-mono text-[11px] break-all">
                                  {newKeys.join(", ")}
                                </span>
                              </li>
                            )}
                            {removedKeys.length > 0 && (
                              <li className="flex flex-wrap items-baseline gap-1">
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-destructive/20 text-destructive shrink-0">
                                  unset
                                </span>
                                <span className="text-muted-foreground">({removedKeys.length}):</span>
                                <span className="font-mono text-[11px] break-all">
                                  {removedKeys.join(", ")}
                                </span>
                              </li>
                            )}
                          </ul>
                          <details className="rounded border border-amber-500/30 bg-background/40">
                            <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              Choose keys to apply • before / after ({cfgChanges.length - excludedConfigKeys.size}/{cfgChanges.length} selected)
                            </summary>
                            <div className="px-2 pb-2 pt-1 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 pb-1">
                                <span className="text-[10px] text-muted-foreground">
                                  Untick a key to skip it. Removed keys can&apos;t be unset by import.
                                </span>
                                <div className="flex gap-2 text-[10px]">
                                  <button
                                    type="button"
                                    className="underline text-muted-foreground hover:text-foreground"
                                    onClick={() => setExcludedConfigKeys(new Set())}
                                  >
                                    Select all
                                  </button>
                                  <button
                                    type="button"
                                    className="underline text-muted-foreground hover:text-foreground"
                                    onClick={() => setExcludedConfigKeys(new Set(cfgChanges.filter(c => c.status !== "removed").map(c => c.k)))}
                                  >
                                    Select none
                                  </button>
                                </div>
                              </div>
                              <div className="relative pb-1">
                                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                <input
                                  ref={cfgFilterInputRef}
                                  type="search"
                                  value={configKeyFilter}
                                  onChange={(e) => setConfigKeyFilter(e.target.value)}
                                  placeholder={configKeyRegex ? "Regex pattern (e.g. ^story|theme$)" : "Filter keys… (press / to focus)"}
                                  aria-label="Filter incoming settings keys"
                                  title="Shortcuts: / focus search • Esc blur • r toggle regex • s/S cycle sort • 1/2/3 toggle new/changed/removed • 0 reset status"
                                  className="w-full h-7 pl-7 pr-16 rounded border border-border/60 bg-background/80 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                />
                                <button
                                  type="button"
                                  onClick={() => setConfigKeyRegex((v) => !v)}
                                  title={configKeyRegex ? "Switch to plain text filter" : "Use regular expression"}
                                  aria-label="Toggle regex filter"
                                  aria-pressed={configKeyRegex}
                                  className={`absolute right-7 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1 rounded border ${configKeyRegex ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                                >
                                  .*
                                </button>
                                {configKeyFilter && (
                                  <button
                                    type="button"
                                    onClick={() => setConfigKeyFilter("")}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground px-1"
                                    aria-label="Clear filter"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 pb-1 flex-wrap">
                                <span className="text-[10px] text-muted-foreground">Status:</span>
                                {(["new", "changed", "removed"] as const).map((s) => {
                                  const active = configStatusFilter.has(s);
                                  const count = cfgChanges.filter((c) => c.status === s).length;
                                  const tone = s === "new"
                                    ? (active ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-400" : "border-border/60 text-muted-foreground hover:text-foreground")
                                    : s === "removed"
                                    ? (active ? "bg-destructive/20 border-destructive/50 text-destructive" : "border-border/60 text-muted-foreground hover:text-foreground")
                                    : (active ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border/60 text-muted-foreground hover:text-foreground");
                                  return (
                                    <label
                                      key={s}
                                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${tone}`}
                                    >
                                      <Checkbox
                                        className="h-3 w-3"
                                        checked={active}
                                        onCheckedChange={(v) => {
                                          setConfigStatusFilter((prev) => {
                                            const out = new Set(prev);
                                            if (v === true) out.add(s); else out.delete(s);
                                            return out;
                                          });
                                        }}
                                        aria-label={`Show ${s} keys`}
                                      />
                                      <span className="uppercase">{s}</span>
                                      <span className="opacity-70">({count})</span>
                                    </label>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setConfigStatusFilter(new Set(["new", "changed", "removed"]))}
                                  className="text-[10px] underline text-muted-foreground hover:text-foreground ml-1"
                                >
                                  All
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5 pb-1 flex-wrap">
                                <span className="text-[10px] text-muted-foreground">Sort:</span>
                                {([
                                  { k: "status", label: "Type (new→removed)" },
                                  { k: "az", label: "A → Z" },
                                  { k: "za", label: "Z → A" },
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.k}
                                    type="button"
                                    onClick={() => setConfigKeySort(opt.k)}
                                    aria-pressed={configKeySort === opt.k}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${configKeySort === opt.k ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                                <div className="ml-auto flex items-center gap-1.5">
                                  <span
                                    className="text-[10px] text-muted-foreground tabular-nums"
                                    aria-live="polite"
                                  >
                                    {filteredCfgCount} / {cfgChanges.length}
                                  </span>
                                  {(["csv", "json"] as const).map((fmt) => {
                                    const busy = cfgExportBusy === fmt;
                                    const disabled = cfgExportBusy !== null || filteredCfgCount === 0;
                                    const label = busy ? "Exporting…" : `Export ${fmt.toUpperCase()}`;
                                    const tip = filteredCfgCount === 0
                                      ? "No rows to export — adjust filters"
                                      : fmt === "csv"
                                        ? "Download the currently filtered & sorted diff list as CSV"
                                        : "Download the currently filtered & sorted diff list as JSON (with match offsets)";
                                    return (
                                      <button
                                        key={fmt}
                                        type="button"
                                        onClick={() => exportCfgDiff(fmt)}
                                        disabled={disabled}
                                        aria-busy={busy}
                                        title={tip}
                                        aria-label={`Export filtered diff as ${fmt.toUpperCase()}`}
                                        className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() => setCfgExportOptsOpen(true)}
                                    title="Choose which columns and highlight context to include in exports"
                                    aria-label="Open export options"
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 inline-flex items-center gap-1"
                                  >
                                    <Settings2 className="w-3 h-3" />
                                    Options…
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigKeyFilter("");
                                      setConfigKeyRegex(false);
                                      setConfigKeySort("status");
                                      setConfigStatusFilter(new Set(["new", "changed", "removed"]));
                                    }}
                                    className="text-[10px] underline text-muted-foreground hover:text-foreground"
                                    aria-label="Clear all filters"
                                  >
                                    Clear all
                                  </button>
                                </div>
                              </div>
                              {(() => {
                                const raw = configKeyFilter.trim();
                                if (configKeyRegex && raw) {
                                  try { new RegExp(raw, "i"); }
                                  catch (e: any) {
                                    return (
                                      <div className="text-[10px] text-destructive italic px-1 py-2 font-mono">
                                        Invalid regex: {e?.message ?? "Invalid regex"}
                                      </div>
                                    );
                                  }
                                }
                                const filtered = computeFilteredCfg();
                                if (raw && filtered.length === 0) {
                                  return (
                                    <div className="text-[10px] text-muted-foreground italic px-1 py-2">
                                      No keys match “{configKeyFilter}”{configKeyRegex ? " (regex)" : ""}.
                                    </div>
                                  );
                                }
                                const totalPages = Math.max(1, Math.ceil(filtered.length / CFG_PAGE_SIZE));
                                const safePage = Math.min(cfgPage, totalPages - 1);
                                const pageStart = safePage * CFG_PAGE_SIZE;
                                const pageRows = filtered.slice(pageStart, pageStart + CFG_PAGE_SIZE);
                                return (
                                  <>
                                    {pageRows.map((c) => {
                                      const fmt = (s: string) => {
                                        if (s === undefined || s === "undefined") return "∅ (unset)";
                                        return s.length > 200 ? s.slice(0, 200) + "…" : s;
                                      };
                                      const badge =
                                        c.status === "new"
                                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                                          : c.status === "removed"
                                          ? "bg-destructive/20 text-destructive"
                                          : "bg-amber-500/20 text-amber-700 dark:text-amber-400";
                                      const removed = c.status === "removed";
                                      const checked = !removed && !excludedConfigKeys.has(c.k);
                                      const toggle = (next: boolean) => {
                                        if (removed) return;
                                        setExcludedConfigKeys((prev) => {
                                          const out = new Set(prev);
                                          if (next) out.delete(c.k); else out.add(c.k);
                                          return out;
                                        });
                                      };
                                      const renderKey = () => {
                                        const m = buildMatchSpan(c.k);
                                        if (!m) return c.k;
                                        return (
                                          <>
                                            {c.k.slice(0, m.start)}
                                            <mark className="bg-amber-300/60 dark:bg-amber-400/40 text-foreground rounded px-0.5">
                                              {c.k.slice(m.start, m.end)}
                                            </mark>
                                            {c.k.slice(m.end)}
                                          </>
                                        );
                                      };
                                      return (
                                        <label
                                          key={c.k}
                                          className={`flex gap-1.5 rounded border border-border/60 bg-background/60 p-1.5 ${removed ? "opacity-60" : "cursor-pointer hover:border-amber-500/40"}`}
                                        >
                                          <Checkbox
                                            className="mt-0.5"
                                            checked={checked}
                                            disabled={removed}
                                            onCheckedChange={(v) => toggle(v === true)}
                                            aria-label={removed ? `${c.k} (cannot be unset by import)` : `Apply change to ${c.k}`}
                                          />
                                          <div className="flex-1 space-y-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className={`text-[9px] uppercase px-1 py-0.5 rounded ${badge}`}>
                                                {c.status}
                                              </span>
                                              <code className="font-mono text-[11px] break-all">
                                                {renderKey()}
                                              </code>
                                              {!removed && !checked && (
                                                <span className="text-[9px] text-muted-foreground italic">skipped</span>
                                              )}
                                            </div>
                                            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
                                              <span className="text-muted-foreground">before</span>
                                              <code className="font-mono break-all bg-destructive/5 text-destructive/90 rounded px-1">
                                                {fmt(c.sBefore)}
                                              </code>
                                              <span className="text-muted-foreground">after</span>
                                              <code className={`font-mono break-all rounded px-1 ${checked ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "bg-muted/40 text-muted-foreground line-through"}`}>
                                                {fmt(c.sAfter)}
                                              </code>
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                    <div className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-border/40 flex-wrap">
                                      <span className="text-[10px] text-muted-foreground tabular-nums">
                                        Showing {pageStart + 1}–{pageStart + pageRows.length} of {filtered.length}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                          <span>Rows</span>
                                          <select
                                            value={cfgPageSize}
                                            onChange={(e) => setCfgPageSize(Number(e.target.value))}
                                            className="text-[10px] bg-background border border-border/60 rounded px-1 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                            aria-label="Rows per page"
                                          >
                                            {CFG_PAGE_SIZE_OPTIONS.map((n) => (
                                              <option key={n} value={n}>{n}</option>
                                            ))}
                                          </select>
                                        </label>
                                        {totalPages > 1 && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => setCfgPage((p) => Math.max(0, p - 1))}
                                              disabled={safePage === 0}
                                              className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                              aria-label="Previous page"
                                            >
                                              ‹ Prev
                                            </button>
                                            <span className="text-[10px] text-muted-foreground tabular-nums px-1">
                                              Page {safePage + 1} / {totalPages}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => setCfgPage((p) => Math.min(totalPages - 1, p + 1))}
                                              disabled={safePage >= totalPages - 1}
                                              className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                              aria-label="Next page"
                                            >
                                              Next ›
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </details>
                          <div className="text-[10px] text-muted-foreground pt-1 border-t border-amber-500/20">
                            Expand “Project settings” below for the full side-by-side panel.
                          </div>
                        </div>
                      )}
                    <div className="rounded-md border bg-muted/30 p-1 divide-y divide-border/50">
                      <Row
                        label="Chapters"
                        summary={
                          <span className="tabular-nums">
                            {incChapters.length}
                            {replacedChapters.length > 0 && (
                              <span className="ml-1 text-amber-600 dark:text-amber-400">
                                ({replacedChapters.length} replace)
                              </span>
                            )}
                            {newChapters.length > 0 && (
                              <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                                (+{newChapters.length} new)
                              </span>
                            )}
                          </span>
                        }
                      >
                        {incChapters.length === 0 ? (
                          <div className="text-muted-foreground italic">No chapters in this import.</div>
                        ) : (
                          <ul className="max-h-64 overflow-y-auto divide-y divide-border/40">
                            {incChapters.map((ch, i) => {
                              const isNew = !curIds.has(ch.id);
                              const incThumb =
                                (ch as any).imageUrl ||
                                (Array.isArray((ch as any).images) && (ch as any).images[0]?.url) ||
                                null;
                              const cur = isNew ? null : chapters.find((c) => c.id === ch.id);
                              const curThumb = cur
                                ? (cur as any).imageUrl ||
                                  (Array.isArray((cur as any).images) && (cur as any).images[0]?.url) ||
                                  null
                                : null;
                              const Thumb = ({ src, alt }: { src: string | null; alt: string }) =>
                                src ? (
                                  <img
                                    src={src}
                                    alt={alt}
                                    loading="lazy"
                                    className="w-10 h-10 object-cover rounded border bg-muted shrink-0"
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }}
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded border border-dashed bg-muted/40 flex items-center justify-center shrink-0">
                                    <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/60" />
                                  </div>
                                );
                              return (
                                <li key={ch.id} className="py-1.5 flex items-center gap-2">
                                  <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right shrink-0">{i + 1}.</span>
                                  {!isNew && (
                                    <>
                                      <Thumb src={curThumb} alt={`Current chapter ${i + 1}`} />
                                      <span className="text-muted-foreground text-[10px] shrink-0">→</span>
                                    </>
                                  )}
                                  <Thumb src={incThumb} alt={`Incoming chapter ${i + 1}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                                          isNew
                                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                            : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                        }`}
                                      >
                                        {isNew ? "new" : "replaces"}
                                      </span>
                                      <span className="truncate text-xs" title={ch.title || "(untitled)"}>
                                        {ch.title || <span className="italic text-muted-foreground">(untitled)</span>}
                                      </span>
                                    </div>
                                    {!isNew && cur && cur.title && cur.title !== ch.title && (
                                      <div className="text-[10px] text-muted-foreground truncate" title={cur.title}>
                                        was: {cur.title}
                                      </div>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </Row>
                      <Row
                        label="Sources"
                        summary={
                          <span className="tabular-nums">
                            {incSources.length}
                            {dupSources.length > 0 && (
                              <span className="ml-1 text-muted-foreground">({dupSources.length} dup)</span>
                            )}
                            {newSources.length > 0 && (
                              <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                                (+{newSources.length} new)
                              </span>
                            )}
                          </span>
                        }
                      >
                        {incSources.length === 0 ? (
                          <div className="text-muted-foreground italic">No sources in this import.</div>
                        ) : (
                          <ul className="max-h-40 overflow-y-auto space-y-0.5">
                            {incSources.map((s: any, i) => {
                              const dup = s.url && curUrls.has(s.url);
                              return (
                                <li key={i} className="flex items-center gap-2">
                                  <span
                                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded shrink-0 ${
                                      dup
                                        ? "bg-muted text-muted-foreground"
                                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                    }`}
                                  >
                                    {dup ? "dup" : "new"}
                                  </span>
                                  <span className="truncate flex-1" title={s.url || s.title || ""}>
                                    {s.title || s.url || <span className="italic text-muted-foreground">(untitled)</span>}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </Row>
                      <Row
                        label="Asset links"
                        summary={<span className="tabular-nums">{incAssets.length}</span>}
                      >
                        {incAssets.length === 0 ? (
                          <div className="text-muted-foreground italic">No assets linked.</div>
                        ) : (
                          <ul className="max-h-32 overflow-y-auto space-y-0.5 font-mono text-[10px]">
                            {incAssets.map((a: any, i) => (
                              <li key={i} className="truncate" title={a.url || ""}>
                                {a.url || "(no url)"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Row>
                      <Row
                        label="Reference image"
                        summary={
                          <span>
                            {inc.referenceImage
                              ? referenceImage
                                ? inc.referenceImage === referenceImage
                                  ? "unchanged"
                                  : "will replace"
                                : "will set"
                              : "—"}
                          </span>
                        }
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="text-muted-foreground text-[10px] uppercase">Current</div>
                            {referenceImage ? (
                              <img
                                src={referenceImage}
                                alt="Current reference"
                                className="w-full h-20 object-cover rounded border"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                              />
                            ) : (
                              <div className="h-20 rounded border border-dashed flex items-center justify-center text-muted-foreground text-[10px]">
                                none
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="text-muted-foreground text-[10px] uppercase">Incoming</div>
                            {inc.referenceImage ? (
                              <img
                                src={inc.referenceImage}
                                alt="Incoming reference"
                                className="w-full h-20 object-cover rounded border"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                              />
                            ) : (
                              <div className="h-20 rounded border border-dashed flex items-center justify-center text-muted-foreground text-[10px]">
                                none
                              </div>
                            )}
                          </div>
                        </div>
                      </Row>
                      <Row
                        label="Storyline"
                        summary={
                          <span>
                            {inc.storyline
                              ? `${inc.storyline.length.toLocaleString()} chars${
                                  storyline ? ` (was ${storyline.length.toLocaleString()})` : ""
                                }`
                              : "—"}
                          </span>
                        }
                      >
                        {inc.storyline ? (
                          <div className="space-y-1.5">
                            {storyline && (
                              <div>
                                <div className="text-muted-foreground text-[10px] uppercase mb-0.5">Current preview</div>
                                <div className="rounded border bg-background/40 p-1.5 text-[11px] whitespace-pre-wrap">
                                  {summarize(storyline) || <span className="italic text-muted-foreground">(empty)</span>}
                                </div>
                              </div>
                            )}
                            <div>
                              <div className="text-muted-foreground text-[10px] uppercase mb-0.5">Incoming preview</div>
                              <div className="rounded border bg-background/40 p-1.5 text-[11px] whitespace-pre-wrap">
                                {summarize(inc.storyline) || <span className="italic text-muted-foreground">(empty)</span>}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted-foreground italic">No storyline in this import.</div>
                        )}
                      </Row>
                      <Row
                        label="Project settings"
                        summary={
                          <span className="tabular-nums">
                            {cfgChanges.length === 0 ? (
                              "no changes"
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">
                                {cfgChanges.length} change{cfgChanges.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        }
                      >
                        {cfgChanges.length === 0 ? (
                          <div className="text-muted-foreground italic">All config fields match the current project.</div>
                        ) : (
                          <ul className="max-h-48 overflow-y-auto space-y-1 font-mono text-[10px]">
                            {cfgChanges.map((c) => (
                              <li key={c.k} className="rounded border p-1.5 space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`uppercase px-1 py-0.5 rounded text-[9px] ${
                                      c.status === "new"
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                        : c.status === "removed"
                                        ? "bg-destructive/15 text-destructive"
                                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                    }`}
                                  >
                                    {c.status}
                                  </span>
                                  <span className="font-medium">{c.k}</span>
                                </div>
                                {c.status !== "new" && (
                                  <div className="text-muted-foreground break-all">
                                    <span className="text-[9px] uppercase mr-1">before</span>
                                    {c.sBefore?.length > 120 ? c.sBefore.slice(0, 120) + "…" : c.sBefore ?? "undefined"}
                                  </div>
                                )}
                                {c.status !== "removed" && (
                                  <div className="text-foreground break-all">
                                    <span className="text-[9px] uppercase mr-1">after</span>
                                    {c.sAfter?.length > 120 ? c.sAfter.slice(0, 120) + "…" : c.sAfter ?? "undefined"}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Row>
                    </div>
                    </>
                  );
                })()}

                {pendingImport?.referenceImage && (
                  <div className="flex items-center gap-3 rounded-md border p-2">
                    <img
                      src={pendingImport.referenceImage}
                      alt="Reference"
                      className="w-14 h-14 object-cover rounded"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                    />
                    <div className="text-xs text-muted-foreground break-all flex-1">
                      {pendingImport.referenceImage}
                    </div>
                  </div>
                )}

                {pendingImport && pendingImport.chapters.length > 0 && (
                  <details className="rounded-md border bg-muted/20 group">
                    <summary className="cursor-pointer select-none px-2.5 py-1.5 text-xs font-medium flex items-center justify-between hover:bg-muted/40 rounded-md">
                      <span>Restored chapters ({pendingImport.chapters.length})</span>
                      <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="max-h-56 overflow-y-auto divide-y divide-border/60 px-2 py-1">
                      {pendingImport.chapters.map((ch, i) => {
                        const thumb = ch.imageUrl || (Array.isArray(ch.images) && ch.images[0]?.url) || null;
                        return (
                          <li key={ch.id} className="flex items-center gap-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right shrink-0">{i + 1}.</span>
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                className="w-8 h-8 object-cover rounded border shrink-0 bg-muted"
                                loading="lazy"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }}
                              />
                            ) : (
                              <div className="w-8 h-8 rounded border border-dashed bg-muted/40 flex items-center justify-center shrink-0">
                                <ImageIcon className="w-3 h-3 text-muted-foreground/60" />
                              </div>
                            )}
                            <span className="text-xs truncate flex-1" title={ch.title || "(untitled chapter)"}>
                              {ch.title || <span className="italic text-muted-foreground">(untitled)</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}

                {pendingImport && pendingImport.migrationNotes.length > 0 && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs space-y-0.5">
                    <div className="font-medium text-amber-600 dark:text-amber-400">Migration notes</div>
                    {pendingImport.migrationNotes.map((n, i) => (
                      <div key={i}>• {n}</div>
                    ))}
                  </div>
                )}

                {pendingImport && pendingImport.originalSchemaVersion < pendingImport.schemaVersion && (() => {
                  const entries = getSchemaChangelog(pendingImport.originalSchemaVersion, pendingImport.schemaVersion);
                  if (entries.length === 0) return null;
                  return (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs space-y-2">
                      <div className="font-medium text-primary">
                        Planned auto-upgrade ({entries.length} step{entries.length === 1 ? "" : "s"})
                      </div>
                      <ol className="space-y-2">
                        {entries.map((e, idx) => (
                          <li key={e.version} className="space-y-1">
                            <div className="font-medium flex items-center gap-1.5">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] tabular-nums shrink-0">
                                {idx + 1}
                              </span>
                              <span>
                                Step {idx + 1}: v{e.version - 1} → v{e.version}
                              </span>
                            </div>
                            <div className="text-muted-foreground pl-5">{e.title}</div>
                            <ul className="list-disc pl-9 space-y-0.5 text-muted-foreground">
                              {e.changes.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ol>
                      <div className="text-[11px] text-muted-foreground pt-1 border-t border-primary/20">
                        Migration runs in memory. Re-export to save in v{pendingImport.schemaVersion} format.
                      </div>
                    </div>
                  );
                })()}

                {pendingProbe && pendingProbe.loading && (
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-xs flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Probing {pendingProbe.total} asset URL{pendingProbe.total === 1 ? "" : "s"}…
                  </div>
                )}
                {pendingProbe && !pendingProbe.loading && (() => {
                  const probe = pendingProbe as Extract<typeof pendingProbe, { loading: false }>;
                  if (probe.broken.length === 0) {
                    if (probe.total === 0) return null;
                    return (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
                        ✓ All {probe.total} asset URL{probe.total === 1 ? "" : "s"} reachable.
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-destructive">
                          {probe.broken.length} unreachable URL{probe.broken.length === 1 ? "" : "s"}
                          <span className="text-muted-foreground font-normal"> of {probe.total} probed</span>
                        </div>
                        <button
                          type="button"
                          className="text-xs underline hover:text-foreground"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(probe.broken.join("\n"));
                              toast({ title: "Copied", description: `${probe.broken.length} broken URL${probe.broken.length === 1 ? "" : "s"} copied to clipboard.` });
                            } catch {
                              toast({ title: "Copy failed", description: "Clipboard access was blocked.", variant: "destructive" });
                            }
                          }}
                        >
                          Copy all
                        </button>
                      </div>
                      {probe.refBroken && (
                        <div className="text-amber-600 dark:text-amber-400">
                          ⚠ Reference image is unreachable — it will be cleared on import.
                        </div>
                      )}
                      <ul className="max-h-32 overflow-y-auto space-y-0.5">
                        {probe.broken.slice(0, 50).map((url) => (
                          <li key={url} className="flex items-center gap-1.5">
                            <code className="font-mono text-[10px] truncate flex-1" title={url}>{url}</code>
                            <button
                              type="button"
                              className="shrink-0 text-[10px] underline text-muted-foreground hover:text-foreground"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(url);
                                  toast({ title: "Copied" });
                                } catch {}
                              }}
                            >
                              copy
                            </button>
                          </li>
                        ))}
                        {probe.broken.length > 50 && (
                          <li className="text-muted-foreground">…and {probe.broken.length - 50} more (use Copy all)</li>
                        )}
                      </ul>
                      <div className="text-[11px] text-muted-foreground border-t border-destructive/20 pt-1.5">
                        Affected chapters will use a fallback image until you regenerate them.
                      </div>
                    </div>
                  );
                })()}

                {pendingImport && (() => {
                  const inc = pendingImport;
                  // Build a per-domain comparison: current value vs incoming.
                  // `replaces` flags whether existing data will actually be overwritten.
                  const rows: Array<{
                    label: string;
                    current: string;
                    incoming: string;
                    replaces: boolean;
                    note?: string;
                  }> = [
                    {
                      label: "Chapters",
                      current: `${chapters.length}`,
                      incoming: `${inc.chapters.length}`,
                      replaces: chapters.length > 0,
                      note: chapters.length > 0 ? "current chapters will be overwritten" : undefined,
                    },
                    {
                      label: "Sources",
                      current: `${sources.length}`,
                      incoming: `${inc.sources.length}`,
                      // Sources only get replaced when the import actually has sources.
                      replaces: sources.length > 0 && inc.sources.length > 0,
                      note: sources.length > 0 && inc.sources.length === 0 ? "kept (import has none)" : undefined,
                    },
                    {
                      label: "Reference image",
                      current: referenceImage ? "set" : "—",
                      incoming: inc.referenceImage ? "set" : "—",
                      replaces: !!referenceImage && inc.referenceImage !== undefined,
                    },
                    {
                      label: "Storyline",
                      current: storyline ? `${storyline.length.toLocaleString()} chars` : "—",
                      incoming: inc.storyline ? `${inc.storyline.length.toLocaleString()} chars` : "—",
                      replaces: !!storyline,
                    },
                    {
                      label: "Project settings",
                      current: `${Object.keys(config || {}).length} keys`,
                      incoming: `${Object.keys(inc.config || {}).length} keys`,
                      // Config is shallow-merged, not replaced — call that out.
                      replaces: false,
                      note: "merged on top of current settings",
                    },
                    {
                      label: "Project title",
                      current: (config as any)?.title || "—",
                      incoming: inc.title || "—",
                      replaces: false,
                      note: "title stays unless you rename later",
                    },
                  ];
                  const replacingCount = rows.filter((r) => r.replaces).length;
                  return (
                    <div className={`rounded-md border p-2 text-xs space-y-1.5 ${replacingCount > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/20"}`}>
                      <div className={`font-medium ${replacingCount > 0 ? "text-destructive" : ""}`}>
                        {replacingCount > 0
                          ? `Will replace ${replacingCount} of your current section${replacingCount === 1 ? "" : "s"}`
                          : "Nothing existing will be overwritten"}
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left font-normal py-0.5">Section</th>
                            <th className="text-right font-normal py-0.5">Current</th>
                            <th className="text-right font-normal py-0.5">Incoming</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.label} className="border-t border-border/40">
                              <td className="py-0.5 align-top">
                                <div className="flex items-center gap-1">
                                  {r.replaces && <span className="text-destructive" title="Will be overwritten">●</span>}
                                  <span>{r.label}</span>
                                </div>
                                {r.note && (
                                  <div className="text-muted-foreground italic text-[10px]">{r.note}</div>
                                )}
                              </td>
                              <td className="text-right tabular-nums py-0.5 align-top">{r.current}</td>
                              <td className={`text-right tabular-nums py-0.5 align-top font-medium ${r.replaces ? "text-destructive" : ""}`}>{r.incoming}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {chapters.length > 0 && (
                        <div className="text-destructive border-t border-destructive/30 pt-1.5">
                          ⚠ Save state will reset — this becomes a new project.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="!flex-col !items-stretch gap-2 sm:!flex-col sm:!items-stretch">
            {applyingImport && importProgress !== null && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-primary">Applying import…</span>
                  <span className="text-muted-foreground tabular-nums">
                    Step {Math.min(importProgress + 1, IMPORT_STEPS.length)} of {IMPORT_STEPS.length}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${((importProgress + 1) / IMPORT_STEPS.length) * 100}%` }}
                  />
                </div>
                <ol className="space-y-1">
                  {IMPORT_STEPS.map((label, idx) => {
                    const done = idx < importProgress;
                    const active = idx === importProgress;
                    return (
                      <li key={label} className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                          {done ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : active ? (
                            <Loader2 className="w-3 h-3 animate-spin text-primary" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                          )}
                        </span>
                        <span
                          className={
                            done
                              ? "text-muted-foreground line-through"
                              : active
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {pendingImport && (() => {
              const incIds = new Set((pendingImport.chapters ?? []).map((c) => c.id));
              const replacedCount = chapters.filter((c) => incIds.has(c.id)).length;
              const incomingStoryline = pendingImport.storyline ?? "";
              const storylineWillReplace = !!incomingStoryline && !!storyline && incomingStoryline !== storyline;
              if (replacedCount === 0 && !storylineWillReplace) return null;
              const parts: string[] = [];
              if (replacedCount > 0) {
                parts.push(`${replacedCount} existing chapter${replacedCount === 1 ? "" : "s"}`);
              }
              if (storylineWillReplace) {
                parts.push("the current storyline");
              }
              return (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs space-y-1.5">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={overwriteAck}
                      onCheckedChange={(v) => setOverwriteAck(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Confirm overwrite
                      </span>
                      <span className="block text-muted-foreground">
                        Applying this import will overwrite {parts.join(" and ")} in your current project. This action can’t be undone — tick to acknowledge.
                      </span>
                    </span>
                  </label>
                </div>
              );
            })()}
            {pendingImport && pendingImport.originalSchemaVersion !== pendingImport.schemaVersion && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={schemaOverrideAck}
                    onCheckedChange={(v) => setSchemaOverrideAck(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-amber-700 dark:text-amber-400">Override schema mismatch</span>
                    <span className="block text-muted-foreground">
                      This file is v{pendingImport.originalSchemaVersion} but the current build expects v{pendingImport.schemaVersion}. {strictSchemaImport ? "Strict mode is on — tick to allow this import." : "Strict mode is off — you may import without ticking, but mismatches can still cause data loss."}
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-muted-foreground cursor-pointer pt-1.5 border-t border-amber-500/20">
                  <Checkbox
                    checked={strictSchemaImport}
                    onCheckedChange={(v) => setStrictSchemaImport(v === true)}
                  />
                  <span>Always block schema-mismatched imports unless I override</span>
                </label>
              </div>
            )}
            {applyingImport && (
              <p role="status" aria-live="polite" className="text-xs text-muted-foreground text-right -mb-1">
                Applying in progress—please wait. Cancel is disabled until the import finishes.
              </p>
            )}
            {!applyingImport && importError && (
              <div
                ref={importErrorRef}
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive space-y-1 scroll-mt-4"
              >
                <div className="font-medium">Last apply failed</div>
                <div className="text-destructive/90 break-words">{importError}</div>
                <div className="text-muted-foreground">
                  The modal stayed open so you can adjust options and use “Retry apply”.
                </div>
                {lastFailedImport && (
                  <div className="pt-1">
                    <button
                      type="button"
                      className="underline text-destructive hover:text-destructive/80 font-medium"
                      onClick={() => {
                        // Close the modal but keep the error + failed-payload snapshot.
                        preserveImportErrorOnCloseRef.current = true;
                        setPendingImport(null);
                        // After the modal unmounts, scroll the import inputs into
                        // view, briefly highlight them, and offer a "Reopen review"
                        // toast that restores the failed payload for retry.
                        window.setTimeout(() => {
                          const el = document.getElementById("storyboard-import-inputs");
                          const target = (el?.nextElementSibling as HTMLElement | null) ?? el;
                          target?.scrollIntoView({ behavior: "smooth", block: "center" });
                          if (target) {
                            target.classList.add("ring-2", "ring-destructive", "ring-offset-2", "rounded-md");
                            window.setTimeout(() => {
                              target.classList.remove("ring-2", "ring-destructive", "ring-offset-2", "rounded-md");
                            }, 2400);
                          }
                          toast({
                            title: "Fix your import inputs",
                            description: "Update the file or pasted JSON, then reopen the review to retry the same import.",
                            action: (
                              <ToastAction
                                altText="Reopen import review"
                                onClick={() => {
                                  if (lastFailedImport) setPendingImport(lastFailedImport);
                                }}
                              >
                                Reopen review
                              </ToastAction>
                            ),
                          });
                        }, 80);
                      }}
                    >
                      Fix inputs & retry →
                    </button>
                    <span className="text-muted-foreground ml-2">
                      Jumps to Import / Paste JSON. Your failed payload is kept so you can retry.
                    </span>
                  </div>
                )}
                {importErrorDetails && (
                  <details className="mt-1 rounded border border-destructive/30 bg-background/40 p-2 text-[11px] text-foreground/90">
                    <summary className="cursor-pointer font-medium text-destructive select-none">
                      Show full error details
                    </summary>
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                        {importErrorDetails.phase && (
                          <>
                            <span className="text-muted-foreground">Phase:</span>
                            <code className="font-mono break-all">{importErrorDetails.phase}</code>
                          </>
                        )}
                        {importErrorDetails.name && (
                          <>
                            <span className="text-muted-foreground">Error:</span>
                            <code className="font-mono break-all">{importErrorDetails.name}</code>
                          </>
                        )}
                      </div>
                      {importErrorDetails.message && (
                        <div>
                          <div className="text-muted-foreground mb-0.5">Message</div>
                          <pre className="whitespace-pre-wrap break-words bg-muted/40 p-1.5 rounded font-mono text-[10px]">{importErrorDetails.message}</pre>
                        </div>
                      )}
                      {importErrorDetails.groupedIssues && importErrorDetails.groupedIssues.length > 0 && (
                        <div>
                          <div className="text-muted-foreground mb-0.5">Validation issues</div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {importErrorDetails.groupedIssues.map((g, i) => (
                              <div key={i} className="rounded border border-destructive/30 bg-destructive/5 p-1.5">
                                <div className="font-medium">📍 {g.section}</div>
                                {g.hint && <div className="text-muted-foreground italic">{g.hint}</div>}
                                <ul className="list-disc pl-4 mt-0.5">
                                  {g.issues.map((it, j) => (
                                    <li key={j}>
                                      <code className="font-mono text-[10px]">{it.path}</code>: {it.message}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {importErrorDetails.stack && (
                        <div>
                          <div className="text-muted-foreground mb-0.5">Stack trace</div>
                          <pre className="whitespace-pre-wrap break-all bg-muted/40 p-1.5 rounded font-mono text-[10px] max-h-48 overflow-y-auto">{importErrorDetails.stack}</pre>
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="text-[10px] underline text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            try {
                              const payload = JSON.stringify(importErrorDetails, null, 2);
                              void navigator.clipboard?.writeText(payload);
                              toast({ title: "Error details copied" });
                            } catch {
                              /* clipboard unavailable */
                            }
                          }}
                        >
                          Copy details
                        </button>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <AlertDialogCancel
                disabled={applyingImport}
                title={applyingImport ? 'Applying in progress—please wait' : undefined}
                aria-label={applyingImport ? 'Cancel disabled while applying import' : 'Cancel'}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={(() => {
                  if (applyingImport) return true;
                  if (!pendingImport) return true;
                  if (isImportBlocked({
                    strict: strictSchemaImport,
                    originalSchemaVersion: pendingImport.originalSchemaVersion,
                    schemaVersion: pendingImport.schemaVersion,
                    overrideAck: schemaOverrideAck,
                  })) return true;
                  const incIds = new Set((pendingImport.chapters ?? []).map((c) => c.id));
                  const willOverwriteChapters = chapters.some((c) => incIds.has(c.id));
                  const willOverwriteStoryline =
                    !!pendingImport.storyline && !!storyline && pendingImport.storyline !== storyline;
                  if ((willOverwriteChapters || willOverwriteStoryline) && !overwriteAck) return true;
                  return false;
                })()}
                onClick={async (e) => {
                  // Prevent the AlertDialog default close so we can keep the
                  // modal open until commitImport finishes.
                  e.preventDefault();
                  if (applyingImport) return;
                  // Prefer the snapshot of the previously-failed payload so a
                  // Retry still applies the same data even if input panels changed.
                  const data = (importError && lastFailedImport) ? lastFailedImport : pendingImport;
                  if (!data) return;
                  if (isImportBlocked({
                    strict: strictSchemaImport,
                    originalSchemaVersion: data.originalSchemaVersion,
                    schemaVersion: data.schemaVersion,
                    overrideAck: schemaOverrideAck,
                  })) {
                    return;
                  }
                  const incIds = new Set((data.chapters ?? []).map((c) => c.id));
                  const willOverwriteChapters = chapters.some((c) => incIds.has(c.id));
                  const willOverwriteStoryline =
                    !!data.storyline && !!storyline && data.storyline !== storyline;
                  if ((willOverwriteChapters || willOverwriteStoryline) && !overwriteAck) {
                    return;
                  }
                  setApplyingImport(true);
                  // Show step 0 immediately so the progress UI is visible from
                  // the first frame of a retry — even before commitImport ticks.
                  setImportProgress(0);
                  setImportError(null);
                  setImportErrorDetails(null);
                  try {
                    // Honour the per-key opt-out in the warning panel: drop any
                    // unticked config keys from data.config before merging.
                    const filteredConfig: Record<string, any> = {};
                    for (const [k, v] of Object.entries(data.config ?? {})) {
                      if (!excludedConfigKeys.has(k)) filteredConfig[k] = v;
                    }
                    const effective = { ...data, config: filteredConfig };
                    await Promise.resolve(commitImport(effective));
                    setPendingImport(null);
                    setLastFailedImport(null);
                  } catch (err: any) {
                    setLastFailedImport(data);
                    let summary = err?.message || "Something went wrong applying this storyboard. Your project was not changed.";
                    if (err instanceof StoryboardImportError && err.groupedIssues?.length) {
                      const sections = err.groupedIssues.map((g) => g.section).join(", ");
                      summary = `Couldn't apply sections: ${sections}. See toast for details.`;
                      toast({
                        title: "Import failed while applying",
                        description: (
                          <div className="space-y-2 text-xs max-h-64 overflow-y-auto">
                            <div className="text-muted-foreground">
                              These sections of your storyboard couldn't be applied:
                            </div>
                            {err.groupedIssues.map((g, i) => (
                              <div key={i} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                                <div className="font-medium">📍 {g.section}</div>
                                <div className="text-muted-foreground italic mb-1">{g.hint}</div>
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {g.issues.slice(0, 5).map((it, j) => (
                                    <li key={j}>
                                      <code className="font-mono text-[10px]">{it.path}</code>: {it.message}
                                    </li>
                                  ))}
                                  {g.issues.length > 5 && (
                                    <li className="text-muted-foreground">…and {g.issues.length - 5} more</li>
                                  )}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) as any,
                        variant: "destructive",
                      });
                    } else {
                      toast({
                        title: "Import failed while applying",
                        description: summary,
                        variant: "destructive",
                      });
                    }
                    // Keep the modal open so the user can review options and retry.
                    setImportError(summary);
                    setImportErrorDetails({
                      name: err?.name,
                      phase: err?.phase ?? (err instanceof StoryboardImportError ? "apply/validate" : err?.name),
                      message: err?.message ?? String(err),
                      stack: typeof err?.stack === "string" ? err.stack : undefined,
                      groupedIssues: err instanceof StoryboardImportError ? err.groupedIssues : undefined,
                      raw: (() => { try { return JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})); } catch { return undefined; } })(),
                    });
                  } finally {
                    setApplyingImport(false);
                    setImportProgress(null);
                  }
                }}
                aria-busy={applyingImport}
                aria-label={applyingImport ? "Applying import — please wait" : importError ? "Retry apply" : "Apply import"}
              >
                {applyingImport ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{importError ? "Retrying…" : "Applying…"}</>
                ) : importError ? (
                  "Retry apply"
                ) : (
                  "Apply import"
                )}
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pre-download JSON preview: schema, version, sizes, and a payload sample. */}
      <AlertDialog open={!!previewExport} onOpenChange={(open) => { if (!open) setPreviewExport(null); }}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Storyboard JSON preview</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {previewExport && (() => {
                  const json = JSON.stringify(previewExport.payload, null, 2);
                  const sizeKb = (json.length / 1024).toFixed(1);
                  const sample = json.length > 4000 ? json.slice(0, 4000) + "\n…\n[truncated — full file is downloaded]" : json;
                  return (
                    <>
                      <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                        <div className="flex justify-between"><span className="text-muted-foreground">Schema</span><span className="font-mono text-xs">{previewExport.payload.schema}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="font-medium tabular-nums">v{previewExport.payload.schemaVersion}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Chapters</span><span className="font-medium tabular-nums">{previewExport.exportedChapters.length}{previewExport.isPartial ? ` / ${chapters.length}` : ""}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Sources</span><span className="font-medium tabular-nums">{previewExport.dedupedSources.length}{previewExport.droppedDuplicates > 0 ? ` (−${previewExport.droppedDuplicates} dup)` : ""}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Asset links</span><span className="font-medium tabular-nums">{previewExport.assetUrls.size}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Reference image</span><span className="font-medium">{previewExport.payload.referenceImage ? "Yes" : "—"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">File size</span><span className="font-medium tabular-nums">{sizeKb} KB</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Filename</span><span className="font-mono text-xs truncate">{previewExport.filename}</span></div>
                      </div>
                      <div className="rounded-md border bg-background overflow-hidden">
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/30">Payload sample</div>
                        <pre className="text-[11px] leading-snug p-3 max-h-[40vh] overflow-auto font-mono">{sample}</pre>
                      </div>
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!previewExport) return;
                const { payload, filename } = previewExport;
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
                setPreviewExport(null);
                toast({ title: "Storyboard exported", description: `Downloaded ${filename}` });
              }}
            >
              Download JSON
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
