# CampusWorks verification

Verified on November 7, 2026 against the delivered source. [Results](verification/results.json) record exact case names, durations, accessibility checks and screenshot hashes. [Business review](BUSINESS_REVIEW.md) maps the seventeen findings, the three owner decisions and the additional integration fixes to regression evidence.

The complete local run passed **198 acceptance tests**, with zero failures, skips or flaky results. It also passed **64 unit tests**, application/server/test TypeScript checks and a production build. Two production application instances shared an isolated disposable MongoDB replica set. The separately built Linux production image passed **36 Chromium/Firefox browser tests** against another authenticated database. No GitHub Actions, remote push or deployment was used.

## Exercised business and security behavior

- Publication, qualification questions, private answers/CV, exact-version submission, shortlist/selection, acceptance, clearance, effective TA course access, duty/queue work, appointment end, incurred-cost settlement, position archive and course deletion through actual browser controls.
- Persistent course restrictions, authorized restoration without enrollment, cross-course isolation, blocked TA selection/resumption and restricted future activation without discarding budget obligations.
- Site-admin corrections before and after employment ends, required reasons, administrative versions, private before/after history and unchanged appointment/financial state. Faculty and applicant projections do not expose the private audit.
- Canonical course identifiers, compatible historical alias reads, linked deletion protection and complete historical report budgets/workload.
- Stale request edits/leave, current-helper completion, fresh/stale revisions, ABA handoff, paused rows, accurate removal reasons, simultaneous joins/close, archive rollback and exactly-once history.
- Disabled manual TA/demo-admin duty and claim cleanup while preserving role records. The configured-admin fallback has the same account guard, but was not independently configured in a separate browser fixture.
- Complete manager pagination across a concurrent 502nd archive, consistent KPIs/CSV, course replacement snapshot rejection, delayed polling and preservation of the previous complete result on temporary refresh failure.
- Recruitment boundaries, dirty administrator form conflicts, reopening application controls, independent closed-cycle withdrawal and continued local revision ownership across submit/save/upload/withdraw/resubmit.
- First-commit candidate/vacancy/budget allocation, duplicate command replay, withdrawal/selection races, offer expiry/acceptance and cross-semester overlapping-date exclusion.
- Four-role and cross-course authority, private drafts/documents, CV quotas and submitted snapshots, session revocation, forged cookies, body/origin/rate boundaries and required index readiness on both instances.
- Institutional subject/email binding through a loopback fake identity provider; changed/reused identity and demo impersonation refusals.
- Transactional multi-batch cursor reads and fault rollback, complete aggregates/P90 in one snapshot, distinct requested/approved/committed/settled budget measures, and idempotent notifications to more than 100 recipients.
- RA applications and appointments without research workspaces, course execution links, TA grants or teaching-work Research choices; historical titles outside the current public catalog.
- Loopback AI providers: qualification-only projection, technical-question retention, invalid/cross-candidate citations, exact candidate coverage, failures, quotas, distributed concurrency and valid-lease confirmation.
- Automatic comparisons after submission, selection, withdrawal, timed expiry and course restriction/restoration; worker coalescing, current permissions, stale evidence rejection, candidate page metadata and disabled-provider behavior.
- Position end stops new comparisons/summaries and automatic calls while preserving authorized, dated historical results and course reviews. Other AI task kinds retain their default interface capability.
- Unattended TA/RA generation of all four advisory kinds, shared authorized results, automatic ten-person candidate pages, persistent discovery beyond the initial batch and restart without repeat purchases.
- Candidate availability changes after manual selection, preview/final semester advice, failed-call backoff, quota exhaustion, revoked reviewers and expired execution leases.
- Real offline/reconnect and focus recovery, one in-flight poll, no refresh/generate controls, retained unsaved input, explicit remote-conflict discard and immediate clearing after permission loss.
- Provider-independent offer expiry, cleared activation, restricted/uncleared activation refusal, multiple lifecycle batches and exactly-once in-app delivery without page traffic.
- Actual-source unit checks for hint/due fairness under sustained backlog, failed observation recovery, complete candidate/reference preservation, Unicode, hidden-tail evidence hashes and oversized input with zero budget/provider activity.
- Persistent execution turns for all four advisory kinds, short transactional claims, cold-start initialization, cursor/claim rollback, conflicting-reader retry and expired-owner fencing. A separate real MongoDB two-client check passed six scenarios and 118 transaction attempts without a provider call.
- Transactional invalidation after candidate-set changes, stable repeated submission, reapproval fencing and bounded orphan-job cleanup. Two 250-event backlog cases exercise provider-disabled recovery and quota exhaustion without widening the original timeout.
- A guarded synthetic showcase with 41 people, ten courses, 21 positions, 68 applications, fifteen appointments, thirty workload records, 380 history rows, eighty feedback rows and eleven live requests; repeat preparation preserves human decisions and private document revisions.

