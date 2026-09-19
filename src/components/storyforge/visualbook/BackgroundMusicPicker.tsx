import { useState, useRef, useCallback } from "react";
import { useStoryForge, BG_MUSIC_TRACKS } from "../StoryForgeContext";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Music, Play, Square, Volume2, Lock, Crown, Sparkles } from "lucide-react";
import { useUserTier } from "@/hooks/useUserTier";
import { useI18n } from "@/lib/i18n";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

export function BackgroundMusicPicker() {
  const { config, setConfig } = useStoryForge();
  const { t } = useI18n();
  const { tier } = useUserTier();
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isPremiumUser = FREE_PROMOTION_ACTIVE || tier === "premium";

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewTrackId(null);
  }, []);

  const togglePreview = useCallback((trackId: string) => {
    if (previewTrackId === trackId) {
      stopPreview();
      return;
    }
    stopPreview();
    const track = BG_MUSIC_TRACKS.find((t) => t.id === trackId);
    if (!track || !track.url) return;

    const audio = new Audio(track.url);
    audio.volume = config.bgMusicVolume;
    audio.loop = true;
    audio.onended = () => setPreviewTrackId(null);
    audio.play().catch(() => {
      // Audio not available yet — this is expected for placeholder tracks
      setPreviewTrackId(null);
    });
    audioRef.current = audio;
    setPreviewTrackId(trackId);
  }, [previewTrackId, config.bgMusicVolume, stopPreview]);

  const selectTrack = useCallback((trackId: string) => {
    const track = BG_MUSIC_TRACKS.find((t) => t.id === trackId);
    if (!track) return;
    if (track.tier === "premium" && !isPremiumUser) return;
    setConfig((c) => ({ ...c, bgMusicTrackId: trackId }));
  }, [isPremiumUser, setConfig]);

  const freeTracks = BG_MUSIC_TRACKS.filter((t) => t.tier === "free");
  const premiumTracks = BG_MUSIC_TRACKS.filter((t) => t.tier === "premium");
  const selectedTrack = BG_MUSIC_TRACKS.find((t) => t.id === config.bgMusicTrackId);

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Music className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium">Background Music</p>
        {selectedTrack && selectedTrack.id !== "none" && (
          <Badge variant="secondary" className="text-[10px] ml-auto">
            {selectedTrack.tier === "premium" ? (FREE_PROMOTION_ACTIVE ? "✨ Enhanced" : "✨ Premium") : (FREE_PROMOTION_ACTIVE ? "🎵 Standard" : "🎵 Free")} · {selectedTrack.label}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Add ambient background music to your narrated eBook exports.
      </p>

      {/* Free tracks */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{FREE_PROMOTION_ACTIVE ? "Standard Tracks" : "Free Tracks"}</p>
        <div className="grid gap-1.5">
          {freeTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              isSelected={config.bgMusicTrackId === track.id}
              isPreviewing={previewTrackId === track.id}
              locked={false}
              onSelect={() => selectTrack(track.id)}
              onTogglePreview={() => track.url ? togglePreview(track.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Premium tracks */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Crown className="w-3 h-3 text-primary" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{FREE_PROMOTION_ACTIVE ? "Enhanced Tracks" : "Premium Tracks"}</p>
        </div>
        <div className="grid gap-1.5">
          {premiumTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              isSelected={config.bgMusicTrackId === track.id}
              isPreviewing={previewTrackId === track.id}
              locked={!isPremiumUser}
              onSelect={() => selectTrack(track.id)}
              onTogglePreview={() => isPremiumUser && track.url ? togglePreview(track.id) : undefined}
            />
          ))}
        </div>
        {!isPremiumUser && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" /> Upgrade to Premium to unlock these tracks
          </p>
        )}
        {FREE_PROMOTION_ACTIVE && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" /> All music tracks are included during promotional access.
          </p>
        )}
      </div>

      {/* Volume slider — show when a track is selected OR a preview is playing */}
      {(config.bgMusicTrackId !== "none" || previewTrackId) && (
        <div className="space-y-2 pt-1">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Volume2 className={`w-3 h-3 transition-colors ${previewTrackId ? "text-primary animate-pulse" : ""}`} />
            Music Volume ({Math.round(config.bgMusicVolume * 100)}%)
            {previewTrackId && (
              <span className="text-[10px] text-primary ml-auto">♪ Adjusting live…</span>
            )}
          </label>
          <Slider
            value={[config.bgMusicVolume]}
            onValueChange={([v]) => {
              setConfig((c) => ({ ...c, bgMusicVolume: v }));
              if (audioRef.current) audioRef.current.volume = v;
            }}
            min={0.05}
            max={0.8}
            step={0.05}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Subtle</span>
            <span>Prominent</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackRow({
  track,
  isSelected,
  isPreviewing,
  locked,
  onSelect,
  onTogglePreview,
}: {
  track: { id: string; label: string; genre: string; tier: string; url: string };
  isSelected: boolean;
  isPreviewing: boolean;
  locked: boolean;
  onSelect: () => void;
  onTogglePreview: () => void;
}) {
  return (
    <button
      onClick={locked ? undefined : onSelect}
      className={`flex items-center gap-3 text-left rounded-lg border px-3 py-2.5 transition-all text-sm ${
        locked
          ? "opacity-50 cursor-not-allowed border-border bg-muted/30"
          : isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30"
      }`}
    >
      {/* Preview button */}
      {track.url && !locked ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePreview();
          }}
          className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors"
        >
          {isPreviewing ? (
            <Square className="w-3 h-3 text-primary" />
          ) : (
            <Play className="w-3 h-3 text-primary ml-0.5" />
          )}
        </button>
      ) : (
        <div className="shrink-0 w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center">
          {locked ? <Lock className="w-3 h-3 text-muted-foreground" /> : <Music className="w-3 h-3 text-muted-foreground" />}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <span className="font-medium block truncate">{track.label}</span>
        {track.genre && (
          <span className="text-[10px] text-muted-foreground">{track.genre}</span>
        )}
      </div>

      {track.tier === "premium" && (
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
      )}
    </button>
  );
}
