// React bindings for the signed-URL cache in `@/lib/signed-image-url`.
//
// `useSignedImageUrl(input)` returns the current signed URL for a chapter
// image and seamlessly re-renders with a fresh URL when the auto-refresh
// scheduler re-signs it shortly before the TTL expires. While the component
// is mounted, the path stays "live" — once it unmounts, the refresh timer
// is cancelled so we don't churn signs in the background.
import { useEffect, useState } from "react";
import {
  extractChapterImagePath,
  signChapterImageUrl,
  subscribeSignedUrl,
} from "@/lib/signed-image-url";

type Ctx = { uiAction?: string; projectId?: string };

export function useSignedImageUrl(input: string | null | undefined, ctx?: Ctx): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!input) return undefined;
    // Pass-through inputs we won't sign (data:/blob:/external) render immediately.
    return extractChapterImagePath(input) ? undefined : input;
  });

  useEffect(() => {
    if (!input) { setUrl(undefined); return; }
    const path = extractChapterImagePath(input);
    if (!path) { setUrl(input); return; }

    let cancelled = false;
    // Subscribe first so a refresh that lands between the sign call and our
    // state-set doesn't get lost.
    const unsub = subscribeSignedUrl(path, (next) => {
      if (!cancelled) setUrl(next);
    });
    signChapterImageUrl(input, ctx).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => { cancelled = true; unsub(); };
    // Stringify ctx to avoid re-running on identity-only changes.
  }, [input, ctx?.uiAction, ctx?.projectId]);

  return url;
}
