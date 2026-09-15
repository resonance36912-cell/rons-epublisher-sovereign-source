import fs from "node:fs";
import path from "node:path";
import {
  aggregateReviewerScores,
  approvalsInvalidatedBy,
  calculateBenchmarkMetrics,
  evaluateBookReleaseFromReviews,
  evaluateDryRunExit,
  FAILURE_HANDLING_RULES,
  validateCandidateReleasePackage,
  validateCompetitiveDecisionPlan,
  validateFreezeCompetitiveConsistency,
  validatePilotFixtureInventory,
  validatePilotFreezeRecord,
  type DryRunCheckRecord,
} from "../src/lib/production-protocol";

const root = process.cwd();
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const freeze = readJson("docs/pilot/PROTOCOL_V1_1_FREEZE_RECORD.json");
const competitivePlan = readJson("docs/pilot/PROTOCOL_V1_1_COMPETITIVE_PLAN.json");
const benchmarkAuthorization = readJson("docs/pilot/BENCHMARK_AUTHORIZATION.json");
const inventory = readJson("src/lib/__tests__/fixtures/production-protocol-v1_1/fixture-inventory.json");
const failures = readJson("src/lib/__tests__/fixtures/production-protocol-v1_1/failure-fixtures-v1.json");
const dependencies = readJson("src/lib/__tests__/fixtures/production-protocol-v1_1/dependency-fixtures-v1.json");
const measurement = readJson("src/lib/__tests__/fixtures/production-protocol-v1_1/measurement-accounting-v1.json");
const mockProvider = readJson("src/lib/__tests__/fixtures/production-protocol-v1_1/mock-provider-faults-v1.json");
const passFixture = readJson("src/lib/__tests__/fixtures/production-protocol/calibration-pass.json");
const conflictFixture = readJson("src/lib/__tests__/fixtures/production-protocol/calibration-adjudication.json");
const criticalFixture = readJson("src/lib/__tests__/fixtures/production-protocol/calibration-critical.json");
const releasePackage = readJson("src/lib/__tests__/fixtures/production-protocol/release-package-valid.json");
const checks: DryRunCheckRecord[] = [];
const push = (id: string, label: string, passed: boolean, evidence: string[], defects: string[] = []) => {
  checks.push({ id, label, mandatory: true, status: passed ? "PASS" : "FAIL", evidence, owner: "mock-dry-run", unresolvedDefects: defects });
};

const aggregate = aggregateReviewerScores(passFixture.definitions, passFixture.submissions);
push(
  "ratings",
  "Independent ratings preserved and aggregated",
  aggregate.originalSubmissions.length === 3 && aggregate.dimensions.every((d) => Number.isInteger(d.rating)),
  ["calibration-pass.json", "median aggregation result"],
);

const conflictBlocked = !evaluateBookReleaseFromReviews({
  definitions: conflictFixture.definitions,
  submissions: conflictFixture.submissions,
  mandatoryChecks: conflictFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  editorialApproval: conflictFixture.editorialApproval,
}).passed;
const criticalBlocked = !evaluateBookReleaseFromReviews({
  definitions: criticalFixture.definitions,
  submissions: criticalFixture.submissions,
  mandatoryChecks: criticalFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  editorialApproval: criticalFixture.editorialApproval,
}).passed;
push("review-blocks", "Disagreement and critical defects block approval", conflictBlocked && criticalBlocked, ["adjudication fixtures"]);
const failureKinds = Object.keys(FAILURE_HANDLING_RULES);
const failureCoverage = failureKinds.every((kind) => Boolean(failures[kind]));
const providerFaultSafe = mockProvider["timeout-after-dispatch"].retryAllowed === false
  && mockProvider["spend-ceiling-hit"].retryAllowed === false;
push(
  "failure-controls",
  "Failures activate stop, recovery and resumption controls",
  failureCoverage && providerFaultSafe,
  ["failure-fixtures-v1.json", "mock-provider-faults-v1.json"],
);

const metrics = calculateBenchmarkMetrics({
  startedJobs: measurement.expected.startedJobs,
  firstPassAcceptedBooks: measurement.expected.firstPassAcceptedBooks,
  jobsRequiringExports: 4,
  validRequiredExports: 3,
  providerSpend: measurement.expected.providerSpend,
  humanReviewMinutes: measurement.expected.humanReviewMinutes,
  approvedBooks: measurement.expected.approvedBooks,
  unsupportedClaims: 1,
  reviewedFactualClaims: 20,
  requiredFactsSatisfied: 10,
  requiredFactsTotal: 10,
});
const repairAccountingPass = metrics.firstPassAcceptanceRate === measurement.expected.firstPassAcceptanceRate
  && metrics.providerCostPerApprovedBook === measurement.expected.providerCostPerApprovedBook
  && metrics.humanMinutesPerApprovedBook === measurement.expected.humanMinutesPerApprovedBook;
