# CampusWorks staffing operations

This document describes the implemented local TA/RA application service. Test results and their limits belong in [VERIFICATION.md](VERIFICATION.md). The business architecture is summarized in [STAFFING_DESIGN.md](STAFFING_DESIGN.md).

## Roles and scope

CampusWorks retains four identities: student, TA, instructor, and administrator. TA and RA are appointment types. An RA appointment does not create another platform role or grant course queue authority.

| Actor | Implemented authority |
| --- | --- |
| Applicant | Maintain own applications; upload own CV; submit or withdraw under the state rules; answer own offers; provide restricted administrative details after an offer; record own active-appointment work |
| Course TA | Existing duty, queue and announcement operations in the course where an effective TA grant exists |
| Course instructor/admin | Publish and review positions for courses they manage; shortlist, select and issue offers; oversee appointments; review course activity and staffing scenarios |
| Research project owner/reviewer | Manage the assigned project's positions, applicants, appointments and research updates |
| Site administrator | Configure terms and their approval policy; approve staffing requests; determine clearance; settle financial commitments; administer courses and authorized staffing records |

The server checks current course enrollment or project ownership. A primary role label alone is not authority over an unrelated course. A person may apply while holding another platform identity, but a reviewer cannot select themselves. Project creation requires actual instructional/course-admin authority or site-admin authority.

The owner has retained the existing course/site administration scopes without adding a department-admin hierarchy or independent second-approver workflow. Course administration stays course-scoped. Clearance and settlement use site-admin authority. See [PRODUCT_POLICY.md](PRODUCT_POLICY.md) for the confirmed scope.

## Runtime prerequisites

MongoDB must support transactions through a replica set or compatible sharded topology. Standalone MongoDB is rejected. Required uniqueness indexes must be established successfully; an unsuccessful index setup is a readiness failure.

Course mutations and TA appointment transitions share a write on the canonical course record before authorization/state validation. Research transitions use their canonical project record. Candidate allocation, vacancy counters, budget commitments, offers, appointments, audit/outbox events and command receipts commit together. There is no process-local mutex being treated as a cross-instance guarantee.

Use an explicit `SESSION_SECRET` of at least 32 characters in production. Set `PUBLIC_ORIGIN` for production OAuth and enable `TRUST_PROXY` only behind a correctly configured trusted proxy. Keep `ENABLE_MOCK_LOGIN=false` for real users. Demo sign-in deliberately permits role selection and is not an institutional authentication method.

## A complete TA appointment

1. A site administrator creates a term with dates and `requiresApproval`. Approval is required by default. Only that administrator-owned term policy can relax the requirement; an instructor's posting checkbox cannot override it.
2. A site administrator creates the operational course offering and assigns its instructor/course administrators using the course people controls. A course ID is bound to its staffing term when its first TA opportunity is created. A different term needs a different operational course offering.
3. An authorized instructor creates an opportunity, supplies duties, hours, qualifications, required availability, questions, CV requirement, positions and cost basis, and requests publication. A required approval produces `pending_approval`; administrator approval publishes it. Administrator-created/approved requests and explicitly approval-optional terms follow their corresponding path.
4. A student opens the published opportunity, saves a draft, supplies academic and availability information, answers questions, and uploads the required CV. Saving revised qualifications returns the application to `draft`; submission is explicit.
5. Submission validates the published requirements version, required profile/answers/CV, declared hours and schedule. It records a frozen qualification/CV snapshot. Reviewers cannot inspect unsent drafts or a newer draft CV.
6. An authorized reviewer shortlists or reviews the submitted application, then selects it with an idempotency key. Selection immediately issues an offer and reserves the candidate, one vacancy and its budget commitment in the same transaction.
7. The candidate accepts the offer. The appointment becomes `pending_clearance`; acceptance does not grant course staff access.
8. A site administrator records clearance. A cleared appointment becomes `active` if its start has arrived, otherwise `pending_start` until the effective start.
9. The course's effective role calculation recognizes the active, accepted, cleared, date-valid TA appointment. The person can enter the familiar TA view and start duty. Their other courses retain their own roles; the session is not promoted globally.
10. Ending, expiry or suspension removes appointment-derived authority. If no other valid staff grant remains, duty and live claims are cleared while the student request and accumulated help history are preserved. Independent manual instructor/admin/TA grants are retained.
11. Course review combines recorded queue activity, submitted feedback, declared workload and explicit cost scenarios. Instructors and administrators decide the following term's requirements.

