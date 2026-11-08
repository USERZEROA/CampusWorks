# CampusWorks

CampusWorks connects TA and RA recruitment with course operations: faculty publish positions, students apply, faculty make offers, administrators record clearance, and dated TA appointments provide course queue access. Students, TAs, instructors and administrators retain the established Duke blue interface and course permissions.

The application uses Nuxt 4, Vue 3, Nitro, MongoDB transactions and Playwright. All demonstration records are synthetic.

Start with the [new-computer quickstart](docs/QUICKSTART.md) for cloning, Docker startup, the six-window presentation and per-device Key setup. Generated files and credentials are not needed from another checkout.

Try the [four-role browser demo](https://userzeroa.github.io/campusworks-demo/) without installing anything. It uses synthetic data stored on the visitor's device and labeled saved AI examples; the complete application and live OpenAI run locally with private server-side settings. [Submission materials](docs/submission/SUBMISSION_FIELDS.md) include the project story, technology tags, media instructions and public links.

## Available workflows

| Role          | Workflows                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student       | Browse courses and positions; enroll; prepare answers and a private CV; submit, withdraw, accept or decline; enter a queue and submit feedback; view appointment notifications                                           |
| TA            | Receive dated course access; start duty; manage claims, handoffs, ordering and queue states; record non-queue work                                                                                                       |
| Instructor    | Publish TA/RA requirements and questions; review submitted evidence; shortlist and select; manage appointments; review queue activity, workload and course recommendations                                               |
| Administrator | Manage courses and scoped permissions; select the current recruitment semester, window and approval policy; approve positions; record post-offer clearance; review allocations, staffing coverage and operational status |

RA is an application and appointment type within these four identities. It has no separate project workspace or course queue privileges. Course-admin and site-admin describe scopes of the administrator identity.

Removing a student restricts re-enrollment and queue use in that course until an instructor or administrator restores access. Restoration leaves enrollment explicit. After clearance, only site administrators can correct administrative details, with a required reason and private before/after history; correction does not change appointment status.

Recruitment links appear on the course-list home page. Only authorized instructors and administrators see hiring controls. Administrators select one shared current semester and application window; faculty postings inherit that semester and deadline. Faculty specify weekly hours and work frequency, attendance, lab/discussion duties, grading, office hours, schedules, skills, questions and vacancies. Publication follows the term's approval policy. Submission freezes the reviewed answers and CV revision. Private administrative information is collected separately after an offer and excluded from ordinary faculty review and AI input.

Selection reserves a candidate and vacancy atomically. TA and RA commitments cannot overlap in dates, even across different recruitment terms, and two half appointments cannot coexist. The one-live-allocation-per-term rule also remains. Acceptance, clearance and the appointment start date are required for access. Expiration, suspension or ending removes appointment-derived access and releases queue claims while preserving independently granted roles. See [product policy](docs/PRODUCT_POLICY.md) and [staffing operations](docs/STAFFING_OPERATIONS.md).

[Course insights](docs/COURSE_INSIGHTS.md) opens from Home for course managers. Administrators compare the department; faculty see their managed courses. Request trends, busy hours, TA coverage, staffing plans, reported work and known assigned hours share the current semester. Students can optionally rate a recorded helper from their own completed session. Individual feedback retains its sample counts and stays separate from general course feedback.

## Local demonstration

Install Git and Docker with Compose, start Docker in Linux-container mode, then:

```sh
git clone https://github.com/USERZEROA/CampusWorks.git
cd CampusWorks
docker compose up --build -d
```

Open <http://localhost:3000> after the initial build and database initialization. This Docker path needs no host Node.js, Playwright installation or `.env` file. Compose initializes authenticated MongoDB as a single-node replica set and starts the app after initialization. Ports bind to loopback. The password and session secret are local demonstration defaults; supply private values for other environments.

| Accounts                                                              | Identity                          |
| --------------------------------------------------------------------- | --------------------------------- |
| `student@example.com`, `student2@example.com`, `student3@example.com` | Student                           |
| `ta@example.com`, `ta2@example.com`                                   | TA in `cs101`                     |
| `instructor@example.com`                                              | Instructor in `cs101` and `cs201` |
| `admin@example.com`                                                   | Site administrator                |

Demo login also accepts a custom synthetic email. Stop with `docker compose down`; volumes preserve data. `docker compose down -v` deliberately erases that Compose project's local data.

## Development and testing

Use Node.js `^22.21.0`, `^24.11.0`, or `>=26.0.0` and a MongoDB replica set or sharded deployment. A standalone MongoDB server is rejected. `.nvmrc` selects Node 22.

```sh
npm ci
docker compose up -d mongo-init
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), generate a session secret, then run `npm run dev`. Set `SEED_DEMO_DATA=true` for populated synthetic courses. The example URI uses `directConnection=true` so a host process can reach the local database whose advertised hostname belongs to the Compose network. Nuxt development and `npm run start:ai` load `.env`; the raw `npm start` entry point requires process environment variables.

| Command                       | Purpose                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                 | Development server                                                                                                                                     |
| `npm run build` / `npm start` | Build and run production output                                                                                                                        |
| `npm run typecheck`           | Application, server and test type checks                                                                                                               |
| `npm run test:unit`           | Security, AI evidence and provider-launcher regressions                                                                                                |
| `npm run verify:local`        | Isolated database, unit/type/build checks, two app instances and complete local acceptance suite                                                       |
| `npm run test:e2e`            | Playwright against an existing dedicated test app                                                                                                      |
| `npm run test:e2e:headed`     | Visible browser tests                                                                                                                                  |
| `npm run test:e2e:ui`         | Playwright test interface                                                                                                                              |
| `npm run demo:windows`        | Six isolated visible queue demonstration windows; set `DEMO_LAYOUT=staffing` for four roles plus application/recruitment windows                       |
| `npm run demo:prepare`        | Prepare the complete labelled showcase without browser windows or model calls                                                                          |
| `npm run demo:showcase`       | Open six prepared role windows; use the encrypted AI configuration when available                                                                      |
| `npm run demo:loop -- --cycles 1` | Play one approximately five-minute lifecycle with real OpenAI results; omit the cycle limit to repeat                                                |
| `node scripts/demo-loop.mjs`  | Repeat the 38-step lifecycle with five live OpenAI panels in six visible role windows; Pause/Resume and Stop controls appear only in the demonstration |

Install browsers once with `npx playwright install chromium firefox`. The complete suite requires Docker. Its runner creates a uniquely named, loopback-only disposable database, enables database fault injection only in that test container, starts two production app processes and cleans up its own resources. It uses local synthetic identity and AI providers. No real provider key or institutional login is required. Reports and traces stay in ignored directories. The runner rejects skipped, flaky and failed tests. Set `E2E_HEADED=1` to display browsers.

Use `npm run verify:local` for the full suite: concurrency and fault tests require its isolated database and second instance. Individual browser specifications can target a dedicated demo app using `BASE_URL`.

The [demonstration guide](docs/DEMO_GUIDE.md) provides a repeatable ten-course scenario, 21 positions, 68 applications, real appointment transitions, populated queues and an eight-minute presentation path. Preparation uses a dedicated versioned database, retains existing data and never fabricates AI output. [Product readiness](docs/PRODUCT_READINESS.md) identifies the semester, offer, institutional identity and operational decisions required for a real pilot.

Open the [offline screenshot gallery](docs/demo/index.html) for desktop/mobile views captured from actual local browsers. Every person and workflow record in the gallery is synthetic.

For a project showcase, follow the [five-minute product pitch](docs/ROADSHOW.md): one applicant's transition into course work, the department review and a measurable pilot proposal. A ninety-second version and evaluator answers are included.

The [automatic six-window presentation](docs/AUTOMATED_DEMO.md) performs the complete lifecycle through real browser controls, foregrounds the acting role and repeats from an isolated baseline, with Pause/Resume and Stop controls.

Its default 38-step round shows five fresh OpenAI responses: CS201 requirements, Alex's qualification summary, CS201 candidate evidence, CS101's eligible alternatives after Alex is selected elsewhere, and CS201 course advice. Allow about five minutes plus provider latency. `--without-ai` selects the 33-step deterministic test mode. Mock Zoom links in announcements use `zoom.example.com`; they create no real meeting.

## Configuration

See [`.env.example`](.env.example) and [`server/utils/config.ts`](server/utils/config.ts).

| Setting                                                       | Behavior                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `MONGODB_URI`, `MONGODB_DB`                                   | Required connection; database defaults to `campusworks`                            |
| `SESSION_SECRET`                                              | Required 32+ characters in production; identical across replicas                   |
| `PUBLIC_ORIGIN`                                               | Canonical browser origin; required for production OAuth                            |
| `TRUST_PROXY`                                                 | Defaults false; enable only behind a trusted proxy that replaces forwarded headers |
| `ENABLE_MOCK_LOGIN`, `SEED_DEMO_DATA`                         | Defaults false in production; explicitly enabled in local Compose                  |
| `ADMIN_EMAILS`                                                | Comma-separated site administrators                                                |
| `GITLAB_BASE_URL`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | Optional OAuth; callback `<origin>/api/auth/gitlab`, scope `read_user`             |
| `ALLOWED_EMAIL_DOMAINS`                                       | Optional institutional email allow-list                                            |
| `MAX_BODY_BYTES`                                              | Request limit, default 12 MiB; CV limit remains 2 MiB                              |
| `API_RATE_LIMIT`, `LOGIN_RATE_LIMIT`                          | Shared per-minute limits; defaults 1800 and 300                                    |

OAuth binds the immutable provider issuer and subject to a stable account ID. A changed or reused email fails closed for administrator review. Logout revokes the stored session, including saved copies of its cookie. Demo login cannot impersonate an institution-bound account.

### AI assistance

AI supports candidate comparisons, background summaries, qualification/question drafts and course reviews. On Windows, open the local masked Key form with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai-provider-dialog.ps1
```

Only the OpenAI Key is entered. Windows encrypts it for the current account in ignored `.cache/ai-provider.xml`; enter it again on another computer or Windows account. Native launchers also accept `AI_API_KEY` from the environment or an ignored `.env` file on other platforms. `npm run start:ai` starts the production build with the configured credential; `npm run dev:ai` starts development. The application uses `https://api.openai.com/v1` and `gpt-5.4-mini` automatically. The chosen model and Chat Completions endpoint are documented by [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

Other deployments can use server-only `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` environment variables. Never expose them through public runtime configuration. Missing configuration disables AI while manual workflows remain usable. `node scripts/ai-provider-check.mjs` performs a capped, isolated synthetic provider check; it does not evaluate hiring quality.

AI receives authorized evidence with references, excludes private administrative attributes, and returns validated suggestions for human review. All four task types run automatically: saved requirements, submitted qualification summaries, current candidate comparisons and dated course reviews. Authorized managers share resource-scoped results; ordinary page reads do not purchase requests. Availability, evidence, current authority and execution leases are checked before publication. Candidate pages disclose coverage, normally ten people per automatic page. Course previews use a fifteen-minute cooldown; semester-end advice bypasses that preview cooldown. Disabling recruitment or switching semesters invalidates old candidate comparisons; closed applications remain reviewable in the current enabled semester. Binary PDF text extraction is not implemented.

Pages synchronize silently and recover after reconnect or focus, retaining complete data and unsaved input. Conflicting remote edits require explicit resolution. Hiring, offer responses, clearance, appointment ending and deletion remain human decisions. A separate persistent worker handles existing timed transitions and in-app delivery without AI configuration or an open browser.

| AI setting                                                         | Default                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_DAILY_REQUEST_LIMIT`                                           | 20 per user                                                                                                                                 |
| `AI_DAILY_TOKEN_BUDGET`                                            | 100000 reserved tokens per user                                                                                                             |
| `AI_GLOBAL_DAILY_REQUEST_LIMIT`                                    | 200                                                                                                                                         |
| `AI_GLOBAL_DAILY_TOKEN_BUDGET`                                     | 1000000 reserved tokens                                                                                                                     |
| `AI_MAX_CONCURRENT`                                                | 2 distributed requests                                                                                                                      |
| `AI_AUTO_REFRESH_ENABLED`, `AI_AUTO_DISCOVERY_ENABLED`             | true; automatic execution and discovery                                                                                                     |
| `AI_AUTO_CANDIDATE_PAGE_SIZE`                                      | 10; range 1-10                                                                                                                              |
| `AI_AUTOMATION_SCOPES`                                             | Unset discovers authorized resources; an explicit JSON array restricts automatic work, and `[]` disables all scopes                         |
| `AI_USAGE_DATABASE`                                                | Unset keeps usage in the application database; the automatic presentation uses `campusworks_demo_ai_usage` to preserve limits across resets |
| `AI_TERM_REVIEW_COOLDOWN_MS`                                       | 900000 between changed course previews                                                                                                      |
| `STAFFING_MAINTENANCE_ENABLED`, `STAFFING_MAINTENANCE_INTERVAL_MS` | true; 5000 ms between idle due-date/delivery checks                                                                                         |

Requests have bounded input, output, response size and timeout. Failed calls consume their reservation. See [staffing operations](docs/STAFFING_OPERATIONS.md) for evidence and review constraints.

The live presentation loads the saved Key only in its server process and scopes automatic analysis to the featured records. Its request/token ledger survives round resets and relaunch. Live model steps require fresh provider responses; saved answers and screenshots are never substituted when a request fails.

[AI workflows](docs/AI_WORKFLOWS.md) identifies each page, automatic trigger and advisory output. The capped real-provider harness is `node scripts/ai-provider-browser-check.mjs`; it requires the saved Windows Key, a production build and a dedicated loopback replica set specified by `AI_PROOF_MONGODB_URI`. Its current executed results belong in [verification](docs/VERIFICATION.md).

Only explicitly classified qualification questions can enter AI evidence; older unclassified questions are omitted. Candidate comparisons must cover each supplied candidate exactly once. At a position's appointment end, new candidate comparisons and summaries stop, while authorized historical results and course reviews remain available.

## Consistency and operations

Every queue mutation locks its course inside a MongoDB transaction. Membership, queue state, duty, claims, ordering and history are checked and changed together. Closing cannot leave a simultaneous new arrival stranded. History insertion and active-entry removal share a transaction and a unique entry identifier. Actual help segments preserve attribution across pauses, handoffs and revoked appointments.

The MongoDB driver is pinned to 7.8.0, which includes the vendor's pool-isolation and SRV validation fixes. Transactions retain driver-managed retries and commit resolution, with separate connection-stage limits and a checked callback work budget. See the [official release notes](https://www.mongodb.com/docs/drivers/node/current/reference/release-notes/#what-s-new-in-7-8). Required indexes and transaction support are readiness requirements. Database/index failures produce an unavailable state. Sessions, rate limits, allocation uniqueness, audit events and durable in-app notifications are shared across replicas. Lists expose bounded pagination. Notification delivery is idempotent and automatic; `POST /api/staffing/reconcile` remains a protected administrative maintenance API.

Feedback remains identified to managers; declining contact does not make it anonymous. Queue help minutes are measured activity, while workload records are submitted work. Reports expose missing evidence and keep recorded help separate from self-reported work. Neither establishes complete teaching workload or required TA headcount.

Queue edits and leave commands identify the original request. Completion also checks its current revision and helper, so an old tab cannot complete a reassigned request. Manager statistics and CSV publish only a complete, consistent multi-page read. Course reviews use one database snapshot and distinguish approved positions, reserved positions, unfilled seats and reported work. Ending an appointment revokes its derived access; authorized managers can archive resolved positions.

Credentials, database data, browser sessions and raw artifacts are ignored and excluded from image builds. Private CVs use authorized downloads, attachment headers, quotas and basic format checks. Additional retention, document-processing and HR integrations are outside the confirmed product scope.

## Deployment and evidence

Build with `docker build -t campusworks:latest .`. The runtime contains Nitro output, runs as `node` and checks `/api/health`. Supply private runtime settings and a reachable transaction-capable database. [`k8s/README.md`](k8s/README.md) requires out-of-band Secrets and disables demonstration login and seeding. The Kubernetes manifests have not been exercised on a real cluster.

[VERIFICATION.md](docs/VERIFICATION.md) records tested paths, reading coverage, dependency results and boundaries. [BUSINESS_REVIEW.md](docs/BUSINESS_REVIEW.md) maps findings and confirmed owner decisions to controls and regressions. [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) records requirements. Local results do not establish live institutional SSO, real model quality, payroll correctness, physical-device accessibility or hosted production behavior.

## License

Copyright (c) 2025 Haiwei Yu. All rights reserved. The proprietary terms in [LICENSE](LICENSE) apply. Dependencies retain their respective licenses, including the documented MIT dependency in [`vendor/safe-deepmerge`](vendor/safe-deepmerge).
