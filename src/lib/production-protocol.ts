export const PRODUCTION_PROTOCOL_VERSION = "1.2-candidate" as const;
export const QUALITY_RELEASE_THRESHOLD = 90;

export type QualityRating = 0 | 1 | 2 | 3 | 4 | 5;

export type QualityDimension = {
  id: string;
  label: string;
  weight: number;
  rating: QualityRating;
};

export type NamedCheck = {
  id: string;
  label: string;
  passed: boolean;
  evidence?: string;
};

export type ReleaseGateResult = {
  passed: boolean;
  score?: number;
  blockers: string[];
  warnings: string[];
};

export function calculateQualityScore(dimensions: QualityDimension[]): number {
  if (!dimensions.length) throw new Error("At least one quality dimension is required.");
  const weightTotal = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (Math.abs(weightTotal - 100) > 0.001) {
    throw new Error(`Quality dimension weights must total 100; found ${weightTotal}.`);
  }
  return dimensions.reduce((sum, dimension) => sum + (dimension.weight * dimension.rating) / 5, 0);
}
export function evaluateBookRelease(input: {
  dimensions: QualityDimension[];
  mandatoryChecks: NamedCheck[];
  unresolvedCriticalDefects: string[];
  editorialApproval?: string;
}): ReleaseGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const score = calculateQualityScore(input.dimensions);

  if (score < QUALITY_RELEASE_THRESHOLD) blockers.push(`Quality score ${score.toFixed(1)} is below ${QUALITY_RELEASE_THRESHOLD}.`);
  for (const dimension of input.dimensions) {
    if (dimension.rating < 4) blockers.push(`${dimension.label} is ${dimension.rating}/5; every dimension must be at least 4/5.`);
  }
  for (const check of input.mandatoryChecks) {
    if (!check.passed) blockers.push(`Mandatory check failed: ${check.label}.`);
  }
  blockers.push(...input.unresolvedCriticalDefects.map((defect) => `Critical defect: ${defect}`));
  if (!input.editorialApproval?.trim()) blockers.push("Named editorial approval is required.");

  return { passed: blockers.length === 0, score, blockers, warnings };
}

export type SoftwareReleaseEvidence = {
  structureRegression: boolean;
  editPreservation: boolean;
  accessControls: boolean;
  cancellation: boolean;
  recovery: boolean;
  spendingLimits: boolean;
  namedApproval?: string;
};

export function evaluateSoftwareRelease(evidence: SoftwareReleaseEvidence): ReleaseGateResult {
  const blockers: string[] = [];
  const required: Array<[keyof SoftwareReleaseEvidence, string]> = [
    ["structureRegression", "Structure regression"],
    ["editPreservation", "Edit preservation"],
    ["accessControls", "Access controls"],
    ["cancellation", "Cancellation"],
    ["recovery", "Recovery"],
    ["spendingLimits", "Spending limits"],
  ];
  for (const [key, label] of required) if (!evidence[key]) blockers.push(`${label} evidence is missing or failed.`);
  if (!evidence.namedApproval?.trim()) blockers.push("Named software release approval is required.");
  return { passed: blockers.length === 0, blockers, warnings: [] };
}
export type ApprovalDomain =
  | "facts"
  | "prose"
  | "text-image"
  | "narration"
  | "layout"
  | "exports"
  | "software-regression"
  | "access-controls"
  | "recovery"
  | "spending-limits";

export type DependencyChange = "source" | "prose" | "image" | "export-config" | "build" | "model";

export function approvalsInvalidatedBy(change: DependencyChange): ApprovalDomain[] {
  switch (change) {
    case "source":
      return ["facts", "prose"];
    case "prose":
      return ["facts", "text-image", "narration", "layout"];
    case "image":
      return ["text-image", "layout"];
    case "export-config":
      return ["exports"];
    case "build":
    case "model":
      return ["software-regression"];
  }
}

