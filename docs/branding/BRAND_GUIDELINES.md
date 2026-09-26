# The Resonance — Brand & Alignment Pack

## 0. Current authority and 2026 UI alignment

This document remains useful for product identity, voice, logos, and per-app accent history, but **commercial state is governed by the current RONSAS / Resonance Hub source of truth**.

As of the current RONSAS promotional mode:
- new billing and checkout are paused;
- product access is promoted as free while real usage and delivery costs are measured;
- older price tables below are historical planning references unless and until the Hub explicitly reactivates pricing;
- UI must not imply a current paid tier, checkout requirement, pack balance, or recurring subscription where the authoritative Hub does not.

For portfolio UI/UX, use the canonical **Resonance Sovereign Spectrum 2026** direction:
`resonance36912-cell/RONSAS/docs/design/RESONANCE_SOVEREIGN_SPECTRUM_2026.md`.

The theme preserves each product accent while aligning navigation, work surfaces, AI/governance state, accessibility, responsive density, and sovereign-dark operational UI across the suite.

**Version 1.0 · 27 May 2026**
Built in South Africa · ZAR pricing · POPIA-conscious

---

## 1. Brand Essence

| | |
|---|---|
| **Brand name** | The Resonance |
| **Hub URL** | https://reson8.life |
| **Tagline (eyebrow)** | Tools in tune with you |
| **Hero line** | One Resonance account. Multiple AI tools for publishing, content, music videos, careers, and growth. |
| **Tri-color claim** | One account. Multiple tools. Endless possibilities. |
| **Origin** | South African–built creative ecosystem |
| **Audience** | Authors & Publishers · Creators & Small Businesses · Musicians & Artists · Students & Schools |

**Voice:** confident, warm, technically literate, never hype-y. Sentences short. ZAR-first. South African context where useful (PayFast, POPIA, bursaries, scarce skills).

---

## 2. Color System

All colors are HSL tokens defined in `src/styles.css`. Use semantic Tailwind classes — never hardcode hex in components.

### Brand spine
| Role | HSL | Hex (≈) | Usage |
|---|---|---|---|
| Background | `222 47% 6%` | `#080B14` | Page bg, dark surfaces |
| Foreground | `0 0% 98%` | `#FAFAFA` | Primary text on dark |
| Primary (magenta) | `295 90% 60%` | `#D826E8` | Brand spine, primary CTAs |
| Primary glow | `325 90% 65%` | `#F04EAE` | Gradient end, glow halos |
| Brand gradient | `linear-gradient(135deg, hsl(265 85% 65%), hsl(295 90% 60%), hsl(325 90% 65%))` | — | Hero, CTA, lockup |

### Per-app accents
| App | Accent HSL | Hex | Attribute |
|---|---|---|---|
| Resonance ePublisher | `295 90% 60%` | `#D826E8` magenta | Intelligence (IQ) 🧠 |
| Creative Studio | `265 85% 65%` | `#A855F7` violet | Soul & Expression (EQ) ❤ |
| Sync Vision | `325 90% 65%` | `#F04EAE` pink | Physical Execution (PQ) 🏃 |
| The Resonance Podcast | `190 90% 60%` | `#22D3EE` cyan | Tri-Fold Integration (3-6-9) ∞ |
| Career Compass | `150 80% 55%` | `#3EE07A` emerald | Direction & Purpose 🎯 |
| YouTube Optimizer | `0 84% 60%` | `#EF4444` red/gold | Velocity & Growth 🚀 |

**Rule of dominance:** brand magenta dominates the hub; per-app accent dominates inside each app and inside that app's card.

---

## 3. Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| Display / Hero | System sans (stack default) | 800 extrabold | 4xl→7xl, tracking-tight, leading-[0.98] |
| Section H2 | System sans | 700 bold | 3xl→5xl |
| Body | System sans | 400/500 | base, leading-relaxed |
| Eyebrow / meta | Mono | 600/700 | 10–11px, uppercase, tracking [0.22em–0.25em] |
| Editorial accent | Serif italic | 400 | inline highlights only |

**Eyebrow pattern:** all CAPS, mono, wide tracking, paired with a 1.5px colored dot or a thin border-radius-full chip.

---

## 4. Logos

All logos live in `src/assets/`. Always import via ES6 (`import logoEpublisher from "@/assets/logo-epublisher.png"`), include `width={1024} height={1024}`, and `loading="lazy"` (except hero/LCP).

