export const FREE_CLOUD_QUALITY_KEY = "resonance_free_cloud_quality";
export const FREE_CLOUD_QUALITY_EVENT = "free-cloud-quality-changed";

const BROKER_URL = String(
  import.meta.env.VITE_RONS_AI_BROKER_URL || "/open-nova-ai",
).replace(/\/$/, "");

export type FreeCloudProvider = {
  id: string;
  name: string;
  kind: "local" | "external" | string;
  enabled: boolean;
  approved: boolean;
  model?: string;
  secret_ready: boolean;
  free_tier?: boolean;
};

export type FreeCloudStatus = {
  ok: boolean;
  service: string;
  port: number;
  providers: FreeCloudProvider[];
  hybrid_order?: string[];
};
export type HybridTextResult = {
  provider: string;
  model?: string;
  text: string;
  route?: "free-cloud" | "local-fallback" | string;
  cost_usd?: number | null;
  receipt_id?: string;
  attempted_providers?: Array<Record<string, unknown>>;
};

export function getFreeCloudQualityEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FREE_CLOUD_QUALITY_KEY) === "1";
}

export function setFreeCloudQualityEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FREE_CLOUD_QUALITY_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent(FREE_CLOUD_QUALITY_EVENT, { detail: { enabled } }));
}

export function readyFreeCloudProviders(status: FreeCloudStatus | null): FreeCloudProvider[] {
  return (status?.providers || []).filter(
    (p) => p.kind === "external" && p.free_tier && p.enabled && p.approved && p.secret_ready,
  );
}
export async function fetchFreeCloudStatus(timeoutMs = 3000): Promise<FreeCloudStatus | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BROKER_URL}/health`, {
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as FreeCloudStatus;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function requestHybridText(input: {
  prompt: string;
  system?: string;
  allowCloud?: boolean;
  timeoutMs?: number;
}): Promise<HybridTextResult> {
  const allowCloud = input.allowCloud ?? getFreeCloudQualityEnabled();
  const timeoutMs = input.timeoutMs ?? 90_000;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const throwIfTimedOut = () => {
    if (controller.signal.aborted || Date.now() - startedAt >= timeoutMs) {
      throw new Error("RONS AI Broker timed out");
    }
  };

  try {
    const startResponse = await fetch(`${BROKER_URL}/v1/hybrid-chat/jobs`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        system: input.system || "",
        human_approved_external: allowCloud,
      }),
      signal: controller.signal,
    });
    const startPayload = await startResponse.json().catch(() => null) as
      | (HybridTextResult & { job_id?: string; status?: string; error?: string })
      | null;

    if (!startResponse.ok || !startPayload) {
      throw new Error(startPayload?.error || `RONS AI Broker job start returned HTTP ${startResponse.status}`);
    }
    if (startPayload.text) {
      return startPayload;
    }
    if (!startPayload.job_id) {
      throw new Error(`RONS AI Broker job start returned HTTP ${startResponse.status}`);
    }

    const jobId = startPayload.job_id;
    while (true) {
      throwIfTimedOut();
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      throwIfTimedOut();

      const pollResponse = await fetch(`${BROKER_URL}/v1/hybrid-chat/jobs/${encodeURIComponent(jobId)}`, {
        credentials: "omit",
        signal: controller.signal,
      });
      const pollPayload = await pollResponse.json().catch(() => null) as
        | { status?: string; result?: HybridTextResult; error?: string }
        | null;

      if (!pollResponse.ok || !pollPayload) {
        throw new Error(pollPayload?.error || `RONS AI Broker job poll returned HTTP ${pollResponse.status}`);
      }
      if (pollPayload.status === "complete") {
        if (!pollPayload.result?.text) throw new Error("RONS AI Broker completed without text");
        return pollPayload.result;
      }
      if (pollPayload.status === "failed") {
        throw new Error(pollPayload.error || "RONS AI Broker job failed");
      }
    }
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error("RONS AI Broker timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
export function parseHybridJson<T = unknown>(text: string): T | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.unshift(fenced);
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next bounded candidate.
    }
  }
  return null;
}