export type BenchmarkInput = {
  startedJobs: number;
  firstPassAcceptedBooks: number;
  jobsRequiringExports: number;
  validRequiredExports: number;
  providerSpend: number;
  humanReviewMinutes: number;
  approvedBooks: number;
  unsupportedClaims: number;
  reviewedFactualClaims: number;
  requiredFactsSatisfied: number;
  requiredFactsTotal: number;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
export function calculateBenchmarkMetrics(input: BenchmarkInput) {
  return {
    firstPassAcceptanceRate: ratio(input.firstPassAcceptedBooks, input.startedJobs),
    exportSuccessRate: ratio(input.validRequiredExports, input.jobsRequiringExports),
    providerCostPerApprovedBook: input.approvedBooks > 0 ? input.providerSpend / input.approvedBooks : null,
    humanMinutesPerApprovedBook: input.approvedBooks > 0 ? input.humanReviewMinutes / input.approvedBooks : null,
    approvedOutputStatus: input.approvedBooks > 0 ? "approved-outputs" as const : "no-approved-outputs" as const,
    unsupportedClaimsPerBook: input.approvedBooks > 0 ? input.unsupportedClaims / input.approvedBooks : null,
    unsupportedClaimRate: ratio(input.unsupportedClaims, input.reviewedFactualClaims),
    requiredFactCoverage: ratio(input.requiredFactsSatisfied, input.requiredFactsTotal),
  };
}

export type CompetitiveDecisionPlan = {
  comparatorName: string;
  comparatorPlan: string;
  eligibleTasks: string[];
  requiredDeliverables: string[];
  primaryOutcome: string;
  correctionTimeLimitMinutes: number;
  spendingLimit: number;
  failureTreatment: string;
  tieTreatment: string;
  unsupportedInputTreatment: string;
  minimumMeaningfulImprovement: string;
  statisticalAnalysis: string;
  stoppingRule: string;
  unseenConfirmationBriefs: boolean;
};

export function validateCompetitiveDecisionPlan(plan: CompetitiveDecisionPlan): string[] {
  const issues: string[] = [];
  if (!plan.comparatorName.trim()) issues.push("Comparator name is required.");
  if (!plan.comparatorPlan.trim()) issues.push("Comparator product plan is required.");
  if (!plan.eligibleTasks.length) issues.push("At least one eligible task is required.");
  if (!plan.requiredDeliverables.length) issues.push("Required deliverables must be predefined.");
  if (!plan.primaryOutcome.trim()) issues.push("Primary outcome must be predefined.");
  if (!Number.isFinite(plan.correctionTimeLimitMinutes) || !(plan.correctionTimeLimitMinutes > 0)) issues.push("Correction-time limit must be greater than zero.");
  if (!Number.isFinite(plan.spendingLimit) || !(plan.spendingLimit >= 0)) issues.push("Spending limit must be zero or greater.");
  if (!plan.failureTreatment.trim()) issues.push("Failure treatment must be predefined.");
  if (!plan.tieTreatment.trim()) issues.push("Tie treatment must be predefined.");
  if (!plan.unsupportedInputTreatment.trim()) issues.push("Unsupported-input treatment must be predefined.");
  if (!plan.minimumMeaningfulImprovement.trim()) issues.push("Minimum meaningful improvement must be predefined.");
  if (!plan.statisticalAnalysis.trim()) issues.push("Statistical analysis must be predefined.");
  if (!plan.stoppingRule.trim()) issues.push("Stopping rule must be predefined.");
  if (!plan.unseenConfirmationBriefs) issues.push("Reserve unseen briefs for confirmation after tuning.");
  return issues;
}

export type GenerationArchitectureArm =
  | "reference-plus-page-brief"
  | "reference-plus-page-brief-plus-approved-prior-scene";


export type CriticalReviewFinding = {
  id: string;
  description: string;
  disposition?: "unresolved" | "resolved" | "dismissed";
  evidence?: string;
};

export type ReviewerSubmission = {
  reviewerId: string;
  ratings: Record<string, QualityRating>;
  criticalFindings?: CriticalReviewFinding[];
};

export type QualityDimensionDefinition = Omit<QualityDimension, "rating">;

export type ReviewerAggregation = {
  dimensions: QualityDimension[];
  disagreementDimensionIds: string[];
  criticalBlockers: string[];
  originalSubmissions: ReviewerSubmission[];
};

function medianOfThree(values: QualityRating[]): QualityRating {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[1];
}

export function aggregateReviewerScores(
  definitions: QualityDimensionDefinition[],
  submissions: ReviewerSubmission[],
): ReviewerAggregation {
  if (submissions.length !== 3) throw new Error("Exactly three reviewer submissions are required.");
  if (submissions.some((r) => !r.reviewerId.trim()) || new Set(submissions.map((r) => r.reviewerId.trim())).size !== 3) {
    throw new Error("Reviewer identifiers must be non-empty and unique.");
  }
  const dimensions = definitions.map((definition) => {
    const ratings = submissions.map((submission) => submission.ratings[definition.id]);
    if (ratings.some((rating) => !Number.isInteger(rating) || rating < 0 || rating > 5)) {
      throw new Error(`Each reviewer must rate ${definition.label} from 0 to 5.`);
    }
    return { ...definition, rating: medianOfThree(ratings as QualityRating[]) };
  });
  calculateQualityScore(dimensions);
  const disagreementDimensionIds = definitions.filter((definition) => {
    const values = submissions.map((submission) => submission.ratings[definition.id]);
    return Math.max(...values) - Math.min(...values) >= 2;
  }).map((definition) => definition.id);

  const criticalBlockers = submissions.flatMap((submission) =>
    (submission.criticalFindings || []).flatMap((finding) => {
      if (finding.disposition === "resolved") return [];
      if (finding.disposition === "dismissed" && finding.evidence?.trim()) return [];
      return [`Reviewer ${submission.reviewerId}: ${finding.description}`];
    }),
  );
  return {
    dimensions,
    disagreementDimensionIds,
    criticalBlockers,
    originalSubmissions: submissions.map((submission) => ({ ...submission })),
  };
}

export function evaluateBookReleaseFromReviews(input: {
  definitions: QualityDimensionDefinition[];
  submissions: ReviewerSubmission[];
  mandatoryChecks: NamedCheck[];
  unresolvedCriticalDefects: string[];
  adjudications?: Record<string, string>;
  editorialApproval?: string;
}): ReleaseGateResult {
  const aggregated = aggregateReviewerScores(input.definitions, input.submissions);
  const result = evaluateBookRelease({
    dimensions: aggregated.dimensions,
    mandatoryChecks: input.mandatoryChecks,

    unresolvedCriticalDefects: [...input.unresolvedCriticalDefects, ...aggregated.criticalBlockers],
    editorialApproval: input.editorialApproval,
  });
  const adjudicationBlockers = aggregated.disagreementDimensionIds
    .filter((id) => !input.adjudications?.[id]?.trim())
    .map((id) => `Reviewer disagreement for ${id} requires documented adjudication.`);
  return {
    ...result,
    passed: result.passed && adjudicationBlockers.length === 0,
    blockers: [...result.blockers, ...adjudicationBlockers],
  };
}

export type FailureKind =
  | "invalid-structure"
  | "unsupported-factual-claim"
  | "unintended-access"
  | "lost-edits-or-corrupt-assets"
  | "provider-interruption"
  | "spending-limit-reached"
  | "repair-limit-exhausted";

export const FAILURE_HANDLING_RULES: Record<FailureKind, { handling: string; resumeEvidence: string }> = {
  "invalid-structure": { handling: "Stop the affected job and block export.", resumeEvidence: "Passing structure validation." },
  "unsupported-factual-claim": { handling: "Block the affected book; correct or remove the claim.", resumeEvidence: "Updated claim ledger and editorial approval." },
  "unintended-access": { handling: "Suspend the affected release path and restrict access.", resumeEvidence: "Documented remediation and passing access-control retest." },

  "lost-edits-or-corrupt-assets": { handling: "Stop writes to the affected project and preserve recovery evidence.", resumeEvidence: "Verified restoration and preservation test." },
  "provider-interruption": { handling: "Mark the operation unresolved and reconcile provider status before retrying.", resumeEvidence: "Confirmed job status and duplicate-prevention check." },
  "spending-limit-reached": { handling: "Stop dispatching new paid work and disclose already committed charges.", resumeEvidence: "Explicit authorization for an increased budget." },
  "repair-limit-exhausted": { handling: "Mark the component blocked and require human review.", resumeEvidence: "Approved intervention or revised specification." },
};

export type CandidateApproval = {
  role: "editorial" | "software" | "protocol";
  name: string;
  timestamp: string;
};

export type CandidateReleasePackage = {
  releaseId: string;
  protocolVersion: string;
  rubricVersion: string;
  buildId: string;
  modelId: string;
  promptId: string;
  configurationId: string;
  contentAssetHashes: Record<string, string>;
  claimLedgerSnapshotId: string;
  sourceSnapshotIds: string[];
  reviewerSubmissions: ReviewerSubmission[];
  defectLogId: string;
  regressionResultsId: string;
  exportValidationResultsId: string;

  providerSpend: number;
  humanReviewMinutes: number;
  correctionMinutes: number;
  approvals: CandidateApproval[];
};

export function validateCandidateReleasePackage(pkg: CandidateReleasePackage): string[] {
  const issues: string[] = [];
  const requiredText: Array<[keyof CandidateReleasePackage, string]> = [
    ["releaseId", "Release ID"], ["protocolVersion", "Protocol version"], ["rubricVersion", "Rubric version"],
    ["buildId", "Build ID"], ["modelId", "Model ID"], ["promptId", "Prompt ID"], ["configurationId", "Configuration ID"],
    ["claimLedgerSnapshotId", "Claim ledger snapshot"], ["defectLogId", "Defect log"],
    ["regressionResultsId", "Regression results"], ["exportValidationResultsId", "Export validation results"],
  ];
  for (const [key, label] of requiredText) {
    const value = pkg[key];
    if (typeof value !== "string" || !value.trim()) issues.push(`${label} is required.`);
  }
  if (!Object.keys(pkg.contentAssetHashes).length) issues.push("At least one content or asset hash is required.");
  if (!pkg.sourceSnapshotIds.length) issues.push("At least one source snapshot is required.");
  if (pkg.reviewerSubmissions.length !== 3) issues.push("Exactly three independent reviewer submissions are required.");
  if (pkg.providerSpend < 0 || pkg.humanReviewMinutes < 0 || pkg.correctionMinutes < 0) issues.push("Cost and effort values cannot be negative.");
  for (const approval of pkg.approvals) {
    if (!approval.name.trim() || !approval.timestamp.trim()) issues.push(`Named ${approval.role} approval must include a timestamp.`);
  }
  return issues;
}

export type PromotionDecision =
  | "book-approved"
  | "software-approved-for-defined-scope"
  | "protocol-validated-for-defined-scope";

export type BoundedSuperiorityEvidence = {
  benchmarkName: string;
  comparatorName: string;
  comparatorPlan: string;
  testedBuildId: string;
  resultSummary: string;
  improvement: number;
  intervalLower: number;
  intervalUpper: number;
  minimumMeaningfulImprovement: number;
  prespecifiedPlanIssues: string[];
};

export function evaluateBoundedSuperiorityClaim(evidence: BoundedSuperiorityEvidence): ReleaseGateResult {
  const blockers: string[] = [];
  if (evidence.prespecifiedPlanIssues.length) blockers.push("Competitive decision plan was not fully prespecified.");
  if (!(evidence.intervalLower > evidence.minimumMeaningfulImprovement)) {
    blockers.push("Uncertainty interval does not lie entirely above the prespecified meaningful-improvement threshold.");
  }
  if (!evidence.benchmarkName.trim() || !evidence.comparatorName.trim() || !evidence.comparatorPlan.trim() || !evidence.testedBuildId.trim()) {
    blockers.push("Benchmark, comparator plan, and tested build must be identified.");
  }
  return { passed: blockers.length === 0, blockers, warnings: [] };
}

export function formatBoundedBenchmarkClaim(evidence: BoundedSuperiorityEvidence): string {
  return `On the specified benchmark (${evidence.benchmarkName}), against ${evidence.comparatorName} ${evidence.comparatorPlan}, the tested build ${evidence.testedBuildId} achieved ${evidence.resultSummary} under the prespecified correction-time and spending limits.`;
}

export type PilotFreezeRecord = {
  protocolVersion: string;
  rubricVersion: string;
  fixtureSetVersion: string;
  analysisPlanVersion: string;
  scope: string;
  exclusions: string[];
  releaseGates: string[];
  scoringExampleSetId: string;
  reviewerIds: string[];
  adjudicator: string;
  approvalAuthority: string;
  comparatorName: string;
  comparatorPlan: string;
  correctionAllowanceMinutes: number | null;
  spendingCeiling: number | null;
  stoppingRule: string;
  immutableIdentifier: string;
  ownerSignatureName: string;
  ownerSignedAt: string;
};

export function validatePilotFreezeRecord(record: PilotFreezeRecord): string[] {
  const issues: string[] = [];
  const requiredText: Array<[keyof PilotFreezeRecord, string]> = [
    ["protocolVersion", "Protocol version"], ["rubricVersion", "Rubric version"],
    ["fixtureSetVersion", "Fixture-set version"], ["analysisPlanVersion", "Analysis-plan version"],
    ["scope", "Defined scope"], ["scoringExampleSetId", "Scoring example set"],
    ["adjudicator", "Adjudicator"], ["approvalAuthority", "Approval authority"],
    ["comparatorName", "Comparator"], ["comparatorPlan", "Comparator plan"],
    ["stoppingRule", "Stopping rule"], ["immutableIdentifier", "Immutable identifier"],
    ["ownerSignatureName", "Protocol owner signature"], ["ownerSignedAt", "Freeze timestamp"],
  ];
  for (const [key, label] of requiredText) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) issues.push(`${label} is unresolved.`);
  }
  if (!record.exclusions.length) issues.push("Scope exclusions must be explicit.");
  if (!record.releaseGates.length) issues.push("Release gates must be listed.");
  if (record.reviewerIds.length !== 3 || new Set(record.reviewerIds.map((id) => id.trim())).size !== 3) {
    issues.push("Exactly three distinct reviewer identities are required.");
  }
  if (record.reviewerIds.some((id) => !id.trim())) issues.push("Reviewer identities cannot be blank.");
  if (record.correctionAllowanceMinutes === null || !(record.correctionAllowanceMinutes >= 0)) {
    issues.push("Correction allowance must be defined and non-negative.");
  }
  if (record.spendingCeiling === null || !(record.spendingCeiling >= 0)) {
    issues.push("Spending ceiling must be defined and non-negative.");
  }
  return issues;
}
export type PilotFixtureInventory = {
  scoringExampleIds: string[];
  adjudicationExampleIds: string[];
  failureFixtureKinds: FailureKind[];
  dependencyFixtureChanges: DependencyChange[];
  measurementFixtureIds: string[];
  calibrationFixtureIds: string[];
  unseenConfirmationBriefIds: string[];
};

