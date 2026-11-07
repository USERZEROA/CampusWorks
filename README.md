# CampusWorks

CampusWorks connects TA and RA recruitment with course operations: faculty publish positions, students apply, faculty make offers, administrators record clearance, and dated appointments provide the appropriate workspace. Students, TAs, instructors and administrators retain the established Duke blue interface and course permissions.

The application uses Nuxt 4, Vue 3, Nitro, MongoDB transactions and Playwright. All demonstration records are synthetic.

## Available workflows

| Role | Workflows |
| --- | --- |
| Student | Browse courses and positions; enroll; prepare answers and a private CV; submit, withdraw, accept or decline; enter a queue and submit feedback; view appointment notifications |
| TA | Receive dated course access; start duty; manage claims, handoffs, ordering and queue states; record non-queue work |
| Instructor | Publish course or research requirements and questions; review submitted evidence; shortlist and select; manage appointments; review queue activity, workload and course recommendations |
| Administrator | Manage courses and scoped permissions; define recruitment terms and approval policy; approve positions; record post-offer clearance; review allocations, budgets and operational status |

RA appointments provide a research-project workspace within these four identities. They do not grant course queue permissions. Course-admin and site-admin describe scopes of the administrator identity.

Faculty specify weekly hours and work frequency, attendance, lab/discussion duties, grading, office hours, schedules, skills, questions, vacancies and budget. Publication follows the term's approval policy. Submission freezes the reviewed answers and CV revision. Private administrative information is collected separately after an offer and excluded from ordinary faculty review and AI input.

Selection reserves a candidate and vacancy atomically. TA and RA commitments cannot overlap in dates, even across different recruitment terms, and two half appointments cannot coexist. The one-live-allocation-per-term rule also remains. Acceptance, clearance and the appointment start date are required for access. Expiration, suspension or ending removes appointment-derived access and releases queue claims while preserving independently granted roles. See [product policy](docs/PRODUCT_POLICY.md) and [staffing operations](docs/STAFFING_OPERATIONS.md).

## Local demonstration

Install Docker with Compose:

```sh
docker compose up --build
```

Open <http://localhost:3000>. Compose initializes authenticated MongoDB as a single-node replica set and starts the app after initialization. Ports bind to loopback. The password and session secret are local demonstration defaults; supply private values for other environments.

| Accounts | Identity |
| --- | --- |
| `student@example.com`, `student2@example.com`, `student3@example.com` | Student |
| `ta@example.com`, `ta2@example.com` | TA in `cs101` |
| `instructor@example.com` | Instructor in `cs101` and `cs201` |
| `admin@example.com` | Site administrator |

Demo login also accepts a custom synthetic email. Stop with `docker compose down`; volumes preserve data. `docker compose down -v` deliberately erases that Compose project's local data.

## Development and testing

Use Node.js `^22.21.0`, `^24.11.0`, or `>=26.0.0` and a MongoDB replica set or sharded deployment. A standalone MongoDB server is rejected. `.nvmrc` selects Node 22.

```sh
npm ci
docker compose up -d mongo-init
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), generate a session secret, then run `npm run dev`. The example URI uses `directConnection=true` so a host process can reach the local database whose advertised hostname belongs to the Compose network. Nuxt development loads `.env`; the production Node entry point requires process environment variables.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Build and run production output |
| `npm run typecheck` | Application, server and test type checks |
| `npm run test:unit` | Dependency security regressions |
| `npm run verify:local` | Isolated database, unit/type/build checks, two app instances and complete local acceptance suite |
| `npm run test:e2e` | Playwright against an existing dedicated test app |
| `npm run test:e2e:headed` | Visible browser tests |
| `npm run test:e2e:ui` | Playwright test interface |
| `npm run demo:windows` | Six isolated visible queue demonstration windows; set `DEMO_LAYOUT=staffing` for four roles plus application/recruitment windows |

Install browsers once with `npx playwright install chromium firefox`. The complete suite requires Docker. Its runner creates a uniquely named, loopback-only disposable database, enables database fault injection only in that test container, starts two production app processes and cleans up its own resources. It uses local synthetic identity and AI providers. No real provider key or institutional login is required. Reports and traces stay in ignored directories. The runner rejects skipped, flaky and failed tests. Set `E2E_HEADED=1` to display browsers.

Use `npm run verify:local` for the full suite: concurrency and fault tests require its isolated database and second instance. Individual browser specifications can target a dedicated demo app using `BASE_URL`.

## Configuration

See [`.env.example`](.env.example) and [`server/utils/config.ts`](server/utils/config.ts).

| Setting | Behavior |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | Required connection; database defaults to `campusworks` |
| `SESSION_SECRET` | Required 32+ characters in production; identical across replicas |
| `PUBLIC_ORIGIN` | Canonical browser origin; required for production OAuth |
| `TRUST_PROXY` | Defaults false; enable only behind a trusted proxy that replaces forwarded headers |
| `ENABLE_MOCK_LOGIN`, `SEED_DEMO_DATA` | Defaults false in production; explicitly enabled in local Compose |
| `ADMIN_EMAILS` | Comma-separated site administrators |
| `GITLAB_BASE_URL`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | Optional OAuth; callback `<origin>/api/auth/gitlab`, scope `read_user` |
| `ALLOWED_EMAIL_DOMAINS` | Optional institutional email allow-list |
| `MAX_BODY_BYTES` | Request limit, default 12 MiB; CV limit remains 2 MiB |
| `API_RATE_LIMIT`, `LOGIN_RATE_LIMIT` | Shared per-minute limits; defaults 1800 and 300 |

OAuth binds the immutable provider issuer and subject to a stable account ID. A changed or reused email fails closed for administrator review. Logout revokes the stored session, including saved copies of its cookie. Demo login cannot impersonate an institution-bound account.

### AI assistance

The UI and server support candidate-fit explanations, background summaries, position drafting and course-term reviews. Configure all three values to enable the adapter:

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=
AI_MODEL=
```

