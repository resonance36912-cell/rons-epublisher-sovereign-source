// Small visual indicator showing how long the currently-displayed signed URL
// will remain valid before the auto-refresh scheduler re-signs it. Reads from
// the in-memory cache in `@/lib/signed-image-url`, polls once per second, and
// re-keys whenever the URL flips (so it resets after a refresh lands).
import { useEffect, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";
import {
  extractChapterImagePath,
  getSignedUrlExpiry,
  subscribeSignedUrl,
  SIGNED_URL_REFRESH_BEFORE_MS,
  getCountdownBadgeVisible,
  subscribeCountdownBadgeVisible,
} from "@/lib/signed-image-url";

type Props = {
  src?: string | null;
  className?: string;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

// Verbose, screen-reader friendly variant of formatRemaining. Avoids
// abbreviations ("s", "m") that get spelled out awkwardly by assistive tech.
function formatRemainingSpoken(ms: number): string {
  if (ms <= 0) return "0 seconds";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds > 0 || minutes === 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}

export function SignedUrlCountdown({ src, className }: Props) {
  const path = src ? extractChapterImagePath(src) : null;
  const [, setTick] = useState(0);
  const [visible, setVisible] = useState<boolean>(() => getCountdownBadgeVisible());

  useEffect(() => {
    return subscribeCountdownBadgeVisible(() => setVisible(getCountdownBadgeVisible()));
  }, []);

  useEffect(() => {
    if (!path || !visible) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    // Reset the visible counter immediately when the URL is re-signed.
    const unsub = subscribeSignedUrl(path, () => setTick((t) => t + 1));
    return () => { clearInterval(id); unsub(); };
  }, [path, visible]);

  if (!visible) return null;
  if (!path) return null;
  const expiresAt = getSignedUrlExpiry(path);
  if (!expiresAt) return null;

  const now = Date.now();
  const remaining = expiresAt - now;
  const soon = remaining <= SIGNED_URL_REFRESH_BEFORE_MS;
  const Icon = soon ? RefreshCw : Clock;

  // Auto-refresh fires ~SIGNED_URL_REFRESH_BEFORE_MS before expiry.
  const nextRefreshAt = Math.max(now, expiresAt - SIGNED_URL_REFRESH_BEFORE_MS);
  const untilRefresh = nextRefreshAt - now;
  const expiryDate = new Date(expiresAt);
  const refreshDate = new Date(nextRefreshAt);
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtAbs = (d: Date) => `${fmtTime(d)} (${d.toLocaleDateString()})`;

  const tooltip = soon
    ? [
        "Signed link is being refreshed automatically.",
        "",
        `Expires at: ${fmtAbs(expiryDate)}`,
        `Expires in: ${formatRemaining(Math.max(0, remaining))}`,
        "Auto-refresh: in progress",
      ].join("\n")
    : [
        `Expires at: ${fmtAbs(expiryDate)}`,
        `Expires in: ${formatRemaining(remaining)}`,
        "",
        `Auto-refresh at: ${fmtTime(refreshDate)}`,
        `Auto-refresh in: ${formatRemaining(untilRefresh)}`,
      ].join("\n");

  const spokenRemaining = formatRemainingSpoken(Math.max(0, remaining));
  const ariaLabel = soon
    ? `Signed media link is refreshing now. Current link expires in ${spokenRemaining}.`
    : `Signed media link expires in ${spokenRemaining}. Auto-refresh in ${formatRemainingSpoken(untilRefresh)}.`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide ${
        soon
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border/40 bg-muted/40 text-muted-foreground"
      } ${className ?? ""}`}
      title={tooltip}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
    >
      <Icon className={`w-2.5 h-2.5 ${soon ? "animate-spin" : ""}`} aria-hidden="true" />
      <span aria-hidden="true">{soon ? "refreshing" : formatRemaining(remaining)}</span>
    </span>
  );
}
