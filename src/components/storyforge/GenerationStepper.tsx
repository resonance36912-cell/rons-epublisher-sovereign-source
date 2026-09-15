import { Check, Loader2, AlertTriangle, FileText, Mic, Search, Sparkles, Circle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type StepStatus = "idle" | "active" | "done" | "error";

export type GenerationStep = {
  /** Stable identifier used by the controller hook. */
  id: "review" | "transcribe" | "search" | "generate";
  label: string;
  /** Sub-line shown under the label while the step is active. */
  hint?: string;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  /** Populated when status is "error". */
  error?: string;
};

const ICONS: Record<GenerationStep["id"], React.ComponentType<{ className?: string }>> = {
  review: FileText,
  transcribe: Mic,
  search: Search,
  generate: Sparkles,
};

function fmtClock(ms?: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(start?: number, end?: number) {
  if (!start) return null;
  const elapsed = (end ?? Date.now()) - start;
  if (elapsed < 1000) return `${elapsed}ms`;
  const s = elapsed / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary border border-primary/30">
        <Check className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary border border-primary/40">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-destructive/15 text-destructive border border-destructive/40">
        <AlertTriangle className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground border border-border">
      <Circle className="w-2.5 h-2.5 fill-current opacity-60" />
    </span>
  );
}

export function GenerationStepper({
  steps,
  className,
}: {
  steps: GenerationStep[];
  className?: string;
}) {
  return (
    <div
      className={`bg-card border rounded-xl p-4 sm:p-5 ${className || ""}`}
      role="status"
      aria-live="polite"
      aria-label="Storyboard generation progress"
    >
      <ol className="space-y-3">
        {steps.map((step, i) => {
          const Icon = ICONS[step.id];
          const last = i === steps.length - 1;
          const duration = fmtDuration(step.startedAt, step.endedAt);
          return (
            <li key={step.id} className="relative">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <StatusBadge status={step.status} />
                  {!last && (
                    <span
                      aria-hidden
                      className={`w-px flex-1 mt-1 mb-1 min-h-[18px] ${
                        step.status === "done" ? "bg-primary/40" : "bg-border"
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`w-3.5 h-3.5 ${
                          step.status === "done" || step.status === "active"
                            ? "text-primary"
                            : step.status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          step.status === "idle" ? "text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground tabular-nums">
                      {step.startedAt && (
                        <span title={`Started at ${fmtClock(step.startedAt)}`}>
                          {fmtClock(step.startedAt)}
                          {step.endedAt && step.endedAt !== step.startedAt && ` → ${fmtClock(step.endedAt)}`}
                        </span>
                      )}
                      {duration && (
                        <span
                          className={`px-1.5 py-0.5 rounded border ${
                            step.status === "active"
                              ? "border-primary/30 text-primary"
                              : step.status === "error"
                              ? "border-destructive/30 text-destructive"
                              : "border-border"
                          }`}
                        >
                          {duration}
                        </span>
                      )}
                    </div>
                  </div>
                  <AnimatePresence>
                    {step.status === "active" && step.hint && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-xs text-muted-foreground mt-1 truncate"
                      >
                        {step.hint}
                      </motion.div>
                    )}
                    {step.status === "error" && step.error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-xs text-destructive mt-1 break-words"
                      >
                        {step.error}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
