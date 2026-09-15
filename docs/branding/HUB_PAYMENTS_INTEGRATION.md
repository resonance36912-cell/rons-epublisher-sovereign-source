# Hub Payments Integration — Resonance (v2, once-off only)

The **Hub** (reson8.life) owns billing for the entire Resonance ecosystem.
Spoke apps (ePublisher, Creative Studio, Sync Vision, YouTube Optimizer,
Career Compass) do **not** run their own payment processor. They delegate
checkout to the Hub and read entitlement back.

## Model change (2026): no more subscriptions

Every plan across every Resonance app is now a **once-off purchase**. There
are two product families:

1. **Lifetime tier unlocks** — one payment, permanent tier access + bundled
   credits.
2. **Credit packs** — non-expiring consumable top-ups for premium images and
   narration.

Recurring billing surfaces (`/subscription/*`, cancel flows, renewal notices)
are retired. The Hub side must reject any new subscription plans it may still
be listing for these apps.

## Architecture

```
┌─────────────┐     1. Unlock / Top-up      ┌──────────────┐
│  Spoke App  │ ──────────────────────────▶ │   The Hub    │
│ (e.g. ePub) │                             │ reson8.life  │
└─────────────┘                             └──────┬───────┘
       ▲                                            │
       │  4. entitlement check (REST)               │ 2. Paystack (or PayFast) checkout
       │                                            ▼
       │                                    ┌──────────────┐
       │                                    │   Paystack   │
       │                                    └──────┬───────┘
       │                                           │ 3. Webhook fan-out
       │                                    ┌──────▼───────┐
       └──────────────────────── reads ─────│  purchases   │
                                            │    table     │
                                            └──────────────┘
```

## Contracts

### 1. Checkout handoff (spoke → hub)

Spoke app links the user to:

```
https://reson8.life/checkout?app=<APP_KEY>&sku=<SKU>&return_to=<URL>
```

| Param       | Values |
|-------------|--------|
| `app`       | `epublisher` · `creative_studio` · `sync_vision` · `youtube_optimizer` · `career_compass` · `all_access` |
| `sku`       | One of the SKUs below (never a "plan slug") |
| `return_to` | Full URL to redirect the user back to after success/cancel |

### 2. ePublisher SKU catalog (Hub must mirror these)

All prices in **ZAR, once-off, incl. VAT display / excl. accepted**.

**Lifetime tier unlocks**

| SKU                 | Price | Bundled credits | Notes                          |
|---------------------|-------|-----------------|--------------------------------|
| `lifetime_starter`  | R99   | 50              | 3 projects, standard imagery   |
| `lifetime_creator`  | R249  | 200             | 10 projects, premium imagery   |
| `lifetime_pro`      | R499  | 500             | 25 projects, premium narration |
| `lifetime_business` | R699  | 900             | 100 projects, API access       |

**Credit packs**

| SKU            | Price | Image credits | TTS chars |
|----------------|-------|---------------|-----------|
| `pack_taste`   | R49   | 8             | 5 000     |
| `pack_starter` | R99   | 20            | 15 000    |
| `pack_creator` | R249  | 65            | 50 000    |
| `pack_studio`  | R599  | 180           | 150 000   |

### 3. Catalog probe endpoint

The spoke may `GET https://reson8.life/api/billing/catalog?app=epublisher`
to detect price drift. Expected shape:

```json
{
  "app": "epublisher",
  "skus": [
    { "sku": "lifetime_creator", "amount": 249, "currency": "ZAR" },
    { "sku": "pack_studio",      "amount": 599, "currency": "ZAR" }
  ]
}
```

Any mismatch surfaces `hub_pricing_mismatch` analytics + a Retry-Checkout
toast on the next click.

### 4. Webhook / fulfilment payload (hub → spoke)

The Hub fulfils either directly (writes to the shared Supabase project) or by
POSTing to the spoke's fulfilment endpoint. Payload:

```json
{
  "app": "epublisher",
  "user_id": "<uuid>",
  "sku": "lifetime_creator",
  "reference": "<gateway ref>",
  "amount_zar": 249,
  "currency": "ZAR",
  "kind": "lifetime_unlock",       // or "credit_pack"
  "granted_at": "2026-07-03T…Z",
  "bundle_credits": 200            // lifetime only
}
```

On the spoke side this triggers:

- Insert into `public.purchases` (`price_id = sku`, `stripe_session_id =
  <gateway>_<reference>`).
- For `lifetime_unlock`: `SELECT grant_lifetime_bundle(<user>, <sku>)` — inserts
  a non-expiring `credit_ledger` row.
- For `credit_pack`: upsert into `public.addon_credits` (image + tts rows).

### 5. Entitlement read (spoke → hub)

```
GET https://reson8.life/api/public/entitlement?app=epublisher
Authorization: Bearer <supabase_access_token>
```

Response:

```json
{
  "tier": "creator",
  "status": "active",              // "active" for lifetime unlocks; never "trialing"/"canceled"
  "current_period_end": null,      // always null — no renewal
  "purchases": ["lifetime_creator", "pack_starter"]
}
```

The spoke's `useHubEntitlement()` hook consumes this and prefers it over the
local `purchases` table when `source = "hub"`.

## Retired surfaces (do not re-enable)

- `/subscription/*`, cancel, resume, prorate, trial flows
- Monthly / annual plan slugs (`*_monthly`, `*_annual`)
- Renewal notification templates
- PayFast recurring token storage

## Migration note (existing customers)

Users who bought under legacy `*_once_off` price IDs (`standard_once_off`,
`premium_once_off`, `ultimate_once_off`, etc.) keep their access — `resolve_user_tier()`
remaps them to the new tier names. No downgrades.