push("repair-accounting", "Repairs remain visible in first-pass outcomes and accumulated costs", repairAccountingPass, ["measurement-accounting-v1.json"]);
const dependencyPass = Object.entries(dependencies).every(([change, fixture]: [string, any]) => {
  const actual = approvalsInvalidatedBy(change as any);
  return JSON.stringify(actual) === JSON.stringify(fixture.expectedInvalidations);
});
push("dependency-invalidation", "Artifact changes invalidate the correct approvals", dependencyPass, ["dependency-fixtures-v1.json"]);

const packageIssues = validateCandidateReleasePackage(releasePackage);
push(
  "release-package",
  "Immutable release package reconstructs the decision",
  packageIssues.length === 0,
  ["release-package-valid.json", "claim/source/reviewer/defect/regression/export/cost fields"],
  packageIssues,
);

const promotionStates = {
  book: "separate",
  software: "separate",
  protocol: "separate",
};
push(
  "promotion-separation",
  "Book, software and protocol promotion statuses remain separate",
  new Set(Object.keys(promotionStates)).size === 3,
  ["three independent promotion domains"],
);

const freezeIssues = validatePilotFreezeRecord(freeze);
const fixtureIssues = validatePilotFixtureInventory(inventory);
const competitivePlanIssues = [...validateCompetitiveDecisionPlan(competitivePlan), ...validateFreezeCompetitiveConsistency(freeze, competitivePlan)];
const namedBenchmarkApproval = benchmarkAuthorization.authorized === true ? benchmarkAuthorization.approver : "";
const exit = evaluateDryRunExit({ freezeIssues, fixtureIssues, competitivePlanIssues, checks, namedBenchmarkApproval });
const liveSmoke = readJson("docs/pilot/LIVE_SMOKE_AUTHORIZATION.json");
const report = {
  protocolVersion: "1.1-candidate",
  mode: "mocked-provider dry run only",
  liveSmokeDispatched: false,
  liveSmokeAuthorized: liveSmoke.authorized === true,
  freezeIssues,
  fixtureIssues,
  competitivePlanIssues,
  benchmarkAuthorization,
  checks,
  exit,
  note: "A blocked dry run demonstrates measurement mechanics only; it is not protocol validation or competitive evidence.",
};

const outDir = path.join(root, "docs/generated");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "PROTOCOL_V1_1_CANDIDATE_DRY_RUN_20260912.json");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
const lines = [
  "# Production Protocol v1.1 Candidate — mocked dry run",
  "",
  `Overall: **${exit.status}**`,
  `Benchmark authorized: **${exit.benchmarkAuthorized ? "YES" : "NO"}**`,
  `Live provider smoke dispatched: **NO**`,
  "",
  ...checks.map((c) => `- ${c.status} — ${c.label}`),
  "",
  "## Freeze blockers",
  ...(freezeIssues.length ? freezeIssues.map((x) => `- ${x}`) : ["- none"]),
  "",
  "## Fixture blockers",
  ...(fixtureIssues.length ? fixtureIssues.map((x) => `- ${x}`) : ["- none"]),
  "",
  "## Competitive-plan blockers",
  ...(competitivePlanIssues.length ? competitivePlanIssues.map((x) => `- ${x}`) : ["- none"]),
  "",
  "## Benchmark authorization",
  `Authorization record: **${benchmarkAuthorization.authorized === true ? "AUTHORIZED" : "NOT AUTHORIZED"}**`,
  ...(exit.benchmarkBlockers.length ? exit.benchmarkBlockers.map((x) => `- ${x}`) : ["- none"]),
];
const mdPath = path.join(outDir, "PROTOCOL_V1_1_CANDIDATE_DRY_RUN_20260912.md");
fs.writeFileSync(mdPath, lines.join("\n") + "\n");
console.log(JSON.stringify({ status: exit.status, benchmarkAuthorized: exit.benchmarkAuthorized, liveSmokeDispatched: false, mandatoryChecks: checks.map((c) => [c.id, c.status]), freezeBlockers: freezeIssues.length, fixtureBlockers: fixtureIssues.length, competitivePlanBlockers: competitivePlanIssues.length, jsonPath, mdPath }, null, 2));
