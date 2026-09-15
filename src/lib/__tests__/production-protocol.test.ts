import { describe, expect, it } from "vitest";
import {
  approvalsInvalidatedBy,
  calculateBenchmarkMetrics,
  calculateQualityScore,
  evaluateBookRelease,
  evaluateSoftwareRelease,
  validateCompetitiveDecisionPlan,
  validateFreezeCompetitiveConsistency,
  aggregateReviewerScores,
  evaluateBookReleaseFromReviews,
  FAILURE_HANDLING_RULES,
  validateCandidateReleasePackage,
  evaluateBoundedSuperiorityClaim,
  formatBoundedBenchmarkClaim,
  validatePilotFreezeRecord,
  validatePilotFixtureInventory,
  evaluateDryRunExit,
  validateDryRunCheckRecord,
  validateBenchmarkAuthorization,
  validateProtocolAmendment,
  PRODUCTION_PROTOCOL_VERSION,
  type QualityDimension,
  type DryRunCheckRecord,
} from "../production-protocol";

import passFixture from "./fixtures/production-protocol/calibration-pass.json";
import adjudicationFixture from "./fixtures/production-protocol/calibration-adjudication.json";
import criticalFixture from "./fixtures/production-protocol/calibration-critical.json";
import releasePackageFixture from "./fixtures/production-protocol/release-package-valid.json";
import v11Inventory from "./fixtures/production-protocol-v1_2/fixture-inventory.json";

const dimensions: QualityDimension[] = [
  { id: "facts", label: "Factual quality", weight: 25, rating: 5 },
  { id: "prose", label: "Prose quality", weight: 25, rating: 5 },
  { id: "visual", label: "Visual quality", weight: 25, rating: 4 },
  { id: "layout", label: "Layout quality", weight: 25, rating: 4 },
];

const makeExecutionCheck = (id: string, status: "NOT_RUN" | "PASS" | "FAIL" | "BLOCKED" = "PASS", prerequisiteBlockers: string[] = []): DryRunCheckRecord => ({
  id, fixtureVersion: "v1.2-test-1", frozenSpecificationId: "sha256:test-spec",
  requirement: "Exercise mandatory control", preconditions: ["test precondition"],
  inputOrInjectedFault: "reproducible fixture input", expectedResult: "pre-recorded expected behavior",
  requiredEvidence: ["required-evidence"], actualResult: status === "PASS" || status === "FAIL" ? "observed result" : "",
  evidence: status === "PASS" || status === "FAIL" ? ["evidence-id"] : [], status,
  defectAndRetestReferences: [], executor: status === "PASS" || status === "FAIL" ? "executor" : "", reviewer: "",
  executedAt: status === "PASS" || status === "FAIL" ? "2026-09-12T07:37:00+02:00" : "", mandatory: true, prerequisiteBlockers,
});

