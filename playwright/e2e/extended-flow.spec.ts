import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Role = 'student' | 'ta' | 'instructor' | 'admin';
type Member = { api: APIRequestContext; email: string; role: Role };
type TestSpace = {
  code: string;
  admin: APIRequestContext;
  adminEmail: string;
  createCourse: () => Promise<string>;
  member: (label: string, role: Role, course?: string) => Promise<Member>;
};

async function successful(pending: Promise<APIResponse>) {
  const response = await pending;
  expect(response.status(), `${response.url()}: ${await response.text()}`).toBe(200);
  return response;
}

async function courseView(api: APIRequestContext, code: string) {
  return (await successful(api.get(`/api/courses/${code}`))).json();
}

async function openPage(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `Navigation to ${path}`).toBe(200);
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
}

// Every test owns uniquely named courses. Teardown deletes only those courses,
// including when an assertion fails. These mutation tests require a local demo.
const test = base.extend<{ space: TestSpace }>({
  space: async ({ baseURL }, use) => {
    const target = baseURL || 'http://localhost:3200';
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(target).hostname)) {
      throw new Error('Extended workflow tests require a loopback demo server.');
    }
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const clients: APIRequestContext[] = [];
    const courses: string[] = [];
    const adminEmail = `admin-${suffix}@example.com`;
    const admin = await request.newContext({ baseURL: target });
    clients.push(admin);
    try {
      await successful(admin.post('/api/auth/mock', { data: { as: 'admin', email: adminEmail } }));
      const createCourse = async () => {
        const code = `ext-${suffix}-${courses.length}`;
        // Retain the identifier before creation so cleanup also covers a lost response.
        courses.push(code);
        await successful(admin.post('/api/courses', { data: { code, title: `Test course ${code}` } }));
        return code;
      };
      const code = await createCourse();
      const member = async (label: string, role: Role, course = code) => {
        const email = `${label}-${suffix}@example.com`;
        const api = await request.newContext({ baseURL: target });
        clients.push(api);
        await successful(api.post('/api/auth/mock', { data: { as: role, email } }));
        await successful(admin.patch(`/api/courses/${course}/enrollments/role`, { data: { email, role } }));
        return { api, email, role };
      };
      await use({ code, admin, adminEmail, createCourse, member });
    } finally {
      try {
        for (const code of courses.reverse()) {
          const response = await admin.delete(`/api/courses/${code}`);
          expect([200, 404], `Cleanup of test course ${code}`).toContain(response.status());
        }
      } finally {
        for (const client of clients) await client.dispose();
      }
    }
  },
});

