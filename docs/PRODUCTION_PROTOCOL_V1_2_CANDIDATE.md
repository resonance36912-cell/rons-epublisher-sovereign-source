# Production Protocol v1.2 — Candidate

Status: **Controlled-pilot candidate. Not frozen, tested, approved, or benchmark-authorized by this document alone.**

The protocol is promoted only after the regression suite, reviewer calibration, and pilot evaluation pass. Until then, Resonance may describe the design objective as **auditable, editable, validated books**, but must not claim demonstrated market superiority.

## 1. Reproducible quality score

Use the approved quality dimensions and weights. Ratings use one shared 0–5 scale:

- 0 — missing or unusable.
- 1 — major defects; substantial reconstruction required.
- 2 — multiple substantive corrections required.
- 3 — acceptable after limited substantive editing.
- 4 — publication quality; minor polish only.
- 5 — exemplary against approved reference examples.

Formula: `score = sum(weight × rating / 5)`.

Candidate book-release rule:
- total score at least 90/100;
- every dimension at least 4/5;
- all mandatory checks passed;
- no unresolved critical defects;
- named editorial approval.

Weights must total 100. Reviewers record independent scores before discussing disagreements and should be calibrated against approved sample books.
## 2. Two independent release approvals

**Book release** requires approved facts, prose, images, layout, required exports, and the quality gate above.

**Software release** requires passing evidence for structure regression, edit preservation, access controls, cancellation, recovery, spending limits, and named release approval.

A successful book never overrides a failed privacy, access-control, preservation, recovery, or spending-limit test.

## 3. Approval invalidation

- Source change: reopen dependent facts and prose.
- Prose change: reopen facts, text-image alignment, narration, and affected layout.
- Image change: reopen visual/text-image and affected layout review.
- Export configuration change: rerun export validation.
- Build or model change: rerun the relevant software regression suite.

Preserve unaffected approvals. Never publish an artifact using approval from an older dependency version.

## 4. Book structure and export gate

`BookStructure` is canonical for release/export. It distinguishes:
- `storyPages[]` — narrative pages;
- `chapters[]` — optional containers referring to story-page IDs;
- `cover` — separate from story pages;
- `sourceNotes[]` — separate citation/evidence metadata.

Legacy `SlideChapter[]` remains temporarily as the editor compatibility layer. The release gate fails malformed or oversized structures and never silently truncates them.
## 5. Benchmark definitions

Use fixed denominators:
- first-pass acceptance = books passing before correction / all started benchmark jobs;
- export success = valid required exports / all jobs requiring those exports;
- provider cost per approved book = all provider spend, including failures and repairs / approved books;
- human effort per approved book = all review and correction minutes, including unsuccessful jobs / approved books.

Report provider spend and human effort separately unless a labor-cost assumption is disclosed. If no books pass, report **no approved outputs** rather than dividing by zero.

For factual quality report both unsupported claims per book and unsupported claims / reviewed factual claims. Also report required-fact coverage so low-assertion outputs cannot appear artificially strong.

## 6. Competitive decision must be predefined

Before any comparator test record the named product and plan, eligible tasks, required deliverables, primary outcome, correction-time limit, spending limit, treatment of ties/failures/unsupported inputs, minimum meaningful improvement, statistical analysis, stopping rule, and unseen confirmation briefs.

Candidate primary operational outcome: approved-book acceptance rate. Blind preference among completed outputs is a separate quality outcome and must be reported separately.

## 7. Generation architecture is an experiment

Do not assume sequential illustration is intrinsically superior. Benchmark both:
- original reference + page brief;
- original reference + page brief + approved prior scene.

Choose based on consistency, repair burden, and acceptable completion time. Vendor capability statements are inputs to testing, not evidence of superiority.

## Promotion condition

Promote this Candidate only after reviewer calibration, structural/export regressions, software-release evidence, and the predefined pilot evaluation pass. Record the named approver and build identifier at promotion time.

## 8. Independent reviewer decision rule

Each scored quality dimension receives exactly three independently submitted ratings. The release rating for a dimension is the median of the three. The overall weighted score is calculated from those medians.

A rating spread of two or more points in any dimension requires documented adjudication before approval. Original ratings are preserved alongside the adjudicated record.

Any reviewer critical finding blocks approval until it is resolved, or explicitly dismissed with supporting evidence. Factual support remains a mandatory gate and cannot be offset by stronger ratings in other dimensions.

Rubric calibration examples must include dimension-specific examples for ratings 0 through 5; reviewers calibrate on the same fixtures before scoring a pilot artifact.

## 9. Failure handling and benchmark preservation

Every failure is retained in the defect and benchmark record even when later repaired. Repair never erases the original outcome.

- Invalid structure or excess pages/chapters: stop the affected job and block export; resume only after passing structure validation.
- Unsupported factual claim: block the affected book; resume after claim correction/removal, updated claim ledger, and editorial approval.
- Unintended access or sharing: suspend the affected release path and restrict access; resume only after documented remediation and a passing access-control retest.
- Lost edits or corrupted assets: stop writes and preserve recovery evidence; resume after verified restoration and preservation testing.
- Provider timeout or interruption: mark the operation unresolved and reconcile provider status before retrying; require confirmed job status and a duplicate-prevention check.
- Spending limit reached: stop dispatching new paid work and disclose already committed charges; resume only with explicit authorization for an increased budget.
- Repair limit exhausted: mark the component blocked and require human review; resume after an approved intervention or revised specification.

## 10. Immutable candidate release package

