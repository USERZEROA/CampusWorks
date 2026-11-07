import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, openShowcasePage } from "../showcase-fixtures";

test.setTimeout(300000);

test("populated four-role screens show complete real records and retain accessible Duke blue layouts", async ({
  showcase,
  browser,
  browserName,
}, testInfo) => {
  const { catalog, manifest, db } = showcase;
  const featuredCourse = manifest.courseIds[catalog.featured.courseKey];
  const featuredPosition =
    manifest.opportunityIds[catalog.featured.opportunityKey];
  const featuredApplication =
    manifest.applicationIds[catalog.featured.applicationKey];
  const postedStates = ["published", "applications_closed", "filled"];
  const publicPositions = catalog.opportunities.filter((item: any) =>
    postedStates.includes(item.stage),
  );
  const pendingPositions = catalog.opportunities.filter(
    (item: any) => item.stage === "pending_approval",
  );
  const applicantRecords = catalog.applications.filter(
    (item: any) => item.actorKey === catalog.featured.applicantKey,
  );
  const mainApplications = catalog.applications.filter(
    (item: any) =>
      item.opportunityKey === catalog.featured.opportunityKey &&
      item.seedActions.includes("submit"),
  );
  const appointmentRecords = catalog.applications.filter((item: any) =>
    item.seedActions.includes("select"),
  );
  const livePlan = catalog.queuePlans.find(
    (item: any) => item.courseKey === catalog.featured.courseKey,
  );
  const recordedSessions = catalog.history.filter(
    (item: any) =>
      item.courseKey === catalog.featured.courseKey &&
      item.termKey === "current",
  );
  const helped = recordedSessions.filter((item: any) => item.wasHelped);
  const waiting = helped
    .map((item: any) => item.waitMinutes as number)
    .sort((left: number, right: number) => left - right);
  const feedback = catalog.feedback.filter(
    (item: any) =>
      item.courseKey === catalog.featured.courseKey &&
      item.termKey === "current",
  );
  const coursePositions = catalog.opportunities.filter(
    (item: any) => item.courseKey === catalog.featured.courseKey,
  );
  const coursePositionKeys = new Set(
    coursePositions.map((item: any) => item.key),
  );
  const courseApplications = new Set(
    catalog.applications
      .filter((item: any) => coursePositionKeys.has(item.opportunityKey))
      .map((item: any) => item.key),
  );
  const reportedHours = catalog.workloads
    .filter((item: any) => courseApplications.has(item.applicationKey))
    .reduce((total: number, item: any) => total + item.hours, 0);
  const approvedBudget = coursePositions
    .filter((item: any) =>
      ["published", "applications_closed", "filled", "archived"].includes(
        item.stage,
      ),
    )
    .reduce((total: number, item: any) => total + item.input.budget, 0);

  expect(manifest.synthetic).toBe(true);
  expect(manifest.complete).toBe(true);
  expect(catalog.featured.eligibleCandidateKeys).toHaveLength(12);
  expect(applicantRecords).toHaveLength(7);
  expect(await db.collection("queueEntries").countDocuments()).toBe(11);
  expect(recordedSessions).toHaveLength(24);
  expect(helped).toHaveLength(22);
  expect(feedback).toHaveLength(8);
  expect(reportedHours).toBeGreaterThan(0);

  type Screen = {
    key: string;
    actor: string;
    path: string;
    desktopScreenshot?: string;
    mobileScreenshot?: string;
  };
  const screens: Screen[] = [
    {
      key: "recruitment",
      actor: "admin",
      path: "/staffing",
      desktopScreenshot: "recruitment",
    },
    {
      key: "candidate-pool",
      actor: "faculty-main",
      path: `/staffing/${featuredPosition}`,
      desktopScreenshot: "candidate-pool",
    },
    {
      key: "applicant-applications",
      actor: "student-two",
      path: "/applications",
      desktopScreenshot: "applicant-applications",
    },
    {
      key: "clearance",
      actor: "admin",
      path: "/admin/staffing",
      desktopScreenshot: "clearance",
    },
    {
      key: "ta-queue",
      actor: "ta-main",
      path: `/courses/${featuredCourse}/ta`,
      desktopScreenshot: "ta-queue",
    },
    {
      key: "course-report",
      actor: "faculty-main",
      path: `/courses/${featuredCourse}/review`,
      desktopScreenshot: "course-report",
    },
    {
      key: "position-catalog",
      actor: "student-two",
      path: "/opportunities",
      mobileScreenshot: "position-catalog",
    },
    {
      key: "applicant-offer",
      actor: "student-two",
      path: `/applications/${featuredApplication}`,
      mobileScreenshot: "applicant-offer",
    },
    { key: "faculty-inbox", actor: "faculty-main", path: "/applications" },
  ];
  const sessions = new Map<
    string,
    { context: BrowserContext; page: Page; errors: string[] }
  >();
  const widths = [1440, 768, 390, 320];
  const violations: any[] = [];
  const checks: Array<{ screen: string; width: number }> = [];
  const screenshots: string[] = [];
  const statistic = (page: Page, label: string) =>
    page.locator(`dt:has-text("${label}") + dd`);
  const sessionFor = async (key: string) => {
    if (sessions.has(key)) return sessions.get(key)!;
    const actor = await showcase.actor(key);
    const context = await browser.newContext({
      baseURL: showcase.baseURL,
      storageState: await actor.api.storageState(),
      viewport: { width: widths[0]!, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const value = { context, page, errors };
    sessions.set(key, value);
    return value;
  };

  try {
    for (const width of widths) {
      for (const screen of screens) {
        const session = await sessionFor(screen.actor);
        const { page, errors } = session;
        errors.length = 0;
        await page.setViewportSize({ width, height: 1000 });
        await openShowcasePage(page, screen.path);
        expect(
          new URL(page.url()).pathname,
          `${screen.key} authorized route`,
        ).toBe(screen.path);
        await expect(
          page.getByLabel("Demonstration data", { exact: true }),
        ).toHaveText("Synthetic demo data");
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(
          page.locator("header.app-navbar, header.app-banner"),
        ).toHaveCSS("background-color", "rgb(1, 33, 105)");
        const logo = page.locator("img.app-logo");
        await expect(logo).toBeVisible();
        await expect(logo).toHaveAttribute("src", "/duke-cs-logo.png");
        await expect(logo).toHaveAttribute("alt", /Duke.*Computer Science/i);
        await expect
          .poll(() =>
            logo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
        const logoBounds = await logo.boundingBox();
        expect(logoBounds).toBeTruthy();
        expect(logoBounds!.width).toBeGreaterThan(40);
        expect(logoBounds!.x).toBeGreaterThanOrEqual(0);
        expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(width);
        await expect(
          page.getByRole("button", {
            name: /^(refresh|reload|retry|analyze candidates|summarize application|draft course review|draft requirements)$/i,
          }),
        ).toHaveCount(0);

        if (screen.key === "recruitment") {
          await expect(
            page.locator('[data-testid^="managed-opportunity-"]'),
          ).toHaveCount(catalog.opportunities.length);
          await expect(statistic(page, "Opportunities")).toHaveText(
            String(catalog.opportunities.length),
          );
          await expect(statistic(page, "Course offerings")).toHaveText(
            String(catalog.courses.length),
          );
          if (width === widths[0]) {
            await page
              .getByTestId("managed-position-state")
              .selectOption("pending_approval");
            await expect(
              page.locator('[data-testid^="managed-opportunity-"]'),
            ).toHaveCount(pendingPositions.length);
            await expect(statistic(page, "Opportunities")).toHaveText(
              String(catalog.opportunities.length),
            );
            await page.getByTestId("managed-position-state").selectOption("");
            await expect(
              page.locator('[data-testid^="managed-opportunity-"]'),
            ).toHaveCount(catalog.opportunities.length);
          }
        } else if (screen.key === "candidate-pool") {
          await expect(
            page.locator('[data-testid^="candidate-row-"]'),
          ).toHaveCount(mainApplications.length);
          for (const key of catalog.featured.eligibleCandidateKeys) {
            const applicationId =
              manifest.applicationIds[
                `${key}--${catalog.featured.opportunityKey}`
              ];
            await expect(
              page.getByTestId(`candidate-row-${applicationId}`),
            ).toBeVisible();
            await expect(
              page.getByTestId(`select-candidate-${applicationId}`),
            ).toBeEnabled();
          }
          await expect(page.getByTestId("opportunity-capacity")).toHaveText(
            "2 open / 3 positions",
          );
          await expect(
            page.getByRole("heading", {
              name: "Candidate Review Assistance",
              exact: true,
            }),
          ).toBeVisible();
        } else if (screen.key === "applicant-applications") {
          await expect(
            page.locator('[data-testid^="application-row-"]'),
          ).toHaveCount(applicantRecords.length);
          await expect(statistic(page, "Applications")).toHaveText(
            String(applicantRecords.length),
          );
          expect(
            await page.locator('[data-testid^="notification-"]').count(),
          ).toBeGreaterThan(0);
          await expect(page.getByTestId("appointment-workspace")).toHaveCount(
            0,
          );
          if (width === widths[0]) {
            await page
              .getByTestId("my-application-state")
              .selectOption("selected");
            await expect(
              page.locator('[data-testid^="application-row-"]'),
            ).toHaveCount(1);
            await page.getByTestId("my-application-state").selectOption("");
            await expect(
              page.locator('[data-testid^="application-row-"]'),
            ).toHaveCount(applicantRecords.length);
          }
        } else if (screen.key === "clearance") {
          await expect(
            page.locator('[data-testid^="approve-opportunity-"]'),
          ).toHaveCount(pendingPositions.length);
          await expect(
            page.locator('[data-testid^="admin-appointment-"]'),
          ).toHaveCount(appointmentRecords.length);
          await expect(statistic(page, "Publication approvals")).toHaveText(
            String(pendingPositions.length),
          );
          await expect(statistic(page, "Appointment records")).toHaveText(
            String(appointmentRecords.length),
          );
        } else if (screen.key === "ta-queue") {
          await expect(page.locator('[data-testid^="ta-row-"]')).toHaveCount(
            livePlan.entries.length,
          );
          await expect(page.locator(".queue-row.is-paused")).toHaveCount(
            livePlan.entries.filter((item: any) => item.state === "paused")
              .length,
          );
          await expect(page.locator(".queue-row.is-assigned")).toHaveCount(
            livePlan.entries.filter((item: any) => item.state === "helping")
              .length,
          );
          await expect(page.getByTestId("queue-state")).toHaveText(/open/i);
        } else if (screen.key === "course-report") {
          await expect(statistic(page, "Sessions")).toHaveText(
            String(recordedSessions.length),
          );
          await expect(statistic(page, "Helped requests")).toHaveText(
            String(helped.length),
          );
          await expect(statistic(page, "Feedback responses")).toHaveText(
            String(feedback.length),
          );
          await expect(statistic(page, "Recorded help")).toHaveText(
            `${helped.reduce((total: number, item: any) => total + item.helpMinutes, 0).toFixed(1)} min`,
          );
          await expect(statistic(page, "Average wait")).toHaveText(
            `${(waiting.reduce((total: number, value: number) => total + value, 0) / waiting.length).toFixed(1)} min`,
          );
          await expect(statistic(page, "P90 wait")).toHaveText(
            `${Number(waiting[Math.ceil(waiting.length * 0.9) - 1]).toFixed(1)} min`,
          );
          await expect(statistic(page, "Reported workload")).toHaveText(
            `${reportedHours.toFixed(1)} hours`,
          );
          await expect(statistic(page, "Approved position plans")).toHaveText(
            String(approvedBudget),
          );
          await expect(
            page.getByRole("heading", { name: "Staffing Budget", exact: true }),
          ).toBeVisible();
          await expect(page.getByTestId("review-term")).toHaveCount(0);
          await expect(page.locator("select")).toHaveCount(0);
        } else if (screen.key === "position-catalog") {
          await expect(page.locator(".position-card")).toHaveCount(
            publicPositions.length,
          );
          await expect(page.locator(".position-tags").first()).toBeVisible();
          await expect(
            page.getByRole("link", { name: "View requirements", exact: true }),
          ).toHaveCount(publicPositions.length);
        } else if (screen.key === "applicant-offer") {
          await expect(page.getByTestId("offer-panel")).toBeVisible();
          await expect(page.getByTestId("offer-accept")).toBeEnabled();
          await expect(page.getByTestId("offer-decline")).toBeEnabled();
          await expect(page.getByTestId("appointment-status")).toHaveText(
            /offered/i,
          );
          await expect(page.getByTestId("appointment-workspace")).toHaveCount(
            0,
          );
        } else if (screen.key === "faculty-inbox") {
          expect(
            await page.locator('[data-testid^="notification-"]').count(),
          ).toBeGreaterThanOrEqual(
            catalog.featured.eligibleCandidateKeys.length,
          );
          await expect(
            page.getByRole("region", { name: "Notifications", exact: true }),
          ).toBeVisible();
        }

        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        checks.push({ screen: screen.key, width });
        violations.push(
          ...audit.violations.map((item) => ({
            screen: screen.key,
            width,
            id: item.id,
            impact: item.impact,
            nodes: item.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          })),
        );
        expect(errors, `${screen.key} runtime errors at ${width}px`).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
          `${screen.key} viewport bounds at ${width}px`,
        ).toBeLessThanOrEqual(1);
        const screenshot =
          width === 1440
            ? screen.desktopScreenshot
            : width === 390
              ? screen.mobileScreenshot
              : undefined;
        if (browserName === "chromium" && screenshot) {
          const filename = `showcase-${screenshot}-${width === 1440 ? "desktop" : "mobile"}.png`;
          await page.screenshot({
            path: testInfo.outputPath(filename),
            fullPage: true,
            animations: "disabled",
          });
          screenshots.push(filename);
        }
      }
    }
    expect(checks).toHaveLength(screens.length * widths.length);
    expect(violations).toEqual([]);
    expect(await db.collection("staffingAiTasks").countDocuments()).toBe(0);
    expect(
      await db.collection("staffingAiAutomationJobs").countDocuments(),
    ).toBe(0);
    expect(
      (
        await db
          .collection("staffingOffers")
          .findOne({ id: manifest.offerIds[catalog.featured.applicationKey] })
      )?.status,
    ).toBe("issued");
    if (browserName === "chromium") expect(screenshots).toHaveLength(8);
  } finally {
    await testInfo.attach("accessibility-results.json", {
      body: JSON.stringify(
        {
          checkedScreens: checks.length,
          widths,
          branding: { logo: "/duke-cs-logo.png", header: "#012169" },
          violations,
          screens: checks,
          synthetic: true,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await Promise.allSettled(
      [...sessions.values()].map((session) => session.context.close()),
    );
  }
});
