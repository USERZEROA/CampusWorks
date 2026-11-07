# CampusWorks TA and RA staffing design

Status: implemented local application and appointment workflows, with a provider-ready AI adapter. External institutional deployment, real identity-provider behavior, private CV processing by a model, payroll, and institutional policy approval are separate validation boundaries. See [STAFFING_OPERATIONS.md](STAFFING_OPERATIONS.md) for exact current behavior/configuration and [VERIFICATION.md](VERIFICATION.md) for executed checks.

The four identities remain student, TA, instructor and administrator. The application keeps Duke blue and the established course queue screens. TA and RA are appointment types; RA does not introduce another platform role or workspace.

## 1. Business loop

The implemented loop is term configuration, authorized opportunity publication, applicant drafts and submission, human review, transactional selection/offer, candidate acceptance, administrative clearance, date-bound TA course access, recorded TA work, appointment end/settlement, and course review.

For TA appointments, activation is connected directly to the existing course permission boundary. RA appointments record accepted and cleared staffing without granting course authority or creating project workspaces. AI output cannot select an applicant, accept an offer, approve clearance, grant permissions, end employment or change a budget.

The allocation policy prohibits date-overlapping TA and RA commitments across all term IDs, including two half appointments, while retaining one live allocation per term. Several applications and shortlists are allowed while the candidate remains available. The first successful server transaction claims the candidate; a browser click timestamp or AI order is not ownership.

## 2. Resource and identity boundaries

| Resource | Implemented boundary |
| --- | --- |
| Term | Site-admin-created dates and approval requirement; approval is required by default |
| Course offering | Existing operational course ID, reusable across recruitment semesters |
| Recruitment cycle | One administrator-selected semester, opening and closing time; mutations share its transactional fence |
| Opportunity | One type, term and course or direct RA owner scope; requirements version separate from operational row version |
| Applicant | Stable account ID used for allocations and ownership; mutable contact email is not the allocation key |
| Appointment | Accepted scope, dates, clearance and current state; independent of the session's displayed primary role |
| Authority | Highest valid manual course role plus any currently effective TA appointment; RA appointments grant no queue authority |

Institutional identity binds provider, issuer and subject to the stable account. Unsafe email-only linking, reused email and changed identity bindings fail closed. Demo identities cannot impersonate an institutional binding. A verified identity-change/recovery process remains an administrator-policy decision rather than an automatic merge.

Course administrators do not automatically receive department-wide applicant access. Site administrators currently perform term policy, clearance and settlement. A separate department hierarchy and independent second-approver requirement are not implemented.

## 3. Publishing staffing requirements

An authorized instructor/course administrator publishes TA opportunities for their course. Currently authorized instructors publish RA opportunities under their own review scope. Site administrators retain their authorized override scope. All posting actions check actual instructional/course-admin authority, not an arbitrary primary-role label. A former instructor cannot retain RA review rights through stored ownership alone.

Each opportunity includes:

- TA/RA type, title, department, description, shared current semester and optional TA course.
- Position count and weekly hours; the shared cycle controls the application deadline and semester dates supply the appointment defaults.
- Attendance, lab, discussion, grading and office-hour flags.
- Duty rows with category, occurrences per week and minutes per occurrence, plus required weekly availability windows.
- Required and preferred qualifications, structured screening questions and optional/required CV.
- Appointment preferences, hourly cost basis, planned weeks, position budget and publication approval status.

Stated duty hours cannot exceed the weekly limit; the budget must cover the advertised positions under the stated cost basis. Missing availability is not invented for an applicant. Adjacent declared availability windows can jointly satisfy a required continuous window.

Term approval is controlled by site administration. Instructors cannot bypass a required term approval by unchecking their opportunity setting. Draft edits increment `requirementsVersion`; operational selection/capacity changes increment the separate row version. Once requirements are frozen, a materially different request needs a separate opportunity.

Closing applications stops new submissions without ending existing appointments. Cancelling or archiving requires outstanding offers/appointments to be resolved. Course deletion also respects linked staffing state.

## 4. Applicant experience and personal-information mapping

The supplied form images show only the personal-information section through its Next button. Unseen pages are not treated as observed requirements. The implemented application adds the requested opportunity-specific questions, private CV attachment and status flow.

