# CampusWorks staffing operations

This document describes the implemented local TA/RA application service. Test results and their limits belong in [VERIFICATION.md](VERIFICATION.md). The business architecture is summarized in [STAFFING_DESIGN.md](STAFFING_DESIGN.md).

## Roles and scope

CampusWorks retains four identities: student, TA, instructor, and administrator. TA and RA are appointment types. An RA appointment does not create another platform role or grant course queue authority.

| Actor | Implemented authority |
| --- | --- |
| Applicant | Maintain own applications; upload own CV; submit or withdraw under the state rules; answer own offers; provide restricted administrative details after an offer; record own active TA appointment work |
| Course TA | Existing duty, queue and announcement operations in the course where an effective TA grant exists |
| Course instructor/admin | Publish and review positions for courses they manage; shortlist, select and issue offers; oversee appointments; review course activity, headcount and workload |
| RA position owner | Review direct RA positions while retaining current instructional authority |
| Site administrator | Configure terms and their approval policy; approve staffing requests; determine clearance; administer courses and authorized staffing records |

The server checks current course enrollment and direct RA ownership. A primary role label alone is not authority over an unrelated course. A person may apply while holding another platform identity, but a reviewer cannot select themselves. TA status alone never grants hiring rights; unavailable management controls are hidden.

The owner has retained the existing course/site administration scopes without adding a department-admin hierarchy or independent second-approver workflow. Course administration stays course-scoped. Clearance uses site-admin authority. Staffing manages headcount and work requirements without financial budgeting. See [PRODUCT_POLICY.md](PRODUCT_POLICY.md) for the confirmed scope.

## Runtime prerequisites

MongoDB must support transactions through a replica set or compatible sharded topology. Standalone MongoDB is rejected. Required uniqueness indexes must be established successfully; an unsuccessful index setup is a readiness failure.

Course mutations and TA appointment transitions share a write on the canonical course record before authorization/state validation. Staffing takes the shared recruitment-cycle write first. RA transitions then lock their direct opportunity and current instructional authority. Candidate allocation, vacancy counters, offers, appointments, audit/outbox events and command receipts commit together. There is no process-local mutex being treated as a cross-instance guarantee.

Use an explicit `SESSION_SECRET` of at least 32 characters in production. Set `PUBLIC_ORIGIN` for production OAuth and enable `TRUST_PROXY` only behind a correctly configured trusted proxy. Keep `ENABLE_MOCK_LOGIN=false` for real users. Demo sign-in deliberately permits role selection and is not an institutional authentication method.

## A complete TA appointment

1. A site administrator creates a semester with dates and `requiresApproval`, selects it as the single current semester, and sets its application window. Approval is required by default. Only that administrator-owned term policy can relax the requirement; an instructor's posting checkbox cannot override it.
2. A site administrator creates the operational course offering and assigns its instructor/course administrators using the course people controls. The operational course can be reused across recruitment semesters. Every posting inherits the current semester and shared application deadline.
3. An authorized instructor creates an opportunity, supplies duties, hours, qualifications, required availability, questions, CV requirement and positions, and requests publication. A required approval produces `pending_approval`; administrator approval publishes it. Administrator-created/approved requests and explicitly approval-optional terms follow their corresponding path.
4. A student opens the published opportunity, saves a draft, supplies academic and availability information, answers questions, and uploads the required CV. Saving revised qualifications returns the application to `draft`; submission is explicit.
5. Submission validates the published requirements version, required profile/answers/CV, declared hours and schedule. It records a frozen qualification/CV snapshot. Reviewers cannot inspect unsent drafts or a newer draft CV.
6. An authorized reviewer shortlists or reviews the submitted application, then selects it with an idempotency key. Selection immediately issues an offer and reserves the candidate and one vacancy in the same transaction.
7. The candidate accepts the offer. The appointment becomes `pending_clearance`; acceptance does not grant course staff access.
8. A site administrator records clearance. A cleared appointment becomes `active` if its start has arrived, otherwise `pending_start` until the effective start.
9. The course's effective role calculation recognizes the active, accepted, cleared, date-valid TA appointment. The person can enter the familiar TA view and start duty. Their other courses retain their own roles; the session is not promoted globally.
10. Ending, expiry or suspension removes appointment-derived authority. If no other valid staff grant remains, duty and live claims are cleared while the student request and accumulated help history are preserved. Independent manual instructor/admin/TA grants are retained.
11. TA course review combines recorded queue activity, submitted feedback, declared workload and approved/reserved headcount. Instructors and administrators decide the following term's requirements.

