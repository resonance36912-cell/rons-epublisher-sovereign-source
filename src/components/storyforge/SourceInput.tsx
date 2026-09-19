import { useState, useRef, useCallback } from "react";
import { useStoryForge, type SlideChapter } from "./StoryForgeContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Sparkles, BookOpen, Globe, Youtube, Upload, FileText, Music, Video, X, Palette, Mic, Link, Plus, PenLine, Loader2, Wand2, BookCheck, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { SpeechToText } from "./SpeechToText";
import { useI18n } from "@/lib/i18n";
import { formatTextToChapters } from "@/lib/storyforge-api";
import {
  UPLOAD_LIMITS,
  AiInputTooLargeError,
  assertMaxFileSize,
  assertMaxMediaDuration,
} from "@/lib/ai-input-limits";
import { oversizedToast } from "./AiOversizedBanner";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

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

const DEPTHS = [
  { value: "summary", labelKey: "depth.summary" },
  { value: "standard", labelKey: "depth.standard" },
  { value: "extensive", labelKey: "depth.extensive" },
];

const ACCEPTED_TYPES = [
  ".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".csv", ".xlsx", ".xls",
  ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma",
  ".mp4", ".mov", ".avi", ".mkv", ".webm",
];

const TEXT_EXTS = new Set(["txt", "md", "csv", "rtf"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (AUDIO_EXTS.has(ext)) return Music;
  if (VIDEO_EXTS.has(ext)) return Video;
  return FileText;
}

export function SourceInput() {
  const { config, setConfig, sources, setSources, setChapters, setStep, setAsIsMode } = useStoryForge();
  const { toast } = useToast();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlSection, setShowUrlSection] = useState(false);
  const [showSpeechSection, setShowSpeechSection] = useState(false);
  const [showTextSection, setShowTextSection] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isFormatting, setIsFormatting] = useState(false);

  const handleFormatAndCreate = useCallback(async (content: string) => {
    if (!content.trim()) return;
    setIsFormatting(true);
    try {
      if (!config.topic) {
        setConfig((c) => ({ ...c, topic: content.slice(0, 100) }));
      }
      toast({ title: OPEN_NOVA_LOCAL_ONLY ? "Formatting locally…" : "Formatting your text…", description: OPEN_NOVA_LOCAL_ONLY ? "Open Nova is structuring your content without a cloud AI call" : "AI is structuring your content into chapters" });
      const chapters = await formatTextToChapters(content, config);
      setChapters(chapters);
      setSources((prev) => [...prev, {
        id: crypto.randomUUID(),
        type: "file" as const,
        title: `Formatted text (${content.slice(0, 30)}…)`,
        content,
        status: "ready" as const,
      }]);
      toast({ title: "Book formatted!", description: `${chapters.length} chapters created` });
      setTextInput("");
      setStep(4); // Jump to storyline/storyboard step
    } catch (err: any) {
      toast({ title: "Formatting failed", description: err.message, variant: "destructive" });
    } finally {
      setIsFormatting(false);
    }
  }, [config, setConfig, setChapters, setSources, setStep, toast]);

  const uploadedFiles = sources.filter((s) => s.type === "file");
  const urlSources = sources.filter((s) => s.type === "url");
  const canProceed = config.topic.trim().length > 0;

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const validFiles: File[] = [];
    for (const f of Array.from(files)) {
      try {
        assertMaxFileSize("source file", f, UPLOAD_LIMITS.sourceFileBytes);
        await assertMaxMediaDuration("recording", f, UPLOAD_LIMITS.mediaDurationSeconds);
        validFiles.push(f);
      } catch (err) {
        if (err instanceof AiInputTooLargeError) {
          toast(oversizedToast(err, "Upload rejected"));
          continue;
        }
        throw err;
      }
    }
    const newSources = await Promise.all(
      validFiles.map(async (file) => {
        let content = "";
        const ext = file.name.split(".").pop()?.toLowerCase() || "";

        if (TEXT_EXTS.has(ext)) {
          content = await file.text();
        } else {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          // Use chunked btoa to avoid call stack overflow on large files
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          content = `data:${file.type};base64,${btoa(binary)}`;
        }

        return {
          id: crypto.randomUUID(),
          type: "file" as const,
          title: file.name,
          content,
          status: "ready" as const,
        };
      })
    );
    setSources((prev) => [...prev, ...newSources]);
  }, [toast, setSources]);

  const removeSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, [setSources]);

  type UrlValidation = { ok: true; url: string } | { ok: false; title: string; description: string };
  const validateAndNormalizeUrl = useCallback((raw: string): UrlValidation => {
    let v = raw.trim().replace(/\s+/g, "");
    if (!v) return { ok: false, title: "Empty link", description: "Paste or type a web address before adding it." };

    // Reject dangerous schemes early
    const lower = v.toLowerCase();
    const badSchemes = ["javascript:", "data:", "file:", "blob:", "vbscript:", "about:"];
    if (badSchemes.some((s) => lower.startsWith(s))) {
      return { ok: false, title: "Unsupported link type", description: "Only http:// and https:// web pages can be used as sources." };
    }

    // Auto-prepend https:// if user pasted a bare domain (e.g. example.com/path)
    if (!/^https?:\/\//i.test(v)) {
      if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(v)) {
        v = `https://${v}`;
      } else {
        return { ok: false, title: "Invalid web address", description: "Links must start with http:// or https:// (e.g. https://example.com/article)." };
      }
    }

    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      return { ok: false, title: "Couldn't read that link", description: "That doesn't look like a valid web address. Check for typos or extra characters." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, title: "Unsupported protocol", description: "Only http and https links are supported." };
    }

    const host = parsed.hostname;
    if (!host || !host.includes(".") || host.endsWith(".")) {
      return { ok: false, title: "Invalid domain", description: `"${host || "(empty)"}" isn't a reachable domain name.` };
    }
    if (/^(localhost|127\.|0\.0\.0\.0|::1)/i.test(host)) {
      return { ok: false, title: "Local address blocked", description: "Local network addresses can't be fetched by the research engine." };
    }

    return { ok: true, url: parsed.toString() };
  }, []);

  const probeReachability = useCallback(async (url: string) => {
    if (OPEN_NOVA_LOCAL_ONLY) return false;
    // Best-effort browser-side probe. CORS will hide the real status, but a network
    // error (DNS / offline / blocked) will throw and we can warn the user.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  }, []);

  const addUrl = useCallback(async () => {
    const result = validateAndNormalizeUrl(urlInput);
    if (result.ok === false) {
      toast({ title: result.title, description: result.description, variant: "destructive" });
      return;
    }
    const url = result.url;
    if (urlSources.some((s) => s.title === url)) {
      toast({ title: "Already added", description: "This link is already in your sources list.", variant: "destructive" });
      return;
    }
    setSources((prev) => [...prev, {
      id: crypto.randomUUID(),
      type: "url" as const,
      title: url,
      status: "pending" as const,
    }]);
    setUrlInput("");

    const reachable = await probeReachability(url);
    if (!reachable) {
      toast({
        title: "Heads up — link may be unreachable",
        description: "We couldn't ping that page from your browser. The research engine will still try, but it may fail to parse if the site is offline or blocks crawlers.",
      });
    }
  }, [urlInput, urlSources, toast, setSources, validateAndNormalizeUrl, probeReachability]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center min-h-[70vh] max-w-3xl mx-auto text-center space-y-8"
    >
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {t("home.badge")}
        <ArrowRight className="w-3 h-3" />
      </motion.div>

      {/* Hero heading */}
      <div className="space-y-4">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight tracking-tight">
          {t("home.heading1")}{" "}
          <span className="gradient-text">{t("home.heading2")}</span>
        </h1>
        <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto leading-relaxed">
          {t("home.subtitle")}
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-3">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-glass-border bg-card/60 backdrop-blur-sm text-sm text-muted-foreground">
          <Globe className="w-4 h-4 text-accent" />
          {t("home.pill.internet")}
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-glass-border bg-card/60 backdrop-blur-sm text-sm text-muted-foreground">
          <Youtube className="w-4 h-4 text-destructive" />
          {t("home.pill.youtube")}
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-glass-border bg-card/60 backdrop-blur-sm text-sm text-muted-foreground">
          <Upload className="w-4 h-4 text-primary" />
          {t("home.pill.upload")}
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-glass-border bg-card/60 backdrop-blur-sm text-sm text-muted-foreground">
          <BookOpen className="w-4 h-4 text-primary" />
          {t("home.pill.auto")}
        </div>
      </div>

      {/* Main input area */}
      <div className="w-full max-w-2xl glass-card p-1.5 rounded-xl">
        <div className="relative flex flex-col sm:block gap-2">
          <Textarea
            placeholder={t("home.topicPlaceholder")}
            value={config.topic}
            onChange={(e) =>
              setConfig((c) => ({ ...c, topic: e.target.value }))
            }
            className="min-h-[56px] max-h-[120px] resize-none bg-card/50 border-0 sm:pr-28 text-base placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/50 rounded-lg"
          />
          <Button
            onClick={() => setStep(1)}
            disabled={!canProceed}
            className="w-full sm:w-auto sm:absolute sm:right-2 sm:top-1/2 sm:-translate-y-1/2 gap-2 glow-primary"
            size="lg"
          >
            {t("home.research")}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Skip research shortcut */}
      <div className="w-full max-w-2xl text-center">
        <p className="text-xs text-muted-foreground mb-2">{t("home.orSkipResearch")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStep(4)}
          disabled={!canProceed}
          className="gap-2"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t("home.generateStoryline")}
        </Button>
      </div>

      {/* Theme, Tone & Depth selectors */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="w-full max-w-2xl space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <Mic className="w-3 h-3" /> {t("home.tone")}
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

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" /> {t("home.detailLevel")}
            </label>
            <Select value={config.depth} onValueChange={(v) => setConfig((c) => ({ ...c, depth: v as "summary" | "standard" | "extensive" }))}>
              <SelectTrigger className="bg-card/60 border-glass-border text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPTHS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {t(d.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.div>

      {/* Research source policy must be chosen before the research step. */}
      <div className="w-full max-w-2xl rounded-xl border border-border/60 bg-card/40 p-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Research source policy</p>
            <p className="text-xs text-muted-foreground mt-1">
              Controls whether ePublisher may discover additional public-web sources or must use only material you supplied.
            </p>
          </div>
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        </div>
        <Select
          value={config.sourcePolicy || "supplied_only"}
          onValueChange={(v) => setConfig((c) => ({
            ...c,
            sourcePolicy: v as NonNullable<typeof c.sourcePolicy>,
          }))}
        >
          <SelectTrigger className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="supplied_only">Supplied sources only — no public discovery</SelectItem>
            <SelectItem value="supplementary_research">Supplementary public research permitted</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {config.sourcePolicy === "supplementary_research"
            ? "The next step may discover public web/YouTube candidates in addition to your supplied files and URLs."
            : "The next step will not run public discovery. Supplied URLs may still be fetched for extraction; supplied files remain local evidence."}
        </p>
      </div>

      {/* File Upload Area */}
      <div className="w-full max-w-2xl">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
            dragActive
              ? "border-primary bg-primary/10"
              : "border-border/50 bg-card/30 hover:border-primary/40 hover:bg-card/50"
          }`}
        >
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t("home.clickUpload")}</span>{" "}
            {t("home.dragDrop")}
          </p>
          <p className="text-xs text-muted-foreground/50 mt-1">
            PDF, DOCX, TXT, MP3, WAV, MP4, MOV and more
          </p>
        </div>

        {/* Uploaded files list */}
        <AnimatePresence>
          {uploadedFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 space-y-2"
            >
              {uploadedFiles.map((f) => {
                const Icon = getFileIcon(f.title);
                return (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    className="flex items-center gap-3 bg-card/60 border border-border/50 rounded-lg px-4 py-2.5"
                  >
                    <Icon className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm truncate flex-1 text-left">{f.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSource(f.id); }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                );
              })}
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-end pt-2"
              >
                <Button
                  onClick={(e) => { e.stopPropagation(); setStep(1); }}
                  disabled={!canProceed}
                  className="gap-2 glow-primary"
                >
                  {t("home.research")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* URL Links Section */}
      <div className="w-full max-w-2xl">
        {!showUrlSection ? (
          <button
            onClick={() => setShowUrlSection(true)}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
          >
            <Link className="w-4 h-4" />
            {t("home.addUrls")}
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Link className="w-3 h-3" /> {t("home.urlsLabel")}
              </label>
              <button
                onClick={() => setShowUrlSection(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("home.hide")}
              </button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/article"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted && /\s/.test(pasted)) {
                    e.preventDefault();
                    setUrlInput(pasted.trim().replace(/\s+/g, ""));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addUrl();
                  }
                }}
                className="bg-card/60 border-glass-border text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={addUrl}
                className="shrink-0"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* URL list */}
            <AnimatePresence>
              {urlSources.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-2"
                >
                  {urlSources.map((s) => (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      className="flex items-center gap-3 bg-card/60 border border-border/50 rounded-lg px-4 py-2.5"
                    >
                      <Globe className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-sm truncate flex-1 text-left">{s.title}</span>
                      <button
                        onClick={() => removeSource(s.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Type Your Own Content Section */}
      <div className="w-full max-w-2xl">
        {!showTextSection ? (
          <button
            onClick={() => setShowTextSection(true)}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
          >
            <PenLine className="w-4 h-4" />
            Type your own content
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <PenLine className="w-3 h-3" /> Type or paste your content
              </label>
              <button
                onClick={() => setShowTextSection(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("home.hide")}
              </button>
            </div>
            <Textarea
              placeholder="Type or paste your text here…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              className="min-h-[120px] resize-y bg-card/60 border-glass-border text-sm"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!textInput.trim() || isFormatting}
                onClick={() => {
                  const content = textInput.trim();
                  setSources((prev) => [...prev, {
                    id: crypto.randomUUID(),
                    type: "file" as const,
                    title: `Custom text (${content.slice(0, 30)}…)`,
                    content,
                    status: "ready" as const,
                  }]);
                  if (!config.topic) {
                    setConfig((c) => ({ ...c, topic: content.slice(0, 100) }));
                  }
                  setTextInput("");
                  setStep(2);
                }}
                className="gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                {t("configure.title") || "Configure"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!textInput.trim() || isFormatting}
                onClick={() => {
                  const content = textInput.trim();
                  if (!config.topic) {
                    setConfig((c) => ({ ...c, topic: content.slice(0, 100) }));
                  }
                  // Keep the full text exactly as-is — one chapter per paragraph group, no modifications
                  const paragraphs = content.split(/\n{2,}/).filter((s) => s.trim());
                  const MAX_CHAPTERS = 30;
                  const newChapters: SlideChapter[] = [];

                  if (paragraphs.length <= MAX_CHAPTERS) {
                    paragraphs.forEach((p, i) => newChapters.push({
                      id: crypto.randomUUID(),
                      title: `Chapter ${i + 1}`,
                      body: p.trim(),
                      imagePrompt: `A vivid scene illustrating: ${p.trim().slice(0, 80)}`,
                    }));
                  } else {
                    const chapterCount = Math.min(MAX_CHAPTERS, paragraphs.length);
                    const perChapter = Math.ceil(paragraphs.length / chapterCount);
                    for (let i = 0; i < chapterCount; i++) {
                      const chunk = paragraphs.slice(i * perChapter, (i + 1) * perChapter);
                      if (chunk.length === 0) break;
                      const body = chunk.map((p) => p.trim()).join("\n\n");
                      newChapters.push({
                        id: crypto.randomUUID(),
                        title: `Chapter ${i + 1}`,
                        body,
                        imagePrompt: `A vivid scene illustrating: ${body.slice(0, 80)}`,
                      });
                    }
                  }

                  if (newChapters.length === 0) {
                    newChapters.push({ id: crypto.randomUUID(), title: "Chapter 1", body: content, imagePrompt: `A vivid scene illustrating: ${content.slice(0, 80)}` });
                  }
                  setAsIsMode(true);
                  setChapters(newChapters);
                  setSources((prev) => [...prev, {
                    id: crypto.randomUUID(),
                    type: "file" as const,
                    title: `Story as-is (${content.slice(0, 30)}…)`,
                    content,
                    status: "ready" as const,
                  }]);
                  toast({ title: t("source.useAsIsDone"), description: `${newChapters.length} ${newChapters.length === 1 ? "chapter" : "chapters"} created` });
                  setTextInput("");
                  setStep(4); // Jump to Storyline step
                }}
                className="gap-2"
              >
                <BookCheck className="w-4 h-4" />
                {t("source.useAsIs")}
              </Button>
              <Button
                size="sm"
                disabled={!textInput.trim() || isFormatting}
                onClick={() => handleFormatAndCreate(textInput)}
                className="gap-2 glow-primary"
              >
                {isFormatting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Formatting…</>
                ) : (
                  <><Wand2 className="w-4 h-4" /> Format & Create Book</>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </div>


      <div className="w-full max-w-2xl">
        {!showSpeechSection ? (
          <button
            onClick={() => setShowSpeechSection(true)}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
          >
            <Mic className="w-4 h-4" />
            {t("home.speakTopic")}
          </button>
        ) : (
          <SpeechToText
            onTranscript={(text) => {
              setConfig((c) => ({
                ...c,
                topic: c.topic ? `${c.topic}\n\n${text}` : text,
              }));
            }}
            onSaveAndConfigure={() => setStep(2)}
            onFormatAndCreate={(text) => handleFormatAndCreate(text)}
            onUseAsIs={(content) => {
              if (!config.topic) {
                setConfig((c) => ({ ...c, topic: content.slice(0, 100) }));
              }
              const paragraphs = content.split(/\n{2,}/).filter((s) => s.trim());
              const MAX_CHAPTERS = 30;
              const newChapters: SlideChapter[] = [];

              if (paragraphs.length <= MAX_CHAPTERS) {
                paragraphs.forEach((p, i) => newChapters.push({
                  id: crypto.randomUUID(),
                  title: `Chapter ${i + 1}`,
                  body: p.trim(),
                  imagePrompt: `A vivid scene illustrating: ${p.trim().slice(0, 80)}`,
                }));
              } else {
                const chapterCount = Math.min(MAX_CHAPTERS, paragraphs.length);
                const perChapter = Math.ceil(paragraphs.length / chapterCount);
                for (let i = 0; i < chapterCount; i++) {
                  const chunk = paragraphs.slice(i * perChapter, (i + 1) * perChapter);
                  if (chunk.length === 0) break;
                  const body = chunk.map((p) => p.trim()).join("\n\n");
                  newChapters.push({
                    id: crypto.randomUUID(),
                    title: `Chapter ${i + 1}`,
                    body,
                    imagePrompt: `A vivid scene illustrating: ${body.slice(0, 80)}`,
                  });
                }
              }

              if (newChapters.length === 0) {
                newChapters.push({ id: crypto.randomUUID(), title: "Chapter 1", body: content, imagePrompt: `A vivid scene illustrating: ${content.slice(0, 80)}` });
              }
              setAsIsMode(true);
              setChapters(newChapters);
              setSources((prev) => [...prev, {
                id: crypto.randomUUID(),
                type: "file" as const,
                title: `Story as-is (${content.slice(0, 30)}…)`,
                content,
                status: "ready" as const,
              }]);
              toast({ title: t("source.useAsIsDone"), description: `${newChapters.length} ${newChapters.length === 1 ? "chapter" : "chapters"} created` });
              setStep(4);
            }}
            isFormatting={isFormatting}
          />
        )}
      </div>

      {/* Hint text */}
      <p className="text-xs text-muted-foreground/50">
        {t("home.hintText")}
      </p>
    </motion.div>
  );
}
