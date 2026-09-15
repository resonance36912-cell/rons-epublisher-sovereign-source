// Presentation export — generates PDF and PPTX slide decks from the
// AudioVisual eBook preview. Text-only at the StoryPreview stage (chapter
// images are produced in the Visual Book step), one chapter per slide plus
// title + references slides.
import jsPDF from "jspdf";
import type { SlideChapter, Source } from "@/components/storyforge/StoryForgeContext";
import { getBrandLogoDataUrl, BRAND_NAME, BRAND_URL } from "@/lib/brand-asset";

export type PresentationDeck = {
  title: string;
  subtitle?: string;
  chapters: SlideChapter[];
  sources: Source[];
};

export type FormatPrefs = {
  fontScale: number;      // 0.85 - 1.4
  lineHeight: number;     // 1.4 - 2.2
  textAlign: "left" | "center" | "justify";
  bodyMaxWidth: number;   // 480 - 900 px
  background: "default" | "cream" | "dark";
};

export const DEFAULT_FORMAT_PREFS: FormatPrefs = {
  fontScale: 1,
  lineHeight: 1.8,
  textAlign: "left",
  bodyMaxWidth: 672,
  background: "default",
};

function deckReferences(sources: Source[]): string[] {
  return sources.filter((s) => s.type !== "file" && s.title).map((s) => s.title);
}

function safeFilename(title: string): string {
  return (title || "presentation").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}

/* ───────────────────── PDF (landscape A4) ───────────────────── */

export async function exportStoryPreviewPdf(deck: PresentationDeck, prefs: FormatPrefs = DEFAULT_FORMAT_PREFS) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 54;
  const bodySize = Math.round(14 * prefs.fontScale);
  const titleSize = Math.round(28 * prefs.fontScale);
  const refs = deckReferences(deck.sources);
  const logo = await getBrandLogoDataUrl();

  const palette = prefs.background === "dark"
    ? { bg: [22, 22, 28], fg: [240, 240, 245], accent: [180, 140, 255] }
    : prefs.background === "cream"
      ? { bg: [250, 246, 235], fg: [40, 32, 24], accent: [180, 100, 40] }
      : { bg: [255, 255, 255], fg: [25, 25, 30], accent: [120, 80, 200] };

  const fillPage = () => {
    doc.setFillColor(palette.bg[0], palette.bg[1], palette.bg[2]);
    doc.rect(0, 0, W, H, "F");
  };
  const setFg = () => doc.setTextColor(palette.fg[0], palette.fg[1], palette.fg[2]);
  const setAccent = () => doc.setTextColor(palette.accent[0], palette.accent[1], palette.accent[2]);

  // Title slide
  fillPage();
  if (logo) {
    try { doc.addImage(logo, "PNG", W / 2 - 24, 40, 48, 48); } catch { /* ignore */ }
  }
  setAccent();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(titleSize + 8);
  const titleLines = doc.splitTextToSize(deck.title, W - margin * 2);
  doc.text(titleLines, W / 2, H / 2 - 20, { align: "center" });
  if (deck.subtitle) {
    setFg();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize + 4);
    doc.text(deck.subtitle, W / 2, H / 2 + 30, { align: "center" });
  }
  setAccent();
  doc.setFontSize(9);
  doc.text(`${BRAND_NAME} · ${BRAND_URL}`, W / 2, H - 36, { align: "center" });

  // Chapter slides
  deck.chapters.forEach((ch, i) => {
    doc.addPage();
    fillPage();
    setAccent();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`CHAPTER ${i + 1}`, margin, margin);
    setFg();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    const tLines = doc.splitTextToSize(ch.title, W - margin * 2);
    doc.text(tLines, margin, margin + 28);
    const titleBlockH = tLines.length * (titleSize + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
    const body = doc.splitTextToSize(ch.body || "", W - margin * 2);
    const lineHeight = bodySize * prefs.lineHeight;
    const yStart = margin + 40 + titleBlockH;
    const maxLines = Math.floor((H - yStart - margin) / lineHeight);
    const visible = body.slice(0, maxLines);
    doc.text(visible, margin, yStart, {
      align: prefs.textAlign === "justify" ? "justify" : prefs.textAlign,
      maxWidth: W - margin * 2,
      lineHeightFactor: prefs.lineHeight,
    });

    // Footer
    doc.setFontSize(9);
    setAccent();
    doc.text(`${i + 1} / ${deck.chapters.length}`, W - margin, H - 24, { align: "right" });
    doc.text(deck.title, margin, H - 24);
  });

  // References slide
  if (refs.length) {
    doc.addPage();
    fillPage();
    setAccent();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    doc.text("References", margin, margin + 20);
    setFg();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
    const refLines: string[] = [];
    refs.forEach((r, i) => {
      const lines = doc.splitTextToSize(`${i + 1}. ${r}`, W - margin * 2);
      refLines.push(...lines, "");
    });
    doc.text(refLines.slice(0, Math.floor((H - margin * 2 - 40) / (bodySize * 1.4))), margin, margin + 60, {
      lineHeightFactor: 1.4,
    });
  }

  doc.save(`${safeFilename(deck.title)}.pdf`);
}