The service permits applying to several opportunities while available. Shortlisting does not reserve a student. A stable applicant cannot hold date-overlapping TA/RA commitments across any term IDs, including two half appointments. The existing one-live-allocation-per-term rule also remains. Date intervals include the start and exclude the end, so adjacent appointments may meet at the same instant.

## Opportunities and requirements

An opportunity stores its TA/RA type, course/RA owner scope, term, department, title, description, positions, weekly hours, appointment dates, application deadline, required/preferred skills, screening questions and material requirements.

Attendance, lab, discussion, grading and office-hour flags are separate from duty rows. Duty rows identify category, occurrences per week and minutes per occurrence. The total stated duty duration cannot exceed the published weekly hours. Required weekly slots use day number and increasing same-day `HH:mm` windows; adjacent applicant slots can jointly cover a required window. Missing availability is not replaced with an invented twenty-hour declaration.

`requirementsVersion` changes only when draft requirements change. Operational counters use the separate row `version`, so selecting another person does not invalidate an applicant's unchanged draft requirements. Scope and term cannot be edited into another resource. Requirements freeze once publication/applications prevent ordinary draft editing; materially different requirements need a separate opportunity.

Publication requires a valid position count, appointment dates, work requirements and the applicable administrative approval. Selection checks approved vacancy capacity and candidate availability. It performs no pay or financial calculations.

Closing applications prevents new submissions without ending existing appointments. Outstanding offers/appointments must be resolved before cancellation/archive. Linked staffing records also constrain course deletion.

Course deletion requires linked opportunities to be archived or cancelled and every linked appointment to reach a terminal state. A completed appointment needs no additional closeout step.

## State and concurrency rules

| Record | Important implemented states |
| --- | --- |
| Opportunity | `draft`, `pending_approval`, `published`, `applications_closed`, `filled`, `cancelled`, `archived` |
| Application | `draft`, `submitted`, `under_review`, `shortlisted`, `not_selected`, `selected`, `withdrawn` |
| Offer | `issued`, `accepted`, `declined`, `expired`, `rescinded` |
| Appointment | `offered`, `pending_clearance`, `pending_start`, `active`, `suspended`, `ended`, `cancelled`, `not_cleared`, `expired` |
| Clearance | `not_started`, `pending`, `needs_information`, `cleared`, `not_cleared` |

The first successful server-side selection transaction wins. Client clock, application order and AI ordering do not decide ownership. A competing selection receives a conflict and the interface synchronizes current availability. The unique applicant/term allocation and shared transaction also prevent overfilling the last vacancy. A rejected command is never replayed automatically.

Offer response expires after seven days or at the appointment end, whichever arrives first. Acceptance checks server time and the current offer/allocation reference. Expired, declined or rescinded offers release commitments, and a pre-acceptance application can return to review. An accepted appointment is not released by an obsolete offer-expiry transition. Clearance still pending at the appointment end cannot extend privileges beyond that end.

The applicant can withdraw before acceptance, including resolving an outstanding offer. After acceptance, withdrawal is blocked as an employment-ending shortcut. Instructors and administrators suspend or end the appointment through the existing controls. The owner has declined a student resignation workflow.

Profile edits require `expectedVersion`; CV upload includes the current application version. Restricted administrative updates use `expectedAdministrativeVersion`. Stale edits receive a conflict. Selection commands replay their recorded outcome for the same key and application. Workload command replay returns the existing observation only when date, category, hours, notes and author match; reusing the key for different content receives a conflict.

Submission also requires the reviewed application's `expectedVersion`; it cannot freeze an unseen newer draft. The administrator's recruitment-window form keeps the version from which editing began, even when background polling sees another update. An application detail refresh includes current cycle capabilities, and pre-acceptance withdrawal remains available after applications close.

