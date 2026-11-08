# Automatic lifecycle presentation

Run the complete TA recruitment-to-closeout journey in six independent browser windows. One acting window is maximized and brought to the foreground for each step and control interaction. The 34-step normal pace targets about five minutes per round; actual timing also depends on page synchronization. The next round restores the isolated starting point and repeats.

```sh
node scripts/demo-loop.mjs

# One visible rehearsal, then stop and clean up.
node scripts/demo-loop.mjs --cycles 1

# Local acceptance check: two rounds, including a real reset and reauthentication.
node scripts/demo-loop.mjs --headless --cycles 2 --pace fast --verify-controls
```

The launcher builds the current application. Use `--skip-build` only when the existing production build matches the application source. `--pace fast` shortens presentation pauses; `--pace detailed` targets eight minutes. Headless runs require a finite `--cycles` value. No GitHub Action is needed.

## Six identities, four roles

| Window                   | Synthetic identity                        | Part in the journey                                                                                           |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Applicant / appointed TA | Alex Morgan, `demo-lifecycle@example.com` | Student applies, accepts, becomes the CS201 TA and returns to student access after the appointment ends       |
| Student seeking help     | Sam Lee, `demo-learner@example.com`       | Enrolls, joins the queue, receives help and gives feedback                                                    |
| Course instructor        | Prof. Cameron Wells                       | Creates the CS201 position, reviews, selects, ends the appointment and reviews the course                     |
| Administrator            | Morgan Ellis                              | Controls recruitment, approves publication, records clearance, settles costs and inspects department insights |
| Second instructor        | Prof. Taylor Reed                         | Reviews Alex for CS101 and sees selection become unavailable after CS201's offer                              |
| Existing course TA       | Quinn Bennett                             | Coordinates office hours with an announcement and closes the support queue                                    |

Alex always signs in as the same student. Appointment-derived course authority supplies the TA tools; the script never grants Alex a manual TA role. All names, CVs and records are synthetic.

## Visible sequence

1. Administrator confirms the shared recruitment schedule.
2. Instructor creates CS201 duties, weekly expectations, qualification questions and budget, then requests publication.
3. Administrator approves publication.
4. Alex discovers the position, answers questions, uploads a synthetic private CV and submits. Alex also applies to CS101 and confirms its required schedule.
5. The second instructor shortlists Alex. The CS201 instructor reviews and issues the offer. The CS101 window automatically shows Alex as unavailable for another overlapping selection.
6. Alex accepts. The page shows pending clearance with no TA entry. Administrator clears the appointment, and Alex's page silently updates to Active.
7. Alex opens the CS201 TA queue and starts duty. The existing TA posts an announcement. Sam enrolls and joins the queue.
8. Alex claims Sam; Sam sees the assigned helper. After completion, Sam explicitly chooses that help session and Alex in the feedback form. Alex records reported work separately.
9. Instructor sees the actual completed help record and feedback. The existing TA closes the support queue.
10. Instructor ends Alex's appointment with a reason. Alex's open TA page automatically returns to the student course view.
11. Administrator settles the synthetic cost. Instructor checks course activity, work and budget evidence.
12. Administrator opens department insights to compare course demand, busy hours, coverage and feedback. Alex's one rating remains visibly limited evidence; recorded work and costs are separate measures. Instructor then archives the opening, and Alex retains the application and appointment history.
13. The script parks all pages, stops its application, restores its own baseline, restarts and reauthenticates the same six windows. The next round begins.

The 34 visible steps use normal application controls and assert their outcomes. Login and initial synthetic preparation use the existing local mock/API fixtures; restoring a round is an explicitly separate demonstration operation. A help session remains claimed for at least seven seconds even at fast pace so it is included by the normal course metrics and qualifies for optional helper-specific feedback. The [insights guide](COURSE_INSIGHTS.md) explains reporting scopes, dates and sample labels.

**Course closeout is not calendar semester expiry.** This presentation uses the existing queue-close and appointment-end controls. Course advice remains a current-semester preview; the script does not alter clocks or silently change term dates.

## Presentation controls

The banner prominently displays **DEMO**, the acting role, person's name, cycle, step and a short explanation. It is injected only by Playwright into these owned contexts; normal application pages and permissions are unchanged. The same Alex window is labelled Student, Student → TA, TA and TA → Student as the transition occurs.

- **Pause / Resume** in any window pauses the next operation and the presentation timer.
- **Stop demo**, closing a presentation window, or Ctrl+C stops the loop and closes its other windows. The current browser wait is cancelled before service cleanup.
- The acting control has a visible outline. The banner reserves space above the page content.
- On Windows, the native helper locates only the uniquely tagged demonstration window, maximizes it and verifies the foreground handle. It does not keep application windows permanently above other programs.

A failed assertion stops the presentation and retains local diagnostics. Failed business steps are not skipped or replaced by successful-looking screens. The next launch begins with another independent synthetic database.

## Data, AI and cleanup

Each launch creates a generated `campusworks_showcase_loop_<random>` database and a free loopback application port. Baseline restoration requires its exact generated name, private ownership marker and exclusively synthetic identities. The app stops before restoration, preventing its polling/maintenance from writing during reset. New roles are authenticated after restoration. Repeated rounds reuse the same database rather than accumulating databases, and continuous receipt history is bounded.

The prepared observations use synthetic catalog v5: uneven weekday office-hour demand, varied declared work and explicitly linked helper feedback. Existing v4 datasets and historical receipts stay separate. The loop adds Alex and Sam's new journey to its own baseline; it does not relabel historical requests as work they just performed.

The original manual showcase and ordinary application databases are untouched. If a manual showcase launcher owns the shared MongoDB process, stop that launcher before starting the automatic presentation; otherwise closing its windows could stop the database underneath another demo. Cleanup stops only this launch's app and browser processes, drops its owned database and stops MongoDB only if this launch started it. A reused MongoDB service remains running.

Continuous playback **does not load the saved provider Key or purchase AI calls**. It demonstrates the real deterministic lifecycle. The [AI workflow guide](AI_WORKFLOWS.md) documents the automatic provider integrations; the [offline gallery](demo/index.html) separately retains real OpenAI result panels on synthetic evidence. Those panels are not claimed as new responses for Alex. The usual [manual showcase](DEMO_GUIDE.md) supports configured real AI when a presenter needs that separate demonstration.

Live state is in `.cache/demo-loop-state.json`; the latest run receipt is `.cache/demo-loop-proof.json`. On a failed run, `.cache/demo-loop-failed-*.png` retain the affected pages. These ignored local artifacts do not include a provider Key. Closing a visible loop is an expected **stopped** result, rather than a completed finite acceptance run.

This is a local product demonstration. Synthetic cost and workload records do not establish staffing savings, hiring quality, adoption or a validated institutional deployment.
