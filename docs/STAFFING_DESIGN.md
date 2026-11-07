# CampusWorks TA and RA staffing design

Status: proposed design; the application, appointment, research-workspace, and AI capabilities described here are not implemented in the current delivery. The current operational application provides course enrollment, help queues, staff duty, announcements, feedback, and course analytics. Its four roles, Duke blue, layouts, and established workflows remain the product foundation.

The intended business loop is department planning, instructor requirements, student applications, human selection, appointment activation, scoped operational access, course or research work, term review, and the next staffing plan. Completing a staffing process must produce both a recorded appointment and the correct permissions; an AI recommendation or a screen displaying “selected” is insufficient.

## 1. Proposed product decisions

1. Keep exactly four roles: `student`, `ta`, `instructor`, and `admin`. Distinguish global administration from course administration as the current application does. TA and RA are appointment types; RA is not a fifth platform role.
2. Preserve the current course catalog, queue, staff controls, management screens, feedback, and Duke blue. Add Opportunities, My Applications, and Staffing inside the same navigation and visual system. Existing TA operations remain available through their familiar course screens.
3. Default to one reserved, offered, accepted, or active appointment per student per term across the participating TA and RA opportunities. A student may apply to several opportunities while available. The first successful server-side reservation wins; browser click times and recommendation order do not establish priority.
4. Selection reserves the candidate and a vacancy. It does not by itself activate employee permissions. Activation follows acceptance, required administrative clearance, the appointment start date, and the final capacity/budget checks. This is a proposed consent and clearance rule, not an observed requirement of the supplied form.
5. Candidate recommendations assist an instructor. An instructor selects, offers, and documents the decision. Administrative approval is required where the department's configured process calls for it. AI cannot issue offers, reject applicants, activate privileges, or cut staffing automatically.
6. Keep qualification review separate from restricted appointment administration. CVs and applicant answers are private; employment eligibility metadata is not part of the AI fit assessment.
7. Bind an appointment to a specific term and course offering or research project. A TA appointment cannot grant authority in every course, and an RA appointment cannot grant course queue access.
8. Record lifecycle events, decision reasons, permission grants, and data versions so that failures and later changes can be explained and repaired.

The screenshots ask whether a student is willing to serve more than one course. That preference is in tension with the requested exclusive selection rule. In the proposed first release, retain the answer as a preference and clearly state that only one appointment can be reserved or accepted in the term. It does not bypass exclusivity. A later department-approved capacity policy could allow compatible half appointments; that would change allocation, availability, budget, and eligibility checks together.

The supplied form describes full appointments as up to 20 hours per week and half appointments as up to 10 hours. Treat these as observed form choices, not universal work-authorization or university employment limits. Actual allowed hours and conflicts must come from an approved policy and administrative clearance.

## 2. Terms, offerings, and research scopes

Use separate identities for a catalog course, a term, and the actual course offering. For example, CS101 is a catalog course; CS101 in Fall 2027 is an offering with its own instructors, staffing plan, enrollments, queue records, and review. A new offering starts with new memberships. It must not inherit TA authority solely because the student worked on the same catalog course before.

Each offering should have a unique operational `courseId` usable by the current course APIs. The offering's catalog identifier and term identifier are additional metadata, not replacements for that operational key. All staffing grants and new records reference the explicit offering. Associate current operational courses with an offering deliberately; do not infer a term from a title or silently extend existing memberships into another term.

A research project has its own owner, authorized instructors, department, term or appointment dates, tasks, and optional budget. An RA appointment points to a project scope. An RA can remain a platform student with project-specific appointment capabilities. “RA” appears as an appointment badge and workspace label, not as an additional authentication role.

If a person holds both instructional and administrative responsibilities, retain those independent grants. Ending an appointment removes only the authority attributable to that appointment. Resource scope and grant provenance are the source of authority; session `primaryRole` alone is not sufficient.

## 3. People, responsibilities, and access

| Role | Application responsibilities | Operational responsibilities |
| --- | --- | --- |
| Student | Maintain own applicant profile; browse published opportunities; draft, submit, withdraw, and track own applications; respond to an offer | Continue ordinary enrolled-course access; use only the capabilities granted by an active appointment |
| TA | Retain all existing TA course workflows; optionally apply to a later term or another permitted opportunity | Duty, queue, announcements, and other existing staff functions only in courses with a valid staff grant |
| Instructor | Publish requirements for owned courses or projects; inspect authorized applications; request approved budget; shortlist, select, and offer; review recommendations | Manage own course or project, oversee staff work, and review term results |
| Administrator | Configure terms and department process; approve budgets and eligibility clearance; resolve allocations and exceptional changes; manage retention and authorized access | Preserve existing course and global administration boundaries; review department-level staffing and outcomes |

An instructor must be authorized for the opportunity's course offering or project. A course admin does not automatically receive department-wide applicant access. Department administration is an additional scope on the existing admin role, not an assumption that every course admin may see all applicants. Global administrators retain their current privileges, but sensitive-document access should still be explicit and audited.

