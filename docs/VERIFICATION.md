# CampusWorks verification record

Date: November 7, 2026. This record covers the implemented queue, TA/RA recruitment, appointments, reporting and optional AI adapter. Evidence uses synthetic local data. [Staffing operations](STAFFING_OPERATIONS.md) describes exact behavior and institutional decisions.

## Final acceptance

The final complete local run passed **112 tests**, with zero failed, skipped or flaky results. An additional **twelve visible-browser tests** passed against the final Linux production container, also with zero failed, skipped or flaky results. Three dependency-security unit tests, application/server/test type checks and the production build passed before the complete run. Exact names, durations, evidence hashes and boundaries are recorded in [results.json](verification/results.json).

The accessibility and branding runs checked eighteen pages at 1440px, 768px, 390px and 320px in Chromium and Firefox: 144 page/browser/width combinations in the complete run and another 144 against the visible-browser container target, with zero reported violations in the configured WCAG rules. Paused queue dialogs and the configured institutional-login view received additional accessibility checks. Every matrix page asserts Duke blue, the Duke Computer Science PNG source, descriptive alternate text, successful image loading and viewport bounds; a separate HTTP check compares the served PNG bytes with the tracked asset. Screenshots of the actual TA, RA, automatic candidate update and mobile application journeys were visually inspected.

| Check | Evidence and boundary |
| --- | --- |
| Clean Windows dependency installation | `npm ci` completed from the lockfile, including the local safe dependency |
| Dependency audit | Zero reported vulnerabilities across all severity levels in the final npm advisory snapshot |
| Dependency security | Three regressions check prototype keys in both inputs, merge compatibility and the resolver's actual implementation |
| Types and production build | The complete local runner checks app, server and test types, then builds the Windows production app |
| Linux production image | Clean Node 22 Alpine installation and production build; runtime uses unprivileged `node` |
| Authenticated database bootstrap | Fresh local Compose project initializes its key file and replica set; bootstrap container exits zero |
| Cross-instance acceptance | Separate production Node processes share a disposable MongoDB replica set, session secret and synthetic database |
| Visible browsers | Chromium and Firefox exercise real pages, forms, uploads, downloads and navigation |
| Accessibility | WCAG 2 A/AA and 2.1 AA axe scans of eighteen authorized screens at 1440px, 768px, 390px and 320px in both browsers; keyboard focus trap/Escape/restore checks |
| Container browser acceptance | Actual recruitment-to-queue and keyboard/accessibility journeys target the Linux production image with an authenticated database |
| Content and Git | Naming, private-path and whitespace scans; functional changes have single-sentence English commit subjects |

No GitHub Actions, real identity provider, real AI provider, external email, payroll integration, remote push, publication or Kubernetes cluster was used. Browser documents must return HTTP 200, show the CampusWorks title, contain their main landmark and retain the expected authorized route before their accessibility result is accepted. This prevents an error/redirect page from passing as the intended screen.

## Executed behavior

The tests include the existing four-role queue journeys and these explicit boundaries:

- Cross-instance close/join races, duplicate joins, competing claims/reordering and duty/demotion races.
- A MongoDB insert fault during archival: the failed transaction preserves the active entry and history remains unchanged; retry produces exactly one archive.
- Active help segments across pause/release/handoff and attribution cleanup after staff authority changes; self-claim cannot create helped sessions.
- Copied-cookie logout revocation, forged sessions, shared rate limiting, origin checks, strict flag/pagination validation and live required-index readiness.
- Institutional sign-in through a loopback fake provider, immutable subject binding, changed/reused email refusal and demo impersonation refusal.
- Concurrent selection of one candidate across courses, the final vacancy/budget, withdrawal versus selection, stale edits and replayed commands.
- Cross-term TA/RA half-appointment races, adjacent date intervals, consistent accept/clear/resume conflict checks, disabled-account suspension and release, and replacement allocation safety.
- Offer acceptance/decline/expiry, date-valid activation, clearance restrictions, suspension/resume/end and preservation of manual roles.
- Private draft/CV boundaries, submitted CV snapshots, invalid documents, required questions, restricted administrative information and restricted clearance reasons.
- Administrator-owned publication approval, RA project-only access, workload bounds/idempotency, complete report aggregation and financial settlement before course deletion.
- Durable offer notifications, recipient-only read state, duplicate-free delivery and rescinded-offer notification.
- Unconfigured AI, configured loopback provider responses, evidence/privacy validation, invented evidence rejection, availability becoming stale during a call, safe provider failure and durable quota refusal before a provider call.
- Automatic comparison updates across two configured workers, logged-out scoped faculty, changes during inference, time-only offer expiry, permission revocation, configuration restart/catch-up, failure retry prevention and durable quota blocking. An actual reviewer browser shows updated named candidate links without sending another analysis POST.
- Independent term/report pagination preserves full aggregate values and resets report pages after scope changes. Interactive demonstration setup is repeatable and prepares submitted synthetic candidates for all four roles.
- Faculty publishing, student application and CV upload, faculty shortlist/selection, student acceptance, administrator clearance, TA queue/duty and live removal of appointment-derived access through browser controls.
- Desktop/mobile widths, retained Duke blue/logo, actual CSV parsing with formula protection, empty analytics, nearest-rank P90 and a complete single-TA ring using a labeled synthetic response fixture.

Synthetic metric fixtures do not represent actual course outcomes. A loopback fake provider establishes the adapter's tested contract and failure handling, not a real model's quality or institutional SSO configuration.

## Review coverage

