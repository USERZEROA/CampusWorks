import { randomUUID } from 'node:crypto';
import { test, expect, ok, json, database } from '../staffing-fixtures';
import { createCourse } from '../helpers';

test('accepted and cleared TA appointments open only the correct existing queue and revoke promptly', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  const path = `/api/courses/${space.code}`;
  expect((await json(space.student.api.get(path))).isStaff).toBe(false);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  expect((await json(space.student.api.get(path))).isStaff).toBe(false);
  expect((await space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } })).status()).toBe(403);
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const activated = await json(space.student.api.get(path));
  expect(activated).toMatchObject({ role: 'ta', enrolled: true, isStaff: true, isManager: false });
  expect((await json(space.student.api.get('/api/auth/me'))).user.primaryRole).toBe('student');
  const catalog = await json(space.student.api.get('/api/courses'));
  expect(catalog.courses.find((course: any) => course.id === space.code).primaryRole).toBe('ta');
  await ok(space.student.api.patch(`${path}/state`, { data: { state: 'open' } }));
  await ok(space.student.api.post(`${path}/ta-duty`, { data: { onDuty: true } }));
  expect((await space.student.api.get(`${path}/admin`)).status()).toBe(403);
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Synthetic appointment completed' } }));
  const ended = await json(space.student.api.get(path));
  expect(ended.isStaff).toBe(false);
  expect(ended.onDuty).toBe(false);
  expect((await space.student.api.patch(`${path}/state`, { data: { state: 'closed' } })).status()).toBe(403);
});

test('competing instructors cannot reserve the same candidate across course offerings', async ({ space }) => {
  const other = `${space.code}-b`;
  await createCourse(space.admin.api, other, [{ email: space.instructor.email, role: 'instructor' }]);
  try {
    const first = await space.opportunity();
    const second = await space.opportunity({ courseId: other });
    const a = await space.application(first);
    const b = await space.application(second);
    const replica = await space.secondary(space.instructor);
    const requests = await Promise.all([
      space.instructor.api.post(`/api/staffing/applications/${a.id}/select`, { data: { idempotencyKey: randomUUID(), expectedVersion: a.version } }),
      replica.post(`/api/staffing/applications/${b.id}/select`, { data: { idempotencyKey: randomUUID(), expectedVersion: b.version } }),
    ]);
    expect(requests.map(response => response.status()).sort()).toEqual([200, 409]);
    const firstView = await json(space.instructor.api.get(`/api/staffing/opportunities/${first.id}`));
    const secondView = await json(space.instructor.api.get(`/api/staffing/opportunities/${second.id}`));
    expect(firstView.applications[0].availability.unavailable).toBe(true);
    expect(secondView.applications[0].availability.unavailable).toBe(true);
    expect(firstView.offers.length + secondView.offers.length).toBe(1);
    const unavailable = firstView.applications[0];
    expect(JSON.stringify(unavailable.availability)).not.toContain('faculty');
  } finally { await space.admin.api.delete(`/api/courses/${other}`); }
});

test('the last approved vacancy cannot be oversubscribed by concurrent selections', async ({ space }) => {
  const posting = await space.opportunity({ positions: 1 });
  const second = await space.actor('second-candidate');
  const a = await space.application(posting);
  const b = await space.application(posting, second);
  const replica = await space.secondary(space.instructor);
  const responses = await Promise.all([
    space.instructor.api.post(`/api/staffing/applications/${a.id}/select`, { data: { idempotencyKey: randomUUID(), expectedVersion: a.version } }),
    replica.post(`/api/staffing/applications/${b.id}/select`, { data: { idempotencyKey: randomUUID(), expectedVersion: b.version } }),
  ]);
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
  const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
  expect(detail.opportunity.committedPositions).toBe(1);
  expect(detail.opportunity.committedPositions).toBeLessThanOrEqual(detail.opportunity.positions);
  expect(detail.opportunity).not.toHaveProperty('committedBudget');
  expect(detail.offers[0]).not.toHaveProperty('committedCost');
  expect(detail.appointments[0]).not.toHaveProperty('committedCost');
  expect(detail.offers).toHaveLength(1);
});

