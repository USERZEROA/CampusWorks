# CampusWorks implementation and verification plan

## Delivery scope

1. Resolve the findings in the application review: queue concurrency, durable history, role/duty authority, revocable sessions, strict validation, pagination, data boundaries, accessibility, timing, and dependency advisories.
2. Build TA applications with a shared TA/RA foundation, instructor opportunity requirements, private CVs and answers, candidate review, collision-safe offers, consent/clearance, dated appointments, and automatic scoped access to the existing queue.
3. Provide optional AI assistance with explicit configuration-required states and validated, qualification-only evidence. Verify current browser workflows through capped real OpenAI requests using synthetic records, and use loopback providers for controlled failures and races.
4. Preserve the four roles and Duke blue visual system; improve keyboard access, dialogs, labels, feedback, and mobile usability.
5. Commit each coherent feature with a single English sentence. Work locally without GitHub Actions, remote pushes, or publication.
6. Review the final application line by line; fix confirmed defects and report policy choices separately for the owner.
7. Run extensive local API, transaction/concurrency, browser E2E, keyboard, and automated accessibility checks; inspect actual rendered journeys and retain reproducible evidence.

## Implementation defaults

- MongoDB transactions are mandatory. Local environments use a single-node replica set; unsupported database topology fails readiness with an actionable message.
- A candidate may apply to multiple opportunities. Only one reserved/offered/accepted/active TA or RA allocation per term is permitted by default; the first committed selection wins.
- Selection reserves a vacancy. Candidate acceptance and explicit administrative clearance precede dated operational authority.
- TA grants apply only to the appointed course. RA appointments grant no course authority or project workspace. Manual instructor/admin authority is preserved when an appointment ends.
- AI remains advisory and optional. Candidate availability, deadlines, position capacity, budgets, permissions, and activation are deterministic service decisions.
- Payroll, SSN numbers, citizenship, and immigration documents do not enter qualification review or AI fit inputs.
- Removing a student blocks re-enrollment and queue use in that course until an authorized manager explicitly restores access. Restoration does not enroll the student.
- After clearance, a site administrator may correct administrative fields with a required reason and private before/after audit. Correction alone changes no appointment status.
- Appointment end stops new candidate analyses and automatic comparisons while preserving authorized historical results, settlement and course reviews.

## Verification coverage

- Transaction rollback and retries; concurrent joins/close, assignments/order, demotion, completion, selection/withdrawal, final vacancy, duplicate/replayed commands, expiry/acceptance, and privilege revocation.
- Four-role API authorization, cross-course/RA-owner/application/CV boundaries, copied-session logout revocation, malformed inputs, origin/body/rate controls, and required indexes.
- Actual browser publish/apply/upload/review/select/accept/clearance/queue/end flows, keyboard dialogs, focus restoration, accessible names, mobile/desktop layout, CSV, reporting, and configuration-required AI behavior.
- Clean dependency installation and audit, type checks, Windows and container production builds, local multi-instance checks, and a complete final findings record.

## Review follow-up

The confirmed owner choices are recorded in [PRODUCT_POLICY.md](PRODUCT_POLICY.md). Report any additional business rule needing a decision separately from technical fixes. Real institutional SSO, employment eligibility integrations, external expense validation and production operating policy require evidence outside local verification.