Every approved candidate is identified by a unique Release ID and includes the protocol and rubric versions, build/model/prompt/configuration identifiers, content and asset hashes, claim-ledger and source snapshots, independent reviewer scores, defect log, regression and export-validation results, provider cost, timing and correction records, and named approvals with timestamps.

Any change to an approved artifact creates a new candidate release. Affected checks reopen under the dependency rules; unaffected approvals may be retained only when their dependencies and hashes are unchanged.

## 11. Three separate promotion decisions

The following decisions are independent and must never be treated as interchangeable:

1. **Book approved** — the specific artifact satisfies editorial and export gates.
2. **Software approved for a defined scope** — the tested build satisfies required reliability, access-control, recovery, cancellation, preservation, and spending-limit checks for the stated scope.
3. **Protocol validated for a defined scope** — calibrated reviewers and confirmation testing demonstrate that the process meets preregistered targets for the stated scope.

Validation for six-page illustrated biographies does not automatically extend to long-form books, other languages, other genres, or print configurations.

## 12. Competitive-claim boundary

Before confirmation testing, lock the comparator product and plan, primary outcome, meaningful-improvement threshold, correction-time and spending limits, analysis method, stopping rule, and handling of ties, failures, and unsupported inputs.

A superiority claim is permitted only when the prespecified analysis supports it. For an improvement metric, the uncertainty interval must lie entirely above the prespecified meaningful-improvement threshold.

Permitted wording is bounded to the tested evidence, for example: **“On the specified benchmark, against [product and plan], the tested build achieved [result and uncertainty] under the prespecified correction-time and spending limits.”**

Do not generalize a bounded result into “best product,” “market leader,” or any claim outside the tested scope.

## Candidate freeze rule

This document, its executable policy module, calibration fixtures, and freeze manifest together define **Production Protocol v1.2 — Candidate**. Once the freeze manifest is created, any substantive change to these protocol artifacts requires a new candidate identifier and a new manifest. A dry run verifies the measurement process only; it is not production validation or competitive evidence.
## Operational addendum — mandatory freeze and dry-run execution

This addendum is mandatory for the pilot. The document itself does not establish that v1.1 is frozen, tested, approved, or benchmark-authorized. The read-only v1.0 snapshot remains historical evidence and is not modified by this amendment.

### Freeze record gate

Before execution, the protocol owner must complete and sign a freeze record containing protocol, rubric, fixture-set and analysis-plan versions; scope and exclusions; release gates and scoring-example set; three reviewer identities; adjudicator; approval authority; comparator and plan; correction allowance; spending ceiling; stopping rule; an immutable identifier; owner signature; and timestamp.

Any unresolved field means **BLOCKED — not ready to run**. A material post-freeze change requires a versioned amendment and a written assessment of which prior measurements remain usable.

### Fixture gate

Calibration fixtures must include scoring examples, conflicting-rating examples, a one-reviewer critical finding, every defined failure class, source/prose/image/export dependency changes, and known measurement cases for costs, timestamps, retries, failures and repairs.

Calibration and dry-run fixtures must remain separate from unseen confirmation briefs.
### Measurement dry-run gate

The mandatory dry run uses mocked provider responses for fault injection. A separately capped live smoke test may run only after explicit authorization; the dry-run process must not initiate paid provider work by default.

The dry run must demonstrate preservation and correct aggregation of independent ratings; disagreement and critical-defect blocking; failure stop/recovery/resumption behavior; first-pass and accumulated-cost treatment of repairs; dependency-based approval invalidation; reconstructable release evidence; and separation of book, software and protocol promotion states.

Each mandatory check records `PASS`, `FAIL` or `BLOCKED`, evidence, owner and unresolved defects. A repair never erases the original benchmark outcome.

### Benchmark authorization gate

Competitive benchmarking is authorized only when the freeze record has no unresolved fields, the required fixture inventory is complete, every mandatory measurement check is `PASS`, and a named benchmark approval is recorded.

A successful dry run proves only that the measurement process functions. It does not validate the protocol, approve the software for public release, approve a particular book, or establish competitive superiority.

If a material defect is found, increment the candidate version and rerun the affected checks before committing benchmark budget.

### Authorization state separation

Dry-run status and benchmark authorization are separate. A dry run may be `PASS` once all freeze, fixture, competitive-plan, and measurement checks pass. Competitive benchmarking remains unauthorized until `docs/pilot/BENCHMARK_AUTHORIZATION.json` records `authorized: true`, a named approver, and an approval timestamp. A PASS dry run without that authorization is not permission to spend or dispatch comparator work.

## Operational addendum — execution-record semantics

This addendum is mandatory for the v1.2 pilot candidate.

- `NOT_RUN` means the check has not been executed. It never satisfies an exit gate.
- `BLOCKED` is reserved for a check that cannot proceed because a recorded prerequisite or impediment is unresolved. It never satisfies an exit gate.
- Before execution, every fixture record must contain a reproducible input or injected fault, the expected control behavior, and the evidence required for acceptance.
- Actual results, evidence, executor/reviewer identities, and timestamps remain blank until execution.
- Retests append defect and evidence references; they never replace the original attempt.

Benchmark authorization is valid only for the exact frozen specification ID, configuration ID, and passing dry-run evidence package named in the authorization record. A version or configuration change invalidates that authorization.

Mock-only success must be described as **measurement validation under simulated provider behavior**. If an authorized live smoke test is required for a mandatory check, that check remains incomplete until the live result passes.