An instructor reviewing an applicant sees the qualification materials submitted to that opportunity. They do not receive the student's other applications, private research documents, immigration details, or the name of another selecting professor merely because the candidate becomes unavailable. The relevant status can say “unavailable for this term.”

Department staff handling clearance see the minimum administrative information needed for that process. AI receives an approved qualification-only view. Students cannot inspect other applicants or mutate recommendation, allocation, offer, clearance, appointment, or grant records.

## 4. Opportunity publishing

Instructors create a draft staffing request, obtain any required approval, and publish a versioned opportunity. A published version freezes the requirements that applicants answered. A material change after applications exist needs a visible revision, review of existing applications, and applicant acknowledgment where necessary.

| Field group | Proposed fields and behavior |
| --- | --- |
| Identity | Title, TA or RA type, department, instructor owner, authorized reviewers, term, course offering or research project |
| Dates | Application opening and deadline, review window, planned decision date, appointment start and end, offer-response deadline |
| Capacity | Approved number of positions, appointment fraction or allowed fractions, weekly hours, duration in weeks, allocation policy |
| Weekly expectations | Required occurrences per week and expected minutes per occurrence for each duty, plus preparation and coordination time |
| Attendance | Whether lecture or project-meeting attendance is required, days/times, location or remote mode, and whether presence counts toward scheduled hours |
| Labs | Whether labs are required, sections per week, duration, setup/cleanup, and expected student load |
| Discussions | Whether discussion sections are required, sections per week, preparation, and facilitation expectations |
| Grading | Whether assignment/exam grading is required, expected frequency, approximate workload or enrollment basis, rubric responsibilities, and turnaround |
| Office hours | Whether the assistant must hold office hours, sessions and minutes per week, fixed or negotiable schedule, in-person/remote expectations |
| Required qualifications | Skills, relevant courses or equivalent experience, prerequisites with an evidence rationale, and required availability |
| Preferred qualifications | Explicitly optional experience, topic familiarity, or teaching/research experience; distinguish these from hard eligibility requirements |
| Application questions | Question text, answer type, required/optional state, conditional display, rubric, and an allowed word limit |
| Materials | CV requirement, allowed file types and size, optional work samples, and a prohibition on submitting confidential material without permission |
| Budget | Funding owner, approved hourly rate or appointment cost basis, weekly-hour budget, approved total, any separately identified overhead, and approval status |
| RA-specific requirements | Research area, project tasks and deliverables, methods/tools, supervision cadence, confidentiality expectations, workspace needs, and project end conditions |

Validate that the planned duties fit the published weekly-hour limit. Store scheduled duties separately so that one meeting cannot accidentally be counted as both lecture attendance and office hours. An instructor may describe flexible duties, but the resulting hours must show their assumptions and approved upper bound.

Publishing is blocked when required ownership, term, dates, position count, workload, or budget approval is missing. If a department does not require monetary approval, record that policy explicitly rather than invent a zero-dollar budget. Closing applications stops new submissions; it does not revoke active appointments. Cancelling an opportunity requires a separate handling decision for outstanding offers and appointments.

## 5. Student application and supplied-form mapping

The four screenshots show the personal-information section of a Fall 2026 CS master's TA application through a Next button. They do not show later course-preference pages, CV submission, screening questions, or confirmation behavior. Those additional features below are proposals based on the requested product, not claims about unseen form sections.

| Observed form item | Proposed treatment |
| --- | --- |
| 1. First name | Applicant profile; show a preview of the name shared with reviewers |
| 2. Last name | Applicant profile; do not use name as a qualification signal |
| 3. Preferred email | Verified contact channel where supported; keep stable user identity separate from a mutable email address |
| 4. Duke unique ID | Restricted institutional identifier; validate where an approved identity integration exists; exclude from AI input |
| 5. Undergraduate major(s) | Academic background with evidence supplied by the student; permit equivalent relevant experience |
| 6. Full, half, either, or other position preference | Structured appointment preference with a free-text explanation for other; opportunity must state its available fractions and hours |
| 7. Prior TA experience | Yes/no answer; absence of experience is not an automatic rejection unless an explicit justified requirement calls for it |
| 8. Courses/departments previously assisted | Conditional on prior experience; optional evidence details and dates; no required text when the preceding answer is No |
| 9. Willingness to serve more than one selected course | Store preference, display the actual allocation policy, and prevent the answer from bypassing the default exclusive rule |
| 10. Previous Duke payroll status | Restricted appointment-administration information; proposed collection after offer or when department processing specifically requires it |
| 11. Whether the applicant has an SSN | If required for administration, collect only the yes/no status in the restricted clearance workflow; never collect an SSN number in ordinary application answers |
| 12. Department affiliation | Applicant profile; Computer Science or another specified department; not a substitute for skill evidence |
| 13. Citizenship category | Exclude from qualification review and AI; proposed administrative collection only if an approved appointment process requires it |
| 14. Graduation in the stated term | Store intended graduation term rather than hard-coding Fall 2026 into every future form; clarify availability through the appointment end date |
| 15. Work-authorization expiry if international | Restricted conditional administrative field if required; do not request immigration documents in a general answer or expose the field to fit scoring |

