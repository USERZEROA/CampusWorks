# Configuration, operations, and test review

Review date: 2026-11-07. The accompanying `operations-reading-ledger.json` records complete text reading of 22 files and a complete structural JSON inspection of the dependency lockfile. These are static findings; current test results belong in the final verification record.

The delivered project additionally includes fixed-version type-check tools, a dedicated test type configuration, and an aligned Vue Router 5.4.0 dependency. The inspected baseline dependency snapshot below remains a reading record; final versions, passing checks, dependency advisories, and remaining boundaries are in [VERIFICATION.md](../VERIFICATION.md).

## Runtime and dependencies

The application is Nuxt 4 with Vue 3 and Nitro REST routes. MongoDB is mandatory: `server/utils/db.ts` has no in-memory or local-file fallback. An absent database URI yields a configuration error, and an unavailable server yields HTTP 503 after a five-second selection timeout. Connections are lazy, shared, and retried after connection failure. Index creation failures are logged while startup continues, so an existing duplicate dataset can weaken uniqueness guarantees.

`package.json` requires Node `^22.21.0 || ^24.11.0 || >=26.0.0`; `.nvmrc` selects major version 22. The inspected lockfile resolves Nuxt 4.6.3, Vue 3.5.44, Vue Router 4.6.3, MongoDB driver 7.0.0, and Playwright 1.56.1. It has lockfile version 3, 647 package records, 4 development-only records, and 81 optional records. All resolved HTTP package downloads use the npm registry. Complete JSON parsing establishes structural readability; it does not establish dependency security or software license compliance.

Scripts provide development, production build, production startup, preview, Playwright tests, and a six-identity browser demonstration. There is no configured CI workflow, test server launcher, or explicit type-check script. A build is necessary but does not establish end-to-end behavior or exhaustive type correctness.

## Configuration and authentication

Environment variables are read at runtime by `server/utils/config.ts`, independently of build-time client configuration. The template includes database configuration, session secret, demo-login toggle, administrator email list, GitLab OAuth settings, allowed email domains, and demo-data seeding. Actual local environment files contain private configuration and must remain outside the tracked project and build context.

The development session secret is stable across development restarts. Short provided secrets are hashed to satisfy the session library length requirement. Missing production secrets generate a per-process random secret, so production replicas and restarts require an explicit shared secret to preserve sessions. Demo login defaults off in production, but Docker Compose and Kubernetes demo manifests explicitly enable it. The OAuth provider requires all three provider fields. The domain allow-list applies to OAuth sign-in, and an empty list permits all domains.

## Containers and cluster configuration

`Dockerfile` uses a Node 22 Alpine build stage with `npm ci`, then a separate Node 22 Alpine runtime carrying only Nitro output. The runtime runs as the unprivileged `node` user and checks `/api/health`. The Docker context excludes local secrets, private material, Git metadata, dependency directories, generated data, and test artifacts.

`docker-compose.yml` defines MongoDB 7 and the app, uses a named database volume, binds MongoDB to the loopback interface, and waits for MongoDB health before starting the app. The app serves HTTP on 3000. Database credentials and the fallback session secret are public demonstration values, and should be described as such in project instructions.

The five Kubernetes files define a namespace, MongoDB credentials, app settings, one MongoDB StatefulSet with a 1 GiB claim, the database service, and a two-replica application Deployment with a NodePort service. The application resolves database credentials from a Secret. Readiness checks `/api/health`, while liveness checks the TCP listener. Resource requests and a memory limit are present. The cluster manifests remain demonstration configuration: seeding and demo authentication are enabled and credentials are placeholders. Namespace and resource names must stay consistent across the five files when setting project identity.

No container build or Kubernetes deployment was performed as part of this static review. Local tool inventory found Docker installed and Node 24.21.0 available. The initial sandboxed Docker metadata query was denied by the named-pipe access boundary; the main task owns the approved isolated database setup and subsequent verification.

## Existing automated coverage

The configured browser project is desktop Chromium. Tests run serially with one worker against an already running instance selected by `BASE_URL`, which defaults to `http://localhost:3000`. The configuration retains traces, screenshots, and video after failure and writes an HTML report. No web server is launched by the test runner itself. A valid test environment needs demo authentication and an isolated MongoDB database.

There are 22 test declarations across three suites:

| Suite | Tests | Established assertions when executed successfully |
| --- | ---: | --- |
| `auth.spec.ts` | 6 | Anonymous redirects and API rejection, forged and tampered cookie rejection, demo sign-in, SSR reload, sign-out, separate demo identities, and site-admin console access |
| `rbac.spec.ts` | 7 | Student restrictions, queue email visibility and ownership, outsider restrictions, TA operations, sequential one-active-entry behavior, instructor role limits, and malformed input rejection |
| `queue-flow.spec.ts` | 9 | Four-role UI sequence from course creation and enrollment through queue duty, joining, assignment, completion, feedback, session review, queue closing, and cascade deletion |

`playwright/helpers.ts` waits for Vue hydration, creates unique course identifiers, signs in browser/API identities, and creates course enrollments. The queue-flow test intentionally holds a help session for seven seconds so it qualifies for the analytics minimum duration.

Coverage boundaries are material. The tests do not establish real provider OAuth, concurrent claims, process-crash recovery, persistent browser session revocation, full mobile rendering, production infrastructure behavior, or complete per-endpoint role coverage. Queue handoff, queue ordering, all pause/edit paths, announcement deletion, CSV content safety, and all lifecycle edge cases need additional explicit checks where parity evidence is required. A test name or README claim must not be treated as proof of a successful run.

Test cleanup is incomplete on intermediate failures: the serial UI suite closes browser contexts in `afterAll`, while final course deletion occurs in its last test. An earlier failure can therefore leave its uniquely named synthetic course behind. Isolating the verification database avoids affecting real coursework or shared data.

## Demonstration script and data boundaries

`scripts/demo-windows.mjs` opens six separate, signed-in Chromium browser windows: two TAs, one instructor, and three students. It checks application health first, uses separate browser sessions, tiles windows using the Windows working screen area, and shuts browsers down on termination. It makes writes through the mock sign-in endpoint and requires a running seeded demonstration instance. It is an interactive demonstration utility and should be launched only when visible windows are requested.

The initial metadata inventory identified generated output, local session artifacts, private human notes, editor configuration, local database state, and an environment file. Selected human notes and the local archive helper were read for operational context after task authorization. Their content, credentials, session transcripts, database files, and historical repository archives are excluded from the deliverable. Raw session logs and archived conversation transcripts were not read. Generated dependency/build trees were inventoried as generated material, not claimed as semantically reviewed application code.

## License and publication boundaries

`LICENSE` reserves copyright to Haiwei Yu and restricts use without the owner's written permission. The owner explicitly requested this local development work. Preserve the copyright and license text exactly, and avoid unsupported independent-authorship claims. Dependencies retain their own licenses. No remote push, public publishing, provider sign-in, private upload, or shared-database write is part of this review.

## Verification priorities

1. Run a production build against a clean dependency installation.
2. Start the app with explicit local database and authentication settings, without importing private environment configuration.
3. Run all 22 existing browser/API checks and record the exact result.
4. Add focused verification for uncovered queue, announcement, role, feedback, analytics, and CSV behavior where needed.
5. Verify all four roles, desktop/mobile layouts, Duke blue styling, asset references, and navigation.
6. Scan tracked content and commit subjects for project identity consistency and accidental private material.
7. Distinguish local evidence from provider, deployment, and production evidence in the completion report.
