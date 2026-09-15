import fs from "node:fs";
import path from "node:path";
import {
  validateCompetitiveDecisionPlan,
  validateDryRunCheckRecord,
  validatePilotFixtureInventory,
  validatePilotFreezeRecord,
} from "../src/lib/production-protocol";

const root = process.cwd();
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const freeze = read("docs/pilot/PROTOCOL_V1_2_FREEZE_RECORD.json");
const plan = read("docs/pilot/PROTOCOL_V1_2_COMPETITIVE_PLAN.json");
const inventory = read("src/lib/__tests__/fixtures/production-protocol-v1_2/fixture-inventory.json");
const assignments = read("docs/pilot/PROTOCOL_V1_2_FIXTURE_ASSIGNMENTS.json");
const execution = read("docs/pilot/PROTOCOL_V1_2_EXECUTION_RECORDS.json");
const expectations = read("docs/pilot/PROTOCOL_V1_2_EXPECTED_OUTCOMES.json");
const freezeIssues = validatePilotFreezeRecord(freeze);
const fixtureIssues = validatePilotFixtureInventory(inventory);
const planIssues = validateCompetitiveDecisionPlan(plan);
const assignmentIssues = assignments.assignments.filter((x: any) => !String(x.owner || "").trim()).map((x: any) => `Fixture owner missing: ${x.checkId}.`);
const recordIssues = execution.records.flatMap((x: any) => validateDryRunCheckRecord(x).map((i) => `${x.id}: ${i}`));
const expectationIssues = expectations.expectations.flatMap((e: any) => {
  const x = execution.records.find((r: any) => r.id === e.id);
  return !x || e.expectedResult !== x.expectedResult || JSON.stringify(e.requiredEvidence) !== JSON.stringify(x.requiredEvidence) || e.inputOrInjectedFault !== x.inputOrInjectedFault ? [`Expected-outcome mismatch: ${e.id}.`] : [];
});
const counts = execution.records.reduce((a: any, x: any) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
const blockers = [...freezeIssues, ...fixtureIssues, ...planIssues, ...assignmentIssues, ...recordIssues, ...expectationIssues];
const report = {
  candidateVersion: "1.2-candidate",
  status: "Candidate; freeze and dry-run completion not established.",
  preparationOnly: true,
  fixtureExecutionDispatched: false,
  liveProviderDispatched: false,
  counts: { total: execution.records.length, pass: counts.PASS || 0, fail: counts.FAIL || 0, blocked: counts.BLOCKED || 0, notRun: counts.NOT_RUN || 0 },
  freezeIssues, fixtureIssues, competitivePlanIssues: planIssues, assignmentIssues, executionRecordIssues: recordIssues, expectedOutcomeIssues: expectationIssues,
  blockers,
};
const out = path.join(root, "docs/generated/PROTOCOL_V1_2_PREEXECUTION_STATUS_20260912.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