The proposed student flow is profile, opportunity preferences, availability, opportunity-specific answers, materials, review, submission, and status tracking. Reuse profile data with consent and let applicants correct it. Submitting to several opportunities creates separate application records and reviewer visibility. Each application freezes the profile fields, question version, answer version, and CV version actually submitted; later profile changes do not silently alter an instructor's reviewed evidence.

Proposed additional fields include course or project preferences, ranked interests where useful, relevant coursework, teaching/research experience, weekly availability, scheduling constraints, a CV, and answers to the published questions. Required answers and file requirements are validated before submission. The student sees exactly what will be shared, saves a draft, and receives a submission timestamp and confirmation status.

An application may be edited before the deadline under a clearly stated rule. Keep revisions and show reviewers when evidence changes. Editing after an offer cannot silently change the offered appointment. Withdrawal is explicit and idempotent. Reapplying after withdrawal or a material opportunity revision follows a configured policy, with a new revision or a new application identity rather than deletion of the audit trail.

Withdrawal while an offer is outstanding also resolves that offer and releases its commitments through the same controlled transition. After activation, withdrawing the application is not an employment-termination shortcut: the student requests appointment cancellation/end, and that lifecycle resolves access, staffing coverage, and remaining commitments explicitly.

CV files use private storage, size/type validation, quarantine and safety checks, expiring authorized downloads, and access logs. A CV parser must show extraction errors and allow correction. Do not interpret missing extracted text as a missing qualification. Restrict file access to the applicant and authorized reviewers, and keep text/embeddings under the same access and retention boundaries as the original file.

## 6. State machines and the complete business loop

Use separate state machines instead of one ambiguous `selected` boolean.

| Entity | Proposed states |
| --- | --- |
| Opportunity | `draft`, `pending_approval`, `published`, `applications_closed`, `filled`, `cancelled`, `archived` |
| Application | `draft`, `submitted`, `under_review`, `shortlisted`, `not_selected`, `withdrawn`; linked offers and appointments supply additional status |
| Allocation | `reserved`, `offered`, `accepted_pending_clearance`, `active`, `released`, `expired` |
| Offer | `draft`, `issued`, `accepted`, `declined`, `expired`, `rescinded` |
| Clearance | `not_started`, `pending`, `cleared`, `needs_information`, `not_cleared` |
| Appointment | `pending_activation`, `active`, `suspended`, `ended`, `cancelled` |

Application submission does not allocate the student. Shortlisting does not allocate the student. A successful explicit selection creates an expiring reservation owned by that instructor/opportunity and consumes an approved vacancy. Other open applications remain in their original review state, with an independently derived availability flag. They are not automatically rejected, so they can become available again if a reservation is released.

An issued offer names the scope, dates, duties, weekly hours, fraction, response deadline, compensation basis where applicable, and conditions. Student acceptance is a signed-in, version-specific action. A declined or expired offer releases its allocation and vacancy. Required clearance is an administrative determination recorded with a minimal status and audit trail, not an LLM judgment. Acceptance alone cannot bypass clearance, and clearance alone cannot manufacture acceptance.

Use state-specific deadlines: a pre-offer reservation lease, an issued offer's response deadline, any accepted-pending-clearance deadline, and the appointment's effective end. Issuing or accepting an offer replaces the preceding deadline under the same owned allocation. A stale reservation-expiry job cannot release an accepted or active appointment; it checks the expected state, token, and version. Acceptance racing with expiry is resolved atomically using server time.

Once all activation conditions hold, create the appointment and its scoped grants, record the event, and make the appropriate course/project workspace available. Before the start date, display the upcoming appointment without activating its authority. A scheduler may trigger activation, but the authorization boundary also checks effective dates and current appointment state.

During the term, the TA performs existing course operations and records any additional workload measures introduced by an approved later phase. The RA works in the assigned project workspace; no course queue privileges follow from the RA appointment. Instructors oversee the work and resolve material duty changes. Budget or hours changes need a versioned amendment and any required consent or approval.

At end or cancellation, revoke only the appointment's grants, clean up current duty and active staff assignments, record the reason, and preserve historical analytics. If a person is still staff through another valid grant, retain their appropriate authority. A release or replacement must never delete student records or past help sessions. A future-term renewal is a new scoped appointment with a new acceptance and required clearance checks; it is not an indefinite extension of the current role.

Ending or cancelling after work has begun can release only the unused budget commitment under the approved accounting policy. Preserve incurred/approved costs and delivered work; do not make spent budget available again by deleting an appointment or resetting its original commitment.

The term closes with descriptive operational review, staffing and budget scenarios, and recorded instructor/department decisions. Approved conclusions inform the next term's requirements; they do not automatically publish vacancies or alter headcount.

## 7. Collision-safe candidate allocation

“First come, first served” means the first successful reservation committed by the service. It does not mean the first application submitted, the highest AI score, the earliest client clock, or the first notification delivered. A faculty page can show stale availability; the selection endpoint must always recheck authoritative state.

