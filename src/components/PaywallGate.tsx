import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { useUserTier } from "@/hooks/useUserTier";
import { tierMeets, type Tier } from "@/lib/hub";
import { UpgradeButton } from "@/components/UpgradeButton";
import { Button } from "@/components/ui/button";
import type { UpgradeRequiredBody } from "@/lib/hub-402";

interface PaywallGateProps {
  /** Minimum tier required to view children. */
  tier: Exclude<Tier, null | "free">;
  /** Plan to upsell when the user is below `tier`. Defaults to `tier`. */
  upsellPlan?: "starter" | "creator" | "pro" | "business";
  children: ReactNode;
  /** Optional custom fallback. Defaults to a centred upgrade card. */
  fallback?: ReactNode;
  /**
   * When present, a hub 402 `upgrade_required` payload was captured from a
   * recent edge call. Its `upgrade_url` wins over the local Hub deep-link
   * so the user lands on the exact plan the server asked for.
   * See docs/hub-snippets/spoke-payment-gate-brief.md §4.
   */
  upgradeBody?: UpgradeRequiredBody | null;
}

/**
 * Hides children unless the current user's effective tier (resolved via the
 * Hub at reson8.life with local Supabase fallback) meets the required tier.
 *
 * Usage:
 *   <PaywallGate tier="pro"><PremiumNarration /></PaywallGate>
 */
export function PaywallGate({
  tier,
  upsellPlan,
  children,
  fallback,
  upgradeBody,
}: PaywallGateProps) {
  const { effectiveTier, isLoggedIn } = useUserTier();
  const have: Tier = isLoggedIn ? (effectiveTier as Tier) : null;

  if (tierMeets(have, tier)) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <div className="rounded-lg border border-border bg-card/60 backdrop-blur p-6 text-center space-y-3">
      <h3 className="text-lg font-semibold text-foreground">
        {tier.charAt(0).toUpperCase() + tier.slice(1)} plan required
      </h3>
      <p className="text-sm text-muted-foreground">
        Upgrade on The Resonance to unlock this feature.
      </p>
      {upgradeBody ? (
        <Button asChild>
          <a
            href={upgradeBody.upgrade_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            Unlock on The Resonance
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </Button>
      ) : (
        <UpgradeButton plan={upsellPlan ?? tier} source={`paywall_gate_${tier}`} />
      )}
    </div>
  );
}
