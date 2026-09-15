/**
 * Staging end-to-end probe: paid generation must be authorized by the
 * Resonance Hub, and free-tier users must be blocked with a 402
 * `upgrade_required` payload that carries a valid hub `upgrade_url`.
 *
 * This is intentionally a Deno script (not a Deno.test) so it can run
 * against a staging deployment without touching the sandboxed CI test
 * runner. Run it manually from a workstation that has staging creds:
 *
 *   STAGING_FUNCTIONS_URL="http://127.0.0.1:58600/functions/v1" \
 *   STAGING_ANON_KEY="<staging anon key>" \
 *   STAGING_FREE_USER_JWT="<access_token for a signed-in free-tier user>" \
 *   HUB_URL="https://reson8.life" \
 *   deno run --allow-net --allow-env scripts/staging-e2e-paid-generation.ts
 *
 * Optional:
 *   STAGING_PAID_USER_JWT — if provided, also verifies that a creator-tier
 *   user gets an authorized 200 response (image URL) from the same
 *   endpoint. Omit to only run the block-on-402 assertion.
 */

function must(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    Deno.exit(2);
  }
  return v;
}

const FUNCTIONS_URL = must("STAGING_FUNCTIONS_URL").replace(/\/+$/, "");
const ANON_KEY      = must("STAGING_ANON_KEY");
const FREE_JWT      = must("STAGING_FREE_USER_JWT");
const PAID_JWT      = Deno.env.get("STAGING_PAID_USER_JWT") ?? "";
const HUB_URL       = (Deno.env.get("HUB_URL") ?? "https://reson8.life").replace(/\/+$/, "");

const ENDPOINT = `${FUNCTIONS_URL}/generate-chapter-image`;

async function callGenerate(jwt: string) {
  const body = {
    chapterId: `staging-e2e-${crypto.randomUUID()}`,
    imagePrompt: "A calm ocean at sunrise, cinematic lighting.",
    imageStyle: "cinematic",
    orientation: "landscape",
    mode: "final", // must be a *paid* path to reach the hub gate
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "apikey": ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep as text */ }
  return { status: res.status, json, text };
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  Deno.exit(1);
}

console.log(`→ POST ${ENDPOINT} as free-tier user`);
const freeRes = await callGenerate(FREE_JWT);
console.log(`  status=${freeRes.status}`);

if (freeRes.status !== 402) {
  fail(
    `Expected 402 upgrade_required for free-tier user, got ${freeRes.status}. ` +
    `Body: ${freeRes.text.slice(0, 400)}`,
  );
}

const body = (freeRes.json ?? {}) as Record<string, unknown>;
if (body.error !== "upgrade_required") {
  fail(`Expected body.error="upgrade_required", got ${JSON.stringify(body.error)}`);
}
if (body.app !== "epublisher") {
  fail(`Expected body.app="epublisher", got ${JSON.stringify(body.app)}`);
}
const upgradeUrl = String(body.upgrade_url ?? "");
if (!upgradeUrl.startsWith(`${HUB_URL}/checkout?app=epublisher`)) {
  fail(`upgrade_url must point at hub checkout, got ${upgradeUrl}`);
}
console.log("✓ free-tier user blocked with 402 upgrade_required + valid hub upgrade_url");
console.log(`  upgrade_url = ${upgradeUrl}`);

if (PAID_JWT) {
  console.log(`→ POST ${ENDPOINT} as paid (creator+) user`);
  const paidRes = await callGenerate(PAID_JWT);
  console.log(`  status=${paidRes.status}`);
  if (paidRes.status !== 200) {
    fail(
      `Expected 200 for paid user, got ${paidRes.status}. ` +
      `Body: ${paidRes.text.slice(0, 400)}`,
    );
  }
  const paidBody = (paidRes.json ?? {}) as Record<string, unknown>;
  if (!paidBody.imageUrl && !paidBody.provider) {
    fail(`Paid response missing imageUrl/provider: ${paidRes.text.slice(0, 400)}`);
  }
  console.log(`✓ paid user authorized via hub, provider=${paidBody.provider}`);
} else {
  console.log("• skipping paid-user assertion (STAGING_PAID_USER_JWT not set)");
}

console.log("\nAll staging hub-gate assertions passed.");