Use a required unique allocation key for `(studentId, termId, allocationPolicyScope)`. Under the default policy, the scope covers participating TA and RA appointments for the term. If the intended policy is TA-only exclusivity or permits overlapping terms, that must be configured explicitly before activation. The service can enforce only appointments recorded in its own allocation boundary; outside employment needs a separate declaration or approved administrative check.

Before enabling official staffing allocation, reconcile the department's existing appointments into that boundary. An operational TA role granted through course people management is not sufficient evidence of an employment appointment, and it must not silently create a second paid allocation. Preserve the current manual course-role workflow, but distinguish its permission grant from appointment/headcount records and audit any administrative appointment entry against the same exclusivity, capacity, and budget rules.

The reservation command should:

1. Authenticate the instructor and verify authority over the exact opportunity.
2. Validate an idempotency key and the expected opportunity/application versions.
3. Confirm the opportunity accepts selections, the application is in an eligible review state (`submitted`, `under_review`, or `shortlisted`, rather than withdrawn or closed as not selected), and required non-AI qualification and availability checks still hold.
4. Check approved vacancies, budget, appointment dates, and the student's current allocation.
5. Atomically acquire the candidate allocation, reserve one vacancy and its approved budget commitment, write a reservation/offer record, and append an event/outbox record.
6. Return the canonical committed result. A repeat with the same idempotency key returns that same result; a competing claim returns a conflict without creating a second offer.

A recommendation is never proof of availability. On conflict, respond with a structured `409` result, refresh the authorized availability view, and offer the next eligible suggestion. Show that the candidate became unavailable without disclosing another professor's private decision or other application details. If no eligible candidate remains, say so; do not fill the vacancy with an unsuitable applicant merely to keep a list populated.

For the complete multi-record transition, the proposed preferred deployment uses MongoDB with transaction support, such as a configured replica set. Candidate uniqueness, vacancy and budget counters, reservation, offer, and outbox writes commit together. Required allocation indexes are startup prerequisites; log-and-continue index creation is insufficient. Handle write conflicts with bounded retries and idempotency rather than reporting a success that was never committed. MongoDB documents single-document write atomicity and transactions for multiple documents on replica sets or sharded clusters; those distinctions establish the engineering boundary used here. [MongoDB atomicity documentation](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)

An atomic single-document compare-and-set on the candidate allocation can prevent duplicate candidate claims even without a multi-document transaction. It does not by itself prevent vacancy overfill, overspent budget, or partially written offers and grants. If standalone MongoDB remains a deployment requirement, specify a durable, recoverable reservation process with fenced ownership, reconciliation, and no offer/privilege activation before all commitments finalize. Do not claim equivalent guarantees merely because one candidate write is atomic.

Reservations carry owner, status, version, server timestamps, expiry, and an unguessable ownership token. Renew, release, accept, and activate operations check that token/version. An old instructor request must never release a newer reservation. Expiry is evaluated using server time at the authoritative transition; eventual background cleanup or a TTL mechanism is not the correctness rule. Preserve released/expired allocation history in an audit collection instead of relying on deletion as the only lifecycle record.

## 8. Offer, release, and exception handling

| Event or edge case | Required result |
| --- | --- |
| Two instructors select the same available candidate | Exactly one reservation succeeds; the other receives a conflict and refreshed eligible choices |
| Two candidates are selected for the last vacancy | Exactly one approved vacancy is consumed; the other operation leaves no orphan allocation |
| Same selection/acceptance request is retried | Return the recorded outcome; no duplicate offer, budget commitment, appointment, or grant |
| Applicant withdraws while an instructor selects | A serialized outcome decides which transition wins; a committed withdrawal cannot later become an unexplained active offer |
| Reservation expires before an offer is issued | Mark expired, free capacity/budget, notify the owner, and refresh availability |
| Student declines or does not answer before the deadline | Decline/expiry releases the allocation; instructor can select the next eligible applicant |
| Student accepts an expired or rescinded offer | Reject acceptance and display the current offer state; do not revive the allocation |
| Student accepts and clearance needs information | Keep an explicit pending state with a policy-defined deadline; no active TA/project privileges |
| Clearance is not granted | Close or rescind under the approved process; release commitments and record a restricted administrative reason |
| Instructor rescinds an outstanding offer | Record reason, invalidate acceptance tokens, release commitments, and notify the applicant through authorized channels |
| Opportunity is cancelled or its budget withdrawn | Explicitly resolve reservations and offers; active appointments follow an administrative cancellation process rather than silent deletion |
| Application deadline passes during review | Existing eligible submissions can still be reviewed; new submissions are blocked according to the published deadline |
| Instructor loses course/project access | Block further review/selection; preserve application history and assign an authorized owner |
| Instructor changes hours, dates, or duties after offer | Create an amendment and obtain required approvals/consent; do not silently expand responsibilities |
| Appointment ends normally | End dated access, clear appointment-derived duty/claims when needed, preserve records, and permit a new term's independent process |
| Appointment is suspended | Remove operational authority for the suspension period; retaining or releasing the allocation follows an explicit administrative policy |
| Candidate becomes available again | Update availability on still-open applications and recompute recommendations; do not silently reissue a prior offer |
| A stale release arrives after another professor obtains a new reservation | Token/version mismatch prevents the old request from changing the new reservation |
| Student changes email | Stable identity retains allocation and grants; update verified contact details without creating a second candidate |
| Administrator needs an exception | Use a reasoned, audited command that rechecks vacancy/budget and every affected allocation; do not bypass invariant checks by directly editing a row |
| Database or notification processing fails | A committed reservation remains canonical; retry the durable outbox; uncommitted changes create no active authority |

