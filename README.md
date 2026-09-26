# Welcome to your Lovable project

TODO: Document your project here

## E2E test helpers: slider thumb focus diagnostics

The `waitForSliderThumbFocused` helper in
[`tests/e2e/helpers/slider-thumb.ts`](tests/e2e/helpers/slider-thumb.ts)
polls until the slider thumb becomes `document.activeElement`. When it
times out, it throws a verbose `Error` designed to survive CI log
truncation: the screenshot path is hoisted into a leading
`[screenshot: …]` header, the active element + outerHTML are inlined,
and the captured PNG is attached to the Playwright HTML report.

### Importing the types (TypeScript)

Both typings are re-exported from the package entrypoint, so consumers
should import them from `@/test-utils` rather than the deep module
path. The `exports` and `typesVersions` fields in `package.json` make
this resolve correctly for bundlers (Vite, esbuild, webpack) and for
`tsc` under `moduleResolution: "bundler" | "node16" | "nodenext"`.

```ts
// Recommended — single, stable import surface.
import {
  type ScreenshotPathStyle,
  type SliderFocusFailureOptions,
} from "@/test-utils";

// Inline-typed usage:
const opts: SliderFocusFailureOptions = {
  screenshotPath: true,
  pathStyle: "relative",   // ScreenshotPathStyle: "absolute" | "relative" | "basename"
  maskSelectors: ["[data-testid='signed-url']"],
};

// Generic helper that's parameterized on the style:
function makeOpts<S extends ScreenshotPathStyle>(
  pathStyle: S,
): SliderFocusFailureOptions & { pathStyle: S } {
  return { screenshotPath: true, pathStyle };
}
```

The Playwright-bound helpers (`waitForSliderThumbFocused`,
`describeSliderThumbFocusFailure`) live in
`tests/e2e/helpers/slider-thumb` and re-export the same typings, so
e2e specs can also do:

```ts
import {
  waitForSliderThumbFocused,
  type SliderFocusFailureOptions,
} from "../helpers/slider-thumb";
```

Deep imports still work but are not recommended — prefer the
entrypoint so refactors inside `src/test-utils/` don't break callers:

```ts
// Avoid in app/test code — use "@/test-utils" instead.
import type { ScreenshotPathStyle } from "@/test-utils/slider-thumb-focus";
```

### `ScreenshotPathStyle`

```ts
type ScreenshotPathStyle = "absolute" | "relative" | "basename";
```

Controls **only the rendered text** of the screenshot path in the
thrown error. The PNG file itself is always written to its resolved
absolute path on disk, and (inside a Playwright test) attached to the
HTML report via `test.info().attach(...)` as a downloadable
`image/png` artifact — so shorter styles never hide the screenshot,
they only shorten the log line.

| Style        | When to use                                                              | Renders as                            | `file://…` inline annotation |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------- | ---------------------------- |
| `"absolute"` | Default. Local runs, terminals that linkify `file://` URLs.              | `/repo/test-results/foo.png`          | Yes — header is a `file://` URL, body appends `(file://…)` |
| `"relative"` | CI log viewers with line caps; still grep-friendly from repo root.       | `test-results/foo.png` (relative to `process.cwd()`; falls back to absolute when outside cwd) | No |
| `"basename"` | Extremely long paths; rely on the HTML report attachment to open the PNG. | `foo.png`                             | No |

### `waitForSliderThumbFocused` output formatting

On timeout the thrown `Error.message` is shaped as:

```text
[screenshot: <path>] <context>
  active: <serialized document.activeElement>
  outerHTML: <truncated single-line outerHTML>
  screenshot: saved → <path> [(file://…)] [(masked: …)] [attached to test report]
```

Both `<path>` occurrences honor `options.pathStyle`. The `(file://…)`
annotation in the body is only appended when the displayed path is the
absolute path (i.e. style `"absolute"`), so that `"relative"` and
`"basename"` stay short.

### Usage

```ts
import { waitForSliderThumbFocused } from "./tests/e2e/helpers/slider-thumb";

// 1. Default — "absolute": clickable file:// URL in the header.
await waitForSliderThumbFocused(page, "after Tab", {
  screenshotPath: true, // auto-pathed under test-results/
});
// Error: [screenshot: file:///repo/test-results/foo.png] after Tab
//   active: …
//   outerHTML: …
//   screenshot: saved → /repo/test-results/foo.png (file:///repo/test-results/foo.png) [attached to test report]

// 2. "relative" — short header, still grep-friendly.
await waitForSliderThumbFocused(page, "after Tab", {
  screenshotPath: true,
  pathStyle: "relative",
});
// Error: [screenshot: test-results/foo.png] after Tab
//   …
//   screenshot: saved → test-results/foo.png [attached to test report]

// 3. "basename" — shortest header; open the PNG from the HTML report.
await waitForSliderThumbFocused(page, "after Tab", {
  screenshotPath: true,
  pathStyle: "basename",
});
// Error: [screenshot: foo.png] after Tab
//   …
//   screenshot: saved → foo.png [attached to test report]
```

### Finding the PNG in CI

Regardless of `pathStyle`, the file is reachable two ways:

1. **HTML report attachment** — named
   `slider-thumb-focus-failure — <context>` (or just
   `slider-thumb-focus-failure` outside an active test), downloadable
   directly from the Playwright HTML report. This is the recommended
   path when `pathStyle` is `"basename"`.
2. **On-disk absolute path** — `page.screenshot({ path })` always
   resolves and writes to the absolute path. With `"absolute"` the
   header is a clickable `file://` URL; with `"relative"` /
   `"basename"` consult the CI run's `test-results/` artifact bundle.


## Resonance UI/UX alignment

This application follows the **Resonance Sovereign Spectrum 2026** portfolio design system: sovereign-dark operational surfaces, restrained translucent control layers, product-specific accents, explicit AI/governance state, accessible focus/motion behavior, and RONSAS-aligned product identity.

Canonical design authority: https://github.com/resonance36912-cell/RONSAS/blob/main/docs/design/RESONANCE_SOVEREIGN_SPECTRUM_2026.md