The service permits applying to several opportunities while available. Shortlisting does not reserve a student. A stable applicant cannot hold date-overlapping TA/RA commitments across any term IDs, including two half appointments. The existing one-live-allocation-per-term rule also remains. Date intervals include the start and exclude the end, so adjacent appointments may meet at the same instant.

## Opportunities and requirements

An opportunity stores its TA/RA type, course/project scope, term, department, title, description, positions, weekly hours, appointment dates, application deadline, required/preferred skills, screening questions and material requirements.

Attendance, lab, discussion, grading and office-hour flags are separate from duty rows. Duty rows identify category, occurrences per week and minutes per occurrence. The total stated duty duration cannot exceed the published weekly hours. Required weekly slots use day number and increasing same-day `HH:mm` windows; adjacent applicant slots can jointly cover a required window. Missing availability is not replaced with an invented twenty-hour declaration.

`requirementsVersion` changes only when draft requirements change. Operational counters use the separate row `version`, so selecting another person does not invalidate an applicant's unchanged draft requirements. Scope and term cannot be edited into another resource. Requirements freeze once publication/applications prevent ordinary draft editing; materially different requirements need a separate opportunity.

Cost is computed from weekly hours, the rounded-up appointment weeks and hourly rate. The published budget must cover the advertised positions under that cost basis. This is application budgeting, not a payroll calculation or confirmation of an approved institutional pay rate.

Closing applications prevents new submissions without ending existing appointments. Outstanding offers/appointments must be resolved before cancellation/archive. Linked staffing records also constrain course deletion.

Course deletion also waits for activated appointments' financial commitments to be settled, including appointments whose operational status has already ended.

## State and concurrency rules

| Record | Important implemented states |
| --- | --- |
| Opportunity | `draft`, `pending_approval`, `published`, `applications_closed`, `filled`, `cancelled`, `archived` |
| Application | `draft`, `submitted`, `under_review`, `shortlisted`, `not_selected`, `selected`, `withdrawn` |
| Offer | `issued`, `accepted`, `declined`, `expired`, `rescinded` |
| Appointment | `offered`, `pending_clearance`, `pending_start`, `active`, `suspended`, `ended`, `cancelled`, `not_cleared`, `expired` |
| Clearance | `not_started`, `pending`, `needs_information`, `cleared`, `not_cleared` |

The first successful server-side selection transaction wins. Client clock, application order and AI ordering do not decide ownership. A competing selection receives a conflict and must refresh availability. The unique applicant/term allocation and shared transaction also prevent overfilling the last vacancy or consuming the same remaining budget twice.

Offer response expires after seven days or at the appointment end, whichever arrives first. Acceptance checks server time and the current offer/allocation reference. Expired, declined or rescinded offers release commitments, and a pre-acceptance application can return to review. An accepted appointment is not released by an obsolete offer-expiry transition. Clearance still pending at the appointment end cannot extend privileges beyond that end.

The applicant can withdraw before acceptance, including resolving an outstanding offer. After acceptance, withdrawal is blocked as an employment-ending shortcut. Instructors and administrators suspend or end the appointment through the existing controls. The owner has declined a student resignation workflow.

Profile edits require `expectedVersion`; CV upload includes the current application version. Restricted administrative updates use `expectedAdministrativeVersion`. Stale edits receive a conflict. Selection commands replay their recorded outcome for the same key and application. Workload command replay returns the existing observation only when date, category, hours, notes and author match; reusing the key for different content receives a conflict.

## CV and administrative privacy

