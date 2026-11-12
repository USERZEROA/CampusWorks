# Automatic lifecycle presentation

Run the complete TA recruitment-to-closeout journey in six independent browser windows. The acting window is maximized and brought to the foreground for each step and control interaction. The default **38-step** round includes five fresh OpenAI responses across four advisory types. Normal playback targets **five active minutes per cycle**, with more reading time on application evidence, AI results and dashboards. The next round restores the isolated starting point and repeats.

```sh
# Visible loop with live OpenAI assistance.
node scripts/demo-loop.mjs

# One visible rehearsal, then stop and clean up.
node scripts/demo-loop.mjs --cycles 1

# Deterministic local acceptance check, including reset and reauthentication.
node scripts/demo-loop.mjs --without-ai --headless --cycles 2 --pace fast --verify-controls
```

The launcher builds the current application. Use `--skip-build` only when the existing production build matches the source. `--pace fast` shortens presentation pauses; `--pace detailed` allows longer explanations. Neither changes provider response time. Headless runs require a finite `--cycles` value. No GitHub Action is needed.

The default launcher loads the saved Windows-encrypted OpenAI Key into the server process. If it is missing, open the masked Key form described in the [demonstration guide](DEMO_GUIDE.md). `--without-ai` explicitly selects the **33-step** deterministic test mode; it does not load a saved provider Key or call a model.

## Playback rhythm

The five-minute target is distributed across the actual steps. Brief transitions receive less time, while the following result pages retain a minimum reading period after their content is ready:

| Page or result | Minimum reading time at normal pace |
| --- | --- |
| Requirements, qualification summary and CS201 candidate comparison | 15 seconds each |
| CS101's ten-candidate comparison and course advice | 18 seconds each |
| Department dashboard | 12 seconds |
| Course review | 9 seconds |
| Course operations and feedback | 8 seconds |
| Application qualification answers | 7 seconds |

Step targets include their active automated actions. Slow synchronization or a provider response can extend a step so that its result still receives the reading time above; the next important page is not rushed to compensate. There is no unused five-minute padding at the final page. Manual pauses and history review do not consume the active playback clock. Initial preparation and baseline restoration are separate from the cycle target.

## Six identities, four roles

| Window                   | Synthetic identity                        | Part in the journey                                                                                          |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Applicant / appointed TA | Alex Morgan, `demo-lifecycle@example.com` | Applies, accepts, becomes the CS201 TA and returns to student access after the appointment ends              |
| Student seeking help     | Sam Lee, `demo-learner@example.com`       | Enrolls, joins the queue, receives help and gives feedback                                                   |
| Course instructor        | Prof. Cameron Wells                       | Creates the CS201 position, reviews, selects, ends the appointment and reviews the course                    |
| Administrator            | Morgan Ellis                              | Controls recruitment, approves publication, records clearance and inspects department insights               |
| Second instructor        | Prof. Taylor Reed                         | Reviews Alex for CS101 and sees both availability and AI comparison evidence update after CS201 selects Alex |
| Existing course TA       | Quinn Bennett                             | Posts an office-hours announcement with a labelled mock Zoom link and closes the support queue               |

Alex signs in as the same student throughout. Appointment-derived course authority supplies the TA tools; the script never grants Alex a manual TA role. All names, CVs and business records are synthetic.

## Visible sequence

1. Administrator confirms the shared recruitment schedule.
2. Instructor creates CS201 duties, weekly expectations and qualification questions.
3. Administrator approves publication. The first live AI panel reviews the newly published requirements.
4. Alex discovers the position, answers questions, uploads a synthetic private CV and submits. Alex also applies to CS101 and confirms its required schedule.
5. Instructor opens Alex's live qualification summary and the CS201 candidate comparison. The second instructor shortlists Alex for CS101.
6. The CS201 instructor issues the offer. CS101 silently shows Alex as unavailable for an overlapping selection, then presents a fresh AI comparison of its first ten currently eligible applicants. Alex is excluded; coverage identifies this as one page, not the whole pool.
7. Alex accepts. The page shows pending clearance without TA entry. Administrator clears the appointment, and Alex's page silently updates to Active.
8. Alex opens the CS201 TA queue and starts duty. The existing TA posts an announcement containing `Zoom (demo): https://zoom.example.com/j/cs201-office-hours`. Sam enrolls and joins the queue.
9. Alex claims Sam; Sam sees the assigned helper. After completion, Sam chooses that help session and Alex in the feedback form. Alex records reported work separately.
10. Instructor sees the completed help record and feedback. The existing TA closes the support queue.
11. Instructor ends Alex's appointment with a reason. Alex's open TA page returns automatically to the student course view.
12. Instructor checks course activity, reported work and staffing coverage, then shows the fresh CS201 course-advice response.
13. Administrator opens department insights to compare ten courses, busy hours, staffing plans and attributed feedback. Alex's one rating remains visibly limited evidence. Instructor archives the opening; Alex retains application and appointment history.
14. The script parks all pages, stops its application, restores its own baseline, restarts and reauthenticates the same six windows. The next round begins.

The browser steps use normal application controls and assert their outcomes. Login and initial synthetic preparation use the existing local mock/API fixtures; restoring a round is a separate demonstration operation. A help session stays claimed for at least seven seconds even at fast pace so it qualifies for normal metrics and optional helper-specific feedback. The [insights guide](COURSE_INSIGHTS.md) explains dates and sample labels.

The Zoom address uses the reserved `example.com` domain. It demonstrates a clickable announcement link without creating or joining a real meeting.