Removing a student stores a course-scoped restriction and removes membership/queue participation atomically. Enrollment, queue entry and later TA activation respect that restriction. An authorized instructor or administrator can restore access from the course people controls; restoration does not re-enroll the student. Disabled accounts cannot retain live duty or claims, while independent role records and appointment history remain recorded.

Queue writes require explicit intent. `join` creates a request; `edit` and leave require its `entryId`. `complete` additionally requires its `expectedRevision` and the acting helper's current, unpaused claim. Explicit removal is separately recorded. Admin pagination supplies a dataset fingerprint; changed pages return a conflict and the interface restarts the complete read. Counts and CSV keep the previous complete snapshot until every replacement page succeeds. Polls do not supersede unfinished reads.

## CV and administrative privacy

CV files are private database records. Supported attachments are a PDF with the expected signature or valid UTF-8 plain text. A file is limited to 2 MiB, an application to ten stored CV versions and a user to 50 MiB of retained CV bytes. Quota accounting is transactional across courses.

Known active PDF markers are rejected, but this check is not antivirus certification. Downloads are authorized, attachment-only, non-cacheable and protected with content-type/sniffing/sandbox headers. Reviewers receive only the CV referenced by the submitted snapshot. The owner can access their own permitted documents. Downloads generate audit events.

PDF extraction, OCR, malware scanning and raw-document transmission to an AI provider are not implemented. The AI background summary uses qualification fields, approved screening answers and the optional editable qualification text. Applicants/reviewers must supply and check that text manually when PDF contents are relevant.

Institutional ID, prior payroll status, whether the applicant has an SSN, citizenship category and work-authorization expiry are collected separately after an offer when needed. Actual SSN numbers and identity documents are not accepted as administrative fields. The normal qualification-save endpoint cannot collect or erase these details.

Only the applicant and site administrators can update those administrative details before clearance. After clearance, site administrators alone can correct them with a required reason and administrative version check. A separate private audit preserves the actor, reason, previous values and replacement values. Correction alone changes no appointment or clearance state. Ordinary faculty reviewers do not receive the administrative object, administrative audit, historical unsent revisions, or restricted clearance reasons. These values do not enter ordinary events, notifications or AI evidence.

New screening questions are explicitly qualification-classified and known administrative question prompts are rejected. AI accepts only that classification and rechecks the prompt; older unclassified questions are omitted with an evidence caution. Contextual filtering retains legitimate questions about race conditions or software health checks. Free-text filtering is a precaution, not a guarantee of complete anonymization.

## AI configuration and actual behavior

AI is optional for every deterministic workflow. With any required setting missing, an authorized request records an `unconfigured` task and makes no provider call. It does not produce a fabricated ranking or insight.

| Setting | Implemented meaning/default |
| --- | --- |
| `AI_BASE_URL` | Provider base URL; the adapter appends `/chat/completions` |
| `AI_API_KEY` | Server-only bearer credential |
| `AI_MODEL` | Provider model identifier |
| `AI_DAILY_REQUEST_LIMIT` | Requests per user per UTC day; default 20, accepted maximum 1,000 |
| `AI_DAILY_TOKEN_BUDGET` | Conservative reserved units per user/day; default 100,000, maximum 10,000,000 |
| `AI_GLOBAL_DAILY_REQUEST_LIMIT` | Deployment-wide requests/day; default 200, maximum 10,000 |
| `AI_GLOBAL_DAILY_TOKEN_BUDGET` | Deployment-wide reserved units/day; default 1,000,000, maximum 100,000,000 |
| `AI_MAX_CONCURRENT` | Deployment-wide live calls; default two, maximum twenty |
| `AI_AUTO_REFRESH_ENABLED`, `AI_AUTO_DISCOVERY_ENABLED` | Automatic execution/discovery enabled unless explicitly false |
| `AI_AUTO_CANDIDATE_PAGE_SIZE` | Automatic comparison pages, default ten, range one through ten |
| `AI_TERM_REVIEW_COOLDOWN_MS` | Changed preview cooldown, default 900,000 ms; first final review bypasses it |

