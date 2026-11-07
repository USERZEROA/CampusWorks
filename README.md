# CampusWorks

CampusWorks manages office-hours help queues for students, teaching assistants, instructors, and administrators. Students enroll and request help, TAs manage the live queue, and instructors review assistance activity and course feedback. The interface uses Duke blue and the Duke Computer Science logo.

The application uses Nuxt 4, Vue 3, Nitro server routes, and MongoDB, with sealed-cookie sessions, optional GitLab OAuth, Playwright checks, and Docker and Kubernetes configurations.

The implemented product covers course and queue management. TA/RA opportunities, applications, appointments, and AI assistance are design proposals; they are not available application features. See the [work plan](docs/WORK_PLAN.md), [staffing design](docs/STAFFING_DESIGN.md), and [verification record](docs/VERIFICATION.md) for delivery scope, proposed behavior, and actual check results.

## Features and roles

CampusWorks has four user identities: student, TA, instructor, and administrator. Permissions are resolved per course. Administrator access can be limited to a course or granted site-wide.

| Identity | Available workflows |
| --- | --- |
| Student | Browse and enroll in courses; join, edit, pause, resume, or leave a queue; view queue position, TA assignment, and announcements; submit structured course feedback |
| TA | Open, pause, and close a queue; start and end duty; select, release, complete, or redirect a help request; reorder, pause, and remove entries; manage announcements |
| Instructor | Operate the live queue; view assistance analytics, session outcomes, and feedback; download session CSV; add TAs and manage non-admin course roles |
| Administrator | Manage course people and permissions; site administrators additionally create and delete courses and have staff and manager permissions in every course |

Students see email addresses only on their own queue entries. Course administrators and site administrators can grant course-admin access; instructors cannot. Users cannot change their own course role or remove themselves through the people-management controls.

## Quick start with Docker

Install Docker with Compose, then run:

```sh
docker compose up --build
```

Open <http://localhost:3000>. The local stack starts MongoDB, enables demo sign-in, and seeds demo courses when the database is empty.

| Demo accounts | Identity | Suggested workflow |
| --- | --- | --- |
| `student@example.com`, `student2@example.com`, `student3@example.com` | Students in `cs101` | Join the queue, leave feedback, or enroll in `cs201` |
| `ta@example.com`, `ta2@example.com` | TAs in `cs101` | Start duty, select a student, redirect a request, and complete a session |
| `instructor@example.com` | Instructor in `cs101` and `cs201` | Review analytics, feedback, and people; use Live Queue |
| `admin@example.com` | Site administrator | Create and delete courses in the Admin Console |

The demo login also accepts a custom email and selected identity. Demo data is synthetic. The Compose credentials and session secret are local demonstration defaults.

Stop the stack with `docker compose down`. To deliberately erase the local demo database, use `docker compose down -v`; the next startup will seed a fresh dataset.

## Local development

Requirements:

- Node.js `^22.21.0`, `^24.11.0`, or `>=26.0.0`; `.nvmrc` selects Node 22.
- A running MongoDB server. There is no in-memory or file-backed database fallback.

```sh
npm ci
docker compose up -d mongo
```

Copy `.env.example` to `.env`, then set `SEED_DEMO_DATA=true` if you want demo courses in an empty local database. Use `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` in a Unix shell.

```sh
npm run dev
```

Open <http://localhost:3000>. Nuxt loads `.env` for the development server. Keep that file private. The production Node entry point expects configuration in its process environment; it does not load `.env` automatically.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with live updates |
| `npm run build` | Production build into `.output/` |
| `npm start` | Run the production Node server |
| `npm run preview` | Preview a production build with Nuxt |
| `npm run typecheck` | Check application, server, and acceptance-test types |
| `npm run test:e2e` | Run Playwright against an already running app |
| `npm run test:e2e:headed` | Run Playwright with visible browsers |
| `npm run test:e2e:ui` | Open the Playwright test interface |
| `npm run demo:windows` | Open six isolated demo browser windows |

