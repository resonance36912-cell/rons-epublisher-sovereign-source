import { useStoryForge } from "../StoryForgeContext";
import { LayoutGrid, Maximize2, Sparkles, PlayCircle } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/**
 * Phase B — global format & preview controls applied to PDF, HTML eBook,
 * MP4 video and ePub. Per-chapter layout is set in the chapter editor;
 * this panel controls *how* multi-image layouts render in exports.
 */
export function FormatPanel() {
  const { config, setConfig } = useStoryForge();
  const gap = config.imageGap ?? 6;
  const fit = config.imageFit ?? "cover";
  const pageFit = config.imagePageFit ?? "standard";
  const autoplay = config.carouselAutoplay ?? false;
  const autoplaySec = config.carouselAutoplaySec ?? 4;
  const autoplayReverse = config.carouselAutoplayReverse ?? false;
  const indicator = config.carouselAutoplayIndicator ?? "ring";

  return (
    <div className="glass-card p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium">Image Format & Preview</p>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        These settings apply to multi-image chapters in the PDF, HTML eBook, MP4 video and ePub exports.
      </p>

      {/* Image gap */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="font-medium text-muted-foreground">Image gap</label>
          <span className="font-mono">{gap}px</span>
        </div>
        <Slider
          min={0}
          max={24}
          step={1}
          value={[gap]}
          onValueChange={([v]) => setConfig((c) => ({ ...c, imageGap: v }))}
        />
        <p className="text-[11px] text-muted-foreground">Spacing between images in stack/grid/hero layouts.</p>
      </div>

      {/* Image fit */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Image fit
        </label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "cover", label: "Cover (fill, may crop)" },
            { id: "contain", label: "Contain (no crop)" },
          ] as const).map((o) => (
            <button
              key={o.id}
              onClick={() => setConfig((c) => ({ ...c, imageFit: o.id }))}
              className={`px-3 py-2 rounded-lg border text-xs text-left transition-all ${
                fit === o.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Page fit (PDF/MP4) */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Maximize2 className="w-3 h-3" /> Page-fit (PDF & MP4)
        </label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: "compact", label: "Compact", hint: "More room for text" },
            { id: "standard", label: "Standard", hint: "Balanced" },
            { id: "full", label: "Full bleed", hint: "Image dominates" },
          ] as const).map((o) => (
            <button
              key={o.id}
              onClick={() => setConfig((c) => ({ ...c, imagePageFit: o.id }))}
              className={`px-2 py-2 rounded-lg border text-xs text-left transition-all ${
                pageFit === o.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <p className="font-medium">{o.label}</p>
              <p className="text-[10px] text-muted-foreground">{o.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Carousel autoplay (HTML eBook) */}
      <div className="space-y-3 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <PlayCircle className="w-3 h-3" /> Carousel autoplay (HTML eBook)
          </label>
          <Switch
            checked={autoplay}
            onCheckedChange={(v) => setConfig((c) => ({ ...c, carouselAutoplay: v }))}
            aria-label="Toggle carousel autoplay"
          />
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          When enabled, carousel-layout chapters auto-advance in the exported HTML and pause on hover.
        </p>
        {autoplay && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-muted-foreground">Advance every</label>
              <span className="font-mono">{autoplaySec}s</span>
            </div>
            <Slider
              min={1}
              max={15}
              step={1}
              value={[autoplaySec]}
              onValueChange={([v]) => setConfig((c) => ({ ...c, carouselAutoplaySec: v }))}
            />
          </div>
        )}
        {autoplay && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Reverse direction</label>
              <p className="text-[11px] text-muted-foreground">Cycle right-to-left (recommended for RTL languages like Arabic).</p>
            </div>
            <Switch
              checked={autoplayReverse}
              onCheckedChange={(v) => setConfig((c) => ({ ...c, carouselAutoplayReverse: v }))}
              aria-label="Reverse carousel autoplay direction"
            />
          </div>
        )}
        {autoplay && (
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-medium text-muted-foreground block">Progress indicator</label>
            <div className="inline-flex rounded-md border border-border/50 overflow-hidden text-xs" role="radiogroup" aria-label="Autoplay progress indicator style">
              {(["ring", "bar"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={indicator === opt}
                  onClick={() => setConfig((c) => ({ ...c, carouselAutoplayIndicator: opt }))}
                  className={`px-3 py-1.5 transition-colors ${
                    indicator === opt
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {opt === "ring" ? "Ring around dot" : "Bar at bottom"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">How the autoplay countdown is shown over the carousel.</p>
          </div>
        )}
      </div>
    </div>
  );
}
