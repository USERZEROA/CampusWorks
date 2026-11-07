import { randomUUID } from 'node:crypto';
import { test, expect, json, ok, database, type StaffingSpace } from '../staffing-fixtures';

const day = 86400000;
const iso = (timestamp: number) => new Date(timestamp).toISOString();

async function otherTerm(space: StaffingSpace) {
  return (await json(space.admin.api.post('/api/staffing/terms', { data: {
    name: `Overlapping term ${space.suffix}`, requiresApproval: false,
    startDate: space.term.startDate, endDate: space.term.endDate,
  } }))).term;
}

async function research(space: StaffingSpace, termId: string, dates: Record<string, string> = {}) {
  const project = (await json(space.instructor.api.post('/api/staffing/projects', { data: {
    title: `Synthetic research ${space.suffix}`, description: 'Isolated appointment overlap verification.', department: 'Computer Science',
  } }))).project;
  return space.opportunity({ type: 'ra', courseId: '', projectId: project.id, termId, weeklyHours: 10, ...dates });
}

async function removeTerm(id: string) {
  const { client, db } = await database();
  try { await db.collection('staffingTerms').deleteOne({ id }); } finally { await client.close(); }
}

async function selectResponse(space: StaffingSpace, application: any) {
  return space.instructor.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: randomUUID() } });
}

test('different application instances serialize overlapping half TA and RA offers across distinct terms', async ({ space }) => {
  const term = await otherTerm(space);
  try {
    const ta = await space.opportunity({ weeklyHours: 10 });
    const ra = await research(space, term.id);
    const profile = { firstName: 'Synthetic', lastName: 'Applicant', preferredEmail: space.student.email, undergraduateMajors: 'Computer Science', department: 'Computer Science', positionPreference: 'half', priorTaExperience: false, priorCourses: '', multipleCourses: true, graduationTerm: space.term.name, availability: 'Weekday afternoons', availableHours: 20, skills: 'Algorithms', experience: 'Peer tutoring' };
    const a = await space.application(ta, space.student, { profile });
    const b = await space.application(ra, space.student, { profile });
    const replica = await space.secondary(space.instructor);
    const responses = await Promise.all([
      selectResponse(space, a),
      replica.post(`/api/staffing/applications/${b.id}/select`, { data: { expectedVersion: b.version, idempotencyKey: randomUUID() } }),
    ]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    const { client, db } = await database();
    try {
      expect(await db.collection('staffingAppointments').countDocuments({ opportunityId: { $in: [ta.id, ra.id] }, status: 'offered' })).toBe(1);
    } finally { await client.close(); }
    for (const posting of [ta, ra]) {
      const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
      expect(detail.applications[0].availability.unavailable).toBe(true);
    }
  } finally { await removeTerm(term.id); }
});

test('adjacent cross-term dates are allowed while the same term remains exclusive without overlapping dates', async ({ space }) => {
  const term = await otherTerm(space);
  const timestamp = Date.now();
  const boundary = timestamp + 8 * day;
  try {
    const ta = await space.opportunity({ appointmentStart: iso(timestamp + day), appointmentEnd: iso(boundary) });
    const ra = await research(space, term.id, { appointmentStart: iso(boundary), appointmentEnd: iso(timestamp + 15 * day) });
    const sameTerm = await research(space, space.term.id, { appointmentStart: iso(timestamp + 16 * day), appointmentEnd: iso(timestamp + 23 * day) });
    await space.select(await space.application(ta));
    const adjacent = await space.application(ra);
    const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${ra.id}`));
    expect(detail.applications[0].availability.unavailable).toBe(false);
    await space.select(adjacent);
    const excluded = await space.application(sameTerm);
    expect((await selectResponse(space, excluded)).status()).toBe(409);
  } finally { await removeTerm(term.id); }
});

test('accepted, future, active and suspended commitments block overlapping work until ended', async ({ space }) => {
  const term = await otherTerm(space);
  try {
    const ta = await space.opportunity({ appointmentStart: iso(Date.now() + day) });
    const ra = await research(space, term.id);
    const selected = await space.select(await space.application(ta));
    const other = await space.application(ra);
    await ok(space.student.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
    expect((await selectResponse(space, other)).status()).toBe(409);
    const cleared = await json(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }));
    expect(cleared.appointment.status).toBe('pending_start');
    expect((await selectResponse(space, other)).status()).toBe(409);
    // Advance only this isolated fixture's start instant instead of sleeping a day.
    const { client, db } = await database();
    try { await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { startDate: new Date(Date.now() - 1000) } }); } finally { await client.close(); }
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await selectResponse(space, other)).status()).toBe(409);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/suspend`, { data: {} }));
    expect((await selectResponse(space, other)).status()).toBe(409);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: {} }));
    await space.select(other);
  } finally { await removeTerm(term.id); }
});

