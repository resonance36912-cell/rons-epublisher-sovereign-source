#!/usr/bin/env node
// Static security scanner for edge functions and SQL migrations (policies).
// Fails the build on any high/critical finding not listed in the baseline.
//
// Baseline file: scripts/security-scan-baseline.json
// Format: { "ignored": ["<finding-id>", ...] }
//
// Each finding has a stable id of the form "<severity>:<rule>:<file>:<extra>".

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "supabase/functions");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const BASELINE_PATH = join(ROOT, "scripts/security-scan-baseline.json");

function walk(dir, filter) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const findings = [];
const push = (severity, rule, file, message, extra = "") =>
  findings.push({
    id: `${severity}:${rule}:${relative(ROOT, file)}${extra ? ":" + extra : ""}`,
    severity,
    rule,
    file: relative(ROOT, file),
    message,
  });

// ---------- Edge function checks ----------
for (const file of walk(FUNCTIONS_DIR, (p) => p.endsWith(".ts") && !p.includes("/_shared/") && !p.endsWith(".test.ts") && !p.endsWith("_test.ts"))) {
  const src = readFileSync(file, "utf8");
  const isIndex = basename(file) === "index.ts";
  if (!isIndex) continue;

  // CORS wildcard with credentials would be critical.
  if (/Access-Control-Allow-Credentials["']?\s*:\s*["']true["']/.test(src) && /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/.test(src)) {
    push("critical", "cors-wildcard-with-credentials", file, "CORS allows credentials with wildcard origin");
  }

  // Service-role key used without JWT verification AND no explicit auth check.
  const usesServiceRole = /SUPABASE_SERVICE_ROLE_KEY/.test(src);
  const funcName = basename(dirname(file));
  const configPath = join(ROOT, "supabase/config.toml");
  const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const verifyJwtFalse = new RegExp(`\\[functions\\.${funcName}\\][^\\[]*verify_jwt\\s*=\\s*false`, "s").test(config);
  const checksAuth = /auth\.getUser\(|Authorization|x-user-id|verify(Jwt|JWT)|has_role|service_role.*verify/i.test(src);
  if (usesServiceRole && verifyJwtFalse && !checksAuth) {
    push("high", "service-role-without-auth", file, `Function ${funcName} uses service role with verify_jwt=false and no in-code auth check`);
  }

  // eval / new Function
  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) {
    push("critical", "dynamic-code-execution", file, "Use of eval() or new Function()");
  }

  // SQL string interpolation into rpc/from with template literals (heuristic)
  if (/\.rpc\(`[^`]*\$\{/.test(src)) {
    push("high", "sql-interpolation", file, "Template literal interpolation into .rpc() argument");
  }
}

// ---------- Migration / RLS checks ----------
for (const file of walk(MIGRATIONS_DIR, (p) => p.endsWith(".sql"))) {
  const src = readFileSync(file, "utf8");
  const lower = src.toLowerCase();

  // Disabling RLS on a public table.
  const disableMatches = [...lower.matchAll(/alter\s+table\s+(public\.)?([a-z0-9_]+)\s+disable\s+row\s+level\s+security/g)];
  for (const m of disableMatches) {
    push("critical", "rls-disabled", file, `RLS disabled on table ${m[2]}`, m[2]);
  }

  // Policy granted to anon role with permissive USING (true).
  const policyBlocks = [...src.matchAll(/create\s+policy[\s\S]*?;/gi)];
  for (const pb of policyBlocks) {
    const block = pb[0].toLowerCase();
    const toAnon = /\bto\s+(anon|public)\b/.test(block);
    const permissive = /using\s*\(\s*true\s*\)/.test(block);
    if (toAnon && permissive) {
      push("high", "policy-anon-permissive", file, "Policy grants anon/public with USING (true)", String(pb.index));
    }
  }

  // SECURITY DEFINER function without SET search_path.
  const defBlocks = [...src.matchAll(/create\s+(or\s+replace\s+)?function[\s\S]*?(\$\$[\s\S]*?\$\$|language\s+\w+\s*;)/gi)];
  for (const db of defBlocks) {
    const block = db[0].toLowerCase();
    if (/security\s+definer/.test(block) && !/set\s+search_path\s*=/.test(block)) {
      push("high", "definer-without-search-path", file, "SECURITY DEFINER function missing SET search_path", String(db.index));
    }
  }
}

// ---------- Baseline filtering ----------
let baseline = { ignored: [] };
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}
const ignored = new Set(baseline.ignored || []);

const blocking = findings.filter(
  (f) => (f.severity === "high" || f.severity === "critical") && !ignored.has(f.id),
);

console.log(`Security scan: ${findings.length} total findings, ${blocking.length} blocking (high/critical, not baselined).`);
for (const f of findings) {
  const tag = ignored.has(f.id) ? "[baselined]" : `[${f.severity}]`;
  console.log(`  ${tag} ${f.rule}  ${f.file}  — ${f.message}`);
  console.log(`      id: ${f.id}`);
}

if (blocking.length > 0) {
  console.error(`\n❌ ${blocking.length} new high/critical security finding(s). Fix them or, if intentional, add their id to scripts/security-scan-baseline.json.`);
  process.exit(1);
}
console.log("\n✅ No new high/critical security findings.");
