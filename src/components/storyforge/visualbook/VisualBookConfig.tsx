import { useRef, useCallback, useState } from "react";
import { useStoryForge } from "../StoryForgeContext";
import type { BookLanguage } from "../StoryForgeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import {
  Upload, X, User, Film, Palette, Monitor, Smartphone, ImageIcon, Languages, Terminal,
} from "lucide-react";
import { BackgroundMusicPicker } from "./BackgroundMusicPicker";
import { CostModePanel } from "./CostModePanel";
import { EbookDesignPicker } from "./EbookDesignPicker";
import { FormatPanel } from "./FormatPanel";
import { useUserTier } from "@/hooks/useUserTier";
import { UPLOAD_LIMITS, AiInputTooLargeError, assertMaxFileSize } from "@/lib/ai-input-limits";
import { oversizedToast } from "../AiOversizedBanner";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "unspecified", label: "Not specified" },
];

const AGE_OPTIONS = [
  { value: "child", label: "Child" },
  { value: "teenager", label: "Teenager" },
  { value: "young-adult", label: "Young Adult" },
  { value: "adult", label: "Adult" },
  { value: "middle-aged", label: "Middle-aged" },
  { value: "elderly", label: "Elderly" },
];

export function VisualBookConfig() {
  const { config, setConfig, referenceImage, setReferenceImage } = useStoryForge();
  const { t } = useI18n();
  const { toast } = useToast();
  const { tier } = useUserTier();
  const isPremium = tier === "premium";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const processReferenceFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    try {
      assertMaxFileSize("reference image", file, UPLOAD_LIMITS.referenceImageBytes);
    } catch (err) {
      if (err instanceof AiInputTooLargeError) {
        toast(oversizedToast(err, "Upload rejected"));
        return;
      }
      throw err;
    }
    const reader = new FileReader();
    reader.onload = () => setReferenceImage(reader.result as string);
    reader.readAsDataURL(file);
  }, [toast, setReferenceImage]);

  const handleReferenceUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processReferenceFile(file);
  }, [processReferenceFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processReferenceFile(file);
  }, [processReferenceFile]);

  // Helpers for the reference character metadata stored in config
  const refGender = (config as any).refGender || "unspecified";
  const refAge = (config as any).refAge || "";
  const refDetails = (config as any).refDetails || "";

  const setRefMeta = useCallback((key: string, value: string) => {
    setConfig((c: any) => ({ ...c, [key]: value }));
  }, [setConfig]);

  return (
    <>
      {/* Orientation toggle */}
      <div className="flex items-center justify-center gap-1 bg-card/80 border border-border/40 rounded-full p-0.5 mx-auto w-fit">
        <button
          onClick={() => setConfig((c) => ({ ...c, orientation: "landscape" }))}
          className={`p-1.5 rounded-full transition-all flex items-center gap-1 text-xs ${
            config.orientation === "landscape" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span className="pr-1">{t("visual.landscape")}</span>
        </button>
        <button
          onClick={() => setConfig((c) => ({ ...c, orientation: "portrait" }))}
          className={`p-1.5 rounded-full transition-all flex items-center gap-1 text-xs ${
            config.orientation === "portrait" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="pr-1">{t("visual.portrait")}</span>
        </button>
      </div>

      {/* Reference photo upload */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`glass-card p-4 sm:p-6 space-y-3 transition-colors border-2 border-dashed ${
          dragActive ? "border-primary bg-primary/10" : "border-transparent"
        }`}
      >
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("visual.refPhoto")}</p>
            <p className="text-xs text-muted-foreground">{t("visual.refPhotoDesc")}</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReferenceUpload} />
          {referenceImage ? (
            <Button variant="ghost" size="sm" onClick={() => { setReferenceImage(null); setConfig((c: any) => ({ ...c, useImageAsIs: false, refGender: undefined, refAge: undefined, refDetails: undefined })); }} className="gap-1 text-xs shrink-0">
              <X className="w-3 h-3" /> {t("visual.remove")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1 shrink-0">
              <Upload className="w-4 h-4" /> {t("visual.upload")}
            </Button>
          )}
        </div>
        {dragActive && (
          <p className="text-xs text-primary font-medium">Drop image here to set as reference</p>
        )}
        {referenceImage && (
          <div className="space-y-4">
            <div className="w-24 h-24 rounded-lg overflow-hidden border border-border/40">
              <img src={referenceImage} alt="Reference" className="w-full h-full object-cover" />
            </div>

            {/* Character details for reference image */}
            <div className="space-y-3 rounded-lg border border-border/40 bg-card/50 p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                <p className="text-sm font-medium">Character Details</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Describe the person in the reference photo so AI generates consistent images.
              </p>

              {/* Gender */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Gender</label>
                <div className="flex flex-wrap gap-1.5">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setRefMeta("refGender", opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        refGender === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Age range */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Age Range</label>
                <div className="flex flex-wrap gap-1.5">
                  {AGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setRefMeta("refAge", opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        refAge === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Additional details */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Additional Appearance Details</label>
                <Textarea
                  value={refDetails}
                  onChange={(e) => setRefMeta("refDetails", e.target.value)}
                  placeholder="e.g. Short brown hair, glasses, warm smile, wearing a blue jacket"
                  className="bg-background/50 text-sm min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
            </div>

            {/* Use image as-is toggle */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/50 p-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ImageIcon className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Use image as-is</p>
                  <p className="text-xs text-muted-foreground">Skip AI generation, use this image for all chapters</p>
                </div>
              </div>
              <Switch
                checked={config.useImageAsIs}
                onCheckedChange={(checked) => setConfig((c) => ({ ...c, useImageAsIs: checked }))}
                className="shrink-0"
              />
            </div>
          </div>
        )}
      </div>

      {/* Character description (only when no reference image) */}
      {!referenceImage && (
        <div className="glass-card p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">{t("visual.charDesc")}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("visual.charDescHint")}</p>
          <Input
            placeholder={t("visual.charPlaceholder")}
            value={config.characterDescription}
            onChange={(e) => setConfig((c) => ({ ...c, characterDescription: e.target.value }))}
            className="bg-card/50"
          />
        </div>
      )}

      {/* Image style selector */}
      {!config.useImageAsIs && (
        <div className="glass-card p-4 sm:p-6 space-y-3">
          <p className="text-sm font-medium">{t("visual.imageStyle")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setConfig((c) => ({ ...c, imageStyle: "cinematic" as const }))}
              className={`flex items-center gap-3 rounded-lg border-2 p-3 sm:p-4 transition-all text-left ${
                config.imageStyle === "cinematic"
                  ? "border-primary bg-primary/5 glow-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <Film className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("visual.cinematic")}</p>
                <p className="text-xs text-muted-foreground">{t("visual.cinematicDesc")}</p>
              </div>
            </button>
            <button
              onClick={() => setConfig((c) => ({ ...c, imageStyle: "animated" as const }))}
              className={`flex items-center gap-3 rounded-lg border-2 p-3 sm:p-4 transition-all text-left ${
                config.imageStyle === "animated"
                  ? "border-primary bg-primary/5 glow-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <Palette className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("visual.animated")}</p>
                <p className="text-xs text-muted-foreground">{t("visual.animatedDesc")}</p>
              </div>
            </button>
        </div>

          {/* Raw Prompt Mode — Premium only */}
          {isPremium && (
            <div className="flex items-center justify-between pt-2 border-t border-border/30">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-500" />
                <div>
                  <p className="text-sm font-medium">Raw Prompt Mode</p>
                  <p className="text-xs text-muted-foreground">Send prompts directly without style wrappers</p>
                </div>
              </div>
              <Switch
                checked={!!config.rawPromptMode}
                onCheckedChange={(v) => setConfig((c: any) => ({ ...c, rawPromptMode: v }))}
              />
            </div>
          )}
        </div>
      )}

      {/* Language toggle */}
      <div className="glass-card p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Languages className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Book Language</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Translate all chapters, narration, and exports into a South African language. Original text is preserved and can be restored by switching back.
        </p>
        <div className="flex items-center justify-center gap-1 bg-card/80 border border-border/40 rounded-full p-0.5 mx-auto w-fit flex-wrap">
          {([
            { code: "en" as BookLanguage, flag: "🇬🇧", label: "English" },
            { code: "af" as BookLanguage, flag: "🇿🇦", label: "Afrikaans" },
            { code: "zu" as BookLanguage, flag: "🇿🇦", label: "isiZulu" },
            { code: "xh" as BookLanguage, flag: "🇿🇦", label: "isiXhosa" },
            { code: "st" as BookLanguage, flag: "🇿🇦", label: "Sesotho" },
            { code: "ar" as BookLanguage, flag: "🇸🇦", label: "العربية" },
          ]).map((lang) => (
            <button
              key={lang.code}
              onClick={() => setConfig((c) => ({ ...c, bookLanguage: lang.code }))}
              className={`px-3 py-1.5 rounded-full transition-all text-xs font-medium ${
                config.bookLanguage === lang.code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {lang.flag} {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background Music */}
      <BackgroundMusicPicker />

      {/* eBook Design */}
      <EbookDesignPicker />

      {/* Multi-image format & preview controls (Phase B) */}
      <FormatPanel />

      <CostModePanel />
    </>
  );
}
