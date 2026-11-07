# CampusWorks product readiness

Reviewed November 7, 2026. This assessment combines current source behavior, local acceptance evidence and official institutional references. It does not establish institutional approval, production reliability, hiring accuracy or a procurement commitment.

## Product fit

The most credible first deployment is a single Computer Science department using CampusWorks for TA/RA recruitment and course support operations. The connected appointment and course-permission boundary is the central value: a staffing decision becomes an accepted, cleared, dated appointment, which governs the existing TA queue. Queue, feedback, reported work and budget evidence then inform the following staffing cycle.

This is a product assessment, not demonstrated market demand. Validate it with a faculty sponsor, the graduate program coordinator and the service owner before promising adoption or savings. The current application is one operational instance with site-wide administration. It is not a tested multi-institution service or an institutional personnel/payroll system.

Dated appointment checks govern appointment-derived access. Independently granted course roles remain available under the confirmed operating policy. A TA badge alone therefore does not establish administrative clearance, a paid appointment or external employment eligibility; the pilot's operating process must preserve that distinction.

## Improvements implemented in this delivery

| Finding | Result |
| --- | --- |
| TA positions could publish a research duty that TA workload records cannot represent | The server rejects research duties for TA positions; existing RA API compatibility remains |
| Browser number inputs rejected server-valid fractional hours | Position and application inputs accept values such as 1.5 or 19.9; institutional work-limit policy is unchanged |
| A full or exhausted-budget position still offered an enabled Select action | The interface shows remaining positions and disables selection using the same capacity/budget rules as the server; server transactions remain authoritative |
| Course code/title separator rendered as a literal question mark | The public detail uses a middle dot |
| Mostly empty lists concealed the operational workflow | A guarded, repeatable showcase now includes distinct real API lifecycle states, labelled historical observations and coherent live queues |
| Rich lists were difficult to scan | True total-count cards, text-bearing status badges, compact notifications, clearer position cards and mobile layouts preserve the Duke blue system |
| Unordered workload groups changed identical course-report fingerprints | Work-category keys now have stable ordering, avoiding unnecessary model retries for unchanged evidence |
| Short automatic tasks reserved the same output allowance as a full candidate page | Summaries, requirement suggestions and course advice use smaller output caps; request and daily token budgets are unchanged |
| Sustained candidate updates could postpone other automatic advisory kinds | New and existing observation lanes now rotate task kinds persistently, independently of the event backlog |
| Real ten-person output failed while two-person output succeeded | Candidate instructions explicitly bound prose and reference counts and require each person's own citations; bounded failures receive safe diagnostic categories without storing provider text |
| The service-only presenter control channel could keep a cleaned-up launcher alive | Closing the owned service removes the message listener and disconnects its control channel |

## Decisions required before an institutional pilot

These are proposed product choices. They have not changed the confirmed operating policy.

| Priority | Concrete issue | Recommended choice | Alternative and tradeoff |
| --- | --- | --- | --- |
| P0 | One current recruitment semester also selects the default course-report semester. Opening spring recruitment during fall teaching can switch an ongoing course report to spring, while manual course membership has no semester boundary | Add semester-specific course offerings and connect appointments, membership, queue and reports to their offering; ordinary users still do not need a semester selector | Separate administrative teaching/recruiting contexts first; smaller change, but course membership still needs an explicit transition policy |
| P0 | Accepted offers omit an explicit support amount/model, while the current hourly values are budgeting inputs | Decide supported compensation models, then present a confirmed offer summary including duties, average hours, dates, financial support and the candidate's response | Keep the current pilot a staffing approval layer and retain a separate institution-approved offer document; disclose the boundary clearly |
| P0 | Weekly hours permit 0.25–40 and full/half labels have no institutional mapping | Confirm the participating student population and configure approved hour/preference rules for it | Keep general numerical limits for synthetic demonstrations; do not describe them as Duke eligibility rules |
| P0 | Identity, data processing and operational ownership have not been institutionally verified | Obtain a department sponsor, identity-app registration, approved data/provider route and named service owner before real applicant processing | Remain a synthetic demonstration until those owners are established |
| P1 | Work recording requires a currently active appointment, so genuine work cannot be entered after its operational end | Consider a bounded administrator-only correction window with reason/audit, keeping the original work-date limits and leaving TA access revoked | Keep a strict operational cutoff and require complete records before closeout; simpler but vulnerable to missing late grading records |
| P1 | Work-authorization expiry is administrative text, not an automated eligibility check | Keep clearance based on the institution's confirmed external process; consider an administrator follow-up reminder if requested | Do not automatically infer eligibility or terminate access from unverified text |
| P1 | Applicants repeat qualification/profile/CV input across opportunities | Add applicant-owned qualification prefill while retaining independent submitted snapshots and separate administrative information | Keep per-application entry for a small pilot; fewer data-linking rules but more applicant effort |
| P1 | Health checks cover database, transactions and indexes but not a full operational backlog view | Track worker delay, clearance queues, unfilled positions, unsettled commitments and AI capacity; establish backup/restore exercises | Begin with protected operational queries and a written runbook before building a dashboard |
| P1 | Default per-reviewer AI capacity is a cost guard, not a same-day service promise for a department | Agree a volume-based operating budget and response target before a pilot; monitor valid results, retries and queued work | Retain the current defaults and use deterministic workflows while advisory work waits; do not rotate identities to bypass limits |
| P1 | Structurally valid course advice can repeat aggregates rather than provide a useful action | Evaluate advice with faculty against a rubric: a concrete next-semester action, its evidence, a measure and the prerequisites for any staffing change | Keep short narrative advice as a demonstration, without claiming useful recommendations or staffing savings have been validated |