| Information | Implemented treatment |
| --- | --- |
| First/last name, preferred email | Applicant-entered contact/profile information, distinct from stable account identity |
| Undergraduate majors and department | Submitted qualification background |
| Full/half/either/other preference | Structured preference; checked against the published opportunity preferences |
| Prior TA experience and courses/departments | Conditional prior-course detail required when experience is declared |
| Multiple-course willingness | Stored preference; does not bypass one-allocation-per-term exclusivity |
| Graduation term | Explicit field without hard-coding the term shown in the screenshots |
| Declared hours and availability | Explicit hours/windows and narrative; selection checks the opportunity requirements |
| Institution ID, payroll/SSN status, citizenship, authorization expiry | Separate restricted post-offer administrative workflow; no actual SSN number or identity-document field |
| CV | Private PDF or UTF-8 text attachment with size/version/quota controls |
| Screening answers and qualification text | Submitted evidence and a manually correctable text source for AI assistance |

Drafts are private to the applicant. Saving changed qualification evidence returns the record to draft; submitting freezes the profile, question/requirements version, answers and CV reference actually reviewed. Reviewers cannot download a newer unsent CV or inspect private draft revisions. Required fields/questions/CV and current deadline/state are validated server-side.

Applications can be revised before the deadline under the state rules. An outstanding offer must be resolved before editing qualifications. The applicant may withdraw before acceptance. An accepted appointment cannot be ended merely by withdrawing its application.

Administrative details have an independent version. Only the applicant and site administrators may update them after an offer; ordinary reviewers and AI do not receive them. Cleared/active details cannot be changed through an ordinary profile edit.

## 5. Selection, offer and appointment state

| Stage | Implemented result |
| --- | --- |
| Draft / submitted application | No candidate allocation or staff authority |
| Shortlist / review | Human review state, still no allocation |
| Selection | One transaction claims the candidate, vacancy and budget, issues an offer, records its appointment and emits the durable event |
| Offered | Candidate unavailable to competing term opportunities; no TA grant |
| Accepted | `pending_clearance`; candidate consent recorded, still no staff grant |
| Cleared before start | `pending_start`; date-bound authority cannot start early |
| Cleared at/after start | Active TA course access or recorded RA appointment |
| Declined / rescinded / expired before work | Allocation and unused commitments released; eligible application can return to review |
| Suspended / ended | Appointment-derived authority removed; independent manual staff authority retained |
| Started appointment ended | Vacancy released; budget commitment retained until approved incurred-cost settlement |

The offer response deadline is seven days or the appointment end, whichever comes first. Acceptance verifies server time, offer status and its current allocation reference. Old offer-expiry work cannot release a subsequently accepted appointment. Appointment dates are checked by authorization itself, so access does not depend solely on a scheduled status update.

The candidate allocation is unique by stable applicant and term. Vacancy, budget, offer, appointment, command receipt and outbox event share a MongoDB transaction. Competing selections, withdrawal versus selection, last-position claims and retries therefore use canonical committed state rather than stale recommendation screens.

Manual course roles remain independent. A student appointed to TA one course retains their own role elsewhere. Ending their TA appointment does not demote a separately granted instructor/admin role. RA appointments do not authorize any course staff endpoint.

## 6. Transaction and recovery architecture

A replica-set-capable MongoDB deployment is required; standalone mode is rejected. Required indexes are readiness prerequisites. Staffing transitions take the recruitment-cycle fence before their course or direct RA opportunity resource write before authorization/state checks, providing the same conflict boundary across processes.

The queue uses the same transactional resource boundary for joins, closing, assignment, pause/release, ordering, duty, membership cleanup and history. Active-entry removal and historical insertion commit together. Help segments preserve each helper's actual active intervals across pauses and handoffs.

Queue commands identify intent and request identity; completion also fences the helper and request revision. Course-scoped student restrictions persist until an explicit manager restoration, including future appointment activation. Disabled accounts lose live claims without erasing grants or financial obligations. Manager exports use a consistent complete multi-page dataset; slow polls do not cancel unfinished reads.

Domain transitions record durable events. The in-app outbox claims an event and writes uniquely keyed notifications before marking delivery complete in the same transaction. Repeated or concurrent processing cannot duplicate notification rows. Model calls and external side effects are not placed inside a retried database transaction.

Reconciliation handles due offer expiry, date activation and appointment end in bounded, resource-locked batches. Course transactions and staffing/task endpoints invoke the applicable maintenance. The administrator maintenance endpoint can drain additional work. Configured AI workers also process due transitions for their active comparison service so timed candidate availability changes trigger reanalysis without an open browser. Provider-disabled instances perform no background AI work; date-based authorization remains authoritative.

