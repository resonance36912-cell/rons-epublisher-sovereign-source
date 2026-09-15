/**
 * Client helper for parsing hub `upgrade_required` (HTTP 402) responses
 * returned by edge functions that run the `requireTier` gate.
 *
 * Response body shape is defined in
 * docs/hub-snippets/spoke-payment-gate-brief.md §3.
 */

export type Tier = "free" | "starter" | "creator" | "pro" | "business" | "all_access";

export interface UpgradeRequiredBody {
  error: "upgrade_required";
  app: string;
  required_tier: Tier;
  current_tier: Tier;
  status: "active" | "pending" | "past_due" | "cancelled" | "inactive";
  upgrade_url: string;
  manage_url: string;
}

export function isUpgradeRequiredBody(v: unknown): v is UpgradeRequiredBody {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return b.error === "upgrade_required" && typeof b.upgrade_url === "string";
}

/**
 * Given a Supabase Functions error, try to read a hub 402 upgrade payload
 * from its response context. Returns null when the error is not a 402
 * upgrade_required.
 */
export async function readUpgradeRequired(err: unknown): Promise<UpgradeRequiredBody | null> {
  if (!err || typeof err !== "object" || !("context" in err)) return null;
  try {
    const context = (err as { context?: { text?: () => Promise<string> } }).context;
    if (!context?.text) return null;
    const text = await context.text();
    const json = JSON.parse(text) as unknown;
    return isUpgradeRequiredBody(json) ? json : null;
  } catch {
    return null;
  }
}

/** Open the hub upgrade URL in a new tab. */
export function openUpgrade(body: UpgradeRequiredBody): void {
  if (typeof window === "undefined") return;
  window.open(body.upgrade_url, "_blank", "noopener,noreferrer");
}