| File | Subject | Dominant color |
|---|---|---|
| `resonance-logo.png` | Master "R" orb mark | Magenta gradient |
| `resonance-lockup.png` | Horizontal wordmark | Mono — use `brightness-0 invert` on dark bg |
| `logo-epublisher.png` | Glowing book + audio bars | Electric blue / cyan |
| `logo-creative-studio.png` | "C" + paintbrush with sparkles | Magenta → orange |
| `logo-sync-vision.png` | Camera shutter + play triangle | Teal / turquoise |
| `logo-podcast.png` | Microphone + waveform | Purple / violet |
| `logo-career-compass.png` | Compass star + human figure (SA flag accents) | Emerald + gold |
| `logo-youtube-optimizer.png` | Play triangle + rising bars + arrow | Red / crimson |

**Clear space:** minimum padding equal to 15% of the logo's shortest side. Never recolor — regenerate if a color variant is needed.

---

## 5. Layout & Components

| Token | Value |
|---|---|
| Container max | `max-w-7xl mx-auto px-6` |
| Card surface | `rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl` |
| Card hover glow | accent-tinted `shadow-[0_0_60px_-15px_<accent>/0.6]` + `border-<accent>/0.45` |
| Pills / chips | `rounded-full border` + accent chip background `<accent>/0.12`, text `<accent>/0.80` |
| CTA primary | `rounded-full bg-gradient-brand text-white shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)]` |
| CTA secondary | `rounded-full border border-white/15 hover:border-white/40` |
| Divider | `border-white/10` |

**Attribute card (inside each app tile):** chip-tinted background with icon glyph + label (`Intelligence (IQ)`) + 1-sentence description. Always present.

---

## 6. Pricing System

All tiers in ZAR, PayFast checkout, cancel anytime, annual saves 20%.

| App | Free | Starter | Creator | Pro | Business |
|---|---|---|---|---|---|
| Resonance ePublisher | ✓ | R99 | R149 | R299 | R699 |
| Creative Studio | — | — | R149 | R299 | R699 |
| Sync Vision | — | — | R149 | R299 | R699 |
| Resonance Podcast | Free | — | — | — | — |
| Career Compass | Pilot | — | — | — | — |
| YouTube Optimizer | TBA | TBA | TBA | TBA | TBA |

### Ecosystem bundles
| Bundle | Price/mo | Contents |
|---|---|---|
| Resonance Starter | R99 | ePublisher Starter + basic Creative Studio credits |
| Creator *(most popular)* | R249 | ePublisher Creator + Creative Studio Creator + limited Sync Vision |
| Resonance Pro | R499 | Pro on ePublisher + Creative Studio + Sync Vision |
| Business | R999 | All Business tools + priority support + onboarding call |

---

## 7. Trust Strip (always above the fold)

🇿🇦 Built in South Africa · ZAR pricing · PayFast secure checkout · Cancel anytime · POPIA-conscious · Free tiers & pilots

---

## 8. SEO Defaults

- **Domain (canonical):** `https://reson8.life`
- **Title pattern:** `<Page> — The Resonance` (≤60 chars)
- **Description:** ≤160 chars, mention ecosystem + ZAR/PayFast where relevant
- **OG image:** `<origin>/og-logo.png` on hub; per-app hero image on app routes
- **Structured data:** Organization + WebSite on root; SoftwareApplication per app; FAQPage on hub FAQ
- **Sitemap:** `/sitemap.xml` (live), `/robots.txt`, `/llms.txt`

---

## 9. App Domains

| App | Production URL |
|---|---|
| Hub | https://reson8.life |
| ePublisher | https://www.resonanceonline.life |
| Creative Studio | https://www.creativestudio.life |
| Sync Vision | https://www.syncvision.life |
| Podcast | https://www.resonance-podcast.com |
| Career Compass | https://www.career-compass.org |
| YouTube Optimizer | TBA (Q3 2026) |

---

## 10. Alignment Checklist (for every Resonance app)

- [ ] Lockup in top-left nav, `brightness-0 invert` on dark
- [ ] Tri-color eyebrow `One account · Multiple tools · Endless possibilities`
- [ ] Per-app attribute chip (IQ/EQ/PQ/3-6-9/Direction/Velocity) visible on landing
- [ ] Trust strip with the 6 badges above the fold
- [ ] ZAR pricing only, PayFast badge on checkout
- [ ] Cancel-anytime + POPIA notice in footer
- [ ] Footer back-link to `https://reson8.life` ("Part of The Resonance")
- [ ] Same accent token from §2 used for primary CTA and active state
- [ ] OG image + canonical + JSON-LD `SoftwareApplication` set on root route
- [ ] Free entry path: free tier, free pilot, or trial credits
