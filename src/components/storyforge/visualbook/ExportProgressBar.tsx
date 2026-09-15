import { Progress } from "@/components/ui/progress";
import { Download, Loader2, StopCircle, X, AudioLines, RotateCcw, Headphones, Trash2, Film, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

type SegmentInfo = {
  segment: number;
  totalSegments: number;
  chapterTitle: string;
};

type Props = {
  downloading: boolean;
  stage: string;
  current: number;
  total: number;
  elapsed?: number;
  onStop: () => void;
  pendingDownload?: { blob: Blob; filename: string } | null;
  onManualDownload?: () => void;
  onDismissPending?: () => void;
  segmentInfo?: SegmentInfo | null;
  narrationEta?: number | null;
  canResume?: boolean;
  cachedChapterCount?: number;
  chaptersCount?: number;
  onResumeVideo?: () => void;
  onResumeEbook?: () => void;
  onResumeAudio?: () => void;
  onClearCache?: () => void;
  narrationProvider?: "browser" | "elevenlabs";
  hasCachedVideo?: boolean;
  cachedVideoFilename?: string | null;
  cachedVideoSize?: number | null;
  cachedVideoSavedAt?: number | null;
  onRedownloadVideo?: () => void;
  /** Last A/V sync drift measurement from a video export. Surfaced as a badge on the success card. */
  lastAvDrift?: { driftSecs: number; exceeded: boolean } | null;
};

function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day !== 1 ? "s" : ""} ago`;
}

export function ExportProgressBar({ downloading, stage, current, total, elapsed, onStop, pendingDownload, onManualDownload, onDismissPending, segmentInfo, narrationEta, canResume, cachedChapterCount, chaptersCount, onResumeVideo, onResumeEbook, onResumeAudio, onClearCache, narrationProvider, hasCachedVideo, cachedVideoFilename, cachedVideoSize, cachedVideoSavedAt, onRedownloadVideo, lastAvDrift }: Props) {
  // Show "Re-download last video" card when an encoded MP4 is cached and nothing else is happening
  if (!downloading && !pendingDownload && hasCachedVideo && onRedownloadVideo) {
    const sizeMb = cachedVideoSize != null ? (cachedVideoSize / 1024 / 1024).toFixed(1) : null;
    const savedAgo = cachedVideoSavedAt != null ? formatRelativeTime(cachedVideoSavedAt) : null;
    return (
      <div className="w-full rounded-xl border border-primary/30 bg-gradient-to-r from-primary/5 via-card/90 to-primary/5 backdrop-blur-sm p-4 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-primary/10 border border-primary/20">
            <Film className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold text-foreground">Last video ready to re-download</span>
            <span className="text-xs text-muted-foreground truncate">{cachedVideoFilename ?? "Cached MP4 available — no re-encoding needed."}</span>
            {(sizeMb || savedAgo) && (
              <span className="text-[10px] text-muted-foreground/80 mt-0.5">
                {sizeMb && <>{sizeMb} MB</>}
                {sizeMb && savedAgo && <span className="mx-1.5">•</span>}
                {savedAgo && <>saved {savedAgo}</>}
              </span>
            )}
          </div>
          <Button size="sm" onClick={onRedownloadVideo} className="h-8 gap-1.5 rounded-full font-medium shadow-sm">
            <Download className="w-3.5 h-3.5" /> Re-download
          </Button>
        </div>
      </div>
    );
  }

  // Show resume card when not downloading but cached narration exists
  if (!downloading && !pendingDownload && canResume && cachedChapterCount && cachedChapterCount > 0 && chaptersCount) {
    const pct = Math.round((cachedChapterCount / chaptersCount) * 100);
    const remaining = chaptersCount - cachedChapterCount;
    const isPremium = narrationProvider === "elevenlabs";
    const estMinutes = Math.max(1, Math.round(remaining * (isPremium ? 4 : 8) / 60));

    return (
      <div className="w-full rounded-xl border border-primary/30 bg-gradient-to-r from-primary/5 via-card/90 to-primary/5 backdrop-blur-sm p-4 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-primary/10 border border-primary/20">
              <Headphones className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-foreground">Export interrupted — progress saved</span>
              <span className="text-xs text-muted-foreground">
                {cachedChapterCount} of {chaptersCount} chapters narrated ({pct}%). 
                Resume to finish the remaining {remaining} chapter{remaining !== 1 ? "s" : ""} (~{estMinutes} min).
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex flex-col gap-1">
            <Progress value={pct} className="h-2" />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{cachedChapterCount}/{chaptersCount} cached</span>
              <span className="text-primary font-medium">~{estMinutes} min to finish</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {onResumeVideo && (
              <Button size="sm" onClick={onResumeVideo} className="h-8 gap-1.5 rounded-full font-medium shadow-sm">
                <RotateCcw className="w-3.5 h-3.5" /> Resume Video
              </Button>
            )}
            {onResumeEbook && (
              <Button size="sm" variant="secondary" onClick={onResumeEbook} className="h-8 gap-1.5 rounded-full font-medium">
                <RotateCcw className="w-3.5 h-3.5" /> Resume eBook
              </Button>
            )}
            {onResumeAudio && (
              <Button size="sm" variant="secondary" onClick={onResumeAudio} className="h-8 gap-1.5 rounded-full font-medium">
                <RotateCcw className="w-3.5 h-3.5" /> Resume MP3
              </Button>
            )}
            {onClearCache && (
              <Button size="sm" variant="ghost" onClick={onClearCache} className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive ml-auto">
                <Trash2 className="w-3 h-3" /> Clear cache
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show pending download banner even when not actively downloading
  if (!downloading && pendingDownload) {
    return (
      <div className="w-full rounded-xl border border-primary/30 bg-gradient-to-r from-primary/5 via-card/90 to-primary/5 backdrop-blur-sm p-4 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-primary/10 border border-primary/20">
            <Download className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 gap-1">
            <span className="text-sm font-semibold text-foreground">Download didn't start?</span>
            <span className="text-xs text-muted-foreground">Click the button to download your file manually.</span>
            {lastAvDrift && pendingDownload.filename.toLowerCase().endsWith(".mp4") && (
              <AvDriftBadge driftSecs={lastAvDrift.driftSecs} exceeded={lastAvDrift.exceeded} />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={onManualDownload} className="h-8 px-4 gap-2 rounded-full font-medium shadow-sm max-w-[220px]">
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{pendingDownload.filename}</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={onDismissPending} className="h-11 w-11 sm:h-8 sm:w-8 rounded-full text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!downloading || !stage) return null;

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const segPct = segmentInfo && segmentInfo.totalSegments > 1
    ? Math.round((segmentInfo.segment / segmentInfo.totalSegments) * 100)
    : null;

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
  };

  return (
    <div className="w-full rounded-lg border border-border/60 bg-card/80 backdrop-blur-sm p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-300 overflow-hidden">
      <div className="flex items-center justify-between text-sm gap-2">
        <div className="flex items-center gap-2 text-foreground font-medium min-w-0">
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          <span className="truncate">{stage}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {narrationEta != null && narrationEta > 0 && (
            <span className="text-xs text-primary/80 font-mono whitespace-nowrap">~{formatElapsed(narrationEta)} left</span>
          )}
          {elapsed !== undefined && elapsed > 0 && (
            <span className="text-xs text-muted-foreground font-mono">{formatElapsed(elapsed)}</span>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {current}/{total} — {pct}%
          </span>
          <Button variant="ghost" size="sm" onClick={onStop} className="h-6 px-2 text-destructive hover:text-destructive">
            <StopCircle className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <Progress value={pct} className="h-2" />

      {/* Segment sub-progress for browser TTS */}
      {segmentInfo && segmentInfo.totalSegments > 1 && (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
          <div className="flex items-center gap-2 text-[11px]">
            <AudioLines className="w-3 h-3 text-primary animate-pulse shrink-0" />
            <span className="text-muted-foreground truncate">
              <span className="font-medium text-foreground">{segmentInfo.chapterTitle}</span>
              {" — "}segment {segmentInfo.segment}/{segmentInfo.totalSegments}
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60 transition-all duration-300"
              style={{ width: `${segPct ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge that surfaces the A/V sync drift from the most recent video export.
 * Green when within ±0.5s tolerance, destructive when exceeded.
 */
function AvDriftBadge({ driftSecs, exceeded }: { driftSecs: number; exceeded: boolean }) {
  const sign = driftSecs >= 0 ? "+" : "−";
  const abs = Math.abs(driftSecs);
  const formatted = abs < 0.01 ? "0.00" : abs.toFixed(2);
  const tooltip = exceeded
    ? `A/V drift ${sign}${formatted}s exceeds the 0.5s tolerance — playback may have a silent tail or cut-off narration.`
    : `A/V drift ${sign}${formatted}s — within ±0.5s tolerance, sync is good.`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 self-start mt-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-mono whitespace-nowrap ${
        exceeded
          ? "bg-destructive/15 border-destructive/40 text-destructive"
          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
      }`}
    >
      <Activity className="w-3 h-3" />
      A/V sync: {sign}{formatted}s
    </span>
  );
}

