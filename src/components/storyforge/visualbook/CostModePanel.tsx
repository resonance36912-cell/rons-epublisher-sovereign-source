import { useEffect, useMemo, useState } from "react";
import { Coins, Sparkles, Zap, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getTtsMode, setTtsMode, getImageMode, setImageMode,
  type TtsMode, type ImageMode,
} from "@/lib/cost-mode";
import { EcoRoutingVerifier } from "./EcoRoutingVerifier";
import { FreeVsPremiumCompare } from "./FreeVsPremiumCompare";
import { useStoryForge } from "../StoryForgeContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

const TTS_MODES: TtsMode[] = ["auto", "eco", "premium"];
const IMG_MODES: ImageMode[] = ["auto", "draft", "premium"];

export function CostModePanel() {
  const [ttsMode, setTtsModeState] = useState<TtsMode>("auto");
  const [imageMode, setImageModeState] = useState<ImageMode>("auto");
  const [showCompare, setShowCompare] = useState(true);

  const { chapters } = useStoryForge();
  const isAdmin = useIsAdmin();

  useEffect(() => {
    setTtsModeState(getTtsMode());
    setImageModeState(getImageMode());
  }, []);

  // Live counts so the comparison shows the real cost for this batch.
  const { totalChars, totalImages } = useMemo(() => {
    let chars = 0;
    let imgs = 0;
    for (const ch of chapters || []) {
      chars += (ch?.body || "").length;
      const multi = Array.isArray(ch?.images) ? ch.images.length : 0;
      imgs += multi > 0 ? multi : 1; // at least one cover image per chapter
    }
    return { totalChars: chars, totalImages: imgs };
  }, [chapters]);

  const onFree = (m: TtsMode | ImageMode) => m === "eco" || m === "draft";

  return (
    <div className="rounded-lg border border-border/40 bg-card/60 backdrop-blur p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{FREE_PROMOTION_ACTIVE ? "Quality & Provider Preferences" : "Cost & Quality Preferences"}</h3>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
          <BarChart2 className="h-3 w-3" />
          {FREE_PROMOTION_ACTIVE ? "Compare provider quality" : "Compare free vs premium"}
          <Switch checked={showCompare} onCheckedChange={setShowCompare} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {FREE_PROMOTION_ACTIVE ? (
          <>All provider modes are included during the <strong>{FREE_PROMOTION.shortLabel.toLowerCase()}</strong>. <strong>Auto</strong> selects the best available governed provider and falls back locally when needed; usage is still metered internally for costing.</>
        ) : (
          <>Choose where to spend premium credits. <strong>Auto</strong> uses premium until 80% of monthly budget is spent, then transparently switches to free providers.</>
        )}
      </p>

      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Narration mode
        </Label>
        <div className="grid grid-cols-3 gap-1">
          {TTS_MODES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={ttsMode === m ? "default" : "outline"}
              className="h-8 text-xs capitalize"
              onClick={() => { setTtsModeState(m); setTtsMode(m); }}
            >
              {FREE_PROMOTION_ACTIVE && m === "premium" ? "enhanced" : m}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {ttsMode === "auto" && (FREE_PROMOTION_ACTIVE ? "Best available governed narration provider first; local/browser fallback if needed." : "Premium ElevenLabs by default; free chain at 80% monthly budget.")}
          {ttsMode === "eco" && (FREE_PROMOTION_ACTIVE ? "Prioritizes local/open narration providers for sovereign, low-cost operation." : "Always uses free providers (HuggingFace / browser). 100% savings.")}
          {ttsMode === "premium" && (FREE_PROMOTION_ACTIVE ? "Prioritizes enhanced AI narration quality; no payment is required during the promotion." : "Always uses ElevenLabs (consumes add-on credits when quota exhausted).")}
        </p>
        {showCompare && onFree(ttsMode) && (
          <FreeVsPremiumCompare surface="tts" units={totalChars} />
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1.5">
          <Zap className="h-3 w-3" /> Image mode
        </Label>
        <div className="grid grid-cols-3 gap-1">
          {IMG_MODES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={imageMode === m ? "default" : "outline"}
              className="h-8 text-xs capitalize"
              onClick={() => { setImageModeState(m); setImageMode(m); }}
            >
              {FREE_PROMOTION_ACTIVE && m === "premium" ? "enhanced" : m}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {imageMode === "auto" && (FREE_PROMOTION_ACTIVE ? "Best available governed image provider first; local/open fallback if needed." : "Premium Gemini by default; free chain at 80% monthly budget.")}
          {imageMode === "draft" && (FREE_PROMOTION_ACTIVE ? "Prioritizes fast local/open image generation; you can re-render individual images for enhanced quality." : "Always uses Pollinations (free). Re-render individual images on demand for premium quality.")}
          {imageMode === "premium" && (FREE_PROMOTION_ACTIVE ? "Prioritizes enhanced image quality; no payment is required during the promotion." : "Always uses Gemini Image (consumes add-on credits when quota exhausted).")}
        </p>
        {showCompare && onFree(imageMode) && (
          <FreeVsPremiumCompare surface="image" units={totalImages} />
        )}
      </div>

      {/* Diagnostic surface — only meaningful for administrators. */}
      {isAdmin && <EcoRoutingVerifier />}
    </div>
  );
}
