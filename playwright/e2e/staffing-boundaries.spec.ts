import { randomUUID } from 'node:crypto';
import { test, expect, ok, json, database, activateCycle } from '../staffing-fixtures';

test('course creation rejects reserved identifiers before storing an unreachable course', async ({ space }) => {
  for (const code of ['null', 'undefined', 'NULL']) {
    expect((await space.admin.api.post('/api/courses', { data: { code, title: 'Reserved identifier' } })).status()).toBe(400);
  }
  const { client, db } = await database();
  try { expect(await db.collection('courses').countDocuments({ id: { $in: ['null', 'undefined'] } })).toBe(0); } finally { await client.close(); }
});

test('term policy prevents an instructor from bypassing department publication approval', async ({ space }) => {
  const term = (await json(space.admin.api.post('/api/staffing/terms', { data: {
    name: `Approval policy ${space.suffix}`, startDate: new Date(Date.now() - 86400000).toISOString(), endDate: new Date(Date.now() + 60 * 86400000).toISOString(),
  } }))).term;
  await activateCycle(space.admin, term);
  const posting = await space.opportunity({ approvalRequired: false });
  expect(posting.status).toBe('pending_approval');
  expect(posting.approved).toBe(false);
  expect((await space.student.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(409);
  expect((await space.instructor.api.post(`/api/staffing/opportunities/${posting.id}/approve`, { data: { approved: true } })).status()).toBe(403);
  const approved = await json(space.admin.api.post(`/api/staffing/opportunities/${posting.id}/approve`, { data: { approved: true, expectedVersion: posting.version } }));
  expect(approved.opportunity.status).toBe('published');
  expect((await space.student.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(200);
});

test('parallel edits reject stale versions and post-offer administrative data stays separate', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const second = await space.secondary(space.student);
  const revision = { expectedVersion: application.version, profile: application.profile, answers: application.answers, qualificationText: application.qualificationText };
  const edits = await Promise.all([
    space.student.api.patch(`/api/staffing/applications/${application.id}`, { data: { ...revision, qualificationText: 'First revision' } }),
    second.patch(`/api/staffing/applications/${application.id}`, { data: { ...revision, qualificationText: 'Second revision' } }),
  ]);
  expect(edits.map(response => response.status()).sort()).toEqual([200, 409]);
  const current = (await json(space.student.api.get(`/api/staffing/applications/${application.id}`))).application;
  expect((await space.student.api.patch(`/api/staffing/applications/${application.id}`, { data: { ...revision, expectedVersion: current.version, administrative: { hasSsn: true } } })).status()).toBe(400);
  expect((await space.student.api.post(`/api/staffing/applications/${application.id}/administrative`, { data: { expectedAdministrativeVersion: 0, administrative: { hasSsn: true } } })).status()).toBe(409);
});

test('ordinary review lists do not disclose restricted clearance reasons', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const chosen = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${chosen.offer.id}/accept`, { data: {} }));
  const reason = 'RESTRICTED-ADMINISTRATIVE-REASON';
  await ok(space.admin.api.post(`/api/staffing/appointments/${chosen.appointment.id}/clearance`, { data: { status: 'needs_information', reason } }));
  const teacher = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
  const teacherApplication = await json(space.instructor.api.get(`/api/staffing/applications/${application.id}`));
  expect(JSON.stringify(teacher)).not.toContain(reason);
  expect(JSON.stringify(teacherApplication)).not.toContain(reason);
  const owner = await json(space.student.api.get(`/api/staffing/applications/${application.id}`));
  expect(JSON.stringify(owner)).toContain(reason);
});

test('clearance rejection keeps its reason private and reports the final clearance state consistently', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const chosen = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${chosen.offer.id}/accept`, { data: {} }));
  const reason = 'RESTRICTED-SYNTHETIC-CLEARANCE-REJECTION';
  const rejected = await json(space.admin.api.post(`/api/staffing/appointments/${chosen.appointment.id}/clearance`, { data: { status: 'not_cleared', reason } }));
  expect(rejected.appointment).toMatchObject({ status: 'not_cleared', clearance: 'not_cleared', clearanceReason: reason, clearedBy: space.admin.email, endReason: 'Administrative clearance was not granted' });
  for (const path of [`/api/staffing/opportunities/${posting.id}`, `/api/staffing/applications/${application.id}`, '/api/staffing/overview']) {
    expect(JSON.stringify(await json(space.instructor.api.get(path)))).not.toContain(reason);
  }
  const owner = await json(space.student.api.get(`/api/staffing/applications/${application.id}`));
  expect(JSON.stringify(owner)).toContain(reason);
  const { client, db } = await database();
  try {
    // Older records with a private rejection in endReason receive the same redaction.
    await db.collection('staffingAppointments').updateOne({ id: chosen.appointment.id }, { $set: { endReason: reason } });
    const legacy = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
    expect(JSON.stringify(legacy)).not.toContain(reason);
    expect(legacy.appointments[0].endReason).toBe('Administrative clearance was not granted');
  } finally { await client.close(); }
});