The existing prohibition on overlapping TA/RA commitments, including two half appointments, remains confirmed. No new department role, resignation workflow, document-extraction service, payroll integration, external messaging or research workspace is introduced by this review.

### Owner choices

| Choice | A | B |
| --- | --- | --- |
| Concurrent semesters | **Recommended:** semester-specific course offerings with automatic context | Separate administrative teaching and recruitment contexts first |
| Official offer | **Recommended for an initial pilot:** retain an approved external offer document and make the boundary explicit | Add approved compensation models and confirmed financial terms to the in-app offer |
| Late work corrections | **Recommended:** a bounded, administrator-only correction window with required reason and audit | Keep the current strict recording cutoff at appointment end |

Recommendation A for official offers keeps the pilot within its current staffing scope; a broader in-app offer model needs the institution's confirmed terms. These choices are proposals, not implemented policy.

## Institutional evidence and implications

The 2026–27 Graduate School bulletin sets a 19.9-hour limit for the described full-time graduate-student support/work population. A separate TA guide describes a semester-average limit of twenty hours. Their population and averaging rules must be resolved by the responsible department; the software should not silently substitute one universal ceiling. [Graduate Bulletin](https://graduateschool.bulletins.duke.edu/policies/financial/aid), [TA appointment guidance](https://gradschool.duke.edu/policies-forms/guidelines-and-policies-graduate-student-teaching-assistants-and-instructors/)

The CS master's financial-support page describes TA/RA support as stipend-only, without a tuition effect. That supports treating the current hourly cost calculation as a planning scenario until an approved offer model is selected. The same department page places opportunity communication with the Graduate Program Office, making a faculty/GPC-sponsored pilot a reasonable inference. [CS master's financial support](https://cs.duke.edu/graduate/ms/financial)

Duke's GitLab service supports Shibboleth/NetID sign-in. Registering and verifying the institutional GitLab OAuth application is therefore one possible way to use the existing adapter; it is not already verified. Direct institutional OIDC is another candidate route. Neither should be claimed as complete without actual account/attribute, callback, logout and access-revocation checks. [Duke GitLab](https://oit.duke.edu/service/gitlab/), [Authentication Manager](https://authentication.oit.duke.edu/manager/documentation)

Duke provides an AI Gateway for application developers. A successful personal OpenAI Key test using synthetic records does not establish approval to process real applicant materials. Confirm data classification, approved provider use and responsibility with the data owner before a real pilot; do not automatically replace the configured provider. [AI Gateway](https://oit.duke.edu/service/ai-gateway/), [Duke services and data classification](https://security.duke.edu/policies-procedures-and-standards/data-security/duke-services-and-data-classification/)

Institutional personnel and onboarding records exist outside CampusWorks. Administrative clearance should record confirmation of the relevant external process rather than claim to complete it. [Department personnel records](https://hr.duke.edu/managers/manage-lead/department-personnel-files/)

## Pilot sequence

1. Demonstrate the existing four-role workflow with synthetic records and visible provenance. Show competing selections and automatic course access, not only an AI ranking screen.
2. Resolve semester context, offer terms, approved work limits, identity, data/provider handling and service ownership. Preserve the agreed manual decisions.
3. Run a limited, department-sponsored pilot with three to five courses and an explicit period. Establish expected response times and a fallback operating process with the people running it.
4. Compare measured outcomes with the department's own baseline before expanding courses or making staffing claims.

## Measures that can test product value

| Question | Useful measure | Limitation |
| --- | --- | --- |
| Does recruitment save coordination time? | Reviewer elapsed time, application completeness, time to fill and declined/expired offer rate | Requires a measured baseline and participant feedback |
| Does the appointment bridge reduce access mistakes? | Accepted-to-cleared time, effective access delay, revoked-access checks, duplicate live allocation count | Local tests do not establish hosted failure rates |
| Does support become easier to operate? | Weekly queue P90, recorded coverage, help/abandonment patterns and category-specific workload | Office-hours use does not measure all teaching work |
| Are administrators able to close the cycle? | Clearance backlog, notification age, outstanding settlements and completed closeouts | These are workflow records, not institutional payroll validation |
| Is AI useful and affordable? | Valid-result rate, stale-result rejection, reuse, latency, budget blocks and reviewer usefulness | Structural validity is not hiring accuracy or fairness |

The best next product investment is semester context and complete appointment terms. Additional AI output should follow dependable evidence and workflow ownership, rather than substitute for those foundations.
