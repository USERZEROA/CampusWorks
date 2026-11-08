import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect, json, ok, openShowcasePage, type Showcase } from "../showcase-fixtures";

test.setTimeout(300000);

async function signedPage(browser: Browser, showcase: Showcase, actorKey: string): Promise<{ context: BrowserContext; page: Page }> {
  const person = await showcase.actor(actorKey);
  const context = await browser.newContext({ baseURL: showcase.baseURL, storageState: await person.api.storageState(), viewport: { width: 1440, height: 1000 } });
  return { context, page: await context.newPage() };
}
const appKey = (actor: string, opportunity: string) => `${actor}--${opportunity}`;

test("the complete showcase has coherent real lifecycle records and repeated preparation preserves data and human decisions", async ({ showcase }) => {
  const { db, catalog, manifest } = showcase;
  const counts = async () => Object.fromEntries(await Promise.all(["courses", "users", "staffingOpportunities", "staffingApplications", "staffingDocuments", "staffingAppointments", "staffingOffers", "staffingWorkload", "helpSessions", "feedback", "staffingEvents", "staffingCommands", "staffingNotifications"].map(async name => [name, await db.collection(name).countDocuments()])));
  const initial = await counts();
  expect(initial.courses).toBe(10);
  expect(initial.users).toBe(41);
  expect(initial.staffingOpportunities).toBe(21);
  expect(initial.staffingApplications).toBe(68);
  expect(initial.staffingWorkload).toBe(30);
  expect(initial.helpSessions).toBe(380);
  expect(initial.feedback).toBe(80);
  expect(initial.staffingOffers).toBe(catalog.applications.filter((application: any) => application.seedActions.includes("select")).length);
  expect(initial.staffingAppointments).toBe(initial.staffingOffers);
  expect(initial.staffingNotifications).toBeGreaterThan(30);
  expect(await db.collection("staffingAiTasks").countDocuments()).toBe(0);
  expect(await db.collection("staffingAiBudgets").countDocuments()).toBe(0);
  expect(await db.collection("helpSessions").countDocuments({ synthetic: true, scenario: catalog.marker })).toBe(380);
  expect(await db.collection("feedback").countDocuments({ synthetic: true, scenario: catalog.marker })).toBe(80);

  const faculty = await showcase.actor("faculty-main");
  const featuredId = manifest.opportunityIds["intro-ta"];
  const posting = await json(faculty.api.get(`/api/staffing/opportunities/${featuredId}`));
  const available = posting.applications.filter((application: any) => ["submitted", "under_review", "shortlisted"].includes(application.status) && application.availability.eligible && !application.availability.unavailable);
  expect(available).toHaveLength(12);
  expect(available.map((application: any) => application.applicantId).sort()).toEqual(catalog.featured.eligibleCandidateKeys.map((key: string) => manifest.actors[key].id).sort());
  expect(posting.opportunity).toMatchObject({ positions: 3, committedPositions: 1 });
  const applicant = await showcase.actor("student-two");
  const own = await json(applicant.api.get("/api/staffing/overview"));
  expect(own.myApplications).toHaveLength(7);
  expect(own.myAppointments).toHaveLength(1);
  expect(own.myAppointments[0]).toMatchObject({ status: "offered", type: "ta" });
  expect((await json(applicant.api.get(`/api/courses/${manifest.courseIds.structures}`))).isStaff).toBe(false);
  for (const appointment of await db.collection("staffingAppointments").find({ type: "ra" }).toArray()) {
    expect(appointment.courseId).toBe("");
    expect(appointment).not.toHaveProperty("projectId");
  }
  const duplicateLive = await db.collection("staffingAppointments").aggregate([{ $match: { status: { $in: ["offered", "pending_clearance", "pending_start", "active", "suspended"] } } }, { $group: { _id: "$applicantId", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]).toArray();
  expect(duplicateLive).toEqual([]);
  const review = await json(faculty.api.get(`/api/staffing/reviews/${manifest.courseIds.intro}`));
  expect(review.termId).toBe(manifest.termIds.current);
  expect(review.workload.totalHours).toBeGreaterThan(0);
  expect(review.metrics).toBeTruthy();
  expect(review.staffing.approvedPositions).toBeGreaterThan(0);

  const admin = await showcase.actor("admin");
  const { cycle } = await json(admin.api.get("/api/staffing/cycle"));
  const disabled = (await json(admin.api.put("/api/staffing/cycle", { data: { expectedVersion: cycle.version, termId: cycle.termId, opensAt: cycle.opensAt, closesAt: cycle.closesAt, enabled: false } }))).cycle;
  const beforeRepeat = await counts();
  const repeated = await showcase.prepare();
  expect(repeated.manifest.complete).toBe(true);
  expect(await counts()).toEqual(beforeRepeat);
  expect((await json(admin.api.get("/api/staffing/cycle"))).cycle).toEqual(disabled);
});

test("a populated candidate accepts an offer, gains only cleared course authority and ends the appointment before archiving through the browser", async ({ showcase, browser }) => {
  const { manifest } = showcase;
  const key = appKey("student-two", "structures-ta");
  const applicationId = manifest.applicationIds[key];
  const appointmentId = manifest.appointmentIds[key];
  const courseId = manifest.courseIds.structures;
  const candidate = await signedPage(browser, showcase, "student-two");
  const administrator = await signedPage(browser, showcase, "admin");
  const faculty = await signedPage(browser, showcase, "faculty-algorithms");
  try {
    await openShowcasePage(candidate.page, `/applications/${applicationId}`);
    await expect(candidate.page.getByTestId("appointment-status")).toHaveText(/offered/i);
    await candidate.page.getByTestId("offer-accept").click();
    await expect(candidate.page.getByTestId("appointment-status")).toHaveText(/pending clearance/i);
    const student = await showcase.actor("student-two");
    expect((await json(student.api.get(`/api/courses/${courseId}`))).isStaff).toBe(false);
    await openShowcasePage(administrator.page, "/admin/staffing");
    await administrator.page.getByTestId(`clearance-status-${appointmentId}`).selectOption("cleared");
    await administrator.page.getByTestId(`clearance-${appointmentId}`).click();
    await expect(candidate.page.getByTestId("appointment-status")).toHaveText(/active/i, { timeout: 15000 });
    await expect(candidate.page.getByTestId("appointment-workspace")).toBeVisible();
    await candidate.page.getByTestId("appointment-workspace").click();
    await expect(candidate.page).toHaveURL(new RegExp(`/courses/${courseId}/ta$`));
    await candidate.page.getByTestId("on-duty-btn").click();
    await expect(candidate.page.getByTestId("on-duty-btn")).toHaveText(/end duty/i);
    const waitingStudent = manifest.actors["candidate-05"];
    const row = candidate.page.getByTestId(`ta-row-${waitingStudent.email}`);
    await expect(row).toBeVisible();
    await row.getByTestId("ta-select-btn").click();
    await expect(row.getByTestId("ta-select-btn")).toHaveText(/complete/i);
    expect((await json(student.api.get(`/api/courses/${manifest.courseIds.intro}`))).isStaff).toBe(false);

    await openShowcasePage(faculty.page, `/staffing/${manifest.opportunityIds["structures-ta"]}`);
    await faculty.page.getByTestId("appointment-reason").fill("Synthetic demonstration appointment concluded after the support session.");
    await faculty.page.getByTestId(`appointment-end-${appointmentId}`).click();
    await expect.poll(async () => (await showcase.db.collection("staffingAppointments").findOne({ id: appointmentId }))?.status).toBe("ended");
    await expect.poll(async () => (await json(student.api.get(`/api/courses/${courseId}`))).isStaff).toBe(false);
    expect(await showcase.db.collection("queueEntries").countDocuments({ courseId, taEmail: student.email })).toBe(0);
    const course = await showcase.db.collection("courses").findOne({ id: courseId });
    expect((course?.onDutyTAs || []).some((person: any) => person.email === student.email)).toBe(false);
    await expect(candidate.page).toHaveURL(new RegExp(`/courses/${courseId}/student$`), { timeout: 20000 });
    await expect(faculty.page.getByTestId("opportunity-capacity")).toContainText("3 open");
    await faculty.page.getByTestId("opportunity-archive").click();
    await expect(faculty.page.getByTestId("opportunity-status")).toHaveText(/archived/i);
  } finally { await Promise.all([candidate.context.close(), administrator.context.close(), faculty.context.close()]); }
});

test("fractional hours save and submit through real controls while a full position disables every further offer", async ({ showcase, browser }) => {
  const teacher = await signedPage(browser, showcase, "faculty-main");
  const applicant = await signedPage(browser, showcase, "student-three");
  const { manifest } = showcase;
  try {
    await openShowcasePage(teacher.page, "/staffing/new");
    await teacher.page.getByTestId("opportunity-title").fill("Fractional workload · Synthetic verification");
    await teacher.page.getByTestId("opportunity-course").selectOption(manifest.courseIds.intro);
    await teacher.page.getByTestId("opportunity-description").fill("Synthetic position with a fractional weekly workload and ordinary approval.");
    await teacher.page.getByTestId("opportunity-hours").fill("19.9");
    expect(await teacher.page.getByTestId("opportunity-hours").evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
    await teacher.page.getByTestId("opportunity-required-skills").fill("Programming and clear explanations");
    await teacher.page.getByTestId("opportunity-add-question").click();
    await teacher.page.getByLabel("Qualification question 1", { exact: true }).fill("How would you explain a failing test to a student?");
    const creation = teacher.page.waitForResponse(response => new URL(response.url()).pathname === "/api/staffing/opportunities" && response.request().method() === "POST");
    await teacher.page.getByTestId("opportunity-save").click();
    const creationResponse = await creation;
    expect(creationResponse.status()).toBe(200);
    const created = (await creationResponse.json()).opportunity;
    expect(created.weeklyHours).toBe(19.9);
    await expect(teacher.page).toHaveURL(new RegExp(`/staffing/${created.id}$`));
    await teacher.page.getByTestId("opportunity-publish").click();
    await expect(teacher.page.getByTestId("opportunity-status")).toHaveText(/pending approval/i);
    const admin = await showcase.actor("admin");
    const publication = (await json(admin.api.get(`/api/staffing/opportunities/${created.id}`))).opportunity;
    await ok(admin.api.post(`/api/staffing/opportunities/${created.id}/approve`, { data: { expectedVersion: publication.version, approved: true } }));
    await openShowcasePage(applicant.page, `/opportunities/${created.id}`);
    await applicant.page.getByTestId("start-application").click();
    await expect(applicant.page).toHaveURL(/\/applications\/[a-f0-9-]+$/);
    const applicationId = new URL(applicant.page.url()).pathname.split("/").at(-1)!;
    await applicant.page.getByTestId("app-first-name").fill("Jordan");
    await applicant.page.getByTestId("app-last-name").fill("Rivera");
    await applicant.page.getByTestId("app-email").fill(manifest.actors["student-three"].email);
    await applicant.page.getByTestId("app-majors").fill("Computer Science");
    await applicant.page.getByLabel("Department", { exact: true }).fill("Computer Science");
    await applicant.page.getByLabel("Expected graduation term", { exact: true }).fill("Spring 2027");
    await applicant.page.getByTestId("app-available-hours").fill("19.9");
    expect(await applicant.page.getByTestId("app-available-hours").evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
    await applicant.page.getByTestId("app-availability").fill("Available for the stated fractional weekly workload.");
    await applicant.page.getByTestId("app-skills").fill("Programming and clear explanations");
    await applicant.page.locator('[data-testid^="app-answer-"]').fill("I would identify the smallest failing input, check the student's reasoning and suggest one focused experiment.");
    await applicant.page.getByTestId("application-save").click();
    await expect(applicant.page.getByTestId("application-notice")).toContainText("Application saved.");
    await applicant.page.getByTestId("application-cv").setInputFiles({ name: "synthetic-fractional-cv.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic CV: programming coursework and peer explanations. No real candidate information.") });
    await applicant.page.getByTestId("application-cv-upload").click();
    await expect(applicant.page.getByTestId("application-notice")).toContainText("CV uploaded privately.");
    await applicant.page.getByTestId("application-submit").click();
    await expect(applicant.page.getByTestId("application-status")).toHaveText(/submitted/i);
    expect((await showcase.db.collection("staffingApplications").findOne({ id: applicationId }))?.submittedSnapshot.profile.availableHours).toBe(19.9);

    const featuredId = manifest.opportunityIds["intro-ta"];
    await openShowcasePage(teacher.page, `/staffing/${featuredId}`);
    await expect(teacher.page.getByTestId("opportunity-capacity")).toContainText("2 open");
    for (const [index, key] of ["candidate-04", "candidate-05"].entries()) {
      const selectedId = manifest.applicationIds[appKey(key, "intro-ta")];
      await teacher.page.getByTestId(`select-candidate-${selectedId}`).click();
      await expect(teacher.page.getByTestId("opportunity-capacity")).toContainText(`${1 - index} open`);
    }
    await expect(teacher.page.getByTestId("opportunity-status")).toHaveText(/filled/i);
    expect(await teacher.page.locator('[data-testid^="select-candidate-"]').evaluateAll(buttons => buttons.every(button => (button as HTMLButtonElement).disabled))).toBe(true);
    const faculty = await showcase.actor("faculty-main");
    const thirdId = manifest.applicationIds[appKey("candidate-06", "intro-ta")];
    const third = (await json(faculty.api.get(`/api/staffing/applications/${thirdId}`))).application;
    expect((await faculty.api.post(`/api/staffing/applications/${thirdId}/select`, { data: { expectedVersion: third.version, idempotencyKey: `showcase-full-${randomUUID()}` } })).status()).toBe(409);
    expect((await showcase.db.collection("staffingOpportunities").findOne({ id: featuredId }))?.committedPositions).toBe(3);
  } finally { await Promise.all([teacher.context.close(), applicant.context.close()]); }
});
