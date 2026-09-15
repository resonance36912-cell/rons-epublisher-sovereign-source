import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAILURE_HANDLING_RULES,
  aggregateReviewerScores,
  calculateQualityScore,
  evaluateBookReleaseFromReviews,
  evaluateBoundedSuperiorityClaim,
  validateCandidateReleasePackage,
} from "../src/lib/production-protocol";
import passFixture from "../src/lib/__tests__/fixtures/production-protocol/calibration-pass.json";
import adjudicationFixture from "../src/lib/__tests__/fixtures/production-protocol/calibration-adjudication.json";
import criticalFixture from "../src/lib/__tests__/fixtures/production-protocol/calibration-critical.json";
import releasePackageFixture from "../src/lib/__tests__/fixtures/production-protocol/release-package-valid.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "..", "docs", "generated");
fs.mkdirSync(outputDir, { recursive: true });

const cleanAggregation = aggregateReviewerScores(passFixture.definitions as any, passFixture.submissions as any);
const cleanRelease = evaluateBookReleaseFromReviews({
  definitions: passFixture.definitions as any,
  submissions: passFixture.submissions as any,
  mandatoryChecks: passFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  editorialApproval: passFixture.editorialApproval,
});
const adjudicationBlocked = evaluateBookReleaseFromReviews({
  definitions: adjudicationFixture.definitions as any,
  submissions: adjudicationFixture.submissions as any,
  mandatoryChecks: adjudicationFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  editorialApproval: adjudicationFixture.editorialApproval,
});
const adjudicationResolved = evaluateBookReleaseFromReviews({
  definitions: adjudicationFixture.definitions as any,
  submissions: adjudicationFixture.submissions as any,
  mandatoryChecks: adjudicationFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  adjudications: { visual: "Calibration anchors reviewed; median 4 retained." },
  editorialApproval: adjudicationFixture.editorialApproval,
});
const criticalBlocked = evaluateBookReleaseFromReviews({
  definitions: criticalFixture.definitions as any,
  submissions: criticalFixture.submissions as any,
  mandatoryChecks: criticalFixture.mandatoryChecks,
  unresolvedCriticalDefects: [],
  editorialApproval: criticalFixture.editorialApproval,
});
const packageIssues = validateCandidateReleasePackage(releasePackageFixture as any);
const competitiveGate = evaluateBoundedSuperiorityClaim({
  benchmarkName: "synthetic calibration dry run",
  comparatorName: "not-tested",
  comparatorPlan: "not-tested",
  testedBuildId: "dry-run-build",
  resultSummary: "no competitive result",
  improvement: 0,
  intervalLower: 0,
  intervalUpper: 0,
  minimumMeaningfulImprovement: 0.1,
  prespecifiedPlanIssues: ["No comparator benchmark has been preregistered for this dry run."],
});

const checks = {
  cleanMedianScoreIs90: calculateQualityScore(cleanAggregation.dimensions) === 90,
  cleanFixturePasses: cleanRelease.passed,
  disagreementBlocksWithoutAdjudication: !adjudicationBlocked.passed,
  disagreementPassesWithAdjudication: adjudicationResolved.passed,
  unresolvedCriticalFindingBlocks: !criticalBlocked.passed,
  releasePackageIsComplete: packageIssues.length === 0,
  allFailureClassesDefined: Object.keys(FAILURE_HANDLING_RULES).length === 7,
  competitiveClaimRemainsBlocked: !competitiveGate.passed,
};
const measurementProcessPassed = Object.values(checks).every(Boolean);
const result = {
  protocol: "Production Protocol v1.0 — Candidate",
  dryRunType: "synthetic calibration and measurement-process dry run",
  timestamp: new Date().toISOString(),
  measurementProcessPassed,
  checks,
  cleanMedianRatings: cleanAggregation.dimensions.map(({ id, rating }) => ({ id, rating })),
  cleanScore: calculateQualityScore(cleanAggregation.dimensions),
  adjudicationBlockers: adjudicationBlocked.blockers,
  criticalBlockers: criticalBlocked.blockers,
  competitiveClaimAllowed: competitiveGate.passed,
  note: "This dry run is not production validation, software approval, protocol validation, or competitive evidence.",
};
const jsonPath = path.join(outputDir, "PROTOCOL_V1_CANDIDATE_DRY_RUN_20260912.json");
const mdPath = path.join(outputDir, "PROTOCOL_V1_CANDIDATE_DRY_RUN_20260912.md");
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf8");
const lines = [
  "# Production Protocol v1.0 — Candidate Dry Run",
  "",
  `Measurement process: **${measurementProcessPassed ? "PASS" : "FAIL"}**`,
  `Synthetic clean-fixture score: **${result.cleanScore}/100**`,
  "",
  "## Checks",
  ...Object.entries(checks).map(([name, passed]) => `- ${passed ? "PASS" : "FAIL"}: ${name}`),
  "",
  "## Boundaries",
  "This run used synthetic calibration fixtures. It is not a production book approval, software approval, protocol validation, or competitive benchmark.",
  "The competitive-claim gate remained blocked by design because no comparator benchmark was preregistered or run.",
  "",
];
fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ measurementProcessPassed, jsonPath, mdPath, checks }, null, 2));
if (!measurementProcessPassed) process.exitCode = 1;