import { useState, useRef, useCallback, useEffect } from "react";
import { useStoryForge } from "./StoryForgeContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, ArrowRight, BookOpen, Monitor, Smartphone, Headphones, Mic2, Gauge, Play, Square, Loader2, Sparkles, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useUserTier } from "@/hooks/useUserTier";
import { getPreferredPlaybackProvider, isNarrationAbortError, requestNarrationAudio, setPreferredPlaybackProvider, speakWithBrowserNarration, stopBrowserNarration } from "@/lib/tts-client";
import { DEFAULT_BROWSER_VOICE, normalizeNarrationForTier } from "@/lib/narration-config";

const DEPTHS = [
  { value: "summary", label: "Summary", desc: "A concise overview of the key points" },
  { value: "standard", label: "Standard", desc: "Detailed coverage with clear narrative flow" },
  { value: "extensive", label: "Extensive", desc: "Deeply elaborate and comprehensive" },
];

const THEMES = [
  { value: "autobiography", label: "Autobiography" },
  { value: "documentary", label: "Documentary" },
  { value: "scientific", label: "Scientific Report" },
  { value: "fantasy", label: "Fantasy Story" },
  { value: "thriller", label: "Thriller / Action" },
  { value: "motivation", label: "Motivation / Inspiration" },
  { value: "professional", label: "Professional Profile" },
  { value: "adventure", label: "Adventure" },
  { value: "poetic", label: "Poetic" },
  { value: "philosophical", label: "Philosophical" },
];

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "academic", label: "Academic" },
  { value: "dramatic", label: "Dramatic" },
  { value: "inspirational", label: "Inspirational" },
];

