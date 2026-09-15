import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Leaf, X, Settings2 } from "lucide-react";
import { setTtsMode, setImageMode } from "@/lib/cost-mode";

/**
 * Floats a small dismissible banner inside the VisualBook screen whenever the
 * server reports `autoEco=true` (monthly budget ≥ 80% spent → free providers).
 *
 * Listens to the `auto-eco-active` window event dispatched by `tts-client.ts`
 * and `storyforge-api.generateChapterImage` when they detect the header /
 * payload flag. Tracks which services (tts | image) have triggered so the copy
 * is accurate.
 *
 * Dismissal is per-session (sessionStorage) — comes back on reload so the user
 * is reminded if budget is still exhausted on their next visit.
 */
const SESSION_KEY = "auto-eco-banner-dismissed";

export function AutoEcoBanner() {
  const [services, setServices] = useState<Set<"tts" | "image">>(new Set());
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { service?: "tts" | "image" } | undefined;
      const svc = detail?.service;
      if (svc !== "tts" && svc !== "image") return;
      setServices((prev) => {
        if (prev.has(svc)) return prev;
        const next = new Set(prev);
        next.add(svc);
        return next;
      });
    };
    window.addEventListener("auto-eco-active", handler);
    return () => window.removeEventListener("auto-eco-active", handler);
  }, []);

  const visible = services.size > 0 && !dismissed;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch { /* ignore */ }
  };

  const handleForcePremium = () => {
    if (services.has("tts")) setTtsMode("premium");
    if (services.has("image")) setImageMode("premium");
    handleDismiss();
  };

  const what =
    services.has("tts") && services.has("image") ? "Narration & images" :
    services.has("tts") ? "Narration" : "Images";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
            <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center">
              <Leaf className="w-4 h-4 text-accent" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Eco mode auto-engaged
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {what} are temporarily using free providers because this month's premium budget is ≥80% spent.
                Quality returns to premium once the budget resets — or override below.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                <button
                  onClick={handleForcePremium}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
                >
                  <Settings2 className="w-3 h-3" />
                  Force premium for me
                </button>
                <span className="text-[10px] text-muted-foreground/70">
                  (counts against your add-on credits)
                </span>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              aria-label="Dismiss eco mode notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
