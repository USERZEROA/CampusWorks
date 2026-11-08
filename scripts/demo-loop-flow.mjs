import { expect } from "@playwright/test";

export const LOOP_STEP_COUNT = 34;

export const LOOP_APPLICANT = Object.freeze({
  key: "applicant",
  as: "student",
  email: "demo-lifecycle@example.com",
  name: "Alex Morgan",
  label: "Applicant / appointed TA",
  path: "/courses",
});
export const LOOP_LEARNER = Object.freeze({
  key: "learner",
  as: "student",
  email: "demo-learner@example.com",
  name: "Sam Lee",
  label: "Student seeking help",
  path: "/courses",
});

export function loopWindows(manifest) {
  const actor = (key, source, label, route) => {
    const person = manifest.actors[source];
    return {
      key,
      as: person.role,
      email: person.email,
      name: person.name,
      label,
      path: route,
    };
  };
  return [
    LOOP_APPLICANT,
    LOOP_LEARNER,
    actor("instructor", "faculty-algorithms", "Course instructor", "/courses"),
    actor("admin", "admin", "Administrator", "/admin/staffing"),
    actor(
      "peer",
      "faculty-main",
      "Second instructor",
      `/staffing/${manifest.opportunityIds["intro-ta"]}`,
    ),
    actor("mentor", "ta-labs", "Existing course TA", "/courses/cs201/ta"),
  ];
}

async function open(page, route) {
  expect((await page.goto(route))?.status()).toBe(200);
  await page.waitForFunction(
    () => !!document.querySelector("#__nuxt")?.__vue_app__,
  );
  await expect(page.locator("main")).toBeVisible();
}
const read = async (response) => {
  const result = await response;
  expect(result.ok()).toBe(true);
  return result.json();
};

