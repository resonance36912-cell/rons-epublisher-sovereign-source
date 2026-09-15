/**
 * Resolve eBook design settings from StoryConfig into concrete
 * color values, font families, and layout mode strings that can
 * be consumed by all export pipelines (HTML, PDF, video).
 */
import {
  EBOOK_FONTS,
  EBOOK_COLOR_SCHEMES,
  type StoryConfig,
  type EbookLayoutStyle,
} from "@/components/storyforge/StoryForgeContext";

export type ResolvedDesign = {
  /** CSS font-family string e.g. "'Playfair Display', serif" */
  fontFamily: string;
  /** Short font name for PDF registration e.g. "Playfair Display" */
  fontName: string;
  /** Background hex */
  bg: string;
  /** Text hex */
  text: string;
  /** Accent hex */
  accent: string;
  /** Chapter page background hex */
  chapterBg: string;
  /** Layout style */
  layout: EbookLayoutStyle;
  /** Color scheme name */
  schemeName: string;
};

export function resolveDesign(config: StoryConfig): ResolvedDesign {
  const font = EBOOK_FONTS.find((f) => f.id === config.ebookFont) || EBOOK_FONTS[0];
  const scheme = EBOOK_COLOR_SCHEMES.find((c) => c.id === config.ebookColorSchemeId) || EBOOK_COLOR_SCHEMES[0];

  return {
    fontFamily: font.cssFamily,
    fontName: font.label,
    bg: scheme.bg,
    text: scheme.text,
    accent: scheme.accent,
    chapterBg: scheme.chapterBg,
    layout: config.ebookLayout || "classic",
    schemeName: scheme.name,
  };
}

/** Convert hex like "#1A1A2E" to "rgb(26,26,46)" */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** True if the background is dark (luminance < 0.4) */
export function isDarkBg(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.4;
}
