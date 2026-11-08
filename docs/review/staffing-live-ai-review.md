# Focused staffing and live AI review

Reviewed on November 7, 2026. This note records a focused semantic review of staffing capacity, explicitly scoped AI automation, persistent request limits, live-provider presentation evidence and demonstration reset/cleanup. It does not claim exhaustive analysis of the repository or replace the earlier reading ledgers. File inventories and byte comparisons establish which files changed; they do not establish semantic review of every changed line.

Executed outcomes, source hashes and verification boundaries belong in the [staffing and live AI verification receipt](../verification/staffing-live-ai-proof.json). This review is not an execution receipt. The initial review preceded acceptance completion; the later administrative-test correction is documented below. This review itself started no service, read no provider Key and made no provider request.

## Explicit automation scope and current authority

The [scope parser](../../server/utils/ai-scope-selection.ts#L10) distinguishes an absent configuration from an explicit array. An absent value retains normal automatic discovery; `[]` enables no scopes. Configured coordinates are bounded, normalized and deduplicated. Candidate pages use the configured automatic comparison size, while other task kinds use their fixed scope coordinates.

Scope selection does not grant management authority. The [actor reconstruction](../../server/utils/ai-automation.ts#L76) checks current account/provider binding and actual course or RA management authority. The [selected discovery path](../../server/utils/ai-automation.ts#L372) observes only permitted coordinates, and [job claiming](../../server/utils/ai-automation.ts#L303) filters execution to the corresponding scope IDs. The [execution fence](../../server/utils/ai-automation.ts#L98) checks the current lease, generation, input hash, configured scope and executing account. It is checked again before publication.

One review finding concerned authority revocation in the selected discovery path: `observeScope` can return no authorized actor without throwing. That path must end an existing scope rather than leave it displayed as active. The implemented [null/error handling](../../server/utils/ai-automation.ts#L377) marks the scope ended and clears its execution lease for both an absent actor and expected scope/permission failures. Current authorization still governs reads of completed results through [task listing](../../server/utils/ai.ts#L385).

The [scoped usage integration tests](../../playwright/e2e/ai-scoped-usage.spec.ts) provide dedicated synthetic cases for an empty selection, four selected task scopes among unrelated eligible resources, and subsequent loss of management authority. Their executed status must be read from the final verification receipt.

## Persistent request and concurrency protection

The [usage collection helper](../../server/utils/ai-usage.ts#L10) keeps ordinary application-local accounting as the default and selects an explicitly configured usage database through the same MongoDB client. It rejects invalid and reserved database names. The [shared account key](../../server/utils/ai-usage.ts#L4) hashes the account identity provider and normalized email when shared accounting is configured. Creating a fresh mock UUID during a demonstration reset therefore does not create fresh daily account capacity.

The [reservation transaction](../../server/utils/ai.ts#L43) checks and updates global daily requests, account daily requests, conservative token reservations and shared concurrency leases together. The [lease confirmation](../../server/utils/ai.ts#L63) prevents a delayed confirmation from authorizing an expired reservation. A task removes only its own lease in [cleanup](../../server/utils/ai.ts#L371). Failed attempts can retain daily reservations; these are conservative request controls, not measured billed usage.

The integration tests use uniquely named `campusworks_test_ai_usage_*` databases and clean only those generated databases. They cover deleting a first disposable application database, creating a second database with a new mock UUID but the same synthetic account email, retaining account/global limits, and two separate application databases competing for the final shared request. They never target the persistent presentation usage database.

## Input, result and live-provider evidence

The [task service](../../server/utils/ai.ts#L294) reconstructs authorized input after reserving capacity and rejects changed evidence before contacting a provider. Automatic jobs also require a live execution fence. The HTTP call uses the configured endpoint, a bounded output allowance, a body-inclusive timeout and redirect rejection. Qualification evidence and structural citation/target checks remain the source and output boundaries; arbitrary free text and model conclusions are not certified accurate or anonymous.

The service captures a bounded [provider provenance record](../../server/utils/ai.ts#L343) from the actual HTTP response and configured host. Safe identifier filtering excludes the configured Key from those metadata fields. It then [rechecks current input and execution authority](../../server/utils/ai.ts#L362) before publishing. A changed source produces a stale result rather than a current recommendation.

The demonstration loads the locally encrypted configuration only for its live OpenAI mode. It starts with [explicit empty automatic scopes](../../scripts/demo-loop-service.mjs#L267), then [enables individual presentation scopes](../../scripts/demo-loop-service.mjs#L395). The [visible AI presentation check](../../scripts/demo-loop-flow.mjs#L133) requires a task created during the current cycle, automatic execution, a current completed result, a non-deterministic result, the actual `api.openai.com` host, a provider response ID and the configured model family. It also checks that the rendered panel displays the same returned summary and records a screenshot hash. A saved illustration or seeded task cannot satisfy that combination.

The live journey includes all four advisory types and an additional candidate comparison after another course reserves the applicant. It verifies that the unavailable application is excluded. This demonstrates the configured workflow and provenance checks; it does not establish hiring quality, fairness or institutional production behavior. Provider reservations may include retries or another concurrently running presentation, so the receipt labels their attribution limit.

## Reset, ownership and shutdown

The presentation uses a generated application database and a separate persistent usage database. Its [ownership check](../../scripts/demo-loop-service.mjs#L189) verifies the generated name, ownership token and synthetic marker, and refuses institutional identity data. [Scope transitions](../../scripts/demo-loop-service.mjs#L395) are serialized and wait for owned AI execution to become idle before restarting the application with the updated allowlist.

The [reset path](../../scripts/demo-loop-service.mjs#L482) stops the application, verifies ownership, restores the isolated baseline and indexes, clears enabled presentation scopes and restarts without discarding shared request accounting. The [close path](../../scripts/demo-loop-service.mjs#L524) stops owned processes before deleting its application database, preserves shared usage and records incomplete cleanup when a required step fails. It stops MongoDB only when that service started the demonstration container. These checks do not authorize deleting another preview database or stopping an unrelated service.

The driver performs the business sequence with ordinary application controls. Human selection, offer acceptance, clearance, appointment end and archive remain explicit product commands even when the test driver clicks them automatically. The closeout distinguishes queue closure and appointment end from calendar semester expiry.

## Queue invariant finding and correction

The final database check originally queried `queueEntries` using `email`. Persisted entries use `studentEmail`, as shown by the [join identity filter](../../server/api/courses/[id]/queue/join.post.ts#L15). The old query could report zero while a student request remained. The [final lifecycle assertion](../../scripts/demo-loop-flow.mjs#L917) now queries `{ courseId, studentEmail: LOOP_LEARNER.email }`. The visible completion checks already exercised removal; the corrected database check independently verifies the final invariant. Verification performed before this correction must not be presented as evidence for that corrected assertion.

## Staffing capacity without financial budgeting

The reviewed staffing source includes the opportunity parser and creation path, appointment reservation/release, public projections, course reports, the staffing route dispatcher and linked-course deletion guard. New [opportunities](../../server/utils/staffing-catalog.ts#L115), offers and appointments carry position capacity, dates, hours and duties without money calculations. [Selection](../../server/utils/staffing-appointments.ts#L115) retains the atomic approved-vacancy gate; [release](../../server/utils/staffing-appointments.ts#L30) releases a reserved position once through the existing terminal-state and transaction guards.

[Public staffing projections](../../server/utils/staffing.ts#L46) omit stored financial fields without mutating historical bytes. The [removed settlement route](../../server/api/staffing/[...path].ts#L20) returns `410` before maintenance or a business mutation, with the same protection at the [appointment service boundary](../../server/utils/staffing-appointments.ts#L171). [Course deletion](../../server/api/courses/[id].delete.ts#L9) remains blocked by unresolved appointments but no longer depends on a financial status attached to an ended appointment.

[Course report totals](../../server/utils/staffing-reports.ts#L66) count approved, not-ended published/applications-closed/filled plans. They distinguish approved positions, reserved positions and unfilled seats while preserving independently paged historical details. AI course evidence uses staffing counts and recorded workload rather than monetary scenarios. AI request, token and concurrency quotas remain active operational controls.

## Announcement links

The [announcement parser](../../shared/announcement-links.ts) recognizes standalone HTTP(S) URLs, excludes embedded credentials and leaves unsupported schemes as ordinary text. Trailing sentence punctuation is separated without dropping the original text. The [rendering component](../../app/components/AnnouncementMessage.vue) uses Vue text interpolation and bound anchors rather than raw HTML; new tabs use `noopener noreferrer`. Long links can wrap within the announcement cell and retain visible keyboard focus.

The [parser cases](../../tests/announcement-links.test.mjs) cover the labeled Zoom example, exact text preservation, punctuation, balanced parentheses, unsafe schemes, embedded credentials and HTML-shaped input. Browser showcase and lifecycle checks establish that the expected link is present for an online student. They do not navigate to a real meeting or certify destination trustworthiness.

## Administrative correction regression

The first complete 208-case execution contained 207 passing cases and one failing assertion in the historical administrative-correction test. It compared an instructor's ended-appointment response with an administrator's later detail response. The extra `clearanceReason` and `clearedBy` fields were deliberate role-based projections, not an appointment mutation. The administrative update service writes application details, its private audit and an event; it does not update the appointment.

The corrected [regression](../../playwright/e2e/staffing-audit-regressions.spec.ts) compares the same administrator view before and after correction and deeply compares the complete stored appointment document. It also checks that the instructor's response continues to omit administrative fields and remains unchanged. All eight cases in that affected file passed in the separate focused run, and its TypeScript check passed. Application code and the production build were unchanged. These separate executions establish combined coverage; they are not one clean 208-case full run.

Local synthetic checks, finite concurrency cases and provider receipts do not prove every possible race, production failover behavior or security property.