test('selection replay is idempotent and a declined offer frees the candidate and vacancy', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const key = randomUUID();
  const selected = await space.select(application, space.instructor, key);
  const replay = await space.select(application, space.instructor, key);
  expect(replay).toMatchObject({ replayed: true, offer: { id: selected.offer.id }, appointment: { id: selected.appointment.id } });
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/decline`, { data: {} }));
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/decline`, { data: {} }));
  const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
  expect(detail.opportunity.committedPositions).toBe(0);
  expect(detail.opportunity).not.toHaveProperty('committedBudget');
  expect(detail.applications[0].availability.unavailable).toBe(false);
  const updated = (await json(space.student.api.get(`/api/staffing/applications/${application.id}`))).application;
  const next = await space.select(updated);
  expect(next.offer.id).not.toBe(selected.offer.id);
});

test('withdrawal and selection resolve to a coherent ordered state', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const [withdrawal, selection] = await Promise.all([
    space.student.api.post(`/api/staffing/applications/${application.id}/withdraw`, { data: {} }),
    space.instructor.api.post(`/api/staffing/applications/${application.id}/select`, { data: { idempotencyKey: randomUUID(), expectedVersion: application.version } }),
  ]);
  expect(withdrawal.status()).toBe(200);
  expect([200, 409]).toContain(selection.status());
  const { client, db } = await database();
  try {
    expect((await db.collection('staffingApplications').findOne({ id: application.id }))?.status).toBe('withdrawn');
    expect(await db.collection('staffingOffers').countDocuments({ applicationId: application.id, status: 'issued' })).toBe(0);
    expect((await db.collection('staffingOpportunities').findOne({ id: posting.id }))?.committedPositions).toBe(0);
  } finally { await client.close(); }
});

test('private drafts, current CVs and administrative fields cannot be read by unauthorized users', async ({ space }) => {
  const posting = await space.opportunity();
  const outsider = await space.actor('outsider');
  let draft = (await json(space.student.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application;
  expect((await space.instructor.api.get(`/api/staffing/applications/${draft.id}`)).status()).toBe(403);
  expect((await outsider.api.get(`/api/staffing/applications/${draft.id}`)).status()).toBe(403);
  const submitted = await space.application(posting, space.student);
  const selected = await space.select(submitted);
  await ok(space.student.api.post(`/api/staffing/applications/${submitted.id}/administrative`, { data: { expectedAdministrativeVersion: 0, administrative: { dukeUniqueId: 'restricted-id', hasSsn: true, citizenship: 'restricted-category' } } }));
  const reviewer = await json(space.instructor.api.get(`/api/staffing/applications/${submitted.id}`));
  expect(reviewer.application.administrative).toBeUndefined();
  expect(JSON.stringify(reviewer)).not.toContain('restricted-id');
  const document = submitted.cvDocumentId;
  expect((await outsider.api.get(`/api/staffing/documents/${document}`)).status()).toBe(403);
  const download = await ok(space.instructor.api.get(`/api/staffing/documents/${document}`));
  expect(download.headers()['content-disposition']).toContain('attachment');
  expect(download.headers()['x-content-type-options']).toBe('nosniff');
  expect((await download.body()).toString()).toContain('Synthetic CV');
  expect((await outsider.api.post(`/api/staffing/applications/${submitted.id}/select`, { data: { idempotencyKey: randomUUID() } })).status()).toBe(403);
});

test('invalid CVs, stale versions, malformed question IDs and absent required answers fail explicitly', async ({ space }) => {
  const posting = await space.opportunity();
  const draft = (await json(space.student.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application;
  expect((await space.student.api.post(`/api/staffing/applications/${draft.id}/submit`, { data: { expectedVersion: draft.version } })).status()).toBe(400);
  expect((await space.student.api.post(`/api/staffing/applications/${draft.id}/cv`, { multipart: { expectedVersion: String(draft.version), file: { name: 'script.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n/JavaScript (untrusted)') } } })).status()).toBe(400);
  expect((await space.student.api.post(`/api/staffing/applications/${draft.id}/cv`, { multipart: { expectedVersion: String(draft.version), file: { name: 'binary.exe', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1]) } } })).status()).toBe(400);
  expect((await space.student.api.patch(`/api/staffing/applications/${draft.id}`, { data: { expectedVersion: -1, profile: {} } })).status()).toBe(409);
  const original = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
  expect((await space.instructor.api.post('/api/staffing/opportunities', { data: {
    ...original.opportunity, questions: [{ id: '__proto__', prompt: 'Unsafe identifier', required: true }],
  } })).status()).toBe(400);
  expect((await space.instructor.api.patch(`/api/staffing/opportunities/${posting.id}`, { data: { ...original.opportunity, title: 'Changed published requirements' } })).status()).toBe(409);
});

test('offer expiry releases capacity and stale cleanup cannot revoke an accepted appointment', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  const { client, db } = await database();
  try {
    const past = new Date(Date.now() - 1000);
    await db.collection('staffingOffers').updateOne({ id: selected.offer.id }, { $set: { expiresAt: past } });
    await db.collection('staffingAllocations').updateOne({ offerId: selected.offer.id }, { $set: { expiresAt: past } });
    await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { offerExpiresAt: past } });
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} })).status()).toBe(409);
    expect((await db.collection('staffingOpportunities').findOne({ id: posting.id }))?.committedPositions).toBe(0);
    const refreshed = (await json(space.student.api.get(`/api/staffing/applications/${application.id}`))).application;
    const replacement = await space.select(refreshed);
    await ok(space.student.api.post(`/api/staffing/offers/${replacement.offer.id}/accept`, { data: {} }));
    await db.collection('staffingOffers').updateOne({ id: replacement.offer.id }, { $set: { expiresAt: past } });
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await db.collection('staffingAppointments').findOne({ id: replacement.appointment.id }))?.status).toBe('pending_clearance');
    expect((await db.collection('staffingAllocations').findOne({ offerId: replacement.offer.id }))?.status).toBe('accepted_pending_clearance');
  } finally { await client.close(); }
});

