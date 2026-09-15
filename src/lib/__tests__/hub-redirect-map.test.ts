import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HUB_PATH_MAP,
  HUB_URL,
  SPOKE_ORIGINS,
  hubCanonical,
  isRedirectableRoute,
} from "../hub-redirect-map";

const script = readFileSync(
  resolve(process.cwd(), "scripts/generate-hub-redirects.mjs"),
  "utf8",
);

describe("hub redirect map", () => {
  it("maps known public routes to their Hub equivalents", () => {
    expect(hubCanonical("/pricing")).toBe(`${HUB_URL}/pricing`);
    expect(hubCanonical("/contact?x=1")).toBe(`${HUB_URL}/support`);
    expect(hubCanonical("/")).toBe(`${HUB_URL}/apps/epublisher`);
  });

  it("falls back to the app page for unmapped routes", () => {
    expect(hubCanonical("/whatever")).toBe(`${HUB_URL}/apps/epublisher`);
  });

  it("never redirects app, auth or payment routes", () => {
    for (const p of ["/app", "/app/editor", "/auth/callback", "/checkout/return", "/admin"]) {
      expect(isRedirectableRoute(p)).toBe(false);
    }
    expect(isRedirectableRoute("/pricing")).toBe(true);
  });

  it("keeps the generator script in sync with the map", () => {
    for (const [from, to] of Object.entries(HUB_PATH_MAP)) {
      expect(script).toContain(`"${from}": "${to}"`);
    }
    for (const origin of SPOKE_ORIGINS) {
      expect(script).toContain(origin);
    }
  });
});
