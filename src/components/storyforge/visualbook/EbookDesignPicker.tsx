import { useCallback, useState } from "react";
import { useStoryForge } from "../StoryForgeContext";
import { DesignMiniPreview } from "./DesignMiniPreview";
import {
  EBOOK_DESIGN_PRESETS,
  EBOOK_FONTS,
  EBOOK_COLOR_SCHEMES,
  type EbookDesignPreset,
  type EbookFontFamily,
  type EbookLayoutStyle,
} from "../StoryForgeContext";
import { resolveDesign, isDarkBg } from "@/lib/ebook-design";
import { Check, Palette, Type, Layout, Sparkles, Eye, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const LAYOUT_OPTIONS: { id: EbookLayoutStyle; label: string; description: string }[] = [
  { id: "classic", label: "Classic", description: "Text above, image below" },
  { id: "full-bleed", label: "Full Bleed", description: "Full-page images with text overlay" },
  { id: "side-by-side", label: "Side by Side", description: "Image and text in two columns" },
  { id: "overlay", label: "Overlay", description: "Text overlaid on dimmed image" },
];

/** Mini layout wireframe SVG */
function LayoutPreview({ layout, active }: { layout: EbookLayoutStyle; active: boolean }) {
  const stroke = active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
  const fill = active ? "hsl(var(--primary) / 0.15)" : "hsl(var(--muted) / 0.3)";
  return (
    <svg viewBox="0 0 60 40" className="w-full h-auto">
      {layout === "classic" && (
        <>
          <rect x="5" y="3" width="50" height="4" rx="1" fill={stroke} opacity={0.6} />
          <rect x="5" y="9" width="50" height="4" rx="1" fill={stroke} opacity={0.3} />
          <rect x="5" y="17" width="50" height="20" rx="2" fill={fill} stroke={stroke} strokeWidth={0.5} />
        </>
      )}
      {layout === "full-bleed" && (
        <>
          <rect x="2" y="2" width="56" height="36" rx="2" fill={fill} stroke={stroke} strokeWidth={0.5} />
          <rect x="8" y="26" width="30" height="3" rx="1" fill={stroke} opacity={0.8} />
          <rect x="8" y="31" width="20" height="2" rx="1" fill={stroke} opacity={0.4} />
        </>
      )}
      {layout === "side-by-side" && (
        <>
          <rect x="2" y="2" width="26" height="36" rx="2" fill={fill} stroke={stroke} strokeWidth={0.5} />
          <rect x="32" y="4" width="24" height="3" rx="1" fill={stroke} opacity={0.6} />
          <rect x="32" y="10" width="24" height="2" rx="1" fill={stroke} opacity={0.3} />
          <rect x="32" y="14" width="24" height="2" rx="1" fill={stroke} opacity={0.3} />
          <rect x="32" y="18" width="18" height="2" rx="1" fill={stroke} opacity={0.3} />
        </>
      )}
      {layout === "overlay" && (
        <>
          <rect x="2" y="2" width="56" height="36" rx="2" fill={fill} stroke={stroke} strokeWidth={0.5} />
          <rect x="5" y="5" width="50" height="30" rx="1.5" fill={stroke} opacity={0.08} />
          <rect x="10" y="14" width="30" height="4" rx="1" fill={stroke} opacity={0.8} />
          <rect x="10" y="20" width="40" height="2" rx="1" fill={stroke} opacity={0.4} />
          <rect x="10" y="24" width="35" height="2" rx="1" fill={stroke} opacity={0.4} />
        </>
      )}
    </svg>
  );
}

/** Mini preview card for a design preset */
function PresetCard({
  preset,
  active,
  onClick,
}: {
  preset: (typeof EBOOK_DESIGN_PRESETS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const colors = EBOOK_COLOR_SCHEMES.find((c) => c.id === preset.colorSchemeId);
  const font = EBOOK_FONTS.find((f) => f.id === preset.font);

  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl border-2 p-3 transition-all text-left w-full ${
        active
          ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
          : "border-border/40 hover:border-primary/40 bg-card/50"
      }`}
    >
      {active && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
          <Check className="w-3 h-3 text-primary-foreground" />
        </div>
      )}
      {/* Mini book preview */}
      <div
        className="rounded-lg h-20 mb-2 flex items-center justify-center overflow-hidden border border-border/20"
        style={{ backgroundColor: colors?.bg ?? "#fff" }}
      >
        <div className="text-center px-3">
          <p
            style={{
              fontFamily: font?.cssFamily ?? "serif",
              color: colors?.accent ?? "#333",
              fontSize: "13px",
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            {preset.label}
          </p>
          <p
            style={{
              fontFamily: font?.cssFamily ?? "serif",
              color: colors?.text ?? "#333",
              fontSize: "8px",
              marginTop: "4px",
              lineHeight: 1.4,
            }}
          >
            The quick brown fox jumps over the lazy dog
          </p>
        </div>
      </div>
      <p className="text-xs font-semibold">{preset.label}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{preset.description}</p>
    </button>
  );
}

/** Full-page live preview using actual chapter data */
function DesignLivePreview({ onClose }: { onClose: () => void }) {
  const { config, chapters } = useStoryForge();
  const design = resolveDesign(config);
  const dark = isDarkBg(design.bg);
  const [pageIndex, setPageIndex] = useState(0);

  const previewChapters = chapters.length > 0
    ? chapters
    : [
        { id: "sample-1", title: "The Journey Begins", body: "In the heart of the ancient forest, where sunlight filtered through a canopy of emerald leaves, a young traveller set out on a path that would change everything. The air was thick with the scent of wildflowers and the distant murmur of a hidden stream.\n\nEvery step forward revealed new wonders — moss-covered stones that glowed faintly in the twilight, birds whose songs seemed to carry ancient melodies, and a trail that wound deeper into mystery.", imageUrl: "" },
        { id: "sample-2", title: "Echoes of the Past", body: "The old library stood at the edge of town, its walls lined with books that hadn't been opened in decades. Dust motes danced in shafts of afternoon light as she ran her fingers along the cracked spines.\n\nA leather-bound volume fell open to a page marked with a faded ribbon. The handwriting was elegant, deliberate — a letter never sent, from a time long forgotten.", imageUrl: "" },
      ];

  const ch = previewChapters[pageIndex];
  const total = previewChapters.length;

  const imgPlaceholderGrad = dark
    ? `linear-gradient(135deg, ${design.accent}22, ${design.chapterBg})`
    : `linear-gradient(135deg, ${design.accent}15, ${design.chapterBg})`;

  const imgBlock = (className = "") => (
    ch?.imageUrl
      ? <img src={ch.imageUrl} alt={ch?.title} className={`object-cover ${className}`} style={{ borderRadius: 12 }} />
      : <div className={`flex items-center justify-center ${className}`} style={{ background: imgPlaceholderGrad, borderRadius: 12, minHeight: 200 }}>
          <span style={{ color: design.accent, opacity: 0.5, fontSize: 48 }}>📖</span>
        </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: design.bg }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)", backgroundColor: design.chapterBg }}
      >
        <div className="flex items-center gap-3">
          <Eye className="w-4 h-4" style={{ color: design.accent }} />
          <span className="text-sm font-semibold" style={{ color: design.text }}>
            Live Preview — {design.schemeName}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: design.accent + "22", color: design.accent }}>
            {design.fontName}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-1"
          style={{ color: design.text }}
        >
          <X className="w-4 h-4" /> Close
        </Button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-10">
          {/* Chapter number */}
          <p
            className="text-xs uppercase tracking-[3px] mb-2"
            style={{ color: design.text + "88", fontFamily: design.fontFamily }}
          >
            Chapter {pageIndex + 1} of {total}
          </p>

          {/* Title */}
          <h2
            className="text-3xl font-bold mb-6"
            style={{ color: design.accent, fontFamily: design.fontFamily }}
          >
            {ch?.title ?? "Untitled Chapter"}
          </h2>

          {/* Layout-aware rendering */}
          {design.layout === "side-by-side" ? (
            <div className="grid grid-cols-2 gap-6">
              {imgBlock("w-full h-auto")}
              <div
                className="text-base leading-[2] whitespace-pre-wrap"
                style={{ color: design.text + "cc", fontFamily: design.fontFamily }}
              >
                {ch?.body}
              </div>
            </div>
          ) : design.layout === "overlay" ? (
            <div className="relative rounded-xl overflow-hidden mb-6">
              {ch?.imageUrl
                ? <img src={ch.imageUrl} alt={ch?.title} className="w-full h-80 object-cover" style={{ filter: "brightness(0.4)" }} />
                : <div className="w-full h-80" style={{ background: imgPlaceholderGrad, filter: "brightness(0.6)" }} />
              }
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <div
                  className="text-sm leading-[2] whitespace-pre-wrap"
                  style={{ color: "#ffffffdd", fontFamily: design.fontFamily }}
                >
                  {(ch?.body ?? "").slice(0, 300)}…
                </div>
              </div>
            </div>
          ) : design.layout === "full-bleed" ? (
            <>
              <div className="-mx-6 mb-6">
                {ch?.imageUrl
                  ? <img src={ch.imageUrl} alt={ch?.title} className="w-full max-h-[450px] object-cover" />
                  : <div className="w-full h-64" style={{ background: imgPlaceholderGrad }} />
                }
              </div>
              <div
                className="text-base leading-[2] whitespace-pre-wrap"
                style={{ color: design.text + "cc", fontFamily: design.fontFamily }}
              >
                {ch?.body}
              </div>
            </>
          ) : (
            /* Classic layout */
            <>
              <div className="mb-6">
                {imgBlock("w-full")}
              </div>
              <div
                className="text-base leading-[2] whitespace-pre-wrap"
                style={{ color: design.text + "cc", fontFamily: design.fontFamily }}
              >
                {ch?.body}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Navigation footer */}
      <div
        className="flex items-center justify-center gap-4 px-4 py-3 border-t shrink-0"
        style={{ borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)", backgroundColor: design.chapterBg }}
      >
        <button
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((p) => p - 1)}
          className="w-9 h-9 rounded-full flex items-center justify-center border transition-all disabled:opacity-30"
          style={{ borderColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", color: design.text }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex gap-1.5">
          {previewChapters.map((_, i) => (
            <button
              key={i}
              onClick={() => setPageIndex(i)}
              className="transition-all"
              style={{
                width: i === pageIndex ? 16 : 8,
                height: 8,
                borderRadius: i === pageIndex ? 4 : "50%",
                backgroundColor: i === pageIndex ? design.accent : (dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"),
              }}
            />
          ))}
        </div>
        <button
          disabled={pageIndex >= total - 1}
          onClick={() => setPageIndex((p) => p + 1)}
          className="w-9 h-9 rounded-full flex items-center justify-center border transition-all disabled:opacity-30"
          style={{ borderColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", color: design.text }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function EbookDesignPicker() {
  const { config, setConfig } = useStoryForge();
  const [showPreview, setShowPreview] = useState(false);

  const applyPreset = useCallback(
    (presetId: EbookDesignPreset) => {
      const preset = EBOOK_DESIGN_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setConfig((c) => ({
        ...c,
        ebookDesignPreset: presetId,
        ebookFont: preset.font,
        ebookColorSchemeId: preset.colorSchemeId,
        ebookLayout: preset.layout,
      }));
    },
    [setConfig]
  );

  const activeScheme = EBOOK_COLOR_SCHEMES.find((c) => c.id === config.ebookColorSchemeId);

  return (
    <div className="space-y-5">
      {/* ── Live Preview Button ── */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => setShowPreview(true)}
      >
        <Eye className="w-4 h-4" /> Full-Page Live Preview
      </Button>
      {showPreview && <DesignLivePreview onClose={() => setShowPreview(false)} />}

      {/* ── Inline Mini Preview ── */}
      <DesignMiniPreview />

      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Design Preset</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose a pre-designed look or customise each setting below.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {EBOOK_DESIGN_PRESETS.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              active={config.ebookDesignPreset === preset.id}
              onClick={() => applyPreset(preset.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Font Picker ── */}
      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Font Family</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {EBOOK_FONTS.map((font) => (
            <button
              key={font.id}
              onClick={() =>
                setConfig((c) => ({ ...c, ebookFont: font.id as EbookFontFamily, ebookDesignPreset: "custom" }))
              }
              className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                config.ebookFont === font.id
                  ? "border-primary bg-primary/5"
                  : "border-border/40 hover:border-primary/40"
              }`}
            >
              {config.ebookFont === font.id && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                </div>
              )}
              <p style={{ fontFamily: font.cssFamily }} className="text-sm font-semibold truncate">
                {font.label}
              </p>
              <p className="text-[10px] text-muted-foreground">{font.category}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Color Scheme ── */}
      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Color Scheme</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {EBOOK_COLOR_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              onClick={() =>
                setConfig((c) => ({ ...c, ebookColorSchemeId: scheme.id, ebookDesignPreset: "custom" }))
              }
              className={`rounded-lg border-2 p-2 transition-all ${
                config.ebookColorSchemeId === scheme.id
                  ? "border-primary shadow-sm shadow-primary/10"
                  : "border-border/40 hover:border-primary/40"
              }`}
            >
              <div className="flex gap-1 mb-1.5 justify-center">
                <div className="w-5 h-5 rounded-full border border-border/20" style={{ backgroundColor: scheme.bg }} />
                <div className="w-5 h-5 rounded-full border border-border/20" style={{ backgroundColor: scheme.text }} />
                <div
                  className="w-5 h-5 rounded-full border border-border/20"
                  style={{ backgroundColor: scheme.accent }}
                />
              </div>
              <p className="text-[10px] font-medium text-center truncate">{scheme.name}</p>
            </button>
          ))}
        </div>
        {/* Live preview bar */}
        {activeScheme && (
          <div
            className="rounded-lg p-4 flex items-center gap-3 border border-border/20"
            style={{ backgroundColor: activeScheme.bg }}
          >
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: activeScheme.accent, color: activeScheme.bg }}
            >
              Aa
            </div>
            <div>
              <p className="text-xs font-semibold" style={{ color: activeScheme.text }}>
                {activeScheme.name}
              </p>
              <p className="text-[10px]" style={{ color: activeScheme.text, opacity: 0.6 }}>
                Sample body text preview
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Page Layout ── */}
      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Layout className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Page Layout</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {LAYOUT_OPTIONS.map((layout) => (
            <button
              key={layout.id}
              onClick={() =>
                setConfig((c) => ({ ...c, ebookLayout: layout.id, ebookDesignPreset: "custom" }))
              }
              className={`rounded-lg border-2 p-3 transition-all text-center ${
                config.ebookLayout === layout.id
                  ? "border-primary bg-primary/5"
                  : "border-border/40 hover:border-primary/40"
              }`}
            >
              <div className="mb-2">
                <LayoutPreview layout={layout.id} active={config.ebookLayout === layout.id} />
              </div>
              <p className="text-xs font-semibold">{layout.label}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">{layout.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
