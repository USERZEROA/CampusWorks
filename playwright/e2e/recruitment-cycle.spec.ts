import { randomUUID } from 'node:crypto';
import { test, expect, json, ok, database, type StaffingSpace } from '../staffing-fixtures';

const draftBody = (space: StaffingSpace, changes: Record<string, unknown> = {}) => ({
  type: 'ra', title: `Synthetic recruitment ${space.suffix}`, courseId: '', department: 'Computer Science',
  description: 'Synthetic recruitment cycle verification.', positions: 1, weeklyHours: 10, duties: [], questions: [],
  cvRequired: false, approvalRequired: false, ...changes,
});

async function configure(space: StaffingSpace, changes: Record<string, unknown>) {
  const current = (await json(space.admin.api.get('/api/staffing/cycle'))).cycle;
  return json(space.admin.api.put('/api/staffing/cycle', { data: { expectedVersion: current.version, termId: current.termId, opensAt: current.opensAt, closesAt: current.closesAt, enabled: current.enabled, ...changes } }));
}

async function removeRecord(collection: string, id: string) {
  const { client, db } = await database();
  try { await db.collection(collection).deleteOne({ id }); } finally { await client.close(); }
}

test('only server-authorized instructors and administrators receive recruitment management capabilities', async ({ space }) => {
  const ta = await space.actor('queue-only', 'ta');
  const unassignedFaculty = await space.actor('unassigned-faculty', 'instructor');
  for (const actor of [space.student, ta, unassignedFaculty]) {
    const capabilities = await json(actor.api.get('/api/staffing/capabilities'));
    expect(capabilities.viewer.canManageStaffing).toBe(false);
    expect((await actor.api.post('/api/staffing/opportunities', { data: draftBody(space) })).status()).toBe(403);
    expect((await actor.api.put('/api/staffing/cycle', { data: {} })).status()).toBe(403);
    const overview = await json(actor.api.get('/api/staffing/overview'));
    expect(overview.managedOpportunities).toEqual([]);
    expect(overview.terms).toEqual([]);
    expect(overview).not.toHaveProperty('projects');
  }
  expect((await json(ta.api.get('/api/staffing/capabilities'))).viewer.canApplyStaffing).toBe(true);
  expect((await json(space.instructor.api.get('/api/staffing/capabilities'))).viewer.canManageStaffing).toBe(true);
  expect((await json(space.admin.api.get('/api/staffing/capabilities'))).viewer.isGlobalAdmin).toBe(true);
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const taView = await json(ta.api.get(`/api/staffing/opportunities/${posting.id}`));
  expect(taView.canManage).toBe(false);
  expect(taView.applications).toEqual([]);
  expect((await ta.api.get(`/api/staffing/applications/${application.id}`)).status()).toBe(403);
  expect((await ta.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: randomUUID() } })).status()).toBe(403);
  expect((await space.admin.api.post('/api/staffing/projects', { data: {} })).status()).toBe(404);
  expect((await space.admin.api.get('/api/staffing/projects/removed/workspace')).status()).toBe(404);
});

