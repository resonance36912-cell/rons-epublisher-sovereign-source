/**
 * Runtime Google Font loader for jsPDF.
 * Fetches TTF files on demand from GitHub google/fonts repo, caches them, and registers with jsPDF.
 * jsPDF requires TTF format â€” woff2 is NOT supported.
 */

import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

export type PdfFontEntry = {
  value: string;        // internal key
  label: string;        // display name
  isGoogle?: boolean;   // whether to fetch from Google Fonts
  cssFamily?: string;   // CSS font-family for preview
  variants: { style: string; weight: string; ttfUrl: string }[];
};

// Built-in jsPDF fonts (no TTF needed)
const BUILTIN_FONTS: PdfFontEntry[] = [
  { value: "helvetica", label: "Helvetica", cssFamily: "Helvetica, Arial, sans-serif", variants: [] },
  { value: "times", label: "Times New Roman", cssFamily: "'Times New Roman', Georgia, serif", variants: [] },
  { value: "courier", label: "Courier", cssFamily: "'Courier New', monospace", variants: [] },
];

// Google Fonts â€” TTF URLs from github.com/google/fonts (raw)
// jsPDF ONLY works with TTF, not woff/woff2
const GF_BASE = "https://cdn.jsdelivr.net/gh/google/fonts@main";

const GOOGLE_FONTS: PdfFontEntry[] = [
  {
    value: "inter", label: "Inter", isGoogle: true,
    cssFamily: "'Inter', sans-serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf` },
    ],
  },
  {
    value: "roboto", label: "Roboto", isGoogle: true,
    cssFamily: "'Roboto', sans-serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf` },
    ],
  },
  {
    value: "opensans", label: "Open Sans", isGoogle: true,
    cssFamily: "'Open Sans', sans-serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf` },
    ],
  },
  {
    value: "lora", label: "Lora", isGoogle: true,
    cssFamily: "'Lora', serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/lora/Lora%5Bwght%5D.ttf` },
    ],
  },
  {
    value: "playfair", label: "Playfair Display", isGoogle: true,
    cssFamily: "'Playfair Display', serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf` },
    ],
  },
  {
    value: "merriweather", label: "Merriweather", isGoogle: true,
    cssFamily: "'Merriweather', serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/merriweather/Merriweather%5Bwght%5D.ttf` },
    ],
  },
  {
    value: "montserrat", label: "Montserrat", isGoogle: true,
    cssFamily: "'Montserrat', sans-serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/montserrat/Montserrat%5Bwght%5D.ttf` },
    ],
  },
  {
    value: "raleway", label: "Raleway", isGoogle: true,
    cssFamily: "'Raleway', sans-serif",
    variants: [
      { style: "normal", weight: "normal", ttfUrl: `${GF_BASE}/ofl/raleway/Raleway%5Bwght%5D.ttf` },
    ],
  },
];

export const ALL_PDF_FONTS: PdfFontEntry[] = OPEN_NOVA_LOCAL_ONLY
  ? BUILTIN_FONTS
  : [...BUILTIN_FONTS, ...GOOGLE_FONTS];

/** CSS font-family for a given font value (for live preview) */
export function cssFontFamily(fontValue: string): string {
  const entry = ALL_PDF_FONTS.find((f) => f.value === fontValue);
  return entry?.cssFamily || "sans-serif";
}

/** Google Fonts CSS link URL for preview <link> injection */
export function googleFontsLinkUrl(): string {
  return "";
}

// â”€â”€ Runtime font registration cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _fontDataCache = new Map<string, ArrayBuffer>();

async function fetchFontData(url: string): Promise<ArrayBuffer> {
  if (OPEN_NOVA_LOCAL_ONLY) throw new Error("Remote font fetching is disabled in sovereign local mode");
  const cached = _fontDataCache.get(url);
  if (cached) return cached;
  console.log(`[PDF Fonts] Fetching TTF: ${url.slice(0, 80)}â€¦`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status} ${url}`);
  const buf = await resp.arrayBuffer();
  _fontDataCache.set(url, buf);
  console.log(`[PDF Fonts] TTF fetched âœ“ (${(buf.byteLength / 1024).toFixed(0)} KB)`);
  return buf;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Process in chunks to avoid call stack overflow on large fonts
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Ensures the given font is registered with a jsPDF instance.
 * For built-in fonts, this is a no-op.
 * For Google Fonts, fetches TTF and calls addFileToVFS + addFont.
 * Must be called per pdf instance since they don't share VFS.
 */
export async function registerFontWithJsPDF(pdf: any, fontValue: string): Promise<void> {
  const entry = ALL_PDF_FONTS.find((f) => f.value === fontValue);
  if (!entry || !entry.isGoogle || entry.variants.length === 0) return;

  for (const variant of entry.variants) {
    const fileName = `${fontValue}-${variant.weight}.ttf`;
    try {
      const fontData = await fetchFontData(variant.ttfUrl);
      const base64 = arrayBufferToBase64(fontData);
      pdf.addFileToVFS(fileName, base64);
      pdf.addFont(fileName, fontValue, variant.weight === "bold" ? "bold" : "normal");
      console.log(`[PDF Fonts] Registered: ${fontValue} (${variant.weight}) âœ“`);
    } catch (err) {
      console.warn(`[PDF Fonts] Failed to load ${fontValue} ${variant.weight}:`, err);
      // Fall back to helvetica silently
    }
  }
}

/**
 * Register all fonts used in a PdfStyleConfig.
 * Call this once after creating the jsPDF instance, before generating pages.
 */
export async function registerAllUsedFonts(
  pdf: any,
  fontValues: string[],
  onProgress?: (msg: string) => void,
): Promise<void> {
  const googleFonts = [...new Set(fontValues)].filter((v) => {
    const entry = ALL_PDF_FONTS.find((f) => f.value === v);
    return entry?.isGoogle;
  });

  if (googleFonts.length === 0) return;

  onProgress?.(`Loading ${googleFonts.length} custom font${googleFonts.length > 1 ? "s" : ""}â€¦`);
  await Promise.all(googleFonts.map((v) => registerFontWithJsPDF(pdf, v)));
  onProgress?.("Fonts loaded âœ“");
}

