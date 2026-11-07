# Server behavior review

Review date: November 7, 2026. All 34 files under `server/` were read completely. The accompanying JSON ledger identifies the reviewed bytes, physical line counts, and semantic coverage. This document describes static code evidence; it does not claim database, browser, external identity-provider, production, or concurrency verification.

## Identity and roles

There are four course roles: `student`, `ta`, `instructor`, and `admin`. The session also has a `primaryRole`, but a course role comes from the matching enrollment. Global administration is granted by session role `admin` or `ADMIN_EMAILS`. A primary TA or instructor role alone does not grant rights in an arbitrary course.

Sessions use an encrypted and signed, HTTP-only cookie with seven-day expiry, SameSite Lax, HTTPS-sensitive Secure, and a server-side session password. An invalid or expired cookie yields no authenticated user. Existing unsigned identity cookies are never trusted. User email addresses are normalized to lowercase.

GitLab sign-in checks a random, ten-minute OAuth state cookie, exchanges the authorization code, retrieves the profile, checks the optional email-domain list, and grants global administration only through the configured email list. Demo sign-in is controlled by `ENABLE_MOCK_LOGIN`; it is enabled by default outside production and permits choosing any of the four roles. Production configuration must keep this off unless deliberately operating a demo.

| Operation | Student / unenrolled caller | TA | Instructor | Course admin | Global admin |
| --- | --- | --- | --- | --- | --- |
| Course catalog and metadata | Authenticated callers | Yes | Yes | Yes | Yes |
| Queue contents | Enrollment required; own email visible | Staff view | Staff view | Staff view | Staff view |
| Enroll or leave as student | Own enrollment | Existing staff role preserved | Existing staff role preserved | Existing staff role preserved | Existing staff role preserved |
| Join queue or submit feedback | Enrollment required | Yes | Yes | Yes | Yes |
| Leave queue | Own entry | Own entry | Own entry | Own entry | Own entry |
| Pause or resume entry | Own entry | Any course entry | Any course entry | Any course entry | Any course entry |
| Queue state, claims, moves, completion, duty, announcements | No | Yes | Yes | Yes | Yes |
| Analytics and enrollment management | No | No | Yes | Yes | Yes |
| Grant, change, or remove course admin | No | No | No | Yes | Yes |
| Create or delete course | No | No | No | No | Yes |

Non-global managers cannot change their own course role. Nobody can remove themselves through the enrollment removal endpoint. An instructor can grant or change another non-admin instructor role. Course staff may claim an entry already claimed by another TA; this is deliberate takeover behavior.

## Data and course lifecycle

The database has six application collections: `courses`, `enrollments`, `queueEntries`, `helpSessions`, `announcements`, and `feedback`. A stable course key is chosen from `id`, then `code`, then `_id`. Course lookup accepts internal `id`, exact `code`, or a lowercase code. Duplicate historical enrollment rows are read using the highest privilege.

Course creation normalizes the code to lowercase, restricts it to letters, digits, period, underscore, and hyphen, starts the queue closed, and grants the creator a course-admin enrollment. A duplicate code is rejected before insertion. Course deletion permanently deletes the course and the five associated child collections. There is no term dimension, staffing appointment, application record, document store, workload budget, or research-project entity yet.

Students can enroll through the catalog. Leaving removes only a student enrollment and archives any active queue entry. A staff member's role is preserved by the student enrollment endpoint. Managers can upsert another user's course role or remove that user. Moving a user to student clears their duty entry; removing a user also clears duty and archives their own student queue entry.

## Queue lifecycle

The queue has three states: `open`, `paused`, and `closed`. New joins need `open`; an existing entry may be edited while `paused`; no join/edit is allowed while `closed`. Joining requires a nonempty location, bounds location to 200 characters and question to 1,000 characters, and clears the entry's paused flag. Existing entries retain their queue position and existing assignment fields. Each student is intended to have one queue entry per course.

A staff member can claim an unpaused entry, transfer an existing claim, clear a claim, or mark it as needing another TA. Claiming attempts to release any other entry assigned to that staff member in the same course. The first claim creates `helpStartAt`. Pausing an entry clears the current TA claim. Reordering swaps the numeric position with the nearest neighbor. Queue reads sort by position and then creation time.

Completion, staff removal, student departure, course withdrawal, kicking, and queue closure all call the shared history helper. A removal without `helpStartAt` becomes `removed`; an entry with any help-start timestamp becomes `wasHelped`. The history retains student, staff, location, question, join/start/end timestamps, reason, and actor. Repeating an already-completed removal normally creates no second history row.