export function validatePilotFixtureInventory(inventory: PilotFixtureInventory): string[] {
  const issues: string[] = [];
  if (!inventory.scoringExampleIds.length) issues.push("Scoring examples are required.");
  if (!inventory.adjudicationExampleIds.length) issues.push("Adjudication examples are required.");
  if (!inventory.measurementFixtureIds.length) issues.push("Measurement fixtures are required.");
  const requiredFailures: FailureKind[] = [
    "invalid-structure", "unsupported-factual-claim", "unintended-access",
    "lost-edits-or-corrupt-assets", "provider-interruption", "spending-limit-reached",
    "repair-limit-exhausted",
  ];
  for (const kind of requiredFailures) if (!inventory.failureFixtureKinds.includes(kind)) issues.push(`Missing failure fixture: ${kind}.`);
  const requiredChanges: DependencyChange[] = ["source", "prose", "image", "export-config"];
  for (const change of requiredChanges) if (!inventory.dependencyFixtureChanges.includes(change)) issues.push(`Missing dependency fixture: ${change}.`);
  const calibration = new Set(inventory.calibrationFixtureIds);
  if (inventory.unseenConfirmationBriefIds.some((id) => calibration.has(id))) issues.push("Calibration fixtures and unseen confirmation briefs must remain separate.");
  return issues;
}
export type DryRunStatus = "NOT_RUN" | "PASS" | "FAIL" | "BLOCKED";