describe("Production Protocol v1.2 Candidate", () => {
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
describe("Production Protocol v1.2 operational addendum", () => {
  const completeFreeze = {
    protocolVersion: "1.1-candidate",
    rubricVersion: "rubric-v1",
    fixtureSetVersion: "fixtures-v1",
    analysisPlanVersion: "analysis-v1",
    scope: "six-page illustrated biographies",
    exclusions: ["long-form fiction"],
    releaseGates: ["book", "software", "protocol"],
    scoringExampleSetId: "examples-v1",
    reviewerIds: ["r1", "r2", "r3"],
    adjudicator: "adjudicator",
    approvalAuthority: "approval owner",
    comparatorName: "comparator",
    comparatorPlan: "paid-plan",
    correctionAllowanceMinutes: 30,
    spendingCeiling: 20,
    stoppingRule: "complete prespecified sample",
    immutableIdentifier: "sha256:example",
    ownerSignatureName: "protocol owner",
    ownerSignedAt: "2026-09-12T06:00:00+02:00",
  };

  it("identifies the amended candidate version", () => {
    expect(PRODUCTION_PROTOCOL_VERSION).toBe("1.2-candidate");
  });
  it("blocks an incomplete freeze record and accepts a complete one", () => {
    const incomplete = { ...completeFreeze, reviewerIds: [], adjudicator: "", spendingCeiling: null, immutableIdentifier: "" };
    const issues = validatePilotFreezeRecord(incomplete as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("reviewer");
    expect(issues.join(" ")).toContain("Spending ceiling");
    expect(validatePilotFreezeRecord(completeFreeze as any)).toEqual([]);
  });

  it("requires every failure/dependency fixture and separation from unseen briefs", () => {
    expect(validatePilotFixtureInventory(v11Inventory as any)).toEqual([]);
    const mixed = { ...v11Inventory, unseenConfirmationBriefIds: [v11Inventory.calibrationFixtureIds[0]] };
    expect(validatePilotFixtureInventory(mixed as any).join(" ")).toContain("must remain separate");
  });

  it("keeps benchmark authorization blocked until all mandatory checks and named approval pass", () => {
    const checks: DryRunCheckRecord[] = [makeExecutionCheck("ratings")];
    const blocked = evaluateDryRunExit({ freezeIssues: ["Adjudicator is unresolved."], fixtureIssues: [], checks });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.benchmarkAuthorized).toBe(false);
  });
  it("authorizes benchmarking only after every mandatory dry-run requirement passes", () => {
    const checks: DryRunCheckRecord[] = [
      makeExecutionCheck("ratings"),
      makeExecutionCheck("failures"),
      makeExecutionCheck("package"),
    ];    const result = evaluateDryRunExit({ freezeIssues: [], fixtureIssues: [], checks, namedBenchmarkApproval: "Named approver" });
    expect(result).toEqual({ status: "PASS", blockers: [], benchmarkAuthorized: true, benchmarkBlockers: [] });
  });

  it("requires a versioned amendment and measurement-impact assessment after a material change", () => {
    expect(validateProtocolAmendment({
      amendmentId: "A-001", priorVersion: "1.0-candidate", newVersion: "1.2-candidate",
      changedFields: ["freeze record", "dry-run exit gate"],
      measurementImpactAssessment: "Prior synthetic dry-run evidence remains historical only; v1.1 dry-run must be rerun.",
      owner: "protocol owner", timestamp: "2026-09-12T06:00:00+02:00",
    })).toEqual([]);
    expect(validateProtocolAmendment({
      amendmentId: "", priorVersion: "1.1-candidate", newVersion: "1.2-candidate",
      changedFields: [], measurementImpactAssessment: "", owner: "", timestamp: "",
    })).not.toEqual([]);
  });
});

describe("Production Protocol v1.2 competitive authorization gate", () => {
  it("rejects null correction and spending limits", () => {
    const issues = validateCompetitiveDecisionPlan({
      comparatorName: "Comparator", comparatorPlan: "Plan",
      eligibleTasks: ["six-page illustrated biography"], requiredDeliverables: ["PDF"],
      primaryOutcome: "approved-book acceptance rate",
      correctionTimeLimitMinutes: null as any, spendingLimit: null as any,
      failureTreatment: "Count failures", tieTreatment: "Report ties",
      unsupportedInputTreatment: "Block and record",
      minimumMeaningfulImprovement: "10 percentage points",
      statisticalAnalysis: "Cluster by brief", stoppingRule: "Complete preregistered sample",
      unseenConfirmationBriefs: true,
    });
    expect(issues).toContain("Correction-time limit must be greater than zero.");
    expect(issues).toContain("Spending limit must be zero or greater.");
  });

  it("blocks benchmark authorization when competitive-plan issues remain", () => {
    const result = evaluateDryRunExit({
      freezeIssues: [], fixtureIssues: [], competitivePlanIssues: ["Comparator name is required."],
      checks: [makeExecutionCheck("m")],
      namedBenchmarkApproval: "Named approver",
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.benchmarkAuthorized).toBe(false);
  });
});

describe("Production Protocol v1.2 freeze/competitive consistency", () => {
  it("detects mismatched comparator, limits, and stopping rule", () => {
    const freeze = {
      comparatorName: "A", comparatorPlan: "Paid", correctionAllowanceMinutes: 30,
      spendingCeiling: 50, stoppingRule: "Complete sample",
    } as any;
    const plan = {
      comparatorName: "B", comparatorPlan: "Free", correctionTimeLimitMinutes: 20,
      spendingLimit: 40, stoppingRule: "Stop early",
    } as any;
    const issues = validateFreezeCompetitiveConsistency(freeze, plan);
    expect(issues).toEqual([
      "Comparator differs between freeze record and competitive plan.",
      "Comparator plan differs between freeze record and competitive plan.",
      "Correction allowance differs between freeze record and competitive plan.",
      "Spending ceiling differs between freeze record and competitive plan.",
      "Stopping rule differs between freeze record and competitive plan.",
    ]);
  });
});


describe("Production Protocol v1.2 execution-record addendum", () => {
  it("keeps an unexecuted mandatory check NOT_RUN rather than PASS", () => {
    const result = evaluateDryRunExit({ freezeIssues: [], fixtureIssues: [], checks: [makeExecutionCheck("x", "NOT_RUN")], namedBenchmarkApproval: "approver" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.benchmarkAuthorized).toBe(false);
  });
  it("reserves BLOCKED for a recorded prerequisite", () => {
    expect(validateDryRunCheckRecord(makeExecutionCheck("x", "BLOCKED", [])).join(" ")).toContain("recorded prerequisite");
    expect(validateDryRunCheckRecord(makeExecutionCheck("x", "BLOCKED", ["freeze incomplete"]))).toEqual([]);
  });
  it("requires expected outcomes before execution", () => {
    const record = { ...makeExecutionCheck("x", "NOT_RUN"), expectedResult: "", requiredEvidence: [] };
    expect(validateDryRunCheckRecord(record).join(" ")).toContain("Expected result");
  });
  it("binds benchmark authorization to the exact tested IDs", () => {
    const auth = { authorized:true, frozenSpecificationId:"sha256:s1", configurationId:"cfg1", dryRunEvidencePackageId:"dry1", benchmarkScope:"pilot", spendingCeiling:10, approver:"owner", approvedAt:"2026-09-12T07:37:00+02:00" };
    expect(validateBenchmarkAuthorization(auth, { frozenSpecificationId:"sha256:s1", configurationId:"cfg1", dryRunEvidencePackageId:"dry1" })).toEqual([]);
    expect(validateBenchmarkAuthorization(auth, { frozenSpecificationId:"sha256:s2", configurationId:"cfg1", dryRunEvidencePackageId:"dry1" }).join(" ")).toContain("frozen specification");
  });
});
