import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchActiveCreditPacks, FALLBACK_CREDIT_PACKS, type CreditPack } from "@/lib/credit-packs";
import { trackEvent } from "@/lib/analytics";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

export function CreditPacksSection() {
  const [packs, setPacks] = useState<CreditPack[]>(FALLBACK_CREDIT_PACKS);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (FREE_PROMOTION_ACTIVE) return;
    let cancelled = false;
    fetchActiveCreditPacks().then((rows) => {
      if (!cancelled && rows.length > 0) setPacks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cheapest = packs.reduce((min, p) => Math.min(min, p.priceZAR), Infinity);

  if (FREE_PROMOTION_ACTIVE) {
    return (
      <section className="py-14 px-4" aria-labelledby="credit-packs-heading">
        <div className="max-w-3xl mx-auto rounded-2xl border border-primary/25 bg-primary/5 p-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary mb-4">
            <Sparkles className="w-3 h-3" /> {FREE_PROMOTION.shortLabel}
          </div>
          <h2 id="credit-packs-heading" className="text-3xl font-display font-extrabold tracking-tight">
            Credit purchases are paused
          </h2>
          <p className="mt-3 text-muted-foreground">
            {FREE_PROMOTION.description} Image generation, narration, publishing, and export access are included during the promotion.
          </p>
        </div>
      </section>
    );
  }

  const handleBuy = async (pack: CreditPack) => {
    if (FREE_PROMOTION_ACTIVE) {
      toast.message("Credit purchases are paused during the free-access promotion.");
      return;
    }
    setLoadingId(pack.id);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        toast.error("Please sign in to purchase a pack.");
        window.location.href = "/auth?next=/pricing";
        return;
      }

      trackEvent("paystack_checkout_intent", { pack_id: pack.id, amount_zar: pack.priceZAR });

      const { data, error } = await supabase.functions.invoke("paystack-checkout-init", {
        body: {
          pack_id: pack.id,
          callback_url: `${window.location.origin}/checkout/return?status=complete&provider=paystack`,
        },
      });

      if (error || !data?.authorization_url) {
        console.error("Paystack init failed", error, data);
        toast.error("Could not start checkout. Please try again.");
        return;
      }

      window.location.href = data.authorization_url as string;
    } catch (err) {
      console.error(err);
      toast.error("Checkout failed. Please try again.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section className="py-14 px-4" aria-labelledby="credit-packs-heading">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary mb-4">
            <Sparkles className="w-3 h-3" /> Once-off credits
          </div>
          <h2 id="credit-packs-heading" className="text-3xl md:text-4xl font-display font-extrabold tracking-tight">
            Publish once-off from <span className="gradient-text">R{Number.isFinite(cheapest) ? cheapest : 149}</span>
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Buy a credit pack, create and export your book, top up only when you need more. Paid securely with Paystack (ZAR).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`relative rounded-2xl border p-6 flex flex-col bg-card/60 backdrop-blur ${
                pack.highlight ? "border-primary shadow-lg shadow-primary/10" : "border-border"
              }`}
            >
              {pack.highlight && (
                <Badge className="absolute -top-3 left-6" variant="default">Most popular</Badge>
              )}
              <h3 className="text-xl font-semibold">{pack.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground min-h-[3rem]">{pack.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">R{pack.priceZAR}</span>
                <span className="text-sm text-muted-foreground">once-off</span>
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-primary" />
                  {pack.imageCredits} premium AI images
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-primary" />
                  {(pack.ttsCredits / 1000).toFixed(0)}k characters of ElevenLabs narration
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-primary" />
                  PDF / HTML / ePub export
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-primary" />
                  Credits never expire
                </li>
              </ul>
              <Button
                className="mt-6"
                variant={pack.highlight ? "default" : "outline"}
                disabled={loadingId === pack.id}
                onClick={() => handleBuy(pack)}
                aria-label={`Buy ${pack.name} for R${pack.priceZAR}`}
              >
                {loadingId === pack.id ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting…</>
                ) : (
                  <>Buy {pack.name}</>
                )}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Secure checkout via Paystack. Once-off credit packs — nothing recurs, nothing to cancel.{" "}
          <a href="https://reson8.life/pricing" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            View hub pricing ↗
          </a>
        </p>
      </div>
    </section>
  );
}