/* ───────────────────── PPTX (16:9, one chapter per slide) ───────────────────── */

export async function exportStoryPreviewPptx(deck: PresentationDeck, prefs: FormatPrefs = DEFAULT_FORMAT_PREFS) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in (16:9)
  pptx.title = deck.title;
  pptx.author = BRAND_NAME;
  const logo = await getBrandLogoDataUrl();

  const palette = prefs.background === "dark"
    ? { bg: "16161C", fg: "F0F0F5", accent: "B48CFF" }
    : prefs.background === "cream"
      ? { bg: "FAF6EB", fg: "281C14", accent: "B46428" }
      : { bg: "FFFFFF", fg: "19191E", accent: "7850C8" };

  const bodySize = 16 * prefs.fontScale;
  const titleSize = 36 * prefs.fontScale;
  const refs = deckReferences(deck.sources);

  // Title slide
  // Title slide
  const title = pptx.addSlide();
  title.background = { color: palette.bg };
  if (logo) {
    title.addImage({ data: logo, x: 6.17, y: 0.6, w: 1, h: 1 });
  }
  title.addText(deck.title, {
    x: 0.5, y: 2.6, w: 12.3, h: 1.5,
    align: "center", fontSize: titleSize + 8, bold: true, color: palette.accent,
    fontFace: "Calibri",
  });
  if (deck.subtitle) {
    title.addText(deck.subtitle, {
      x: 0.5, y: 4.2, w: 12.3, h: 0.6,
      align: "center", fontSize: bodySize + 4, color: palette.fg, fontFace: "Calibri",
    });
  }
  title.addText(`${BRAND_NAME} · ${BRAND_URL}`, {
    x: 0.5, y: 7, w: 12.3, h: 0.3,
    align: "center", fontSize: 10, color: palette.accent, fontFace: "Calibri",
  });
  // Chapter slides
  deck.chapters.forEach((ch, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: palette.bg };
    slide.addText(`CHAPTER ${i + 1}`, {
      x: 0.6, y: 0.4, w: 12, h: 0.3,
      fontSize: 11, bold: true, color: palette.accent, fontFace: "Calibri",
      charSpacing: 4,
    });
    slide.addText(ch.title, {
      x: 0.6, y: 0.8, w: 12, h: 1.1,
      fontSize: titleSize, bold: true, color: palette.fg, fontFace: "Calibri",
      valign: "top",
    });
    slide.addText(ch.body || "", {
      x: 0.6, y: 2.0, w: 12, h: 5,
      fontSize: bodySize, color: palette.fg, fontFace: "Calibri",
      align: prefs.textAlign === "justify" ? "justify" : prefs.textAlign,
      valign: "top",
      lineSpacingMultiple: prefs.lineHeight,
      shrinkText: true,
    });
    slide.addText(`${i + 1} / ${deck.chapters.length}`, {
      x: 11, y: 7.1, w: 2, h: 0.3,
      fontSize: 9, color: palette.accent, align: "right", fontFace: "Calibri",
    });
    slide.addText(deck.title, {
      x: 0.5, y: 7.1, w: 8, h: 0.3,
      fontSize: 9, color: palette.accent, fontFace: "Calibri",
    });
  });

  // References slide
  if (refs.length) {
    const slide = pptx.addSlide();
    slide.background = { color: palette.bg };
    slide.addText("References", {
      x: 0.6, y: 0.5, w: 12, h: 0.8,
      fontSize: titleSize, bold: true, color: palette.accent, fontFace: "Calibri",
    });
    slide.addText(
      refs.map((r, i) => ({ text: `${i + 1}. ${r}`, options: { breakLine: true } })),
      { x: 0.6, y: 1.4, w: 12, h: 5.8, fontSize: bodySize, color: palette.fg, fontFace: "Calibri", lineSpacingMultiple: 1.4, valign: "top" }
    );
  }

  await pptx.writeFile({ fileName: `${safeFilename(deck.title)}.pptx` });
}
