# Spoke → Hub 301 consolidation

Goal: every **public** ePublisher spoke URL returns a real `HTTP 301` to its
`reson8.life` canonical, so crawlers collapse the duplicate set quickly instead
of waiting on canonical hints.

## Why this is edge config, not app code

Lovable hosting does not process `_redirects`, `_headers`, `netlify.toml` or
`vercel.json`. A client-side redirect returns `200` first, which Google treats
as a soft signal. So the 301s are applied on the proxy in front of the spoke
(Cloudflare in front of `resonanceonline.life`, or the Hub edge).

## Source of truth

`src/lib/hub-redirect-map.ts` holds the origins, the path map, and the
never-redirect prefixes. The same map drives the `<link rel="canonical">` in
`src/components/Seo.tsx`, so the 301 target and the canonical can never drift.

Regenerate the rule files after any change to that map:

```bash
node scripts/generate-hub-redirects.mjs
```

Outputs (git-tracked, safe to paste into the edge):

- `docs/generated/hub-redirects.csv` — Cloudflare **Bulk Redirects** import
- `docs/generated/hub-redirects.conf` — nginx / reverse-proxy form

## Route map

| Spoke path | Hub target | Status |
| --- | --- | --- |
| `/` | `https://reson8.life/apps/epublisher` | 301 |
| `/about` | `https://reson8.life/about` | 301 |
| `/contact` | `https://reson8.life/support` | 301 |
| `/pricing` | `https://reson8.life/pricing` | 301 |
| `/terms` | `https://reson8.life/terms` | 301 |
| `/privacy` | `https://reson8.life/privacy` | 301 |
| anything else public | `https://reson8.life/apps/epublisher` | 301 |

Applied for all three spoke origins: `www.resonanceonline.life`,
`resonanceonline.life`, `resonanceonline.lovable.app`.

## Must NOT redirect

These are the running product. A 301 here breaks sign-in and payments:

`/app` · `/auth` · `/admin` · `/account` · `/billing` · `/checkout` ·
`/reset-password` · `/privacy/access` · `/__test` · `/lovable` · `/assets` ·
`/api`

In Cloudflare, add these as an **exclusion rule ordered above** the Bulk
Redirect list (`Redirect Rules → skip` on
`http.request.uri.path starts_with` any of the above). In nginx the
`location ^~` blocks in the generated `.conf` already come first.

## Apply in Cloudflare

1. **Rules → Bulk Redirects → Create list** (`epublisher-hub-consolidation`).
2. Import `docs/generated/hub-redirects.csv`.
3. Settings per list item: status `301`, *Subpath matching* on for the `/*`
   rows, *Preserve query string* on for the explicit page rows.
4. **Rules → Redirect Rules**: add a `Skip` rule for the never-redirect
   prefixes above and drag it **above** the bulk redirect rule.
5. Deploy, then verify.

## Verify

```bash
for p in / /pricing /about /contact /terms /privacy /random-page; do
  curl -sSI "https://www.resonanceonline.life$p" | awk 'NR==1 || /^[Ll]ocation:/'
done
# expect: HTTP/2 301 + location: https://reson8.life/...

for p in /app /auth/callback /checkout/return; do
  curl -sSI "https://www.resonanceonline.life$p" | awk 'NR==1'
done
# expect: HTTP/2 200 — these must never redirect
```

## After deploying

- Keep `public/robots.txt` as-is: redirected URLs must stay crawlable for the
  301 to be seen. Do **not** add `Disallow` for redirected paths.
- Keep `public/sitemap.xml` listing spoke URLs until Search Console shows the
  Hub URLs indexed, then submit the Hub sitemap only.
- In Search Console, use **Change of Address** if/when the spoke retires
  entirely; for a partial move the 301s plus canonicals are sufficient.
- Consolidation typically completes in 2–6 weeks of recrawl.