The final source review covered maintained application/server code, scripts, tests, the local dependency and operational configuration through domain review and an integration pass. The core reviewer checked commitment locking, all appointment transitions, disabled-account cleanup and private clearance reasons, then independently audited the automatic worker's generation, cache, event-claim and approval fences. The staffing reviewer covered the worker, provider adapter, subscriptions and seven automatic-update regressions. The interface reviewer read all 34 app files for style, logo, interaction and role consistency. The primary reviewer integrated findings, read the changed source and acceptance suites, added the actual automatic-advice browser check, and exercised the production application.

The current [application inventory](verification/application-inventory.json) records delivered file hashes and physical line counts. The [final reading ledger](review/final-reading-ledger.json) identifies maintained source/test bytes covered by domain and integration review. An inventory is a coverage receipt rather than semantic proof. Initial review snapshots and their byte ledgers remain in [review/](review/) and are explicitly historical. Their unresolved findings do not describe current implementation status.

The lockfile was fully parsed and its dependency structure and override paths checked. The Duke CS PNG was visually inspected and loaded by the browser; public SVG/text was read. The unused ICO is inventoried as binary. Generated dependencies, build output, private environment settings, local databases and raw conversation archives are outside handwritten-source review coverage. A source review and passing finite suite are not an exhaustive security proof.

## Resolved review findings

| Finding | Final behavior and verification |
| --- | --- |
| Queue state, claims and ordering could race | Canonical course write and snapshot/majority transactions serialize transitions across instances; races exercised locally |
| Entry removal could lose history | History insert and entry removal share one transaction, unique archive key and fault-injection regression |
| Duty, role revocation and appointments could disagree | Server checks current effective authority; transitions release duty/claims while preserving independent manual grants |
| Best-effort uniqueness and standalone database | Mandatory indexes/topology gate initialization and live readiness; missing-index regression returns 503 |
| Saved cookies survived logout | Revocable database sessions shared across replicas; copied-cookie test |
| Email-only identity could duplicate/inherit authority | Stable provider/issuer/subject binding, fail-closed email changes/reuse and mock impersonation checks |
| Unbounded reads and weak request controls | Paged lists, bounded queue/body/CV sizes, strict input/origin checks and shared rate limits |
| Help duration could include pauses or wrong helper | Explicit actual help segments and per-helper attribution; measured and submitted work remain separate |
| Dependencies had advisories | Framework/tooling updates and an MIT local prototype-safe merge implementation; clean installs/builds and zero-advisory snapshot |
| Private administrative fields could enter review | Separate post-offer endpoint/version, restricted projections/downloads and qualification-only AI evidence |
| Publication checkbox could bypass policy | Site-admin-owned term approval controls publication; regression |
| Async UI could fail SSR or retain revoked private data | Nuxt context captured before awaits; authenticated HTTP-200 journeys, request guards, state cleanup and role redirects |
| Modal/table/contrast accessibility | Keyboard trapping/restoration, named scroll regions and corrected status/muted colors; real axe scans |
| Reserved course identifiers were unreachable | Creation rejects `null` and `undefined` before storage; regression |
| RA authority depended on the first history page | Current grant query is independent of paged history; a 101-record history regression preserves valid access and exposes further pages |
| Course review and RA work forms were inaccessible | Bare-course redirect no longer replaces nested review navigation; researcher work forms use explicit reactive identity checks; real browser journeys cover both |
| Ended appointments could lose their settlement path | Unsettled commitments block course deletion until approved settlement; regression |
| Rescinded offers lacked candidate notification | Durable candidate notification and browser/API-visible status |
| Retention setting did nothing | Removed the misleading unused setting; institution must choose a real retention/deletion policy |
| Different term IDs could bypass commitment exclusivity | Canonical applicant write serializes `[start,end)` overlap checks across TA/RA resources and terms; half appointments cannot coexist |
| Candidate advice required manual recomputation | Durable scoped worker automatically updates changed evidence/availability with current authority, quotas, coalescing and generation fences |
| Old worker observations could overwrite newer work | Conditional event claims, captured generations and approval versions fence invalidation, cache restoration and revocation |
| Private rejection reasons could appear as end reasons | Generic public end reason plus restricted clearance fields, including legacy-row projection; professor/owner/admin regression |
| Published schedule and role controls were ambiguous | Required slots are visible; manual grants are labeled and linked to appointment controls; course review has independent paging |

The safe merge override uses a direct local dependency reference so npm resolves it consistently from the project root. A clean Linux build initially exposed an incorrect nested link that a warm Windows install had hidden; the corrected lockfile was verified by fresh Windows and Linux installs. The upstream MIT notice remains intact. [npm override documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides)

## Confirmed policy and evidence limits

The owner has prohibited overlapping and simultaneous half appointments, retained existing manager-controlled departure and course/site administration, declined additional retention/document/HR features, and authorized automatic candidate reanalysis after relevant changes. [PRODUCT_POLICY.md](PRODUCT_POLICY.md) records those decisions. Provider credentials will be supplied separately; local tests use only synthetic loopback providers.

Six isolated interactive windows were opened after acceptance: student queue, TA queue, instructor management, administrator staffing, student applications and faculty recruitment. They use a separate demonstration database at `http://localhost:3100`, with real AI and institutional providers disabled. The existing service on port 3000 was left running. The demo remains available for the owner; verification containers and processes are separate.

Kubernetes runtime, failover/replica-set high availability, sustained production load, Safari/WebKit, screen-reader hardware, physical phones and hosted behavior were not verified. Basic document format checks are not antivirus certification. Feedback remains identified to managers. More detail is in [STAFFING_OPERATIONS.md](STAFFING_OPERATIONS.md).
