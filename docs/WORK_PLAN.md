# CampusWorks work plan

## Current delivery

- Read and account for every application source, asset, configuration, deployment, and existing test file before establishing the application baseline.
- Preserve the four user identities: student, teaching assistant, instructor, and administrator; preserve course-scoped permissions and site administrator privileges.
- Preserve Duke blue, page layouts, navigation, forms, live queue behavior, analytics, and feedback workflows.
- Deliver the application in small functional commits, each with a single-sentence subject describing its capability.
- Use CampusWorks product identity throughout application text, configuration, documentation, and commit subjects; retain required copyright and license notices.
- Keep credentials, personal records, database contents, generated dependencies, and local tool history out of version control.
- Check the production build, four-role authorization, queue lifecycle, analytics, feedback, responsive screens, and source coverage; state any verification limits explicitly.
- Work locally. Do not push, publish, contact external identity services, or submit real applications.

## Design after baseline verification

Design the following capabilities without implementing them in this delivery:

1. Instructor TA/RA opportunities with term, course or research project, positions, weekly workload, attendance, lab/discussion, grading, office hours, required skills, screening questions, deadlines, and budget.
2. Student applications with academic background, position preference, course preferences, prior experience, availability, answers, CV, and application status.
3. Instructor review, explicit selection, candidate availability updates, and collision-safe allocation so competing instructors cannot allocate an unavailable candidate.
4. Accepted appointments connected to course-scoped TA permissions, with start/end dates, withdrawal, termination, and next-term renewal.
5. A shared TA/RA application foundation with distinct course operations and research-project operations; RA appointments must not grant course privileges by default.
6. AI-assisted candidate summaries grounded in submitted qualifications and stated opportunity requirements, with instructor decisions and auditable explanations.
7. End-of-term course observations for instructors and department administrators, using queue demand, assistance workload, student feedback, and explicit staffing costs; recommendations must state data gaps.
8. Additional useful AI assistance, a complete business lifecycle, failure handling, permissions, and a phased implementation proposal.

## Supplied form evidence

The four supplied screenshots cover the personal-information section of a Fall 2026 CS master's TA application, ending at a Next button. Other sections are not visible and must not be invented as existing form fields.

Visible fields: first name, last name, preferred email, Duke unique ID, undergraduate majors, full/half/either/other appointment preference, prior TA experience, conditional course/department details, willingness to serve multiple courses, prior Duke payroll status, whether the applicant has an SSN, department affiliation, citizenship category, graduation in the application term, and conditional work-authorization expiry.

The product proposal should separate selection qualifications from restricted appointment administration. Store neither SSN numbers nor immigration documents in ordinary application answers; assess any HR integration separately. Do not use citizenship or payroll metadata in AI fit scoring.

## Completion rule

Finish the application baseline and its checks, write the TA/RA and AI design, and stop before implementing the new application features.
