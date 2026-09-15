import { describe, expect, it } from "vitest";
import {
  approvalsInvalidatedBy,
  calculateBenchmarkMetrics,
  calculateQualityScore,
  evaluateBookRelease,
  evaluateSoftwareRelease,
  validateCompetitiveDecisionPlan,
  aggregateReviewerScores,
  evaluateBookReleaseFromReviews,
  FAILURE_HANDLING_RULES,
  validateCandidateReleasePackage,
  evaluateBoundedSuperiorityClaim,
  formatBoundedBenchmarkClaim,
  type QualityDimension,
} from "../production-protocol";

import passFixture from "./fixtures/production-protocol/calibration-pass.json";
import adjudicationFixture from "./fixtures/production-protocol/calibration-adjudication.json";
import criticalFixture from "./fixtures/production-protocol/calibration-critical.json";
import releasePackageFixture from "./fixtures/production-protocol/release-package-valid.json";

const dimensions: QualityDimension[] = [
  { id: "facts", label: "Factual quality", weight: 25, rating: 5 },
  { id: "prose", label: "Prose quality", weight: 25, rating: 5 },
  { id: "visual", label: "Visual quality", weight: 25, rating: 4 },
  { id: "layout", label: "Layout quality", weight: 25, rating: 4 },
];

describe("Production Protocol v1.0 Candidate", () => {
  it("calculates the weighted 0-5 score reproducibly", () => {
    expect(calculateQualityScore(dimensions)).toBe(90);
  });

  it("requires score >=90, every dimension >=4, mandatory checks, and named approval", () => {
    const result = evaluateBookRelease({
      dimensions,
      mandatoryChecks: [{ id: "facts", label: "Fact ledger approved", passed: true }],
      unresolvedCriticalDefects: [],
      editorialApproval: "Named editor",
    });
    expect(result).toMatchObject({ passed: true, score: 90 });
  });
  it("does not let a book pass substitute for software release evidence", () => {
    const result = evaluateSoftwareRelease({
      structureRegression: true,
      editPreservation: true,
      accessControls: false,
      cancellation: true,
      recovery: true,
      spendingLimits: true,
      namedApproval: "Release owner",
    });
    expect(result.passed).toBe(false);
    expect(result.blockers.join(" ")).toContain("Access controls");
  });

  it("invalidates only approvals affected by a dependency change", () => {
    expect(approvalsInvalidatedBy("source")).toEqual(["facts", "prose"]);
    expect(approvalsInvalidatedBy("image")).toEqual(["text-image", "layout"]);
    expect(approvalsInvalidatedBy("export-config")).toEqual(["exports"]);
  });

  it("reports no approved outputs instead of dividing by zero", () => {
    const metrics = calculateBenchmarkMetrics({
      startedJobs: 10, firstPassAcceptedBooks: 0,
      jobsRequiringExports: 10, validRequiredExports: 7,
      providerSpend: 50, humanReviewMinutes: 120,
      approvedBooks: 0, unsupportedClaims: 4,
      reviewedFactualClaims: 40, requiredFactsSatisfied: 30, requiredFactsTotal: 40,
    });
    expect(metrics.approvedOutputStatus).toBe("no-approved-outputs");
    expect(metrics.providerCostPerApprovedBook).toBeNull();
    expect(metrics.humanMinutesPerApprovedBook).toBeNull();
    expect(metrics.unsupportedClaimRate).toBe(0.1);
  });
  it("requires a fully predefined competitive decision before testing", () => {
    const issues = validateCompetitiveDecisionPlan({
      comparatorName: "Comparator",
      comparatorPlan: "Named paid plan",
      eligibleTasks: ["biography"],
      requiredDeliverables: ["approved book", "PDF"],
      primaryOutcome: "approved-book acceptance rate",
      correctionTimeLimitMinutes: 30,
      spendingLimit: 20,
      failureTreatment: "Count failures in denominator",
      tieTreatment: "Report tie",
      unsupportedInputTreatment: "Block and record",
      minimumMeaningfulImprovement: "10 percentage points",
      statisticalAnalysis: "Cluster by brief and account for repeated ratings",
      stoppingRule: "Complete the predefined sample",
      unseenConfirmationBriefs: true,
    });
    expect(issues).toEqual([]);
  });

  it("rejects quality weights that do not total 100", () => {
    expect(() => calculateQualityScore([
      { id: "facts", label: "Facts", weight: 50, rating: 5 },
      { id: "prose", label: "Prose", weight: 40, rating: 5 },
    ])).toThrow(/total 100/);
  });
});