test('ordinary postings inherit the shared semester dates and cannot select another semester or deadline', async ({ space }) => {
  const cycle = (await json(space.instructor.api.get('/api/staffing/cycle'))).cycle;
  const created = (await json(space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space) }))).opportunity;
  try {
    expect(created).toMatchObject({ termId: cycle.termId, appointmentStart: cycle.startDate, appointmentEnd: cycle.endDate, applicationDeadline: cycle.closesAt });
    expect(created).not.toHaveProperty('projectId');
    expect((await space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space, { termId: randomUUID() }) })).status()).toBe(409);
    expect((await space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space, { applicationDeadline: new Date(Date.now() + 123456).toISOString() }) })).status()).toBe(409);
    const extended = await configure(space, { closesAt: new Date(Date.now() + 8 * 86400000).toISOString() });
    const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${created.id}`));
    expect(detail.opportunity.applicationDeadline).toBe(extended.cycle.closesAt);
  } finally { await removeRecord('staffingOpportunities', created.id); }
});

test('closing recruitment blocks publishing and submission while existing applications remain selectable', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const second = await space.actor('late-draft');
  const submitted = await space.application(posting, second);
  const draft = (await json(second.api.patch(`/api/staffing/applications/${submitted.id}`, { data: { expectedVersion: submitted.version, profile: submitted.profile, answers: submitted.answers, qualificationText: submitted.qualificationText } }))).application;
  const pending = (await json(space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space) }))).opportunity;
  try {
    await configure(space, { opensAt: new Date(Date.now() - 2 * 86400000).toISOString(), closesAt: new Date(Date.now() - 1000).toISOString(), enabled: true });
    const third = await space.actor('late-applicant');
    expect((await third.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(409);
    expect((await second.api.post(`/api/staffing/applications/${draft.id}/submit`, { data: { expectedVersion: draft.version } })).status()).toBe(409);
    expect((await space.instructor.api.post(`/api/staffing/opportunities/${pending.id}/publish`, { data: { expectedVersion: pending.version } })).status()).toBe(409);
    const chosen = await space.select(application);
    await ok(space.student.api.post(`/api/staffing/offers/${chosen.offer.id}/accept`, { data: {} }));
    await ok(space.admin.api.post(`/api/staffing/appointments/${chosen.appointment.id}/clearance`, { data: { status: 'cleared' } }));
    const capabilities = await json(space.student.api.get('/api/staffing/capabilities'));
    expect(capabilities.currentCycle).toMatchObject({ isOpen: false, canReview: true });
    expect(capabilities.viewer.canApplyStaffing).toBe(true);
  } finally { await removeRecord('staffingOpportunities', pending.id); }
});

test('semester changes preserve issued offers and reuse the same course while blocking stale recruitment commands', async ({ space }) => {
  const posting = await space.opportunity();
  const selected = await space.select(await space.application(posting));
  const next = (await json(space.admin.api.post('/api/staffing/terms', { data: { name: `Next ${space.suffix}`, startDate: space.term.startDate, endDate: space.term.endDate, requiresApproval: false } }))).term;
  let createdId = '';
  try {
    await configure(space, { termId: next.id });
    const overview = await json(space.student.api.get('/api/staffing/overview'));
    expect(overview.opportunities.some((opportunity: any) => opportunity.id === posting.id)).toBe(false);
    expect(overview.myApplications.some((application: any) => application.id === selected.offer.applicationId)).toBe(true);
    const another = await space.actor('wrong-semester');
    expect((await another.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(409);
    const created = (await json(space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space, { type: 'ta', courseId: space.code }) }))).opportunity;
    createdId = created.id;
    expect(created.termId).toBe(next.id);
    await ok(space.instructor.api.post(`/api/staffing/opportunities/${created.id}/publish`, { data: { expectedVersion: created.version } }));
    await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  } finally {
    if (createdId) await removeRecord('staffingOpportunities', createdId);
    await removeRecord('staffingTerms', next.id);
  }
});

test('the shared cycle fence serializes concurrent closing and application creation across app instances', async ({ space }) => {
  const posting = await space.opportunity();
  const current = (await json(space.admin.api.get('/api/staffing/cycle'))).cycle;
  const secondary = await space.secondary(space.student);
  const [closed, application] = await Promise.all([
    space.admin.api.put('/api/staffing/cycle', { data: { expectedVersion: current.version, termId: current.termId, opensAt: current.opensAt, closesAt: new Date(Date.now() - 1000).toISOString(), enabled: true } }),
    secondary.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }),
  ]);
  expect(closed.status()).toBe(200);
  expect([200, 409]).toContain(application.status());
  const later = await space.actor('after-global-close');
  expect((await later.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(409);
  expect((await json(secondary.get('/api/staffing/cycle'))).cycle.isOpen).toBe(false);
  expect((await space.admin.api.put('/api/staffing/cycle', { data: { expectedVersion: current.version, termId: current.termId, opensAt: current.opensAt, closesAt: current.closesAt, enabled: true } })).status()).toBe(409);
});

test('disabled or not-yet-open cycles block review and selection until an administrator opens recruitment', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const select = () => space.instructor.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: randomUUID() } });
  await configure(space, { enabled: false });
  expect((await select()).status()).toBe(409);
  expect((await space.instructor.api.post(`/api/staffing/applications/${application.id}/shortlist`, { data: { shortlisted: true } })).status()).toBe(409);
  await configure(space, { enabled: true, opensAt: new Date(Date.now() + 86400000).toISOString(), closesAt: new Date(Date.now() + 2 * 86400000).toISOString() });
  expect((await select()).status()).toBe(409);
  await configure(space, { opensAt: new Date(Date.now() - 86400000).toISOString() });
  expect((await select()).status()).toBe(200);
});

test('a cross-instance semester switch orders new drafts and resubmission without accepting stale-semester commands', async ({ space }) => {
  const posting = await space.opportunity();
  const submitted = await space.application(posting);
  const draft = (await json(space.student.api.patch(`/api/staffing/applications/${submitted.id}`, { data: { expectedVersion: submitted.version, profile: submitted.profile, answers: submitted.answers, qualificationText: submitted.qualificationText } }))).application;
  const next = (await json(space.admin.api.post('/api/staffing/terms', { data: { name: `Switch ${space.suffix}`, startDate: space.term.startDate, endDate: space.term.endDate, requiresApproval: false } }))).term;
  const before = (await json(space.admin.api.get('/api/staffing/cycle'))).cycle;
  const studentReplica = await space.secondary(space.student);
  const facultyReplica = await space.secondary(space.instructor);
  let createdId = '';
  try {
    const [switched, resubmitted, created] = await Promise.all([
      space.admin.api.put('/api/staffing/cycle', { data: { expectedVersion: before.version, termId: next.id, opensAt: before.opensAt, closesAt: before.closesAt, enabled: true } }),
      studentReplica.post(`/api/staffing/applications/${draft.id}/submit`, { data: { expectedVersion: draft.version } }),
      facultyReplica.post('/api/staffing/opportunities', { data: draftBody(space) }),
    ]);
    expect(switched.status()).toBe(200);
    expect([200, 409]).toContain(resubmitted.status());
    expect(created.status(), await created.text()).toBe(200);
    const record = (await created.json()).opportunity;
    createdId = record.id;
    expect([before.termId, next.id]).toContain(record.termId);
    const currentApplication = (await json(studentReplica.get(`/api/staffing/applications/${draft.id}`))).application;
    expect((await studentReplica.post(`/api/staffing/applications/${draft.id}/submit`, { data: { expectedVersion: currentApplication.version } })).status()).toBe(409);
    expect((await space.instructor.api.post('/api/staffing/opportunities', { data: draftBody(space, { termId: before.termId }) })).status()).toBe(409);
    const publish = await facultyReplica.post(`/api/staffing/opportunities/${record.id}/publish`, { data: { expectedVersion: record.version } });
    expect(publish.status()).toBe(record.termId === next.id ? 200 : 409);
  } finally {
    if (createdId) await removeRecord('staffingOpportunities', createdId);
    await removeRecord('staffingTerms', next.id);
  }
});

test('RA hiring uses the direct instructor owner and administrator without a separate research project', async ({ space }) => {
  const posting = await space.opportunity({ type: 'ra', courseId: '' });
  expect(posting).not.toHaveProperty('projectId');
  const application = await space.application(posting);
  const other = await space.actor('other-owner', 'instructor');
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: other.email, role: 'instructor' } }));
  expect((await json(other.api.get('/api/staffing/capabilities'))).viewer.canManageStaffing).toBe(true);
  const view = await json(other.api.get(`/api/staffing/opportunities/${posting.id}`));
  expect(view.canManage).toBe(false);
  expect(view.applications).toEqual([]);
  expect((await other.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: randomUUID() } })).status()).toBe(403);
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: space.instructor.email, role: 'ta' } }));
  expect((await json(space.instructor.api.get('/api/staffing/capabilities'))).viewer.canManageStaffing).toBe(false);
  expect((await space.instructor.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: randomUUID() } })).status()).toBe(403);
  const selected = await space.select(application, space.admin);
  expect(selected.offer.type).toBe('ra');
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  expect((await space.student.api.post('/api/staffing/workload', { data: { appointmentId: selected.appointment.id, date: new Date().toISOString().slice(0, 10), kind: 'research', hours: 1, notes: 'Synthetic scope assertion' } })).status()).toBe(409);
});

test('course queue reads leave linked RA lifecycle changes to the canonical opportunity transaction', async ({ space }) => {
  const posting = await space.opportunity({ type: 'ra', courseId: space.code, appointmentStart: new Date(Date.now() + 86400000).toISOString() });
  const selected = await space.select(await space.application(posting));
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const { client, db } = await database();
  try {
    await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { startDate: new Date(Date.now() - 1000) } });
    await json(space.instructor.api.get(`/api/courses/${space.code}`));
    expect((await db.collection('staffingAppointments').findOne({ id: selected.appointment.id }))?.status).toBe('pending_start');
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await db.collection('staffingAppointments').findOne({ id: selected.appointment.id }))?.status).toBe('active');
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
  } finally { await client.close(); }
});

test('current-semester course reports include legacy TA observations while excluding RA course metadata', async ({ space }) => {
  const teaching = await space.opportunity();
  const research = await space.opportunity({ type: 'ra', courseId: space.code });
  const selected = await space.select(await space.application(teaching));
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  const observation = await json(space.student.api.post('/api/staffing/workload', { data: { appointmentId: selected.appointment.id, date: new Date().toISOString().slice(0, 10), kind: 'office_hours', hours: 2, notes: 'Synthetic teaching observation' } }));
  const { client, db } = await database();
  try {
    expect((await db.collection('staffingWorkload').findOne({ id: observation.record.id }))?.type).toBeUndefined();
    await db.collection('staffingWorkload').insertOne({ id: randomUUID(), appointmentId: randomUUID(), opportunityId: research.id, courseId: space.code, termId: space.term.id, kind: 'research', hours: 7, date: new Date().toISOString().slice(0, 10), notes: 'Synthetic historical RA observation', source: 'self-reported', authorEmail: space.instructor.email, createdAt: new Date() });
    const report = await json(space.instructor.api.get(`/api/staffing/reviews/${space.code}`));
    expect(report.termId).toBe(space.term.id);
    expect(report.currentCycle.termId).toBe(space.term.id);
    expect(report.workload).toMatchObject({ totalHours: 2, count: 1, byKind: { office_hours: 2 } });
    expect(report.workload.byKind).not.toHaveProperty('research');
    expect(report.staffing).toMatchObject({ approvedPositions: teaching.positions, committedPositions: 1, openPositions: teaching.positions - 1 });
    expect(report.staffing.opportunities.map((opportunity: any) => opportunity.id)).toEqual([teaching.id]);
    expect(report).not.toHaveProperty('budget');
  } finally { await client.close(); }
});
