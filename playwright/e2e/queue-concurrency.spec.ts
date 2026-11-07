import { createHash } from 'node:crypto';
import { test, expect, ok, json, database, type Actor } from '../staffing-fixtures';

async function enroll(admin: Actor, course: string, member: Actor, role = 'student') {
  await ok(admin.api.patch(`/api/courses/${course}/enrollments/role`, { data: { email: member.email, role } }));
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('joins and queue closure serialize across two application instances', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  const secondary = await space.secondary(space.admin);
  const students = await Promise.all(Array.from({ length: 8 }, (_, i) => space.actor(`join-${i}`)));
  for (const student of students) await enroll(space.admin, space.code, student);
  for (let round = 0; round < 6; round++) {
    await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
    const attempts = await Promise.all([
      ...students.map((student, index) => student.api.post(`${path}/queue/join`, { data: { location: `Room ${index}` } })),
      secondary.patch(`${path}/state`, { data: { state: 'closed' } }),
    ]);
    for (const response of attempts) expect([200, 409]).toContain(response.status());
    const final = await json(space.admin.api.get(path));
    expect(final).toMatchObject({ state: 'closed', queueLength: 0, queue: [], onDutyTAs: [] });
  }
});

test('concurrent claims, joins, duty toggles and moves retain queue invariants', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  const ta = await space.actor('parallel-ta', 'ta');
  await enroll(space.admin, space.code, ta, 'ta');
  const replica = await space.secondary(ta);
  await ok(ta.api.patch(`${path}/state`, { data: { state: 'open' } }));
  const students = await Promise.all(Array.from({ length: 10 }, (_, i) => space.actor(`parallel-${i}`)));
  for (const student of students) await enroll(space.admin, space.code, student);
  await Promise.all(students.flatMap((student, index) => Array.from({ length: 2 }, () => ok(student.api.post(`${path}/queue/join`, { data: { location: `Room ${index}` } })))));
  await Promise.all(Array.from({ length: 8 }, (_, i) => ok((i % 2 ? replica : ta.api).post(`${path}/ta-duty`, { data: { onDuty: true } }))));
  let view = await json(ta.api.get(path));
  expect(view.queue).toHaveLength(students.length);
  expect(new Set(view.queue.map((entry: any) => entry.position)).size).toBe(students.length);
  expect(view.onDutyTAs).toHaveLength(1);
  const claims = await Promise.all(view.queue.map((entry: any, i: number) => (i % 2 ? replica : ta.api).post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } })));
  for (const response of claims) expect([200, 409]).toContain(response.status());
  view = await json(ta.api.get(path));
  expect(view.queue.filter((entry: any) => entry.assignedToMe)).toHaveLength(1);
  const moves = await Promise.all(view.queue.map((entry: any, i: number) => (i % 2 ? replica : ta.api).post(`${path}/queue/move`, { data: { entryId: entry.id, direction: i % 2 ? 'up' : 'down' } })));
  for (const response of moves) expect([200, 409]).toContain(response.status());
  view = await json(ta.api.get(path));
  expect(new Set(view.queue.map((entry: any) => entry.position)).size).toBe(students.length);
  expect(new Set(view.queue.map((entry: any) => entry.id)).size).toBe(students.length);
});

test('an interrupted history insert rolls back removal and a retry archives exactly once', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  await enroll(space.admin, space.code, space.student);
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  await ok(space.admin.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  await ok(space.student.api.post(`${path}/queue/join`, { data: { location: 'Fault test' } }));
  const entry = (await json(space.admin.api.get(path))).queue[0];
  await ok(space.admin.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  const { client, db } = await database();
  try {
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['insert'], errorCode: 2 } });
    const interrupted = await space.admin.api.post(`${path}/queue/remove`, { data: { entryId: entry.id } });
    expect(interrupted.status()).toBeGreaterThanOrEqual(500);
    expect(await db.collection('queueEntries').countDocuments({ courseId: space.code })).toBe(1);
    expect(await db.collection('helpSessions').countDocuments({ courseId: space.code })).toBe(0);
    await ok(space.admin.api.post(`${path}/queue/remove`, { data: { entryId: entry.id } }));
    const replay = await json(space.admin.api.post(`${path}/queue/remove`, { data: { entryId: entry.id } }));
    expect(replay.removed).toBe(false);
    expect(await db.collection('queueEntries').countDocuments({ courseId: space.code })).toBe(0);
    expect(await db.collection('helpSessions').countDocuments({ courseId: space.code })).toBe(1);
  } finally {
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
    await client.close();
  }
});

