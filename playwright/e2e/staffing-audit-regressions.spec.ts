import { test, expect, json, ok, database, activateCycle } from '../staffing-fixtures';

test('course aliases persist one canonical appointment scope and cannot bypass deletion guards', async ({ space }) => {
  const posting = await space.opportunity({ courseId: space.code.toUpperCase() }, space.admin);
  expect(posting.courseId).toBe(space.code);
  const application = await space.application(posting);
  const selected = await space.select(application);
  expect(selected.appointment.courseId).toBe(space.code);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(true);
  await ok(space.student.api.post('/api/staffing/workload', { data: { appointmentId: selected.appointment.id, kind: 'office_hours', hours: 1, date: new Date().toISOString().slice(0, 10), notes: 'Synthetic alias observation' } }));
  const { client, db } = await database();
  try {
    for (const collection of ['staffingOpportunities', 'staffingAppointments', 'staffingOffers', 'staffingWorkload']) {
      await db.collection(collection).updateMany({ courseId: space.code }, { $set: { courseId: space.code.toUpperCase() } });
    }
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(true);
    const oldScopeReport = await json(space.instructor.api.get(`/api/staffing/reviews/${space.code}`));
    expect(oldScopeReport.budget).toMatchObject({ approvedBudget: posting.budget, committedBudget: selected.appointment.committedCost });
    expect(oldScopeReport.workload.totalHours).toBe(1);
    expect((await space.admin.api.delete(`/api/courses/${space.code}`)).status()).toBe(409);
    await ok(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Synthetic closeout' } }));
    for (const collection of ['staffingOpportunities', 'staffingAppointments', 'staffingOffers']) {
      expect(await db.collection(collection).countDocuments({ courseId: space.code.toUpperCase() })).toBe(0);
    }
  } finally { await client.close(); }
});

test('submitting requires the exact reviewed application revision', async ({ space }) => {
  const posting = await space.opportunity();
  const reviewed = await space.application(posting);
  const saved = (await json(space.student.api.patch(`/api/staffing/applications/${reviewed.id}`, { data: { expectedVersion: reviewed.version, profile: reviewed.profile, answers: reviewed.answers, qualificationText: 'A newer synthetic revision from another tab.' } }))).application;
  expect((await space.student.api.post(`/api/staffing/applications/${reviewed.id}/submit`, { data: {} })).status()).toBe(400);
  expect((await space.student.api.post(`/api/staffing/applications/${reviewed.id}/submit`, { data: { expectedVersion: reviewed.version } })).status()).toBe(409);
  const current = (await json(space.student.api.get(`/api/staffing/applications/${reviewed.id}`))).application;
  expect(current.status).toBe('draft');
  expect(current.submittedSnapshot.qualificationText).toBe(reviewed.qualificationText);
  const submitted = (await json(space.student.api.post(`/api/staffing/applications/${reviewed.id}/submit`, { data: { expectedVersion: saved.version } }))).application;
  expect(submitted.submittedSnapshot.qualificationText).toBe(saved.qualificationText);
});

test('recruitment must close strictly before semester end and rejects without changing the cycle', async ({ space }) => {
  const before = (await json(space.admin.api.get('/api/staffing/cycle'))).cycle;
  const response = await space.admin.api.put('/api/staffing/cycle', { data: { expectedVersion: before.version, termId: space.term.id, opensAt: before.opensAt, closesAt: space.term.endDate, enabled: true } });
  expect(response.status()).toBe(400);
  expect((await json(space.admin.api.get('/api/staffing/cycle'))).cycle).toEqual(before);
});

test('only site administrators can correct cleared details with a private before and after audit', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  const path = `/api/staffing/applications/${application.id}/administrative`;
  await ok(space.student.api.post(path, { data: { expectedAdministrativeVersion: 0, administrative: { dukeUniqueId: 'SYNTHETIC-OLD-ID', hasSsn: true } } }));
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  const cleared = (await json(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }))).appointment;
  const correction = { expectedAdministrativeVersion: 1, administrative: { dukeUniqueId: 'SYNTHETIC-NEW-ID', hasSsn: true }, reason: 'SYNTHETIC-PRIVATE-CORRECTION' };
  expect((await space.student.api.post(path, { data: correction })).status()).toBe(403);
  expect((await space.instructor.api.post(path, { data: correction })).status()).toBe(403);
  expect((await space.admin.api.post(path, { data: { ...correction, reason: '' } })).status()).toBe(400);
  await ok(space.admin.api.post(path, { data: correction }));
  expect((await space.admin.api.post(path, { data: correction })).status()).toBe(409);
  const adminView = await json(space.admin.api.get(`/api/staffing/applications/${application.id}`));
  expect(adminView.appointment).toEqual(cleared);
  expect(adminView.administrativeCorrections[0]).toMatchObject({ reason: correction.reason, before: { dukeUniqueId: 'SYNTHETIC-OLD-ID' }, after: { dukeUniqueId: 'SYNTHETIC-NEW-ID' }, administrativeVersion: 2 });
  const teacher = await json(space.instructor.api.get(`/api/staffing/applications/${application.id}`));
  const owner = await json(space.student.api.get(`/api/staffing/applications/${application.id}`));
  expect(teacher.administrativeCorrections).toBeUndefined();
  expect(owner.administrativeCorrections).toBeUndefined();
  expect(JSON.stringify(teacher)).not.toMatch(/SYNTHETIC-(?:OLD-ID|NEW-ID|PRIVATE-CORRECTION)/);
  const { client, db } = await database();
  try {
    const event = await db.collection('staffingEvents').findOne({ targetId: application.id, kind: 'AdministrativeDetailsCorrected' });
    expect(event?.details.auditId).toBe(adminView.administrativeCorrections[0].id);
    expect(JSON.stringify(event)).not.toContain(correction.reason);
    expect(JSON.stringify(await db.collection('staffingNotifications').find({}).toArray())).not.toContain(correction.reason);
  } finally { await client.close(); }
  await ok(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Synthetic history closeout' } }));
  const settled = (await json(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/settle`, { data: { incurredCost: 100 } }))).appointment;
  await ok(space.admin.api.post(path, { data: { ...correction, expectedAdministrativeVersion: 2, reason: 'Synthetic historical correction', administrative: { dukeUniqueId: 'SYNTHETIC-HISTORY-ID' } } }));
  const historical = await json(space.admin.api.get(`/api/staffing/applications/${application.id}`));
  expect(historical.appointment).toEqual(settled);
  expect(historical.administrativeCorrections[0]).toMatchObject({ before: { dukeUniqueId: 'SYNTHETIC-NEW-ID' }, after: { dukeUniqueId: 'SYNTHETIC-HISTORY-ID' }, reason: 'Synthetic historical correction' });
  expect((await space.student.api.post(path, { data: { ...correction, expectedAdministrativeVersion: 3 } })).status()).toBe(403);
});

test('reports distinguish requested plans, published approved plans, commitments and settled costs', async ({ space }) => {
  const published = await space.opportunity();
  const draft = (await json(space.instructor.api.post('/api/staffing/opportunities', { data: { ...published, title: 'Synthetic pending plan', approvalRequired: true, budget: 3456 } }))).opportunity;
  expect(draft.approved).toBe(false);
  await ok(space.admin.api.post('/api/staffing/opportunities', { data: { ...published, title: 'Synthetic administrator draft', budget: 800 } }));
  const path = `/api/staffing/reviews/${space.code}`;
  const before = await json(space.instructor.api.get(path));
  expect(before.budget).toMatchObject({ requestedBudget: 4256, approvedBudget: 1200, committedBudget: 0, settledBudget: 0 });
  const application = await space.application(published);
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
  await ok(space.instructor.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: { reason: 'Synthetic work completed' } }));
  expect((await json(space.instructor.api.get(path))).budget.committedBudget).toBe(selected.appointment.committedCost);
  await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/settle`, { data: { incurredCost: 100 } }));
  expect((await json(space.instructor.api.get(path))).budget).toMatchObject({ approvedBudget: 1200, committedBudget: 0, settledBudget: 100 });
});

