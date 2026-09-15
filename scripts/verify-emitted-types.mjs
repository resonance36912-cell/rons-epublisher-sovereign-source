#!/usr/bin/env node
/**
 * Post-build verifier for emitted `.d.ts` files.
 *
 * Run via `npm run test:types` (which also re-runs `tsc -p
 * tsconfig.types.json` first). Fails fast with a non-zero exit code
 * when any of the following invariants are broken:
 *
 *   1. The `package.json` "exports" / "typesVersions" "types" paths
 *      actually exist on disk after the declaration build.
 *   2. `dist/types/test-utils/index.d.ts` re-exports
 *      `ScreenshotPathStyle` and `SliderFocusFailureOptions` from the
 *      pure module.
 *   3. `dist/types/test-utils/slider-thumb-focus.d.ts` declares the
 *      `ScreenshotPathStyle` union with the exact documented members
 *      and the `SliderFocusFailureOptions` interface with the
 *      documented `pathStyle` field.
 *
 * These checks keep emitted declarations in sync with the published
 * package surface so downstream TypeScript consumers can't silently
 * lose `ScreenshotPathStyle` / `SliderFocusFailureOptions`.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const failures = [];
const fail = (msg) => failures.push(msg);

/** Recursively collect every string-valued "types" path under exports. */
function collectTypesPaths(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === "types" && typeof v === "string") out.push(v);
    else if (typeof v === "object") collectTypesPaths(v, out);
  }
  return out;
}

// 1) "exports[*].types" must exist on disk.
for (const p of collectTypesPaths(pkg.exports ?? {})) {
  const abs = resolve(root, p);
  if (!existsSync(abs)) fail(`exports types path missing on disk: ${p}`);
}

// 1b) "typesVersions" paths must exist too.
for (const map of Object.values(pkg.typesVersions ?? {})) {
  for (const arr of Object.values(map)) {
    for (const p of arr) {
      const abs = resolve(root, p);
      if (!existsSync(abs)) fail(`typesVersions path missing on disk: ${p}`);
    }
  }
}

// 2) Entrypoint .d.ts must re-export the public names.
const indexDts = resolve(root, "dist/types/test-utils/index.d.ts");
if (existsSync(indexDts)) {
  const src = readFileSync(indexDts, "utf8");
  for (const name of ["ScreenshotPathStyle", "SliderFocusFailureOptions"]) {
    if (!new RegExp(`\\b${name}\\b`).test(src)) {
      fail(`entrypoint index.d.ts does not export ${name}`);
    }
  }
} else {
  fail(`missing emitted entrypoint: dist/types/test-utils/index.d.ts`);
}

// 3) Pure module .d.ts must declare both with the documented shape.
const pureDts = resolve(root, "dist/types/test-utils/slider-thumb-focus.d.ts");
if (existsSync(pureDts)) {
  const src = readFileSync(pureDts, "utf8");

  const unionRe =
    /export\s+type\s+ScreenshotPathStyle\s*=\s*"absolute"\s*\|\s*"relative"\s*\|\s*"basename"\s*;/;
  if (!unionRe.test(src)) {
    fail(
      `ScreenshotPathStyle union not emitted as expected ("absolute" | "relative" | "basename")`,
    );
  }

  const ifaceRe =
    /export\s+interface\s+SliderFocusFailureOptions\s*\{[\s\S]*?pathStyle\?:\s*ScreenshotPathStyle\s*;[\s\S]*?\}/;
  if (!ifaceRe.test(src)) {
    fail(
      `SliderFocusFailureOptions interface (or its pathStyle?: ScreenshotPathStyle field) not emitted as expected`,
    );
  }
} else {
  fail(`missing emitted pure module: dist/types/test-utils/slider-thumb-focus.d.ts`);
}

if (failures.length) {
  console.error("✗ emitted .d.ts verification failed:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("✓ emitted .d.ts files match the package's public type surface");