## Browser presentation and accessibility

The matrix checks authorized screens at 1440, 768, 390 and 320 pixels in Chromium and Firefox across the local app and Linux production image: **376 page/browser/width scans**, with zero violations under the configured WCAG 2 A/AA and 2.1 AA rules. Route/response/title/main-landmark, Duke blue, PNG source/alternate text/loading and viewport bounds are checked. A separate test compares the served logo bytes with the tracked PNG. Keyboard checks exercise dialog trapping, Escape and returned focus. Representative home, mobile application/administration/reviewer, TA queue and RA appointment screenshots are retained and inspected.

These scans are automated checks of the exercised states, not proof of universal accessibility or physical-device behavior.

Actual real-provider candidate and course-advice pages passed another **8 checks** at the same four widths. The offline [demonstration gallery](demo/index.html) passed sixteen additional Chromium/Firefox page/dialog scans, local image/original-link loading, keyboard navigation and focus-return checks. Synthetic workflow captures and real-provider panels have separate provenance labels.

## Provider, dependency and review boundaries

The final production build passed **twelve real OpenAI advisory tasks**, with **12 reserved provider attempts**, using synthetic records. Nine tasks completed without an open page or an analysis request, both teachers' candidate comparisons updated after manual selection, and final course advice appeared at semester end. Headless browsers checked all four result panels without analysis POSTs; an authorized peer read the same task, competing selection returned 409, expiry preserved authorized history and no early TA grant occurred. The [sanitized receipt](verification/ai-browser-proof.json) records the application source digest, model, outcomes and complete cleanup. The saved Key was loaded only by the Windows credential loader and passed to the application child environment, never printed or exposed to browsers.

The retained [five-request receipt](verification/ai-provider-proof.json) is historical. Controlled loopback providers exercise failures, quota and races; the masked DPAPI launcher remains covered by synthetic-credential tests. Neither synthetic provider success nor finite output inspection establishes real hiring accuracy or fairness. [AI workflows](AI_WORKFLOWS.md) identifies every automatic trigger and retained human decision.

The final populated rehearsal also passed its five featured scopes, including both ten/two-person candidate pages, all four advisory kinds and actual browser result panels. Its [receipt](verification/showcase-provider-proof.json) records zero browser analysis commands/runtime errors, real requests reserved and complete cleanup. The [activity ledger](verification/provider-activity.json) counts **209 reserved attempts** across this delivery, including earlier successful checks and two failed warmups. The first warmup did not retain a narrow failure cause; later safe categories identified output-limit/reference failures, and subsequent fixes retain the strict validation and daily limits. Reservations are not confirmed billed usage or a price estimate.

The MongoDB Node.js driver remains pinned to **7.8.0**. The current npm audit snapshot reports **zero vulnerabilities**. Mandatory declared indexes and transaction-capable topology are readiness requirements. Unit/source checks, dependency audit and finite acceptance tests are complementary evidence; none is an exhaustive security proof.

The [inventory](verification/application-inventory.json) records delivered file bytes. The [reading ledger](review/final-reading-ledger.json) combines current domain and integration review of changed code with unchanged-byte receipts from the prior complete maintained-source review. Independent cross-review also checked authority, lock order, private projections, canonical resource linkage, command versions, provider evidence, pagination and interface capabilities. Earlier review documents remain explicitly historical.

Full administrative audit records remain stored; the current detail view displays the most recent 100. Consistent manager reads can retry during continuous writes and retain the previous complete dataset after bounded failure. Sustained production scale, long-running failover, institutional SSO, private applicant inference, provider fairness/quality, external payroll/expense validation, email, hosted infrastructure, Kubernetes and physical devices were not verified.

PDF/TXT files are private attachments; their bytes are not parsed by AI. Qualification fields, screened answers and typed background text provide evidence. Classification/redaction is defensive, not guaranteed anonymization. Queue observations, reported work and cost scenarios do not prove total paid work or authorize automatic staffing reductions.

Interactive demonstration windows and the demonstration website remain closed. Disposable verification services are stopped and removed after their runs.

The [presentation guide](DEMO_GUIDE.md) covers the eight-minute rehearsal and saved synthetic dataset. [Product readiness](PRODUCT_READINESS.md) separates implemented fixes from proposed semester, offer and late-recording decisions required before a real pilot.

All six saved presentation routes were reopened in independent headless contexts against the retained dataset. The CS logo loaded, unauthorized hiring links stayed hidden, application counts remained consistent, no provider Key was loaded, provider reservations did not increase and the owned app/database services closed successfully. [Prepared-window receipt](verification/prepared-windows-proof.json)
