# CampusWorks project pitch

Audience: a project showcase. Lead with the connected product journey, visible user outcomes and an achievable pilot. Use the [offline presentation gallery](demo/index.html) alongside the live app; the [demonstration guide](DEMO_GUIDE.md) contains launch commands and role accounts.

For an unattended presentation, the [automatic six-window lifecycle](AUTOMATED_DEMO.md) follows Alex from student applicant to appointed CS201 TA, course work, access removal and department review, then repeats from a restored isolated baseline. Its actor and dataset are separate from Avery's manual rehearsal below.

That default 38-step loop includes five fresh OpenAI responses across requirements, qualifications, two current candidate comparisons and course advice. Allow about five minutes plus provider latency; show the generating state while a request runs. Normal request/token/concurrency guards survive restoration in a shared usage ledger. `--without-ai` explicitly selects a separate 33-step deterministic test mode.

## Product message

**From application to appointment to student support.**

CampusWorks connects TA/RA recruitment, accepted and cleared appointments, dated TA course access, queue operations and evidence for the next staffing cycle. Four familiar roles share the workflow: student, TA, instructor and administrator. RA remains a recruitment and appointment type; TA appointments connect to course queues.

| Value to demonstrate                 | Visible proof                                                                                       | Pilot measure                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Clearer recruitment coordination     | Published duties, private application snapshots and explicit decision states                        | Reviewer time, incomplete applications and time to fill        |
| Reliable transition into course work | A candidate accepts, an administrator records clearance, and dated TA access becomes available      | Clearance delay, access delay and incorrect-access incidents   |
| Evidence for the next staffing cycle | Department/course insights connect demand, attributed feedback, reported work and staffing coverage | Observation coverage, queue P90 and faculty usefulness ratings |

These are value propositions and proposed measures. No customer adoption, saved time, staffing reduction or other operational benefit has been established.

## Opening: 30 seconds

> A staffing decision is only the beginning of the work. The candidate still needs to accept, complete clearance and receive the right course access. Then the department needs to understand what that support actually delivered. CampusWorks connects those steps: recruitment, appointment, student support and the evidence for the next cycle. I will show that journey through one applicant, Avery, with people retaining the hiring and administrative decisions.

## Five-minute stage sequence

| Time      | Screen and action                                                                                                                                             | Line to land                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:30 | Open the gallery's product overview, then start its presentation                                                                                              | "One connected journey, from an application to the work it enables."                                                                        |
| 0:30-1:00 | Show a populated TA/RA position list and one course's duties                                                                                                  | "Faculty define the actual work: hours, attendance, lab/discussion, grading and office hours."                                              |
| 1:00-1:35 | Show the candidate-review example and its real OpenAI panel                                                                                                   | "The reviewer sees qualification evidence and gaps. A person makes the decision."                                                           |
| 1:35-2:50 | In Avery's window, open the Data Structures application and accept its prepared offer. In the administrator window, record Avery's clearance. Return to Avery | "An offer is not course access. Acceptance, clearance and the appointment dates connect the two."                                           |
| 2:50-3:30 | Avery opens the TA queue for CS201, starts duty and selects a waiting student                                                                                 | "The same person now has the right course tools, without a second account or manual appointment-role setup."                                |
| 3:30-4:20 | Open department Course insights, focus one course, then show the separately saved real AI course-review panel                                                 | "The next staffing discussion can use recorded demand, reported work and commitments, with sample sizes and evidence gaps visible."         |
| 4:20-5:00 | Return to the overview and state the pilot request                                                                                                            | "The next step is a department-sponsored pilot with three to five courses and one recruitment cycle, measured against the team's baseline." |

The workflow captures follow Avery's prepared CS201 appointment. The four actual AI panels follow Alex's separate automatic presentation: CS201 requirements, Alex's qualification summary, CS101's eligible alternatives after Alex receives a CS201 offer, and CS201 course advice. Introduce the change of scenario; historical observations are not work either applicant just performed.

For the live dashboard, use the administrator's **Course insights** entry on Home. Contrast the department view with an instructor's own-course scope. Show busy-hour patterns and a helper's feedback count beside the score; the [insights guide](COURSE_INSIGHTS.md) explains which observations can support that display. The unattended version uses 38 visible steps, including five fresh OpenAI responses and ends with this department view before restoring its isolated baseline.

## Keep one applicant throughout the live transition

Avery Chen is `student2@example.com` in the **Student Applications** window. Avery begins with seven applications and one existing offer for **Data Structures TA**. State that the offer was prepared before the demonstration; the live sequence begins with the candidate's response.