The base URL must expose an OpenAI-compatible `/chat/completions` endpoint. Missing configuration produces an explicit unavailable state; manual workflows remain usable. Real provider behavior requires a separate check after configuration.

AI receives authorized evidence with references, excludes private administrative attributes, and returns validated suggestions for human review. It never selects applicants, grants roles or reduces staffing. Availability and evidence are rechecked after a response; a concurrent selection makes the result stale. Established candidate comparisons update automatically when candidate lists, qualifications or availability change, using a durable worker, current reviewer permissions and the existing budgets. Candidate pages disclose coverage. Background summaries currently use supplied profile and qualification text; binary PDF text extraction is not implemented.

| AI setting | Default |
| --- | --- |
| `AI_DAILY_REQUEST_LIMIT` | 20 per user |
| `AI_DAILY_TOKEN_BUDGET` | 100000 reserved tokens per user |
| `AI_GLOBAL_DAILY_REQUEST_LIMIT` | 200 |
| `AI_GLOBAL_DAILY_TOKEN_BUDGET` | 1000000 reserved tokens |
| `AI_MAX_CONCURRENT` | 2 distributed requests |

Requests have bounded input, output, response size and timeout. Failed calls consume their reservation. See [staffing operations](docs/STAFFING_OPERATIONS.md) for evidence and review constraints.

## Consistency and operations

Every queue mutation locks its course inside a MongoDB transaction. Membership, queue state, duty, claims, ordering and history are checked and changed together. Closing cannot leave a simultaneous new arrival stranded. History insertion and active-entry removal share a transaction and a unique entry identifier. Actual help segments preserve attribution across pauses, handoffs and revoked appointments.

Required indexes and transaction support are readiness requirements. Database/index failures produce an unavailable state. Sessions, rate limits, allocation uniqueness, audit events and durable in-app notifications are shared across replicas. Lists expose bounded pagination. Notification delivery is idempotent; administrators can trigger reconciliation through `POST /api/staffing/reconcile`.

Feedback remains identified to managers; declining contact does not make it anonymous. Queue help minutes are measured activity, while workload records are submitted work. Reports expose missing evidence and separate budget scenarios from measured cost. Neither establishes payroll or an automatic staffing reduction.

Credentials, database data, browser sessions and raw artifacts are ignored and excluded from image builds. Private CVs use authorized downloads, attachment headers, quotas and basic format checks. Additional retention, document-processing and HR integrations are outside the confirmed product scope.

## Deployment and evidence

Build with `docker build -t campusworks:latest .`. The runtime contains Nitro output, runs as `node` and checks `/api/health`. Supply private runtime settings and a reachable transaction-capable database. [`k8s/README.md`](k8s/README.md) requires out-of-band Secrets and disables demonstration login and seeding. The Kubernetes manifests have not been exercised on a real cluster.

[VERIFICATION.md](docs/VERIFICATION.md) records tested paths, reading coverage, dependency results and boundaries. [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) records requirements. Local results do not establish live institutional SSO, real model quality, payroll correctness, physical-device accessibility or hosted production behavior.

## License

Copyright (c) 2025 Haiwei Yu. All rights reserved. The proprietary terms in [LICENSE](LICENSE) apply. Dependencies retain their respective licenses, including the documented MIT dependency in [`vendor/safe-deepmerge`](vendor/safe-deepmerge).
