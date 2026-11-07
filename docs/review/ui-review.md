# CampusWorks interface review

Reviewed on 2026-11-07. Every line in the 12 application Vue/TypeScript files was read, including scripts, templates, comments, and scoped CSS (7,640 lines). Both public text assets were read. The Duke CS PNG was visually inspected. The favicon was inventoried as a binary asset; its appearance was not rendered. Per-file SHA256 values and coverage states are recorded in `ui-reading-ledger.json`.

This is a static reading record. It establishes screen and interaction contracts, but does not establish working browser behavior, authentication-provider behavior, or production readiness. Browser checks below need their own results.

Subsequent local verification corrected findings 1-3 and an administrator mobile-table overflow, while preserving the interface contracts. Current results and remaining limitations are in [VERIFICATION.md](../VERIFICATION.md).

## Four roles and access

The four account role values are `student`, `ta`, `instructor`, and `admin`. Account primary role and a course enrollment role are distinct. Course screens use server-returned effective course capabilities (`isStaff`, `isManager`, `enrolled`), rather than treating every account primary role as a universal grant. `isGlobalAdmin` independently gates the site console.

| Role | Main experience | Course management |
| --- | --- | --- |
| Student | Browse courses, enroll or leave, enter the queue, edit/pause/resume/leave an entry, read announcements, submit structured feedback | No course management |
| TA | Staff queue, duty toggle, queue state, claim/reselect/complete/handoff, pause/remove/reorder entries, create/delete announcements | No manager link unless server grants manager capability |
| Instructor | Course Admin from the course list; Live Queue opens the staff view | Analytics, CSV, feedback, add/change/remove eligible enrollments; cannot grant or change an admin enrollment unless also an admin |
| Admin | Site console plus course management and staff views | Create/delete courses; manage course administrators when effective permissions allow |

The course list labels instructors and admins together as `Instructor/Admin`; it does not collapse the underlying role values. Students can toggle only student enrollment. Staff rows show `Managed via role` instead of a self-enrollment toggle.

`auth.global.ts` retrieves a user when the state is empty and rechecks every visit to `/login`. Anonymous paths redirect to `/login`; signed-in `/login` and `/` redirect to `/courses`. Non-global-admin `/admin/*` visits redirect to `/courses`. `/courses/:id` defaults to the student child route, which forwards staff to `/courses/:id/ta`. A nonstaff visit to a TA child route forwards to the student route. Unauthorized Course Admin data fetches lead to `/courses` (or `/login` for 401).

## Appearance contract

Preserve the existing scoped CSS, responsive breakpoints, information hierarchy, actions, and layout. Changing the application display name and its dedicated app icon does not require changing the Duke CS identity asset.

| Element | Existing contract |
| --- | --- |
| Primary Duke blue | `#012169` navbar/banner, titles, and important role pills |
| Secondary blue | `#17408b` panel headers, primary buttons, outlined controls |
| Page surface | `#f3f5fa`, white cards, light gray table headers, soft shadows |
| Typography | system-ui, Apple system font, BlinkMacSystemFont, Segoe UI, sans-serif |
| Shared navigation | Duke CS logo, centered application name, Help & Info, current email, Logout |
| Status colors | Open green, Paused amber, Closed red; paused entry pale yellow, assigned entry light blue, handoff entry pale green |
| Card treatment | Mostly 10px radius; rounded pill labels/navigation actions; login card 14px radius with blue top border |
| Desktop widths | Login 520px; Help 900px; site console 1000px; course directory 1100px; student/TA 1300px; Course Admin 1200px |
| Queue layout | 320px left controls column and flexible right announcements/queue column |
| Small screens | Header wraps; email hidden at narrow widths; student layout becomes one column at 900px, TA at 1100px; table scrolling and compact actions |

The Duke CS image is a 381x70 blue/white department mark with the university name, geometric emblem, and department text. Keep its bytes and aspect ratio. The app SVG has a rounded Duke-blue square and white letterform; update application-specific labeling consistently. The favicon is a separate 4,286-byte binary asset.

## Screens and workflows

### Sign in