export type DryRunCheckRecord = {
  id: string;
  fixtureVersion: string;
  frozenSpecificationId: string;
  requirement: string;
  preconditions: string[];
  inputOrInjectedFault: string;
  expectedResult: string;
  requiredEvidence: string[];
  actualResult: string;
  evidence: string[];
  status: DryRunStatus;
  defectAndRetestReferences: string[];
  executor: string;
  reviewer: string;
  executedAt: string;
  mandatory: boolean;
  prerequisiteBlockers: string[];
};

export function validateDryRunCheckRecord(record: DryRunCheckRecord): string[] {
  const issues: string[] = [];
  if (!record.id.trim()) issues.push("Check ID is required.");
  if (!record.fixtureVersion.trim()) issues.push("Fixture version is required.");
  if (!record.frozenSpecificationId.trim()) issues.push("Frozen specification ID is required.");
  if (!record.requirement.trim()) issues.push("Requirement exercised is required.");
  if (!record.inputOrInjectedFault.trim()) issues.push("Input or injected fault must be predefined.");
  if (!record.expectedResult.trim()) issues.push("Expected result must be recorded before execution.");
  if (!record.requiredEvidence.length) issues.push("Required evidence must be predefined.");
  if (record.status === "BLOCKED" && !record.prerequisiteBlockers.length) issues.push("BLOCKED requires a recorded prerequisite or impediment.");
  if (record.status !== "BLOCKED" && record.prerequisiteBlockers.length) issues.push("Prerequisite blockers require BLOCKED status.");
  if (record.status === "NOT_RUN" && (record.actualResult.trim() || record.evidence.length || record.executedAt.trim())) issues.push("NOT_RUN records cannot contain execution results or evidence.");
  if (record.status === "PASS" || record.status === "FAIL") {
    if (!record.actualResult.trim()) issues.push("Executed checks require an actual result.");
    if (!record.evidence.length) issues.push("Executed checks require evidence.");
    if (!record.executor.trim() || !record.executedAt.trim()) issues.push("Executed checks require a named executor and timestamp.");
  }
  return issues;
}