Deleting a course offering or research project with reservations, offers, or active appointments must be blocked until those records are explicitly resolved or archived under an approved process. The current course-deletion behavior alone does not provide that staffing lifecycle.

## 9. Proposed records and event delivery

| Record | Main purpose and constraints |
| --- | --- |
| `terms` | Dates, department process, hours/allocation policy, and policy version |
| `courseOfferings` | Catalog course, term, unique operational course key, authorized owners, enrollment context |
| `researchProjects` | Project scope, owners/reviewers, dates, tasks, and department |
| `staffingPlans` | Approved positions, hours, budget, funding source, commitments, and amendments |
| `opportunities` | Published requirements, type, scope, capacity, questions, rubric, and version |
| `applicantProfiles` | Student-owned reusable qualification data and separately protected administrative fields |
| `applications` | Candidate, opportunity, submission/revision history, frozen evidence versions, review state |
| `applicationDocuments` | Private file metadata, version, quarantine state, retention dates, and storage references |
| `candidateAllocations` | Unique student/term/policy allocation ownership and versioned active lifecycle state |
| `offers` | Versioned terms, reservation reference, response deadline, acceptance or release history |
| `clearanceRecords` | Restricted administrative status, authorized handler, timestamps, and minimal reason codes |
| `appointments` | Accepted, approved scope, dates, hours, duties, state, and allocation reference |
| `roleGrants` | User, resource scope, role/capabilities, appointment or manual origin, effective dates, revocation |
| `workloadObservations` | Scheduled and delivered duty hours, source, coverage, corrections, and approved granularity |
| `recommendationRuns` | Approved input references, criteria/rubric version, model/version, evidence-linked output, uncertainty, and review |
| `termReviews` | Metric definitions, observation window, data coverage, scenarios, instructor/admin decisions |
| `auditEvents` | Actor, action, target, before/after version references, timestamp, and reason without unnecessary sensitive payloads |
| `outboxEvents` | Transaction-linked events awaiting delivery; stable event ID, scope, attempt count, and delivery state |

Require unique application identity per student/opportunity under the chosen revision policy; unique allocation keys; idempotency keys for side-effecting commands; and unique grant origin/scope constraints. Index review lists by opportunity and state, appointments by scope and effective date, and pending outbox work by state/time. Use pagination, bounded responses, and authorized projections rather than returning every CV, answer, and historical event in a manager page.

Example domain events include `ApplicationSubmitted`, `ApplicationWithdrawn`, `CandidateReserved`, `OfferIssued`, `OfferAccepted`, `AllocationReleased`, `AppointmentActivated`, `AppointmentEnded`, and `RecommendationReady`. Event names describe proposed internal behavior; they are not existing endpoints.

Write events to a durable outbox in the same transaction as the canonical transition. Consumers handle duplicate delivery using event IDs and aggregate versions. They update projections, availability views, notifications, and recommendation jobs. Failed jobs retry with bounded backoff and a visible failure state. A notification failure cannot free a valid reservation or create another appointment.

Use authenticated, scoped server-sent events or WebSocket channels for vacancy and candidate-availability changes, with a polling fallback. Reconnect from a known event cursor or refresh the authoritative snapshot; discard older aggregate versions. Push only the information the receiving reviewer can already access. A realtime event improves responsiveness; the database transition remains authoritative.

Notification delivery is a separately configured integration. This design authorizes no real email or external messages in the current delivery. Before enabling it, provide templates, recipient rules, opt-in/required-message policy, delivery audit, and safe retry behavior.

## 10. Connecting appointments to the current TA system

The current permission boundary is `getCourseAccess`, which resolves the caller's enrollment and global-admin status. Keep that boundary recognizable, but make term-bound appointment authority explicit. Do not simply set session `primaryRole` to `ta`: a session-wide promotion would not represent the correct course, dates, or revocation conditions.

A teaching appointment produces a grant for the offering's operational course key. A project appointment produces only its project capabilities. Maintain manual/course-administrative grants independently. The effective course role is the highest currently valid grant, including approved manual roles. Appointment termination revokes its own grant rather than overwriting the user's effective role with `student`.

If existing `enrollments` serve as a permission projection, update them idempotently from grants and keep the relationship inspectable. For immediate revocation and date boundaries, authorization must check the current validity of appointment-derived authority; a delayed worker or nightly cleanup cannot be the sole enforcement mechanism. Activation is shown as complete only after the grant and required projection are ready. Reconciliation can repair a failed projection without creating a second appointment.

