import { useEffect, useRef } from "react";

/**
 * Keeps the device screen awake while `active` is true.
 *
 * Uses the Screen Wake Lock API (https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API).
 * Mobile browsers will throttle/suspend a tab once the screen turns off, which
 * stops in-flight fetches and JS timers (breaking long generations / exports).
 * Holding a wake lock while a job is running prevents the screen from sleeping
 * so the tab stays foregrounded and active.
 *
 * The lock is automatically released when:
 *   - `active` becomes false
 *   - the component unmounts
 *   - the tab becomes hidden (browser releases it; we re-acquire on visibility return)
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await (navigator as Navigator & {
          wakeLock: { request: (type: "screen") => Promise<WakeLockSentinel> };
        }).wakeLock.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // Permission denied / not supported — silently ignore.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && active && !sentinelRef.current) {
        acquire();
      }
    };

    acquire();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) s.release().catch(() => {});
    };
  }, [active]);
}

// Minimal type for environments without lib.dom WakeLock typings.
interface WakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}