test('queue edits, ordering, pause, handoff and removal preserve lifecycle invariants', async ({ space }) => {
  const { code, admin } = space;
  const first = await space.member('first', 'student');
  const second = await space.member('second', 'student');
  const newcomer = await space.member('newcomer', 'student');
  const ta = await space.member('first-ta', 'ta');
  const nextTa = await space.member('next-ta', 'ta');
  const endpoint = `/api/courses/${code}`;

  await successful(ta.api.patch(`${endpoint}/state`, { data: { state: 'open' } }));
  for (const staff of [ta, nextTa]) {
    await successful(staff.api.post(`${endpoint}/ta-duty`, { data: { onDuty: true } }));
  }
  await successful(first.api.post(`${endpoint}/queue/join`, { data: { location: 'Room A', question: 'First question' } }));
  await successful(second.api.post(`${endpoint}/queue/join`, { data: { location: 'Room B' } }));
  const before = await courseView(ta.api, code);
  const firstEntry = before.queue.find((entry: any) => entry.email === first.email);
  const secondEntry = before.queue.find((entry: any) => entry.email === second.email);
  expect(before.queue.map((entry: any) => entry.id)).toEqual([firstEntry.id, secondEntry.id]);

  await successful(ta.api.patch(`${endpoint}/state`, { data: { state: 'paused' } }));
  expect((await newcomer.api.post(`${endpoint}/queue/join`, { data: { location: 'Room C' } })).status()).toBe(409);
  await successful(first.api.post(`${endpoint}/queue/join`, {
    data: { location: '  Room A revised  ', question: '  Updated question  ' },
  }));
  const edited = (await courseView(ta.api, code)).queue.find((entry: any) => entry.id === firstEntry.id);
  expect(edited).toMatchObject({
    location: 'Room A revised', question: 'Updated question',
    joinedAt: firstEntry.joinedAt, position: firstEntry.position,
  });
  expect((await courseView(ta.api, code)).queue).toHaveLength(2);

  await successful(ta.api.post(`${endpoint}/queue/assign`, { data: { entryId: firstEntry.id, assign: true } }));
  await successful(first.api.post(`${endpoint}/queue/pause`, { data: { entryId: firstEntry.id, paused: true } }));
  const paused = (await courseView(ta.api, code)).queue.find((entry: any) => entry.id === firstEntry.id);
  expect(paused).toMatchObject({ paused: true, ta: '', assignedToMe: false, otherTa: false });
  expect((await ta.api.post(`${endpoint}/queue/assign`, { data: { entryId: firstEntry.id, assign: true } })).status()).toBe(409);
  await successful(first.api.post(`${endpoint}/queue/pause`, { data: { entryId: firstEntry.id, paused: false } }));

  await successful(ta.api.post(`${endpoint}/queue/move`, { data: { entryId: secondEntry.id, direction: 'up' } }));
  expect((await courseView(ta.api, code)).queue.map((entry: any) => entry.id)).toEqual([secondEntry.id, firstEntry.id]);
  // Moving the first row up is a successful no-op.
  await successful(ta.api.post(`${endpoint}/queue/move`, { data: { entryId: secondEntry.id, direction: 'up' } }));
  expect((await courseView(ta.api, code)).queue.map((entry: any) => entry.id)).toEqual([secondEntry.id, firstEntry.id]);

  await successful(ta.api.patch(`${endpoint}/state`, { data: { state: 'open' } }));
  await successful(ta.api.post(`${endpoint}/queue/assign`, { data: { entryId: firstEntry.id, assign: true } }));
  await successful(ta.api.post(`${endpoint}/queue/assign`, { data: { entryId: firstEntry.id, assign: 'other' } }));
  const handedOff = (await courseView(first.api, code)).queue.find((entry: any) => entry.isMine);
  expect(handedOff).toMatchObject({ id: firstEntry.id, otherTa: true, ta: '', paused: false });
  await successful(nextTa.api.post(`${endpoint}/queue/assign`, { data: { entryId: firstEntry.id, assign: true } }));
  const claimed = (await courseView(nextTa.api, code)).queue.find((entry: any) => entry.id === firstEntry.id);
  expect(claimed).toMatchObject({ assignedToMe: true, otherTa: false });

  // Repeated staff requests cannot archive the same entry twice.
  const completions = await Promise.all([
    nextTa.api.post(`${endpoint}/queue/remove`, { data: { entryId: firstEntry.id } }),
    nextTa.api.post(`${endpoint}/queue/remove`, { data: { entryId: firstEntry.id } }),
  ]);
  for (const response of completions) expect(response.status()).toBe(200);
  expect((await Promise.all(completions.map((response) => response.json()))).filter((body) => body.removed)).toHaveLength(1);
  await successful(admin.post(`${endpoint}/enrollments/kick`, { data: { email: second.email } }));
  const history = await (await successful(admin.get(`${endpoint}/admin`))).json();
  expect(history.helpSessions).toHaveLength(2);
  expect(history.helpSessions.find((session: any) => session.studentEmail === first.email)).toMatchObject({
    taEmail: nextTa.email, endReason: 'completed', wasHelped: true,
  });
  expect(history.helpSessions.find((session: any) => session.studentEmail === second.email)).toMatchObject({
    endReason: 'kicked', wasHelped: false,
  });
  expect((await courseView(second.api, code))).toMatchObject({ enrolled: false, queue: [], queueLength: 0 });
});

