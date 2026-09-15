import { ArrowUpRight } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { hubCheckoutUrl, type LifetimeTier } from "@/lib/hub";
import { logSubscriptionCheckout, verifyCheckoutPriceOrToast } from "@/lib/payfast-checkout-log";

type Plan = LifetimeTier | "bundle";

interface UpgradeButtonProps extends Omit<ButtonProps, "asChild" | "onClick"> {
  plan?: Plan;
  label?: string;
  /** Where the button is rendered (for audit logs). */
  source?: string;
}

/**
 * Sends the user to the Resonance Hub checkout for the given lifetime
 * unlock SKU. Billing is owned by the Hub at reson8.life — this app
 * never processes cards directly.
 */
export function UpgradeButton({
  plan = "creator",
  label = "Unlock on The Resonance",
  source = "upgrade_button",
  className,
  variant,
  size,
  ...rest
}: UpgradeButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className} {...rest}>
      <a
        href={hubCheckoutUrl(plan)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (plan === "bundle") return;
          if (!verifyCheckoutPriceOrToast(plan, "once", source)) {
            e.preventDefault();
            return;
          }
          logSubscriptionCheckout(plan, "once", source);
        }}
        className="inline-flex items-center gap-1.5"
      >
        {label}
        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
      </a>
    </Button>
  );
}
