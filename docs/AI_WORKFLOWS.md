# CampusWorks AI workflows

All four advisory tasks run in the background when the provider is configured. Opening a page reads results; it does not start a paid request. The [verification report](VERIFICATION.md) and [sanitized provider receipt](verification/ai-browser-proof.json) record executed checks and their source digest.

| Business step | Result location | Automatic trigger | Advisory output |
| --- | --- | --- | --- |
| Prepare requirements | Saved position review | A position is saved or its requirements change | Concise wording and qualification-question suggestions; the saved position is not edited automatically |
| Read applications | Application detail | An application is submitted or its reviewed qualifications change | Evidence-linked qualifications and missing information |
| Compare candidates | Position review | Submitted candidate evidence or eligibility/availability changes, including another teacher's selection | A comparison for each currently eligible candidate in the page, with evidence references |
| Review course staffing | Course review | Checked course/semester aggregates change; a final review becomes due at the semester end | Course improvements, evidence gaps and conditional staffing/budget scenarios |

Recruitment starts from the course-list home page. Only current instructors and administrators manage hiring. RA owners must retain instructional authority. A TA identity alone confers no hiring authority. RA remains an application and appointment type without a research workspace or queue grant.

## Shared results and background execution

Persistent jobs are scoped to a resource, task kind, semester and candidate page. Authorized managers share the same automatic result instead of purchasing separate results for each viewer. The worker reconstructs current account/provider bindings and management authority before calling the provider and again before publishing. An authorized peer can take over when a manager loses authority. With no valid manager, the task stops.

Discovery uses a persistent round-robin cursor across task types and subsequent candidate pages. Discovery continues while a provider response is pending. Leases and generations fence overlapping instances and abandoned workers. Duplicate hints and unchanged evidence reuse the current result. Changed evidence invalidates it and schedules current work. Failures back off; daily budget exhaustion waits until the next UTC day. Ordinary page reads never retry model work themselves.

Automatic candidate pages contain up to ten eligible candidates by default. Every supplied candidate must receive exactly one valid explanation. Coverage identifies the page, inspected/submitted/compared counts and remaining pages. A page does not establish the best applicant across the entire pool. Large automatic inputs may use explicitly marked text excerpts, retaining every candidate, reference and complete-source hash; the result then warns that reviewers must inspect the full application. Inputs that still exceed the limit stop without a provider purchase until evidence changes.

Candidate responses request short explanations and one or two exact references per person, including that person's own application evidence. Existing coverage and citation checks remain mandatory. A provider `finish_reason` of `length` is rejected as an output-limit failure. Stored failure categories distinguish JSON, references, coverage and response bounds without keeping provider error text. The completion signal is documented in the [official OpenAI API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Course previews coalesce changing observations with a fifteen-minute default cooldown. Semester end changes the review phase to final and bypasses that preview cooldown. Both previews and final advice use checked, dated aggregates. A missing provider disables AI without blocking deterministic staffing work.

Automatic output caps are 900 tokens for qualification summaries, 1,200 for requirement suggestions, 1,800 for course advice and 2,500 for a candidate page. Reservations use the actual task cap plus the conservative input-byte allowance. The per-account and global daily limits are unchanged; a populated demonstration can queue less prominent work for later capacity. Ordinary manual API requests retain the 2,500-token maximum.

## Decisions and appointment authority

Selection, offer acceptance, clearance, settlement, suspension/end and deletion remain explicit human commands. Their existing transactions reserve the candidate, vacancy and financial commitment. Another teacher cannot reserve that person for an overlapping appointment. Automatic comparisons then exclude that applicant and update the available candidates. Acceptance, clearance and the effective appointment start still precede TA course authority.

Timed offer expiry, cleared appointment activation, appointment end and in-app notification delivery have an independent persistent maintenance worker. They run without an AI provider or an open browser. Date-valid authorization also checks expiry directly. The worker never chooses a hire, accepts an offer, approves clearance or settles a cost.

At position end, new candidate comparisons and application summaries stop. Authorized history keeps its original date and evidence; settlement and course reviews remain available. Revoked managers lose access to cached results as well as new analysis.

## Verification and limits

The maintained [headless provider harness](../scripts/ai-provider-browser-check.mjs) uses only synthetic records and the production OpenAI adapter. It checks unattended generation before opening a browser, all four result panels, shared candidate updates after manual selection, competing selection refusal, final semester advice, ended-position history and cleanup. It reserves at most fourteen calls, allowing twelve expected successful tasks and bounded retry headroom. The Key is loaded only through the saved encrypted Windows configuration and the application child environment.

The current sanitized receipt records actual outcomes; the earlier [five-request receipt](verification/ai-provider-proof.json) remains historical. Controlled loopback providers exercise timeout, malformed output, quota, revoked authority, stale publication, restart and lease cases. Finite synthetic tests do not establish real hiring accuracy, fairness or production scale.

The final automatic workflow check completed twelve `gpt-5.4-mini` tasks in twelve reserved requests: nine unattended initial results, two updated candidate comparisons after manual selection and one final semester review. Both teachers read the same shared position result. Browser analysis POSTs, runtime errors and remaining concurrency leases were zero; competing selection returned 409 and cleanup completed.

PDF/TXT attachments remain private download records. Their bytes are not parsed or sent to the model. Entered qualification fields, screened answers and background text supply evidence; administrative records are excluded. Free-text filtering is defensive and does not guarantee complete anonymization. Queue observations and submitted work do not establish total paid hours or authorize automatic staffing cuts.