test('course identifiers and current roles bound announcements and staff authority', async ({ space }) => {
  const { code, admin } = space;
  const otherCode = await space.createCourse();
  const ta = await space.member('staff', 'ta');
  const instructor = await space.member('teacher', 'instructor');
  const student = await space.member('learner', 'student');
  const otherStudent = await space.member('other-learner', 'student', otherCode);
  const firstPath = `/api/courses/${code}`;
  const otherPath = `/api/courses/${otherCode}`;
  for (const path of [firstPath, otherPath]) {
    await successful(admin.patch(`${path}/state`, { data: { state: 'open' } }));
  }
  await successful(ta.api.post(`${firstPath}/ta-duty`, { data: { onDuty: true } }));
  await successful(student.api.post(`${firstPath}/queue/join`, { data: { location: 'A' } }));
  await successful(otherStudent.api.post(`${otherPath}/queue/join`, { data: { location: 'B' } }));
  const otherEntry = (await courseView(admin, otherCode)).queue[0];
  expect((await ta.api.post(`${otherPath}/announcements`, { data: { message: 'Unauthorized' } })).status()).toBe(403);
  expect((await instructor.api.get(`${otherPath}/admin`)).status()).toBe(403);
  expect((await ta.api.post(`${firstPath}/queue/assign`, { data: { entryId: otherEntry.id, assign: true } })).status()).toBe(404);
  const wrongRemoval = await (await successful(ta.api.post(`${firstPath}/queue/remove`, { data: { entryId: otherEntry.id } }))).json();
  expect(wrongRemoval.removed).toBe(false);
  expect((await courseView(admin, otherCode)).queue).toHaveLength(1);

  await successful(ta.api.post(`${firstPath}/announcements`, { data: { message: 'Office hours are in Room 201.' } }));
  const announcement = (await courseView(student.api, code)).announcements[0];
  expect(announcement.message).toBe('Office hours are in Room 201.');
  expect((await admin.delete(`${otherPath}/announcements/${announcement.id}`)).status()).toBe(404);
  expect((await student.api.delete(`${firstPath}/announcements/${announcement.id}`)).status()).toBe(403);
  await successful(instructor.api.delete(`${firstPath}/announcements/${announcement.id}`));
  expect((await courseView(student.api, code)).announcements).toEqual([]);

  await successful(ta.api.post(`${firstPath}/ta-duty`, { data: { onDuty: true } }));
  await successful(instructor.api.patch(`${firstPath}/enrollments/role`, { data: { email: ta.email, role: 'student' } }));
  // Keep the same signed-in session: current enrollment, rather than its login
  // role, must determine authority after a manager changes the membership.
  const demoted = await courseView(ta.api, code);
  expect(demoted).toMatchObject({ role: 'student', isStaff: false, isManager: false, onDuty: false });
  expect(demoted.queue[0].email).toBe('');
  expect((await ta.api.patch(`${firstPath}/state`, { data: { state: 'closed' } })).status()).toBe(403);
  expect((await ta.api.post(`${firstPath}/announcements`, { data: { message: 'No longer staff' } })).status()).toBe(403);
  expect((await ta.api.post(`${firstPath}/ta-duty`, { data: { onDuty: true } })).status()).toBe(403);
  expect((await ta.api.get(`${firstPath}/admin`)).status()).toBe(403);
  expect((await instructor.api.patch(`${firstPath}/enrollments/role`, { data: { email: student.email, role: 'admin' } })).status()).toBe(403);
  const preserved = await courseView(admin, code);
  expect(preserved.state).toBe('open');
  expect(preserved.onDutyTAs).toEqual([]);
});

