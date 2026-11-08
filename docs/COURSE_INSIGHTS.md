# Course insights

Open **Course insights** from Home. Site administrators see the department; instructors and course administrators see only courses they currently manage. Accounts with only TA or student authority have no entry or dashboard access. Owning an RA position alone does not grant course reporting authority. A course's management page embeds the same insights for that course.

## What to show

- Recorded requests, helped and active requests, first-help waiting-time samples and P90.
- Daily demand and an Eastern Time weekday/hour heatmap, with a course filter and reporting dates.
- Current TA coverage, on-duty helpers, unfilled approved seats, pending clearance and unsettled appointments.
- Helper activity, reported teaching work and explicitly attributed feedback, with sample counts.
- Conditional position costs for a smaller, current or larger plan where valid. These are arithmetic scenarios, not approved staffing reductions.

The administrator's shared current recruitment semester supplies the reporting context. The default window covers up to 28 calendar days within that semester. Dates and heatmap hours use `America/New_York`; entered workload dates remain UTC work dates. Request outcomes follow arrivals in the selected range and use recorded help through the displayed update time. Staffing and financial state are current for that semester. Changing filters silently loads the matching scope.

Summary responses contain aggregates and helper identities, not student identities, queue questions, locations or feedback narratives. Authorized course-management detail retains its separate permissions and identified feedback. Loss of course authority removes the corresponding reporting scope.

## Feedback about a particular TA

In the student feedback form, **TA support** can remain course-level. To rate a particular helper, the student explicitly chooses a completed help session and one of that session's recorded helpers. A helper needs at least six seconds of recorded contact in that ended request. Other students' sessions and unrecorded helpers cannot be selected. Course-level comments are never assigned to an individual TA.

One student can record one rating per session/helper. An exact retry preserves that record; submitting changed content for the same target is refused. Ratings remain identified feedback for authorized instructors and administrators; declining follow-up contact does not make them anonymous.

The helper table shows the average together with rating count, distinct students and feedback days. Its visible observation bands are:

| Evidence                                           | Label                  |
| -------------------------------------------------- | ---------------------- |
| No attributed ratings                              | No individual feedback |
| Fewer than five ratings or three distinct students | Limited feedback       |
| Sufficient samples and average below 3.5/5         | Feedback follow-up     |
| Sufficient samples and average at least 4.0/5      | Positive feedback      |
| Other averages with sufficient samples             | Mixed feedback         |

These labels organize recorded feedback. They do not establish teaching quality or make appointment decisions. Sorting by observed activity or feedback keeps the counts visible. Alex's single rating in the [automatic presentation](AUTOMATED_DEMO.md) is **Limited feedback**, even when its score is 5/5.

## Demonstration evidence

Catalog **v5** preserves the ten-course showcase's 41 accounts, 21 positions, 68 applications, thirty work records, 380 historical requests, eighty feedback records and eleven live requests. Current history contains illustrative weekday office-hour clusters with uneven daily demand and busy afternoons. Work counts and hours vary between the five demonstrated TA appointments.

Sixty feedback fixtures explicitly link to same-student, same-course completed requests and actual helper segments; twenty remain course-level. The loader validates their dates, linkage and unique student/session/helper target. All people, schedules, scores and observations are synthetic. Their variation demonstrates the interface, not measured institutional performance.

New preparation uses a dedicated v5 dataset. Existing v4 datasets and their dated screenshots and verification receipts remain separate historical evidence; they are not silently changed to v5.

Charts and totals are deterministic database calculations. Opening insights does not purchase an AI response. The separate [AI workflows](AI_WORKFLOWS.md) retain their provider configuration, evidence checks and human decisions. Queue use, self-reported work and feedback do not establish complete paid workload, hiring quality or budget savings.
