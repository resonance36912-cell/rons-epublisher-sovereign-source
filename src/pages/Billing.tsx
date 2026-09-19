import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Seo } from "@/components/Seo";
import { FREE_PROMOTION } from "@/lib/promotion";

export default function Billing() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Seo
        title="Free Access Promotion — Resonance ePublisher"
        description={FREE_PROMOTION.description}
        path="/billing"
      />
      <div className="w-full max-w-xl rounded-2xl border border-primary/20 bg-card/60 backdrop-blur-xl shadow-brand-glow">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight">Free promotional access</h1>
              <p className="text-sm text-muted-foreground mt-1">Billing and checkout are paused</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <Alert>
            <AlertTitle>No payment required during the promotion</AlertTitle>
            <AlertDescription>
              {FREE_PROMOTION.description} Historical purchase records are preserved for audit and support, but no new
              ePublisher payment or top-up is required while promotional access is active.
            </AlertDescription>
          </Alert>

          <Button asChild className="w-full bg-gradient-brand text-white rounded-full">
            <Link to="/app">Open ePublisher free</Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            Need help with an older purchase or refund?{" "}
            <Link to="/contact" className="text-primary hover:underline inline-flex items-center gap-1">
              <Mail className="w-3 h-3" /> Contact support
            </Link>
            .
          </p>

          <div className="pt-3 border-t border-white/10">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/app">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to app
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
