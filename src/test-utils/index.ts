/**
 * Public entrypoint for the `src/test-utils` package.
 *
 * Re-exports the pure, framework-agnostic helpers and their typings so
 * TypeScript consumers get a single, stable import surface:
 *
 * ```ts
 * import {
 *   formatScreenshotPath,
 *   type ScreenshotPathStyle,
 *   type SliderFocusFailureOptions,
 * } from "@/test-utils";
 * ```
 *
 * Playwright-bound helpers (e.g. `waitForSliderThumbFocused`,
 * `describeSliderThumbFocusFailure`) live in
 * `tests/e2e/helpers/slider-thumb` and re-export these same typings,
 * so updates here propagate automatically to e2e callers.
 */

export {
  SLIDER_SELECTOR,
  SLIDER_ARIA_LABEL,
  serializeActiveElement,
  serializeActiveElementOuterHtml,
  formatSliderThumbFocusFailure,
  formatScreenshotPath,
} from "./slider-thumb-focus";

export type {
  ScreenshotPathStyle,
  SliderFocusFailureOptions,
} from "./slider-thumb-focus";