test('a course restriction prevents selection and future automatic TA activation until restored', async ({ space }) => {
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  const posting = await space.opportunity({ appointmentStart: new Date(Date.now() + 86400000).toISOString() });
  const application = await space.application(posting);
  await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/kick`, { data: { email: space.student.email } }));
  expect((await space.instructor.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: `restricted-${space.suffix}` } })).status()).toBe(409);
  await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/restore`, { data: { email: space.student.email } }));
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  const selected = await space.select(application);
  await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  const pending = (await json(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }))).appointment;
  expect(pending.status).toBe('pending_start');
  await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/kick`, { data: { email: space.student.email } }));
  const { client, db } = await database();
  try {
    await db.collection('staffingAppointments').updateOne({ id: pending.id }, { $set: { startDate: new Date(Date.now() - 3600000) } });
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(false);
    const suspended = await db.collection('staffingAppointments').findOne({ id: pending.id });
    expect(suspended).toMatchObject({ status: 'suspended', committedCost: pending.committedCost });
    expect((await db.collection('staffingAllocations').findOne({ appointmentId: pending.id }))?.status).toBe('suspended');
    expect((await space.instructor.api.post(`/api/staffing/appointments/${pending.id}/resume`, { data: {} })).status()).toBe(409);
    await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/restore`, { data: { email: space.student.email } }));
    await ok(space.instructor.api.post(`/api/staffing/appointments/${pending.id}/resume`, { data: {} }));
    expect((await json(space.student.api.get(`/api/courses/${space.code}`))).isStaff).toBe(true);
  } finally { await client.close(); }
});