/** All visible business mutations below use ordinary application controls. */
export async function runLoopCycle({
  service,
  stage,
  cycle,
  onStep = () => {},
  dwell = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = Date.now();
  const steps = [];
  const courseId = service.manifest.courseIds.structures;
  const peerPosition = service.manifest.opportunityIds["intro-ta"];
  const details = {
    courseId,
    cycle,
    startedAt: new Date(startedAt).toISOString(),
  };
  const roles = {
    applicant: "Student",
    learner: "Student",
    instructor: "Instructor",
    admin: "Administrator",
    peer: "Instructor",
    mentor: "TA",
  };
  let positionId, applicationId, peerApplicationId, appointmentId;
  const step = async (actor, title, detail, action) => {
    const began = Date.now();
    onStep({ cycle, step: steps.length + 1, actor, role: roles[actor], title });
    const result = await stage.step(
      {
        actor,
        role: roles[actor],
        title,
        detail,
        cycle,
        index: steps.length + 1,
      },
      action,
    );
    steps.push({
      actor,
      role: roles[actor],
      title,
      status: "passed",
      durationMs: Date.now() - began,
    });
    return result;
  };
  const click = async (locator) => {
    await stage.spotlight(locator);
    await locator.click();
  };
  const fill = async (locator, value) => {
    await stage.spotlight(locator);
    await locator.fill(value);
  };
  const select = async (locator, value) => {
    await stage.spotlight(locator);
    await locator.selectOption(value);
  };
  const check = async (locator) => {
    await stage.spotlight(locator);
    await locator.check();
  };

  await step(
    "admin",
    "Open the shared recruitment cycle",
    "One administrator sets the current semester and recruitment window for everyone.",
    async (page) => {
      await open(page, "/admin/staffing");
      await check(page.getByTestId("cycle-enabled"));
      await click(page.getByTestId("cycle-save"));
      await expect(page.getByTestId("admin-staffing-notice")).toContainText(
        /saved|updated/i,
      );
    },
  );
  await step(
    "instructor",
    "Define the course position",
    "CS201 needs a TA for attendance, labs, grading and office hours.",
    async (page) => {
      await open(page, "/courses");
      await click(page.getByTestId("staffing-link"));
      await click(page.getByTestId("new-opportunity"));
      await fill(
        page.getByTestId("opportunity-title"),
        "Data Structures TA · Lifecycle demonstration",
      );
      await select(page.getByTestId("opportunity-course"), courseId);
      await fill(
        page.getByTestId("opportunity-description"),
        "Support CS201 students through weekly office hours, debugging labs and assignment feedback. Synthetic demonstration position.",
      );
      await fill(page.getByTestId("opportunity-hours"), "10");
      await check(page.getByLabel("Attendance required", { exact: true }));
      await check(page.getByLabel("Lab responsibilities", { exact: true }));
      await check(
        page.getByLabel("Assignment or exam grading", { exact: true }),
      );
      await check(page.getByLabel("Hold office hours", { exact: true }));
      await fill(page.getByLabel("Sessions per week", { exact: true }), "2");
      await fill(page.getByLabel("Minutes per session", { exact: true }), "60");
    },
  );
  await step(
    "instructor",
    "Set qualifications and publish for approval",
    "The instructor defines the evidence applicants must supply; publication requires administrator approval.",
    async (page) => {
      await fill(
        page.getByTestId("opportunity-required-skills"),
        "Java, recursion, data structures and clear technical explanations",
      );
      await click(page.getByTestId("opportunity-add-question"));
      await fill(
        page.getByLabel("Qualification question 1", { exact: true }),
        "How would you help a student debug a recursive method without giving away the answer?",
      );
      await fill(page.getByTestId("opportunity-rate"), "20");
      await fill(page.getByTestId("opportunity-budget"), "10000");
      await click(page.getByTestId("opportunity-save"));
      await expect(page).toHaveURL(/\/staffing\/[a-f0-9-]+$/);
      positionId = new URL(page.url()).pathname.split("/").at(-1);
      await click(page.getByTestId("opportunity-publish"));
      await expect(page.getByTestId("opportunity-status")).toHaveText(
        /pending approval/i,
      );
    },
  );
  await step(
    "admin",
    "Approve the course opening",
    "The administrator confirms the posting before students can apply.",
    async (page) => {
      await click(page.getByTestId(`approve-opportunity-${positionId}`));
      await expect(page.getByTestId("admin-staffing-notice")).toContainText(
        /approved/i,
      );
    },
  );
  await step(
    "applicant",
    "Discover the opportunity",
    "Alex begins as an ordinary student, with no TA role or existing offer.",
    async (page) => {
      await open(page, "/courses");
      await click(page.getByTestId("opportunities-link"));
      await fill(
        page.getByTestId("opportunity-search"),
        "Lifecycle demonstration",
      );
      await click(
        page
          .getByTestId(`opportunity-${positionId}`)
          .getByRole("link", { name: "View requirements" }),
      );
      await click(page.getByTestId("start-application"));
      await expect(page).toHaveURL(/\/applications\/[a-f0-9-]+$/);
      applicationId = new URL(page.url()).pathname.split("/").at(-1);
    },
  );
  async function profile(page) {
    await fill(page.getByTestId("app-first-name"), "Alex");
    await fill(page.getByTestId("app-last-name"), "Morgan");
    await fill(page.getByTestId("app-email"), LOOP_APPLICANT.email);
    await fill(page.getByTestId("app-majors"), "Computer Science");
    await fill(
      page.getByLabel("Department", { exact: true }),
      "Computer Science",
    );
    await fill(
      page.getByLabel("Expected graduation term", { exact: true }),
      "Spring 2027",
    );
    await fill(page.getByTestId("app-available-hours"), "10");
    await fill(
      page.getByTestId("app-availability"),
      "Available on weekday afternoons for the listed weekly responsibilities.",
    );
    await fill(
      page.getByTestId("app-skills"),
      "Java, Python, recursion, data structures, debugging and peer tutoring.",
    );
    for (const question of await page
      .locator('[data-testid^="app-answer-"]')
      .all()) {
      await fill(
        question,
        "I would ask for a small example, trace the base case and recursive call, and guide the student toward a focused test.",
      );
    }
    const confirmAvailability = page.getByRole("button", {
      name: "Confirm availability",
      exact: true,
    });
    if (await confirmAvailability.isVisible()) await click(confirmAvailability);
  }
  async function saveAndSubmit(page) {
    await click(page.getByTestId("application-save"));
    await expect(page.getByTestId("application-notice")).toContainText(
      /saved/i,
    );
    await stage.spotlight(page.getByTestId("application-cv"));
    await page.getByTestId("application-cv").setInputFiles({
      name: "alex-morgan-synthetic-cv.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "SYNTHETIC DEMONSTRATION CV\nAlex Morgan\nComputer Science coursework: data structures, recursion and software testing.\nPeer programming tutor. No real applicant information.\n",
      ),
    });
    await click(page.getByTestId("application-cv-upload"));
    await expect(page.getByTestId("application-notice")).toContainText(
      /uploaded/i,
    );
    await click(page.getByTestId("application-submit"));
    await expect(page.getByTestId("application-status")).toHaveText(
      /submitted/i,
    );
  }
  await step(
    "applicant",
    "Answer the qualification questions",
    "Personal background, availability and technical answers remain private to the authorized reviewers.",
    profile,
  );
  await step(
    "applicant",
    "Attach a CV and submit",
    "The submitted application records a stable version of the answers and private attachment.",
    saveAndSubmit,
  );
  await step(
    "applicant",
    "Apply to another course as well",
    "Alex also applies to CS101, so the next selection will demonstrate coordination between two instructors.",
    async (page) => {
      await open(page, `/opportunities/${peerPosition}`);
      await click(page.getByTestId("start-application"));
      await expect(page).toHaveURL(/\/applications\/[a-f0-9-]+$/);
      peerApplicationId = new URL(page.url()).pathname.split("/").at(-1);
      await profile(page);
      await saveAndSubmit(page);
    },
  );
  await step(
    "peer",
    "A second instructor reviews the same applicant",
    "Before an offer, Alex is available to both courses. Neither instructor receives automatic hiring authority.",
    async (page) => {
      await open(page, `/staffing/${peerPosition}`);
      const row = page.getByTestId(`candidate-row-${peerApplicationId}`);
      await expect(row).toContainText("Alex");
      await click(page.getByTestId(`shortlist-candidate-${peerApplicationId}`));
      await expect(row).toContainText(/shortlisted/i);
      await expect(
        page.getByTestId(`select-candidate-${peerApplicationId}`),
      ).toBeEnabled();
    },
  );
  await step(
    "instructor",
    "Review Alex for CS201",
    "The faculty reviewer can inspect the submitted profile, answers and private CV.",
    async (page) => {
      await expect(
        page.getByTestId(`candidate-row-${applicationId}`),
      ).toContainText("Alex", { timeout: 20000 });
      await click(
        page
          .getByTestId(`candidate-row-${applicationId}`)
          .getByRole("link", { name: /review/i }),
      );
      await expect(page.getByTestId("application-status")).toHaveText(
        /submitted|under review/i,
      );
      await expect(page.getByTestId("application-cv-download")).toBeVisible();
    },
  );
  await step(
    "instructor",
    "Shortlist and issue the offer",
    "The faculty decision reserves the candidate, position and budget together.",
    async (page) => {
      await open(page, `/staffing/${positionId}`);
      await click(page.getByTestId(`shortlist-candidate-${applicationId}`));
      await expect(
        page.getByTestId(`candidate-row-${applicationId}`),
      ).toContainText(/shortlisted/i);
      await click(page.getByTestId(`select-candidate-${applicationId}`));
      await expect(page.getByTestId("staffing-notice")).toContainText(
        /Offer sent/i,
      );
      const result = await read(
        page.request.get(`/api/staffing/applications/${applicationId}`),
      );
      appointmentId = result.appointment.id;
    },
  );
  await step(
    "peer",
    "The other instructor sees availability update",
    "Alex now has an overlapping offer. CS101 cannot select the same applicant again.",
    async (page) => {
      const row = page.getByTestId(`candidate-row-${peerApplicationId}`);
      await expect(row).toContainText(/unavailable/i, { timeout: 20000 });
      await expect(
        page.getByTestId(`select-candidate-${peerApplicationId}`),
      ).toBeDisabled();
    },
  );
  await step(
    "applicant",
    "Accept the CS201 offer",
    "The candidate chooses. Acceptance alone does not grant TA course access.",
    async (page) => {
      await open(page, `/applications/${applicationId}`);
      await click(page.getByTestId("offer-accept"));
      await expect(page.getByTestId("appointment-status")).toHaveText(
        /pending clearance/i,
      );
      await expect(page.getByTestId("appointment-workspace")).toHaveCount(0);
      expect(
        (await read(page.request.get(`/api/courses/${courseId}`))).isStaff,
      ).toBe(false);
    },
  );
  await step(
    "admin",
    "Record the appointment clearance",
    "An administrator confirms clearance; no manual TA role grant is needed.",
    async (page) => {
      await select(
        page.getByTestId(`clearance-status-${appointmentId}`),
        "cleared",
      );
      await click(page.getByTestId(`clearance-${appointmentId}`));
      await expect(page.getByTestId("admin-staffing-notice")).toContainText(
        /Clearance recorded/i,
      );
    },
  );
  roles.applicant = "Student → TA";
  await step(
    "applicant",
    "Alex becomes the appointed course TA",
    "The same account updates silently from pending clearance to Active and gains the CS201 queue link.",
    async (page) => {
      await expect(page.getByTestId("appointment-status")).toHaveText(
        /active/i,
        { timeout: 20000 },
      );
      await expect(page.getByTestId("appointment-workspace")).toBeVisible();
      expect(
        (
          await read(
            page.request.get(
              `/api/courses/${service.manifest.courseIds.intro}`,
            ),
          )
        ).isStaff,
      ).toBe(false);
      await click(page.getByTestId("appointment-workspace"));
      await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/ta$`));
    },
  );
  roles.applicant = "TA";
  await step(
    "applicant",
    "Start the office-hours shift",
    "Alex is on duty for CS201, with appointment-derived authority for this course only.",
    async (page) => {
      const opening = page.getByTestId("open-queue-btn");
      if (await opening.isVisible()) await click(opening);
      await click(page.getByTestId("on-duty-btn"));
      await expect(page.getByTestId("on-duty-btn")).toHaveText(/end duty/i);
    },
  );
  await step(
    "mentor",
    "The existing TA coordinates the session",
    "A second TA sees the same live course and posts an announcement for students.",
    async (page) => {
      await fill(
        page.getByTestId("announce-input"),
        "Alex is holding CS201 office hours. Add your location and a short question to join.",
      );
      await click(page.getByTestId("announce-post"));
      await expect(
        page.getByText("Alex is holding CS201 office hours.", { exact: false }),
      ).toBeVisible();
    },
  );
  await step(
    "learner",
    "A student enrolls in the course",
    "Sam has a separate student session. The course requires enrollment before joining the queue.",
    async (page) => {
      await open(page, `/courses/${courseId}/student`);
      await click(page.getByTestId("course-enroll-btn"));
      await expect(page.getByTestId("enter-queue-btn")).toBeVisible();
    },
  );
  await step(
    "learner",
    "Ask for help through the live queue",
    "Sam supplies a location and a concrete debugging question.",
    async (page) => {
      await click(page.getByTestId("enter-queue-btn"));
      await fill(page.getByTestId("join-location"), "Computing Lab · Seat 12");
      await fill(
        page.getByTestId("join-question"),
        "How can I trace the base case in a recursive tree traversal?",
      );
      await click(page.getByTestId("join-confirm"));
      await expect(page.getByTestId("queue-position")).toBeVisible();
    },
  );
  let claimedAt;
  await step(
    "applicant",
    "Alex claims Sam’s request",
    "The queue assigns one helper to this request; the student sees the same claim automatically.",
    async (page) => {
      const row = page.getByTestId(`ta-row-${LOOP_LEARNER.email}`);
      await click(row.getByTestId("ta-select-btn"));
      await expect(row.getByTestId("ta-select-btn")).toHaveText(/complete/i);
      claimedAt = Date.now();
    },
  );
  await step(
    "learner",
    "The student sees who is helping",
    "Sam’s queue state updates without refreshing the page.",
    async (page) => {
      await expect(page.getByTestId("queue-row-mine")).toContainText("Alex");
    },
  );
  await step(
    "applicant",
    "Complete the help session",
    "The completed session enters the course history. This is one synthetic help interaction, not a simulated semester.",
    async (page) => {
      await dwell(Math.max(0, 7200 - (Date.now() - claimedAt)));
      const row = page.getByTestId(`ta-row-${LOOP_LEARNER.email}`);
      await click(row.getByTestId("ta-select-btn"));
      await expect(row).toHaveCount(0);
    },
  );
  await step(
    "learner",
    "Give feedback on the support",
    "Sam rates Alex's recorded help session. Personal feedback stays separate from general course feedback.",
    async (page) => {
      await expect(page.getByTestId("queue-position")).toHaveCount(0, {
        timeout: 20000,
      });
      await click(page.getByTestId("feedback-open-btn"));
      await select(page.getByTestId("fb-category"), "ta");
      await expect(page.getByTestId("fb-help-session")).toBeEnabled();
      const context = await read(
        page.request.get(`/api/courses/${courseId}/feedback-context`),
      );
      const session = context.sessions.find((item) =>
        item.helpers.some((helper) => helper.email === LOOP_APPLICANT.email),
      );
      expect(session).toBeTruthy();
      await select(page.getByTestId("fb-help-session"), session.id);
      await select(page.getByTestId("fb-helper"), LOOP_APPLICANT.email);
      await select(page.getByTestId("fb-rating"), "5");
      await fill(
        page.getByTestId("fb-positive"),
        "Alex helped me trace the recursion and design my own test.",
      );
      await fill(
        page.getByTestId("fb-negative"),
        "A worked example before office hours would help me prepare.",
      );
      await click(page.getByTestId("fb-submit"));
      await expect(page.getByTestId("fb-submit")).toHaveCount(0);
      expect(
        await service.db
          .collection("feedback")
          .findOne({
            courseId,
            studentEmail: LOOP_LEARNER.email,
            helpSessionId: session.id,
            taEmail: LOOP_APPLICANT.email,
          }),
      ).toMatchObject({ ratingScope: "helper", rating: 5 });
    },
  );
  await step(
    "applicant",
    "Record work beyond queue timing",
    "Alex reports office-hours work separately; queue duration does not represent all paid teaching work.",
    async (page) => {
      await open(page, `/applications/${applicationId}`);
      await select(
        page.getByLabel("Work category", { exact: true }),
        "office_hours",
      );
      await fill(page.getByTestId("workload-hours"), "0.5");
      await fill(
        page.getByLabel("Notes", { exact: true }),
        "Synthetic reported office-hours preparation and student support.",
      );
      await click(page.getByTestId("workload-save"));
      await expect(
        page.getByText("Workload recorded.", { exact: true }),
      ).toBeVisible();
    },
  );
  await step(
    "instructor",
    "Review course operations and feedback",
    "The instructor sees the completed session and Sam’s feedback in the course management view.",
    async (page) => {
      await open(page, `/courses/${courseId}/admin`);
      await expect(
        page.getByTestId("session-row").filter({ hasText: LOOP_LEARNER.email }),
      ).toContainText(/Helped/i);
      await expect(
        page
          .getByTestId("feedback-row")
          .filter({ hasText: "Alex helped me trace" }),
      ).toBeVisible();
      await stage.spotlight(
        page
          .getByTestId("feedback-row")
          .filter({ hasText: "Alex helped me trace" }),
      );
    },
  );
  await step(
    "mentor",
    "Close the course support queue",
    "Course closeout clears remaining requests and duty. This is a queue closure, not calendar semester expiry.",
    async (page) => {
      await click(page.getByTestId("close-queue-btn"));
      await expect(page.getByTestId("queue-state")).toHaveText(/closed/i);
    },
  );
  await step(
    "applicant",
    "Return to the TA page before closeout",
    "Keep the appointed TA’s page open so automatic access removal will be visible.",
    async (page) => {
      await open(page, `/courses/${courseId}/ta`);
      await expect(page.getByTestId("queue-state")).toHaveText(/closed/i);
    },
  );
  await step(
    "instructor",
    "End the appointment with a reason",
    "The faculty member closes Alex’s appointment. Financial obligations remain until settlement.",
    async (page) => {
      await open(page, `/staffing/${positionId}`);
      await fill(
        page.getByTestId("appointment-reason"),
        "Synthetic course support completed; appointment closed for the lifecycle demonstration.",
      );
      await click(page.getByTestId(`appointment-end-${appointmentId}`));
      await expect(
        page.getByTestId(`appointment-row-${appointmentId}`),
      ).toContainText(/ended/i);
    },
  );
  roles.applicant = "TA → Student";
  await step(
    "applicant",
    "TA access disappears automatically",
    "The same person returns to the student course view; no administrator manually removes a role.",
    async (page) => {
      await expect(page).toHaveURL(
        new RegExp(`/courses/${courseId}/student$`),
        { timeout: 20000 },
      );
      await expect(page.getByTestId("on-duty-btn")).toHaveCount(0);
      expect(
        (await read(page.request.get(`/api/courses/${courseId}`))).isStaff,
      ).toBe(false);
    },
  );
  roles.applicant = "Student";
  await step(
    "admin",
    "Settle the appointment cost",
    "The administrator confirms a synthetic incurred cost and releases the unused commitment.",
    async (page) => {
      await fill(page.getByTestId(`settlement-cost-${appointmentId}`), "10");
      await click(page.getByTestId(`appointment-settle-${appointmentId}`));
      await expect(
        page.getByTestId(`appointment-settle-${appointmentId}`),
      ).toHaveCount(0);
    },
  );
  await step(
    "instructor",
    "See the evidence for the next cycle",
    "Course activity, reported work and settled costs inform the next staffing discussion; they do not prove savings.",
    async (page) => {
      await open(page, `/courses/${courseId}/review`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Course Review",
      );
      const report = await read(
        page.request.get(`/api/staffing/reviews/${courseId}`),
      );
      expect(report.workload.totalHours).toBeGreaterThan(0);
      expect(report.budget.settledBudget).toBeGreaterThanOrEqual(10);
      details.review = {
        reportedHours: report.workload.totalHours,
        settledCost: report.budget.settledBudget,
        sessions: report.metrics.sessions,
      };
    },
  );
  await step(
    "admin",
    "Compare department demand and support",
    "The administrator compares courses, busy hours and attributed feedback, with sample sizes and staffing costs visible.",
    async (page) => {
      await open(page, "/insights");
      await expect(page.getByTestId("insights-root")).toBeVisible();
      const report = await read(page.request.get("/api/insights"));
      const helper = report.helpers.find(
        (item) => item.email === LOOP_APPLICANT.email,
      );
      expect(helper.feedbackCount).toBe(1);
      expect(helper.feedbackAverage).toBe(5);
      expect(helper.feedbackReviewers).toBe(1);
      await stage.spotlight(
        page.getByTestId(`insights-helper-${LOOP_APPLICANT.email}`),
      );
      details.department = {
        courses: report.courses.length,
        personalFeedbackCount: helper.feedbackCount,
        personalFeedbackAverage: helper.feedbackAverage,
        reviewers: helper.feedbackReviewers,
      };
    },
  );
  await step(
    "instructor",
    "Archive the completed opening",
    "Only after appointment and financial closeout is this position archived.",
    async (page) => {
      await open(page, `/staffing/${positionId}`);
      await click(page.getByTestId("opportunity-archive"));
      await expect(page.getByTestId("opportunity-status")).toHaveText(
        /archived/i,
      );
    },
  );
  await step(
    "applicant",
    "One account, a complete lifecycle",
    "Alex retains the application and appointment history, with no remaining TA course authority. The next loop restores only this isolated demo.",
    async (page) => {
      await open(page, `/applications/${applicationId}`);
      await expect(page.getByTestId("appointment-status")).toHaveText(/ended/i);
      await expect(page.getByTestId("appointment-workspace")).toHaveCount(0);
    },
  );

  const finalAppointment = await service.db
    .collection("staffingAppointments")
    .findOne({ id: appointmentId });
  expect(finalAppointment).toMatchObject({
    status: "ended",
    budgetStatus: "settled",
    incurredCost: 10,
  });
  expect(
    await service.db
      .collection("staffingOpportunities")
      .findOne({ id: positionId }),
  ).toMatchObject({ status: "archived" });
  expect(
    await service.db
      .collection("queueEntries")
      .countDocuments({ courseId, email: LOOP_LEARNER.email }),
  ).toBe(0);
  expect(
    await service.db.collection("staffingAiBudgets").countDocuments(),
  ).toBe(0);
  return {
    ...details,
    positionId,
    applicationId,
    peerApplicationId,
    appointmentId,
    steps,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    providerCalls: 0,
    status: "passed",
  };
}