1. Open the Data Structures application using **Open application**. Choose **Accept offer** and show **Pending clearance**.
2. Switch to **Administrator**, at `/admin/staffing`. In **Appointment Clearance**, find Avery, select **Cleared** and click **Record clearance**.
3. Return to Avery's application. Wait for the automatic update to **Active**, then choose **Open TA Queue**. The route is `/courses/cs201/ta`.
4. Start duty. Select Noah Brooks's waiting request. The row's action changes to **Complete**, showing that Avery now owns the help session. Complete it if time permits.

This is the same person and appointment throughout. The separate **TA Queue** window belongs to Robin Parker in CS101 and is an additional operations example, not Avery's identity.

The maintained `playwright/e2e/showcase-flow.spec.ts` exercises this transition. The manual rehearsal begins with its prepared offer; the automatic presentation separately drives a new application and offer.

## Optional 60-second allocation example

Use this after the main story or in questions. Label it as a separate example involving **Maya Patel**, not Avery.

1. In **Instructor Selection**, select Maya for the programming position.
2. In **Second Instructor**, show that Maya is no longer available for an overlapping appointment in the other course.
3. Explain that the first committed decision reserves the candidate and vacancy. Current AI comparisons update when provider capacity is available.

The deterministic availability change is the live proof. Keep the saved, genuinely generated AI panel available while background work is pending. Do not wait on stage for a model request or describe a saved screenshot as a new live response.

## Ninety-second version

| Time      | Focus                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- |
| 0:00-0:20 | State the coordination problem and connected product message                             |
| 0:20-0:55 | Use the gallery to show recruitment, clearance and the TA queue as a single role journey |
| 0:55-1:15 | Show the real candidate-assistance and course-review panels, retaining human decisions   |
| 1:15-1:30 | Ask for a small sponsored pilot and name the measures that would establish value         |

For this short version, use captured screens as illustrations rather than claiming to execute the whole appointment transition live.

## Stage preparation and fallback

- Prepare the dataset and current AI results before presenting. Use the guide's warmup command and check that the featured results are current.
- Keep the overview, Avery, administrator and queue views ready. Maximize one window at a time. Use large, legible screen regions instead of six small windows on a projector.
- Keep the [offline gallery](demo/index.html) open as the fallback. Its eleven workflow captures and four actual OpenAI panels have separate provenance labels. Every person and business record is synthetic.
- Rehearsing acceptance, clearance or selection changes the saved dataset. Use `--fresh` for another clean rehearsal; ordinary restarts preserve completed decisions.
- If a model result is queued or connectivity fails, present the saved result with its capture label and continue the deterministic workflow.

The offline fallback is for this manual pitch. The automatic live-AI loop requires fresh responses for its current records and stops on a failed or timed-out model step.

## Evidence and evaluator questions

| Question                                          | Grounded response                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the product's main distinction?           | Demonstrate the connection from a staffing decision to dated course authority and support evidence. Evaluate alternatives with the pilot sponsor before claiming competitive uniqueness.                                                                                           |
| What does AI do?                                  | Requirements assistance, qualification summaries, candidate-page comparisons and course advice. It does not select a hire or approve clearance. Private CV file bytes are not parsed; typed qualifications and screened answers supply evidence.                                   |
| Is this used by Duke or real departments?         | Institutional adoption has not been established. The demonstration uses synthetic records and illustrative courses/dates.                                                                                                                                                          |
| Does this establish the required TA headcount?    | Required headcount has not been measured. Recorded queue use does not establish the full lab, grading or teaching workload. The pilot needs a baseline and validated coverage.                                                                                                     |
| What has actually been tested?                    | Use the dated verification report for executed application, unit, browser, real-provider and accessibility checks. Dashboard and demonstration evidence retain their own scope and source version. Local results do not establish institutional SSO or hosted-production behavior. |
| Does a helper's score establish teaching quality? | No. Only explicitly selected, completed-session feedback contributes to that helper. Show ratings, distinct students, days and the limited-sample label. These observations support a conversation, not an automatic employment decision.                                          |
| Who would start using it?                         | A department coordinator, faculty sponsor and service owner could sponsor the first three-to-five-course pilot. Students and TAs participate through the same four-role workflow. This is a proposed pilot, not a confirmed deployment.                                            |
| What is the business model?                       | Procurement, pricing and demand remain unvalidated. Establish the department's problem, responsible service owner and pilot outcomes before proposing a commercial commitment.                                                                                                     |
| What must happen before a real pilot?             | Resolve semester context and approved work limits, then confirm identity integration, data/provider approval and operating ownership. See [Product readiness](PRODUCT_READINESS.md).                                                                                               |

Use the [verification report](VERIFICATION.md) for technical questions. Counts such as 41 accounts, 21 positions and 68 applications describe the synthetic showcase, not customers, adoption or product impact.