### Six-identity demonstration

With the seeded demo app running:

```sh
npx playwright install chromium
npm run demo:windows
```

The script opens two TAs and one instructor above three students, all in `cs101`. Each window has its own browser session. Close the windows or press Ctrl+C to finish. `BASE_URL` selects the running app and `DEMO_COURSE` selects another course. This command opens visible windows; it is separate from the automated suite.

## Configuration

Runtime settings are read by [`server/utils/config.ts`](server/utils/config.ts). See [`.env.example`](.env.example) for local values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Required | MongoDB connection string |
| `MONGODB_DB` | `campusworks` | Application database name |
| `SESSION_SECRET` | Stable development value; random per production process | Secret for sealed sessions; set a strong 32+ character value in production, identical across replicas |
| `ENABLE_MOCK_LOGIN` | `true` in development, `false` in production | Allow passwordless demo identities |
| `ADMIN_EMAILS` | Empty | Comma-separated site-administrator emails |
| `GITLAB_BASE_URL` | Empty | GitLab server URL |
| `GITLAB_CLIENT_ID` | Empty | OAuth application client ID |
| `GITLAB_CLIENT_SECRET` | Empty | OAuth application client secret |
| `ALLOWED_EMAIL_DOMAINS` | Empty | Comma-separated OAuth email domain allow-list; empty permits all domains |
| `SEED_DEMO_DATA` | `false` | Seed synthetic courses and enrollments when no courses exist |

For GitLab OAuth, configure all three `GITLAB_*` variables, register `<origin>/api/auth/gitlab` as the redirect URI, and request the `read_user` scope. The login page displays the providers that are configured.

Missing MongoDB configuration produces a configuration error. An unavailable database produces HTTP 503, with a retry on the next connection attempt. Seeding never resets an existing database.

## Architecture and data

```text
app/
  app.vue                  Nuxt layout and page composition
  pages/                   Login, course list, student/TA/management views, help
  middleware/              Authentication and admin-console route guards
  composables/useAuth.ts   Signed-in user state
server/
  api/                     Authentication and course REST endpoints
  middleware/              Request logging
  utils/config.ts          Runtime environment settings
  utils/auth.ts            Sealed sessions and site-admin checks
  utils/courses.ts         Course lookup and scoped permission resolution
  utils/queue.ts           Queue data and session archival
  utils/db.ts              MongoDB connection and indexes
  utils/seed.ts            Synthetic demonstration dataset
playwright/                Browser and API checks
scripts/                   Interactive demonstration helper
k8s/                       Kubernetes demonstration manifests
docs/                      Requirements, review evidence, design, verification
```

| Collection | Main records |
| --- | --- |
| `courses` | Course ID/code, title, queue state, and on-duty staff |
| `enrollments` | Course, user email, and course role |
| `queueEntries` | Student, location, question, position, pause status, TA assignment, and timestamps |
| `helpSessions` | Closed requests with student, TA, join/help/end times, outcome, and ending actor |
| `announcements` | Course messages, author, and creation time |
| `feedback` | Course feedback category, 1–5 rating, positive and negative comments, and contact preference |

Unique indexes are requested for course IDs, course/user enrollments, and course/student queue entries. Startup logs index failures rather than stopping the app, so the verification record should be consulted before assuming uniqueness on an existing dataset.

### Queue workflow

1. A site administrator creates a closed course and adds course staff.
2. A TA opens the queue and starts duty.
3. A student enrolls, supplies a location and optional question, and joins.
4. Staff select the student. Selecting another entry releases the caller's previous assignment during the normal sequential workflow. Staff can flag a request for another TA.
5. Completing or otherwise leaving the queue records a help-session outcome. Students may also leave, pause, resume, or edit their own entry.
6. Instructors review sessions, qualifying help-time analytics, and feedback.
7. Closing the queue archives remaining entries and clears duty. Deleting a course removes its enrollments, queue entries, help sessions, announcements, and feedback.

