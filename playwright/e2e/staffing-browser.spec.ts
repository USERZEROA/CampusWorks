import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import {
  test,
  expect,
  ok,
  json,
  activateCycle,
  database,
  type Actor,
} from "../staffing-fixtures";
import type { BrowserContext, Page } from "@playwright/test";

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `Navigation to ${path}`).toBe(200);
  await page.waitForFunction(
    () => !!(document.querySelector("#__nuxt") as any)?.__vue_app__,
  );
  await expect(page).toHaveTitle(/CampusWorks/);
  await expect(page.locator("main")).toBeVisible();
}
async function signIn(context: BrowserContext, actor: Actor) {
  await ok(
    context.request.post("/api/auth/mock", {
      data: { as: actor.role, email: actor.email },
    }),
  );
}

test("application observes a reopened cycle automatically without refresh controls", async ({
  page,
  space,
}) => {
  const posting = await space.opportunity();
  const draft = (
    await json(
      space.student.api.post(
        `/api/staffing/opportunities/${posting.id}/applications`,
        { data: {} },
      ),
    )
  ).application;
  await activateCycle(space.admin, space.term, { enabled: false });
  await signIn(page.context(), space.student);
  await open(page, `/applications/${draft.id}`);
  await expect(page.getByTestId("application-save")).toHaveCount(0);
  await activateCycle(space.admin, space.term);
  await expect(page.getByTestId("application-refresh")).toHaveCount(0);
  await expect(page.getByTestId("application-save")).toBeVisible();
  await page.getByTestId("app-first-name").fill("Unsaved synthetic name");
  await expect(page.getByTestId("app-first-name")).toHaveValue(
    "Unsaved synthetic name",
  );
});

test("successful submit, save, upload, withdrawal and resubmission retain the current local revision", async ({
  page,
  space,
}) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  await signIn(page.context(), space.student);
  await open(page, `/applications/${application.id}`);
  await page.getByTestId("application-submit").click();
  await expect(page.getByTestId("application-notice")).toContainText(
    "Application submitted.",
  );
  await page.getByTestId("application-save").click();
  await expect(page.getByTestId("application-notice")).toContainText(
    "Application saved.",
  );
  await expect(page.getByTestId("application-status")).toHaveText(/draft/i);
  await page.getByTestId("application-cv").setInputFiles({
    name: "synthetic-revision.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic revision CV\nAlgorithms and tutoring"),
  });
  await page.getByTestId("application-cv-upload").click();
  await expect(page.getByTestId("application-notice")).toContainText(
    "CV uploaded privately.",
  );
  await page.getByTestId("application-submit").click();
  await expect(page.getByTestId("application-notice")).toContainText(
    "Application submitted.",
  );
  await page.getByTestId("application-withdraw").click();
  await expect(page.getByTestId("application-status")).toHaveText(/withdrawn/i);
  await page.getByTestId("application-submit").click();
  await expect(page.getByTestId("application-notice")).toContainText(
    "Application submitted.",
  );
});

test("a dirty recruitment schedule keeps its loaded version when another administrator saves", async ({
  page,
  space,
}) => {
  await signIn(page.context(), space.admin);
  await open(page, "/admin/staffing");
  const originalClose = await page.getByTestId("cycle-close").inputValue();
  await page.getByTestId("cycle-enabled").uncheck();
  const nextVersion =
    (await json(space.admin.api.get("/api/staffing/cycle"))).cycle.version + 1;
  const responsePromise = page.waitForResponse(
    async (response) =>
      response.url().includes("/api/staffing/overview") &&
      response.status() === 200 &&
      (await response.json()).currentCycle?.version === nextVersion,
  );
  const changed = await activateCycle(space.admin, space.term, {
    closesAt: new Date(Date.now() + 7200000).toISOString(),
  });
  await responsePromise;
  await expect(page.getByTestId("cycle-close")).toHaveValue(originalClose);
  await expect(page.getByTestId("cycle-conflict")).toBeVisible();
  await expect(page.getByTestId("cycle-save")).toBeDisabled();
  expect(
    (await json(space.admin.api.get("/api/staffing/cycle"))).cycle,
  ).toEqual(changed);
  await page.getByTestId("cycle-reset").click();
  await expect(page.getByTestId("cycle-enabled")).toBeChecked();
  await expect(page.getByTestId("cycle-close")).not.toHaveValue(originalClose);
});