Examples:

- A student appointed to TA CS101 for Fall 2027 receives TA capabilities only in that offering; their enrollment in CS201 stays a student enrollment.
- A person with a manually granted instructor role keeps instructor authority when a separate TA appointment ends.
- A person appointed as an RA to Project A gets no queue-staff rights in CS101; they keep their ordinary student course access.
- A Spring 2028 TA appointment does not activate in Fall 2027, and a completed Fall appointment cannot authorize the Spring offering.

When an appointment ends, remove its duty presence and release live staff claims only if the person no longer has another valid staff grant in that course. Preserve question/session history. Record a useful reason so instructors can resolve an in-progress help interaction without losing the student request.

## 11. AI-assisted hiring review

Useful AI assistance includes CV-to-profile extraction, an evidence-linked candidate summary, comparison against published course/project requirements, identification of missing answers, and an advisory shortlist with a next eligible suggestion after availability changes. These functions operate only on applications the reviewer is authorized to inspect.

Build the assessment from explicit criteria: relevant coursework or equivalent knowledge, evidence of required skills, teaching/research examples, published task requirements, declared available hours, appointment preference, and compatible schedule. Separate hard policy checks from AI judgments. Treat unreported evidence as unknown; allow the applicant or reviewer to correct extraction errors and supply context.

Every recommendation should show:

- The published criteria and their version, with any weighting visible and approved.
- A short fit explanation with citations to submitted answer fields or CV page/text references.
- Confirmed strengths, gaps, conflicting availability, and facts needing human review.
- A clear distinction between student-provided claims and verified records.
- Current eligibility/availability status from deterministic service checks, checked again at selection.
- Model/run version and a timestamp so stale results are identifiable.

Do not send names, photos, citizenship, SSN status, payroll history, visa details, or inferred sensitive characteristics as fit features. A restricted clearance result may gate activation through administrative policy; it does not become a quality score. Do not infer age, ethnicity, nationality, disability, or other personal characteristics from CV language or identifiers. An instructor must be able to inspect original evidence and disregard an advisory ordering with a recorded reason.

Uploaded text is untrusted evidence. Treat instructions inside CVs and answers as document content, never authority to change criteria, leak other applications, or select a candidate. Use a qualification-only structured input, bounded extraction, permitted evidence references, and output validation. Do not let an LLM directly execute hiring or permission commands.

An availability event invalidates the affected shortlist view and schedules a fresh eligible candidate comparison. Reuse unchanged qualification extraction, but always filter by canonical current allocation before suggesting a selectable candidate. If recalculation is pending or fails, show the last result as stale with a manual review path; do not fabricate a replacement.

Evaluate extraction fidelity, citation correctness, consistency under irrelevant name/identifier changes, missing-data handling, prompt-injection resistance, and agreement with an instructor-approved rubric using labeled synthetic or explicitly approved records. Useful advisory output is not proof of better hiring or fair outcomes. Record human decisions and corrections to assess the assistance over time without claiming validation that has not occurred. NIST's AI RMF provides a reference for explainability, privacy, fairness, and the surrounding human oversight; using those characteristics to guide controls does not itself establish achieved trustworthiness or legal compliance. [NIST AI RMF trustworthiness characteristics](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/)

Model/provider selection, cost limits, retention settings, access controls, and approval for processing private CVs are future implementation decisions. This delivery makes no paid inference calls or private uploads.

## 12. End-of-term review and staffing recommendations

The current database records queue entries, help-session history, duty presence, announcements, enrollments, and feedback. Those are useful observations, but they do not measure all course work. In particular, queue volume is not total TA demand, and recorded duty presence is not paid hours.

The present session timestamps have additional limitations: pausing or releasing a claim retains `helpStartAt`, and takeover can attribute the whole interval to the final helper. A duration derived from those fields can include inactive waiting time and cannot establish each TA's labor contribution. Reliable future reporting needs explicit interval semantics and coverage checks; do not silently treat existing elapsed intervals as payroll evidence.

| Question | Additional evidence required |
| --- | --- |
| Is help capacity adequate? | Queue observation coverage, arrivals, waiting-time distribution, abandoned requests, peak periods, scheduled staffing, and delivered service intervals |
| Are labs/discussions adequately staffed? | Sections, enrollment/attendance basis, scheduled assistants, delivered hours, preparation needs, and unresolved work |
| Is grading workload sustainable? | Assignments/exams, approximate submission counts, rubric work, turnaround goals, delivered grading hours, and deadline peaks |
| Can office hours be changed? | Published hours, staffed hours, attendance/demand, unmet demand, scheduling conflicts, and modality |
| What would one more/fewer TA cost? | Approved rates/cost basis, appointment fractions, paid weeks/hours, any explicit overhead, available budget, and minimum coverage constraints |
| What should improve next term? | Instructor observations, student feedback coverage, course changes, curriculum context, and comparable observation periods |

