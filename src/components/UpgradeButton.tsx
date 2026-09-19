import { Button, type ButtonProps } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import type { LifetimeTier } from "@/lib/hub";

type Plan = LifetimeTier | "bundle";

interface UpgradeButtonProps extends Omit<ButtonProps, "asChild" | "onClick"> {
  plan?: Plan;
  label?: string;
  source?: string;
}

export function UpgradeButton({
  plan = "creator",
  source = "promotion_access_button",
  className,
  variant,
  size,
  ...rest
}: UpgradeButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className} {...rest}>
      <a
        href="/app"
        onClick={() => trackEvent("promotion_open_app_click", { plan, source })}
      >
        Use free during promotion
      </a>
    </Button>
  );
}