export type DryRunExitDecision = { status: DryRunStatus; blockers: string[]; benchmarkAuthorized: boolean; benchmarkBlockers: string[] };

export function evaluateDryRunExit(input: {
  freezeIssues: string[];
  fixtureIssues: string[];
  competitivePlanIssues?: string[];
  checks: DryRunCheckRecord[];
  namedBenchmarkApproval?: string;
}): DryRunExitDecision {
  const blockers = [...input.freezeIssues, ...input.fixtureIssues, ...(input.competitivePlanIssues || [])];
  let hasNotRun = false;
  let hasBlocked = false;
  let hasFailed = false;
  for (const check of input.checks.filter((item) => item.mandatory)) {
    blockers.push(...validateDryRunCheckRecord(check).map((issue) => `${check.id}: ${issue}`));
    if (check.status === "NOT_RUN") hasNotRun = true;
    if (check.status === "BLOCKED") hasBlocked = true;
    if (check.status === "FAIL") hasFailed = true;
  }
  let status: DryRunStatus = "PASS";
  if (hasFailed) status = "FAIL";
  else if (blockers.length || hasBlocked) status = "BLOCKED";
  else if (hasNotRun) status = "NOT_RUN";
  const benchmarkBlockers = [...blockers];
  if (status !== "PASS") benchmarkBlockers.push(`Dry-run exit status is ${status}.`);
  if (!input.namedBenchmarkApproval?.trim()) benchmarkBlockers.push("Named benchmark authorization is required.");
  return { status, blockers, benchmarkAuthorized: status === "PASS" && benchmarkBlockers.length === 0, benchmarkBlockers };
}

