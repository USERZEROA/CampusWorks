# CampusWorks five-minute presenter notes

Eight slides, 300 seconds. The English script is also embedded in the PowerPoint speaker notes. Keep the current/future and recorded/live distinctions when presenting.

## 1. CampusWorks (0:00–0:20)

CampusWorks connects the people who recruit teaching assistants with the people who deliver course support. It follows one student from application to appointment, into the help queue, and through the evidence a department can use for its next teaching cycle.

## 2. The hiring handoffs (0:20–0:55)

The supplied CS recruitment example starts with Microsoft Forms, sends course requirements in Excel, and follows up by email. Those tools collect information, but people still connect the pieces. Faculty need to know which requirements apply and whether a candidate remains available. Applicants need a clear status. Administrators need the accepted appointment before enabling course authority. Our opportunity is to connect these handoffs, rather than claim that universities have never built a queue.

## 3. One connected lifecycle (0:55–1:35)

An instructor publishes duties, skills and screening questions. A student applies, and faculty review the submitted evidence. An offer reserves both the opening and the candidate, so another course cannot make an overlapping selection. Acceptance alone is not course authority: administrative clearance and valid appointment dates are also required. Only then does that same account gain the relevant TA queue access. Ending the appointment removes that access while preserving history. RA recruitment shares the application and appointment stages, without becoming a research workspace.

## 4. Deadline night, one shared queue (1:35–2:20)

Picture the evening before an assignment deadline. Several students need help, and several TAs are moving between tables or online rooms. A shared queue makes arrival order and request status visible. One TA claims a request; another sees that it is already being handled. A handoff or completion updates that shared state. Students see their position and helper, rather than repeatedly asking who comes next. The current product does not promise exact remaining minutes. And even with AI available, course staff still provide assignment context, interpretation and feedback that students need.

## 5. AI supports review; people decide (2:20–3:05)

AI works at four points: improving position requirements, summarizing submitted qualifications, comparing currently eligible candidates, and preparing course advice. These are real recorded OpenAI outputs using synthetic evidence. The analysis draws on typed qualifications and screening answers; uploaded CV file bytes are not parsed. When another course reserves a candidate, availability changes and the full application schedules updated comparisons. Reviewers can inspect the evidence and its gaps. Faculty still choose the candidate, students still respond to offers, and administrators still approve clearance. AI does not make those decisions.

## 6. Who buys, who benefits (3:05–3:50)

Our first customer hypothesis is a CS department or graduate program office. A program coordinator and course lead are plausible champions; leadership and institutional IT would evaluate a pilot. The department gains a shared staffing and demand picture. Faculty review current candidate evidence. TAs coordinate help through one queue. RA applicants gain clear duties and appointment status, without a new operational workspace. Students gain a visible place in line. Remote and commuting students may especially value joining the same workflow. These are proposed benefits to validate, not claims of existing customers or measured savings.

## 7. Course decisions grounded in observations (3:50–4:30)

At the end of a cycle, the department can examine when requests arrived, which planned positions remain unfilled, what work TAs reported, and what feedback students actually attributed to a helper. The heatmap supports conversations about busy support windows. Counts and sample sizes stay visible. One five-star response does not establish that a TA is excellent, and queue traffic alone does not establish required headcount. Course advice helps faculty frame follow-up questions, while grading, labs and other teaching duties remain part of the staffing conversation.

## 8. Start with a department pilot (4:30–5:00)

The next step is one department, one recruitment cycle and a few busy courses. We would measure coordination effort, time until a TA is ready, unfinished requests and student clarity. An annual department subscription with onboarding is a business model to test, not an agreed price. Later targets include other teaching departments and learning centers. Institutional SSO and bounded wait estimates are future pilot targets. The public link lets anyone explore the four-role browser experience today.

## Sources and delivery boundaries

- docs/submission/PROJECT_STORY.md
- docs/PRODUCT_POLICY.md
- Owner-provided screenshot: Fall 2026 TA application emails
- Owner-provided screenshot: TARecruitingNeeds.xlsx
- Owner-provided screenshot: Microsoft Forms application
- https://courses.cs.duke.edu/fall25/compsci101/consult.php
- docs/STAFFING_OPERATIONS.md
- app/pages/courses/[id]/student.vue
- app/pages/courses/[id]/ta.vue
- https://courses.cs.duke.edu/fall26/compsci210d/syllabus.html
- https://www.cs.cornell.edu/courses/cs1110/2022fa/info/officehours/
- docs/AI_WORKFLOWS.md
- docs/verification/staffing-live-ai-proof.json
- docs/demo/screenshots/showcase-ai-summary-desktop.png
- docs/demo/screenshots/showcase-ai-candidates-desktop.png
- https://cs.duke.edu/graduate/ms/financial
- docs/COURSE_INSIGHTS.md
- Commercial buyer and benefit hypotheses; no customer validation claimed
- docs/demo/screenshots/showcase-department-insights-desktop.png
- docs/demo/screenshots/showcase-ai-course-review-desktop.png
- docs/submission/API_AND_HOSTING.md
- Proposed pilot and commercial model; not an agreed customer contract or implemented SSO/ETA
- https://userzeroa.github.io/campusworks-demo/

The proposed first buyer and subscription model need customer validation. No purchase, institutional adoption, verified savings or measured headcount requirement is asserted. RA uses the application and appointment workflow; only TA appointments enable course queues. The public browser demo stores synthetic data on the visitor's device and uses labeled saved AI examples.