The adapter uses a JSON chat-completion response contract, a 15-second timeout covering headers/body, no redirects, at most 50,000 input bytes, a requested 2,500 output-token cap and a bounded response body. HTTPS is required except for loopback HTTP used in local provider tests. Base URLs cannot contain credentials, query strings or fragments.

Before a configured call, a MongoDB transaction reserves user/global daily request and token budgets plus a shared concurrency lease. The concurrency record is independent of the date so midnight does not double the live-call allowance. Expiring leases recover from process loss. Failed attempts can consume reserved daily capacity; this is deliberately conservative.

The reservation uses UTF-8 input bytes plus the output cap rather than trusting a provider's usage report. It is not a monetary billing guarantee or proof of a model's tokenizer behavior. Configure the provider account's own spending limits and review the chosen model/pricing before enabling real private-data processing.

| Task | Actual input and output boundary |
| --- | --- |
| `candidate_fit` | Qualification-only evidence for currently available, eligible submitted applicants; advisory evidence-linked comparisons, never selection |
| `cv_summary` | Application qualification fields/text/approved answers; does not mean a PDF was parsed |
| `opportunity_draft` | The existing opportunity requirements; suggestions still need human confirmation |
| `term_review` | Whole-course/selected-term checked aggregates and evidence gaps, or the compatible opportunity-scoped aggregates |

Candidate comparisons scan past unavailable/ineligible submissions, then compare a page of eligible candidates. Automatic pages default to ten people and are discovered without navigation. The protected explicit-request API retains optional `page` and `pageSize` from one through fifty for compatibility. Coverage reports inspected/compared/submitted counts and remaining pages. A page result is not a claim about the best candidate in the entire pool. Oversized automatic text is explicitly excerpted, preserving all candidates/references and a complete-source hash; a caution requires full-record review. Inputs still above the byte limit stop before budget reservation until evidence changes.

Provider JSON must contain `summary`, `summaryEvidenceRefs`, bounded `items` with `targetId`, `explanation`, `evidenceRefs`, and bounded `cautions`. References must exist in the supplied input; candidate items cannot cite another candidate's evidence. Uploaded text is untrusted content, not permission to alter criteria or execute commands. Structural validation does not establish semantic correctness or fair hiring outcomes.

A candidate comparison must include every supplied candidate exactly once; omitted, repeated or invented targets are invalid. The provider is contacted only while its distributed lease is still valid after AI quota reservation commits. At appointment end, new comparisons and candidate summaries stop and automatic refresh scopes deactivate. Authorized completed results remain explicitly historical, with their original generation time; they do not imply current availability. Course reviews and appointment history remain available.

The service rechecks authorization, execution fences and input hashes after the call and when reading current completed analyses. Changed availability, qualifications or report evidence produces `stale`; invalid/failed/timeout/quota-limited calls expose safe messages and back off. Ended-position history preserves its original result/date; current management and source-access permissions remain required. Requirements drafts, submitted summaries, candidate comparisons and course reviews are automatically discovered in persistent round-robin passes. Jobs/results are shared by resource, task, semester and candidate page, with a current authorized account executing the work. A current peer can take over revoked authority; no manager means no call. Ordinary polling purchases no requests. Unchanged evidence reuses results. Daily quota exhaustion waits until the next UTC day. Missing configuration never calls a provider.

Course reviews use a preview phase while the semester is underway and a final phase at its end. Changing checked aggregates coalesces previews with a fifteen-minute default cooldown. The first final phase bypasses that cooldown without requiring a page visit. Results remain advisory; the service never performs hiring, offer responses, clearance or deletion on behalf of a person.

## Maintenance and in-app delivery

Staffing/AI endpoints run bounded due-appointment reconciliation before their ordinary work. Course transactions also reconcile their locked resource. Date-valid authorization checks remain authoritative even before a displayed status has been reconciled.