export type BenchmarkAuthorizationRecord = {
  authorized: boolean;
  frozenSpecificationId: string;
  configurationId: string;
  dryRunEvidencePackageId: string;
  benchmarkScope: string;
  spendingCeiling: number | null;
  approver: string;
  approvedAt: string;
};

export function validateBenchmarkAuthorization(record: BenchmarkAuthorizationRecord, expected: {
  frozenSpecificationId: string;
  configurationId: string;
  dryRunEvidencePackageId: string;
}): string[] {
  const issues: string[] = [];
  if (!record.authorized) issues.push("Benchmark authorization is not granted.");
  if (record.frozenSpecificationId !== expected.frozenSpecificationId) issues.push("Authorization does not match the tested frozen specification.");
  if (record.configurationId !== expected.configurationId) issues.push("Authorization does not match the tested configuration.");
  if (record.dryRunEvidencePackageId !== expected.dryRunEvidencePackageId) issues.push("Authorization does not match the passing dry-run evidence package.");
  if (!record.benchmarkScope.trim()) issues.push("Authorized benchmark scope is required.");
  if (record.spendingCeiling === null || record.spendingCeiling < 0) issues.push("Authorized spending ceiling is required.");
  if (!record.approver.trim() || !record.approvedAt.trim()) issues.push("Named approval authority and timestamp are required.");
  return issues;
}

