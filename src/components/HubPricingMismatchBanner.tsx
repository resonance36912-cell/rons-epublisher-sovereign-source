import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  runHubPricingCheck,
  subscribePricingMismatches,
  type PriceMismatch,
} from "@/lib/hub-pricing-check";

/**
 * Mounts once at the app root. Silently runs a Hub-vs-local price
 * diff on first render of each session. Renders a dismissible banner
 * only if mismatches are detected (so production users see nothing
 * when prices are aligned).
 */
export function HubPricingMismatchBanner() {
  const [mismatches, setMismatches] = useState<PriceMismatch[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsub = subscribePricingMismatches(setMismatches);
    void runHubPricingCheck();
    return unsub;
  }, []);

  if (dismissed || mismatches.length === 0) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl border border-amber-500/40 bg-amber-500/10 backdrop-blur-xl p-3 text-xs shadow-lg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-amber-200 mb-1">Pricing out of sync with Hub</p>
          <ul className="space-y-0.5 text-amber-100/90 font-mono">
            {mismatches.map((m) => (
              <li key={m.plan}>
                {m.plan}: local R{m.local} ≠ hub R{m.hub}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss pricing warning"
          className="text-amber-200/70 hover:text-amber-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
