import { BG_MUSIC_TRACKS } from "@/components/storyforge/StoryForgeContext";

/**
 * Fetch the selected background music track as a Blob.
 * Returns null if no music is selected or fetch fails.
 */
export async function fetchBgMusicBlob(trackId: string): Promise<Blob | null> {
  if (!trackId || trackId === "none") return null;
  const track = BG_MUSIC_TRACKS.find((t) => t.id === trackId);
  if (!track || !track.url) return null;

  try {
    const resp = await fetch(track.url);
    if (!resp.ok) {
      console.warn(`[BgMusic] Failed to fetch ${track.url}: ${resp.status}`);
      return null;
    }
    return await resp.blob();
  } catch (err) {
    console.warn("[BgMusic] Fetch error:", err);
    return null;
  }
}

/**
 * Decode a music Blob into an AudioBuffer.
 */
export async function decodeBgMusic(blob: Blob, sampleRate = 44100): Promise<AudioBuffer | null> {
  try {
    const ctx = new AudioContext({ sampleRate });
    try {
      const arrayBuf = await blob.arrayBuffer();
      return await ctx.decodeAudioData(arrayBuf);
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch (err) {
    console.warn("[BgMusic] Decode error:", err);
    return null;
  }
}

/**
 * Convert a background music blob to a base64 data URI for embedding in HTML.
 */
export async function bgMusicToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Crossfade duration in seconds at loop boundaries */
const CROSSFADE_SEC = 1.5;

/**
 * Mix a background music AudioBuffer into an OfflineAudioContext at the given volume,
 * looping seamlessly with crossfade to fill the total duration.
 * Call this BEFORE startRendering().
 */
export function mixBgMusicIntoOfflineCtx(
  offlineCtx: OfflineAudioContext,
  musicBuffer: AudioBuffer,
  volume: number,
  totalDuration: number,
): void {
  const vol = Math.max(0, Math.min(1, volume));
  const trackDur = musicBuffer.duration;

  // If the track already covers the full duration, just play it once
  if (trackDur >= totalDuration) {
    const gain = offlineCtx.createGain();
    gain.gain.value = vol;
    gain.connect(offlineCtx.destination);
    const src = offlineCtx.createBufferSource();
    src.buffer = musicBuffer;
    src.connect(gain);
    src.start(0);
    return;
  }

  // Calculate how many full iterations we need
  const crossfade = Math.min(CROSSFADE_SEC, trackDur * 0.25); // cap at 25% of track length
  const effectiveDur = trackDur - crossfade; // overlap region
  const iterations = Math.ceil(totalDuration / effectiveDur) + 1;

  for (let i = 0; i < iterations; i++) {
    const startTime = i * effectiveDur;
    if (startTime >= totalDuration) break;

    const gain = offlineCtx.createGain();
    gain.gain.value = vol;
    gain.connect(offlineCtx.destination);

    const src = offlineCtx.createBufferSource();
    src.buffer = musicBuffer;
    src.connect(gain);
    src.start(startTime);

    // Apply crossfade: fade in at the start of each iteration (except the first)
    if (i > 0 && crossfade > 0) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(vol, startTime + crossfade);
    }

    // Apply crossfade: fade out at the end of each iteration (except the last that fills)
    const endTime = startTime + trackDur;
    if (endTime < totalDuration + crossfade && crossfade > 0) {
      gain.gain.setValueAtTime(vol, endTime - crossfade);
      gain.gain.linearRampToValueAtTime(0, endTime);
    }
  }
}
