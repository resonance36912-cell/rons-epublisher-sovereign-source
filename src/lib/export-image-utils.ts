// Re-sign and (optionally) inline chapter images right before an export runs.
//
// The `chapter-images` bucket is private, so exports must use freshly-issued
// signed URLs from the `sign-chapter-images` edge function. For long-lived
// artifacts (HTML/ePub) we additionally inline images as base64 data URIs so
// the file keeps working after the 1h signed-URL TTL expires.
import type { SlideChapter, ChapterImage } from "@/components/storyforge/StoryForgeContext";
import {
  signChapterImageUrls,
  extractChapterImagePath,
} from "@/lib/signed-image-url";

export type PrepareExportImagesOptions = {
  /** Inline images as base64 data URIs (use for portable HTML/ePub exports). */
  embedAsDataUri?: boolean;
  /** Optional audit context forwarded to the sign edge function. */
  uiAction?: string;
  projectId?: string;
};

export type PreparedExportImages = {
  chapters: SlideChapter[];
  referenceImage: string | null | undefined;
};

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    if (url.startsWith("data:")) return url;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Refresh signed URLs for every chapter image (and the cover/reference image)
 * just before an export consumes them. Returns shallow clones — never mutates
 * the caller's chapter array.
 */
export async function prepareExportImages(
  chapters: SlideChapter[],
  referenceImage: string | null | undefined,
  opts: PrepareExportImagesOptions = {},
): Promise<PreparedExportImages> {
  // Collect every URL that points at the private bucket. Non-bucket inputs
  // (data:, external, fallback PNGs) are passed through unchanged.
  type Slot = { kind: "primary"; chIdx: number }
            | { kind: "gallery"; chIdx: number; imgIdx: number }
            | { kind: "reference" };

  const slots: Slot[] = [];
  const inputs: string[] = [];

  chapters.forEach((ch, chIdx) => {
    if (ch.imageUrl) { slots.push({ kind: "primary", chIdx }); inputs.push(ch.imageUrl); }
    if (Array.isArray(ch.images)) {
      ch.images.forEach((im, imgIdx) => {
        if (im?.url) { slots.push({ kind: "gallery", chIdx, imgIdx }); inputs.push(im.url); }
      });
    }
  });
  if (referenceImage) { slots.push({ kind: "reference" }); inputs.push(referenceImage); }

  const signed = await signChapterImageUrls(inputs, {
    uiAction: opts.uiAction ?? "export",
    projectId: opts.projectId,
  });

  // Optionally inline as data URIs for portable exports.
  let finalUrls = signed;
  if (opts.embedAsDataUri) {
    // De-dupe fetches across slots.
    const uniqueUrls = Array.from(new Set(signed.filter((u, i) => !!u && extractChapterImagePath(inputs[i]))));
    const dataUriMap = new Map<string, string>();
    await Promise.all(uniqueUrls.map(async (u) => {
      const d = await fetchAsDataUri(u);
      if (d) dataUriMap.set(u, d);
    }));
    finalUrls = signed.map((u) => dataUriMap.get(u) ?? u);
  }

  // Clone chapters and apply the resolved URLs slot-by-slot.
  const out: SlideChapter[] = chapters.map((ch) => ({
    ...ch,
    images: Array.isArray(ch.images) ? ch.images.map((im) => ({ ...im })) : ch.images,
  }));
  let nextRef: string | null | undefined = referenceImage;

  slots.forEach((slot, i) => {
    const url = finalUrls[i] ?? inputs[i];
    if (slot.kind === "primary") {
      out[slot.chIdx].imageUrl = url;
    } else if (slot.kind === "gallery") {
      const imgs = out[slot.chIdx].images as ChapterImage[] | undefined;
      if (imgs && imgs[slot.imgIdx]) imgs[slot.imgIdx].url = url;
    } else {
      nextRef = url;
    }
  });

  return { chapters: out, referenceImage: nextRef };
}