**Course closeout is not calendar semester expiry.** This presentation uses queue-close and appointment-end controls. Course advice remains a current-semester preview; the script does not alter clocks or silently change term dates.

## Live AI evidence

| Advisory type         | Featured evidence                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Requirements          | The newly created CS201 position                                                                          |
| Qualification summary | Alex's submitted CS201 application                                                                        |
| Candidate comparison  | CS201's current applicants, followed by CS101's eligible alternatives after Alex receives the CS201 offer |
| Course advice         | CS201's recorded demand, feedback, reported work and staffing coverage                                    |

Each live step waits for a newly completed automatic task from `api.openai.com`, checks its current scope and provider response identity, and displays the result in the application. It does not replay stored answers or substitute a screenshot. The live panels show generating states while requests are pending; explain that state on stage instead of promising an exact completion time. A failed or timed-out model step stops the presentation with diagnostics.

`AI_AUTOMATION_SCOPES` restricts this presentation's automatic work to the featured resources. It avoids buying analyses of all 68 baseline applications. Per-user/global request, reserved-token and distributed-concurrency guards keep their normal defaults. Their ledger is stored separately in **`campusworks_demo_ai_usage`** and survives round restoration, database cleanup and relaunch. Repeating the presentation does not reset capacity or rotate reviewer identities. Retrying a failed request can consume another reservation; provider account controls remain separate.

## Presentation controls

For a presentation controlled entirely from the keyboard, run `npm run demo:loop -- --manual --without-ai --skip-build` after building once. It opens the same six roles and waits before every step, including the first step and each new round. There is no automatic advance or fixed playback duration in this mode.

Press **Right arrow** once to execute the next step. **Left arrow** reviews an already visited page using current authorized data, without undoing or replaying decisions. Right arrow walks forward through reviewed pages; at the latest page, one press returns to the live presentation and a separate press executes the pending step. **Space** or **Pause / Break** pauses/resumes; resuming alone never executes a step. Arrow keys in text fields retain their usual editing behavior. Repeated Next commands during an action do not queue future actions. Add `--manual` without `--without-ai` for manually advanced live AI, subject to the existing saved Key and quotas.

The banner displays **DEMO**, acting role, name, cycle, step and a short explanation. Playwright injects it only into these owned contexts. The same Alex window is labelled Student, Student to TA, TA and TA to Student during the transition.

- **Pause / Resume** is one toggle button in every window: click once to pause and click the same button again to continue. Pausing preserves the remaining reading time and prevents the next automated interaction. A request already submitted and ordinary background synchronization may still finish.
- The keyboard's **Pause / Break** key toggles pause and resume. **Space** also toggles outside text fields, selection fields and editable content; the banner buttons retain their normal Space activation.
- In automatic mode, **Left / Right arrows** pause playback and reopen already visited pages in a separate read-only tab using their current authorized data. They do not roll back the database, execute future steps or repeat hiring, offer or queue commands. **Resume** closes that review tab, returns to the original automation page and continues from that point. Keyboard mode uses the separate one-key-per-step behavior described above.
- **Stop demo**, closing a presentation window, or Ctrl+C stops the loop and closes its other windows. The browser wait is cancelled before service cleanup.
- The acting control has a visible outline. The banner reserves space above the page content.
- On Windows, the native helper locates only the uniquely tagged demonstration window, maximizes it and verifies its foreground handle.

Failed business steps are never skipped or replaced by successful-looking screens. The next launch begins with another independent synthetic application database.

The presenter controls have an independent local browser check, including rapid navigation/resume commands. It uses a local fixture without MongoDB, a saved Key or provider calls:

```sh
node scripts/check-demo-presenter.mjs
node scripts/check-demo-presenter.mjs --headed
```

Run `node scripts/check-demo-lifecycle.mjs` after building to verify one automatic round and two keyboard rounds in the background. It uses headless browsers, its own generated application database and no model calls. It checks the complete lifecycle, reset, reauthentication and reuse of the same six windows; it does not drive or overwrite the state of an open presentation. The receipt is `.cache/demo-lifecycle-headless-proof.json`.

## Data and cleanup

Each launch creates a generated `campusworks_showcase_loop_<random>` database and a free loopback application port. Docker also assigns a free loopback MongoDB port, avoiding conflicts with other projects on 27017. Set `DEMO_MONGO_PORT` in the environment or private `.env` for a fixed database port; an already running shared demo service is discovered at its actual port. Baseline restoration requires its exact generated name, private ownership marker and exclusively synthetic identities. The app stops before restoration so polling and maintenance cannot write during reset. The six actors authenticate again afterward. Repeated rounds reuse the same application database, and continuous receipt history is bounded.

Prepared observations use **catalog v6**: uneven weekday office-hour demand, varied declared work and linked helper feedback. Earlier catalog datasets and dated receipts stay separate. Alex and Sam's new journey is added to this baseline without relabelling historical requests as work they just performed.

The manual showcase and ordinary application databases are untouched. If a manual showcase launcher owns the shared MongoDB process, stop it before starting the automatic presentation; closing its windows could otherwise stop that database. Cleanup stops only this launch's app and browser processes, drops its owned application database and stops MongoDB only if this launch started it. A reused MongoDB service and the shared AI usage ledger are retained.

Live state is in `.cache/demo-loop-state.json`; the latest run receipt is `.cache/demo-loop-proof.json`. Failure screenshots use `.cache/demo-loop-failed-*.png`. These ignored artifacts contain no provider Key. Closing a visible loop is an expected **stopped** result, not a completed finite acceptance run.

This is a local product demonstration. Synthetic observations and successful provider responses do not establish hiring quality, customer adoption or a validated institutional deployment.
