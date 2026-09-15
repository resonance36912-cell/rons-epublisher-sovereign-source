import { useEffect, useState } from "react";

/** Returns a human-friendly "Saved Xs ago" label that auto-refreshes every 15s. */
export function useLastSavedLabel(lastSavedAt: Date | null): string {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function update() {
      if (!lastSavedAt) {
        setLabel("");
        return;
      }
      const diffSec = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
      if (diffSec < 10) setLabel("Saved just now");
      else if (diffSec < 60) setLabel(`Saved ${diffSec}s ago`);
      else setLabel(`Saved ${Math.floor(diffSec / 60)}m ago`);
    }
    update();
    const id = setInterval(update, 15_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  return label;
}

export function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
