# Production Protocol v1.2 — protocol-owner actions

Current status: **Candidate; freeze and dry-run completion not established.**

Before any fixture execution, the protocol owner must complete `PROTOCOL_V1_2_FREEZE_RECORD.json` and `PROTOCOL_V1_2_COMPETITIVE_PLAN.json`, then assign a real named owner to every entry in `PROTOCOL_V1_2_FIXTURE_ASSIGNMENTS.json`.

Human decisions still required: three reviewer identities; adjudicator; approval authority; exact comparator and plan; correction allowance; spending ceiling; required benchmark deliverables; minimum meaningful-improvement threshold; protocol-owner signature and timestamp.

The final frozen specification identifier must be generated only after those configuration decisions are complete. It must then be copied into every execution record and authorization record before execution.

`PROTOCOL_V1_2_EXPECTED_OUTCOMES.json` is the predeclared acceptance contract. Do not edit expected behavior after observing results; a substantive change requires a new versioned amendment.

After the freeze and fixture owners are complete, clear only the resolved `prerequisiteBlockers` in `PROTOCOL_V1_2_EXECUTION_RECORDS.json` and change each eligible check from `BLOCKED` to `NOT_RUN`. Do not populate actual result, evidence, executor, reviewer, or execution timestamp until the check is actually run.

Retests append evidence and defect references; they never overwrite earlier attempts.

Keep `PROTOCOL_V1_2_BENCHMARK_AUTHORIZATION.json` and `PROTOCOL_V1_2_LIVE_SMOKE_AUTHORIZATION.json` unauthorized until their respective gates are explicitly satisfied and signed.

Independent human verification of manifest hashes and provider spending remains a separate sign-off; same-agent reproducibility checks are not independent approval.