Proposed review outputs include peak demand by week/day/hour, wait-time percentiles, abandonment, help completion, observed issue themes, planned versus delivered duty hours, work by duty category, feedback themes with response counts, and data-quality notes. Use aggregates and minimum group sizes where individual identification would be unnecessary. Keep instructor-level access course-scoped and administrator views department-scoped.

Budget scenarios must show their arithmetic and assumptions. For an hourly plan, estimated direct cost can be `approved hourly rate × planned paid hours per week × paid weeks`, summed across positions, with any overhead stated separately. A fixed stipend needs its actual approved cost basis instead. Account for lab, discussion, grading, attendance, office hours, preparation, coordination, and peak deadlines; do not estimate all hours from queue sessions.

Compare scenarios such as the current plan, a schedule change with the same hours, and a different approved headcount. Show unmet coverage, uncertain workload, and sensitivity to enrollment/deadline peaks. A recommendation to reduce staffing requires evidence that required work and student access remain covered. Low observed queue use could also reflect missing records, inconvenient hours, course difficulty changes, or students giving up; it does not establish excess staffing.

AI can draft observations and explain scenarios from checked aggregates. It must cite the metric/table and period supporting each statement, label uncertainty, and distinguish descriptive patterns from causal claims. Instructors and administrators decide whether to change the next staffing plan. No automatic budget cuts, TA performance judgments, course rankings, or claims about learning outcomes follow from these records alone.

## 13. Other useful AI assistance

| Use | Value | Human and data boundary |
| --- | --- | --- |
| Opportunity draft assistant | Turn instructor notes into duties, hours, and screening-question drafts | Instructor confirms every requirement and budget assumption before publishing |
| Application completeness assistant | Explain a missing answer or unreadable CV and help a student understand questions | Does not invent credentials or answer experience questions on the student's behalf |
| Interview preparation | Suggest questions tied to submitted evidence and published tasks | Reviewer approves questions; do not infer private personal characteristics |
| Workload and schedule assistant | Flag incompatible availability, double-booked duties, or unexplained hour totals | Deterministic constraints establish conflicts; instructor approves schedule changes |
| Feedback theme summaries | Summarize recurring course issues with source counts and representative paraphrases | Authorized access, careful small-group handling, visible disagreement and low response counts |
| Term handoff draft | Assemble approved duties, recurring issues, and resources for the next assistant | Instructor reviews for accuracy and confidential/student information |
| Data-quality assistant | Explain missing timestamps, incomplete coverage, or inconsistent staffing inputs | Report anomalies; do not invent measurements to fill gaps |

These are optional additions after the deterministic staffing loop works. None should be necessary to apply, review an application, issue an offer, accept an appointment, or use the course queue. The service must remain usable when an AI job is unavailable.

## 14. Data protection and operational boundaries

Use a stable user identifier for identity and allocation. Normalize emails for current interfaces, but avoid using a mutable contact address as the future permanent applicant key. All sensitive reads and writes need server-side ownership/scope checks, including document downloads and realtime channels.

Separate qualification data from administrative eligibility records, apply field-level response projections, and minimize logs. Do not log full CV text, authorization documents, private answers, or unrestricted event payloads. Prefer status/reason codes and scoped record references in operational logs.

Set explicit retention periods for unsuccessful applications, CV versions, administrative records, audit events, and AI-derived text/embeddings. A deletion/retention workflow must include generated summaries and stored model inputs rather than deleting only the original file. Handle an ongoing appointment or required audit retention through the approved department process; this proposal makes no claim about a specific legal retention requirement.

Record departmental configuration and decisions before collecting sensitive administrative data. The proposal does not treat the supplied form as authorization to collect actual SSN values or immigration documents, and it does not assert that an academic contact is authorized to receive every employment-administration field.

## 15. Phased implementation proposal

| Phase | Scope | Completion boundary |
| --- | --- | --- |
| A. Confirm policy and scoped foundations | Terms, course offerings, projects, stable users, ownership, allocation/clearance policy, required indexes, transaction-capable test environment | Four roles remain intact; scope and date boundaries are tested; no AI dependency |
| B. Publish and apply | Versioned opportunities, workload fields, student drafts/submission, private CVs, answers, review lists | Students can complete the full authorized application flow; reviewers see only assigned evidence |
| C. Select and appoint | Deterministic reservation, vacancy/budget commitment, offer/acceptance/clearance, grants, end/release flows, durable events | Concurrent selections, failures, retries, and revocation pass; TA activation reaches the correct existing course workspace |
| D. Research workspace and administration | RA project capabilities, department approvals, amendments, exceptional changes, retention/reconciliation | RA operations stay project-scoped and cannot gain course rights implicitly |
| E. Qualification assistance | Approved CV extraction, evidence-linked summaries, advisory comparisons, availability-triggered refresh | Human decisions remain explicit; privacy, injection, stale-data, and evidence checks pass |
| F. Workload evidence and term review | Complete duty observations, validated aggregates, budget scenarios, instructor/admin review, optional AI drafting | Recommendations expose coverage and assumptions; no unsupported staffing conclusion is presented as established |