test('help intervals exclude paused gaps and preserve both helpers after handoff', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  const ta = await space.actor('helper-two', 'ta');
  await enroll(space.admin, space.code, ta, 'ta');
  await enroll(space.admin, space.code, space.student);
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  for (const actor of [space.admin, ta]) await ok(actor.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  await ok(space.student.api.post(`${path}/queue/join`, { data: { location: 'Intervals' } }));
  const entry = (await json(space.admin.api.get(path))).queue[0];
  await ok(space.admin.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  await delay(40);
  await ok(space.student.api.post(`${path}/queue/pause`, { data: { entryId: entry.id, paused: true } }));
  await delay(120);
  await ok(space.student.api.post(`${path}/queue/pause`, { data: { entryId: entry.id, paused: false } }));
  await ok(ta.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }));
  await delay(40);
  await ok(ta.api.post(`${path}/queue/remove`, { data: { entryId: entry.id } }));
  const history = (await json(space.admin.api.get(`${path}/admin`))).helpSessions[0];
  expect(history.helpSegments).toHaveLength(2);
  expect(history.helpSegments.map((segment: any) => segment.taEmail)).toEqual([space.admin.email, ta.email]);
  const sum = history.helpSegments.reduce((total: number, segment: any) => total + segment.durationMs, 0);
  expect(history.helpMinutes * 60000).toBeCloseTo(sum, 6);
  expect(new Date(history.helpEndAt).getTime() - new Date(history.helpStartAt).getTime() - sum).toBeGreaterThanOrEqual(100);
});

test('staff authority is enforced on duty and revoked while claims race with demotion', async ({ space }) => {
  const ta = await space.actor('revoked', 'ta');
  const path = `/api/courses/${space.code}`;
  await enroll(space.admin, space.code, ta, 'ta');
  await enroll(space.admin, space.code, space.student);
  await ok(space.admin.api.patch(`${path}/state`, { data: { state: 'open' } }));
  await ok(space.student.api.post(`${path}/queue/join`, { data: { location: 'Revocation' } }));
  const entry = (await json(space.admin.api.get(path))).queue[0];
  expect((await ta.api.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } })).status()).toBe(403);
  await ok(ta.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  const replica = await space.secondary(ta);
  const [claim, demotion] = await Promise.all([
    replica.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } }),
    space.instructor.api.patch(`${path}/enrollments/role`, { data: { email: ta.email, role: 'student' } }),
  ]);
  expect([200, 403]).toContain(claim.status());
  expect(demotion.status()).toBe(200);
  const view = await json(ta.api.get(path));
  expect(view).toMatchObject({ role: 'student', isStaff: false, onDuty: false });
  expect(view.queue[0].ta).toBe('');
  expect((await replica.post(`${path}/queue/assign`, { data: { entryId: entry.id, assign: true } })).status()).toBe(403);
});

test('logout revokes a copied session on the other application instance', async ({ space }) => {
  const replica = await space.secondary(space.student);
  expect((await replica.get('/api/auth/me')).status()).toBe(200);
  await ok(space.student.api.post('/api/auth/logout'));
  expect((await replica.get('/api/auth/me')).status()).toBe(401);
});

test('mutations reject cross-origin requests and malformed flags', async ({ space }) => {
  const path = `/api/courses/${space.code}`;
  expect((await space.admin.api.patch(`${path}/state`, { headers: { origin: 'https://untrusted.example' }, data: { state: 'open' } })).status()).toBe(403);
  expect((await space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: 'false' } })).status()).toBe(400);
  expect((await space.admin.api.post(`${path}/ta-duty`, { data: { onDuty: 'yes' } })).status()).toBe(400);
  expect((await space.admin.api.get(`${path}/admin?limit=501`)).status()).toBe(400);
  expect((await json(space.admin.api.get(path))).state).toBe('closed');
});

test('API rate limits are shared across application instances', async ({ space }) => {
  const replica = await space.secondary(space.student);
  const { client, db } = await database();
  const remaining = 60000 - Date.now() % 60000;
  if (remaining < 3000) await delay(remaining + 50);
  const minute = Math.floor(Date.now() / 60000);
  const key = createHash('sha256').update(`api:user:${space.student.user.id}:${minute}`).digest('hex');
  const previous = await db.collection<any>('requestLimits').findOne({ _id: key });
  try {
    await db.collection<any>('requestLimits').updateOne({ _id: key }, { $set: { count: 10000, expiresAt: new Date(Date.now() + 120000) } }, { upsert: true });
    for (const api of [space.student.api, replica]) {
      const limited = await api.get('/api/auth/me');
      expect(limited.status()).toBe(429);
      expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    }
  } finally {
    if (previous) await db.collection<any>('requestLimits').replaceOne({ _id: key }, previous);
    else await db.collection<any>('requestLimits').deleteOne({ _id: key });
    await client.close();
  }
});

test('readiness rejects a missing allocation constraint on every application instance', async ({ space }) => {
  const replica = await space.secondary(space.admin);
  const { client, db } = await database();
  const collection = db.collection('staffingAllocations');
  const index = (await collection.listIndexes().toArray()).find(item => item.unique && item.key.termId === 1 && item.key.applicantId === 1)!;
  expect(index?.name).toBeTruthy();
  try {
    await collection.dropIndex(index.name!);
    for (const api of [space.admin.api, replica]) {
      const response = await api.get('/api/health');
      expect(response.status()).toBe(503);
      expect((await response.json()).indexes).toBe('unavailable');
    }
  } finally {
    await collection.createIndex(index.key, { name: index.name, unique: true });
    await client.close();
  }
  expect((await space.admin.api.get('/api/health')).status()).toBe(200);
});