Closing the queue archives its remaining entries and clears duty. Duty uses staff email plus display name; old plain-name values are also understood. Announcements can be created or deleted by any course staff member.

## Visibility and feedback

An authenticated but unenrolled caller sees course metadata, announcements, duty names, and queue length, but no queue entries. An enrolled student sees queue names, locations, and questions; email is revealed only for their own entry. Staff see all queue emails. Course analytics are limited to managers and global admins and include raw enrollment, queue, session-history, and feedback records.

Feedback requires enrollment, one of `queue`, `ta`, `wait`, or `other`, an integer rating from one through five, and nonempty positive and negative text. Text is limited to 2,000 characters per response. Identity is stored and returned to managers regardless of `allowContact`; the flag controls recorded contact preference and does not make the response anonymous.

## Reliability findings and verification priorities

These are observed code limitations, with their consequences separated from behavior demonstrated by tests.

1. **History persistence is not atomic.** `archiveEntry` first deletes the active entry and then inserts its history in a separate operation. A failure between those operations can lose both the active entry and its history. The helper's atomicity comment exceeds what the two database operations guarantee. Require a durable transaction or equivalent recovery design before treating history as authoritative for staffing recommendations.
2. **Queue closure races with joins.** `state.patch.ts` archives entries before storing the closed state. A concurrent request can observe `open`, insert an entry after the archive snapshot, and leave an active entry in a closed queue. Test concurrent join/close with a real database and establish a shared synchronization rule.
3. **Position assignment and moves are not serialized.** New positions use read-max-plus-one, and a move uses two writes. Concurrent joins can share positions; concurrent moves can produce unexpected ordering. The creation-time secondary sort stabilizes some displays, but does not guarantee a strict queue sequence. Test simultaneous joins and overlapping moves.
4. **One active claim per TA is best effort.** Claiming releases prior entries and sets the new claim through separate writes. Concurrent claims by the same person can leave multiple assignments. Duty uses separate pull/push writes and can likewise duplicate entries under concurrent requests. Test both cases before claiming concurrency safety.
5. **Indexes are best effort.** Failures to create unique enrollment or queue indexes only log warnings. Existing duplicate data can therefore disable uniqueness enforcement while the service remains available. Verify index status in the database and distinguish a successful health ping from established data invariants.
6. **Help timing has limited meaning.** Releasing or pausing an entry retains `helpStartAt`. A later completion may count the entire interval as help time. Takeover preserves the original start time but replaces the credited TA. These records do not measure paid TA hours, attendance, lab work, discussion sections, grading, or total course demand.
7. **Multi-record changes can partially succeed.** Course creation/enrollment, course deletion, enrollment-role changes, removal/cleanup, and initial demo seeding use multiple independent writes. A database failure can leave partially applied state. Failure-injection and recovery checks would be needed for stronger guarantees.
8. **No pagination or retention boundary exists.** Catalog and manager endpoints read all matching documents into memory. History and feedback can grow without bounds. Capacity and retention policies are prerequisites for a multi-term rollout.
9. **Contact consent is not anonymity.** Manager responses contain feedback identity even when follow-up contact is declined. Applicant and course-feedback interfaces must describe this accurately; employment eligibility and CV access need stricter, separate permissions.
10. **Configuration is process-local.** Missing production session secrets cause random per-process values, preventing session continuity across restarts or replicas. A short configured secret is hashed rather than rejected. OAuth redirect origin trusts forwarded host/protocol input, so deployment must establish a trusted proxy boundary.
11. **Request validation is uneven.** Student enrollment treats any truthy `enroll` value as enrollment, and absence as leaving. Typed client calls do not provide runtime input guarantees. Some route bodies accept values coerced to strings. Direct API checks should include malformed types, invalid identifiers, cross-course entry access, and permission failures.

The present endpoints provide a practical integration boundary: an accepted and activated TA appointment can create a `ta` enrollment for the correct course, while all normal course operations continue using `getCourseAccess`. TA appointment privileges must remain course-scoped. An RA appointment needs its own project scope and should not receive TA queue rights merely because it is an employment appointment.

## Check boundaries

This review covers complete reading of all 34 server files. It does not assert that any of the reliability findings has been corrected. It does not assert an exhaustive security audit, real SSO verification, database transaction coverage, or deployment readiness. Use the application checks and recorded browser/API results to establish what actually runs.
