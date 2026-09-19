import { Sparkles } from "lucide-react";
import { FREE_PROMOTION } from "@/lib/promotion";

export function CreditPacksSection() {
  return (
    <section className="py-14 px-4" aria-labelledby="credit-packs-heading">
      <div className="max-w-3xl mx-auto rounded-2xl border border-primary/25 bg-primary/5 p-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary mb-4">
          <Sparkles className="w-3 h-3" /> {FREE_PROMOTION.shortLabel}
        </div>
        <h2 id="credit-packs-heading" className="text-3xl font-display font-extrabold tracking-tight">
          Generation access is included
        </h2>
        <p className="mt-3 text-muted-foreground">
          {FREE_PROMOTION.description} Image generation, narration, publishing, and export are included while usage costs are measured.
        </p>
      </div>
    </section>
  );
}
