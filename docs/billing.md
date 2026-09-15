# Billing

Stripe has been **fully removed** from this project. There are no Stripe SDK
imports, no Stripe checkout calls, no Stripe webhook handlers, and no Stripe
secrets in the backend. **Subscriptions have also been fully retired** —
every plan is now a once-off purchase.

## Active provider: Paystack (ZAR), Hub-brokered

All paid flows are once-off charges, brokered by the Resonance Hub at
`reson8.life`. The Hub signs Paystack transactions; this app never processes
cards directly.

### Runtime secrets

| Secret | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack init & webhook HMAC |

PayFast credentials (`PAYFAST_*`) are unused and safe to delete once the Hub
migration is complete.

### Edge functions

| Function | Role |
|---|---|
| `paystack-checkout-init` | Signs a one-time Paystack transaction for a **lifetime tier unlock** (`sku=lifetime_*`) or a **credit pack** (`pack_id=pack_*`). |
| `paystack-webhook` | HMAC-verified webhook. Records the purchase, and on lifetime SKUs calls `grant_lifetime_bundle(user_id, sku)` to insert a non-expiring credit ledger row. On credit-pack SKUs, upserts `addon_credits` rows. |
| `paystack-verify-transaction` | Admin verify endpoint for QA test checkouts. |
| `admin-grant-credits` | QA helper that inserts a synthetic purchase row for a tier or pack without going through checkout. |
| `cancel-subscription`, `payfast-*` | **410 Gone.** Retired — subscriptions no longer exist. |

## Pricing model (Q3 2026)

Two once-off product families in **ZAR**:

### 1. Lifetime tier unlocks

Pay once, keep the tier forever. Includes a bundled credit grant so users can publish immediately.

| SKU | Price | Unlocks | Bundled credits |
|---|---|---|---|
| `lifetime_starter`  | R99  | 3 projects, watermark-free PDF, standard images | 50 |
| `lifetime_creator`  | R249 | 10 projects, HTML + ePub export, premium images | 200 |
| `lifetime_pro`      | R499 | 25 projects, ElevenLabs narration, full AV MP4  | 500 |
| `lifetime_business` | R699 | 100 projects, API access, team seat             | 900 |

### 2. Credit packs (top-ups)

Non-expiring add-on credits stored in `public.addon_credits`.

| SKU | Price | Image credits | TTS chars |
|---|---|---|---|
| `pack_taste`   | R49  | 8   | 5 000   |
| `pack_starter` | R99  | 20  | 15 000  |
| `pack_creator` | R249 | 65  | 50 000  |
| `pack_studio`  | R599 | 180 | 150 000 |

### Credit ledger

Lifetime-unlock credits are stored in `public.credit_ledger` as a single
non-expiring row per purchase (`period_end = now() + 100 years`,
`source = 'lifetime_bundle'`). Consumed via `consume_credits(user_id, amount, reason)`.
`get_credits_remaining(user_id)` powers the UI badge.

**Credit costs per action:**

| Action | Credits |
|---|---|
| Outline / storyboard | 1 |
| Chapter rewrite | 2 |
| Premium image | 3 |
| Premium narration (per chapter) | 5 |
| Background music render | 5 |
| PDF export | 5 |
| ePub export | 10 |
| Full AudioVisual MP4 | 20 |

When a free user's daily quota blocks a premium call, the edge function tries
to consume the equivalent credits via `tryConsumeOnQuotaBlock`. If credits
aren't available, it falls back to eco/free providers — never silent overage.

### Legacy tier remap

Existing customers who bought under the old catalog are remapped automatically
by `resolve_user_tier()`:

- `standard` → `creator`
- `premium` → `pro`
- `ultimate` → `business`

Legacy `*_once_off` price IDs continue to resolve to the correct tier.

## Database tables

`public.purchases` records every once-off transaction (lifetime + packs).
`public.subscriptions` is **retired** — the table is preserved for historical
records only, and `has_active_subscription()` always returns `false`.

Column names still use Stripe-prefixed nomenclature for historical reasons.
They store Paystack values:

| Column | Actually stores |
|---|---|
| `stripe_session_id` | `paystack_<reference>` (or `qa_…` / `coupon_…`) |
| `stripe_customer_id` | Paystack customer code |
| `price_id`, `product_id` | Our SKU (e.g. `lifetime_creator`, `pack_taste`) |
| `environment` | `'sandbox'` or `'live'` |

## Analytics events

- `pricing_view`, `pricing_tier_click`, `pricing_hub_cta`
- `hub_checkout_intent` — every unlock or top-up click
- `hub_checkout_blocked_price_mismatch` — Hub catalog disagrees with local price
- `paystack_lifetime_unlock`, `paystack_charge_success` — webhook-side receipts

## Adding a new payment provider

Prefer **Lovable's built-in payments** (Paddle or Stripe via `enable_paddle_payments` / `enable_stripe_payments`) over a bring-your-own-key integration. Do not reintroduce a raw `STRIPE_*` secret.
