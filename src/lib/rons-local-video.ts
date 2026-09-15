const MUSETALK_BASE_URL = "http://127.0.0.1:7863";
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/;

type VideoFunctionBody = Record<string, unknown>;

const SUBMIT_FUNCTIONS = new Set([
  "submit-video-job",
  "generate-video",
  "generate-cinematic-video",
  "generate-lipsync",
  "generate-lip-sync",
  "lipsync-video",
  "render-scene-video",
]);

const STATUS_FUNCTIONS = new Set([
  "check-job-status",
  "check-video-job",
  "video-job-status",
  "render-job-status",
]);

const CANCEL_FUNCTIONS = new Set([
  "cancel-video-job",
  "cancel-render-job",
  "cancel-lipsync-job",
]);

const OUTPUT_FUNCTIONS = new Set([
  "get-video-output",
  "get-render-output",
  "get-lipsync-output",
]);

function firstValue(body: VideoFunctionBody, keys: string[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function isLocalMediaUrl(value: string): boolean {
  if (value.startsWith("blob:") || value.startsWith("data:")) return true;
  try {
    const url = new URL(value, globalThis.location?.href ?? "http://127.0.0.1:3101/");
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

async function mediaBlob(value: unknown, label: string): Promise<Blob> {
  if (value instanceof Blob) return value;
  if (typeof value === "object" && value !== null) {
    const nested = (value as { file?: unknown; blob?: unknown }).file ??
      (value as { file?: unknown; blob?: unknown }).blob;
    if (nested instanceof Blob) return nested;
  }
  if (typeof value !== "string" || !isLocalMediaUrl(value)) {
    throw new Error(`${label} must be a local Blob, data URL, blob URL, or localhost URL.`);
  }
  const response = await fetch(value, { credentials: "omit" });
  if (!response.ok) throw new Error(`Unable to read local ${label.toLowerCase()} (HTTP ${response.status}).`);
  return await response.blob();
}

async function requestJson(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<any> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${MUSETALK_BASE_URL}${path}`, {
      ...init,
      credentials: "omit",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `RONS Local MuseTalk returned HTTP ${response.status}.`);
    }
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function jobIdFrom(body: VideoFunctionBody): string {
  const jobId = String(firstValue(body, ["jobId", "job_id", "renderJobId", "render_job_id"]) ?? "").toLowerCase();
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error("A valid local MuseTalk job ID is required.");
  return jobId;
}

function normalizeJob(job: any): any {
  const jobId = String(job?.job_id ?? job?.jobId ?? "");
  const outputPath = typeof job?.output_url === "string" ? job.output_url : null;
  const outputUrl = outputPath
    ? (outputPath.startsWith("/") ? `${MUSETALK_BASE_URL}${outputPath}` : outputPath)
    : null;
  return {
    ...job,
    success: true,
    local: true,
    provider: "rons-local-musetalk-1.5",
    jobId,
    outputUrl,
    videoUrl: outputUrl,
  };
}

async function submitVideo(name: string, body: VideoFunctionBody): Promise<any> {
  const imageValue = firstValue(body, ["image", "imageFile", "image_file", "inputImage", "input_image", "imageUrl", "image_url", "sourceImage", "source_image"]);
  const videoValue = firstValue(body, ["video", "videoFile", "video_file", "inputVideo", "input_video", "videoUrl", "video_url", "sourceVideo", "source_video"]);
  if ((imageValue === undefined) === (videoValue === undefined)) {
    throw new Error("Provide exactly one local image or video source for MuseTalk.");
  }

  const audioValue = firstValue(body, ["audio", "audioFile", "audio_file", "inputAudio", "input_audio", "audioUrl", "audio_url", "narration", "narrationUrl", "narration_url"]);
  const form = new FormData();
  const sourceKind = imageValue !== undefined ? "image" : "video";
  const source = await mediaBlob(imageValue ?? videoValue, sourceKind === "image" ? "Image" : "Video");
  form.append(sourceKind, source, sourceKind === "image" ? "source.png" : "source.mp4");

  if (audioValue !== undefined) {
    const audio = await mediaBlob(audioValue, "Audio");
    form.append("audio", audio, "narration.wav");
  }

  const requestedLipSync = firstValue(body, ["lip_sync", "lipSync"]);
  const metadata: Record<string, unknown> = {
    source: "epublisher-sovereign-local",
    operation: name,
    lip_sync: typeof requestedLipSync === "boolean" ? requestedLipSync : audioValue !== undefined,
  };
  const duration = firstValue(body, ["duration", "duration_seconds", "durationSeconds"]);
  const aspectRatio = firstValue(body, ["aspect_ratio", "aspectRatio"]);
  const motion = firstValue(body, ["motion"]);
  if (duration !== undefined) metadata.duration = duration;
  if (aspectRatio !== undefined) metadata.aspect_ratio = aspectRatio;
  if (motion !== undefined) metadata.motion = motion;
  form.append("metadata", JSON.stringify(metadata));

  return normalizeJob(await requestJson("/api/jobs", { method: "POST", body: form }, 120_000));
}

/**
 * Maps legacy hosted video-function names onto the sovereign localhost MuseTalk
 * job API. Unsupported names return undefined so the compatibility client can
 * continue through its other local handlers.
 */
export async function invokeLocalVideoFunction(name: string, body: VideoFunctionBody = {}): Promise<any | undefined> {
  if (STATUS_FUNCTIONS.has(name)) {
    return normalizeJob(await requestJson(`/api/jobs/${jobIdFrom(body)}`));
  }
  if (CANCEL_FUNCTIONS.has(name)) {
    return normalizeJob(await requestJson(`/api/jobs/${jobIdFrom(body)}/cancel`, { method: "POST" }));
  }
  if (OUTPUT_FUNCTIONS.has(name)) {
    const jobId = jobIdFrom(body);
    return {
      success: true,
      local: true,
      provider: "rons-local-musetalk-1.5",
      jobId,
      outputUrl: `${MUSETALK_BASE_URL}/api/jobs/${jobId}/output`,
      videoUrl: `${MUSETALK_BASE_URL}/api/jobs/${jobId}/output`,
    };
  }
  if (SUBMIT_FUNCTIONS.has(name)) {
    return await submitVideo(name, body);
  }
  return undefined;
}
