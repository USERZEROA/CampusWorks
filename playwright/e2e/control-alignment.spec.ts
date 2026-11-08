import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, openShowcasePage } from "../showcase-fixtures";

test.setTimeout(300000);

type Screen = { key: string; actor?: string; path: string; audit?: boolean };
type Check = { screen: string; width: number; controls: number; actionGroups: number; fieldGroups: number; issues: string[] };

async function geometry(page: Page, screen: string, width: number): Promise<Check> {
  const result = await page.evaluate(() => {
    const issues: string[] = [];
    const shown = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const bounds = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    const name = (element: Element) => element.getAttribute("data-testid") || element.getAttribute("aria-label") || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 65) || element.tagName;
    const controls = [...document.querySelectorAll("main button, main a.button, .home-actions > a, header button")]
      .filter(element => shown(element) && !element.matches(".app-left, .app-center"));
    for (const control of controls) {
      const box = bounds(control);
      const compact = !!control.closest("header, td, th, .notification-row, .sessions-header");
      const minimum = compact ? 32 : 40;
      if (box.height < minimum - 0.75) issues.push(`${name(control)} has height ${box.height.toFixed(2)}; expected at least ${minimum}; bounds=${JSON.stringify(box)}`);
      if ((control as HTMLElement).scrollWidth > (control as HTMLElement).clientWidth + 2) issues.push(`${name(control)} clips its horizontal content; bounds=${JSON.stringify(box)}`);
    }
    const groups = [...document.querySelectorAll(".actions, .form-actions, .home-actions, .action-row, .enrollment-actions, .actions-wrap, .modal-footer, .queue-controls-inline")].filter(shown);
    for (const group of groups) {
      if (group.matches("td")) {
        if (getComputedStyle(group).display !== "table-cell") issues.push(`Action TD lost table-cell layout: ${JSON.stringify(bounds(group))}`);
        continue;
      }
      const children = [...group.children].filter(child => child.matches("button, a") && shown(child));
      for (let left = 0; left < children.length; left++) {
        for (let right = left + 1; right < children.length; right++) {
          const a = bounds(children[left]!);
          const b = bounds(children[right]!);
          const intersectionX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
          const intersectionY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
          if (intersectionX > 0.75 && intersectionY > 0.75) issues.push(`Controls overlap: ${name(children[left]!)} ${JSON.stringify(a)} / ${name(children[right]!)} ${JSON.stringify(b)}`);
        }
      }
      for (let index = 1; index < children.length; index++) {
        const previous = children[index - 1]!;
        const current = children[index]!;
        const a = bounds(previous), b = bounds(current);
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > Math.min(a.height, b.height) / 2;
        if (sameRow) {
          const gap = b.x - a.right;
          if (gap < 5.75) issues.push(`Insufficient horizontal action gap ${gap.toFixed(2)}: ${name(previous)} / ${name(current)}`);
          if (previous.matches("button, .button") && current.matches("button, .button") && Math.abs(a.y - b.y) > 1.25) issues.push(`Buttons in the same row have different top edges: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
        } else if (b.y >= a.bottom - 0.75 && b.y - a.bottom < 5.75) {
          issues.push(`Insufficient wrapped action gap ${(b.y - a.bottom).toFixed(2)}: ${name(previous)} / ${name(current)}`);
        }
      }
      if (innerWidth <= 520 && group.matches(".form-actions")) {
        const style = getComputedStyle(group);
        const available = group.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        for (const child of children.filter(element => element.matches("button, .button"))) {
          if (Math.abs(bounds(child).width - available) > 1.25) issues.push(`Mobile form action does not fill its group: ${name(child)}, width=${bounds(child).width}, available=${available}`);
        }
      }
    }
    const fieldGroups = [...document.querySelectorAll(".field-actions")].filter(shown);
    for (const group of fieldGroups) {
      const fields = [...group.querySelectorAll(":scope > label input:not([type=checkbox]), :scope > label select")].filter(shown);
      const buttons = [...group.children].filter(element => element.matches("button") && shown(element));
      for (const button of buttons) {
        const b = bounds(button);
        for (const input of fields) {
          const a = bounds(input);
          const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > Math.min(a.height, b.height) / 2;
          if (sameRow && Math.abs(a.bottom - b.bottom) > 1.25) issues.push(`Field/action bottom edges differ: ${name(input)} ${JSON.stringify(a)} / ${name(button)} ${JSON.stringify(b)}`);
        }
      }
    }
    for (const table of document.querySelectorAll(".course-table")) {
      const buttons = [...table.querySelectorAll("tbody .btn-go")].filter(shown);
      if (buttons.length > 1) {
        const start = bounds(buttons[0]!).x;
        for (const button of buttons.slice(1)) {
          if (Math.abs(bounds(button).x - start) > 1.25) issues.push(`Course Go columns shift: first=${start}, current=${bounds(button).x}, ${name(button)}`);
        }
      }
    }
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 1) issues.push(`Page overflows horizontally by ${overflow}px`);
    return { issues, controls: controls.length, actionGroups: groups.length, fieldGroups: fieldGroups.length };
  });
  return { screen, width, controls: result.controls, actionGroups: result.actionGroups, fieldGroups: result.fieldGroups, issues: result.issues };
}

test("four-role controls retain aligned actions, complete fields and mobile dialogs across the application", async ({ showcase, browser, browserName }, testInfo) => {
  const { manifest, catalog } = showcase;
  const course = manifest.courseIds.intro;
  const mainPosition = manifest.opportunityIds["intro-ta"];
  const draftId = manifest.applicationIds["student-three--intro-ta"];
  const screens: Screen[] = [
    { key: "login", path: "/login", audit: true },
    ...["student-main", "ta-main", "faculty-main", "admin"].map(actor => ({ key: `home-${actor}`, actor, path: "/courses" })),
    { key: "help", actor: "student-main", path: "/help" },
    { key: "course-administration", actor: "admin", path: "/admin/courses" },
    { key: "positions", actor: "student-two", path: "/opportunities" },
    { key: "position-ta", actor: "student-three", path: `/opportunities/${mainPosition}` },
    { key: "position-ra", actor: "student-two", path: `/opportunities/${manifest.opportunityIds["ra-data-quality"]}` },
    { key: "applications", actor: "student-two", path: "/applications" },
    { key: "draft", actor: "student-three", path: `/applications/${draftId}`, audit: true },
    { key: "offer", actor: "student-two", path: `/applications/${manifest.applicationIds[catalog.featured.applicationKey]}` },
    { key: "application-review", actor: "faculty-main", path: `/applications/${manifest.applicationIds["candidate-04--intro-ta"]}` },
    { key: "application-administration", actor: "admin", path: `/applications/${manifest.applicationIds["candidate-16--discrete-ta"]}` },
    { key: "active-workload", actor: "candidate-19", path: `/applications/${manifest.applicationIds["candidate-19--intro-ta"]}` },
    { key: "ra-appointment", actor: "candidate-22", path: `/applications/${manifest.applicationIds["candidate-22--ra-data-quality"]}` },
    { key: "recruitment", actor: "faculty-main", path: "/staffing" },
    { key: "new-position", actor: "faculty-main", path: "/staffing/new" },
    { key: "edit-position", actor: "faculty-data", path: `/staffing/edit?id=${manifest.opportunityIds["ai-grading-plan"]}` },
    { key: "candidate-pool", actor: "faculty-main", path: `/staffing/${mainPosition}` },
    { key: "clearance", actor: "admin", path: "/admin/staffing", audit: true },
    { key: "student-queue", actor: "student-main", path: `/courses/${course}/student` },
    { key: "ta-queue", actor: "ta-main", path: `/courses/${course}/ta`, audit: true },
    { key: "course-admin", actor: "faculty-main", path: `/courses/${course}/admin`, audit: true },
    { key: "course-review", actor: "faculty-main", path: `/courses/${course}/review` },
  ];
  const sessions = new Map<string, { context: BrowserContext; page: Page; errors: string[] }>();
  const checks: Check[] = [];
  const audits: Array<{ screen: string; width: number }> = [];
  const accessibilityViolations: unknown[] = [];
  const screenshots: string[] = [];
  const widths = [1440, 768, 390, 320];
  const forActor = async (actor?: string) => {
    const key = actor || "anonymous";
    if (sessions.has(key)) return sessions.get(key)!;
    const person = actor ? await showcase.actor(actor) : undefined;
    const context = await browser.newContext({ baseURL: showcase.baseURL, storageState: person ? await person.api.storageState() : undefined, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const session = { context, page, errors };
    sessions.set(key, session);
    return session;
  };
  const audit = async (page: Page, screen: string, width: number) => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    accessibilityViolations.push(...result.violations.map(violation => ({ screen, width, id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })));
    audits.push({ screen, width });
    expect(result.violations, `${screen} accessibility at ${width}px`).toEqual([]);
  };
  const capture = async (page: Page, name: string) => {
    if (browserName !== "chromium") return;
    const filename = `controls-${name}.png`;
    await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true, animations: "disabled" });
    screenshots.push(filename);
  };
  try {
    for (const screen of screens) {
      const { page, errors } = await forActor(screen.actor);
      errors.length = 0;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openShowcasePage(page, screen.path);
      await expect(page).toHaveURL(new URL(screen.path, showcase.baseURL).href);
      if (screen.key === "new-position") {
        await page.getByRole("button", { name: "Add required schedule slot", exact: true }).click();
        await page.getByTestId("opportunity-add-question").click();
      }
      if (screen.key === "clearance") await expect(page.locator('[data-testid^="clearance-status-"]').first()).toBeVisible();
      if (screen.key === "ta-queue") await expect(page.getByTestId("ta-select-btn").first()).toBeVisible();
      if (screen.key === "course-admin") await expect(page.locator("td.actions").first()).toBeVisible();
      if (screen.key === "candidate-pool") await expect(page.locator(".table-actions").first()).toBeVisible();
      if (screen.key === "offer") await expect(page.getByTestId("offer-accept")).toBeVisible();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(page.locator("header.app-navbar, header.app-banner")).toHaveCSS("background-color", "rgb(1, 33, 105)");
        const logo = page.locator("img.app-logo");
        await expect(logo).toBeVisible();
        await expect(logo).toHaveAttribute("src", "/duke-cs-logo.png");
        await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        checks.push(await geometry(page, screen.key, width));
        if (screen.key === "draft") {
          const ids = ["application-save", "application-submit", "application-withdraw"];
          for (const id of ids) await expect(page.getByTestId(id)).toBeVisible();
          expect(await page.evaluate(buttonIds => {
            const parents = buttonIds.map(id => document.querySelector(`[data-testid="${id}"]`)?.parentElement);
            return parents.every(parent => parent && parent === parents[0] && parent.matches(".actions.form-actions"));
          }, ids), "Draft save/submit/withdraw share one action group").toBe(true);
          if ([1440, 390].includes(width)) await capture(page, `draft-${width === 1440 ? "desktop" : "mobile"}`);
        }
        if (width === 390 && screen.audit) await audit(page, screen.key, width);
        if (width === 390 && ["clearance", "course-admin"].includes(screen.key)) await capture(page, `${screen.key}-mobile`);
        if (width === 1440 && screen.key === "ta-queue") await capture(page, "ta-queue-desktop");
        expect(errors, `${screen.key} runtime errors at ${width}px`).toEqual([]);
      }
    }

    const { page } = await forActor("student-three");
    await openShowcasePage(page, `/courses/${course}/student`);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [kind, opener, title] of [
        ["join", "enter-queue-btn", "Join Queue"],
        ["feedback", "feedback-open-btn", "Course Feedback"],
      ] as const) {
        await page.getByTestId(opener).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await expect(dialog).toBeVisible();
        const dialogCheck = await geometry(page, `${kind}-dialog`, width);
        checks.push(dialogCheck);
        const buttonBounds = await dialog.locator(".modal-footer > button").evaluateAll(buttons => buttons.map(button => {
          const box = button.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, width: box.width, height: box.height };
        }));
        if (buttonBounds.length !== 2) dialogCheck.issues.push(`Expected two modal footer controls; found ${buttonBounds.length}`);
        else {
          const [cancel, submit] = buttonBounds;
          if (Math.abs(cancel!.y - submit!.y) > 1.25) dialogCheck.issues.push(`Modal buttons do not share a horizontal row: ${JSON.stringify(buttonBounds)}`);
          if (submit!.x - cancel!.right < 7.5) dialogCheck.issues.push(`Modal horizontal gap is ${submit!.x - cancel!.right}; expected at least 7.5px`);
          if (Math.abs(cancel!.height - submit!.height) > 1.25) dialogCheck.issues.push(`Modal button heights differ: ${JSON.stringify(buttonBounds)}`);
        }
        if (width === 390) {
          await audit(page, `${kind}-dialog`, width);
          await capture(page, `${kind}-dialog-mobile`);
        }
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId(opener)).toBeFocused();
      }
    }
    expect(checks).toHaveLength(screens.length * widths.length + widths.length * 2);
    const geometryIssues = checks.flatMap(check => check.issues.map(issue => `${check.screen} at ${check.width}px: ${issue}`));
    expect(geometryIssues, `Complete control alignment inventory:\n${geometryIssues.join("\n")}`).toEqual([]);
    expect(await showcase.db.collection("staffingAiBudgets").countDocuments()).toBe(0);
    expect(await showcase.db.collection("staffingOffers").countDocuments()).toBe(catalog.applications.filter((application: any) => application.seedActions.includes("select")).length);
  } finally {
    await testInfo.attach("control-alignment-results.json", { body: JSON.stringify({ synthetic: true, widths, checks, screenshots }, null, 2), contentType: "application/json" });
    await testInfo.attach("accessibility-results.json", { body: JSON.stringify({ synthetic: true, checkedScreens: audits.length, widths, violations: accessibilityViolations, screens: audits, branding: { logo: "/duke-cs-logo.png", header: "#012169" } }, null, 2), contentType: "application/json" });
    await Promise.allSettled([...sessions.values()].map(session => session.context.close()));
  }
});