`/login` reads `/api/auth/providers` on server render. GitLab login appears only when enabled and can show allowed email domains. Demo login can show configured one-click named accounts, an optional email field, and separate Student, TA, Instructor, and Site Admin buttons. Buttons remain disabled until mounted, then while login is pending. Successful login updates shared auth state and navigates global admins to `/admin/courses`, everyone else to `/courses`. Provider errors are shown inline. If no method is configured, the screen explains the required configuration.

The GitLab button navigates externally to `/api/auth/gitlab/login`. The demo form posts the chosen role and optional email to `/api/auth/mock`. Demo-role colors, card spacing, banner, and explanatory text are part of the current sign-in experience.

### Course directory

`/courses` renders My Courses when memberships exist, followed by All Available Courses. Both tables show course code/title and effective membership labels. My Courses includes Open/Paused/Closed and Go. All Available Courses includes Go and Enroll/Leave where allowed. Navigation chooses manager, TA, or student view using the effective course role. Enrollment changes refresh the directory after success; errors use the server message in an alert. Global admins see the Admin Console button.

The directory refreshes every five seconds and clears its timer when unmounted.

### Student queue

`/courses/:id/student` shows the course code/title, queue state and length. Left-side cards show on-duty staff, current position and help/pause/handoff status, enrollment or queue actions, current email, and feedback action. Right-side cards show a read-only announcement table and the live queue.

An unenrolled visitor can enroll from this screen. New queue entry is enabled only when enrolled and Open. The join/edit modal shows a read-only name, location, and optional question. Location is trimmed and required. Existing entries can be edited, paused/resumed, or left. A current helper message appears only while the entry is assigned and neither paused nor waiting for another TA. Position uses the index in the server-returned ordered queue.

The feedback modal provides a topic (`queue`, `ta`, `wait`, `other`), 1-5 rating, What worked well, What can be improved, and permission to contact by email. Both narrative answers are required by the UI; rating defaults to 5 and contact permission defaults to true. Success alerts, closes, and resets the modal; cancel also resets.

Student data refreshes every two seconds while the tab is visible. Every mutation refreshes immediately. The timer is cleared when the page unmounts.

### TA queue

`/courses/:id/ta` keeps the two-column queue layout. Staff can open a closed queue; while Open or Paused they can toggle duty, pause/resume the queue, and close it. Closing with entries asks for confirmation that remaining entries will be ended and saved to history. Only on-duty staff can operate entries, while queue state and announcements use the staff capability independently.

Entry actions preserve these states:

- Unassigned: Select; assigned to current staff: Complete and Other TA; assigned to someone else: Re-select; paused: disabled Paused button.
- Select posts an assignment. Complete posts removal. The server is responsible for releasing another entry previously held by this TA.
- Other TA is available only to the current assignee; it posts the handoff marker.
- Pause/resume, remove with confirmation, and up/down ordering are visible with duty and boundary disables.
- Assigned rows are blue; paused rows yellow; Needs another TA rows green.

Staff can post a trimmed nonempty announcement using a button or Enter and delete an announcement. The UI currently displays delete controls for all announcements; the server decides authority. Managers also see Course Admin. TA data refreshes every three seconds in visible tabs and clears the timer on unmount.

### Course Admin

`/courses/:id/admin` has the shared navigation plus Live Queue. A global admin's Back action returns to the site console; other managers return to the course directory. The header includes course identity, queue Open/Pause/Close controls, state, and active-entry count. Closing nonempty queues requires confirmation.

The analytics panel defaults to the last 30 calendar dates using date inputs. A filtered raw-session table shows student/name/email, TA/name/email, join/help/end/leave times and outcome, and offers CSV download. Outcomes distinguish completed, removed, left, closed, kicked, and unhelped records. CSV includes identity, timestamps, reason, location, and question; cells are quoted and initial formula-triggering characters are prefixed with an apostrophe.

Summary metrics and chart inputs count only sessions with a student email, identifiable TA, valid join date, and positive help duration after rounding. Cards show sessions, unique students, active TAs, average wait, average help, and P90 wait. Raw history and CSV can therefore contain more rows than the Sessions summary; this distinction must remain explicit in future reporting. Duration fallback logic is described under findings.

The chart selector chooses students helped per day (stacked by TA), Portion by TA (donut), or Average TA help time (bars). Charts are built directly with CSS/SVG, use a stable per-page color map, and expose mouse tooltips and legends. Axes use a padded human-friendly maximum.