test('future, suspended and ended appointment dates cannot grant queue authority', async ({ space }) => {
  const posting = await space.opportunity({ appointmentStart: new Date(Date.now() + 86400000).toISOString() });
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
  const { client, db } = await database();
  try {
    await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { startDate: new Date(Date.now() - 1000) } });
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(true);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/suspend`, { data: { reason: 'Synthetic suspension' } }));
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/resume`, { data: {} }));
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(true);
    await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { endDate: new Date(Date.now() - 1000) } });
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
  } finally { await client.close(); }
});

test('ending a TA appointment preserves independently granted instructor authority', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: space.student.email, role: 'instructor' } }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Independent grant test' } }));
  expect((await json(space.student.api.get(`/api/courses/${space.code}`)))).toMatchObject({ role: 'instructor', isStaff: true, isManager: true });
});

test('RA appointments retain application history without creating course privileges or a project workspace', async ({ space }) => {
  const posting = await space.opportunity({ type: 'ra', courseId: '', title: 'Research assistant' });
  const application = await space.application(posting);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const detail = await json(space.student.api.get(`/api/staffing/applications/${application.id}`));
  expect(detail.appointment).toMatchObject({ type: 'ra', status: 'active' });
  expect(detail.appointment.projectId).toBeFalsy();
  expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
  expect((await json(space.student.api.get('/api/auth/me'))).user.primaryRole).toBe('student');
  expect((await space.instructor.api.post('/api/staffing/projects', { data: { title: 'Unsupported workspace' } })).status()).toBe(404);
  await ok(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Appointment completed' } }));
  expect((await json(space.student.api.get(`/api/staffing/applications/${application.id}`))).appointment.status).toBe('ended');
});

test('AI assistance reports missing configuration without fake results or private data disclosure', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const status = await json(space.instructor.api.get('/api/ai/status'));
  expect(status.configured).toBe(false);
  const result = await json(space.instructor.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
  expect(JSON.stringify(result)).not.toContain('AI_API_KEY');
  expect(result.task.status).toMatch(/unconfigured|configuration_required/);
  expect(result.task.result).toBeFalsy();
  const outsider = await space.actor('ai-outsider');
  expect((await outsider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } })).status()).toBe(403);
  expect((await outsider.api.get(`/api/ai/tasks?targetId=${posting.id}`)).status()).toBe(403);
  expect(application.profile.skills).toBe('Algorithms');
});
