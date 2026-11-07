import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, ok, json, database, type Actor } from '../staffing-fixtures';

async function member(admin: Actor, code: string, actor: Actor, role = 'student') {
  await ok(admin.api.patch(`/api/courses/${code}/enrollments/role`, { data: { email: actor.email, role } }));
}
async function ready(space: any) {
  const path = `/api/courses/${space.code}`;
  await member(space.admin, space.code, space.student);
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  await ok(space.admin.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Synthetic room' } }));
  return path;
}

test('removed students remain restricted until a manager restores access without enrolling them', async ({ space }) => {
  const path = await ready(space);
  const ta = await space.actor('restriction-ta', 'ta');
  await member(space.admin, space.code, ta, 'ta');
  await ok(space.instructor.api.post(`${path}/enrollments/kick`, { data: { email: space.student.email } }));
  expect((await space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } })).status()).toBe(403);
  expect((await space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Bypass attempt' } })).status()).toBe(403);
  expect((await space.admin.api.patch(`${path}/enrollments/role`, { data: { email: space.student.email, role: 'ta' } })).status()).toBe(403);
  expect((await ta.api.post(`${path}/enrollments/restore`, { data: { email: space.student.email } })).status()).toBe(403);
  const studentView = await json(space.student.api.get(path));
  expect(studentView).toMatchObject({ enrolled: false, restricted: true });
  expect(studentView.restrictions).toBeUndefined();
  expect((await json(space.admin.api.get(`${path}/admin`))).restrictions).toEqual([expect.objectContaining({ userEmail: space.student.email })]);
  await ok(space.instructor.api.post(`${path}/enrollments/restore`, { data: { email: space.student.email } }));
  expect(await json(space.student.api.get(path))).toMatchObject({ enrolled: false, restricted: false, role: null });
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Restored' } }));
  const { client, db } = await database();
  try {
    expect(await db.collection('auditEvents').countDocuments({ courseId: space.code, target: space.student.email, action: { $in: ['CourseStudentRestricted', 'CourseStudentRestrictionLifted'] } })).toBe(2);
  } finally { await client.close(); }
});

