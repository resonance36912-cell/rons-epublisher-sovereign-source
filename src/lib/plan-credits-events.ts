// Lightweight pub/sub for plan credit ledger changes so badges can refresh
// live after a generation call consumes plan credits.
export const PLAN_CREDITS_CHANGED = "plan-credits-changed";

export function notifyPlanCreditsChanged(detail?: { consumed?: number; remaining?: number }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAN_CREDITS_CHANGED, { detail }));
}
