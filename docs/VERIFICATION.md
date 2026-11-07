# CampusWorks verification

Verified on November 7, 2026 against the delivered source. Exact case names, durations, hashes and sanitized provider results are in [results.json](verification/results.json).

The complete local acceptance run passed **130 tests**, with zero failures, skips or flaky results. It ran six unit tests, application/server/test TypeScript checks, a production build, and two production application instances sharing an isolated disposable MongoDB replica set. The current Linux production image also passed **16 Chromium/Firefox browser tests** using a separate authenticated database. No GitHub Actions, remote push or deployment was used.

The accessibility matrix covers nineteen authorized pages at 1440, 768, 390 and 320 pixels in both browsers, in both local targets: **304 page/browser/width scans**, with zero violations in the configured WCAG 2 A/AA and 2.1 AA rules. Keyboard tests cover modal focus trapping, Escape and return focus. Every matrix page checks its intended route, HTTP response, title, main landmark, Duke blue, PNG source/alternate text/loading, and horizontal viewport bounds. A separate test compares the served PNG bytes with the tracked asset. Desktop home, mobile application/settings/reviewer, TA queue, RA appointment and automatic comparison screenshots were inspected.

## Executed business and security checks

- Queue join/close, duplicate arrivals, claims, reordering, handoffs, duty and demotion races across application instances.
- Atomic archive rollback after an injected insert failure, exactly-once history retry, actual help intervals and helper attribution.
- Session revocation, forged cookies, shared rate limiting, request origin/body/pagination controls and required-index readiness.
- Institutional subject binding with a loopback fake identity provider; changed/reused email and demo impersonation refusals.
- Administrator-only shared semester/window settings, stale versions, synchronized deadlines, concurrent closure/submission and semester switching.
- Instructor/admin hiring authority; hidden TA/student management links, forbidden-route redirects, private candidate lists and direct-RA ownership revocation.
- Applications closing while current-semester faculty review remains available; disabling recruitment blocks new selections. Issued offers and appointments remain actionable after a semester switch.
- Duplicate selection, last vacancy and budget races, withdrawal versus selection, one live allocation per semester and cross-semester overlapping-date exclusion.
- Offer acceptance, expiry, clearance, start dates, suspension/end, live TA queue access removal and independent manual grant preservation.
- Private draft/CV snapshots, attachment validation/version/quota boundaries, restricted administrative information and clearance-reason redaction.
- RA application/offer/appointment history without project pages, research updates, course staff grants or research workload commands.
- Current-semester report pagination resets on a live administrator semester change; TA reports exclude RA metadata/budget/workload while preserving historical TA observations.
- Transactional queries across 125 feedback/history/enrollment rows, injected getMore failure rollback, complete reads through both instances, and duplicate-free delivery to 125 administrators with current identity exclusions.
- AI evidence/reference validation, unauthorized/invented citations, provider failures, quotas, concurrency, in-flight changes, revoked permissions, restart catch-up and time-only offer expiry.
- Automatic candidate comparison updates without another browser analysis request; exact-page refresh metadata remains reachable after more than 100 approved scopes without cross-reviewer disclosure.
- Actual browser publication, questions, application/CV submission, shortlist/selection, acceptance, clearance, queue/duty and appointment ending.

## OpenAI and dependency checks

The owner supplied a Key through the masked local Windows form. DPAPI stores it in ignored local configuration; the application receives it only through a child process environment. Configuration/status commands do not print or return it. Three launcher tests use injected synthetic credentials; no credentials are present in Git or image inputs.

A separate real OpenAI proof passed exactly **five synthetic requests**: qualification summary, requirement/question suggestions, course review, candidate comparison with two applicants, and comparison with one after a synthetic withdrawal. All responses passed application schema/reference validation, and the proof left no concurrency lease. Its temporary application/database were removed. The [sanitized receipt](verification/ai-provider-proof.json) contains no credential or model output. This is interface evidence, not a hiring-quality evaluation. The adapter uses the documented [GPT-5.4 mini endpoint](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

MongoDB is pinned to **7.8.0**. Vendor guidance identifies pool-isolation and SRV validation vulnerabilities in older releases and deprecates unsafe CSOT options. The application uses separate connection-stage limits, a checked callback work budget and driver-managed commit resolution. The scale regressions exercise the observed multi-batch failure and recovery. See the [official release notes](https://www.mongodb.com/docs/drivers/node/current/reference/release-notes/#what-s-new-in-7-8) and [timeout guidance](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/). The final npm advisory snapshot reports zero vulnerabilities; that snapshot alone is not a security proof.

## Review coverage and limits

The current [inventory](verification/application-inventory.json) records delivered bytes. The [reading ledger](review/final-reading-ledger.json) combines current domain/integration review of changed source with matching byte receipts from the preceding full-source review for unchanged files. Review covered permission gates, cycle/resource/applicant lock order, appointment/offer continuity, private DTOs, report scope, provider inputs/results, pagination, UI navigation and secure local configuration. Earlier reading ledgers remain historical snapshots.

Passing finite tests does not prove every race, sustained production load, failover, hiring fairness or complete assistive-technology compatibility. No real institutional SSO, private applicant inference, payroll, email, hosted infrastructure, Kubernetes or physical-device behavior was verified. AI analyzes entered qualification fields, screened answers and typed background text; uploaded PDF/TXT bytes are private attachments and are not parsed. Free-text redaction is defensive, not guaranteed anonymization. Queue observations, reported workload and cost scenarios do not establish total paid work or justify automatic staffing cuts.

All interactive demonstration windows and the demonstration website remain closed as requested. Disposable verification services are stopped and cleaned after verification.