test('completion rejects changed ownership, paused rows and an ABA handoff while explicit removal retains its own reason', async ({ space }) => {
  const path = await ready(space);
  const other = await space.actor('completion-helper', 'ta');
  await member(space.admin, space.code, other, 'ta');
  await ok(other.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  const entry = (await json(space.admin.api.get(path))).queue[0];
  await ok(space.admin.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  const original = (await json(space.admin.api.get(path))).queue[0];
  await ok(other.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  const complete = () => space.admin.api.post(`${path}/queue/remove`, { data: { action: 'complete', entryId: entry.id, expectedRevision: original.revision } });
  expect((await complete()).status()).toBe(409);
  const reassigned = (await json(space.admin.api.get(path))).queue[0];
  expect((await space.admin.api.post(`${path}/queue/remove`, { data: { action: 'complete', entryId: entry.id, expectedRevision: reassigned.revision } })).status()).toBe(409);
  await ok(space.admin.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  expect((await complete()).status()).toBe(409);
  const current = (await json(space.admin.api.get(path))).queue[0];
  await ok(space.student.api.post(`${path}/queue/pause`, { data: { entryId: entry.id, paused: true } }));
  expect((await space.admin.api.post(`${path}/queue/remove`, { data: { action: 'complete', entryId: entry.id, expectedRevision: current.revision } })).status()).toBe(409);
  const paused = (await json(space.admin.api.get(path))).queue[0];
  expect((await space.admin.api.post(`${path}/queue/remove`, { data: { action: 'complete', entryId: entry.id, expectedRevision: paused.revision } })).status()).toBe(409);
  expect((await json(space.admin.api.get(path))).queue[0].id).toBe(entry.id);
  expect((await space.admin.api.post(`${path}/queue/remove`, { data: { entryId: entry.id } })).status()).toBe(400);
  await ok(other.api.post(`${path}/queue/remove`, { data: { action: 'remove', entryId: entry.id } }));
  expect((await json(space.admin.api.get(`${path}/admin`))).helpSessions[0]).toMatchObject({ endReason: 'removed', wasHelped: true });
});

test('stale edit and leave commands cannot create or remove a replacement request', async ({ space }) => {
  const path = await ready(space);
  const old = (await json(space.student.api.get(path))).queue[0];
  await ok(space.admin.api.post(`${path}/queue/remove`, { data: { action: 'remove', entryId: old.id } }));
  expect((await space.student.api.post(`${path}/queue/join`, { data: { action: 'edit', entryId: old.id, location: 'Stale edit' } })).status()).toBe(409);
  expect((await space.student.api.post(`${path}/queue/join`, { data: { location: 'Missing intent' } })).status()).toBe(400);
  expect((await json(space.student.api.get(path))).queue).toHaveLength(0);
  await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Replacement' } }));
  const replacement = (await json(space.student.api.get(path))).queue[0];
  expect((await space.student.api.post(`${path}/queue/join`, { data: { action: 'edit', entryId: old.id, location: 'Overwrite replacement' } })).status()).toBe(409);
  expect((await json(space.student.api.get(path))).queue[0].location).toBe('Replacement');
  expect((await space.student.api.post(`${path}/queue/leave`, { data: { entryId: old.id } })).status()).toBe(409);
  expect((await space.student.api.post(`${path}/queue/leave`)).status()).toBe(400);
  expect((await json(space.student.api.get(path))).queue[0].id).toBe(replacement.id);
  await ok(space.student.api.post(`${path}/queue/leave`, { data: { entryId: replacement.id } }));
});

test('course record pages reject dataset changes and reload every row exactly once', async ({ space }) => {
  const { client, db } = await database();
  const path = `/api/courses/${space.code}/admin`;
  try {
    const rows = Array.from({ length: 501 }, (_, index) => ({ courseId: space.code, entryId: randomUUID(), studentEmail: `synthetic-${index}@example.com`, joinedAt: new Date(index), question: `Synthetic history ${index}` }));
    await db.collection('helpSessions').insertMany(rows);
    const first = await json(space.admin.api.get(path, { params: { limit: 500 } }));
    await db.collection('helpSessions').insertOne({ courseId: space.code, entryId: randomUUID(), studentEmail: 'synthetic-latest@example.com', joinedAt: new Date(), question: 'Synthetic latest history' });
    expect((await space.admin.api.get(path, { params: { offset: 500, limit: 500, snapshot: first.pagination.snapshot } })).status()).toBe(409);
    const refreshed = await json(space.admin.api.get(path, { params: { limit: 500 } }));
    const last = await json(space.admin.api.get(path, { params: { offset: 500, limit: 500, snapshot: refreshed.pagination.snapshot } }));
    const merged = [...refreshed.helpSessions, ...last.helpSessions];
    expect(merged).toHaveLength(502);
    expect(new Set(merged.map(row => row.entryId)).size).toBe(502);
    expect(merged.some(row => row.question === 'Synthetic latest history')).toBe(true);
    await member(space.admin, space.code, space.student);
    expect((await space.admin.api.get(path, { params: { offset: 500, snapshot: refreshed.pagination.snapshot } })).status()).toBe(409);
  } finally { await client.close(); }
});

test('disabled manual staff and demo administrators release duty and claims without deleting manual grants', async ({ space }) => {
  const path = await ready(space);
  const ta = await space.actor('disabled-helper', 'ta');
  await member(space.admin, space.code, ta, 'ta');
  const { client, db } = await database();
  try {
    for (const actor of [ta, space.admin]) {
      await ok(actor.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
      const entry = (await json(actor.api.get(path))).queue[0];
      await ok(actor.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
      await db.collection('users').updateOne({ id: actor.user.id }, { $set: { disabledAt: new Date() } });
      expect((await actor.api.get('/api/auth/me')).status()).toBe(401);
      const view = await json(space.instructor.api.get(path));
      expect(view.queue[0].ta).toBe('');
      expect(await db.collection('queueEntries').countDocuments({ courseId: space.code, taEmail: actor.email })).toBe(0);
      const course = await db.collection('courses').findOne({ id: space.code });
      expect((course?.onDutyTAs || []).some((row: any) => row.email === actor.email)).toBe(false);
      await db.collection('users').updateOne({ id: actor.user.id }, { $set: { disabledAt: null } });
    }
    expect(await db.collection('enrollments').findOne({ courseId: space.code, userEmail: ta.email })).toMatchObject({ role: 'ta' });
  } finally {
    await db.collection('users').updateMany({ id: { $in: [ta.user.id, space.admin.user.id] } }, { $set: { disabledAt: null } });
    await client.close();
  }
});

test('slow polling delivers queue updates without cancelling every pending response', async ({ browser, space }) => {
  const path = `/api/courses/${space.code}`;
  await member(space.admin, space.code, space.student);
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  const context = await browser.newContext({ storageState: await space.student.api.storageState() });
  try {
    const page = await context.newPage();
    await page.goto(`/courses/${space.code}/student`);
    await expect(page.getByTestId('enter-queue-btn')).toBeVisible();
    await page.route(`**${path}`, async route => {
      await new Promise(resolve => setTimeout(resolve, 3200));
      await route.continue();
    });
    await ok(space.student.api.post(`${path}/queue/join`, { data: { action: 'join', location: 'Slow polling' } }));
    await expect(page.getByTestId('queue-position')).toBeVisible({ timeout: 12000 });
  } finally { await context.close(); }
});

test('course managers can remove and restore students through visible controls while restricted students see no enrollment or queue action', async ({ browser, space }) => {
  const path = await ready(space);
  const managerContext = await browser.newContext({ storageState: await space.instructor.api.storageState() });
  const studentContext = await browser.newContext({ storageState: await space.student.api.storageState() });
  try {
    const manager = await managerContext.newPage();
    manager.on('dialog', dialog => dialog.accept());
    await manager.goto(`/courses/${space.code}/admin`);
    await manager.getByTestId(`enrollment-row-${space.student.email}`).getByRole('button', { name: 'Remove', exact: true }).click();
    const restriction = manager.getByTestId(`restriction-row-${space.student.email}`);
    await expect(restriction).toBeVisible();
    await expect(manager.getByTestId(`enrollment-row-${space.student.email}`)).toHaveCount(0);
    const student = await studentContext.newPage();
    await student.goto('/courses');
    await expect(student.getByTestId(`course-enroll-${space.code}`)).toHaveCount(0);
    await student.goto(`/courses/${space.code}/student`);
    await expect(student.getByTestId('course-enroll-btn')).toHaveCount(0);
    await expect(student.getByTestId('enter-queue-btn')).toHaveCount(0);
    await restriction.getByRole('button', { name: 'Restore access' }).click();
    await expect(restriction).toHaveCount(0);
    await expect(student.getByTestId('course-enroll-btn')).toBeVisible({ timeout: 8000 });
    expect(await json(space.student.api.get(path))).toMatchObject({ enrolled: false, restricted: false });
  } finally {
    await managerContext.close();
    await studentContext.close();
  }
});

test('a course restriction does not disable the account or survive deletion and recreation of its course', async ({ space }) => {
  const path = await ready(space);
  const otherCode = `scope-${space.suffix}`;
  await ok(space.admin.api.post('/api/courses', { data: { code: otherCode, title: 'Synthetic restriction scope' } }));
  try {
    await ok(space.instructor.api.post(`${path}/enrollments/kick`, { data: { email: space.student.email } }));
    expect((await space.student.api.get('/api/auth/me')).status()).toBe(200);
    await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: otherCode, enroll: true } }));
    await ok(space.admin.api.delete(path));
    await ok(space.admin.api.post('/api/courses', { data: { code: space.code, title: 'Synthetic recreated course' } }));
    await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
    expect(await json(space.student.api.get(path))).toMatchObject({ enrolled: true, restricted: false });
  } finally { await space.admin.api.delete(`/api/courses/${otherCode}`); }
});

test('a replaced course cannot reuse the previous course pagination snapshot', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  const before = await json(space.admin.api.get(`${path}/admin`));
  await ok(space.admin.api.delete(path));
  await ok(space.admin.api.post('/api/courses', { data: { code: space.code, title: before.course.title } }));
  await ok(space.admin.api.patch(`${path}/enrollments/role`, { data: { email: space.instructor.email, role: 'instructor' } }));
  const replaced = await json(space.admin.api.get(`${path}/admin`));
  expect(replaced.pagination.totals).toEqual(before.pagination.totals);
  expect(replaced.course).toEqual(before.course);
  expect(replaced.pagination.snapshot).not.toBe(before.pagination.snapshot);
  expect((await space.admin.api.get(`${path}/admin`, { params: { offset: 500, snapshot: before.pagination.snapshot } })).status()).toBe(409);
});

test('the manager screen retries changing pages before publishing complete analytics and preserves them after a failed refresh', async ({ browser, space }) => {
  const { client, db } = await database();
  const context = await browser.newContext({ storageState: await space.admin.api.storageState() });
  let changed = false;
  let failureStatus = 0;
  try {
    const history = (index: number) => ({ courseId: space.code, entryId: randomUUID(), studentEmail: `synthetic-screen-${index}@example.com`, joinedAt: new Date(Date.now() - index * 1000), question: `Synthetic screen history ${index}`, wasHelped: false, endReason: 'left' });
    await db.collection('helpSessions').insertMany(Array.from({ length: 501 }, (_, index) => history(index)));
    const page = await context.newPage();
    await page.goto('/courses');
    await page.route(`**/api/courses/${space.code}/admin*`, async route => {
      if (failureStatus) return route.fulfill({ status: failureStatus, json: { statusMessage: 'Synthetic refresh failure' } });
      const response = await route.fetch();
      if (!changed && Number(new URL(route.request().url()).searchParams.get('offset') || 0) === 0) {
        changed = true;
        await db.collection('helpSessions').insertOne(history(501));
      }
      await route.fulfill({ response });
    });
    await page.getByTestId(`course-go-${space.code}`).first().click();
    await expect(page.getByTestId('sessions-in-range')).toHaveText('502');
    await expect(page.getByTestId('session-row')).toHaveCount(502);
    const helpedMetric = page.locator('.summary-card').filter({ has: page.locator('.summary-label', { hasText: /^Sessions$/ }) }).locator('.summary-value');
    await expect(helpedMetric).toHaveText('0');
    await expect(page.getByTestId('admin-load-more')).toHaveCount(0);
    const pendingDownload = page.waitForEvent('download');
    await page.getByTestId('export-csv-btn').click();
    const download = await pendingDownload;
    const contents = await readFile((await download.path())!, 'utf8');
    expect(contents.split('\n')).toHaveLength(503);
    expect(new Set(contents.split('\n').slice(1)).size).toBe(502);
    failureStatus = 503;
    await page.getByTestId('add-ta-email').fill(`synthetic-refresh-${space.suffix}@example.com`);
    await page.getByTestId('add-ta-btn').click();
    await expect(page.getByText('Refresh failed. Showing previous results.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sessions-in-range')).toHaveText('502');
    await expect(page.getByTestId('session-row')).toHaveCount(502);
    failureStatus = 404;
    await page.getByTestId('add-ta-email').fill(`synthetic-deleted-${space.suffix}@example.com`);
    await page.getByTestId('add-ta-btn').click();
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByTestId('session-row')).toHaveCount(0);
  } finally {
    await context.close();
    await client.close();
  }
});
