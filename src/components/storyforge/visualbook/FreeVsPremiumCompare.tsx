import { Sparkles, Zap, Check, X } from "lucide-react";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

// Pricing constants (USD). Keep in sync with API Usage Tracking memory.
const TTS_USD_PER_CHAR = 0.0003;
const IMAGE_USD_PER_IMG = 0.04;

type Surface = "tts" | "image";

interface Props {
  surface: Surface;
  /** For TTS: total characters to narrate. For images: number of images. */
  units?: number;
}

/**
 * Side-by-side comparison of free vs premium output so users always see what
 * they get (and what it would cost) before paying. Rendered inline under each
 * Cost & Quality mode toggle.
 */
export function FreeVsPremiumCompare({ surface, units = 0 }: Props) {
  const isTts = surface === "tts";

  const freeLabel = isTts ? "Local / open narration" : "Local / open images";
  const premiumLabel = isTts ? (FREE_PROMOTION_ACTIVE ? "Enhanced AI narration" : "ElevenLabs premium") : (FREE_PROMOTION_ACTIVE ? "Enhanced AI images" : "Gemini premium");

  const freeFeatures = isTts
    ? [
        { ok: true, text: "Browser / open-source voices (Kokoro-82M)" },
        { ok: true, text: "Unlimited within fair-use" },
        { ok: false, text: "Studio-grade voice realism" },
        { ok: false, text: "Long-form stability & emotion" },
      ]
    : [
        { ok: true, text: "Pollinations / fallback generator" },
        { ok: true, text: "Unlimited within fair-use" },
        { ok: false, text: "Photoreal detail & coherence" },
        { ok: false, text: "Consistent character / scene styling" },
      ];

  const premiumFeatures = isTts
    ? [
        { ok: true, text: "ElevenLabs studio voices" },
        { ok: true, text: "Speed, demeanour & accent controls" },
        { ok: true, text: "Stable narration across long chapters" },
        { ok: true, text: "Background-music mixing supported" },
      ]
    : [
        { ok: true, text: "Gemini photo-grade rendering" },
        { ok: true, text: "Portrait / landscape control" },
        { ok: true, text: "Better adherence to prompts" },
        { ok: true, text: "Character & scene consistency" },
      ];

  const perUnit = isTts ? TTS_USD_PER_CHAR : IMAGE_USD_PER_IMG;
  const perUnitLabel = isTts
    ? `$${TTS_USD_PER_CHAR.toFixed(4)} / character`
    : `$${IMAGE_USD_PER_IMG.toFixed(2)} / image`;
  const totalUsd = units > 0 ? units * perUnit : 0;
  const totalLabel = FREE_PROMOTION_ACTIVE
    ? `Both provider paths are included during the ${FREE_PROMOTION.shortLabel.toLowerCase()}. Usage is metered internally for costing only; no payment is required.`
    : units > 0
      ? `Premium cost for this batch: ~$${totalUsd.toFixed(2)} (${units.toLocaleString()} ${isTts ? "chars" : "images"})`
      : `Premium is billed at ${perUnitLabel}.`;

  return (
    <div className="mt-2 rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {FREE_PROMOTION_ACTIVE ? "Compare provider quality" : "Compare free vs premium"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Column
          title={freeLabel}
          icon={<Zap className="h-3 w-3" />}
          badge={FREE_PROMOTION_ACTIVE ? "Included" : "Free"}
          badgeClass="bg-muted text-muted-foreground"
          features={freeFeatures}
        />
        <Column
          title={premiumLabel}
          icon={<Sparkles className="h-3 w-3 text-primary" />}
          badge={FREE_PROMOTION_ACTIVE ? "Included" : perUnitLabel}
          badgeClass="bg-primary/15 text-primary"
          features={premiumFeatures}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 border-t border-border/30">
        {totalLabel}
      </p>
    </div>
  );
}

function Column({
  title, icon, badge, badgeClass, features,
}: {
  title: string;
  icon: React.ReactNode;
  badge: string;
  badgeClass: string;
  features: { ok: boolean; text: string }[];
}) {
  return (
    <div className="rounded-md bg-card/40 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 text-[11px] font-semibold">
          {icon}<span>{title}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>{badge}</span>
      </div>
      <ul className="space-y-0.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-1 text-[10.5px] leading-snug">
            {f.ok
              ? <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
              : <X className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" />}
            <span className={f.ok ? "" : "text-muted-foreground/70"}>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
