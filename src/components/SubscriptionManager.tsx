import { Crown } from "lucide-react";
import { FREE_PROMOTION } from "@/lib/promotion";

export function SubscriptionManager() {
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
