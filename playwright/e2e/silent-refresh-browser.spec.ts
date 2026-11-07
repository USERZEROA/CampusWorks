import type { Browser, Page, Route } from '@playwright/test';
import { test, expect, ok, json, activateCycle, type Actor } from '../staffing-fixtures';

async function actorPage(browser: Browser, actor: Actor) {
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  return { context, page: await context.newPage() };
}
async function open(page: Page, path: string) {
  expect((await page.goto(path))?.status()).toBe(200);
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await expect(page.locator('main')).toBeVisible();
}
async function synchronized(page: Page, path: string) {
  const response = page.waitForResponse(result =>
    new URL(result.url()).pathname === path && result.request().method() === 'GET' && result.status() === 200,
  );
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}
async function noManualRefresh(page: Page) {
  await expect(page.getByRole('button', { name: /\b(refresh|reload|retry)\b|\b(generate|analy[sz]e|run analysis)\b/i })).toHaveCount(0);
}

test('offer and clearance changes arrive automatically while the applicant still chooses whether to accept', async ({ browser, space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const { context, page } = await actorPage(browser, space.student);
  try {
    await open(page, `/applications/${application.id}`);
    await noManualRefresh(page);
    await expect(page.getByTestId('offer-panel')).toHaveCount(0);
    const selected = await space.select(application);
    await synchronized(page, `/api/staffing/applications/${application.id}`);
    await expect(page.getByTestId('offer-panel')).toBeVisible();
    await expect(page.getByTestId('offer-accept')).toBeVisible();
    expect((await json(space.student.api.get(`/api/staffing/applications/${application.id}`))).appointment.status).toBe('offered');
    await page.getByTestId('offer-accept').click();
    await expect(page.getByTestId('appointment-status')).toHaveText(/pending clearance/i);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
    await synchronized(page, `/api/staffing/applications/${application.id}`);
    await expect(page.getByTestId('appointment-status')).toHaveText(/^active$/i);
    await expect(page.getByTestId('appointment-workspace')).toBeVisible();
    await expect(page.getByTestId('administrative-save')).toHaveCount(0);
    await noManualRefresh(page);
    await page.getByTestId('appointment-workspace').click();
    await expect(page).toHaveURL(new RegExp(`/courses/${space.code}/ta$`));
    await noManualRefresh(page);
  } finally { await context.close(); }
});

test('qualification edits survive workflow updates and remote content conflicts require an explicit discard', async ({ browser, space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const path = `/api/staffing/applications/${application.id}`;
  const { context, page } = await actorPage(browser, space.student);
  try {
    await open(page, `/applications/${application.id}`);
    await page.getByTestId('app-first-name').fill('Unsaved local applicant');
    await ok(space.instructor.api.post(`${path}/shortlist`, { data: { shortlisted: true, expectedVersion: application.version } }));
    await synchronized(page, path);
    await expect(page.getByTestId('application-status')).toHaveText(/shortlisted/i);
    await expect(page.getByTestId('app-first-name')).toHaveValue('Unsaved local applicant');
    await expect(page.getByTestId('application-conflict')).toHaveCount(0);
    await page.getByTestId('application-save').click();
    await expect(page.getByTestId('application-notice')).toContainText('Application saved.');
    expect((await json(space.student.api.get(path))).application.profile.firstName).toBe('Unsaved local applicant');
    await page.getByTestId('application-submit').click();
    await expect(page.getByTestId('application-notice')).toContainText('Application submitted.');
    await page.getByTestId('app-first-name').fill('Keep this local change');
    const current = (await json(space.student.api.get(path))).application;
    await ok(space.student.api.patch(path, { data: {
      expectedVersion: current.version, profile: { ...current.profile, firstName: 'Saved on another device' },
      answers: current.answers, qualificationText: current.qualificationText,
    } }));
    await synchronized(page, path);
    await expect(page.getByTestId('application-conflict')).toBeVisible();
    await expect(page.getByTestId('app-first-name')).toHaveValue('Keep this local change');
    await expect(page.getByTestId('application-save')).toBeDisabled();
    await page.getByTestId('application-discard').click();
    await expect(page.getByTestId('app-first-name')).toHaveValue('Saved on another device');
    await expect(page.getByTestId('application-conflict')).toHaveCount(0);
    await page.getByTestId('app-first-name').fill('Saved after reviewing the conflict');
    await page.getByTestId('application-save').click();
    await expect(page.getByTestId('application-notice')).toContainText('Application saved.');
    expect((await json(space.student.api.get(path))).application.profile.firstName).toBe('Saved after reviewing the conflict');
  } finally { await context.close(); }
});

test('private administrative edits remain local across polling and preserve remote corrections until discarded', async ({ browser, space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  const path = `/api/staffing/applications/${application.id}`;
  await ok(space.student.api.post(`${path}/administrative`, { data: { expectedAdministrativeVersion: 0, administrative: { dukeUniqueId: 'SYNTHETIC-SAVED' } } }));
  const { context, page } = await actorPage(browser, space.student);
  try {
    await open(page, `/applications/${application.id}`);
    await page.getByTestId('admin-duke-id').fill('SYNTHETIC-LOCAL-UNSAVED');
    await synchronized(page, path);
    await expect(page.getByTestId('admin-duke-id')).toHaveValue('SYNTHETIC-LOCAL-UNSAVED');
    await expect(page.getByTestId('administrative-conflict')).toHaveCount(0);
    await ok(space.admin.api.post(`${path}/administrative`, { data: { expectedAdministrativeVersion: 1, administrative: { dukeUniqueId: 'SYNTHETIC-REMOTE-SAVED' } } }));
    await synchronized(page, path);
    await expect(page.getByTestId('administrative-conflict')).toBeVisible();
    await expect(page.getByTestId('admin-duke-id')).toHaveValue('SYNTHETIC-LOCAL-UNSAVED');
    await expect(page.getByTestId('administrative-save')).toBeDisabled();
    await page.getByTestId('administrative-discard').click();
    await expect(page.getByTestId('admin-duke-id')).toHaveValue('SYNTHETIC-REMOTE-SAVED');
    await page.getByTestId('admin-duke-id').fill('SYNTHETIC-REVIEWED-LOCAL');
    await page.getByTestId('administrative-save').click();
    await expect(page.getByTestId('application-notice')).toContainText('Appointment details saved.');
    expect((await json(space.student.api.get(path))).application.administrative.dukeUniqueId).toBe('SYNTHETIC-REVIEWED-LOCAL');
    await noManualRefresh(page);
  } finally { await context.close(); }
});

test('recruitment schedules and opportunity drafts retain unsaved inputs when another reviewer changes their source', async ({ browser, space }) => {
  const posting = await space.opportunity();
  const { applicationDeadline: _deadline, ...draftInput } = posting;
  const draft = (await json(space.instructor.api.post('/api/staffing/opportunities', { data: { ...draftInput, title: 'Synthetic editable draft' } }))).opportunity;
  const admin = await actorPage(browser, space.admin);
  const faculty = await actorPage(browser, space.instructor);
  try {
    await open(admin.page, '/admin/staffing');
    await noManualRefresh(admin.page);
    await admin.page.getByTestId('cycle-enabled').uncheck();
    await synchronized(admin.page, '/api/staffing/overview');
    await expect(admin.page.getByTestId('cycle-enabled')).not.toBeChecked();
    await activateCycle(space.admin, space.term, { closesAt: new Date(Date.now() + 7200000).toISOString() });
    await synchronized(admin.page, '/api/staffing/overview');
    await expect(admin.page.getByTestId('cycle-conflict')).toBeVisible();
    await expect(admin.page.getByTestId('cycle-enabled')).not.toBeChecked();
    await expect(admin.page.getByTestId('cycle-save')).toBeDisabled();
    await admin.page.getByTestId('cycle-reset').click();
    await expect(admin.page.getByTestId('cycle-enabled')).toBeChecked();
    await expect(admin.page.getByTestId('cycle-conflict')).toHaveCount(0);
    await open(faculty.page, `/staffing/edit?id=${draft.id}`);
    await noManualRefresh(faculty.page);
    await faculty.page.getByTestId('opportunity-title').fill('Unsaved local opportunity title');
    await synchronized(faculty.page, `/api/staffing/opportunities/${draft.id}`);
    await expect(faculty.page.getByTestId('opportunity-title')).toHaveValue('Unsaved local opportunity title');
    await ok(space.instructor.api.patch(`/api/staffing/opportunities/${draft.id}`, { data: { expectedVersion: draft.version, title: 'Opportunity saved by another reviewer' } }));
    await synchronized(faculty.page, `/api/staffing/opportunities/${draft.id}`);
    await expect(faculty.page.getByTestId('opportunity-conflict')).toBeVisible();
    await expect(faculty.page.getByTestId('opportunity-title')).toHaveValue('Unsaved local opportunity title');
    await expect(faculty.page.getByTestId('opportunity-save')).toBeDisabled();
    await faculty.page.getByTestId('opportunity-discard').click();
    await expect(faculty.page.getByTestId('opportunity-title')).toHaveValue('Opportunity saved by another reviewer');
    await faculty.page.getByTestId('opportunity-title').fill('Opportunity saved after review');
    await faculty.page.getByTestId('opportunity-save').click();
    await expect(faculty.page).toHaveURL(new RegExp(`/staffing/${draft.id}$`));
    await expect(faculty.page.getByRole('heading', { name: 'Opportunity saved after review', exact: true })).toBeVisible();
  } finally {
    await admin.context.close();
    await faculty.context.close();
    const response = await space.admin.api.get(`/api/staffing/opportunities/${draft.id}`);
    if (response.ok()) {
      const current = (await response.json()).opportunity;
      await space.admin.api.post(`/api/staffing/opportunities/${draft.id}/archive`, { data: { expectedVersion: current.version } });
    }
  }
});

test('queue data survives temporary failures, resumes on online and focus events, and never overlaps slow polls', async ({ browser, space }) => {
  const path = `/api/courses/${space.code}`;
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  const { context, page } = await actorPage(browser, space.student);
  let failing = true;
  let slow = false;
  let active = 0;
  let maximum = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const routePattern = `**${path}`;
  const interceptCourse = async (route: Route) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      if (failing) return await route.fulfill({ status: 503, json: { statusMessage: 'Synthetic unavailable course' } });
      if (slow) await new Promise(resolve => setTimeout(resolve, 3200));
      if (!page.isClosed()) await route.fulfill({ response: await route.fetch() });
    } catch (error) {
      if (!page.isClosed()) throw error;
    } finally { active--; }
  };
  try {
    await open(page, `/courses/${space.code}/student`);
    await expect(page.getByTestId('enter-queue-btn')).toBeVisible();
    await page.route(routePattern, interceptCourse);
    const failed = page.waitForResponse(result => new URL(result.url()).pathname === path && result.status() === 503);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await failed;
    await expect(page.getByTestId('enter-queue-btn')).toBeVisible();
    await noManualRefresh(page);
    // Remove interception so route.fetch cannot bypass the browser's offline state.
    await page.unroute(routePattern, interceptCourse);
    await page.getByTestId('enter-queue-btn').click();
    await page.getByTestId('join-location').fill('Unsaved offline room');
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    // This actor owns an independent API context, so its server-side write stays online.
    await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Recovered synthetic room' } }));
    await expect(page.getByTestId('queue-position')).toHaveCount(0);
    await expect(page.getByTestId('join-location')).toHaveValue('Unsaved offline room');
    await context.setOffline(false);
    await expect(page.getByTestId('queue-position')).toBeVisible();
    await expect(page.getByTestId('queue-row-mine')).toContainText('Recovered synthetic room');
    await expect(page.getByTestId('join-location')).toHaveValue('Unsaved offline room');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('join-location')).toHaveCount(0);
    failing = false;
    await expect.poll(() => active).toBe(0);
    await page.route(routePattern, interceptCourse);
    await page.getByTestId('edit-entry-btn').click();
    await page.getByTestId('join-location').fill('Unsaved local room');
    const entry = (await json(space.student.api.get(path))).queue.find((row: any) => row.isMine);
    await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'edit', entryId: entry.id, location: 'Saved remote room', question: 'Synthetic remote question' } }));
    slow = true;
    const started = page.waitForRequest(request => new URL(request.url()).pathname === path && request.method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await started;
    await page.evaluate(() => {
      for (let index = 0; index < 10; index++) {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect(page.getByTestId('queue-row-mine')).toContainText('Synthetic remote question');
    await expect(page.getByTestId('join-location')).toHaveValue('Unsaved local room');
    expect(maximum).toBe(1);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('revoked course reviewers lose private candidate data without refreshing the page', async ({ browser, space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const { context, page } = await actorPage(browser, space.instructor);
  try {
    await open(page, `/staffing/${posting.id}`);
    await expect(page.getByTestId(`candidate-row-${application.id}`)).toContainText(space.student.email);
    await noManualRefresh(page);
    await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: space.instructor.email, role: 'student' } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByTestId(`candidate-row-${application.id}`)).toHaveCount(0);
    await expect(page.getByText(space.student.email, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(application.id) })).toHaveCount(0);
  } finally { await context.close(); }
});