CV files are private database records. Supported attachments are a PDF with the expected signature or valid UTF-8 plain text. A file is limited to 2 MiB, an application to ten stored CV versions and a user to 50 MiB of retained CV bytes. Quota accounting is transactional across courses.

Known active PDF markers are rejected, but this check is not antivirus certification. Downloads are authorized, attachment-only, non-cacheable and protected with content-type/sniffing/sandbox headers. Reviewers receive only the CV referenced by the submitted snapshot. The owner can access their own permitted documents. Downloads generate audit events.

PDF extraction, OCR, malware scanning and raw-document transmission to an AI provider are not implemented. The AI background summary uses qualification fields, approved screening answers and the optional editable qualification text. Applicants/reviewers must supply and check that text manually when PDF contents are relevant.

Institutional ID, prior payroll status, whether the applicant has an SSN, citizenship category and work-authorization expiry are collected separately after an offer when needed. Actual SSN numbers and identity documents are not accepted as administrative fields. The normal qualification-save endpoint cannot collect or erase these details.

Only the applicant and site administrators can update those administrative details, and cleared/active details require an administrator-led amendment process rather than an ordinary edit. Course/project reviewers do not receive the administrative object, historical unsent revisions, or restricted clearance reasons. AI projections omit those fields and exclude screening questions that request sensitive administrative or demographic information. Free-text filtering is a precaution, not a guarantee of complete anonymization.

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

The adapter uses a JSON chat-completion response contract, a 15-second timeout covering headers/body, no redirects, at most 50,000 input bytes, a requested 2,500 output-token cap and a bounded response body. HTTPS is required except for loopback HTTP used in local provider tests. Base URLs cannot contain credentials, query strings or fragments.

Before a configured call, a MongoDB transaction reserves user/global daily request and token budgets plus a shared concurrency lease. The concurrency record is independent of the date so midnight does not double the live-call allowance. Expiring leases recover from process loss. Failed attempts can consume reserved daily capacity; this is deliberately conservative.

The reservation uses UTF-8 input bytes plus the output cap rather than trusting a provider's usage report. It is not a monetary billing guarantee or proof of a model's tokenizer behavior. Configure the provider account's own spending limits and review the chosen model/pricing before enabling real private-data processing.

| Task | Actual input and output boundary |
| --- | --- |
| `candidate_fit` | Qualification-only evidence for currently available, eligible submitted applicants; advisory evidence-linked comparisons, never selection |
| `cv_summary` | Application qualification fields/text/approved answers; does not mean a PDF was parsed |
| `opportunity_draft` | The existing opportunity requirements; suggestions still need human confirmation |
| `term_review` | Whole-course/selected-term checked aggregates and evidence gaps, or the compatible opportunity-scoped aggregates |

Candidate comparisons scan past unavailable/ineligible submissions, then compare a page of eligible candidates. Optional request `page` and `pageSize` select a page of one through fifty candidates. Coverage reports inspected/compared/submitted counts and whether additional pages remain. A page result is not a claim about the best candidate in the entire applicant pool. Evidence exceeding the byte budget cannot silently become an unbounded paid call.

Provider JSON must contain `summary`, `summaryEvidenceRefs`, bounded `items` with `targetId`, `explanation`, `evidenceRefs`, and bounded `cautions`. References must exist in the supplied input; candidate items cannot cite another candidate's evidence. Uploaded text is untrusted content, not permission to alter criteria or execute commands. Structural validation does not establish semantic correctness or fair hiring outcomes.

The service rechecks authorization and input hashes after the call and when reading completed tasks. Changed availability, qualifications or report evidence produces `stale`; invalid/failed/timeout/quota-limited calls expose safe messages. Established candidate comparisons automatically update when their candidate list, qualification evidence or cross-term availability changes. Durable work is scoped to the original reviewer, opportunity and comparison page; current permissions and configured budgets remain authoritative. Ordinary page polling does not purchase repeated calls for unchanged evidence. Missing configuration never calls a provider.

## Maintenance and in-app delivery

