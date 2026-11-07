# CampusWorks verification record

Date: November 7, 2026. This record describes local application evidence. TA/RA applications, appointments, research workspaces, and AI features remain proposed in [STAFFING_DESIGN.md](STAFFING_DESIGN.md).

## Delivery and reading coverage

The application baseline contains all 73 inventoried product files: 12 application files, 34 server files, four public assets, and 23 documentation/configuration/deployment/test files. There are 27 server API route files. Reading coverage has no missing or duplicate baseline paths.

All application/server text was read, including 7,640 application lines and 1,884 server lines. Root configuration, deployment, scripts, documentation, and existing tests were read completely. The entire dependency lockfile was parsed and structurally inspected. Public SVG/text was read; the Duke CS PNG was visually inspected; the unused ICO was inventoried as binary rather than claimed as a visual review. The browser uses the CampusWorks SVG icon.

The three reading ledgers in [review/](review/) describe the initially inspected bytes. [application-inventory.json](verification/application-inventory.json) records the current delivered bytes and SHA-256 values for the 73 baseline paths plus two additional validation files. The inventory is a coverage receipt, not an exhaustive security assurance.

Generated dependencies/build output, real environment values, database contents, repository archives, and raw/private conversation history are excluded from application reading coverage and the deliverable. Selected human operational notes informed the read-only review; their contents were not added to the project.

The four identities remain student, TA, instructor, and administrator, including the existing course/site administrative scopes. Duke blue, the Duke CS image, layouts, navigation, forms, queue states, and normal operational flows remain in place. Application identity uses CampusWorks. Required copyright and license text are retained.

## Final checks

| Check | Result and boundary |
| --- | --- |
| Locked dependency installation | Passed on Windows and in the clean Docker build |
| `npm run typecheck` | Passed; application, server, Nuxt configuration, and Playwright TypeScript checks exit zero |
| `npm run build` on Windows | Passed on Node 24.21.0 with the final application/dependency inputs |
| Docker production build | Passed on Node 22.23.4; runtime contains Nitro output and runs as user `node` |
| `docker compose config --quiet` | Passed; this validates configuration, not a complete Compose deployment |
| Production readiness endpoint | `/api/health` reports database up; Docker health is healthy |
| Final Chromium browser/API suite | **28 passed, zero failed/skipped/flaky**, approximately 30 seconds |
| Desktop views | Four role workspaces plus login, help, and course directory checked at 1440px |
| Mobile views | All four role workspaces checked at 390px, including document overflow and key controls |
| Theme and assets | Duke navbar color asserted as `rgb(1, 33, 105)`; logo loading checked; screenshots inspected |
| Session history CSV | Actual download parsed; multiline/quoted content preserved and formula prefixes neutralized |
| Deterministic analytics | Labeled synthetic response fixture verifies empty metrics, nearest-rank P90, averages, and full single-TA ring geometry |
| Content and Git hygiene | Identity/content scan, private-path scan, single-sentence commit subjects, and whitespace checks passed |

The browser target was a loopback-only production app container backed by a separate MongoDB 7.0.45 test database. Tests used synthetic `example.com` identities and unique temporary courses. They did not use the private environment file or a real institutional database. No real provider sign-in, email, CV upload, paid model call, remote Git push, or publication was performed.

The tested production image is recorded by digest in [results.json](verification/results.json). The same receipt contains test names/statuses and evidence hashes without embedding absolute personal paths. [screenshots/](verification/screenshots/) contains twelve images from the passing run. The single-TA analytics image is explicitly synthetic and does not represent real course outcomes.

## Functional evidence

The 22 authentication, RBAC, and four-role queue checks passed before additional checks were introduced. The final suite combines those checks with six broader acceptance cases:

1. Editing while the queue is paused, preserving entry identity/order, student pause/resume, staff reorder, handoff, duplicate removal, and kicked-student history.
2. Cross-course entry and announcement boundaries, announcement deletion, and immediate server-side authority changes after a TA is demoted without logging out.
3. Four mobile workspaces, Duke color/logo, student modal bounds, TA duty controls, instructor restrictions, and administrator course visibility.
4. Downloading and parsing a real session CSV containing formulas, quotes, commas, and newlines.
5. A labeled synthetic analytics fixture, without writing fabricated historic sessions into the database.
6. Desktop workspaces, login/help/directory navigation, document widths, loaded logos, and absence of browser page errors in those desktop journeys.

This establishes the exercised paths. It is not a proof of every possible input, device, timing, or database-failure sequence.

## Corrections established during verification

- For waits of one and nine minutes, the initial P90 calculation displayed one. The nearest-rank calculation now displays nine.
- A one-TA donut initially had zero-width SVG geometry because a complete circle used one coincident-endpoint arc. It now uses two arcs and renders the complete ring.
- The student queue body now uses the existing mobile scroll class.
- A long generated course identifier exposed two pixels of administrator-table overflow at 390px. Mobile table sizing and wrapping now keep the document within its viewport.
- Nuxt 4.6.3 requires Vue Router 5.4.0, while the direct router dependency selected 4.6.3. Aligning the router removes the Vue language-plugin loading warning; navigation, SSR authentication, and all four roles pass with the aligned version.
- Fixed-version TypeScript and Vue type-check tools plus the acceptance-test configuration make type verification repeatable.

These corrections preserve the established visual system and the normal user workflow.

## Remaining limitations and release prerequisites

The review found reliability limitations that are not represented as corrected by the passing suite:

- Active-entry deletion and help-history insertion are separate writes. Interruption between them can lose history. A tested durable recovery or transaction design is required before relying on history for authoritative staffing decisions.
- Closing a queue and concurrent joining are not synchronized as one transition. Simultaneous claims, ordering, and duty changes also lack complete multi-record guarantees. The duplicate-removal check establishes one particular concurrency path, not all queue concurrency invariants.
- Unique index creation is best effort on an existing dataset. A health ping does not prove those indexes were created successfully.
- Role changes and course deletion involve several independent writes. Failure recovery and reconciliation remain necessary for stronger guarantees.
- Help-start timestamps survive release/pause and can be attributed to the final helper. These durations do not establish total teaching workload, paid hours, or a justified headcount reduction.
- Feedback is identified to managers even when follow-up contact is declined. The contact flag does not make feedback anonymous.
- Cookie logout does not revoke another saved copy of a valid session. Demo credentials/login settings are suitable for a local demonstration, and production needs explicit authentication/session/proxy configuration.
- Rate limiting, pagination/retention, accessibility of modal focus/keyboard flows, and supported-browser coverage need further work before a broad institutional rollout.

The dependency audit reports 13 affected-package entries: 11 moderate and two low, with no high or critical entries in this audit result. These include transitive build-tool chains and repeated impact propagation rather than thirteen independent advisories. The recorded audit is not a certification that the runtime is safe. An automatic framework downgrade or untested major override was not applied merely to reduce the count. See the audit details in [results.json](verification/results.json).

External GitLab OAuth, institutional identity policy, Kubernetes runtime behavior, multiple application replicas, database fault injection, load testing, Safari/Firefox, physical mobile devices, and hosted production behavior were not verified. No staffing allocation or AI recommendation guarantee is claimed for features that have not been implemented.

## Stop point

The course/queue baseline, functional commits, local verification, and staffing design are complete. The next phase would implement the deterministic application/appointment loop first, followed by evidence-grounded AI assistance and term-review scenarios. No TA/RA application feature was implemented in this delivery.
