# CampusWorks AI workflows

AI currently participates in four steps. The current production build passed seven real OpenAI requests using synthetic records and headless browser interactions. The [sanitized receipt](verification/ai-browser-proof.json) records the model, source digest, task outcomes and cleanup without credentials or model output.

| Business step | Page and control | What AI does | Trigger |
| --- | --- | --- | --- |
| Prepare position requirements | Saved position review, `Draft requirements` | Suggest concise requirement wording and qualification questions using the position's existing description, skills, duties, hours and schedule | An authorized position manager clicks the button; suggestions do not automatically change the posting |
| Read an application | Application details, `Summarize application` | Summarize submitted qualifications, answers and entered background text; identify missing evidence | A teacher or administrator opens an application they manage and clicks the button |
| Compare candidates | Position review, `Analyze candidates` | Compare each eligible, available applicant on the current candidate page against the position requirements, with evidence references | The manager starts the first comparison; relevant later changes update that approved comparison automatically |
| Review a course and plan staffing | Course review, `Draft course review` | Use queue demand, waiting time, feedback, submitted work, requested/approved/committed/settled budgets and evidence gaps to suggest improvements and conditional staffing scenarios | An authorized course manager clicks the button; semester end does not automatically create a report |

Recruitment starts from the course-list home page. Hiring controls require current instructor or administrator authority. An RA owner must retain the required instructional authority. A TA identity alone does not confer hiring permissions.

The qualification-summary page is manager-facing. Its protected API also permits an applicant to summarize their own authorized record. Candidate summaries are blocked after position end; their API does not independently enforce every current-cycle visibility condition used by the page.

## Candidate updates and appointment authority

Once a manager starts a comparison, the subscription belongs to that manager, position and candidate-page scope. Submission, qualification/CV changes, withdrawal, review, selection, offer/appointment changes and course restriction/restoration can invalidate the comparison. Changed evidence or availability schedules a new analysis; unchanged evidence may reuse a completed result. Ordinary page polling only reads status.

Selection remains a human command. Its transaction reserves the person, vacancy and commitment. Another teacher cannot reserve that person for an overlapping appointment. Established comparisons then exclude the unavailable applicant and refresh the remaining candidates. Candidate acceptance, administrative clearance and the effective start date still precede TA course authority. AI cannot issue offers, grant roles or reduce budgets.

Comparisons are paged, normally up to fifty eligible candidates per request. The interface discloses coverage; a page comparison does not establish a global best applicant. Position end stops new comparisons and candidate summaries, while current permissions govern access to dated historical results. Settlement and course reviews remain available.

## Real API verification

The latest isolated run used `gpt-5.4-mini` through the production OpenAI adapter:

1. Browser-generated qualification summary, requirements suggestions and course review: three requests.
2. Two teachers each compared the same two synthetic applicants for separate courses: two requests.
3. The first teacher selected one applicant through the interface. Both comparisons automatically updated to the remaining applicant without another analysis click: two requests.

All seven results completed and passed evidence/schema checks. The competing selection returned 409. Position-end checks refused new candidate analysis without purchasing another call and retained authorized history. No browser runtime errors, unused concurrency leases or early TA authority remained. Temporary application processes and the synthetic database were removed.

The maintained harness is [ai-provider-browser-check.mjs](../scripts/ai-provider-browser-check.mjs). It requires the saved encrypted Windows configuration, a current production build and `AI_PROOF_MONGODB_URI` pointing to a dedicated loopback replica set. It caps requests at seven, runs headlessly and writes sanitized status to ignored local storage. The Key reaches only the application child environment. The database fixture is generated separately from real user data and removed after the run.

The earlier five-request [provider receipt](verification/ai-provider-proof.json) remains a historical check. Reproducible timeout, malformed-output, quota and race tests continue using loopback providers; the complete local acceptance results are in [VERIFICATION.md](VERIFICATION.md).

## Evidence limits

PDF/TXT attachments are saved privately and can be downloaded by authorized users. Their bytes are not parsed or sent to the model; entered qualification fields, screened answers and background text supply AI evidence. Administrative records are excluded. Free-text filtering is defensive and does not guarantee complete anonymization.

The synthetic outputs were inspected for relevant qualifications, missing evidence and appropriate course-report uncertainty. This verifies working integration and the exercised controls, not real hiring accuracy or fairness. Queue observations and submitted work do not prove total paid hours or justify an automatic staffing reduction.