describe("Production Protocol v1.0 Candidate operational clauses", () => {
  it("aggregates exactly three reviewer ratings by median and preserves originals", () => {
    const aggregated = aggregateReviewerScores(passFixture.definitions as any, passFixture.submissions as any);
    expect(aggregated.dimensions.map((d) => d.rating)).toEqual([5, 5, 4, 4]);
    expect(calculateQualityScore(aggregated.dimensions)).toBe(90);
    expect(aggregated.disagreementDimensionIds).toEqual([]);
    expect(aggregated.originalSubmissions).toHaveLength(3);
  });

  it("requires documented adjudication when reviewer spread is two or more points", () => {
    const blocked = evaluateBookReleaseFromReviews({
      definitions: adjudicationFixture.definitions as any,
      submissions: adjudicationFixture.submissions as any,
      mandatoryChecks: adjudicationFixture.mandatoryChecks,
      unresolvedCriticalDefects: [],
      editorialApproval: adjudicationFixture.editorialApproval,
    });
    expect(blocked.passed).toBe(false);
    expect(blocked.blockers.join(" ")).toContain("requires documented adjudication");
    const passed = evaluateBookReleaseFromReviews({
      definitions: adjudicationFixture.definitions as any,
      submissions: adjudicationFixture.submissions as any,
      mandatoryChecks: adjudicationFixture.mandatoryChecks,
      unresolvedCriticalDefects: [],
      adjudications: { visual: "Reviewed reference examples; median 4 retained." },
      editorialApproval: adjudicationFixture.editorialApproval,
    });
    expect(passed.passed).toBe(true);
  });

  it("blocks any unresolved reviewer critical finding", () => {
    const result = evaluateBookReleaseFromReviews({
      definitions: criticalFixture.definitions as any,
      submissions: criticalFixture.submissions as any,
      mandatoryChecks: criticalFixture.mandatoryChecks,
      unresolvedCriticalDefects: [],
      editorialApproval: criticalFixture.editorialApproval,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers.join(" ")).toContain("Unsupported biographical claim");
  });

  it("defines stop-and-resume evidence for every failure class", () => {
    expect(Object.keys(FAILURE_HANDLING_RULES)).toHaveLength(7);
    for (const rule of Object.values(FAILURE_HANDLING_RULES)) {
      expect(rule.handling.length).toBeGreaterThan(10);
      expect(rule.resumeEvidence.length).toBeGreaterThan(10);
    }
  });

  it("requires a complete immutable candidate release package", () => {
    expect(validateCandidateReleasePackage(releasePackageFixture as any)).toEqual([]);
    expect(validateCandidateReleasePackage({ ...releasePackageFixture, buildId: "" } as any)).toContain("Build ID is required.");
  });

  it("blocks competitive superiority wording unless the interval clears the meaningful threshold", () => {
    const evidence = {
      benchmarkName: "six-page illustrated biography pilot",
      comparatorName: "Named comparator",
      comparatorPlan: "Named plan",
      testedBuildId: "dry-run-build",
      resultSummary: "a 12 percentage-point improvement",
      improvement: 0.12,
      intervalLower: 0.04,
      intervalUpper: 0.20,
      minimumMeaningfulImprovement: 0.10,
      prespecifiedPlanIssues: [],
    };
    expect(evaluateBoundedSuperiorityClaim(evidence).passed).toBe(false);
    const qualifying = { ...evidence, intervalLower: 0.11 };
    expect(evaluateBoundedSuperiorityClaim(qualifying).passed).toBe(true);
    expect(formatBoundedBenchmarkClaim(qualifying)).toContain("On the specified benchmark");
  });

  it("rejects empty or duplicate reviewer identifiers", () => {
    const bad = structuredClone(passFixture.submissions) as any[];
    bad[0].reviewerId = "";
    expect(() => aggregateReviewerScores(passFixture.definitions as any, bad as any)).toThrow(/non-empty and unique/);
  });
});