Outcome values include `completed`, `removed`, `left`, `queue-closed`, and `kicked`. Analytics apply a minimum help-duration filter, so their totals can differ from the full session-history table. Paused queues allow an existing entry to be edited while blocking new arrivals.

Queue archival uses an atomic deletion to prevent simultaneous removal requests from recording the same entry twice. Deletion and history insertion are separate database writes; process interruption between them is a known recovery gap. Assignment, queue state changes, and reordering also use multiple writes without a database transaction. These constraints matter when extending the application with appointment allocation.

### Sessions and permissions

The `campusworks_session` cookie is encrypted and signed, HTTP-only, SameSite=Lax, and valid for seven days. HTTPS requests use secure cookies. OAuth uses a short-lived `campusworks_oauth_state` cookie to check the authorization response. Server-rendered page requests forward the session cookie through `useRequestFetch()`.

Course roles come from enrollments. Site-wide administrator privileges come from the admin demo identity or `ADMIN_EMAILS`. A session's displayed identity does not replace the server's per-course permission checks.

| Capability | Student | TA | Instructor | Course admin | Site admin |
| --- | :---: | :---: | :---: | :---: | :---: |
| Browse courses and enroll | Yes | Yes | Yes | Yes | Yes |
| See queue details, join, and submit feedback | Enrolled | Yes | Yes | Yes | Yes |
| Run queue, duty, and announcements | — | Yes | Yes | Yes | Yes |
| View analytics, feedback, and manage non-admin roles | — | — | Yes | Yes | Yes |
| Grant or change course-admin access | — | — | — | Yes | Yes |
| Create or delete courses | — | — | — | — | Yes |

Course-admin and site-admin columns describe scopes within the administrator identity.

## API reference

Endpoints return JSON; error responses include `statusCode` and `statusMessage`. Unknown API paths return JSON 404 responses.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Database readiness check |
| `GET /api/auth/providers` | Public | Available sign-in methods |
| `POST /api/auth/mock` | Public when enabled | Demo sign-in with `{ as, email? }` |
| `GET /api/auth/gitlab/login` | Public when configured | Begin OAuth sign-in |
| `GET /api/auth/gitlab` | OAuth response | Validate state and establish session |
| `GET /api/auth/me` | Signed in | Current user |
| `POST /api/auth/logout` | Session cleanup | Clear browser session |
| `GET /api/courses` | Signed in | Courses and caller roles |
| `POST /api/courses` | Site admin | Create course with `{ code, title }` |
| `DELETE /api/courses/:id` | Site admin | Delete course and related records |
| `POST /api/courses/enroll` | Signed in | Student enrollment with `{ courseId, enroll }` |
| `GET /api/courses/:id` | Signed in | Course, permissions, announcements, and permitted queue details |
| `POST /api/courses/:id/queue/join` | Enrolled or site admin | Join or edit own entry with `{ location, question? }` |
| `POST /api/courses/:id/queue/leave` | Signed in | Remove caller's own entry |
| `POST /api/courses/:id/queue/pause` | Entry owner or staff | Pause or resume with `{ entryId, paused }` |
| `POST /api/courses/:id/queue/assign` | Staff | Claim, release, or redirect with `{ entryId, assign: true \| false \| "other" }` |
| `POST /api/courses/:id/queue/move` | Staff | Reorder with `{ entryId, direction }` |
| `POST /api/courses/:id/queue/remove` | Staff | Complete or remove with `{ entryId }` |
| `PATCH /api/courses/:id/state` | Staff | Set `{ state: "open" \| "paused" \| "closed" }` |
| `POST /api/courses/:id/ta-duty` | Staff | Change duty with `{ onDuty }` |
| `POST /api/courses/:id/announcements` | Staff | Post `{ message }` |
| `DELETE /api/courses/:id/announcements/:announcementId` | Staff | Delete announcement |
| `POST /api/courses/:id/feedback` | Enrolled or site admin | Submit category, rating, positive/negative comments, and contact preference |
| `GET /api/courses/:id/admin` | Instructor or admin | Sessions, analytics inputs, enrollments, and feedback |
| `PATCH /api/courses/:id/enrollments/role` | Instructor or admin | Set role with `{ email, role }`, subject to admin-role restrictions |
| `POST /api/courses/:id/enrollments/kick` | Instructor or admin | Remove `{ email }`, subject to admin/self-removal restrictions |

