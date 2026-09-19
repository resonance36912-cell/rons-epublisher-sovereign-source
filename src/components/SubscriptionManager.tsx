import { useUserTier } from "@/hooks/useUserTier";
import { Button } from "@/components/ui/button";
import { Crown, ArrowUpRight } from "lucide-react";
import { HUB_BILLING_URL } from "@/lib/hub";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

/**
 * Once-off SKU labels shown in the account "Purchase" card and used by
 * the price-parity test. All plans are now permanent unlocks — no
 * monthly or annual billing.
 */
export const PLAN_LABELS: Record<string, { name: string; price: string }> = {
  lifetime_starter:  { name: "Starter",  price: "R99 once-off"  },
  lifetime_creator:  { name: "Creator",  price: "R249 once-off" },
  lifetime_pro:      { name: "Pro",      price: "R499 once-off" },
  lifetime_business: { name: "Business", price: "R699 once-off" },

  // Legacy purchase IDs kept for users who bought under the old catalog.
  starter_once_off:  { name: "Starter (legacy)",  price: "R99"  },
  creator_once_off:  { name: "Creator (legacy)",  price: "R249" },
  standard_once_off: { name: "Creator (legacy)",  price: "R249" },
  pro_once_off:      { name: "Pro (legacy)",      price: "R499" },
  premium_once_off:  { name: "Pro (legacy)",      price: "R499" },
  business_once_off: { name: "Business (legacy)", price: "R699" },
  ultimate_once_off: { name: "Business (legacy)", price: "R699" },
};

const TIER_TO_SKU: Record<string, string> = {
  starter:  "lifetime_starter",
  creator:  "lifetime_creator",
  standard: "lifetime_creator",
  pro:      "lifetime_pro",
  premium:  "lifetime_pro",
  business: "lifetime_business",
};

/**
 * Read-only display of the user's current lifetime unlock. All purchase
 * flows are delegated to the Resonance Hub at reson8.life.
 */
export function SubscriptionManager() {
  const { tier, effectiveTier } = useUserTier();

  if (FREE_PROMOTION_ACTIVE) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-3">
          <Crown className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-display font-bold">Full promotional access</h3>
            <p className="text-sm text-muted-foreground">{FREE_PROMOTION.description}</p>
          </div>
        </div>
      </div>
    );
  }
  if (tier === "free") return null;

  const sku = TIER_TO_SKU[effectiveTier] ?? TIER_TO_SKU[tier];
  const plan = PLAN_LABELS[sku] ?? { name: "Active unlock", price: "" };

  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Crown className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-display font-bold text-lg">{plan.name} unlock</h3>
          {plan.price && <p className="text-sm text-muted-foreground">{plan.price}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          Status: <span className="text-green-400 font-medium">Active</span> · Lifetime access
        </p>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a href={HUB_BILLING_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5">
            View purchases on The Resonance <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}