The feedback table shows time, student, topic, rating, positive/negative narratives and contact permission. Enrollments & Roles supports Add / Update TA by email, a four-role selector, Set TA, Set Student, and Remove. Self-edit controls are disabled. An instructor cannot select Admin or modify an existing admin enrollment unless the server also grants admin authority. Failed role changes refresh enrollment data to undo a local select change.

Manager data refreshes every three seconds in visible tabs and clears the timer on unmount.

### Site console and help

`/admin/courses` shows Create Course (trimmed code and title required) and All Courses with Go/Delete. Delete asks for confirmation describing course data deletion, then refreshes. There is no polling timer on this page. The Help page provides student enrollment/queue instructions, staff duty/state/actions/handoff guidance, manager analytics/CSV/role guidance, and what information to include in a problem report.

## Findings for explicit verification

These findings arise from static reading. They are not claims of demonstrated browser failures or authorization defects.

1. Student mobile overflow selector: CSS targets `.panel-body.queue-panel`, but the student live-queue body has only `panel-body`. Long table content may overflow or clip on phones. TA instead applies horizontal scrolling directly to descendant tables. Verify at 390px and narrow landscape widths before claiming mobile equivalence.
2. A single-TA donut builds one SVG arc from 0 to 360 degrees. SVG arc endpoints coincide for a full circle, which can leave the ring empty. Check a course with exactly one TA represented.
3. P90 uses `floor(n * 0.9) - 1` clamped to zero, rather than a nearest-rank ceiling. For small datasets such as two values, it selects the lower value. Define the intended statistical convention before relying on staffing conclusions.
4. Missing help-start dates fall back to join time when calculating durations. An attributable session without help-start evidence can appear as positive help duration if it has an end date. Conversely, sessions below roughly three seconds can round to 0.0 minutes and be excluded. Future workload reports need explicit definitions and unrounded source values.
5. Date inputs serialize with UTC while chart day grouping and displayed timestamps use browser local time. End-date filtering includes the exact next-midnight instant (`<= end`) as well as the selected last day. Verify midnight boundaries and timezone labels.
6. Course list polling runs in hidden tabs, unlike the other three live views. This affects request volume; it is current behavior rather than evidence of a queue failure.
7. Role redirects occur during initial setup. A role change while a view remains open updates the fetched capabilities, but does not rerun the initial imperative redirect. Backend gates must remain authoritative for subsequent actions.
8. `signOut` ignores request errors before clearing client state. If the server session remains valid after an unsuccessful logout, the login guard can route the user back into courses. Check failed-network logout behavior separately from successful logout.
9. Modals use generic containers without dialog roles, focus trapping, Escape handling, or explicit focus restoration. Some clickable logo/title navigation uses `div` click handlers. Mouse interaction alone does not establish keyboard accessibility.
10. Many mutation actions have no dedicated busy state. Rapid duplicate submissions and concurrent staff actions must be checked against server invariants.
11. The shared auth state is only rechecked on login or when empty. Server-returned course role and permission gates are therefore the current authority for effective privileges and session expiry.

## Browser acceptance checklist

- Anonymous/login/root routing; all four sign-in buttons; one-click accounts; user/email and logout; provider-disabled state; global-admin console restriction.
- Course list My Courses, staff role labels and destination, student enrollment/leave, queue status refresh, Help round trip.
- Student enrollment gate; open versus paused/closed join; required location; join/edit preserving order; own entry marker/position; pause/resume; leave; current helper and handoff text.
- Staff open/duty/action gate; claim/complete/reselect; one student per staff member; handoff and next assignment; pause/remove/reorder; queue state propagation and close confirmation/history.
- Announcement create/delete and student visibility; feedback validations, confirmation, cancel reset and manager visibility.
- Manager date filters, raw outcomes, all three chart modes, one-TA donut, summary metric definitions, CSV quoting/formula neutralization, and restricted role/admin controls.
- Site console create/delete including all associated data; global-admin Back destination.
- Desktop and 390px screenshots for login, directory, student, TA and manager; preserved Duke colors/asset; no clipped actions, off-screen modal, or document-wide table overflow.

The staffing application and semester recommendations are design-stage work. The current interface has no vacancy publication, candidate application, CV, offer, reservation, appointment, RA workspace, or AI ranking workflow.
