export const FREE_CLOUD_QUALITY_KEY = "resonance_free_cloud_quality";
export const FREE_CLOUD_QUALITY_EVENT = "free-cloud-quality-changed";

const BROKER_URL = String(
  import.meta.env.VITE_RONS_AI_BROKER_URL || "http://127.0.0.1:7868",
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
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), input.timeoutMs ?? 90000);
  try {
    const response = await fetch(`${BROKER_URL}/v1/hybrid-chat`, {
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
    const payload = await response.json().catch(() => null) as (HybridTextResult & { error?: string }) | null;
    if (!response.ok || !payload?.text) {
      throw new Error(payload?.error || `RONS AI Broker returned HTTP ${response.status}`);
    }
    return payload;
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
