// Resolves the effective signed-URL TTL for the current viewer:
//   - `override`: the per-user choice from ImageViewerSettings (or null)
//   - `serverDefault`: admin-configured value from app_settings (or null while loading)
// Re-evaluates when the user picks a different value via ImageViewerSettings.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getViewerTtlOverride, isViewerTtlOverrideAllowed } from "@/lib/signed-image-url";

export type EffectiveTtl = {
  /** Per-user override in seconds, or null when "Use server default". */
  override: number | null;
  /** Admin-configured default in seconds, or null while still loading. */
  serverDefault: number | null;
  /** Whether the admin currently allows per-user overrides. */
  overrideAllowed: boolean;
  /** Effective value = (allowed ? override : null) ?? serverDefault. */
  effective: number | null;
};

let cachedServerDefault: number | null = null;
let cachedOverrideAllowed: boolean | null = null;

export function useEffectiveSignedUrlTtl(): EffectiveTtl {
  const [override, setOverride] = useState<number | null>(() => getViewerTtlOverride());
  const [serverDefault, setServerDefault] = useState<number | null>(cachedServerDefault);
  const [overrideAllowed, setOverrideAllowed] = useState<boolean>(cachedOverrideAllowed ?? true);

  useEffect(() => {
    const refresh = () => setOverride(getViewerTtlOverride());
    window.addEventListener("resonance:viewer-ttl-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("resonance:viewer-ttl-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void isViewerTtlOverrideAllowed().then((v) => {
      cachedOverrideAllowed = v;
      if (!cancelled) setOverrideAllowed(v);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (cachedServerDefault !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "signed_url_ttl_seconds")
          .maybeSingle();
        const raw = (data as { value?: unknown } | null)?.value;
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n) && n > 0) {
          cachedServerDefault = Math.floor(n);
          if (!cancelled) setServerDefault(cachedServerDefault);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveOverride = overrideAllowed ? override : null;
  return {
    override,
    serverDefault,
    overrideAllowed,
    effective: effectiveOverride ?? serverDefault,
  };
}

/** Human-readable tooltip describing the effective TTL source. */
export function formatEffectiveTtlTooltip(t: EffectiveTtl): string {
  const fmt = (s: number) => {
    const m = Math.round(s / 60);
    return m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m} min`;
  };
  if (!t.overrideAllowed) {
    if (t.serverDefault) {
      return `Locked by admin · server default: ${t.serverDefault}s (~${fmt(t.serverDefault)})`;
    }
    return "Locked by admin · resolving server default…";
  }
  if (t.override) {
    const base = `Your override: ${t.override}s (~${fmt(t.override)})`;
    return t.serverDefault
      ? `${base}\nServer default: ${t.serverDefault}s (~${fmt(t.serverDefault)})`
      : base;
  }
  if (t.serverDefault) {
    return `Server default: ${t.serverDefault}s (~${fmt(t.serverDefault)})\nNo per-user override.`;
  }
  return "Resolving signed URL expiry…";
}
