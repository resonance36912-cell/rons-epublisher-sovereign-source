# Lovable Alignment Prompt — Paste into each Resonance app project

Use this prompt verbatim in each Resonance app (ePublisher, Creative Studio, Sync Vision, Podcast, Career Compass, YouTube Optimizer) to bring it into visual and structural alignment with the hub at https://reson8.life.

---

Align this app with **The Resonance** brand system. Apply the following without asking for clarification — values are final.

**Brand spine**
- Background `hsl(222 47% 6%)`, foreground `hsl(0 0% 98%)`
- Brand gradient `linear-gradient(135deg, hsl(265 85% 65%), hsl(295 90% 60%), hsl(325 90% 65%))`
- This app's accent: `<INSERT FROM TABLE BELOW>`
- Define all of the above as semantic tokens in `src/styles.css`; never hardcode hex in components.

**Per-app accent (pick one)**
- ePublisher → `295 90% 60%` magenta — attribute "Intelligence (IQ) 🧠"
- Creative Studio → `265 85% 65%` violet — "Soul & Expression (EQ) ❤"
- Sync Vision → `325 90% 65%` pink — "Physical Execution (PQ) 🏃"
- Podcast → `190 90% 60%` cyan — "Tri-Fold Integration (3-6-9) ∞"
- Career Compass → `150 80% 55%` emerald — "Direction & Purpose 🎯"
- YouTube Optimizer → `0 84% 60%` red — "Velocity & Growth 🚀"

**Navigation**
- Fixed top nav, `backdrop-blur-xl bg-background/60 border-b border-white/5`
- Top-left: Resonance lockup with `brightness-0 invert`, links back to `https://reson8.life`
- Top-right: primary CTA in brand gradient

**Hero**
- Eyebrow chip: `Tools in tune with you` with pulsing accent dot
- Tri-color line under headline: `ONE ACCOUNT · MULTIPLE TOOLS · ENDLESS POSSIBILITIES`
- One-sentence description of this specific app, then two CTAs: **Start Free** (gradient) + **Compare Apps** (ghost border) linking back to hub pricing

**Attribute block**
On the landing page, surface the app's attribute chip (icon + label + 1-sentence body) from the list above.

**Trust strip (above fold)**
🇿🇦 Built in South Africa · ZAR pricing · PayFast secure checkout · Cancel anytime · POPIA-conscious · Free tiers & pilots

**Pricing**
Use ZAR only with PayFast. Match hub tiers — Free / Starter R99 / Creator R149 / Pro R299 / Business R699 (or app-specific subset). Annual saves 20%.

**Components**
- Cards: `rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl`
- Pills/chips: `rounded-full` with accent-tinted background (`<accent>/0.12`)
- Primary CTA: `rounded-full bg-gradient-brand text-white shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)]`

**SEO**
- Canonical domain matches this app's own production URL
- Title pattern `<Page> — Resonance <AppName>`
- JSON-LD `SoftwareApplication` with `offers.priceCurrency: "ZAR"`
- Add a footer link "Part of The Resonance" → `https://reson8.life`

**Footer**
Include POPIA notice, cancel-anytime line, and hub back-link. No third-party tracking by default.
