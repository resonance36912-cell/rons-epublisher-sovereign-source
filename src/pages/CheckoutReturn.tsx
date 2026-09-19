import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { FREE_PROMOTION } from "@/lib/promotion";

export default function CheckoutReturn() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md w-full mx-auto p-8">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>
        <p className="text-xs font-mono uppercase tracking-[0.22em] text-primary">{FREE_PROMOTION.shortLabel}</p>
        <h1 className="mt-2 text-2xl font-bold text-foreground">No checkout is required</h1>
        <p className="mt-3 text-muted-foreground">
          {FREE_PROMOTION.description} This route is retained only for compatibility with older links.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Historical transaction records remain in the audit systems, but new purchases and payment verification are disabled.
        </p>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link to="/app" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90">
            Open ePublisher free
          </Link>
          <Link to="/account" className="inline-block px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted">
            View account
          </Link>
        </div>
      </div>
    </div>
  );
}
