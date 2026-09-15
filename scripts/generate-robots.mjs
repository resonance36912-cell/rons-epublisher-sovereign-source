#!/usr/bin/env node
/**
 * Generates public/robots.txt from scripts/site-routes.mjs — the same module
 * scripts/generate-sitemap.mjs reads. Runs on `predev` / `prebuild` before
 * sitemap generation, so blocked routes and indexed URLs can never drift.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DISALLOWED_PATHS,
  ROBOTS_USER_AGENTS,
  publicRoutes,
  sitemapDirectiveUrls,
} from "./site-routes.mjs";

const ROBOTS_PATH = resolve("public/robots.txt");

const groups = ROBOTS_USER_AGENTS.map((agent) =>
  [
    `User-agent: ${agent}`,
    `Allow: /`,
    ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
  ].join("\n"),
);

const sitemaps = sitemapDirectiveUrls();

const contents = [
  "# GENERATED FILE — do not edit by hand.",
  "# Source: scripts/generate-robots.mjs + scripts/site-routes.mjs",
  "# (runs on predev/prebuild after sitemap generation, same route",
  "#  source-of-truth as sitemap.xml; Sitemap: lines match the files emitted).",
  "",
  ...groups.flatMap((group) => [group, ""]),
  ...sitemaps.map((url) => `Sitemap: ${url}`),
  "",
].join("\n");

writeFileSync(ROBOTS_PATH, contents);
console.log(
  `robots.txt written (${ROBOTS_USER_AGENTS.length} user-agent groups, ` +
    `${DISALLOWED_PATHS.length} disallowed paths, ${publicRoutes().length} public routes allowed, ` +
    `${sitemaps.length} sitemap directive(s): ${sitemaps.join(", ")})`,
);
