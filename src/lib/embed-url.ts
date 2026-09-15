// Helpers for converting third-party video embed/share URLs back into
// canonical user-facing watch URLs (used by the demo player fallback).

export type EmbedProvider = "YouTube" | "Vimeo" | "source";

export interface ResolvedWatchUrl {
  /** Canonical watch URL — falls back to the original input on failure. */
  watchUrl: string;
  /** Provider label suitable for "Watch on {label}". */
  providerLabel: EmbedProvider;
}

/**
 * Resolve an arbitrary YouTube or Vimeo URL (embed, share, shorts, etc.)
 * to a canonical watch URL and human-readable provider label. Preserves
 * useful query params (YouTube start time / playlist, Vimeo unlisted hash).
 * Unknown or unparsable URLs return the original URL with label "source".
 */
export function resolveWatchUrl(input: string): ResolvedWatchUrl {
  let watchUrl = input;
  let providerLabel: EmbedProvider = "source";

  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, "");
    const isYouTube =
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "youtu.be";
    const isVimeo = host === "vimeo.com" || host === "player.vimeo.com";

    if (isYouTube) {
      providerLabel = "YouTube";
      let videoId: string | null = null;
      const parts = u.pathname.split("/").filter(Boolean);
      if (host === "youtu.be") {
        videoId = parts[0] ?? null;
      } else if (parts[0] === "watch") {
        videoId = u.searchParams.get("v");
      } else if (
        parts[0] === "embed" ||
        parts[0] === "shorts" ||
        parts[0] === "v" ||
        parts[0] === "live"
      ) {
        videoId = parts[1] ?? null;
      }

      const params = new URLSearchParams();
      const list = u.searchParams.get("list");
      const start = u.searchParams.get("start") ?? u.searchParams.get("t");
      if (videoId && videoId !== "videoseries") params.set("v", videoId);
      if (list) params.set("list", list);
      if (start) params.set("t", start.replace(/s$/, ""));

      if (params.has("v")) {
        watchUrl = `https://www.youtube.com/watch?${params.toString()}`;
      } else if (list) {
        watchUrl = `https://www.youtube.com/playlist?list=${list}`;
      }
    } else if (isVimeo) {
      providerLabel = "Vimeo";
      const parts = u.pathname.split("/").filter(Boolean);
      let id: string | undefined;
      let hash: string | undefined;
      if (host === "player.vimeo.com" && parts[0] === "video") {
        id = parts[1];
        hash = parts[2];
        if (!hash) {
          const h = u.searchParams.get("h");
          if (h) hash = h;
        }
      } else if (parts[0] === "channels") {
        id = parts[2];
      } else if (/^\d+$/.test(parts[0] ?? "")) {
        id = parts[0];
        hash = parts[1];
      }
      if (id) {
        watchUrl = hash
          ? `https://vimeo.com/${id}/${hash}`
          : `https://vimeo.com/${id}`;
      }
    }
  } catch {
    /* keep watchUrl as-is */
  }

  return { watchUrl, providerLabel };
}
