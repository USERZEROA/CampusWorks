# CampusWorks business review

Reviewed on November 7, 2026. This record describes the current fixes and their verification targets. Executed outcomes and coverage receipts are in [VERIFICATION.md](VERIFICATION.md).

## Confirmed owner decisions

| Decision | Result |
| --- | --- |
| Removing a student | Course-scoped re-enrollment and queue restriction persists until an instructor or administrator restores access. Restoration does not enroll or reactivate an appointment. |
| Correcting cleared administrative information | Site administrators alone may correct it, including historical cleared appointments. Reason, optimistic version and a private before/after audit are required. Appointment and financial state stay unchanged. |
| Position appointment end | New candidate comparisons, candidate summaries and automatic recommendations stop. Currently authorized historical results, settlement and course review remain available. |

## Closed business sequence

An administrator chooses the current semester, recruitment window and approval policy. Authorized faculty create qualification-focused TA/RA positions with duties, hours, schedules and position budgets. Students draft answers and attach a private CV; submission freezes the exact reviewed version. Human selection reserves candidate, vacancy and commitment together. Acceptance and administrative clearance precede effective dated TA access. RA appointments grant no course queue access.

Course restrictions also govern selection, clearance, resumption and future activation. Restricting or restoring a TA applicant updates established candidate comparisons; another course's restriction does not remove that applicant from RA consideration. Ending or suspending an appointment removes its operational authority while preserving independent manual grants and financial obligations. Administrators settle incurred costs, managers archive resolved positions, and reports support human planning for the following semester.

## Review findings and implemented controls

| Finding | Implemented control | Primary regression evidence |
| --- | --- | --- |
| F01: Course aliases disconnect appointments or deletion guards | Canonical stored scope, safe reads of existing aliases, shared locking and linked-record deletion checks | `staffing-audit-regressions`: canonical scope and direct historical report |
| F02: Administrative answers enter AI evidence | Qualification classification, administrative prompt rejection, omission of unclassified questions and explicit caution | `ai-evidence`, `ai-provider`: qualification projection |
| F03: Stale completion removes a different helper's claim | Separate Complete/Remove intents; request revision, helper and pause checks | `queue-business`: reassignment, ABA handoff and paused completion |
| F04: Old edits or leave target a replacement request | Required original entry ID and explicit join/edit intent | `queue-business`: stale edit/leave and replacement preservation |
| F05: Submission freezes an unseen revision | Mandatory expected application version under resource transaction | `staffing-audit-regressions`: exact reviewed revision |
| F06: Polling silently rebases a dirty schedule form | Form version stays attached to the loaded snapshot; conflicts require reset | `staffing-browser`: competing administrator schedule |
| F07: Multi-page reports merge inconsistent rows | Course-identity and full-dataset fingerprint; bounded restart; publish complete reads only | `queue-business`: 502 rows, KPI, CSV and failed-refresh preservation |
| F08: Slow polling starves updates | Deferred, guarded refreshes and cancellation propagation | `queue-business`: delayed responses; existing browser flows |
| F09: Disabled helpers retain duty/claims | Current account validity participates in effective helper cleanup | `queue-business`: disabled manual TA and demo administrator |
| F10: Application controls retain an old cycle | Details return current cycle; silent synchronization uses authoritative capabilities | `staffing-browser`: reopen without browser reload |
| F11: Closed recruitment hides withdrawal | Withdrawal follows pre-acceptance state independently of edit permission | `staffing-browser`: closed-cycle withdrawal |
| F12: Accepted end boundary prevents default postings | Recruitment closes strictly before semester end | `staffing-audit-regressions`: invalid boundary leaves cycle unchanged |
| F13: Draft budgets appear approved | Requested plans, approved published plans, outstanding commitments and settled costs are separate | `staffing-audit-regressions`: budget progression; fake-provider report evidence |
| F14: Browser cannot complete financial closeout | Authorized incurred-cost settlement, cancellation and archive controls | `staffing-browser`: end, settle, archive and course deletion |
| F15: AI omits or duplicates candidates | Exact candidate-set coverage and unique output targets | `ai-evidence`, `ai-provider`: empty, omitted and duplicate targets |
| F16: Technical questions disappear through broad word filtering | Contextual administrative filtering retains race-condition and software-health evidence | `ai-evidence`, `ai-provider`: retained technical answers |
| F17: RA/TA controls and historical titles disagree with scope | Type-aware queue/work controls and private historical title lookup | `staffing-browser`, `staffing-audit-regressions`: RA metadata and historical titles |

Additional review fixes confirm a valid provider lease after budget commit, use one snapshot for course-review aggregates and P90, guard CSV formula prefixes, prevent snapshot reuse after course deletion/recreation, and check all declared mandatory database indexes during readiness. Local form versions advance from successful commands without adopting another tab's unseen revision. Candidate-analysis capability defaults explicitly preserve other AI task kinds; expired candidate controls alone are hidden. Manager refreshes stop displaying a deleted or newly unauthorized resource.

## Automatic operation review

The owner confirmed that data synchronization and advisory AI generation should run automatically, while business decisions remain human commands. Pages retain complete data through temporary failures, synchronize on reconnect/focus and prevent overlapping reads. Dirty qualification, administrative, recruitment-window and requirement forms retain their original baseline. A remote content edit requires an explicit discard; a delayed response cannot roll back a successful local command.

Saved requirements, submitted summaries, candidate comparisons and course previews/final advice use shared resource-scoped jobs. Current permissions, full-source hashes, generations and live leases fence provider execution and publication. Discovery cursors survive restart. Candidate pages default to ten and cover every supplied candidate once; excerpted input is identified rather than dropping applicants. Retry times belong to job state and cannot be overwritten by discovery hints. Due observations and new-resource hints must both make progress under backlog.

An independent leased maintenance worker alternates timed lifecycle transitions and in-app notification delivery without provider configuration or an open page. Empty batches return to the idle interval; persistent cursors and bounded continuation prevent a large first batch from starving later resources. The original transactional domain controls still govern every transition.

Position end independently blocks new application drafts, qualification/CV edits and submissions even if an administrator extends the shared recruitment window. Pre-acceptance withdrawal remains available. Selection, acceptance, clearance, settlement, suspension/end and deletion are never retried or chosen automatically.

## Evidence boundaries

The review combines the earlier complete maintained-source reading receipts, current domain review of changed files, independent cross-review and targeted synthetic counterexamples converted to regressions. Inventory hashes are distinct from semantic review. Finite tests do not prove all possible races or security properties.

Administrative audit records remain fully stored; the detail view shows the latest 100. Complete course-report reads can retry under continuous writes and retain the previous complete result after a bounded failure. Sustained production load, real failover and large institutional datasets have not been measured.

AI question classification and filtering do not guarantee that arbitrary free text contains no personal information. Candidate comparisons are advisory and paged; provider output is structurally checked, not certified accurate or fair. The [current receipt](verification/ai-browser-proof.json) records real OpenAI checks using synthetic records; controlled failures and races use loopback providers. [AI workflows](AI_WORKFLOWS.md) records the four automatic insertion points. The older five-request receipt remains historical.

The established scope still excludes student resignation requests, a new department role, PDF extraction/OCR, antivirus certification, institutional HR/payroll, external messaging and hosted deployment. These are documented boundaries, not newly enabled business features.
