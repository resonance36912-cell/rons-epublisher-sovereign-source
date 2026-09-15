/**
 * Shared layout engine for multi-image chapters (Phase B).
 *
 * Given a container box (in any unit — px for canvas, mm for PDF) and an
 * ordered list of images, returns a rect for every image so all three
 * exporters (PDF, HTML, MP4) and the in-app preview render identically.
 *
 * Layouts:
 *  - "stack"     : vertical stack, each image gets equal height share.
 *  - "grid"      : 2-up (2 imgs) or 2x2 (3-4 imgs).
 *  - "hero"      : first image fills 70% height, remaining share bottom row.
 *  - "carousel"  : exporters render only the first image (no controls).
 *
 * Match-height side-by-side: when an exporter draws text + images side-by-side
 * (PDF photo-only, HTML side-by-side layout), the helper guarantees the image
 * box uses the *same* height as the text block by accepting an explicit box.
 */

import type { ChapterImageLayout } from "@/components/storyforge/StoryForgeContext";

export type LayoutBox = { x: number; y: number; w: number; h: number };

export type LayoutRect = LayoutBox & { index: number };

export type LayoutOptions = {
  /** Layout name. Defaults to "stack". */
  layout?: ChapterImageLayout;
  /** Spacing between images in the same units as the box. */
  gap?: number;
  /** How an individual image fits its rect. Used by HTML/CSS only. */
  fit?: "cover" | "contain";
};

export const DEFAULT_IMAGE_GAP = 6; // px-equivalent
export const DEFAULT_IMAGE_FIT: "cover" | "contain" = "cover";

/**
 * Compute one rect per image inside `box`. Returns at most `count` rects
 * (carousel collapses to 1). All values are in the same unit as the input box.
 */
export function computeChapterImageRects(
  box: LayoutBox,
  count: number,
  opts: LayoutOptions = {}
): LayoutRect[] {
  const layout = opts.layout ?? "stack";
  const gap = opts.gap ?? DEFAULT_IMAGE_GAP;
  if (count <= 0) return [];
  if (count === 1 || layout === "carousel") {
    return [{ ...box, index: 0 }];
  }

  if (layout === "stack") {
    const cellH = (box.h - gap * (count - 1)) / count;
    return Array.from({ length: count }, (_, i) => ({
      x: box.x,
      y: box.y + i * (cellH + gap),
      w: box.w,
      h: cellH,
      index: i,
    }));
  }

  if (layout === "hero") {
    const heroH = (box.h - gap) * 0.7;
    const stripH = box.h - gap - heroH;
    const rest = count - 1;
    const cellW = (box.w - gap * (rest - 1)) / rest;
    const rects: LayoutRect[] = [
      { x: box.x, y: box.y, w: box.w, h: heroH, index: 0 },
    ];
    for (let i = 0; i < rest; i++) {
      rects.push({
        x: box.x + i * (cellW + gap),
        y: box.y + heroH + gap,
        w: cellW,
        h: stripH,
        index: i + 1,
      });
    }
    return rects;
  }

  // "grid" — 2 imgs side-by-side; 3-4 imgs in 2x2.
  if (count === 2) {
    const cellW = (box.w - gap) / 2;
    return [
      { x: box.x, y: box.y, w: cellW, h: box.h, index: 0 },
      { x: box.x + cellW + gap, y: box.y, w: cellW, h: box.h, index: 1 },
    ];
  }
  // 3 or 4 → 2 columns × 2 rows
  const cellW = (box.w - gap) / 2;
  const cellH = (box.h - gap) / 2;
  const rects: LayoutRect[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    rects.push({
      x: box.x + col * (cellW + gap),
      y: box.y + row * (cellH + gap),
      w: cellW,
      h: cellH,
      index: i,
    });
  }
  return rects;
}

/**
 * Cover-fit a single image inside a target rect, returning the draw box.
 * Used by Canvas / PDF exporters where there's no built-in `object-fit`.
 */
export function fitImageCover(
  imgW: number,
  imgH: number,
  target: LayoutBox
): LayoutBox {
  if (!imgW || !imgH) return target;
  const imgRatio = imgW / imgH;
  const tgtRatio = target.w / target.h;
  if (imgRatio > tgtRatio) {
    const drawH = target.h;
    const drawW = drawH * imgRatio;
    return {
      x: target.x - (drawW - target.w) / 2,
      y: target.y,
      w: drawW,
      h: drawH,
    };
  }
  const drawW = target.w;
  const drawH = drawW / imgRatio;
  return {
    x: target.x,
    y: target.y - (drawH - target.h) / 2,
    w: drawW,
    h: drawH,
  };
}

/**
 * Cover-fit returning a clip rectangle (the part of the image that should be
 * drawn). PDF exporters can't clip arbitrarily, so they use `fitImageCover`
 * with overflow swallowed by the page; canvas exporters can pre-clip via
 * `ctx.save/clip/drawImage/restore`.
 */
export function fitImageContain(
  imgW: number,
  imgH: number,
  target: LayoutBox
): LayoutBox {
  if (!imgW || !imgH) return target;
  const imgRatio = imgW / imgH;
  const tgtRatio = target.w / target.h;
  if (imgRatio > tgtRatio) {
    const drawW = target.w;
    const drawH = drawW / imgRatio;
    return {
      x: target.x,
      y: target.y + (target.h - drawH) / 2,
      w: drawW,
      h: drawH,
    };
  }
  const drawH = target.h;
  const drawW = drawH * imgRatio;
  return {
    x: target.x + (target.w - drawW) / 2,
    y: target.y,
    w: drawW,
    h: drawH,
  };
}