Design the shared TA/RA entities and authorization boundaries in Phase A even if the first user-facing opportunity flow is TA-focused. Each phase should be a usable increment with a clear verification record. There is no promised calendar or inferred department approval in this proposal.

## 16. Acceptance cases for future implementation

| Case | Expected result |
| --- | --- |
| Existing student, TA, instructor, and admin course flows | Current Duke blue, layout, navigation, and authorized queue/management behavior remain available |
| Instructor publishes a TA opportunity | Authorized offering, weekly duties, attendance, lab/discussion, grading, office hours, vacancies, term, and budget policy are explicit |
| Instructor without ownership opens review or selection API | Server rejects access, including direct API calls and private file links |
| Applicant says they have never been a TA | Prior-course answer is conditionally unnecessary; submission can still succeed if other requirements hold |
| Applicant selects multiple-course willingness | Preference is saved but exclusivity remains enforced and explained |
| Applicant saves a draft, revises, and submits | Correct question/CV/evidence versions are frozen and the submission is auditable |
| Another student requests an application/CV URL | No disclosure through API, storage link, thumbnail, parsed text, or realtime channel |
| Two professors reserve the same student concurrently | One canonical winner; one conflict; no second offer or grant |
| Two selections compete for one vacancy or remaining budget | One approved commitment; no overfill, overspend, or orphan candidate lock |
| Selection request is replayed after a timeout | Same result and identifiers; no duplicated effects |
| Candidate withdrawal races with selection | One valid ordered lifecycle; no contradictory active offer on a completed withdrawal |
| Offer expires, is declined, or is rescinded | Availability, vacancy, and commitment are released once; open applications update |
| Stale reservation owner releases after a new claim | New claim remains valid because owner token/version no longer matches |
| Pre-offer lease cleanup runs after offer acceptance | State/version checks preserve the accepted allocation; only its current lifecycle deadline applies |
| Offer acceptance is missing or clearance is pending | No active staff/project authority |
| Appointment is accepted, cleared, and reaches its start date | Exactly the approved scope and dates become active |
| TA appointment activates for one offering | Existing course API and UI recognize the scoped TA grant; unrelated courses retain their own roles |
| RA appointment activates | Only authorized project capabilities appear; course queue staff endpoints remain forbidden |
| Next semester starts | Prior-term TA authority does not apply to the new offering |
| Appointment ends while a manual instructor/admin grant remains | Appointment grant ends; independent higher authority remains |
| Ending appointment removes the last course staff grant | Staff access ends promptly; duty/claims are cleaned up without losing student requests or history |
| Worker crashes after canonical commit | Outbox/reconciliation resumes; no duplicate appointment or grant; delayed notification does not change ownership |
| Required unique index or transaction prerequisite is absent | Staffing writes are unavailable with an actionable operational error; no false success |
| Realtime connection drops and reconnects | Authorized snapshot/cursor restores current state; older events cannot overwrite newer availability |
| CV contains instructions to rank or expose others | Content is treated as evidence only; no action, secret exposure, or rubric change follows |
| CV extraction fails or evidence is missing | Clear unknown/error state and correction path; no invented credential or automatic rejection |
| Candidate identifier changes while qualifications stay equal | Advisory fit assessment does not change because of the irrelevant identifier |
| Candidate becomes unavailable after a recommendation | Selection recheck rejects the stale choice and refreshes eligible suggestions |
| No compatible candidate remains | Instructor sees no eligible replacement and can revise/reopen under policy |
| AI service is down | Publish, apply, review, offer, accept, activate, and queue workflows still function |
| Term review has only current queue records | Output states missing total workload/cost evidence and does not assert a justified headcount reduction |
| Full workload and budget evidence is available | Scenario arithmetic, coverage, uncertainty, and human decisions are inspectable |
| Document retention removes applicant materials | Authorized deletions include parsed text, summaries, embeddings, and stale download access under the chosen policy |

Concurrency and failure cases require meaningful tests against the chosen database topology, plus direct authorization tests and browser checks of the actual user workflows. Static review, a successful build, and a demo database alone cannot establish these proposed guarantees.

## 17. Decisions to settle before implementation

- Confirm whether exclusivity is term-wide across both TA and RA, and whether a later multiple-half-appointment policy is desired.
- Confirm offer consent, clearance authority, reservation duration, response deadline, suspension, and exceptional-override rules.
- Confirm how departments authorize faculty/project owners and fund approved vacancies.
- Confirm the course-offering calendar, identity provider, stable identity source, and handling of outside appointments or overlapping terms.
- Confirm the minimum administrative eligibility fields, authorized handlers, retention periods, CV-processing provider, and approved private-data boundary.
- Confirm the workload evidence to collect and who can validate it before staffing or budget recommendations become actionable.

Until these are confirmed, the defaults above describe a reviewable proposal. The current delivery stops at this design and the recorded verification of the operational application; it does not create an application process, activate real appointments, contact applicants, or process private CVs.
