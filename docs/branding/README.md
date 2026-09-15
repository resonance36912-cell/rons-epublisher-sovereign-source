# Resonance Brand & Integration Pack — v3

One drop-in pack that aligns every Resonance app: brand, logos, tokens,
typography, reusable components, and the Hub-payments wiring.

## What's inside

```
resonance-brand-pack/
├── BRAND_GUIDELINES.md           Voice, palette, do/don't
├── TYPOGRAPHY.md                 Fonts, scale, head snippet, CSS vars
├── HUB_PAYMENTS_INTEGRATION.md   How spokes delegate billing to the Hub
├── LOVABLE_PROMPT.md             Paste into each spoke: align brand
├── LOVABLE_PROMPT_PAYMENTS.md    Paste into each spoke: switch to Hub checkout
├── tokens.css                    Colour + shadow + gradient CSS variables
├── logos/                        All app PNGs + lockups
├── components/
│   ├── ResonanceLogo.tsx
│   ├── BrandButton.tsx
│   ├── GlassCard.tsx             + Eyebrow helper
│   ├── CheckoutButton.tsx        → Hub checkout, no PayFast in spokes
│   ├── PaywallGate.tsx           Tier-gates any block of UI
│   └── ResonanceFooter.tsx       Shared cross-app footer
└── hooks/
    └── useEntitlement.ts         Reads /api/public/entitlement on the Hub
```

## 5-minute integration (per spoke)

1. **Paste `tokens.css`** into `src/styles.css` (replace existing colour vars).
2. **Add the fonts** — copy the `<link>` from `TYPOGRAPHY.md` into your root
   layout (`src/routes/__root.tsx`).
3. **Copy `components/` and `hooks/`** into the spoke's `src/components/brand/`
   and `src/hooks/`. Adjust the Supabase import in `useEntitlement.ts` if the
   path differs.
4. **Drop the logo** at `public/resonance-lockup.png` (or import from `src/assets`).
5. **Replace upgrade CTAs** with `<CheckoutButton sku="…" />` — see
   `LOVABLE_PROMPT_PAYMENTS.md`.
6. **Gate premium features** with `<PaywallGate app="…" minTier="…" upgradeSku="…">`.
7. **Add `<ResonanceFooter currentApp="ePublisher" />`** to the root layout.

That's it — no PayFast credentials, no per-app pricing pages, no duplicated
brand CSS. Every app inherits the Hub's payment flow, branding, and
cross-app navigation.

## SKU catalog (mirror of the Hub)

```
epublisher:starter:monthly        R99
epublisher:creator:monthly        R149
epublisher:pro:monthly            R299
epublisher:business:monthly       R699
creative_studio:creator:monthly   R149
creative_studio:pro:monthly       R299
creative_studio:business:monthly  R699
sync_vision:creator:monthly       R149
sync_vision:pro:monthly           R299
sync_vision:business:monthly      R699
all_access:all_access:monthly     R499
```

## URLs

- Hub:                https://reson8.life
- Checkout:           https://reson8.life/checkout?sku=…&return_to=…
- Entitlement API:    https://reson8.life/api/public/entitlement?app=…
- My subscriptions:   https://reson8.life/account/subscriptions
