import { ObjectId } from "mongodb";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { CourseInsights } from "../../shared/course-insights";
import {
  test,
  expect,
  json,
  ok,
  openShowcasePage,
  type Showcase,
} from "../showcase-fixtures";

test.setTimeout(300000);

function easternDay(value: Date | string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function signedPage(
  browser: Browser,
  showcase: Showcase,
  actorKey: string,
) {
  const actor = await showcase.actor(actorKey);
  const context = await browser.newContext({
    baseURL: showcase.baseURL,
    storageState: await actor.api.storageState(),
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  return { context, page, actor };
}

function assertSummaryPrivacy(report: CourseInsights, forbidden: string[]) {
  const privateFields = new Set([
    "studentEmail",
    "studentName",
    "studentId",
    "question",
    "location",
    "positive",
    "negative",
    "allowContact",
  ]);
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect(
        privateFields.has(key),
        `Unexpected private summary field ${key}`,
      ).toBe(false);
      inspect(child);
    }
  };
  inspect(report);
  for (const value of forbidden)
    expect(JSON.stringify(report)).not.toContain(value);
}

test("insights use current course authority, complete snapshot totals and private aggregate projections", async ({
  showcase,
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  const { catalog, manifest, db } = showcase;
  const admin = await showcase.actor("admin");
  const faculty = await showcase.actor("faculty-algorithms");
  const ta = await showcase.actor("ta-main");
  const student = await showcase.actor("student-main");
  try {
    const departmentResponse = await ok(admin.api.get("/api/insights"));
    expect(departmentResponse.headers()["cache-control"]).toContain("no-store");
    const department: CourseInsights = await departmentResponse.json();
    expect(department.scope).toBe("department");
    expect(department.courses).toHaveLength(10);
    expect(department.currentCycle.termId).toBe(manifest.termIds.current);
    expect(department.timezone).toBe("America/New_York");
    expect(department.coverage.completeObservationEstablished).toBe(false);
    expect(await json(admin.api.get("/api/insights/access"))).toMatchObject({
      allowed: true,
      isGlobalAdmin: true,
      scope: "department",
      courseCount: 10,
    });
    const ownedIds = catalog.courses
      .filter((course: any) => course.instructorKey === "faculty-algorithms")
      .map((course: any) => manifest.courseIds[course.key])
      .sort();
    expect(ownedIds).toHaveLength(3);
    const own: CourseInsights = await json(faculty.api.get("/api/insights"));
    expect(own.scope).toBe("courses");
    expect(own.courses.map((course) => course.id).sort()).toEqual(ownedIds);
    expect(await json(faculty.api.get("/api/insights/access"))).toMatchObject({
      allowed: true,
      isGlobalAdmin: false,
      courseCount: 3,
    });
    expect(
      (
        await faculty.api.get("/api/insights", {
          params: { courseId: manifest.courseIds.intro },
        })
      ).status(),
    ).toBe(403);
    const selected: CourseInsights = await json(
      faculty.api.get("/api/insights", {
        params: { courseId: manifest.courseIds.structures.toUpperCase() },
      }),
    );
    expect(selected.scope).toBe("course");
    expect(selected.courses.map((course) => course.id)).toEqual([
      manifest.courseIds.structures,
    ]);
    const changedTerm = await faculty.api.get("/api/insights", {
      params: { expectedTermId: "outdated-synthetic-term" },
    });
    expect(changedTerm.status()).toBe(409);
    expect(await changedTerm.text()).toContain("INSIGHTS_TERM_CHANGED");
    expect(
      (
        await admin.api.get("/api/insights", {
          params: { from: "2026-02-31", to: "2026-03-01" },
        })
      ).status(),
    ).toBe(400);

    for (const [actorKey, actor] of [
      ["ta-main", ta],
      ["student-main", student],
    ] as const) {
      expect(await json(actor.api.get("/api/insights/access"))).toMatchObject({
        allowed: false,
        isGlobalAdmin: false,
        courseCount: 0,
      });
      expect((await actor.api.get("/api/insights")).status()).toBe(403);
      const viewer = await signedPage(browser, showcase, actorKey);
      contexts.push(viewer.context);
      await openShowcasePage(viewer.page, "/courses");
      await expect(viewer.page.getByTestId("insights-link")).toHaveCount(0);
      await openShowcasePage(viewer.page, "/insights");
      await expect(viewer.page).toHaveURL(/\/courses$/);
      await expect(viewer.page.getByTestId("insights-root")).toHaveCount(0);
    }

    // Explicit isolated observations exercise completeness beyond a 500-record slice.
    const courseId = manifest.courseIds.intro;
    const baseline: CourseInsights = await json(
      admin.api.get("/api/insights", { params: { courseId } }),
    );
    const helper = manifest.actors["ta-main"];
    const joinedAt = new Date(Date.now() - 2 * 86400000);
    const helpStartAt = new Date(joinedAt.getTime() + 5 * 60000);
    const helpEndAt = new Date(helpStartAt.getTime() + 2 * 60000);
    await db.collection("helpSessions").insertMany(
      Array.from({ length: 501 }, (_, index) => {
        const _id = new ObjectId();
        return {
          _id,
          synthetic: true,
          scenario: catalog.marker,
          source: "synthetic-insights-completeness-test",
          courseId,
          entryId: String(_id),
          studentId: `synthetic-insight-learner-${index}`,
          studentEmail: `synthetic-insight-learner-${index}@example.com`,
          studentName: `Synthetic learner ${index}`,
          question: "Private synthetic queue question",
          location: "Private synthetic location",
          joinedAt,
          helpStartAt,
          helpEndAt,
          leftQueueAt: helpEndAt,
          closedAt: helpEndAt,
          wasHelped: true,
          endReason: "completed",
          waitMinutes: 5,
          helpMinutes: 2,
          taEmail: helper.email,
          taName: helper.name,
          helpSegments: [
            {
              taEmail: helper.email,
              taName: helper.name,
              startAt: helpStartAt,
              endAt: helpEndAt,
              durationMs: 120000,
            },
          ],
        };
      }),
    );
    const complete: CourseInsights = await json(
      admin.api.get("/api/insights", { params: { courseId } }),
    );
    expect(complete.summary.requestCount).toBe(
      baseline.summary.requestCount + 501,
    );
    expect(complete.summary.closedCount).toBe(
      baseline.summary.closedCount + 501,
    );
    expect(complete.summary.helpedCount).toBe(
      baseline.summary.helpedCount + 501,
    );
    expect(complete.daily.reduce((sum, day) => sum + day.requests, 0)).toBe(
      complete.summary.requestCount,
    );
    expect(
      complete.heatmap.reduce((sum, bucket) => sum + bucket.requests, 0),
    ).toBe(complete.summary.requestCount);
    assertSummaryPrivacy(complete, [
      student.email,
      manifest.actors["student-main"].name,
      "synthetic-insight-learner-",
      "Private synthetic queue question",
      "Private synthetic location",
      catalog.feedback[0].positive,
      catalog.feedback[0].negative,
    ]);

    // An RA owner without any remaining instructional membership gains no insights scope.
    const raOwner = await showcase.actor("faculty-data");
    expect(
      await db
        .collection("staffingOpportunities")
        .countDocuments({ ownerEmail: raOwner.email, type: "ra" }),
    ).toBeGreaterThan(0);
    for (const course of catalog.courses.filter(
      (row: any) => row.instructorKey === "faculty-data",
    ))
      await ok(
        admin.api.patch(
          `/api/courses/${manifest.courseIds[course.key]}/enrollments/role`,
          { data: { email: raOwner.email, role: "student" } },
        ),
      );
    expect(await json(raOwner.api.get("/api/insights/access"))).toMatchObject({
      allowed: false,
      courseCount: 0,
    });
    expect((await raOwner.api.get("/api/insights")).status()).toBe(403);

    const viewer = await signedPage(browser, showcase, "faculty-algorithms");
    contexts.push(viewer.context);
    await openShowcasePage(viewer.page, "/insights");
    await expect(viewer.page.getByTestId("insights-root")).toBeVisible();
    for (const id of ownedIds)
      await ok(
        admin.api.patch(`/api/courses/${id}/enrollments/role`, {
          data: { email: faculty.email, role: "student" },
        }),
      );
    expect(await json(faculty.api.get("/api/insights/access"))).toMatchObject({
      allowed: false,
      courseCount: 0,
    });
    expect((await faculty.api.get("/api/insights")).status()).toBe(403);
    await expect(viewer.page).toHaveURL(/\/courses$/, { timeout: 20000 });
    await expect(viewer.page.getByTestId("insights-root")).toHaveCount(0);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

test("real help-session feedback updates one helper and responsive dashboards retain complete readable queue actions", async ({
  showcase,
  browser,
  browserName,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  const scans: Array<{ screen: string; width: number }> = [];
  const queueChecks: unknown[] = [];
  const errors: string[] = [];
  const { manifest } = showcase;
  const courseId = manifest.courseIds.systems;
  const student = await signedPage(browser, showcase, "student-three");
  const ta = await signedPage(browser, showcase, "ta-main");
  const reviewer = await signedPage(browser, showcase, "admin");
  contexts.push(student.context, ta.context, reviewer.context);
  for (const viewer of [student, ta, reviewer])
    viewer.page.on("pageerror", (error) => errors.push(error.message));
  const report = (): Promise<CourseInsights> =>
    json(reviewer.actor.api.get("/api/insights", { params: { courseId } }));
  const helperEmail = ta.actor.email;
  const helperFrom = (value: CourseInsights) =>
    value.helpers.find((helper) => helper.email === helperEmail)!;
  const audit = async (page: Page, screen: string, width: number) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations, `${screen} accessibility at ${width}px`).toEqual(
      [],
    );
    scans.push({ screen, width });
  };
  const presentation = async (page: Page) => {
    const layout = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      width: innerWidth,
      offenders: [...document.querySelectorAll("main *")]
        .filter(
          (element) =>
            !element.closest(
              ".insight-table-scroll, .insight-chart-scroll, .queue-panel, .table-wrap, .table-scroll",
            ),
        )
        .map((element) => ({
          tag: element.tagName,
          classes: element.getAttribute("class"),
          right: element.getBoundingClientRect().right,
          text: element.textContent?.trim().slice(0, 80),
        }))
        .filter((element) => element.right > innerWidth + 1)
        .slice(0, 16),
    }));
    expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
    expect(
      await page
        .locator("img.app-logo")
        .evaluate(async (image: HTMLImageElement) => {
          await image.decode();
          return image.complete && image.naturalWidth > 0;
        }),
    ).toBe(true);
    expect(
      await page
        .locator("header")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgb(1, 33, 105)");
  };
  try {
    const before = await report();
    const beforeHelper = helperFrom(before);
    expect(beforeHelper).toBeTruthy();
    await openShowcasePage(student.page, `/courses/${courseId}/student`);
    await openShowcasePage(ta.page, `/courses/${courseId}/ta`);
    await ta.page.getByTestId("on-duty-btn").click();
    await expect(ta.page.getByTestId("on-duty-btn")).toHaveText(/End Duty/i);
    await student.page.getByTestId("enter-queue-btn").click();
    await student.page
      .getByTestId("join-location")
      .fill("Synthetic computing lab, desk 7");
    await student.page
      .getByTestId("join-question")
      .fill("Private synthetic question about a memory boundary");
    await student.page.getByTestId("join-confirm").click();
    const row = ta.page.getByTestId(`ta-row-${student.actor.email}`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByTestId("ta-select-btn").click();
    await expect(row.getByTestId("ta-select-btn")).toHaveText("Complete");
    const claimedAt = Date.now();
    expect(
      (
        await json(
          student.actor.api.get(`/api/courses/${courseId}/feedback-context`),
        )
      ).sessions,
    ).toEqual([]);
    for (const width of [1440, 1280, 1024, 390, 320]) {
      await ta.page.setViewportSize({ width, height: 1000 });
      const geometry = await row.evaluate((element) => {
        const cell = element
          .querySelector(".col-actions")!
          .getBoundingClientRect();
        const buttons = [...element.querySelectorAll(".action-btn")].map(
          (button) => {
            const rect = button.getBoundingClientRect();
            return {
              top: rect.top,
              right: rect.right,
              width: rect.width,
              height: rect.height,
            };
          },
        );
        const pane = element.closest(".queue-panel") as HTMLElement;
        return {
          cellWidth: cell.width,
          cellRight: cell.right,
          buttons,
          paneWidth: pane.clientWidth,
          paneScrollWidth: pane.scrollWidth,
          studentWhitespace: getComputedStyle(
            element.querySelector(".col-student")!,
          ).whiteSpace,
          helperWhitespace: getComputedStyle(element.querySelector(".col-ta")!)
            .whiteSpace,
        };
      });
      expect(geometry.buttons).toHaveLength(6);
      expect(geometry.cellWidth).toBeGreaterThanOrEqual(329);
      for (const button of geometry.buttons) {
        expect(
          Math.abs(button.top - geometry.buttons[0]!.top),
        ).toBeLessThanOrEqual(1);
        expect(button.height).toBeGreaterThanOrEqual(31);
        expect(button.right).toBeLessThanOrEqual(geometry.cellRight + 1);
      }
      for (const icon of geometry.buttons.slice(-4))
        expect(icon.width).toBeCloseTo(32, 0);
      expect(geometry.studentWhitespace).toBe("nowrap");
      expect(geometry.helperWhitespace).toBe("nowrap");
      if (width < 600)
        expect(geometry.paneScrollWidth).toBeGreaterThan(geometry.paneWidth);
      await presentation(ta.page);
      queueChecks.push({ width, ...geometry });
    }
    await ta.page.setViewportSize({ width: 1440, height: 1000 });
    if (browserName === "chromium")
      await ta.page.screenshot({
        path: testInfo.outputPath("insights-queue-nowrap-desktop.png"),
        fullPage: true,
      });
    await ta.page.waitForTimeout(Math.max(0, 7100 - (Date.now() - claimedAt)));
    await row.getByTestId("ta-select-btn").click();
    await expect(row).toHaveCount(0);
    await expect(student.page.getByTestId("enter-queue-btn")).toBeVisible({
      timeout: 15000,
    });
    const completed = await json(
      student.actor.api.get(`/api/courses/${courseId}/feedback-context`),
    );
    expect(completed.sessions).toHaveLength(1);
    const session = completed.sessions[0];
    expect(session.helpers).toEqual([
      { email: helperEmail, name: manifest.actors["ta-main"].name },
    ]);
    const storedSession = await showcase.db
      .collection("helpSessions")
      .findOne({ _id: new ObjectId(session.id) });
    const signedStudent = await showcase.db
      .collection("users")
      .findOne({ email: student.actor.email });
    expect(storedSession!.studentId).toBe(signedStudent!.id);
    const sessionDay = easternDay(storedSession!.joinedAt);
    const positive =
      "The synthetic edge-case explanation made the reasoning clear.";
    const negative =
      "Provide a short written recap after the synthetic help session.";
    const body = {
      category: "ta",
      rating: 2,
      positive,
      negative,
      allowContact: false,
      helpSessionId: session.id,
      taEmail: helperEmail,
    };
    const foreign = await showcase.db.collection("helpSessions").findOne({
      courseId,
      studentEmail: { $ne: student.actor.email },
      wasHelped: true,
    });
    expect(foreign).toBeTruthy();
    expect(
      (
        await student.actor.api.post(`/api/courses/${courseId}/feedback`, {
          data: { ...body, helpSessionId: String(foreign!._id) },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await student.actor.api.post(`/api/courses/${courseId}/feedback`, {
          data: { ...body, taEmail: manifest.actors["ta-two"].email },
        })
      ).status(),
    ).toBe(400);
    await student.page.getByTestId("feedback-open-btn").click();
    await student.page.getByTestId("fb-category").selectOption("ta");
    await expect(
      student.page
        .getByTestId("fb-help-session")
        .locator(`option[value="${session.id}"]`),
    ).toHaveCount(1);
    await student.page.getByTestId("fb-help-session").selectOption(session.id);
    await student.page.getByTestId("fb-helper").selectOption(helperEmail);
    await student.page.getByTestId("fb-rating").selectOption("2");
    await student.page.getByTestId("fb-positive").fill(positive);
    await student.page.getByTestId("fb-negative").fill(negative);
    await student.page
      .getByRole("checkbox", {
        name: "Allow course staff to contact me by email if needed.",
      })
      .uncheck();
    await audit(student.page, "specific-helper-feedback", 1440);
    const submitted = student.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/courses/${courseId}/feedback` &&
        response.request().method() === "POST",
    );
    await student.page.getByTestId("fb-submit").click();
    expect((await submitted).status()).toBe(200);
    await expect(student.page.getByTestId("fb-submit")).toHaveCount(0);
    const savedFeedback = await showcase.db
      .collection("feedback")
      .findOne({
        courseId,
        studentId: student.actor.id,
        helpSessionId: session.id,
        taEmail: helperEmail,
      });
    expect(savedFeedback).toBeTruthy();
    const feedbackDay = easternDay(savedFeedback!.createdAt);
    expect(
      await json(
        student.actor.api.post(`/api/courses/${courseId}/feedback`, {
          data: body,
        }),
      ),
    ).toMatchObject({ replayed: true, ratingScope: "helper" });
    expect(
      (
        await student.actor.api.post(`/api/courses/${courseId}/feedback`, {
          data: { ...body, rating: 3 },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await json(
          student.actor.api.get(`/api/courses/${courseId}/feedback-context`),
        )
      ).sessions,
    ).toEqual([]);
    const after = await report();
    const afterHelper = helperFrom(after);
    expect(afterHelper.feedbackCount).toBe(beforeHelper.feedbackCount + 1);
    expect(afterHelper.feedbackReviewers).toBe(
      beforeHelper.feedbackReviewers + 1,
    );
    const priorRatingSum = beforeHelper.feedbackDistribution.reduce(
      (sum, bucket) => sum + bucket.rating * bucket.count,
      0,
    );
    expect(afterHelper.feedbackAverage).toBe(
      Math.round(((priorRatingSum + 2) / afterHelper.feedbackCount) * 100) /
        100,
    );
    expect(
      afterHelper.feedbackDistribution.find((bucket) => bucket.rating === 2)!
        .count,
    ).toBe(
      beforeHelper.feedbackDistribution.find((bucket) => bucket.rating === 2)!
        .count + 1,
    );
    expect(after.summary.helperFeedbackCount).toBe(
      before.summary.helperFeedbackCount + 1,
    );
    expect(after.summary.feedbackCount).toBe(before.summary.feedbackCount);
    await ok(
      student.actor.api.post(`/api/courses/${courseId}/feedback`, {
        data: {
          category: "ta",
          rating: 5,
          positive: "Synthetic course-level support note",
          negative: "Synthetic course-level scheduling note",
          allowContact: false,
        },
      }),
    );
    const afterCourse = await report();
    expect(afterCourse.summary.feedbackCount).toBe(
      after.summary.feedbackCount + 1,
    );
    expect(helperFrom(afterCourse).feedbackCount).toBe(
      afterHelper.feedbackCount,
    );
    expect(helperFrom(afterCourse).feedbackAverage).toBe(
      afterHelper.feedbackAverage,
    );
    assertSummaryPrivacy(afterCourse, [
      student.actor.email,
      positive,
      negative,
      "Private synthetic question about a memory boundary",
      "Synthetic course-level support note",
    ]);

    await openShowcasePage(reviewer.page, "/insights");
    await expect(
      reviewer.page.getByTestId(`insights-course-${courseId}`),
    ).toBeVisible();
    await expect(
      reviewer.page.locator('tr[data-testid^="insights-course-"]'),
    ).toHaveCount(10);
    await expect(reviewer.page.getByTestId("insights-heatmap")).toBeVisible();
    await expect(reviewer.page.getByTestId("insights-daily")).toBeVisible();
    if (browserName === "chromium")
      await reviewer.page.screenshot({
        path: testInfo.outputPath("insights-department-desktop.png"),
        fullPage: true,
      });
    await reviewer.page.getByTestId("insights-course").selectOption(courseId);
    await expect(
      reviewer.page.locator('tr[data-testid^="insights-course-"]'),
    ).toHaveCount(1);
    await reviewer.page.getByTestId("insights-helper-search").fill(helperEmail);
    await expect(
      reviewer.page.getByTestId(`insights-helper-${helperEmail}`),
    ).toContainText(`${afterHelper.feedbackCount} ratings`);
    await expect(
      reviewer.page.getByTestId(`insights-helper-${helperEmail}`),
    ).toContainText(`${afterHelper.feedbackReviewers} students`);
    await expect(
      reviewer.page.getByTestId(`insights-feedback-${helperEmail}`),
    ).toHaveText("Positive feedback");
    await reviewer.page.getByTestId("insights-from").fill(sessionDay);
    await reviewer.page.getByTestId("insights-to").fill(sessionDay);
    await expect(reviewer.page.getByTestId("insights-requests")).toHaveText(
      "1",
    );
    await expect(
      reviewer.page.getByTestId(`insights-helper-${helperEmail}`),
    ).toContainText(feedbackDay === sessionDay ? "1 rating" : "Not rated");
    await reviewer.page
      .getByTestId("insights-from")
      .fill(afterCourse.range.from);
    await reviewer.page.getByTestId("insights-to").fill(afterCourse.range.to);
    await expect(reviewer.page.getByTestId("insights-requests")).toHaveText(
      String(afterCourse.summary.requestCount),
    );
    await expect(
      reviewer.page.getByTestId(`insights-helper-${helperEmail}`),
    ).toContainText(`${afterHelper.feedbackCount} ratings`);
    await reviewer.page.getByTestId("insights-helper-search").fill("");
    await reviewer.page
      .getByTestId("insights-helper-sort")
      .selectOption("feedback-low");
    await expect(
      reviewer.page.locator('tr[data-testid^="insights-helper-"]').first(),
    ).toHaveAttribute("data-testid", `insights-helper-${helperEmail}`);
    for (const width of [1440, 768, 390, 320]) {
      await reviewer.page.setViewportSize({ width, height: 1000 });
      await expect(reviewer.page.getByTestId("insights-root")).toBeVisible();
      await presentation(reviewer.page);
      await audit(reviewer.page, "department-insights", width);
      if (browserName === "chromium" && width === 390)
        await reviewer.page.screenshot({
          path: testInfo.outputPath("insights-helper-feedback-mobile.png"),
          fullPage: true,
        });
    }
    await openShowcasePage(reviewer.page, `/courses/${courseId}/admin`);
    const embedded = reviewer.page.getByTestId("course-insights-root");
    await expect(embedded).toBeVisible();
    await expect(
      reviewer.page.getByTestId("feedback-row").filter({ hasText: positive }),
    ).toContainText(manifest.actors["ta-main"].name);
    await expect(embedded.getByTestId("insights-requests")).toBeVisible();
    await embedded.getByTestId("insights-from").fill(afterCourse.range.from);
    await embedded.getByTestId("insights-to").fill(afterCourse.range.to);
    await expect(
      embedded.getByTestId(`insights-helper-${helperEmail}`),
    ).toContainText(`${afterHelper.feedbackCount} ratings`);
    for (const width of [1440, 768, 390, 320]) {
      await reviewer.page.setViewportSize({ width, height: 1000 });
      await presentation(reviewer.page);
      await audit(reviewer.page, "embedded-course-insights", width);
      if (browserName === "chromium" && width === 1440)
        await reviewer.page.screenshot({
          path: testInfo.outputPath("insights-course-desktop.png"),
          fullPage: true,
        });
    }
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach("accessibility-results.json", {
      body: JSON.stringify({
        checkedScreens: scans.length,
        screens: scans,
        violations: [],
        synthetic: true,
        scope: "Real help-session feedback and department/course dashboards",
      }),
      contentType: "application/json",
    });
    await testInfo.attach("insights-queue-geometry.json", {
      body: JSON.stringify({ checks: queueChecks, synthetic: true }),
      contentType: "application/json",
    });
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
