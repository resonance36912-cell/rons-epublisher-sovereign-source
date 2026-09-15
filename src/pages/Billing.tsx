import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, CreditCard, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Seo } from "@/components/Seo";
import { HUB_BILLING_URL, HUB_PRICING_URL } from "@/lib/hub";

export default function Billing() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Seo
        title="Purchases — Resonance ePublisher"
        description="View your Resonance ePublisher unlocks and credit packs. Purchases are managed on The Resonance hub at reson8.life."
        path="/billing"
      />
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl shadow-brand-glow">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <CreditCard className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight">Purchases</h1>
              <p className="text-sm text-muted-foreground mt-1">Once-off unlocks & credit packs, managed on The Resonance</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <Alert>
            <AlertTitle>No subscriptions here</AlertTitle>
            <AlertDescription>
              Every Resonance app is pay-once, own-forever. Unlocks and credit pack top-ups
              for ePublisher are handled centrally on <strong>reson8.life</strong> — no recurring bill.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="flex-1 bg-gradient-brand text-white rounded-full">
              <a href={HUB_BILLING_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5">
                View purchases <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </Button>
            <Button asChild variant="outline" className="flex-1 rounded-full">
              <a href={HUB_PRICING_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5">
                See unlocks <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Question about a purchase or refund?{" "}
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
