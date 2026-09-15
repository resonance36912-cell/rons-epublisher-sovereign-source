#!/usr/bin/env node
/**
 * Entry point for `npm run verify:sitemap`.
 *
 * Runs the three sitemap gates in order and forwards CLI options:
 *
 *   --base-url=<url>    verify an already-running origin (staging, prod, dev)
 *                       instead of building a local `vite preview` on dist/.
 *                       In this mode the local-file gates (XML validation of
 *                       public/, dist/ parity) are skipped, because the origin
 *                       — not this checkout — is what is under test.
 *   --preview-port=<n>  port for the spawned preview server (local mode only).
 *   --max-redirects=<n> redirect hops allowed per <loc> (0-20, default 5).
 *   --allowed-redirect-hosts=<a,b>  hostnames a redirect may land on.
 *   --concurrency=<n>   parallel <loc> requests (default 6).
 *   --retries=<n>       retries with exponential backoff (default 2).
 *   --retry-base-delay=<ms> / --request-timeout=<ms> / --slow-threshold=<ms>
 *   --compare-baseline=<file>  previous report JSON to diff against
 *                       (default: the existing docs/generated report).
 *   --no-failure-screenshots  skip PNG capture of failing <loc> pages
 *                       (captured to docs/generated/sitemap-failure-screenshots
 *                       by default and attached to CI artifacts).
 *   --screenshot-dir=<dir> / --screenshot-limit=<n>
 *   --fail-on-new-failures  regression mode: fail only when a URL/shard that
 *                       passed in the baseline (or is brand new) is failing.
 *
 *   npm run verify:sitemap
 *   npm run verify:sitemap -- --preview-port=4200
 *   npm run verify:sitemap -- --base-url=https://www.resonanceonline.life
 *   npm run verify:sitemap -- --fail-on-new-failures
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const remote = has("base-url") || Boolean(process.env.SITEMAP_BASE_URL);
const compareOnly =
  has("fail-on-new-failures") || process.env.SITEMAP_FAIL_ON_NEW_FAILURES === "1";

// In regression mode only the served check matters: the strict local gates
// would fail the run on pre-existing issues we're deliberately tolerating.
const steps = remote || compareOnly
  ? [["scripts/verify-served-sitemap.mjs", args]]
  : [
      ["scripts/validate-sitemap.mjs", []],
      ["scripts/verify-dist-sitemap.mjs", []],
      ["scripts/verify-served-sitemap.mjs", args],
    ];

if (compareOnly) {
  console.log("verify:sitemap — regression mode: failing only on new URL/shard failures.\n");
}
if (remote) {
  console.log("verify:sitemap — remote mode: skipping local public/ and dist/ gates.\n");
}

for (const [script, scriptArgs] of steps) {
  const result = spawnSync(process.execPath, [resolve(script), ...scriptArgs], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