const VOICE_OPTIONS = [
  { id: "JBFqnCBsd6RMkjVDRZzb", nameKey: "voice.george" },
  { id: "EXAVITQu4vr4xnSDxMaL", nameKey: "voice.sarah" },
  { id: "onwK4e9ZLuTAKqWW03F9", nameKey: "voice.daniel" },
  { id: "pFZP5JQG7iQjIQuC4Bku", nameKey: "voice.lily" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", nameKey: "voice.liam" },
  { id: "custom", nameKey: "voice.myVoice" },
];

const DEMEANOURS = [
  { value: "calm", labelKey: "demeanour.calm" },
  { value: "energetic", labelKey: "demeanour.energetic" },
  { value: "warm", labelKey: "demeanour.warm" },
  { value: "authoritative", labelKey: "demeanour.authoritative" },
  { value: "playful", labelKey: "demeanour.playful" },
];

export function ReviewConfigure() {
  const { sources, config, setConfig, setStep } = useStoryForge();
  const { t } = useI18n();
  const { toast } = useToast();
  const { tier } = useUserTier();
  const isFreeTier = tier === "free";
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Guardrail: whenever the tier flips (Premium ↔ Free) or a stale persisted
  // project loads, normalize narration settings so we never carry an
  // ElevenLabs voice/demeanour into a Free session and never leave Premium
  // with an empty voice id.
  useEffect(() => {
    const normalized = normalizeNarrationForTier(config, tier);
    if (normalized !== config) {
      setConfig((c) => ({ ...c, ...normalized }));
      if (isFreeTier && config.narrationProvider === "elevenlabs") {
        toast({
          title: "Switched to browser narration",
          description: "Free plan uses your device's browser voice. Your ElevenLabs voice was cleared.",
        });
      }
    }
  }, [tier, isFreeTier, config, setConfig, toast]);

  const playVoicePreview = useCallback(async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }

    if (isPlaying) {
      stopBrowserNarration();
      setIsPlaying(false);
      return;
    }

    // Resolve provider strictly from the active plan: Free always uses the
    // browser voice; Premium uses ElevenLabs only when the user has toggled
    // the Premium Narration switch on (otherwise still browser).
    const effectiveProvider: "browser" | "elevenlabs" =
      isFreeTier ? "browser" : config.narrationProvider === "elevenlabs" ? "elevenlabs" : "browser";

    if (effectiveProvider === "elevenlabs" && config.narrationVoice === "custom") {
      toast({ title: "Custom voice", description: "Record your voice in the Visual Book step" });
      return;
    }

    setIsLoading(true);
    try {
      const sampleText = "Hello, this is a preview of your selected narration voice. I hope you enjoy how it sounds!";
      const playWithBrowser = () => {
        setIsPlaying(true);
        void speakWithBrowserNarration(sampleText, { speed: config.narrationSpeed }).then(() => {
          setIsPlaying(false);
        }).catch((error) => {
          if (!isNarrationAbortError(error)) {
            toast({ title: "Preview failed", description: error.message || "Could not play voice preview", variant: "destructive" });
          }
          setIsPlaying(false);
        });
      };

      if (effectiveProvider === "browser" || getPreferredPlaybackProvider() === "browser") {
        playWithBrowser();
        return;
      }

      const result = await requestNarrationAudio({
        text: sampleText,
        voiceId: config.narrationVoice,
        speed: config.narrationSpeed,
      });

      if (result.kind === "fallback") {
        setPreferredPlaybackProvider("browser");
        toast({ title: "Using browser narration", description: "Voice service is busy, so preview switched to your browser voice for this session." });
        playWithBrowser();
        return;
      }

      const blob = result.blob;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setIsPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(url);
      };
      await audio.play();
      setIsPlaying(true);
    } catch (error: any) {
      if (!isNarrationAbortError(error)) {
        toast({ title: "Preview failed", description: error.message || "Could not play voice preview", variant: "destructive" });
      }
    } finally {
      setIsLoading(false);
    }
  }, [isFreeTier, config.narrationProvider, config.narrationVoice, config.narrationSpeed, isPlaying, toast]);

  // Provider the preview button will actually use, mirrored from playVoicePreview's
  // resolution logic so the on-screen label stays in sync with what plays.
  const previewProvider: "browser" | "elevenlabs" =
    isFreeTier ? "browser" : config.narrationProvider === "elevenlabs" ? "elevenlabs" : "browser";
  const previewProviderLabel = previewProvider === "elevenlabs" ? "ElevenLabs" : "Browser voice";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-2xl mx-auto space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-serif font-semibold">{t("configure.title")}</h2>
        <p className="text-muted-foreground">
          {t("configure.subtitle")}
        </p>
      </div>

      {/* Sources summary */}
      <div className="bg-card border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Evidence sources</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {sources.filter((s) => s.status === "ready").length} usable · {sources.filter((s) => s.status !== "ready").length} excluded/unavailable · {sources.length} retained for provenance
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStep(1)}>Manage sources</Button>
      </div>
      {config.researchBasis === "topic_only" && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-4 text-left" role="status">
          <h3 className="text-sm font-medium text-amber-300">Topic-only draft mode</h3>
          <p className="text-xs text-muted-foreground mt-1">
            No usable evidence source is grounding this draft. Excluded metadata remains provenance only; verify and source factual claims before publication.
          </p>
        </div>
      )}

      {/* Topic */}
      <div className="bg-card border rounded-lg p-4 space-y-1">
        <h3 className="text-sm font-medium">{t("configure.topic")}</h3>
        <p className="text-sm text-muted-foreground">{config.topic}</p>
      </div>

      {/* Theme & Tone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("configure.storyTheme")}</label>
          <Select value={config.theme} onValueChange={(v) => setConfig((c) => ({ ...c, theme: v }))}>
            <SelectTrigger className="bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((th) => (
                <SelectItem key={th.value} value={th.value}>{t(`theme.${th.value}`) !== `theme.${th.value}` ? t(`theme.${th.value}`) : th.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("home.tone")}</label>
          <Select value={config.tone} onValueChange={(v) => setConfig((c) => ({ ...c, tone: v }))}>
            <SelectTrigger className="bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((tn) => (
                <SelectItem key={tn.value} value={tn.value}>{t(`tone.${tn.value}`) !== `tone.${tn.value}` ? t(`tone.${tn.value}`) : tn.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Depth / Detail Level */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium">{t("home.detailLevel")}</label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DEPTHS.map((d) => (
            <button
              key={d.value}
              onClick={() => setConfig((c) => ({ ...c, depth: d.value as any }))}
              className={`text-left border rounded-lg p-4 transition-all ${
                config.depth === d.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <span className="text-sm font-semibold block">{t(`depth.${d.value}`) !== `depth.${d.value}` ? t(`depth.${d.value}`) : d.label}</span>
              <span className="text-xs text-muted-foreground mt-1 block">{d.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Candidate protocol: optional exact story-page specification */}
      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <div>
          <p className="text-sm font-medium">Pilot book specification</p>
          <p className="text-xs text-muted-foreground mt-1">Optional release constraints. Leave blank to use the governed depth limit only.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">Exact story pages
            <input type="number" min={1} max={config.depth === "summary" ? 6 : config.depth === "extensive" ? 20 : 12} value={config.targetStoryPages ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, targetStoryPages: e.target.value ? Math.min(c.depth === "summary" ? 6 : c.depth === "extensive" ? 20 : 12, Math.max(1, Number(e.target.value))) : undefined }))}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" placeholder="e.g. 6" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Min words / page
            <input type="number" min={1} value={config.storyPageMinWords ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, storyPageMinWords: e.target.value ? Math.max(1, Number(e.target.value)) : undefined }))}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" placeholder="e.g. 40" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Max words / page
            <input type="number" min={1} value={config.storyPageMaxWords ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, storyPageMaxWords: e.target.value ? Math.max(1, Number(e.target.value)) : undefined }))}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" placeholder="e.g. 70" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
          <div><p className="text-sm font-medium">Require an image on every story page</p><p className="text-xs text-muted-foreground">When enabled, export is blocked until each page has an image.</p></div>
          <Switch aria-label="Require image on every story page" checked={config.requireStoryPageImage === true} onCheckedChange={(checked) => setConfig((c) => ({ ...c, requireStoryPageImage: checked }))} />
        </div>
      </div>

      {/* Orientation */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium">{t("configure.bookOrientation")}</label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => setConfig((c) => ({ ...c, orientation: "landscape" }))}
            className={`flex items-center gap-3 border rounded-lg p-4 transition-all ${
              config.orientation === "landscape"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:border-primary/30"
            }`}
          >
            <Monitor className="w-5 h-5 text-primary shrink-0" />
            <div className="text-left">
              <span className="text-sm font-semibold block">{t("configure.landscape")}</span>
              <span className="text-xs text-muted-foreground">{t("configure.landscapeDesc")}</span>
            </div>
          </button>
          <button
            onClick={() => setConfig((c) => ({ ...c, orientation: "portrait" }))}
            className={`flex items-center gap-3 border rounded-lg p-4 transition-all ${
              config.orientation === "portrait"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:border-primary/30"
            }`}
          >
            <Smartphone className="w-5 h-5 text-primary shrink-0" />
            <div className="text-left">
              <span className="text-sm font-semibold block">{t("configure.portrait")}</span>
              <span className="text-xs text-muted-foreground">{t("configure.portraitDesc")}</span>
            </div>
          </button>
        </div>
      </div>

      {/* Narration Voice Settings */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium">{t("configure.narration")}</label>
        </div>

        {/* Plan → narration explainer: shows which voice engine each plan uses
            so users understand why the George (ElevenLabs) selector hides on Free. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className={`rounded-lg border p-3 transition-all ${
              isFreeTier
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card opacity-70"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mic2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold">Free plan</span>
              </div>
              {isFreeTier && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-primary">Active</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              Uses your <strong className="text-foreground">browser voice</strong> — built into your device, no credits, no AI voice selector.
            </p>
          </div>
          <div
            className={`rounded-lg border p-3 transition-all ${
              !isFreeTier
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card opacity-70"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-semibold">Premium plan</span>
              </div>
              {!isFreeTier && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-primary">Active</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              Unlocks <strong className="text-foreground">ElevenLabs AI voices</strong> (George, Sarah, Daniel…) with realistic narration.
            </p>
          </div>
        </div>

        {/* Premium narration toggle — controls whether ElevenLabs voice options are shown */}
        <div className={`flex items-center justify-between bg-card border rounded-lg p-4 ${isFreeTier ? "opacity-80" : ""}`}>
          <div className="flex items-center gap-3 min-w-0">
            {isFreeTier ? (
              <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
            )}
            <div className="min-w-0">
              <span className="text-sm font-semibold block">Premium Narration</span>
              <span className="text-xs text-muted-foreground block">
                {isFreeTier
                  ? "Locked on the Free plan — upgrade to unlock ElevenLabs AI voices like George."
                  : config.narrationProvider === "elevenlabs"
                    ? "Using ElevenLabs AI voices (uses credits)"
                    : "Using free browser speech synthesis — no credits required"}
              </span>
            </div>
          </div>
          <div
            // Click-through wrapper so a Free user who taps the disabled
            // toggle still gets a clear explanation toast (a disabled Radix
            // Switch swallows pointer events otherwise).
            onClick={() => {
              if (!isFreeTier) return;
              toast({
                title: "Premium narration is locked",
                description: "Upgrade from the Free plan to choose ElevenLabs voices.",
                variant: "destructive",
              });
            }}
            data-testid="premium-toggle-wrapper"
          >
            <Switch
              aria-label="Premium Narration"
              checked={!isFreeTier && config.narrationProvider === "elevenlabs"}
              disabled={isFreeTier}
              onCheckedChange={(checked) => {
                if (isFreeTier) return; // unreachable while disabled, kept for safety
                setConfig((c) => ({ ...c, narrationProvider: checked ? "elevenlabs" : "browser" }));
              }}
            />
          </div>
        </div>

        {!isFreeTier && config.narrationProvider === "elevenlabs" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Mic2 className="w-3 h-3" /> {t("configure.narrationVoice")}
              </label>
              <div className="flex gap-2">
                <Select value={config.narrationVoice} onValueChange={(v) => setConfig((c) => ({ ...c, narrationVoice: v }))}>
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_OPTIONS.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{t(v.nameKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  disabled={isLoading}
                  onClick={playVoicePreview}
                  title={isPlaying ? "Stop preview" : "Preview voice"}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-primary" />
                Preview via <strong className="text-foreground font-semibold">{previewProviderLabel}</strong>
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Headphones className="w-3 h-3" /> {t("configure.demeanour")}
              </label>
              <Select value={config.narrationDemeanour} onValueChange={(v) => setConfig((c) => ({ ...c, narrationDemeanour: v as any }))}>
                <SelectTrigger className="bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEMEANOURS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{t(d.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-muted/30 border border-dashed rounded-lg p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <Mic2 className="w-3 h-3 shrink-0" />
              <span className="min-w-0">Browser narration uses your device's built-in voice. Enable Premium above to choose an AI voice.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-muted-foreground hidden sm:inline-flex items-center gap-1">
                Preview via <strong className="text-foreground font-semibold">{previewProviderLabel}</strong>
              </span>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 h-8 w-8"
                disabled={isLoading}
                onClick={playVoicePreview}
                title={isPlaying ? "Stop preview" : `Preview voice (${previewProviderLabel})`}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Gauge className="w-3 h-3" /> {t("configure.narrationSpeed")} ({config.narrationSpeed.toFixed(1)}x)
          </label>
          <Slider
            value={[config.narrationSpeed]}
            onValueChange={([v]) => setConfig((c) => ({ ...c, narrationSpeed: v }))}
            min={0.7}
            max={1.2}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{t("configure.slower")}</span>
            <span>{t("configure.faster")}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> {t("nav.back")}
        </Button>
        <Button
          onClick={() => {
            // Final safety net: normalize once more right before generation
            // so any drift between tier change and submit can't leak through.
            const normalized = normalizeNarrationForTier(config, tier);
            if (normalized !== config) {
              setConfig((c) => ({ ...c, ...normalized }));
            }
            setStep(3);
          }}
          className="gap-2"
        >
          {t("configure.generateStoryboard")} <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}