MongoDB's distinction between single-document atomicity and multi-document transactions is the basis of this architecture. [MongoDB atomicity documentation](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)

## 7. AI assistance

Implemented task kinds are candidate comparison, application qualification summary, opportunity draft assistance and course/term review. A server-only HTTP adapter uses configured provider URL, credential and model; absent configuration records an explicit `unconfigured` task and makes no provider call.

Candidate evidence includes approved qualification fields, relevant screening question/answer pairs and optional qualification text. Identity, payroll, citizenship, SSN and work-authorization fields are excluded. Sensitive screening questions are excluded, and defensive free-text filtering removes recognizable identifiers/administrative lines. This does not claim perfect anonymization or verified extraction from a PDF.

Candidate comparison scans past unavailable/ineligible records rather than slicing before eligibility. Comparisons are paged, with explicit inspected/compared/submitted coverage and a statement that one page is not the entire pool. Current allocation is rechecked independently of AI before selection.

Each response must conform to the bounded JSON contract and cite supplied evidence references. Candidate explanations cannot cite another applicant's evidence. Authorization and data hashes are checked again after a call and when results are read. Changed evidence/availability makes a result stale; failed, invalid or over-budget calls do not invent results.

Candidate outputs cover every supplied candidate exactly once. Only explicitly classified qualification questions enter evidence; unclassified questions are omitted with a caution. A live distributed lease is confirmed after budget commit and before the provider call. Position end stops new candidate comparisons, summaries and automatic refresh while preserving currently authorized historical results and course review.

AI requests have user/global daily request and conservative token reservations, distributed concurrency leases, bounded input/output and a body-inclusive timeout. Provider-account spending limits and private-data approval are still required. The software controls requests; it does not certify provider billing, fairness or actual hiring quality.

AI cannot issue offers, reject candidates, approve administrative eligibility, activate privileges or cut staffing. Ordinary product workflows remain available without AI. NIST's AI RMF is a reference for explainability, privacy, fairness and human oversight; following those principles does not itself establish validation or legal compliance. [NIST AI RMF characteristics](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/)

## 8. Work, reports and next-term planning

Active appointees or authorized managers can record categorized, dated workload with replay-safe command keys. Records are self-reported and are not payroll evidence. RA appointments have no project workspace or research updates.

TA course review combines complete matching queue/feedback aggregates, workload by category, explicit budget totals and arithmetic scenarios. Detail rows are independently paged. The AI course review uses those checked aggregates, the selected term where supplied, and explicit missing-evidence statements; it is not limited to one vacancy's applicant data.

Recorded queue use does not establish total teaching demand. Lecture attendance, labs, discussions, grading, preparation, peak deadlines, observation coverage and approved compensation still require appropriate evidence. Low observed queue use alone cannot justify fewer TAs. Scenarios do not automatically alter a budget or publish a new request.

Ending work before activation releases unused commitments. Once work has started, the commitment remains pending an administrator's approved incurred-cost settlement. Only the unused remainder is released; the application does not claim to run payroll.

Browser controls expose settlement and resolved-position archive/cancellation. A private administrative audit allows reasoned site-admin corrections after clearance without changing appointment state. Course review calculations share one database snapshot and separate requested plans, approved position plans, outstanding commitments and settled costs.

## 9. Confirmed product policy

The owner has prohibited overlapping TA/RA commitments and simultaneous half appointments, retained manager-controlled departure and the existing course/site administrator scopes, declined additional retention/document-processing/HR features, and authorized automatic candidate comparison updates after relevant list changes. See [PRODUCT_POLICY.md](PRODUCT_POLICY.md).

Automatic analysis remains evidence-based and advisory, subject to current permissions, available provider configuration and the established budgets. It does not select students or change their permissions. No student resignation workflow, department hierarchy, actual SSN collection, PDF extraction/OCR, antivirus certification, payroll or external messaging is added. Current runtime controls and technical boundaries are documented in [STAFFING_OPERATIONS.md](STAFFING_OPERATIONS.md).

## 10. Verification boundary

Local checks should exercise the real application through multiple browser identities and application instances, concurrent database transitions, failure rollback, direct authorization attempts, private document access, administrative field projections, keyboard/accessibility behavior and a loopback-only fake AI provider.

A successful local result supports only its exercised cases. Actual institutional identity, provider behavior, HR authority, real hiring fairness, production scaling, legal retention requirements and physical-device field performance need their own evidence. The exact current test counts/results are maintained in [VERIFICATION.md](VERIFICATION.md), not inferred from this design.
