# CampusWorks project pitch

Audience: a project showcase. Lead with the connected product journey, visible user outcomes and an achievable pilot. Use the [offline presentation gallery](demo/index.html) alongside the live app; the [demonstration guide](DEMO_GUIDE.md) contains launch commands and role accounts.

## Product message

**From application to appointment to student support.**

CampusWorks connects TA/RA recruitment, accepted and cleared appointments, dated TA course access, queue operations and evidence for the next staffing cycle. Four familiar roles share the workflow: student, TA, instructor and administrator. RA remains a recruitment and appointment type; TA appointments connect to course queues.

| Value to demonstrate                 | Visible proof                                                                                  | Pilot measure                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Clearer recruitment coordination     | Published duties, private application snapshots and explicit decision states                   | Reviewer time, incomplete applications and time to fill        |
| Reliable transition into course work | A candidate accepts, an administrator records clearance, and dated TA access becomes available | Clearance delay, access delay and incorrect-access incidents   |
| Evidence for the next staffing cycle | Queue activity, reported work and financial scenarios appear in a course review                | Observation coverage, queue P90 and faculty usefulness ratings |

These are value propositions and proposed measures. No customer adoption, saved time, staffing reduction or budget saving has been established.

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
| 3:30-4:20 | Move to the course-review example and its saved real AI panel                                                                                                 | "The next staffing discussion can use recorded demand, reported work and commitments, with the evidence gaps visible."                      |
| 4:20-5:00 | Return to the overview and state the pilot request                                                                                                            | "The next step is a department-sponsored pilot with three to five courses and one recruitment cycle, measured against the team's baseline." |

The review screenshots use CS101's synthetic course evidence. Avery's live appointment is for CS201. Introduce the review as the department-level perspective across courses; do not present the CS101 history as work Avery just performed.

## Keep one applicant throughout the live transition

Avery Chen is `student2@example.com` in the **Student Applications** window. Avery begins with seven applications and one existing offer for **Data Structures TA**. State that the offer was prepared before the demonstration; the live sequence begins with the candidate's response.

1. Open the Data Structures application using **Open application**. Choose **Accept offer** and show **Pending clearance**.
2. Switch to **Administrator**, at `/admin/staffing`. In **Appointment Clearance**, find Avery, select **Cleared** and click **Record clearance**.
3. Return to Avery's application. Wait for the automatic update to **Active**, then choose **Open TA Queue**. The route is `/courses/cs201/ta`.
4. Start duty. Select Noah Brooks's waiting request. The row's action changes to **Complete**, showing that Avery now owns the help session. Complete it if time permits.

This is the same person and appointment throughout. The separate **TA Queue** window belongs to Robin Parker in CS101 and is an additional operations example, not Avery's identity.

The live transition has existing browser acceptance coverage in `playwright/e2e/showcase-flow.spec.ts`. This pitch update changes presentation materials, not application rules or prepared business decisions.

## Optional 60-second allocation example

Use this after the main story or in questions. Label it as a separate example involving **Maya Patel**, not Avery.

1. In **Instructor Selection**, select Maya for the programming position.
2. In **Second Instructor**, show that Maya is no longer available for an overlapping appointment in the other course.
3. Explain that the first committed decision reserves the candidate, vacancy and financial commitment. Current AI comparisons update when provider capacity is available.

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
- Keep the [offline gallery](demo/index.html) open as the fallback. Its ten workflow captures and two actual OpenAI panels have separate provenance labels. Every person and business record is synthetic.
- Rehearsing acceptance, clearance or selection changes the saved dataset. Use `--fresh` for another clean rehearsal; ordinary restarts preserve completed decisions.
- If a model result is queued or connectivity fails, present the saved result with its capture label and continue the deterministic workflow.

## Evidence and evaluator questions

| Question                                     | Grounded response                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is the product's main distinction?      | Demonstrate the connection from a staffing decision to dated course authority and support evidence. Evaluate alternatives with the pilot sponsor before claiming competitive uniqueness.                                                         |
| What does AI do?                             | Requirements assistance, qualification summaries, candidate-page comparisons and course advice. It does not select a hire or approve clearance. Private CV file bytes are not parsed; typed qualifications and screened answers supply evidence. |
| Is this used by Duke or real departments?    | Institutional adoption has not been established. The demonstration uses synthetic records and illustrative courses/dates.                                                                                                                        |
| Does this save money or reduce TA headcount? | Savings have not been measured. Recorded queue use does not establish the full lab, grading or teaching workload. The pilot needs a baseline and validated coverage.                                                                             |
| What has actually been tested?               | The maintained application evidence records 198 local acceptance cases, 64 unit tests, 36 container browser cases, real OpenAI checks and accessibility checks. This is local evidence, not institutional SSO or hosted-production validation.   |
| Who would start using it?                    | A department coordinator, faculty sponsor and service owner could sponsor the first three-to-five-course pilot. Students and TAs participate through the same four-role workflow. This is a proposed pilot, not a confirmed deployment.          |
| What is the business model?                  | Procurement, pricing and demand remain unvalidated. Establish the department's problem, responsible budget owner and pilot outcomes before proposing a commercial commitment.                                                                    |
| What must happen before a real pilot?        | Resolve semester context, official offer handling and approved work limits, then confirm identity integration, data/provider approval and operating ownership. See [Product readiness](PRODUCT_READINESS.md).                                    |

Use the [verification report](VERIFICATION.md) for technical questions. Counts such as 41 accounts, 21 positions and 68 applications describe the synthetic showcase, not customers, adoption or product impact.
