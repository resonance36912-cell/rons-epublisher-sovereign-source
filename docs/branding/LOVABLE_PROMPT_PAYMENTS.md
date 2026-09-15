# Lovable Prompt — Align Spoke App with Resonance Hub Payments

> Paste this **entire block** into the Lovable chat of the spoke app
> (ePublisher, Creative Studio, Sync Vision, YouTube Optimizer, or
> Career Compass). Replace `<APP_KEY>` with one of:
> `epublisher` · `creative_studio` · `sync_vision` ·
> `youtube_optimizer` · `career_compass`.

---

Align this app with the Resonance Hub (reson8.life) so that **all billing,
pricing, and subscription state lives in the Hub** — this app must not run
its own PayFast integration.

## 1. Remove local billing

- Delete any local pricing page, PayFast checkout buttons, ITN webhook
  routes, and any `subscriptions` / `plans` Supabase tables in this project.
- Remove any references to PayFast merchant IDs, passphrases, or ITN secrets
  from this project's secrets list.

## 2. Add Hub entitlement check

Create `src/lib/entitlement.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Tier = "free" | "starter" | "creator" | "pro" | "business" | null;
export type Entitlement = { tier: Tier; status: "active" | "past_due" | "cancelled" | "none" };

const APP_KEY = "<APP_KEY>" as const;

export function useEntitlement() {
  return useQuery<Entitlement>({
    queryKey: ["entitlement", APP_KEY],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { tier: null, status: "none" };
      const res = await fetch(
        `https://reson8.life/api/public/entitlement?app=${APP_KEY}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) return { tier: null, status: "none" };
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function tierMeets(have: Tier, need: Exclude<Tier, null | "free">) {
  const order = ["free", "starter", "creator", "pro", "business"] as const;
  if (!have) return false;
  return order.indexOf(have) >= order.indexOf(need);
}
```

## 3. Replace upgrade buttons

Any "Upgrade", "Subscribe", or "Go Pro" button in this app must link to:

```
https://reson8.life/checkout?app=<APP_KEY>&plan=<PLAN>&return_to=<CURRENT_URL>
```

Example component:

```tsx
export function UpgradeButton({ plan = "creator" }: { plan?: string }) {
  const returnTo = typeof window !== "undefined" ? window.location.href : "/";
  const href =
    `https://reson8.life/checkout?app=<APP_KEY>` +
    `&plan=${plan}&return_to=${encodeURIComponent(returnTo)}`;
  return (
    <a href={href} className="px-5 py-2.5 rounded-full bg-gradient-brand text-white text-sm font-bold">
      Upgrade on Hub →
    </a>
  );
}
```

## 4. Gate premium features

```tsx
import { useEntitlement, tierMeets } from "@/lib/entitlement";

export function PaywallGate({
  tier,
  children,
}: { tier: "starter" | "creator" | "pro" | "business"; children: React.ReactNode }) {
  const { data, isLoading } = useEntitlement();
  if (isLoading) return null;
  if (tierMeets(data?.tier ?? null, tier)) return <>{children}</>;
  return <UpgradeButton plan={tier} />;
}
```

## 5. Single sign-on

This app already uses the shared Supabase project, so a user who signs in on
reson8.life is automatically signed in here. Confirm `src/integrations/supabase/client.ts`
points at the same `VITE_SUPABASE_URL` as the Hub.

## 6. Visual alignment

In the same session, also apply the **Resonance brand pack**:

- Paste `tokens.css` into `src/styles.css` (top of the file).
- Replace the app's primary accent token with the row matching `<APP_KEY>`
  in `BRAND_GUIDELINES.md` § Per-app accents.
- Replace the favicon and any "logo" import with the matching file from
  `logos/logo-<APP_KEY>.png`.
- Use the master `resonance-lockup.png` in the footer with
  `className="brightness-0 invert opacity-70"` and the caption
  *"Part of the Resonance ecosystem · reson8.life"*.

## Acceptance checklist

- [ ] No PayFast code, secrets, or routes remain in this project.
- [ ] No local `subscriptions` table.
- [ ] Every upgrade CTA points at `https://reson8.life/checkout?...`.
- [ ] `useEntitlement()` returns the correct tier for a Hub-paid user.
- [ ] Premium UI is gated by `<PaywallGate>`.
- [ ] Footer shows the Resonance lockup + ecosystem caption.
- [ ] Accent color matches the spoke's row in the brand pack.
