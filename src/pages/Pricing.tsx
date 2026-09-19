import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, Rocket, Star, Crown, Check, Brain, Infinity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/storyforge/PageHeader";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { Seo } from "@/components/Seo";
import { useI18n } from "@/lib/i18n";
import { HUB_URL, HUB_PRICING_URL, hubPackCheckoutUrl, type HubPackId } from "@/lib/hub";
import { trackEvent } from "@/lib/analytics";
import { AddonCreditsWidget } from "@/components/storyforge/visualbook/AddonCreditsWidget";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

/**
 * Public purchase catalog mirrored from the Hub PACK_CATALOG.
 * Checkout always resolves on reson8.life by pack id; no local payment signing.
 */
export const TIERS = [
  { id: "free", name: "Free", price: "R0", sub: "Forever", bundle: null, icon: Sparkles, desc: "Sample the platform — text, sample research, browser narration." },
  { id: "epublisher_starter_pack", name: "Starter Pack", price: "R99", sub: "Once-off", bundle: "+ 99 credits", icon: Rocket, desc: "1 project · standard ePub export · watermark-free preview." },
  { id: "epublisher_creator_pack", name: "Creator Pack", price: "R299", sub: "Once-off", bundle: "+ 299 credits", icon: Star, desc: "3 projects · narration credits · AV export.", popular: true },
  { id: "epublisher_studio_pack", name: "Studio Pack", price: "R699", sub: "Once-off", bundle: "+ 699 credits", icon: Crown, desc: "10 projects · custom voices · priority render queue." },
] as const;

const BENEFITS = [
  "Pay once — nothing recurring, ever",
  "Bundled credits included in every paid pack",
  "Top up with once-off credit packs or project packs whenever you need more",
  "Official pricing, checkout & bundles managed by The Resonance Hub",
  "🇿🇦 Built in South Africa, POPIA-conscious",
];

export default function Pricing() {
  const { t } = useI18n();

  if (FREE_PROMOTION_ACTIVE) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Seo
          title="Free Access Promotion — Resonance ePublisher"
          description={FREE_PROMOTION.description}
          path="/pricing"
        />
        <PageHeader links={[
          { to: "/", label: t("nav.home") },
          { to: "/about", label: t("nav.about") },
          { to: "/contact", label: t("nav.contact") },
        ]} />
        <main className="flex-1 py-20 px-4">
          <div className="max-w-3xl mx-auto text-center rounded-3xl border border-primary/25 bg-card/60 p-8 sm:p-12 shadow-brand-glow">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary mb-5">
              <Sparkles className="w-3 h-3" /> {FREE_PROMOTION.shortLabel}
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-extrabold tracking-tight">
              {FREE_PROMOTION.headline}
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">{FREE_PROMOTION.description}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in so your real usage can help us understand provider costs, demand, and sustainable future pricing.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-gradient-brand text-white rounded-full">
                <Link to="/app">Open ePublisher free</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full">
                <a href={HUB_URL} target="_blank" rel="noopener noreferrer">Back to Resonance Hub</a>
              </Button>
            </div>
          </div>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Seo
        title="Pricing — Resonance ePublisher"
        description="Once-off ePublisher packs in ZAR via The Resonance Hub: Starter R99, Creator R299, Studio R699. No recurring app fees."
        path="/pricing"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Resonance ePublisher",
          applicationCategory: "CreativeWork",
          operatingSystem: "Web",
          isPartOf: { "@type": "Organization", name: "The Resonance", url: HUB_URL },
          offers: TIERS.map(tier => ({
            "@type": "Offer",
            name: tier.name,
            price: tier.price.replace("R", ""),
            priceCurrency: "ZAR",
            category: "OneTime",
          })),
        }}
      />
      <PageHeader links={[
        { to: "/", label: t("nav.home") },
        { to: "/about", label: t("nav.about") },
        { to: "/contact", label: t("nav.contact") },
      ]} />

      <main className="flex-1 py-14 sm:py-20 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Eyebrow + hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary mb-4">
              <Infinity className="w-3 h-3" /> Once-off packs. No recurring app fees.
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl md:text-6xl font-display font-extrabold tracking-tight leading-[1.05]"
            >
              No recurring billing.{" "}
              <span className="gradient-text">Just packs &amp; credits.</span>
            </motion.h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
              Buy ePublisher project packs through The Resonance Hub.
              Nothing recurs — start free, top up when you need more.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-7">
              <Button
                asChild
                size="lg"
                className="bg-gradient-brand text-white shadow-brand-glow rounded-full"
                onClick={() => trackEvent("pricing_hub_cta", { destination: "pricing" })}
              >
                <a href={HUB_PRICING_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                  View hub pricing <ArrowUpRight className="w-4 h-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full border-white/15">
                <Link to="/app">Start free in ePublisher</Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="rounded-full">
                <a href={HUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("back_to_hub_click", { location: "pricing_hero" })} className="inline-flex items-center gap-2">
                  Back to hub <ArrowUpRight className="w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>

          {/* Attribute chip */}
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl px-5 py-3 text-sm">
              <Brain className="w-5 h-5 text-primary" aria-hidden="true" />
              <span><strong>Intelligence (IQ) 🧠</strong> — ePublisher is the publishing brain of The Resonance ecosystem.</span>
            </div>
          </div>

          {/* Unlock grid */}
          <h2 className="text-2xl font-display font-bold mb-4">Choose a once-off ePublisher pack</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {TIERS.map((tier, i) => {
              const Icon = tier.icon;
              const isPaid = tier.id !== "free";
              const popular = "popular" in tier && tier.popular;
              return (
                <motion.div
                  key={tier.id}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.45 }}
                  className={`relative rounded-2xl border bg-card/60 backdrop-blur-xl p-5 flex flex-col ${
                    popular ? "border-primary/60 shadow-brand-glow" : "border-white/10"
                  }`}
                >
                  {popular && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-gradient-brand text-white border-0">
                      Best value
                    </Badge>
                  )}
                  <Icon className={`w-6 h-6 mb-3 ${popular ? "text-primary" : "text-muted-foreground"}`} />
                  <h3 className="font-display font-bold text-xl">{tier.name}</h3>
                  <div className="mt-1 mb-1">
                    <span className="text-3xl font-bold">{tier.price}</span>
                    <span className="text-xs text-muted-foreground ml-1">{tier.sub}</span>
                  </div>
                  {tier.bundle && (
                    <div className="text-xs font-mono text-primary mb-2">{tier.bundle}</div>
                  )}
                  <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-4">{tier.desc}</p>
                  {isPaid ? (
                    <Button
                      asChild
                      size="sm"
                      className={popular
                        ? "bg-gradient-brand text-white rounded-full w-full"
                        : "rounded-full w-full"}
                      variant={popular ? "default" : "outline"}
                    >
                      <a
                        href={hubPackCheckoutUrl(tier.id as HubPackId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackEvent("pricing_pack_click", { pack: tier.id })}
                        className="inline-flex items-center gap-1.5 justify-center"
                      >
                        Buy {tier.name} <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost" className="rounded-full w-full">
                      <Link to="/auth">Start free</Link>
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Trust strip */}
          <div className="rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl p-5 mb-10">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              🇿🇦 Built in South Africa · ZAR pricing · PayFast secure checkout via The Resonance · POPIA-conscious
            </p>
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Manage your purchases on{" "}
              <a href={`${HUB_URL}/account`} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                The Resonance
              </a>
              .
            </p>
          </div>
        </div>
      </main>

      <section className="max-w-4xl mx-auto px-6 w-full">
        <AddonCreditsWidget />
      </section>


      <AppFooter />
    </div>
  );
}
