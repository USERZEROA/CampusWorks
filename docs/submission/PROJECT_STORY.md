## Inspiration

TA recruitment and office hours are parts of the same teaching workflow, yet they are often handled separately. An application form collects candidates, an instructor chooses someone, and course access is managed elsewhere. After the semester, the department still needs evidence about when students needed help and how support was delivered.

CampusWorks connects those stages in one product: recruitment, appointment, course support and the evidence for the next cycle.

## What it does

CampusWorks serves four roles: students, TAs, instructors and administrators. Faculty publish TA or RA positions with skills, questions, weekly hours, attendance, lab or discussion duties, grading and office-hour requirements. Students submit qualification information, answers and a private CV, then follow their applications and offers.

Selection reserves both the opening and the candidate. An accepted, administratively cleared, date-valid TA appointment enables the relevant course queue. The same account can become a TA, start duty, claim a student request, coordinate a handoff and complete a help session. Ending the appointment removes its course authority while retaining history. RA positions use the application and appointment workflow without receiving TA queue access.

Course and department views show recorded demand, busy support windows, staffing plans, reported teaching work and explicitly attributed student feedback. Sample counts and missing evidence remain visible alongside the metrics.

AI supports four points in that workflow: improving position requirements, summarizing submitted qualifications, comparing currently eligible candidates and suggesting course improvements. Suggestions cite supplied evidence and leave decisions with people. When one instructor reserves an applicant, other instructors see availability change and receive updated comparisons. Uploaded document bytes are not parsed by the model; typed qualifications and approved screening answers provide the evidence.

## How it is built

The full application uses Nuxt, Vue, TypeScript, Node.js and MongoDB. Transactions coordinate queue changes, appointment reservations, permission transitions and history. Persistent workers handle dated transitions and scoped AI tasks; pages synchronize quietly while protecting unsaved input.

OpenAI integration runs on the server, with current-permission checks, validated references, bounded outputs and request controls. Private administrative information stays outside qualification analysis.

A GitHub Pages browser experience makes the product easy to explore without installing the backend. Its four identities share synthetic data only within the visitor's browser. It clearly distinguishes saved real AI examples from live model calls. The full application supports live OpenAI after a private server-side Key is configured.

## Challenges

The central challenge was preserving one business story across different identities. An offer must not grant TA access before acceptance, clearance and the appointment dates. Two instructors must not reserve the same unavailable candidate. Queue claims, completion, handoffs and archive records must stay consistent when requests arrive together.

Another challenge was making AI useful without treating its output as authority. Candidate availability, reviewer permissions and submitted evidence can change while a request is running. Results therefore need current scope, evidence references and an explicit human decision boundary.

## Accomplishments

CampusWorks connects the applicant-to-TA transition directly to real course operations, retains a consistent Duke blue interface, and makes the full lifecycle demonstrable through independent role windows. Local browser automation exercises permissions, appointments, queue operations, feedback and closeout. Real OpenAI responses have been captured for all four advisory types, with their provenance retained separately from synthetic workflow data.

## What building it taught us

Reliable workflow transitions matter as much as individual screens. A role badge is useful only when it reflects current authority. A dashboard is useful only when its counts, dates and evidence limits are clear. AI advice is easier to assess when a reviewer can trace it to the relevant qualification or course observation.

## What's next

The next step is a controlled, department-sponsored pilot: confirm identity integration and data-handling requirements, observe the workflow through a recruitment and teaching cycle, and evaluate it with faculty, students and administrators. The goal is to measure whether the connected process improves coordination and the usefulness of course evidence, rather than assume those benefits from a demonstration.
