# Production Protocol v1.1 — Pending Human Decisions

Machine-verifiable work is complete. The fields below require explicit human selection, identity, approval, or spending authority and are intentionally not inferred.

## Freeze record — required

1. Three distinct independent reviewer identities.
2. Named adjudicator.
3. Named approval authority.
4. Comparator product name.
5. Comparator product plan/tier.
6. Correction allowance in minutes.
7. Spending ceiling.
8. Protocol-owner signature name.
9. Freeze/signature timestamp.

The comparator, plan, correction allowance, and spending ceiling must match the competitive decision plan exactly.

## Competitive decision plan — required

- Required deliverables. **Proposed default only:** completed six-page illustrated biography plus a valid required PDF export and the evidence package required by the protocol.
- Minimum meaningful improvement threshold for the primary outcome.
- Comparator and plan, correction-time limit, and spending limit mirror the freeze choices above.
## Authorization after a PASS dry run

Even when the dry-run status becomes `PASS`, competitive execution remains disabled until `BENCHMARK_AUTHORIZATION.json` records explicit named authorization. Paid/live smoke work is independently disabled until `LIVE_SMOKE_AUTHORIZATION.json` is explicitly authorized with a provider and spending cap.

## Already locked — no decision needed

- Rubric: `v1.1-r1`
- Fixture set: `v1.1-f1`
- Analysis plan: `v1.1-a1`
- Calibration/scoring set: `v1.1-c1`
- Scope: six-page illustrated-biography controlled pilot
- Exclusions: long-form fiction, other languages, print editions
- Primary operational outcome: approved-book acceptance rate
- Stopping rule: no optional stopping for observed performance; mandatory safety/access/data-preservation and spending-ceiling stops remain active.
- Candidate spec manifest: `sha256:470d41a5455f2701cab4bdcb2e881392e24c8a2da86461645d0625c84959f09d`

Synthetic test placeholders such as 30 minutes, a 10-percentage-point threshold, or example comparator names in unit tests are **not approvals** and must not be copied into the signed freeze unless explicitly chosen by the protocol owner.
