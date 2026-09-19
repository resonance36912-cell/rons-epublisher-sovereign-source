import { useEffect } from "react";
import { subscribePremiumOverQuotaRequests } from "@/lib/premium-quota-gate";

/**
 * During the free promotion, premium-provider quota prompts never request payment.
 * We still record provider usage upstream; this component simply approves the job.
 */
export function PremiumOverQuotaDialog() {
  useEffect(
    () =>
      subscribePremiumOverQuotaRequests((request) => {
        request.resolve(true);
      }),
    [],
  );

  return null;
}
