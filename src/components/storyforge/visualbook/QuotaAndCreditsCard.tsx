import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Coins, Gauge, Sparkles, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { UsageQuotaWidget } from "./UsageQuotaWidget";
import { AddonCreditsWidget } from "./AddonCreditsWidget";
import { PlanCreditsBadge } from "@/components/PlanCreditsBadge";
import { usePlanCredits } from "@/hooks/usePlanCredits";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

/**
 * Unified collapsible card combining tier quotas and add-on credits.
 * Saves vertical space at the top of VisualBook by collapsing each section.
 * Surfaces a top-level warning when plan credits are empty so premium
 * actions can be visibly gated.
 */
export function QuotaAndCreditsCard() {
  const { empty, loading } = usePlanCredits();

  if (FREE_PROMOTION_ACTIVE || OPEN_NOVA_LOCAL_ONLY) {
    return (
      <div className="border rounded-lg bg-card/50 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{FREE_PROMOTION_ACTIVE ? FREE_PROMOTION.shortLabel : "Open Nova local mode"}:</span>{" "}
        all ePublisher features are available without payment. Usage is metered internally for costing, while provider safety and fair-use limits still apply.
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card/50 backdrop-blur-sm overflow-hidden">
      {!loading && empty && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Plan credits exhausted</p>
            <p className="text-destructive/80 mt-0.5">
              Premium generation is paused. Free/eco providers still work, or{" "}
              <Link to="/pricing" className="underline font-medium hover:text-destructive">
                top up
              </Link>{" "}
              to keep generating premium content.
            </p>
          </div>
        </div>
      )}

      <Accordion type="multiple" defaultValue={["plan"]} className="w-full">
        <AccordionItem value="plan" className="border-b">
          <AccordionTrigger className="px-4 py-2.5 text-xs font-medium hover:no-underline hover:bg-muted/30">
            <div className="flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-primary" />
              <span>Plan credits</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-0">
            <PlanCreditsBadge />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="quota" className="border-b">
          <AccordionTrigger className="px-4 py-2.5 text-xs font-medium hover:no-underline hover:bg-muted/30">
            <div className="flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-primary" />
              <span>Tier quota</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-0">
            <UsageQuotaWidget />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="credits" className="border-b-0">
          <AccordionTrigger className="px-4 py-2.5 text-xs font-medium hover:no-underline hover:bg-muted/30">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Add-on credits</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-0">
            <AddonCreditsWidget />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
