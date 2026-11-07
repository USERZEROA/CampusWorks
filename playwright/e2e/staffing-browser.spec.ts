import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { test, expect, ok, json, type Actor } from '../staffing-fixtures';
import type { BrowserContext, Page } from '@playwright/test';

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `Navigation to ${path}`).toBe(200);
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await expect(page).toHaveTitle(/CampusWorks/);
  await expect(page.locator('main')).toBeVisible();
}
async function signIn(context: BrowserContext, actor: Actor) {
  await ok(context.request.post('/api/auth/mock', { data: { as: actor.role, email: actor.email } }));
}
const localDate = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
};

test('the Duke Computer Science PNG is served intact with the expected image type', async ({ request }) => {
  const response = await request.get('/duke-cs-logo.png');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^image\/png/);
  expect(await response.body()).toEqual(readFileSync('public/duke-cs-logo.png'));
});

test('browser users publish, apply, upload, select, accept, clear, operate and end an appointment', async ({ browser, baseURL, space }, testInfo) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([space.instructor, space.student, space.admin].map(async actor => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    await signIn(context, actor);
    return context;
  }));
  const [facultyContext, studentContext, adminContext] = contexts;
  const faculty = await facultyContext!.newPage();
  const student = await studentContext!.newPage();
  const admin = await adminContext!.newPage();
  const browserErrors: string[] = [];
  for (const page of [faculty, student, admin]) page.on('pageerror', error => browserErrors.push(error.message));
  try {
    await open(faculty, '/staffing/new');
    await faculty.getByTestId('opportunity-title').fill(`Browser TA ${space.suffix}`);
    await faculty.getByTestId('opportunity-term').selectOption(space.term.id);
    await faculty.getByTestId('opportunity-course').selectOption(space.code);
    await faculty.getByTestId('opportunity-description').fill('Support students, grade assignments, and hold two weekly office hours.');
    await faculty.getByTestId('opportunity-start').fill(localDate(Date.now() - 3600000));
    await faculty.getByTestId('opportunity-end').fill(localDate(Date.now() + 14 * 86400000));
    await faculty.getByTestId('opportunity-deadline').fill(localDate(Date.now() + 7 * 86400000));
    await faculty.getByTestId('opportunity-required-skills').fill('Algorithms and clear written explanations');
    await faculty.getByLabel('Attendance required', { exact: true }).check();
    await faculty.getByLabel('Lab responsibilities', { exact: true }).check();
    await faculty.getByLabel('Discussion sections', { exact: true }).check();
    await faculty.getByLabel('Assignment or exam grading', { exact: true }).check();
    await faculty.getByTestId('opportunity-add-question').click();
    await faculty.getByLabel('Question 1', { exact: true }).fill('Describe your relevant course experience.');
    await faculty.getByTestId('opportunity-save').click();
    await expect(faculty).toHaveURL(/\/staffing\/[a-f0-9-]+$/);
    const postingId = new URL(faculty.url()).pathname.split('/').at(-1)!;
    await faculty.getByTestId('opportunity-publish').click();
    await expect(faculty.getByTestId('opportunity-status')).toContainText(/pending approval|published/i);
    await open(admin, '/admin/staffing');
    const approval = admin.getByTestId(`approve-opportunity-${postingId}`);
    if (await approval.count()) {
      await approval.click();
      await expect(admin.getByTestId('admin-staffing-notice')).toContainText('approved');
    }
    await open(student, `/opportunities/${postingId}`);
    await expect(student.getByRole('heading', { name: `Browser TA ${space.suffix}`, exact: true })).toBeVisible();
    await student.getByTestId('start-application').click();
    await expect(student).toHaveURL(/\/applications\/[a-f0-9-]+$/);
    const applicationId = new URL(student.url()).pathname.split('/').at(-1)!;
    await student.getByTestId('app-first-name').fill('Browser');
    await student.getByTestId('app-last-name').fill('Applicant');
    await student.getByTestId('app-majors').fill('Computer Science');
    await student.getByTestId('app-available-hours').fill('15');
    await student.getByLabel('Expected graduation term', { exact: true }).fill(space.term.name);
    await student.getByTestId('app-availability').fill('Weekday afternoons and two weekly office hours.');
    await student.getByTestId('app-skills').fill('Algorithms and peer tutoring');
    const question = student.locator('[data-testid^="app-answer-"]');
    await expect(question).toHaveCount(1);
    await question.fill('Completed algorithms and tutored other students.');
    await student.getByTestId('application-save').click();
    await expect(student.getByTestId('application-notice')).toContainText('saved');
    await student.getByTestId('application-cv').setInputFiles({ name: 'browser-cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic browser CV\nRelevant algorithms coursework and tutoring.') });
    await student.getByTestId('application-cv-upload').click();
    await expect(student.getByTestId('application-notice')).toContainText('uploaded');
    await student.getByTestId('application-submit').click();
    await expect(student.getByTestId('application-status')).toHaveText(/submitted/i);
    await faculty.reload();
    await expect(faculty.getByTestId(`candidate-row-${applicationId}`)).toContainText('Browser');
    await faculty.getByTestId(`shortlist-candidate-${applicationId}`).click();
    await expect(faculty.getByTestId(`candidate-row-${applicationId}`)).toContainText(/shortlisted/i);
    await faculty.getByTestId(`select-candidate-${applicationId}`).click();
    await expect(faculty.getByTestId('staffing-notice')).toContainText('selected');
    await student.getByTestId('application-refresh').click();
    await expect(student.getByTestId('offer-accept')).toBeVisible();
    await student.getByTestId('offer-accept').click();
    await expect(student.getByTestId('appointment-status')).toContainText(/pending clearance/i);
    await expect(student.getByTestId('appointment-workspace')).toHaveCount(0);
    const detail = await json(space.admin.api.get(`/api/staffing/applications/${applicationId}`));
    const appointmentId = detail.appointment.id;
    await admin.reload();
    await admin.getByTestId(`clearance-${appointmentId}`).click();
    await expect(admin.getByTestId('admin-staffing-notice')).toContainText('Clearance recorded');
    await student.getByTestId('application-refresh').click();
    await expect(student.getByTestId('appointment-status')).toHaveText(/active/i);
    await student.screenshot({ path: testInfo.outputPath('active-ta-application.png'), fullPage: true });
    await student.getByTestId('appointment-workspace').click();
    await expect(student).toHaveURL(new RegExp(`/courses/${space.code}/ta$`));
    await student.getByTestId('open-queue-btn').click();
    await student.getByTestId('on-duty-btn').click();
    await expect(student.getByTestId('on-duty-btn')).toContainText(/end duty/i);
    await student.screenshot({ path: testInfo.outputPath('appointed-ta-queue.png'), fullPage: true });
    await faculty.reload();
    await faculty.getByTestId('appointment-reason').fill('Synthetic browser appointment completed');
    await faculty.getByTestId(`appointment-end-${appointmentId}`).click();
    await expect(faculty.getByTestId(`appointment-row-${appointmentId}`)).toContainText(/ended/i);
    await expect(student).toHaveURL(new RegExp(`/courses/${space.code}/student$`), { timeout: 15000 });
    expect(browserErrors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

test('keyboard dialogs trap focus, close with Escape and restore the initiating control', async ({ page, space }) => {
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  await ok(space.admin.api.patch(`/api/courses/${space.code}/state`, { data: { state: 'open' } }));
  await ok(page.request.post('/api/auth/mock', { data: { as: 'student', email: space.student.email } }));
  await open(page, `/courses/${space.code}/student`);
  const enter = page.getByTestId('enter-queue-btn');
  await enter.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  for (let count = 0; count < 14; count++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(enter).toBeFocused();
  await page.getByTestId('feedback-open-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feedback-open-btn')).toBeFocused();
  await ok(space.admin.api.patch(`/api/courses/${space.code}/state`, { data: { state: 'paused' } }));
  await expect(page.locator('.state-pill')).toHaveText(/paused/i);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('research assistants use their project workspace and workload form without course staff access', async ({ browser, baseURL, space }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(context, space.instructor);
    await open(page, '/projects');
    const title = `Browser research ${space.suffix}`;
    await page.getByTestId('project-title').fill(title);
    await page.getByTestId('project-description').fill('Synthetic research workspace for an authorized assistant.');
    await page.getByTestId('project-create').click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
    const posting = await space.opportunity({ type: 'ra', projectId, courseId: '', title: 'Browser RA appointment' });
    const application = await space.application(posting);
    const selected = await space.select(application);
    await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
    await signIn(context, space.student);
    await open(page, `/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.getByLabel('Entry type', { exact: true }).selectOption('note');
    await page.getByTestId('project-update').fill('Completed the synthetic research dataset check.');
    await page.getByTestId('project-update-post').click();
    await expect(page.getByText('Completed the synthetic research dataset check.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`Research note.*${space.student.email}`) })).toBeVisible();
    await page.getByLabel('Work category', { exact: true }).selectOption('research');
    await page.getByTestId('workload-hours').fill('2');
    await page.getByTestId('workload-save').click();
    await expect(page.getByRole('status').filter({ hasText: 'Workload observation recorded' })).toBeVisible();
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('active-ra-project.png'), fullPage: true });
    await ok(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Research completed' } }));
    await expect(page.getByTestId('project-update-post')).toHaveCount(0, { timeout: 15000 });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('course review pages keep complete aggregates while independently loading terms and scenarios', async ({ page, space }) => {
  const overview = await json(space.instructor.api.get('/api/staffing/overview'));
  const baseline = await json(space.instructor.api.get(`/api/staffing/reviews/${space.code}`));
  const additionalTerm = { ...space.term, id: 'synthetic-review-term', name: 'Synthetic additional review term' };
  const requests: Array<{ page: number; termId: string }> = [];
  // Labeled browser-only pagination responses; no synthetic historical or
  // financial observations are written into the database.
  await page.route('**/api/staffing/overview*', route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    return route.fulfill({ json: { ...overview, terms: [pageNumber === 1 ? space.term : additionalTerm], pagination: { page: pageNumber, limit: 1, totals: { terms: 2 }, hasMore: pageNumber === 1 } } });
  });
  await page.route(`**/api/staffing/reviews/${space.code}*`, route => {
    const query = new URL(route.request().url()).searchParams;
    const pageNumber = Number(query.get('page') || 1);
    requests.push({ page: pageNumber, termId: query.get('termId') || '' });
    return route.fulfill({ json: {
      ...baseline, termId: query.get('termId') || null,
      workload: { ...baseline.workload, totalHours: 20, count: 2, records: [{ id: `synthetic-workload-${pageNumber}`, hours: 10 }] },
      budget: { approvedBudget: 2000, committedBudget: 400, opportunities: [{ id: `synthetic-position-${pageNumber}`, title: `Synthetic position ${pageNumber}`, budget: 1000, committedBudget: 200 }], scenarios: [{ opportunityId: `synthetic-position-${pageNumber}`, name: pageNumber === 1 ? 'Synthetic first scenario' : 'Synthetic second scenario', positions: 1, estimatedCost: 1000, coverageValidated: false }] },
      pagination: { page: pageNumber, limit: 1, totals: { workload: 2, opportunities: 2 }, hasMore: pageNumber === 1 },
    } });
  });
  await signIn(page.context(), space.instructor);
  await open(page, `/courses/${space.code}/admin`);
  await page.getByRole('link', { name: 'Open staffing and term review', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${space.code}/review$`));
  await expect(page.getByRole('heading', { name: 'Synthetic first scenario', exact: true })).toBeVisible();
  const workload = page.locator('dt:has-text("Reported workload (hours)") + dd');
  await expect(workload).toHaveText('20.0');
  const termsPanel = page.locator('section.panel').filter({ has: page.getByTestId('review-term') });
  await termsPanel.getByTestId('staffing-load-more').click();
  await expect(page.getByTestId('review-term').locator(`option[value="${additionalTerm.id}"]`)).toHaveCount(1);
  await expect(termsPanel.getByTestId('staffing-load-more')).toHaveCount(0);
  await page.getByTestId('staffing-load-more').click();
  await expect(page.getByRole('heading', { name: 'Synthetic second scenario', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic first scenario', exact: true })).toBeVisible();
  await expect(workload).toHaveText('20.0');
  await expect(page.getByText('Committed budget: 400', { exact: true })).toBeVisible();
  await page.getByTestId('review-term').selectOption(space.term.id);
  await expect.poll(() => requests.at(-1)?.termId).toBe(space.term.id);
  expect(requests.at(-1)?.page).toBe(1);
  await expect(page.getByRole('heading', { name: 'Synthetic second scenario', exact: true })).toHaveCount(0);
  await expect(workload).toHaveText('20.0');
});

test('desktop and mobile staffing and queue screens pass automated accessibility checks', async ({ browser, baseURL, space }, testInfo) => {
  test.setTimeout(180000);
  const posting = await space.opportunity();
  const draft = (await json(space.student.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application;
  const project = (await json(space.instructor.api.post('/api/staffing/projects', { data: { title: `Accessible research ${space.suffix}`, description: 'Synthetic research accessibility check', department: 'Computer Science' } }))).project;
  const raPosting = await space.opportunity({ type: 'ra', projectId: project.id, courseId: '', title: 'Accessible research appointment' });
  const raApplication = await space.application(raPosting);
  const selected = await space.select(raApplication);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const ta = await space.actor('accessibility-ta', 'ta');
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: ta.email, role: 'ta' } }));
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  await ok(space.admin.api.patch(`/api/courses/${space.code}/state`, { data: { state: 'open' } }));
  const screens: Array<{ actor: Actor | null; path: string; label: string }> = [
    { actor: null, path: '/login', label: 'login' },
    { actor: space.student, path: '/courses', label: 'courses' },
    { actor: space.student, path: '/opportunities', label: 'opportunities' },
    { actor: space.student, path: `/opportunities/${posting.id}`, label: 'opportunity' },
    { actor: space.student, path: `/applications/${draft.id}`, label: 'application' },
    { actor: space.student, path: '/applications', label: 'my-applications' },
    { actor: space.student, path: `/courses/${space.code}/student`, label: 'student' },
    { actor: ta, path: `/courses/${space.code}/ta`, label: 'ta' },
    { actor: space.instructor, path: `/courses/${space.code}/admin`, label: 'course-admin' },
    { actor: space.instructor, path: `/staffing/${posting.id}`, label: 'reviewer' },
    { actor: space.instructor, path: '/staffing', label: 'staffing' },
    { actor: space.instructor, path: '/staffing/new', label: 'publisher' },
    { actor: space.admin, path: '/admin/staffing', label: 'staffing-admin' },
    { actor: space.admin, path: '/admin/courses', label: 'site-admin' },
    { actor: space.student, path: '/projects', label: 'projects' },
    { actor: space.student, path: `/projects/${project.id}`, label: 'research-workspace' },
    { actor: space.instructor, path: `/courses/${space.code}/review`, label: 'course-review' },
    { actor: space.admin, path: `/applications/${raApplication.id}`, label: 'clearance-review' },
  ];
  const violations: any[] = [];
  const widths = [1440, 768, 390, 320];
  for (const width of widths) {
    for (const screen of screens) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } });
      try {
        const page = await context.newPage();
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        if (screen.actor) await signIn(context, screen.actor);
        await open(page, screen.path);
        expect(new URL(page.url()).pathname, `${screen.label} authorized destination`).toBe(screen.path);
        await expect(page.locator('header.app-navbar, header.app-banner'), `${screen.label} Duke blue`).toHaveCSS('background-color', 'rgb(1, 33, 105)');
        const logo = page.locator('img.app-logo');
        await expect(logo).toBeVisible();
        await expect(logo).toHaveAttribute('src', '/duke-cs-logo.png');
        await expect(logo).toHaveAttribute('alt', /Duke.*Computer Science/i);
        await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth), { message: `${screen.label} loaded PNG` }).toBeGreaterThan(0);
        const logoBounds = await logo.boundingBox();
        expect(logoBounds).toBeTruthy();
        expect(logoBounds!.width).toBeGreaterThan(40);
        expect(logoBounds!.x).toBeGreaterThanOrEqual(0);
        expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(width);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(browserErrors, `${screen.label} browser errors`).toEqual([]);
        violations.push(...audit.violations.map(item => ({ screen: screen.label, width, id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${screen.label} at ${width}px`).toBeLessThanOrEqual(1);
        if (width === 390 && ['application', 'reviewer', 'staffing-admin'].includes(screen.label)) await page.screenshot({ path: testInfo.outputPath(`mobile-${screen.label}.png`), fullPage: true });
      } finally { await context.close(); }
    }
  }
  await testInfo.attach('accessibility-results.json', { body: JSON.stringify({ checkedScreens: screens.length * widths.length, widths, branding: { logo: '/duke-cs-logo.png', header: '#012169' }, violations }, null, 2), contentType: 'application/json' });
  expect(violations).toEqual([]);
});