test('workload commands are idempotent, bounds checked and reflected in complete term aggregates', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const payload = { appointmentId: selected.appointment.id, date: new Date().toISOString().slice(0, 10), kind: 'office_hours', hours: 2, notes: 'Synthetic local observation', idempotencyKey: randomUUID() };
  const first = await json(space.student.api.post('/api/staffing/workload', { data: payload }));
  const replay = await json(space.student.api.post('/api/staffing/workload', { data: payload }));
  expect(replay.record.id).toBe(first.record.id);
  expect((await space.student.api.post('/api/staffing/workload', { data: { ...payload, hours: 3 } })).status()).toBe(409);
  expect((await space.student.api.post('/api/staffing/workload', { data: { ...payload, idempotencyKey: randomUUID(), hours: 25 } })).status()).toBe(400);
  const review = await json(space.instructor.api.get(`/api/staffing/reviews/${space.code}?termId=${space.term.id}`));
  expect(review.workload.totalHours).toBe(2);
  expect(review.missingEvidence.length).toBeGreaterThan(0);
  expect((await space.student.api.get(`/api/staffing/reviews/${space.code}`)).status()).toBe(403);
  const task = await json(space.instructor.api.post('/api/ai/tasks', { data: { kind: 'term_review', targetId: space.code, termId: space.term.id } }));
  expect(task.task.status).toBe('unconfigured');
});

test('lifecycle outbox delivers an offer notification once and only the recipient can mark it read', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  const overview = await json(space.student.api.get('/api/staffing/overview'));
  const notification = overview.notifications.find((item: any) => item.path === `/applications/${application.id}`);
  expect(notification).toBeTruthy();
  await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
  const repeated = await json(space.student.api.get('/api/staffing/overview'));
  expect(repeated.notifications.filter((item: any) => item.eventId === notification.eventId)).toHaveLength(1);
  const stranger = await space.actor('notification-outsider');
  expect((await stranger.api.post(`/api/staffing/notifications/${notification.id}/read`, { data: {} })).status()).toBeGreaterThanOrEqual(403);
  await ok(space.student.api.post(`/api/staffing/notifications/${notification.id}/read`, { data: {} }));
  const { client, db } = await database();
  try { expect((await db.collection('staffingNotifications').findOne({ id: notification.id }))?.read).toBe(true); } finally { await client.close(); }
  await ok(space.instructor.api.post(`/api/staffing/offers/${selected.offer.id}/rescind`, { data: { reason: 'Synthetic position change' } }));
  const rescinded = await json(space.student.api.get('/api/staffing/overview'));
  expect(rescinded.notifications.some((item: any) => item.path === `/applications/${application.id}` && /rescinded/i.test(item.title))).toBe(true);
});

test('course deletion preserves the settlement path until an activated appointment is financially closed', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const ended = await json(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Work completed' } }));
  expect(ended.appointment.budgetStatus).toBe('awaiting_settlement');
  const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
  await ok(space.instructor.api.post(`/api/staffing/opportunities/${posting.id}/archive`, { data: { expectedVersion: detail.opportunity.version } }));
  expect((await space.admin.api.delete(`/api/courses/${space.code}`)).status()).toBe(409);
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/settle`, { data: { incurredCost: 100 } }));
  expect((await space.admin.api.delete(`/api/courses/${space.code}`)).status()).toBe(200);
});

test('a TA cannot manufacture a helped session by claiming their own queue entry', async ({ space }) => {
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: space.student.email, role: 'ta' } }));
  await ok(space.student.api.patch(`/api/courses/${space.code}/state`, { data: { state: 'open' } }));
  await ok(space.student.api.post(`/api/courses/${space.code}/ta-duty`, { data: { onDuty: true } }));
  await ok(space.student.api.post(`/api/courses/${space.code}/queue/join`, { data: { location: 'Own question' } }));
  const own = (await json(space.student.api.get(`/api/courses/${space.code}`))).queue.find((item: any) => item.isMine);
  expect((await space.student.api.post(`/api/courses/${space.code}/queue/assign`, { data: { entryId: own.id, assign: true } })).status()).toBe(400);
});