test('position end closes new applications and all qualification writes even while the shared cycle remains open', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const saved = (await json(space.student.api.patch(`/api/staffing/applications/${application.id}`, { data: { expectedVersion: application.version, profile: application.profile, answers: application.answers, qualificationText: application.qualificationText } }))).application;
  const late = await space.actor('ended-position-applicant');
  const { client, db } = await database();
  try {
    await db.collection('staffingOpportunities').updateOne({ id: posting.id }, { $set: { appointmentEnd: new Date(Date.now() - 1000) } });
    expect((await json(space.admin.api.get('/api/staffing/cycle'))).cycle.isOpen).toBe(true);
    expect((await late.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} })).status()).toBe(409);
    expect((await space.student.api.patch(`/api/staffing/applications/${saved.id}`, { data: { expectedVersion: saved.version, profile: saved.profile, answers: saved.answers, qualificationText: 'This ended position must not accept changes.' } })).status()).toBe(409);
    expect((await space.student.api.post(`/api/staffing/applications/${saved.id}/cv`, { multipart: { expectedVersion: String(saved.version), file: { name: 'synthetic-ended-cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic closed-position CV') } } })).status()).toBe(409);
    expect((await space.student.api.post(`/api/staffing/applications/${saved.id}/submit`, { data: { expectedVersion: saved.version } })).status()).toBe(409);
    expect((await json(space.student.api.get(`/api/staffing/applications/${saved.id}`))).application).toEqual(saved);
    await ok(space.student.api.post(`/api/staffing/applications/${saved.id}/withdraw`, { data: {} }));
  } finally { await client.close(); }
});

test('historical applications retain their authorized position title outside the public catalog', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const selected = await space.select(application);
  const otherTerm = (await json(space.admin.api.post('/api/staffing/terms', { data: { name: 'Synthetic later semester', startDate: new Date(Date.now() + 90 * 86400000).toISOString(), endDate: new Date(Date.now() + 150 * 86400000).toISOString() } }))).term;
  try {
    await activateCycle(space.admin, otherTerm);
    const overview = await json(space.student.api.get('/api/staffing/overview'));
    expect(overview.opportunities.some((item: any) => item.id === posting.id)).toBe(false);
    expect(overview.myApplications.find((item: any) => item.id === application.id).opportunityTitle).toBe(posting.title);
    expect(overview.myAppointments.find((item: any) => item.id === selected.appointment.id).opportunityTitle).toBe(posting.title);
  } finally {
    await activateCycle(space.admin, space.term);
    const { client, db } = await database();
    try { await db.collection('staffingTerms').deleteOne({ id: otherTerm.id }); } finally { await client.close(); }
  }
});
