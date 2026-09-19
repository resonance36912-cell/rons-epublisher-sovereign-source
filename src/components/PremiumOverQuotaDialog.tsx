import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Coins, Sparkles, TrendingUp } from "lucide-react";
import { subscribePremiumOverQuotaRequests, type OverQuotaConsentRequest } from "@/lib/premium-quota-gate";
import { HUB_PRICING_URL, hubTopupUrl } from "@/lib/hub";
import { logTopupCheckout } from "@/lib/payfast-checkout-log";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

export function PremiumOverQuotaDialog() {
  const [req, setReq] = useState<OverQuotaConsentRequest | null>(null);

  useEffect(
    () =>
      subscribePremiumOverQuotaRequests((r) => {
        if (FREE_PROMOTION_ACTIVE) {
          r.resolve(true);
          return;
        }
        setReq(r);
      }),
    [],
  );

  const decide = (consent: boolean) => {
    if (!req) return;
    req.resolve(consent);
    setReq(null);
  };

  if (FREE_PROMOTION_ACTIVE || !req) return null;

  const est = req.estimatedUnits;
  const estCost = est ? est * req.perUnitCost : null;
  const planCreditsEmpty = req.planCreditsRemaining < req.planCreditCost;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) decide(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Premium quota exceeded
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                You've used <strong>{req.used.toLocaleString()}</strong> of your{" "}
                <strong>{req.limit.toLocaleString()}</strong> daily {req.label} allowance and have
                no add-on credits remaining.
              </p>

              <div className={`rounded-md border p-3 space-y-1 ${
                planCreditsEmpty
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-primary/30 bg-primary/5"
              }`}>
                <div className={`flex items-center gap-2 font-medium ${
                  planCreditsEmpty ? "text-destructive" : "text-primary"
                }`}>
                  <Coins className="h-4 w-4" />
                  Plan credits: {req.planCreditsRemaining.toLocaleString()} left
                  <span className="text-muted-foreground font-normal">
                    (needs {req.planCreditCost})
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {planCreditsEmpty
                    ? "Your credit balance won't cover this call. Buy credits or unlock a project pack to continue using premium providers without overage charges."
                    : "Your plan credits can cover this call — continuing will debit them automatically."}
                </p>
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                  <Coins className="h-4 w-4" />
                  Overage charge (if you authorize)
                </div>
                <p className="text-muted-foreground">
                  Continuing without credits will charge <strong>${req.perUnitCost.toFixed(4)}</strong> per {req.unit}
                  {estCost !== null && (
                    <> — about <strong>${estCost.toFixed(2)}</strong> for this request (~{est} {req.unit}s)</>
                  )}
                  . Charges are billed via add-on credits or your next invoice.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: switch to <strong>Eco</strong> or <strong>Auto</strong> mode in Cost &amp; Quality
                Preferences to use free providers instead.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => decide(false)}>
                  <a
                    href={hubTopupUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => logTopupCheckout("premium_over_quota_dialog")}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Buy credit top-up
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => decide(false)}>
                  <a href={HUB_PRICING_URL} target="_blank" rel="noopener noreferrer">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Upgrade plan
                  </a>
                </Button>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => decide(true)}>
            Authorize charge &amp; continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