test('all four roles retain usable Duke blue screens at a 390px viewport', async ({ browser, baseURL, space }, testInfo) => {
  const student = await space.member('mobile-student', 'student');
  const ta = await space.member('mobile-ta', 'ta');
  const instructor = await space.member('mobile-instructor', 'instructor');
  await successful(space.admin.patch(`/api/courses/${space.code}/state`, { data: { state: 'open' } }));
  await successful(student.api.post(`/api/courses/${space.code}/queue/join`, {
    data: { location: 'Room 202', question: 'A deliberately long question about recursion and stack frames during office hours.' },
  }));
  const identities = [
    { ...student, path: `/courses/${space.code}/student` },
    { ...ta, path: `/courses/${space.code}/ta` },
    { ...instructor, path: `/courses/${space.code}/admin` },
    { role: 'admin' as Role, email: space.adminEmail, path: '/admin/courses' },
  ];
  const contexts: BrowserContext[] = [];
  try {
    for (const identity of identities) {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      contexts.push(context);
      const page = await context.newPage();
      await successful(context.request.post('/api/auth/mock', { data: { as: identity.role, email: identity.email } }));
      await openPage(page, identity.path);
      await expect(page).toHaveURL(new RegExp(`${identity.path}$`));
      await expect(page.locator('.app-navbar')).toHaveCSS('background-color', 'rgb(1, 33, 105)');
      expect(await page.locator('.app-logo').evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(page.getByTestId('logout-btn').or(page.getByRole('button', { name: 'Logout', exact: true }))).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${identity.role} document overflow`).toBeLessThanOrEqual(dimensions.width + 1);
      if (identity.role === 'student') {
        await expect(page.getByTestId('queue-row-mine')).toContainText('Room 202');
        await page.getByTestId('edit-entry-btn').click();
        const modal = await page.locator('.modal').boundingBox();
        expect(modal).not.toBeNull();
        expect(modal!.x).toBeGreaterThanOrEqual(0);
        expect(modal!.x + modal!.width).toBeLessThanOrEqual(391);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else if (identity.role === 'ta') {
        await expect(page.getByTestId('ta-select-btn')).toBeDisabled();
        await page.getByTestId('on-duty-btn').click();
        await expect(page.getByTestId('ta-select-btn')).toBeEnabled();
      } else if (identity.role === 'instructor') {
        await expect(page.getByTestId('export-csv-btn')).toBeVisible();
        await expect(page.getByTestId(`enrollment-row-${student.email}`).locator('option[value="admin"]')).toBeDisabled();
      } else {
        await expect(page.getByTestId(`admin-course-row-${space.code}`)).toBeVisible();
      }
      await page.screenshot({ path: testInfo.outputPath(`mobile-${identity.role}.png`), fullPage: true });
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

// Parse emitted CSV including quoted commas, quotes and line breaks, so the
// download is verified as a spreadsheet artifact instead of a text substring.
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (!quoted && char === '\r') { /* Accept CRLF separators. */ }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('downloaded history CSV preserves multiline answers and neutralizes formulas', async ({ page, space }) => {
  const student = await space.member('csv-student', 'student');
  const path = `/api/courses/${space.code}`;
  const question = '@SUM("first",\n"second")';
  await successful(space.admin.patch(`${path}/state`, { data: { state: 'open' } }));
  await successful(student.api.post(`${path}/queue/join`, { data: { location: '=1+1', question } }));
  await successful(student.api.post(`${path}/queue/leave`));
  await successful(page.request.post('/api/auth/mock', { data: { as: 'admin', email: space.adminEmail } }));
  await openPage(page, `/courses/${space.code}/admin`);
  const pending = page.waitForEvent('download');
  await page.getByTestId('export-csv-btn').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`${space.code}-sessions.csv`);
  const file = await download.path();
  expect(file).not.toBeNull();
  const rows = csvRows(await readFile(file!, 'utf8'));
  expect(rows).toHaveLength(2);
  expect(rows[1]).toHaveLength(rows[0]!.length);
  const values = Object.fromEntries(rows[0]!.map((key, index) => [key, rows[1]![index]]));
  expect(values).toMatchObject({
    courseId: space.code, studentEmail: student.email,
    location: "'=1+1", question: `'${question}`, wasHelped: 'no', endReason: 'left',
  });
});

test('synthetic analytics render an empty range, nearest-rank P90 and a full single-TA ring', async ({ page, space }, testInfo) => {
  const baseline = await (await successful(space.admin.get(`/api/courses/${space.code}/admin`))).json();
  // Only this page's polling response is supplied with labeled synthetic data.
  // No fabricated analytics or historic timestamps are written to the database.
  const synthetic = { ...baseline, helpSessions: [] as any[] };
  await page.route(`**/api/courses/${space.code}/admin*`, (route) => route.fulfill({ json: synthetic }));
  await successful(page.request.post('/api/auth/mock', { data: { as: 'admin', email: space.adminEmail } }));
  await openPage(page, `/courses/${space.code}/admin`);
  const metric = (label: string) => page.locator('.summary-card').filter({ hasText: label }).locator('.summary-value');
  await expect(metric('P90 Wait (min)')).toHaveText('0.0');
  await expect(page.getByTestId('sessions-in-range')).toHaveText('0');
  const now = Date.now() - 60_000;
  synthetic.helpSessions = [1, 9].map((wait, index) => {
    const helpStart = now - 3 * 60_000;
    return {
      courseId: space.code,
      studentEmail: `synthetic-student-${index}@example.com`,
      studentName: `Synthetic student ${index + 1}`,
      taEmail: 'synthetic-ta@example.com', taName: 'Synthetic TA',
      joinedAt: new Date(helpStart - wait * 60_000).toISOString(),
      helpStartAt: new Date(helpStart).toISOString(),
      helpEndAt: new Date(now).toISOString(),
      helpMinutes: 3, waitMinutes: wait,
      helpSegments: [{ taEmail: 'synthetic-ta@example.com', taName: 'Synthetic TA', startAt: new Date(helpStart).toISOString(), endAt: new Date(now).toISOString(), durationMs: 180000 }],
      leftQueueAt: new Date(now).toISOString(),
      wasHelped: true, endReason: 'completed',
    };
  });
  await expect(page.getByTestId('session-row')).toHaveCount(2, { timeout: 15_000 });
  await expect.soft(metric('P90 Wait (min)')).toHaveText('9.0');
  await expect(metric('Avg Wait (min)')).toHaveText('5.0');
  await expect(metric('Active TAs')).toHaveText('1');
  await page.locator('.metric-select').selectOption('share');
  const ring = page.locator('.pie [stroke]');
  await expect(ring).toHaveCount(1);
  const bounds = await ring.evaluate((element) => {
    const box = (element as SVGGraphicsElement).getBBox();
    return { width: box.width, height: box.height };
  });
  expect(bounds.width).toBeGreaterThan(150);
  expect(bounds.height).toBeGreaterThan(150);
  await expect(page.locator('.legend')).toContainText('Synthetic TA (100.0%)');
  await page.screenshot({ path: testInfo.outputPath('synthetic-single-ta-analytics.png'), fullPage: true });
});

test('desktop navigation and all four workspaces retain their visual contracts', async ({ browser, baseURL, space }, testInfo) => {
  const student = await space.member('desktop-student', 'student');
  const ta = await space.member('desktop-ta', 'ta');
  const instructor = await space.member('desktop-instructor', 'instructor');
  await successful(space.admin.patch(`/api/courses/${space.code}/state`, { data: { state: 'open' } }));
  await successful(student.api.post(`/api/courses/${space.code}/queue/join`, { data: { location: 'Room 301', question: 'Desktop queue check' } }));
  const identities = [
    { ...student, path: `/courses/${space.code}/student` },
    { ...ta, path: `/courses/${space.code}/ta` },
    { ...instructor, path: `/courses/${space.code}/admin` },
    { role: 'admin' as Role, email: space.adminEmail, path: '/admin/courses' },
  ];
  const contexts: BrowserContext[] = [];
  try {
    for (const identity of identities) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
      contexts.push(context);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (identity.role === 'student') {
        await openPage(page, '/login');
        await expect(page.getByRole('heading', { name: 'Sign in to CampusWorks' })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('desktop-login.png'), fullPage: true });
      }
      await successful(context.request.post('/api/auth/mock', { data: { as: identity.role, email: identity.email } }));
      await openPage(page, identity.path);
      await expect(page).toHaveURL(new RegExp(`${identity.path}$`));
      await expect(page).toHaveTitle(/CampusWorks/);
      await expect(page.locator('.app-navbar')).toHaveCSS('background-color', 'rgb(1, 33, 105)');
      await expect(page.getByTestId('logout-btn').or(page.getByRole('button', { name: 'Logout', exact: true }))).toBeVisible();
      expect(await page.locator('.app-logo').evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`desktop-${identity.role}.png`), fullPage: true });
      if (identity.role === 'student') {
        await page.getByRole('button', { name: 'Help & Info', exact: true }).click();
        await expect(page).toHaveURL(/\/help$/);
        await expect(page.getByRole('heading', { name: 'How to use CampusWorks' })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('desktop-help.png'), fullPage: true });
        await openPage(page, '/courses');
        await expect(page.getByTestId(`my-course-${space.code}`)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('desktop-directory.png'), fullPage: true });
      }
      expect(errors, `${identity.role} browser errors`).toEqual([]);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});
