# CampusWorks demonstration

All people, application materials, appointments, workload, feedback and queue observations in this showcase are synthetic. Course names and dates are illustrative, not an official institutional catalog or calendar. The normal four roles, Duke blue, CS PNG and permission rules remain in use.

## Project showcase

Use the [five-minute product pitch](ROADSHOW.md) for a project presentation. It leads with product value, follows Avery from an existing offer into cleared TA course access and student support, then ends with the department's next-cycle review. The same document includes a ninety-second version, a clearly separate Maya allocation example and evaluator answers. The [offline gallery](demo/index.html) supplies the visual sequence and saved real AI panels.

## Prepare or open

For a hands-free six-window presentation, use the [automatic lifecycle demo](AUTOMATED_DEMO.md). It clicks through recruitment, the same applicant's TA appointment, course work and closeout, then restores its own data and repeats. Stop an existing manual showcase before starting that separate loop.

```sh
npm run demo:prepare
npm run demo:showcase
```

Preparation builds the current app, starts the existing local transaction-capable database, prepares a versioned dedicated database such as `campusworks_showcase_v5` and closes the temporary service. Later launches reuse the most recently prepared dataset for the current catalog version, including a fresh rehearsal. It opens no browser and makes no AI request. Existing `campusworks_interactive_demo` records are not changed. Earlier v4 datasets and their dated evidence are retained separately; new preparation does not change them to v5.

The second command builds the current app, opens six independent, signed-in windows and enables automatic AI if the saved encrypted Windows Key exists. The Key remains in the app child environment. Missing AI configuration leaves the deterministic workflows usable. Closing every window or pressing Ctrl+C stops services owned by this launch, retaining data.

```sh
# Create another independent dataset without deleting the previous one.
npm run demo:showcase -- --fresh

# Prepare current evidence-linked AI before a presentation, without opening windows.
npm run demo:showcase -- --prepare-only --warm-ai

# Open without reading a saved provider Key.
npm run demo:showcase -- --no-ai

# Keep only the local service open for a single-window presentation.
npm run demo:showcase -- --serve-only
```

Use `SHOWCASE_PORT` when local port 3100 is occupied. The local Compose database uses port 27017. `SHOWCASE_DATABASE` may select another name beginning `campusworks_showcase`; ordinary application databases are refused. An interrupted preparation requires a fresh dataset or explicit `--resume` before any manual changes. Completed preparation never replays later human decisions.

Dated states age normally. Use `--fresh` if the saved recruitment period or featured appointments have ended before a later presentation.

## Prepared coverage

| Area                    | Synthetic coverage                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People                  | 41 accounts: four faculty, four manually granted TAs, 32 students/applicants and one administrator; appointments provide additional dated course roles         |
| Courses                 | Ten courses with open, paused and closed queues and relevant announcements                                                                                     |
| Positions               | 21 TA/RA records including drafts, approvals, published and closed applications, filled positions, cancellation and archive                                    |
| Applications            | 68 records, including missing CV/answers, submitted, reviewed, shortlisted, declined/rescinded offer histories, accepted and cleared appointments              |
| Featured candidate pool | Twelve currently eligible people across two automatic comparison pages                                                                                         |
| Featured applicant      | Seven applications and exactly one outstanding offer                                                                                                           |
| Appointments            | Offered, clearance, future-start, active, suspended, ended, not-cleared and settled scenarios created through normal APIs                                      |
| Course evidence         | Thirty varied API-entered workload records, 380 dated help records with weekday office-hour peaks, eighty identified feedback records and eleven live requests |
| Feedback attribution    | Sixty synthetic ratings explicitly linked to completed same-student requests and recorded helpers; twenty course-level records remain separate                 |
| Notifications           | Genuine durable events delivered by the ordinary in-app outbox; no invented inbox messages                                                                     |
| AI                      | Real configured automatic jobs when enabled; no stored fake model output                                                                                       |

API-created decisions use the same transactions, capacity checks, private CV snapshots, clearance and dated course authority as the product. Dated queue/feedback observations are explicitly labelled fixture records because historical duration cannot be produced by waiting through a semester.