test('acceptance, clearance and resume independently reject a conflicting stored appointment', async ({ space }) => {
  const term = await otherTerm(space);
  const timestamp = Date.now();
  try {
    const ta = await space.opportunity({ appointmentStart: iso(timestamp - 1000), appointmentEnd: iso(timestamp + 8 * day) });
    const ra = await research(space, term.id, { appointmentStart: iso(timestamp + 8 * day), appointmentEnd: iso(timestamp + 15 * day) });
    const a = await space.select(await space.application(ta));
    const b = await space.select(await space.application(ra));
    const { client, db } = await database();
    const conflicting = async (enabled: boolean) => db.collection('staffingAppointments').updateOne({ id: b.appointment.id }, { $set: { startDate: new Date(enabled ? timestamp + day : timestamp + 8 * day) } });
    try {
      // Inject legacy inconsistent dates; public APIs cannot create this state.
      await conflicting(true);
      expect((await space.student.api.post(`/api/staffing/offers/${a.offer.id}/accept`, { data: {} })).status()).toBe(409);
      expect((await db.collection('staffingAppointments').findOne({ id: a.appointment.id }))?.status).toBe('offered');
      await conflicting(false);
      await ok(space.student.api.post(`/api/staffing/offers/${a.offer.id}/accept`, { data: {} }));
      await conflicting(true);
      expect((await space.admin.api.post(`/api/staffing/appointments/${a.appointment.id}/clearance`, { data: { status: 'cleared' } })).status()).toBe(409);
      await conflicting(false);
      await ok(space.admin.api.post(`/api/staffing/appointments/${a.appointment.id}/clearance`, { data: { status: 'cleared' } }));
      await ok(space.admin.api.post(`/api/staffing/appointments/${a.appointment.id}/suspend`, { data: {} }));
      await conflicting(true);
      expect((await space.admin.api.post(`/api/staffing/appointments/${a.appointment.id}/resume`, { data: {} })).status()).toBe(409);
      expect((await db.collection('staffingAppointments').findOne({ id: a.appointment.id }))?.status).toBe('suspended');
      await conflicting(false);
      await ok(space.admin.api.post(`/api/staffing/appointments/${a.appointment.id}/resume`, { data: {} }));
    } finally { await client.close(); }
  } finally { await removeTerm(term.id); }
});

test('expired offers release availability and old cleanup cannot release a replacement allocation', async ({ space }) => {
  const ta = await space.opportunity();
  const ra = await research(space, space.term.id);
  const first = await space.select(await space.application(ta));
  const second = await space.application(ra);
  const { client, db } = await database();
  try {
    const past = new Date(Date.now() - 1000);
    await db.collection('staffingOffers').updateOne({ id: first.offer.id }, { $set: { expiresAt: past } });
    await db.collection('staffingAppointments').updateOne({ id: first.appointment.id }, { $set: { offerExpiresAt: past } });
    await db.collection('staffingAllocations').updateOne({ offerId: first.offer.id }, { $set: { expiresAt: past } });
    const replacement = await space.select(second);
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await db.collection('staffingAllocations').findOne({ applicantId: space.student.user.id, termId: space.term.id }))?.offerId).toBe(replacement.offer.id);
    expect((await db.collection('staffingAppointments').findOne({ id: replacement.appointment.id }))?.status).toBe('offered');
    expect((await space.student.api.post(`/api/staffing/offers/${first.offer.id}/accept`, { data: {} })).status()).toBe(409);
  } finally { await client.close(); }
});

test('disabled future appointments suspend without starving eligible activation or blocking an authorized release', async ({ space }) => {
  const term = await otherTerm(space);
  const { client, db } = await database();
  try {
    const ta = await space.opportunity({ positions: 2, budget: 2400, appointmentStart: iso(Date.now() + day) });
    const ra = await research(space, term.id);
    const selected = await space.select(await space.application(ta));
    const eligible = await space.actor('eligible-start');
    const second = await space.select(await space.application(ta, eligible));
    for (const [candidate, offer] of [[space.student, selected], [eligible, second]] as const) {
      await ok(candidate.api.post(`/api/staffing/offers/${offer.offer.id}/accept`, { data: {} }));
      await ok(space.admin.api.post(`/api/staffing/appointments/${offer.appointment.id}/clearance`, { data: { status: 'cleared' } }));
    }
    const application = await space.application(ra);
    await db.collection('users').updateOne({ id: space.student.user.id }, { $set: { disabledAt: new Date() } });
    await db.collection('staffingAppointments').updateMany({ id: { $in: [selected.appointment.id, second.appointment.id] } }, { $set: { startDate: new Date(Date.now() - 1000) } });
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect((await db.collection('staffingAppointments').findOne({ id: selected.appointment.id }))?.status).toBe('suspended');
    expect((await db.collection('staffingAppointments').findOne({ id: second.appointment.id }))?.status).toBe('active');
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentSuspend', targetId: selected.appointment.id, actorId: 'system' })).toBe(1);
    await json(space.admin.api.post('/api/staffing/reconcile', { data: {} }));
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentSuspend', targetId: selected.appointment.id, actorId: 'system' })).toBe(1);
    const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${ra.id}`));
    expect(detail.applications[0].availability.unavailable).toBe(true);
    expect((await selectResponse(space, application)).status()).toBe(409);
    await ok(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/end`, { data: {} }));
    await db.collection('users').updateOne({ id: space.student.user.id }, { $set: { disabledAt: null } });
    await space.select(application);
  } finally {
    await db.collection('users').updateOne({ id: space.student.user.id }, { $set: { disabledAt: null } });
    await client.close();
    await removeTerm(term.id);
  }
});
