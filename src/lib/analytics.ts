import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget analytics with a small in-memory queue that batches
 * inserts and retries on failure with exponential backoff. Persisted to
 * sessionStorage so a transient failure doesn't lose events across a
 * single tab session. Never throws and never blocks the caller.
 */

type QueuedEvent = {
  event: string;
  properties: Record<string, unknown>;
  page: string | null;
  created_at: string;
};

const STORAGE_KEY = "__lov_analytics_queue_v1";
const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
const FLUSH_DEBOUNCE_MS = 500;
const MAX_BACKOFF_MS = 60_000;

let queue: QueuedEvent[] = loadQueue();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 0;
let flushing = false;

function loadQueue(): QueuedEvent[] {
  try {
    if (typeof sessionStorage === "undefined") return [];
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function persistQueue(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* quota / private mode — ignore */
  }
}

function scheduleFlush(delay = FLUSH_DEBOUNCE_MS): void {
  if (flushTimer || flushing) return;
  if (typeof window === "undefined") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, Math.max(delay, backoffMs));
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const batch = queue.slice(0, BATCH_SIZE);
      const { error } = await supabase
        .from("analytics_events")
        .insert(
          batch.map((e) => ({
            event: e.event,
            properties: e.properties as unknown as Record<string, never>,
            page: e.page,
            created_at: e.created_at,
          })),
        );

      if (error) {
        backoffMs = Math.min(
          MAX_BACKOFF_MS,
          backoffMs > 0 ? backoffMs * 2 : 2_000,
        );
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[analytics] batch failed, retrying", error.message);
        }
        persistQueue();
        scheduleFlush(backoffMs);
        return;
      }

      queue.splice(0, batch.length);
      persistQueue();
      backoffMs = 0;
    }
  } catch {
    backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs > 0 ? backoffMs * 2 : 2_000);
    scheduleFlush(backoffMs);
  } finally {
    flushing = false;
  }
}

// Flush on tab hide / unload so events aren't lost.
if (typeof window !== "undefined") {
  const flushNow = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
  // Try to drain anything left over from a previous session.
  if (queue.length > 0) scheduleFlush(0);
}

export function trackEvent(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  try {
    const queued: QueuedEvent = {
      event,
      properties,
      page:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : null,
      created_at: new Date().toISOString(),
    };

    queue.push(queued);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    persistQueue();
    scheduleFlush();

    // Mirror to dataLayer for downstream tag managers.
    if (typeof window !== "undefined") {
      const w = window as unknown as {
        dataLayer?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(w.dataLayer)) {
        w.dataLayer.push({ event, ...properties });
      }
    }
  } catch {
    /* never throw from analytics */
  }
}
