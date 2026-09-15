// Per-user setting for how long signed chapter-image URLs stay valid.
// Defaults to whatever the admin configured in app_settings; users can
// override here (saved in localStorage) without affecting anyone else.
import { useEffect, useState } from "react";
import { Clock, History, Lock, Timer } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getViewerTtlOverride,
  setViewerTtlOverride,
  getViewerTtlChangedAt,
  isViewerTtlOverrideAllowed,
  getCountdownBadgeVisible,
  setCountdownBadgeVisible,
  subscribeCountdownBadgeVisible,
  VIEWER_TTL_PRESETS,
  type ViewerTtlOption,
} from "@/lib/signed-image-url";

function labelFor(value: ViewerTtlOption): string {
  return VIEWER_TTL_PRESETS.find((p) => p.value === value)?.label ?? String(value);
}

export function ImageViewerSettings() {
  const [value, setValue] = useState<ViewerTtlOption>(() => {
    const o = getViewerTtlOverride();
    return (o ?? "default") as ViewerTtlOption;
  });
  const [changedAt, setChangedAt] = useState<string | null>(() => getViewerTtlChangedAt());
  const [allowed, setAllowed] = useState<boolean>(true);
  const [countdownVisible, setCountdownVisibleState] = useState<boolean>(
    () => getCountdownBadgeVisible(),
  );

  // Keep the countdown-badge toggle in sync across tabs / panels.
  useEffect(() => {
    return subscribeCountdownBadgeVisible(() => setCountdownVisibleState(getCountdownBadgeVisible()));
  }, []);

  // Resolve the admin-controlled "user override allowed" flag.
  useEffect(() => {
    let cancelled = false;
    void isViewerTtlOverrideAllowed().then((v) => { if (!cancelled) setAllowed(v); });
    return () => { cancelled = true; };
  }, []);

  // Keep the "last changed" label in sync if another component changes it.
  useEffect(() => {
    const refresh = () => {
      const o = getViewerTtlOverride();
      setValue((o ?? "default") as ViewerTtlOption);
      setChangedAt(getViewerTtlChangedAt());
    };
    window.addEventListener("resonance:viewer-ttl-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("resonance:viewer-ttl-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const disabled = !allowed;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <Label htmlFor="viewer-ttl" className="text-muted-foreground whitespace-nowrap">
          Image link expiry
        </Label>
        <Select
          value={String(value)}
          disabled={disabled}
          onValueChange={(v) => {
            const next = (v === "default" ? "default" : Number(v)) as ViewerTtlOption;
            setValue(next);
            setViewerTtlOverride(next);
            setChangedAt(getViewerTtlChangedAt());
          }}
        >
          <SelectTrigger id="viewer-ttl" className="h-8 w-[170px] text-xs" title={disabled ? "Locked by admin — using server default" : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEWER_TTL_PRESETS.map((p) => (
              <SelectItem key={String(p.value)} value={String(p.value)}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {disabled && <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Locked by admin" />}
      </div>
      <div
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground pl-5"
        title={changedAt ? new Date(changedAt).toLocaleString() : "Never changed"}
      >
        <History className="w-3 h-3" />
        <span>
          {disabled ? (
            <>Locked by admin · using server default</>
          ) : (
            <>
              Last selected: <span className="font-medium text-foreground">{labelFor(value)}</span>
              {changedAt
                ? <> · changed {new Date(changedAt).toLocaleString()}</>
                : <> · using server default</>}
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs pt-1">
        <Timer className="w-3.5 h-3.5 text-muted-foreground" />
        <Label htmlFor="viewer-countdown" className="text-muted-foreground whitespace-nowrap">
          Show expiry countdown
        </Label>
        <Switch
          id="viewer-countdown"
          checked={countdownVisible}
          onCheckedChange={(v) => {
            setCountdownVisibleState(v);
            setCountdownBadgeVisible(v);
          }}
          aria-label="Show signed-URL expiry countdown badge in the image viewer"
        />
        <span className="text-[11px] text-muted-foreground">
          {countdownVisible ? "Visible on image tiles" : "Hidden"}
        </span>
      </div>
    </div>
  );
}
