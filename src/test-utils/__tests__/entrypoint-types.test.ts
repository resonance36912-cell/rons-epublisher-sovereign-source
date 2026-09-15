/**
 * Compile-time test for the `@/test-utils` package entrypoint.
 *
 * This file's primary job is type-level: it imports
 * `ScreenshotPathStyle` and `SliderFocusFailureOptions` from the
 * public entrypoint and asserts — via the type system, at `tsc` time —
 * that:
 *  - both names resolve from `@/test-utils` (not the deep module path),
 *  - `ScreenshotPathStyle` is the exact union of the three literals,
 *  - `SliderFocusFailureOptions` exposes its documented fields with the
 *    expected types and optionality.
 *
 * A trivial runtime assertion is included so vitest counts the file as
 * an executed test, which guarantees TypeScript actually transpiles it
 * (failures would surface as TS errors that block the test run).
 */

import { describe, it, expect } from "vitest";
import type {
  ScreenshotPathStyle,
  SliderFocusFailureOptions,
} from "@/test-utils";

// --- compile-time assertion helpers (zero runtime cost) ---

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// `ScreenshotPathStyle` must be exactly the documented union.
type _PathStyleIsUnion = Expect<
  Equal<ScreenshotPathStyle, "absolute" | "relative" | "basename">
>;

// `SliderFocusFailureOptions` must expose the documented fields with
// the documented types and optionality.
type _OptionsShape = Expect<
  Equal<
    Required<SliderFocusFailureOptions>,
    {
      screenshotPath: string | true;
      fullPage: boolean;
      maskSelectors: string[];
      maskColor: string;
      pathStyle: ScreenshotPathStyle;
    }
  >
>;

// Every field must be optional on the original (un-Required'd) shape.
type _AllOptional = Expect<
  Equal<
    SliderFocusFailureOptions,
    Partial<Required<SliderFocusFailureOptions>>
  >
>;

// Silence "unused type" lints — these aliases exist only to force
// `tsc` to evaluate the `Expect<…>` constraints above.
type _Touch =
  | _PathStyleIsUnion
  | _OptionsShape
  | _AllOptional;

describe("@/test-utils entrypoint typings", () => {
  it("exposes ScreenshotPathStyle and SliderFocusFailureOptions", () => {
    // Runtime smoke: build a value typed as SliderFocusFailureOptions
    // using each ScreenshotPathStyle literal. If the types were missing
    // or wrong, this file would not compile and vitest would fail.
    const styles: ScreenshotPathStyle[] = ["absolute", "relative", "basename"];
    for (const pathStyle of styles) {
      const opts: SliderFocusFailureOptions = {
        screenshotPath: true,
        pathStyle,
      };
      expect(opts.pathStyle).toBe(pathStyle);
    }
  });
});

// Suppress "unused" warnings for the type-only marker.
export type { _Touch };