Staffing/AI endpoints run bounded due-appointment reconciliation before their ordinary work. Course transactions also reconcile their locked resource. Date-valid authorization checks remain authoritative even before a displayed status has been reconciled.

An authenticated site administrator can call `POST /api/staffing/reconcile`. It reports checked resources and outbox progress/`hasMore`. Repeated calls drain bounded batches. A configured AI worker also reconciles due appointments while established comparison subscriptions exist, allowing offer expiry and other timed availability changes to trigger fresh analysis without an open browser. Provider-disabled instances perform no background AI scans or writes; ordinary resource access and explicit maintenance continue to reconcile their scope. Access expiry is also checked directly by authorization.

Lifecycle events are stored with the domain transition. In-app delivery claims each pending event inside a transaction and inserts notifications with a unique event/recipient key before marking it delivered. Concurrent/repeated processing cannot deliver duplicate records. Offer recipients, current scoped reviewers and actual administrator identities determine recipients; the user account's displayed role is not treated as a stored authority field.

Notifications are listed in the authenticated overview and can be marked read only by their recipient. They contain a short status message and a protected application/staffing link, not CV contents or clearance details. No email, SMS, institutional inbox or external messaging integration is configured.

## Research and workload records

RA activation grants the named project workspace only. Project owners/reviewers oversee updates; an active, cleared, date-valid RA may submit project updates and record work. Their ordinary course access stays unchanged. Having an RA workspace does not make them a project staffing manager.

Workspace authorization queries the current effective grant independently of historical appointment pages. Appointments and project activity expose stable, bounded pagination. Project entries retain their update, task or research-note type.

Workload records use an explicit category, hours, UTC work date and notes. The appointment must be active; future dates and more than 24 accumulated hours in a day are rejected. They are labeled self-reported observations, not approved payroll evidence.

## Course reports and budget settlement

The course review accepts an optional term and applies its dates to queue/feedback records and its ID to staffing/workload records. Metrics aggregate all matching database records. Detailed workload rows and opportunity scenarios are paged separately, so the report does not silently truncate totals at a row limit.

Recorded outputs include queue/help counts, mean/nearest-rank P90 wait, recorded help duration, feedback count/mean, workload totals by category, approved/committed budget and cost arithmetic for alternative position counts. Scenarios explicitly lack validated coverage and cannot authorize staffing reductions.

Queue interactions do not measure all lecture attendance, labs, grading, discussions, preparation, peak demand or paid hours. The report lists missing evidence. AI can draft observations from those checked aggregates, but it cannot infer causal effects, rank staff performance or change staffing/budget itself.

Before work starts, a cancelled/expired/not-cleared offer releases its financial commitment. Once an appointment has begun, ending it retains the commitment as `awaiting_settlement`. A site administrator supplies an approved `incurredCost` between zero and the committed cost through the settlement action; only the unused remainder is released. There is no payroll system or automatic proof of incurred expense.

## Identity changes

Institutional identity is bound to provider, issuer and subject with a stable user ID. The service does not attach an institutional sign-in to an existing account through email alone. A reused email, changed subject/email binding, disabled account or incompatible provider history fails closed rather than inheriting another person's allocations and permissions.

Demo sign-in cannot impersonate an institutional binding. Sessions reference revocable server records and the still-valid account/provider binding; logout revokes that session record. Email changes, identity consolidation and recovery require a separately verified administrator process. There is no self-service identity-linking or account-change reconciliation workflow to claim as completed.

## Confirmed product scope and external boundaries

The owner has prohibited overlapping appointments, including two half appointments; retained existing manager-controlled departure and course/site administration; declined additional retention/document/HR features; and authorized automatic candidate comparison updates after list changes. These decisions are recorded in [PRODUCT_POLICY.md](PRODUCT_POLICY.md).

Provider credentials will be supplied separately. No external model, real institutional identity, payroll, email or document-scanning service is established by local tests. In-app notifications and the current private attachment controls remain available. Descriptive workload and budget scenarios still require a human staffing decision; the software cannot validate unrecorded work or external expense evidence.
