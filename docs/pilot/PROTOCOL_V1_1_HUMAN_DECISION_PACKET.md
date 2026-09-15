# Production Protocol v1.1 — Human Decision Packet

Current state: **BLOCKED pending human decisions.** Machine-verifiable specification identity is complete and the 16-artifact manifest has zero hash mismatches.

## Decisions still required

1. Three distinct reviewer identities.
2. Named adjudicator.
3. Named approval authority.
4. Protocol-owner signature name and signature timestamp.
5. Comparator product and exact plan.
6. Correction allowance in minutes.
7. Spending ceiling and currency/basis.
8. Required benchmark deliverables.
9. Minimum meaningful improvement threshold.
10. Named benchmark approver after all gates pass.
11. Optional live-smoke provider and separate spending cap if a live smoke test is authorized.

No benchmark or live-provider work may run while these authorization records remain false.
## Non-binding starting proposals

These are **not frozen values** and do not authorize execution:

- Required deliverables: approved six-page illustrated book; PDF export; editable project package; claim ledger/source snapshot; reviewer/defect/export evidence package.
- Correction allowance: **30 minutes per started benchmark job** is a reasonable calibration starting point used in existing protocol examples; owner approval is required before use.
- Minimum meaningful improvement: **10 percentage points in approved-book acceptance rate** is a conservative starting threshold used in existing decision examples; statistical owner approval is required.
- Comparator candidate: **Story Spark** is a plausible benchmark candidate from prior protocol discussion, but the exact commercial/product plan must be named and held constant before any comparison.
- Spending ceiling: deliberately left unset until currency, per-job/provider pricing, sample size and total budget authority are confirmed.

## Next gate

Copy approved human decisions into the canonical freeze record and competitive plan, record the protocol-owner signature and timestamp, rerun the mocked dry run, and require `PASS` before considering separate live-smoke or benchmark authorization.