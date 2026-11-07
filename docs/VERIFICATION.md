# CampusWorks verification

Verified on November 7, 2026 against the delivered source. [Results](verification/results.json) record exact case names, durations, accessibility checks and screenshot hashes. [Business review](BUSINESS_REVIEW.md) maps the seventeen findings, the three owner decisions and the additional integration fixes to regression evidence.

The complete local run passed **163 acceptance tests**, with zero failures, skips or flaky results. It also passed **9 unit tests**, application/server/test TypeScript checks and a production build. Two production application instances shared an isolated disposable MongoDB replica set. The separately built Linux production image passed **24 Chromium/Firefox browser tests** against another authenticated database. No GitHub Actions, remote push or deployment was used.

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

## Browser presentation and accessibility

The matrix checks authorized screens at 1440, 768, 390 and 320 pixels in Chromium and Firefox on both local targets: **304 page/browser/width scans**, with zero violations under the configured WCAG 2 A/AA and 2.1 AA rules. Route/response/title/main-landmark, Duke blue, PNG source/alternate text/loading and viewport bounds are checked. A separate test compares the served logo bytes with the tracked PNG. Keyboard checks exercise dialog trapping, Escape and returned focus. Representative home, mobile application/administration/reviewer, TA queue and RA appointment screenshots are retained and inspected.

These scans are automated checks of the exercised states, not proof of universal accessibility or physical-device behavior.

## Provider, dependency and review boundaries

The latest production build also passed **seven real OpenAI requests** through headless browser workflows: qualification summary, requirements suggestions, course review, two teachers' initial comparisons and both automatic updates after selection. The [sanitized browser receipt](verification/ai-browser-proof.json) records the source digest, configured model and outcomes. The saved Key was decrypted only by the local Windows loader and passed through the application child environment; it was not printed, saved to logs or exposed to the browser. Synthetic records alone were sent to OpenAI. All responses passed schema/evidence checks, the competing selection was refused, expiry preserved history without another call, and cleanup completed.

The retained [five-request OpenAI receipt](verification/ai-provider-proof.json) is historical. Loopback providers still exercise controlled failure, quota and race cases. The masked DPAPI launcher remains covered by synthetic-credential tests. Real API success does not establish real hiring accuracy or fairness. See [AI workflows](AI_WORKFLOWS.md) for the exact insertion points and manual/automatic behavior.

MongoDB remains pinned to **7.8.0**. The current npm audit snapshot reports **zero vulnerabilities**. Mandatory declared indexes and transaction-capable topology are readiness requirements. Unit/source checks, dependency audit and finite acceptance tests are complementary evidence; none is an exhaustive security proof.

The [inventory](verification/application-inventory.json) records delivered file bytes. The [reading ledger](review/final-reading-ledger.json) combines current domain and integration review of changed code with unchanged-byte receipts from the prior complete maintained-source review. Independent cross-review also checked authority, lock order, private projections, canonical resource linkage, command versions, provider evidence, pagination and interface capabilities. Earlier review documents remain explicitly historical.

Full administrative audit records remain stored; the current detail view displays the most recent 100. Consistent manager reads can retry during continuous writes and retain the previous complete dataset after bounded failure. Sustained production scale, long-running failover, institutional SSO, private applicant inference, provider fairness/quality, external payroll/expense validation, email, hosted infrastructure, Kubernetes and physical devices were not verified.

PDF/TXT files are private attachments; their bytes are not parsed by AI. Qualification fields, screened answers and typed background text provide evidence. Classification/redaction is defensive, not guaranteed anonymization. Queue observations, reported work and cost scenarios do not prove total paid work or authorize automatic staffing reductions.

Interactive demonstration windows and the demonstration website remain closed. Disposable verification services are stopped and removed after their runs.