## Course insights

From Home, a site administrator opens **Course insights** for the department; instructors and course administrators see only their currently managed courses. Show daily demand, the Eastern weekday/hour heatmap, helper activity and attributed feedback beside reported work and conditional staffing costs. Date and course filters update silently. Course management embeds the same course-scoped view. Accounts with only TA or student authority have no dashboard entry.

Specific-helper feedback is optional: the student chooses a completed request and its actual helper. Course-level comments stay separate. Always show the rating count, distinct students and feedback days beside an average; a single new rating is **Limited feedback**. See [Course insights](COURSE_INSIGHTS.md) for the metric definitions and visible observation bands. These deterministic views do not make new AI calls or establish staffing savings.

## Six windows

| Window               | Account                          | Starting point                                            |
| -------------------- | -------------------------------- | --------------------------------------------------------- |
| Student Queue        | `student@example.com`            | A waiting request in the main course                      |
| TA Queue             | `ta@example.com`                 | Live claims, pauses and two on-duty helpers               |
| Instructor Selection | `instructor@example.com`         | The twelve-person eligible pool                           |
| Administrator        | `admin@example.com`              | Approval, clearance, future starts and financial closeout |
| Student Applications | `student2@example.com`           | Seven applications and a response-ready offer             |
| Second Instructor    | `faculty-algorithms@example.com` | A second course sharing candidate Maya Patel              |

Maximize the current window for presentation, then switch to the relevant role. Every window has an independent browser session. Recruitment entry remains on the course-list home page.

## Extended eight-minute walkthrough

For the primary project pitch, use the single-applicant sequence above. This extended operational walkthrough also includes a separate competing-selection example involving Maya, followed by Avery's prepared offer; make that change of person explicit.

| Time      | Action                                                             | What it demonstrates                                                                               |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Administrator opens Home and Recruitment                           | A coherent course/position portfolio with true totals and readable states                          |
| 0:45–1:30 | Student opens positions and their application list                 | TA/RA requirements, private materials, explicit application stages and an outstanding offer        |
| 1:30–3:00 | Instructor inspects the main candidate pool and selects Maya Patel | A human decision reserves the candidate, vacancy and commitment atomically                         |
| 3:00–3:45 | Switch to the second instructor                                    | Maya becomes unavailable there; current AI advice updates when provider capacity allows            |
| 3:45–5:15 | The featured applicant accepts; administrator records clearance    | Acceptance alone is insufficient; clearance and dates enable the correct course TA view            |
| 5:15–6:15 | TA works with the live queue                                       | Duty, claims, pauses, ordering and handoffs remain connected to course authority                   |
| 6:15–7:15 | Instructor opens Course review                                     | Queue demand, feedback, grading/lab/preparation work and financial scenarios are distinct evidence |
| 7:15–8:00 | Administrator inspects ended/unsettled and settled cases           | The workflow continues through access revocation and financial closeout                            |

The second instructor's shared candidate is `candidate-04` in the catalog, Maya Patel. The featured applicant is Avery Chen (`student2@example.com`). Avoid accepting offers or selecting extra candidates before the planned sequence; use `--fresh` for a clean rehearsal instead of manually changing database states.

## AI and interpretation

Prepare the whole dataset before enabling model work. This avoids purchasing analyses of intermediate applicant lists. The existing per-account/global request, token and concurrency budgets stay in force; a large catalog can leave less prominent work queued. Featured warmup uses authorized GETs to verify current results and never buys a request through page reads.

AI summaries use typed qualifications and approved answers. Private CV bytes are not parsed. Suggestions do not select applicants, approve clearance or cut budgets. A demonstration of low recorded queue use must not be presented as proof that a course can safely lose a TA.

Use the [synthetic CV](demo/materials/sample-cv.txt) when demonstrating an upload. The [offline gallery](demo/index.html) includes eleven workflow views and two actual OpenAI result panels. [Verification](VERIFICATION.md) records the executed checks and their limits; [Product readiness](PRODUCT_READINESS.md) lists pilot decisions and institutional boundaries.