test("RA appointments carrying course metadata expose no TA queue links", async ({
  page,
  space,
}) => {
  const posting = await space.opportunity({ type: "ra", courseId: space.code });
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(
    space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, {
      data: {},
    }),
  );
  await ok(
    space.admin.api.post(
      `/api/staffing/appointments/${selected.appointment.id}/clearance`,
      { data: { status: "cleared" } },
    ),
  );
  await signIn(page.context(), space.student);
  await open(page, `/applications/${application.id}`);
  await expect(page.getByTestId("appointment-workspace")).toHaveCount(0);
  await open(page, "/applications");
  await expect(
    page.getByTestId("my-appointment-" + selected.appointment.id),
  ).toContainText(posting.title);
  await expect(page.getByTestId("appointment-workspace")).toHaveCount(0);
  await signIn(page.context(), space.instructor);
  await open(page, `/staffing/${posting.id}`);
  await expect(
    page.getByRole("link", { name: "Course review", exact: true }),
  ).toHaveCount(0);
});

test("the Duke Computer Science PNG is served intact with the expected image type", async ({
  request,
}) => {
  const response = await request.get("/duke-cs-logo.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/png/);
  expect(await response.body()).toEqual(
    readFileSync("public/duke-cs-logo.png"),
  );
});

test("browser users publish, apply, upload, select, accept, clear, operate and end an appointment", async ({
  browser,
  baseURL,
  space,
}, testInfo) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    [space.instructor, space.student, space.admin].map(async (actor) => {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 1000 },
      });
      await signIn(context, actor);
      return context;
    }),
  );
  const [facultyContext, studentContext, adminContext] = contexts;
  const faculty = await facultyContext!.newPage();
  const student = await studentContext!.newPage();
  const admin = await adminContext!.newPage();
  const browserErrors: string[] = [];
  for (const page of [faculty, student, admin])
    page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    await open(faculty, "/courses");
    await faculty.getByTestId("staffing-link").click();
    await faculty.getByTestId("new-opportunity").click();
    await expect(faculty.getByTestId("opportunity-term")).toHaveCount(0);
    await expect(faculty.locator('input[type=\"datetime-local\"]')).toHaveCount(
      0,
    );
    await expect(faculty.getByTestId("opportunity-project")).toHaveCount(0);
    await faculty
      .getByTestId("opportunity-title")
      .fill(`Browser TA ${space.suffix}`);
    await faculty.getByTestId("opportunity-course").selectOption(space.code);
    await faculty
      .getByTestId("opportunity-description")
      .fill(
        "Support students, grade assignments, and hold two weekly office hours.",
      );
    await faculty
      .getByTestId("opportunity-required-skills")
      .fill("Algorithms and clear written explanations");
    await faculty.getByLabel("Attendance required", { exact: true }).check();
    await faculty.getByLabel("Lab responsibilities", { exact: true }).check();
    await faculty.getByLabel("Discussion sections", { exact: true }).check();
    await faculty
      .getByLabel("Assignment or exam grading", { exact: true })
      .check();
    await faculty.getByTestId("opportunity-add-question").click();
    await faculty
      .getByLabel("Qualification question 1", { exact: true })
      .fill("Describe your relevant course experience.");
    await faculty.getByTestId("opportunity-save").click();
    await expect(faculty).toHaveURL(/\/staffing\/[a-f0-9-]+$/);
    const postingId = new URL(faculty.url()).pathname.split("/").at(-1)!;
    await faculty.getByTestId("opportunity-publish").click();
    await expect(faculty.getByTestId("opportunity-status")).toContainText(
      /pending approval|published/i,
    );
    await open(admin, "/courses");
    await admin.getByTestId("staffing-admin-link").click();
    const approval = admin.getByTestId(`approve-opportunity-${postingId}`);
    await expect(approval).toBeVisible();
    await approval.click();
    await expect(admin.getByTestId("admin-staffing-notice")).toContainText(
      "approved",
    );
    await open(student, "/courses");
    await student.getByTestId("opportunities-link").click();
    await student
      .getByTestId("opportunity-search")
      .fill(`Browser TA ${space.suffix}`);
    await student
      .getByRole("link", { name: "View requirements", exact: true })
      .click();
    await expect(student).toHaveURL(
      new RegExp("/opportunities/" + postingId + "$"),
    );
    await expect(
      student.getByRole("heading", {
        name: `Browser TA ${space.suffix}`,
        exact: true,
      }),
    ).toBeVisible();
    await student.getByTestId("start-application").click();
    await expect(student).toHaveURL(/\/applications\/[a-f0-9-]+$/);
    const applicationId = new URL(student.url()).pathname.split("/").at(-1)!;
    await student.getByTestId("app-first-name").fill("Browser");
    await student.getByTestId("app-last-name").fill("Applicant");
    await student.getByTestId("app-majors").fill("Computer Science");
    await student.getByTestId("app-available-hours").fill("15");
    await student
      .getByLabel("Expected graduation term", { exact: true })
      .fill(space.term.name);
    await student
      .getByTestId("app-availability")
      .fill("Weekday afternoons and two weekly office hours.");
    await student
      .getByTestId("app-skills")
      .fill("Algorithms and peer tutoring");
    const question = student.locator('[data-testid^="app-answer-"]');
    await expect(question).toHaveCount(1);
    await question.fill("Completed algorithms and tutored other students.");
    await student.getByTestId("application-save").click();
    await expect(student.getByTestId("application-notice")).toContainText(
      "saved",
    );
    await student.getByTestId("application-cv").setInputFiles({
      name: "browser-cv.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Synthetic browser CV\nRelevant algorithms coursework and tutoring.",
      ),
    });
    await student.getByTestId("application-cv-upload").click();
    await expect(student.getByTestId("application-notice")).toContainText(
      "uploaded",
    );
    await student.getByTestId("application-submit").click();
    await expect(student.getByTestId("application-status")).toHaveText(
      /submitted/i,
    );
    await expect(
      faculty.getByTestId(`candidate-row-${applicationId}`),
    ).toContainText("Browser");
    await faculty.getByTestId(`shortlist-candidate-${applicationId}`).click();
    await expect(
      faculty.getByTestId(`candidate-row-${applicationId}`),
    ).toContainText(/shortlisted/i);
    await faculty.getByTestId(`select-candidate-${applicationId}`).click();
    await expect(faculty.getByTestId("staffing-notice")).toContainText(
      "Offer sent",
    );
    await expect(student.getByTestId("offer-accept")).toBeVisible();
    await student.getByTestId("offer-accept").click();
    await expect(student.getByTestId("appointment-status")).toContainText(
      /pending clearance/i,
    );
    await expect(student.getByTestId("appointment-workspace")).toHaveCount(0);
    const detail = await json(
      space.admin.api.get(`/api/staffing/applications/${applicationId}`),
    );
    const appointmentId = detail.appointment.id;
    await expect(admin.getByTestId(`clearance-${appointmentId}`)).toBeVisible();
    await admin.getByTestId(`clearance-${appointmentId}`).click();
    await expect(admin.getByTestId("admin-staffing-notice")).toContainText(
      "Clearance recorded",
    );
    await expect(student.getByTestId("appointment-status")).toHaveText(
      /active/i,
    );
    await expect(
      student.getByLabel("Work category").locator('option[value="research"]'),
    ).toHaveCount(0);
    await open(admin, `/applications/${applicationId}`);
    await admin.getByTestId("admin-duke-id").fill("SYNTHETIC-CORRECTED-ID");
    await admin
      .getByTestId("administrative-correction-reason")
      .fill("Synthetic browser correction");
    await admin.getByTestId("administrative-save").click();
    await expect(admin.getByTestId("application-notice")).toContainText(
      "details saved",
    );
    await expect(admin.getByTestId("appointment-status")).toHaveText(/active/i);
    await student.screenshot({
      path: testInfo.outputPath("active-ta-application.png"),
      fullPage: true,
    });
    await student.getByTestId("appointment-workspace").click();
    await expect(student).toHaveURL(new RegExp(`/courses/${space.code}/ta$`));
    await student.getByTestId("open-queue-btn").click();
    await student.getByTestId("on-duty-btn").click();
    await expect(student.getByTestId("on-duty-btn")).toContainText(/end duty/i);
    await student.screenshot({
      path: testInfo.outputPath("appointed-ta-queue.png"),
      fullPage: true,
    });
    await expect(
      faculty.getByTestId(`appointment-end-${appointmentId}`),
    ).toBeVisible();
    await faculty
      .getByTestId("appointment-reason")
      .fill("Synthetic browser appointment completed");
    await faculty.getByTestId(`appointment-end-${appointmentId}`).click();
    await expect(
      faculty.getByTestId(`appointment-row-${appointmentId}`),
    ).toContainText(/ended/i);
    await expect(student).toHaveURL(
      new RegExp(`/courses/${space.code}/student$`),
      { timeout: 15000 },
    );
    await expect(
      faculty.getByTestId(`appointment-settle-${appointmentId}`),
    ).toHaveCount(0);
    await open(admin, "/admin/staffing");
    await admin.getByTestId(`settlement-cost-${appointmentId}`).fill("100");
    await admin.getByTestId(`appointment-settle-${appointmentId}`).click();
    await expect(
      admin.getByTestId(`appointment-settle-${appointmentId}`),
    ).toHaveCount(0);
    const settledVersion = (
      await json(
        space.admin.api.get(`/api/staffing/opportunities/${postingId}`),
      )
    ).opportunity.version;
    // Returning to the faculty window wakes its automatic synchronization;
    // financial settlement in another session must be observed before the
    // separately confirmed archive command uses its optimistic version.
    await faculty.bringToFront();
    await faculty.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(faculty.getByTestId("opportunity-status")).toHaveAttribute(
      "data-version",
      String(settledVersion),
      { timeout: 15000 },
    );
    await expect(faculty.getByTestId("opportunity-archive")).toBeVisible();
    await faculty.getByTestId("opportunity-archive").click();
    await expect(faculty.getByTestId("opportunity-status")).toHaveText(
      /archived/i,
    );
    await ok(space.admin.api.delete(`/api/courses/${space.code}`));
    expect(browserErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("recruitment shortcuts belong to the home page and follow server role capabilities", async ({
  browser,
  baseURL,
  space,
}) => {
  test.setTimeout(120000);
  const ta = await space.actor("navigation-ta", "ta");
  await ok(
    space.admin.api.patch("/api/courses/" + space.code + "/enrollments/role", {
      data: { email: ta.email, role: "ta" },
    }),
  );
  const roles = [
    {
      actor: space.student,
      manage: false,
      admin: false,
      courseView: "student",
    },
    { actor: ta, manage: false, admin: false, courseView: "ta" },
    {
      actor: space.instructor,
      manage: true,
      admin: false,
      courseView: "admin",
    },
    { actor: space.admin, manage: true, admin: true, courseView: "admin" },
  ];
  for (const role of roles) {
    const context = await browser.newContext({ baseURL });
    try {
      await signIn(context, role.actor);
      const page = await context.newPage();
      await open(page, "/courses");
      await expect(page.getByTestId("staffing-link")).toHaveCount(
        role.manage ? 1 : 0,
      );
      await expect(page.getByTestId("staffing-admin-link")).toHaveCount(
        role.admin ? 1 : 0,
      );
      await expect(page.getByTestId("applications-link")).toHaveCount(
        role.manage ? 0 : 1,
      );
      await expect(page.getByTestId("opportunities-link")).toHaveCount(
        role.manage ? 0 : 1,
      );
      await expect(page.locator('a[href^="/projects"]')).toHaveCount(0);
      if (!role.manage) {
        for (const path of [
          "/staffing",
          "/staffing/new",
          "/staffing/not-owned",
          "/admin/staffing",
        ]) {
          await open(page, path);
          await expect(page).toHaveURL(/\/courses$/);
          await expect(page.getByTestId("staffing-link")).toHaveCount(0);
          await expect(
            page.getByText(
              /only authorized|do not currently manage|no access/i,
            ),
          ).toHaveCount(0);
        }
        await page.getByTestId("applications-link").click();
        await expect(page).toHaveURL(/\/applications$/);
        await expect(page.locator(".recruitment-home")).toHaveCount(0);
        await page
          .getByRole("link", { name: "Home", exact: false })
          .first()
          .click();
        await expect(page).toHaveURL(/\/courses$/);
      }
      await open(page, "/courses/" + space.code + "/" + role.courseView);
      await expect(
        page.locator(".recruitment-home, .staffing-navigation"),
      ).toHaveCount(0);
      await expect(
        page.locator(
          'a[href^="/staffing"], a[href="/opportunities"], a[href="/applications"], a[href="/admin/staffing"], a[href$="/review"]',
        ),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

test("administrators set the shared recruitment window while closed-cycle applicants keep their history", async ({
  browser,
  baseURL,
  space,
}) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const adminContext = await browser.newContext({ baseURL });
  const studentContext = await browser.newContext({ baseURL });
  try {
    await signIn(adminContext, space.admin);
    await signIn(studentContext, space.student);
    const admin = await adminContext.newPage();
    const student = await studentContext.newPage();
    await open(admin, "/courses");
    await admin.getByTestId("staffing-admin-link").click();
    await expect(admin.getByTestId("cycle-term")).toHaveValue(space.term.id);
    const closedAt = await admin.evaluate(() => {
      const date = new Date(Date.now() - 60000);
      return (
        date.getFullYear() +
        "-" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(date.getDate()).padStart(2, "0") +
        "T" +
        String(date.getHours()).padStart(2, "0") +
        ":" +
        String(date.getMinutes()).padStart(2, "0")
      );
    });
    await admin.getByTestId("cycle-close").fill(closedAt);
    await admin.getByTestId("cycle-save").click();
    await expect(admin.getByTestId("admin-staffing-notice")).toContainText(
      "schedule saved",
    );
    const { cycle } = await json(space.admin.api.get("/api/staffing/cycle"));
    expect(cycle.termId).toBe(space.term.id);
    expect(cycle.isOpen).toBe(false);
    await open(student, "/courses");
    await expect(student.getByTestId("opportunities-link")).toBeVisible();
    await student.getByTestId("applications-link").click();
    await student
      .getByTestId("application-row-" + application.id)
      .getByRole("link", { name: "Open application" })
      .click();
    await expect(student.getByTestId("application-status")).toHaveText(
      /submitted/i,
    );
    await expect(student.getByTestId("application-save")).toHaveCount(0);
    await expect(student.getByTestId("application-submit")).toHaveCount(0);
    await expect(student.getByTestId("application-withdraw")).toBeVisible();
    await expect(student.getByTestId("cycle-term")).toHaveCount(0);
    await open(student, "/opportunities/" + posting.id);
    await expect(student.getByTestId("start-application")).toHaveCount(0);
    await open(student, `/applications/${application.id}`);
    await student.getByTestId("application-withdraw").click();
    await expect(student.getByTestId("application-status")).toHaveText(
      /withdrawn/i,
    );
  } finally {
    await adminContext.close();
    await studentContext.close();
  }
});

test("keyboard dialogs trap focus, close with Escape and restore the initiating control", async ({
  page,
  space,
}) => {
  await ok(
    space.student.api.post("/api/courses/enroll", {
      data: { courseId: space.code, enroll: true },
    }),
  );
  await ok(
    space.admin.api.patch(`/api/courses/${space.code}/state`, {
      data: { state: "open" },
    }),
  );
  await ok(
    page.request.post("/api/auth/mock", {
      data: { as: "student", email: space.student.email },
    }),
  );
  await open(page, `/courses/${space.code}/student`);
  const enter = page.getByTestId("enter-queue-btn");
  await enter.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  for (let count = 0; count < 14; count++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(enter).toBeFocused();
  await page.getByTestId("feedback-open-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feedback-open-btn")).toBeFocused();
  await ok(
    space.admin.api.patch(`/api/courses/${space.code}/state`, {
      data: { state: "paused" },
    }),
  );
  await expect(page.locator(".state-pill")).toHaveText(/paused/i);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("RA applicants receive an offer and appointment without project or course staff access", async ({
  browser,
  baseURL,
  space,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signIn(context, space.instructor);
    await open(page, "/courses");
    await page.getByTestId("staffing-link").click();
    await page.getByTestId("new-opportunity").click();
    await page.getByTestId("opportunity-type").selectOption("ra");
    await expect(page.getByTestId("opportunity-project")).toHaveCount(0);
    await expect(page.getByTestId("opportunity-course")).toHaveCount(0);
    await expect(page.getByTestId("opportunity-term")).toHaveCount(0);
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
    const title = "Research assistant " + space.suffix;
    await page.getByTestId("opportunity-title").fill(title);
    await page
      .getByTestId("opportunity-description")
      .fill(
        "Review a synthetic research dataset with the supervising instructor.",
      );
    await page
      .getByTestId("opportunity-required-skills")
      .fill("Data analysis and clear documentation");
    await page.getByTestId("opportunity-save").click();
    await expect(page).toHaveURL(/\/staffing\/[a-f0-9-]+$/);
    const postingId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByTestId("opportunity-publish").click();
    await expect(page.getByTestId("opportunity-status")).toContainText(
      /pending approval|published/i,
    );
    let posting = (
      await json(
        space.instructor.api.get("/api/staffing/opportunities/" + postingId),
      )
    ).opportunity;
    if (posting.status === "pending_approval")
      posting = (
        await json(
          space.admin.api.post(
            "/api/staffing/opportunities/" + postingId + "/approve",
            { data: { approved: true, expectedVersion: posting.version } },
          ),
        )
      ).opportunity;
    const application = await space.application(posting, space.student, {
      answers: {},
    });
    const selected = await space.select(application);
    await signIn(context, space.student);
    await open(page, "/courses");
    await expect(
      page.getByRole("link", { name: /research projects|research workspace/i }),
    ).toHaveCount(0);
    await page.getByTestId("applications-link").click();
    await page
      .getByTestId("application-row-" + application.id)
      .getByRole("link", { name: "Open application" })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByTestId("offer-accept").click();
    await expect(page.getByTestId("appointment-status")).toHaveText(
      /pending clearance/i,
    );
    await ok(
      space.admin.api.post(
        "/api/staffing/appointments/" + selected.appointment.id + "/clearance",
        { data: { status: "cleared" } },
      ),
    );
    await expect(page.getByTestId("appointment-status")).toHaveText(/active/i);
    await expect(page.getByTestId("appointment-workspace")).toHaveCount(0);
    await expect(page.getByTestId("workload-save")).toHaveCount(0);
    await expect(page.locator('a[href^="/projects"]')).toHaveCount(0);
    expect(
      (await json(space.student.api.get("/api/courses/" + space.code))).isStaff,
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("active-ra-appointment.png"),
      fullPage: true,
    });
    await open(page, "/projects");
    await expect(page).toHaveURL(/\/courses$/);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("current-semester course review keeps complete aggregates when loading scenario details", async ({
  page,
  space,
}) => {
  const baseline = await json(
    space.instructor.api.get("/api/staffing/reviews/" + space.code),
  );
  const requests: Array<{ page: number; termId: string }> = [];
  // These labeled pagination responses stay in this browser and do not write financial observations.
  await page.route(
    "**/api/staffing/reviews/" + space.code + "*",
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const pageNumber = Number(query.get("page") || 1);
      const { currentCycle } = await json(
        space.instructor.api.get("/api/staffing/capabilities"),
      );
      const label =
        currentCycle.termId === space.term.id ? "Synthetic" : "New semester";
      const recordId = currentCycle.termId + "-position-" + pageNumber;
      requests.push({ page: pageNumber, termId: query.get("termId") || "" });
      return route.fulfill({
        json: {
          ...baseline,
          termId: currentCycle.termId,
          currentCycle,
          workload: {
            ...baseline.workload,
            totalHours: 20,
            count: 2,
            records: [{ id: "synthetic-workload-" + pageNumber, hours: 10 }],
          },
          budget: {
            ...baseline.budget,
            requestedBudget: 600,
            approvedBudget: 2000,
            committedBudget: 400,
            settledBudget: 100,
            opportunities: [
              {
                id: recordId,
                title: label + " position " + pageNumber,
                budget: 1000,
                committedBudget: 200,
              },
            ],
            scenarios: [
              {
                opportunityId: recordId,
                positions: 1,
                weeklyHours: 10,
                estimatedCost: 1000,
                budgetCovered: true,
                coverageValidated: false,
              },
            ],
          },
          pagination: {
            page: pageNumber,
            limit: 1,
            totals: { workload: 2, opportunities: 2 },
            hasMore: pageNumber === 1,
          },
        },
      });
    },
  );
  await signIn(page.context(), space.instructor);
  const initialReport = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/staffing/reviews/${space.code}`) &&
      response.status() === 200,
  );
  await open(page, "/courses/" + space.code + "/review");
  // Browser-only fixtures start after the SSR read. A focus event exercises
  // automatic synchronization without introducing a manual refresh control.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await initialReport;
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("review-term")).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByText(space.term.name, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Synthetic position 1/ }),
  ).toBeVisible();
  const workload = page.locator('dt:has-text("Reported workload") + dd');
  await expect(workload).toHaveText("20.0 hours");
  await page.getByTestId("staffing-load-more").click();
  await expect(
    page.getByRole("heading", { name: /Synthetic position 2/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Synthetic position 1/ }),
  ).toBeVisible();
  await expect(workload).toHaveText("20.0 hours");
  await expect(
    page.locator('dt:has-text("Requested position plans") + dd'),
  ).toHaveText("600");
  await expect(
    page.locator('dt:has-text("Approved position plans") + dd'),
  ).toHaveText("2000");
  await expect(
    page.locator('dt:has-text("Outstanding commitments") + dd'),
  ).toHaveText("400");
  await expect(page.locator('dt:has-text("Settled costs") + dd')).toHaveText(
    "100",
  );
  expect(requests.every((request) => request.termId === "")).toBe(true);
  expect(requests.at(-1)?.page).toBe(2);
  let nextTerm: any;
  try {
    nextTerm = (
      await json(
        space.admin.api.post("/api/staffing/terms", {
          data: {
            name: "Next synthetic semester " + space.suffix,
            startDate: new Date(Date.now() + 70 * 86400000).toISOString(),
            endDate: new Date(Date.now() + 130 * 86400000).toISOString(),
          },
        }),
      )
    ).term;
    const switchedReport = page.waitForResponse(
      async (response) =>
        new URL(response.url()).pathname ===
          `/api/staffing/reviews/${space.code}` &&
        response.status() === 200 &&
        (await response.json()).termId === nextTerm.id,
      { timeout: 30000 },
    );
    await activateCycle(space.admin, nextTerm);
    // Observe the normal idle poll before checking the new semester. The
    // report interval and a DOM assertion timeout are both ten seconds.
    await switchedReport;
    await expect(page.getByText(nextTerm.name, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /New semester position 1/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Synthetic position/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /New semester position 2/ }),
    ).toHaveCount(0);
    await expect(workload).toHaveText("20.0 hours");
    expect(requests.at(-1)?.page).toBe(1);
    expect(requests.every((request) => request.termId === "")).toBe(true);
  } finally {
    await activateCycle(space.admin, space.term);
    if (nextTerm) {
      const { client, db } = await database();
      try {
        await db.collection("staffingTerms").deleteOne({ id: nextTerm.id });
      } finally {
        await client.close();
      }
    }
  }
});

test("desktop and mobile staffing and queue screens pass automated accessibility checks", async ({
  browser,
  baseURL,
  space,
}, testInfo) => {
  test.setTimeout(300000);
  const posting = await space.opportunity();
  const draft = (
    await json(
      space.student.api.post(
        `/api/staffing/opportunities/${posting.id}/applications`,
        { data: {} },
      ),
    )
  ).application;
  const raPosting = await space.opportunity({
    type: "ra",
    courseId: "",
    title: "Accessible research appointment",
  });
  const raApplication = await space.application(raPosting);
  const selected = await space.select(raApplication);
  await ok(
    space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, {
      data: {},
    }),
  );
  await ok(
    space.admin.api.post(
      `/api/staffing/appointments/${selected.appointment.id}/clearance`,
      { data: { status: "cleared" } },
    ),
  );
  const ta = await space.actor("accessibility-ta", "ta");
  await ok(
    space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, {
      data: { email: ta.email, role: "ta" },
    }),
  );
  await ok(
    space.student.api.post("/api/courses/enroll", {
      data: { courseId: space.code, enroll: true },
    }),
  );
  await ok(
    space.admin.api.patch(`/api/courses/${space.code}/state`, {
      data: { state: "open" },
    }),
  );
  const screens: Array<{ actor: Actor | null; path: string; label: string }> = [
    { actor: null, path: "/login", label: "login" },
    { actor: space.student, path: "/courses", label: "student-home" },
    { actor: ta, path: "/courses", label: "ta-home" },
    { actor: space.instructor, path: "/courses", label: "instructor-home" },
    { actor: space.admin, path: "/courses", label: "admin-home" },
    { actor: space.student, path: "/opportunities", label: "opportunities" },
    {
      actor: space.student,
      path: `/opportunities/${posting.id}`,
      label: "opportunity",
    },
    {
      actor: space.student,
      path: `/applications/${draft.id}`,
      label: "application",
    },
    { actor: space.student, path: "/applications", label: "my-applications" },
    {
      actor: space.student,
      path: `/courses/${space.code}/student`,
      label: "student",
    },
    { actor: ta, path: `/courses/${space.code}/ta`, label: "ta" },
    {
      actor: space.instructor,
      path: `/courses/${space.code}/admin`,
      label: "course-admin",
    },
    {
      actor: space.instructor,
      path: `/staffing/${posting.id}`,
      label: "reviewer",
    },
    { actor: space.instructor, path: "/staffing", label: "staffing" },
    { actor: space.instructor, path: "/staffing/new", label: "publisher" },
    { actor: space.admin, path: "/admin/staffing", label: "staffing-admin" },
    { actor: space.admin, path: "/admin/courses", label: "site-admin" },
    {
      actor: space.instructor,
      path: `/courses/${space.code}/review`,
      label: "course-review",
    },
    {
      actor: space.admin,
      path: `/applications/${raApplication.id}`,
      label: "clearance-review",
    },
  ];
  const violations: any[] = [];
  const widths = [1440, 768, 390, 320];
  for (const width of widths) {
    for (const screen of screens) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1000 },
      });
      try {
        const page = await context.newPage();
        const browserErrors: string[] = [];
        page.on("pageerror", (error) => browserErrors.push(error.message));
        if (screen.actor) await signIn(context, screen.actor);
        await open(page, screen.path);
        expect(
          new URL(page.url()).pathname,
          `${screen.label} authorized destination`,
        ).toBe(screen.path);
        await expect(
          page.locator("header.app-navbar, header.app-banner"),
          `${screen.label} Duke blue`,
        ).toHaveCSS("background-color", "rgb(1, 33, 105)");
        const logo = page.locator("img.app-logo");
        await expect(logo).toBeVisible();
        await expect(logo).toHaveAttribute("src", "/duke-cs-logo.png");
        await expect(logo).toHaveAttribute("alt", /Duke.*Computer Science/i);
        await expect
          .poll(
            () =>
              logo.evaluate(
                (image) => (image as HTMLImageElement).naturalWidth,
              ),
            { message: `${screen.label} loaded PNG` },
          )
          .toBeGreaterThan(0);
        const logoBounds = await logo.boundingBox();
        expect(logoBounds).toBeTruthy();
        expect(logoBounds!.width).toBeGreaterThan(40);
        expect(logoBounds!.x).toBeGreaterThanOrEqual(0);
        expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(width);
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(browserErrors, `${screen.label} browser errors`).toEqual([]);
        violations.push(
          ...audit.violations.map((item) => ({
            screen: screen.label,
            width,
            id: item.id,
            impact: item.impact,
            nodes: item.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          })),
        );
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
          `${screen.label} at ${width}px`,
        ).toBeLessThanOrEqual(1);
        if (
          width === 390 &&
          ["application", "reviewer", "staffing-admin"].includes(screen.label)
        )
          await page.screenshot({
            path: testInfo.outputPath(`mobile-${screen.label}.png`),
            fullPage: true,
          });
      } finally {
        await context.close();
      }
    }
  }
  await testInfo.attach("accessibility-results.json", {
    body: JSON.stringify(
      {
        checkedScreens: screens.length * widths.length,
        widths,
        branding: { logo: "/duke-cs-logo.png", header: "#012169" },
        violations,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
});