An independent persistent worker processes due appointments and notifications even when AI is unconfigured and no page is open. It uses a shared renewable lease, alternating lifecycle/delivery lanes, bounded work and batches, retry backoff and restart recovery. `STAFFING_MAINTENANCE_ENABLED` defaults true and the idle interval defaults to 5,000 ms. Existing domain transactions remain authoritative, and access expiry is also checked directly by authorization. An authenticated site administrator can still call the maintenance API `POST /api/staffing/reconcile`; no manual refresh control is required.

Lifecycle events are stored with the domain transition. In-app delivery claims each pending event inside a transaction and inserts notifications with a unique event/recipient key before marking it delivered. Concurrent/repeated processing cannot deliver duplicate records. Offer recipients, current scoped reviewers and actual administrator identities determine recipients; the user account's displayed role is not treated as a stored authority field.

Notifications are listed in the authenticated overview and can be marked read only by their recipient. They contain a short status message and a protected application/staffing link, not CV contents or clearance details. No email, SMS, institutional inbox or external messaging integration is configured.

## TA and RA records

RA uses the same application, offer, acceptance and administrative-clearance states as TA. It grants no course queue permissions, project workspace or research update feature. Recruitment entry links appear only on the course-list home page; secondary staffing pages provide Home/back navigation.

TA appointees and authorized managers may record bounded, categorized workload with replay-safe command keys. Queue help time and self-reported workload remain distinct evidence sources.

## Course reports and appointment closeout

The course review uses the shared current semester by default, with an optional authorized historical API scope, and applies its dates to queue/feedback records and its ID to staffing/workload records. Metrics aggregate all matching TA course records; RA metadata does not contribute TA headcount or workload. Detailed workload and opportunity rows are paged separately, so the report does not silently truncate totals at a row limit.

Every aggregate, detail page and P90 query within one course-review response uses the same database snapshot. Recorded outputs include queue/help counts, mean/nearest-rank P90 wait, recorded help duration, feedback count/mean and workload totals by category. Approved positions, reserved positions and unfilled seats count approved published, applications-closed or filled plans whose appointment end is still in the future. Draft, cancelled, archived and ended plans do not inflate these active totals; the opportunity detail list retains historical plans.

Queue interactions do not measure all lecture attendance, labs, grading, discussions, preparation or total workload. The report lists missing evidence. AI can draft observations from those checked aggregates, but it cannot infer causal effects, assign a staff-quality score or change staffing itself.

Declined, rescinded, expired, not-cleared and ended appointments release the reserved position and candidate allocation atomically. Suspension preserves the reservation while removing operational access. Repeating a completed end/release does not decrement capacity twice.

The staffing and administration interfaces expose authorized end, cancellation and archive actions with the same server checks. An opportunity cannot be cancelled or archived while live offers or appointments remain. Legacy financial fields are preserved in stored historical records but are not returned, used in capacity decisions or required for closeout. The removed settlement API returns `410` before maintenance or mutations. AI request, token and concurrency quotas remain separate operational protections.

## Identity changes

Institutional identity is bound to provider, issuer and subject with a stable user ID. The service does not attach an institutional sign-in to an existing account through email alone. A reused email, changed subject/email binding, disabled account or incompatible provider history fails closed rather than inheriting another person's allocations and permissions.

Demo sign-in cannot impersonate an institutional binding. Sessions reference revocable server records and the still-valid account/provider binding; logout revokes that session record. Email changes, identity consolidation and recovery require a separately verified administrator process. There is no self-service identity-linking or account-change reconciliation workflow to claim as completed.

## Confirmed product scope and external boundaries

The owner has prohibited overlapping appointments, including two half appointments; retained existing manager-controlled departure and course/site administration; declined additional retention/document/HR features; and authorized automatic candidate comparison updates after list changes. These decisions are recorded in [PRODUCT_POLICY.md](PRODUCT_POLICY.md).

The owner supplied an OpenAI Key through the local masked form and authorized real-provider verification using synthetic records. [AI workflows](AI_WORKFLOWS.md) describes automatic insertion points and links to executed receipts, whose source boundaries and dates matter. No real institutional identity, payroll, email or document-scanning service is established by these checks. In-app notifications and private attachment controls remain available. Descriptive workload and queue observations support a human staffing decision; the software cannot validate unrecorded work.