## Testing

Start an isolated local instance with demo authentication enabled. The runner connects to an existing app and does not start one automatically.

```sh
npx playwright install chromium
npm run typecheck
npm run test:e2e
```

Set `BASE_URL` to test another local instance. Tests create uniquely named synthetic courses and delete them during successful completion; an interrupted test can leave its course behind. Use a dedicated test database.

| Suite | Focus |
| --- | --- |
| `auth.spec.ts` | Anonymous access, forged/tampered cookies, demo identities, SSR session continuity, logout, and administrator console gate |
| `rbac.spec.ts` | Role restrictions, entry ownership, student email visibility, validation, and sequential assignment behavior |
| `queue-flow.spec.ts` | Four-role UI sequence from course creation through enrollment, queue service, feedback, analytics, closing, and deletion |
| `extended-flow.spec.ts` | Queue edge cases, course boundaries and role revocation, desktop/mobile screens, real CSV downloads, and labeled synthetic analytics |

Additional checks and exact results are recorded in [VERIFICATION.md](docs/VERIFICATION.md). Local automated results do not establish external OAuth, hosted deployment, or production concurrency behavior.

## Deployment

### Docker image

```sh
docker build -t campusworks:latest .
```

Provide `MONGODB_URI`, `SESSION_SECRET`, and any other settings as runtime environment variables. For example, after setting those variables in the shell:

```sh
docker run --rm -p 3000:3000 -e MONGODB_URI -e SESSION_SECRET campusworks:latest
```

The container runs as the `node` user, includes the self-contained Nitro output, and checks `/api/health`. Its database must be reachable from the container; host loopback addresses do not refer to the host machine from inside a container.

### Kubernetes

The [`k8s/`](k8s) directory defines the `campusworks` namespace, a persistent MongoDB instance, app/database Secrets, a two-replica application Deployment, and HTTP service on NodePort 30080.

```sh
docker compose build
kubectl apply -f k8s/
```

The image must be available to the cluster. The supplied manifests enable demonstration login and seeding and contain demonstration credentials. Before a real deployment, supply deployment-specific database credentials, a shared session secret, authentication settings, and `ENABLE_MOCK_LOGIN=false`. A trusted TLS ingress must convey the original request scheme correctly for secure session cookies.

## Operational limits

- Live views use polling every few seconds; student, TA, and manager views suspend refresh while tabs are hidden, while the course directory continues polling.
- Duty restrictions are enforced by UI controls; staff API authorization does not require an on-duty record.
- Session logout clears the current browser cookie. It cannot revoke another copy of that cookie before expiration; rotating the session secret invalidates existing sessions.
- Queue state, assignment, archive insertion, reordering, and course deletion are not one atomic transaction. Concurrent writes and interrupted processes need explicit consideration.
- No application-level rate limiter or comprehensive audit-event system is configured.
- Feedback is identified in manager views even when the student does not request contact; it is not an anonymous survey.
- Production credentials, private records, local database files, and browser/session artifacts must remain outside version control and container build contexts.

## License

Copyright (c) 2025 Haiwei Yu. All rights reserved. The repository uses the proprietary terms in [LICENSE](LICENSE); viewing access does not grant reuse or redistribution rights. Dependencies retain their respective licenses.