export type VersionedProtocolAmendment = {
  amendmentId: string;
  priorVersion: string;
  newVersion: string;
  changedFields: string[];
  measurementImpactAssessment: string;
  owner: string;
  timestamp: string;
};

export function validateProtocolAmendment(amendment: VersionedProtocolAmendment): string[] {
  const issues: string[] = [];
  if (!amendment.amendmentId.trim()) issues.push("Amendment ID is required.");
  if (!amendment.priorVersion.trim() || !amendment.newVersion.trim() || amendment.priorVersion === amendment.newVersion) {
    issues.push("A versioned amendment must identify distinct prior and new versions.");
  }
  if (!amendment.changedFields.length) issues.push("Changed fields must be listed.");
  if (!amendment.measurementImpactAssessment.trim()) issues.push("Measurement impact assessment is required.");
  if (!amendment.owner.trim() || !amendment.timestamp.trim()) issues.push("Amendment owner and timestamp are required.");
  return issues;
}

export function validateFreezeCompetitiveConsistency(
  freeze: PilotFreezeRecord,
  plan: CompetitiveDecisionPlan,
): string[] {
  const issues: string[] = [];
  const same = (a: string, b: string) => a.trim() === b.trim();
  if (freeze.comparatorName.trim() && plan.comparatorName.trim() && !same(freeze.comparatorName, plan.comparatorName)) {
    issues.push("Comparator differs between freeze record and competitive plan.");
  }
  if (freeze.comparatorPlan.trim() && plan.comparatorPlan.trim() && !same(freeze.comparatorPlan, plan.comparatorPlan)) {
    issues.push("Comparator plan differs between freeze record and competitive plan.");
  }
  if (freeze.correctionAllowanceMinutes !== null && Number.isFinite(plan.correctionTimeLimitMinutes)
      && freeze.correctionAllowanceMinutes !== plan.correctionTimeLimitMinutes) {
    issues.push("Correction allowance differs between freeze record and competitive plan.");
  }
  if (freeze.spendingCeiling !== null && Number.isFinite(plan.spendingLimit)
      && freeze.spendingCeiling !== plan.spendingLimit) {
    issues.push("Spending ceiling differs between freeze record and competitive plan.");
  }
  if (freeze.stoppingRule.trim() && plan.stoppingRule.trim() && !same(freeze.stoppingRule, plan.stoppingRule)) {
    issues.push("Stopping rule differs between freeze record and competitive plan.");
  }
  return issues;
}
