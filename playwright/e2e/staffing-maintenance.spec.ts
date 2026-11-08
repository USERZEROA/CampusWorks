import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { test, expect, json, ok, database } from '../staffing-fixtures';

test('provider-independent maintenance expires an unanswered offer and delivers its event once without page or API reconciliation', async ({ space }) => {
  expect(Boolean(process.env.AI_API_KEY?.trim())).toBe(false);
  expect(Boolean(process.env.AI_BASE_URL?.trim())).toBe(false);
  const replica = await space.secondary(space.admin);
  expect((await replica.get('/api/health')).status()).toBe(200);
  const posting = await space.opportunity();
  const selected = await space.select(await space.application(posting));
  const { client, db } = await database();
  try {
    const expiredAt = new Date(Date.now() - 1000);
    await db.collection('authSessions').updateMany({ userId: { $in: [space.student.user.id, space.instructor.user.id] } }, { $set: { revokedAt: new Date() } });
    await db.collection('staffingOffers').updateOne({ id: selected.offer.id }, { $set: { expiresAt: expiredAt } });
    await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { offerExpiresAt: expiredAt } });
    // Everything after making the offer due is observed through the isolated database.
    await expect.poll(async () => (await db.collection('staffingAppointments').findOne({ id: selected.appointment.id }))?.status, { timeout: 30000 }).toBe('expired');
    expect(await db.collection('staffingOffers').findOne({ id: selected.offer.id })).toMatchObject({ status: 'expired' });
    expect(await db.collection('staffingAllocations').findOne({ appointmentId: selected.appointment.id })).toMatchObject({ status: 'released' });
    expect(await db.collection('staffingOpportunities').findOne({ id: posting.id })).toMatchObject({ committedPositions: 0 });
    expect(await db.collection('staffingOpportunities').findOne({ id: posting.id })).not.toHaveProperty('committedBudget');
    const event = await db.collection('staffingEvents').findOne({ kind: 'AppointmentExpired', targetId: selected.appointment.id });
    expect(event).toBeTruthy();
    await expect.poll(() => db.collection('staffingNotifications').countDocuments({ eventId: event!.id, recipientId: space.student.user.id }), { timeout: 30000 }).toBe(1);
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentExpired', targetId: selected.appointment.id })).toBe(1);
    expect(await db.collection('staffingEvents').findOne({ id: event!.id })).toMatchObject({ delivery: 'delivered', channel: 'in-app', recipientCount: 1 });
  } finally { await client.close(); }
});

test('due cleared appointments activate automatically while restricted candidates suspend and uncleared candidates remain pending', async ({ space }) => {
  const restricted = await space.actor('maintenance-restricted');
  const uncleared = await space.actor('maintenance-uncleared');
  const requester = await space.actor('maintenance-requester');
  const posting = await space.opportunity({ positions: 3, appointmentStart: new Date(Date.now() + 86400000).toISOString() });
  await ok(restricted.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  const active = await space.select(await space.application(posting));
  const blocked = await space.select(await space.application(posting, restricted));
  const pending = await space.select(await space.application(posting, uncleared));
  for (const [candidate, selected] of [[space.student, active], [restricted, blocked], [uncleared, pending]] as const) {
    await ok(candidate.api.post(`/api/staffing/offers/${selected.offer.id}/accept`, { data: {} }));
  }
  for (const selected of [active, blocked]) {
    expect((await json(space.admin.api.post(`/api/staffing/appointments/${selected.appointment.id}/clearance`, { data: { status: 'cleared' } }))).appointment.status).toBe('pending_start');
  }
  await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/kick`, { data: { email: restricted.email } }));
  const { client, db } = await database();
  try {
    const entryId = new ObjectId();
    await db.collection('queueEntries').insertOne({ _id: entryId, courseId: space.code, studentEmail: requester.email, studentName: 'Synthetic requester', location: 'Synthetic maintenance room', question: 'Synthetic pending help', paused: false, position: 1, createdAt: new Date(), helpSegments: [], taEmail: restricted.email, ta: 'Synthetic restricted helper', activeHelpStartAt: new Date(Date.now() - 1000) });
    await db.collection('courses').updateOne({ id: space.code }, { $push: { onDutyTAs: { email: restricted.email, name: 'Synthetic restricted helper' } } as any });
    await db.collection('staffingAppointments').updateMany({ id: { $in: [active.appointment.id, blocked.appointment.id, pending.appointment.id] } }, { $set: { startDate: new Date(Date.now() - 1000) } });
    await expect.poll(async () => (await db.collection('staffingAppointments').findOne({ id: active.appointment.id }))?.status, { timeout: 30000 }).toBe('active');
    await expect.poll(async () => (await db.collection('staffingAppointments').findOne({ id: blocked.appointment.id }))?.status, { timeout: 30000 }).toBe('suspended');
    expect(await db.collection('staffingAppointments').findOne({ id: pending.appointment.id })).toMatchObject({ status: 'pending_clearance', clearance: 'pending' });
    expect(await db.collection('staffingAllocations').findOne({ appointmentId: blocked.appointment.id })).toMatchObject({ status: 'suspended' });
    expect(await db.collection('staffingOpportunities').findOne({ id: posting.id })).toMatchObject({ committedPositions: 3 });
    expect((await db.collection('courses').findOne({ id: space.code }))?.onDutyTAs).not.toEqual(expect.arrayContaining([expect.objectContaining({ email: restricted.email })]));
    expect(await db.collection('queueEntries').findOne({ _id: entryId })).toMatchObject({ question: 'Synthetic pending help' });
    expect((await db.collection('queueEntries').findOne({ _id: entryId }))?.taEmail).toBeUndefined();
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentActivated', targetId: active.appointment.id })).toBe(1);
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentSuspend', targetId: blocked.appointment.id })).toBe(1);
    expect(await db.collection('staffingEvents').countDocuments({ kind: 'AppointmentActivated', targetId: pending.appointment.id })).toBe(0);
  } finally { await client.close(); }
});

test('bounded maintenance advances beyond one hundred resources and drains both appointment and notification work without sessions', async ({ space }) => {
  expect(process.env.AI_API_KEY || '').toBe('');
  const count = 103;
  const rows = Array.from({ length: count }, (_, index) => ({ index, userId: randomUUID(), email: `synthetic-maintenance-${space.suffix}-${index}@example.com`, opportunityId: randomUUID(), applicationId: randomUUID(), appointmentId: randomUUID(), offerId: randomUUID(), eventId: randomUUID() }));
  const userIds = rows.map(row => row.userId);
  const opportunityIds = rows.map(row => row.opportunityId);
  const appointmentIds = rows.map(row => row.appointmentId);
  const offerIds = rows.map(row => row.offerId);
  const applicationIds = rows.map(row => row.applicationId);
  const eventIds = rows.map(row => row.eventId);
  const { client, db } = await database();
  const now = Date.now();
  try {
    await db.collection('users').insertMany(rows.map(row => ({ id: row.userId, email: row.email, name: 'Synthetic maintenance candidate', identityKind: 'mock', disabledAt: null })));
    await db.collection('staffingOpportunities').insertMany(rows.map(row => ({ id: row.opportunityId, type: 'ra', termId: space.term.id, ownerId: space.instructor.user.id, ownerEmail: space.instructor.email, title: 'Synthetic maintenance position', department: 'Computer Science', courseId: '', status: 'filled', approved: true, version: 1, mutationVersion: 0, positions: 1, committedPositions: 1, appointmentStart: new Date(now - 3600000), appointmentEnd: new Date(now + 86400000) })));
    await db.collection('staffingApplications').insertMany(rows.map(row => ({ id: row.applicationId, opportunityId: row.opportunityId, termId: space.term.id, applicantId: row.userId, applicantEmail: row.email, applicantName: 'Synthetic maintenance candidate', status: 'selected', version: 1, submittedAt: new Date(now - 3600000), profile: {}, answers: {} })));
    await db.collection('staffingOffers').insertMany(rows.map(row => ({ id: row.offerId, applicationId: row.applicationId, appointmentId: row.appointmentId, opportunityId: row.opportunityId, applicantId: row.userId, applicantEmail: row.email, instructorEmail: space.instructor.email, termId: space.term.id, status: 'issued', version: 1, expiresAt: new Date(now - 1000), endDate: new Date(now + 86400000) })));
    await db.collection('staffingAllocations').insertMany(rows.map(row => ({ applicantId: row.userId, termId: space.term.id, appointmentId: row.appointmentId, opportunityId: row.opportunityId, offerId: row.offerId, status: 'offered', version: 1, expiresAt: new Date(now - 1000), endDate: new Date(now + 86400000) })));
    await db.collection('staffingEvents').insertMany(rows.map(row => ({ id: row.eventId, actorId: space.instructor.user.id, kind: 'OfferIssued', targetId: row.offerId, details: {}, createdAt: new Date(now - 3600000 + row.index), delivery: 'pending' })));
    // Insert the due resources last so every transition observes a complete synthetic graph.
    await db.collection('staffingAppointments').insertMany(rows.map(row => ({ id: row.appointmentId, type: 'ra', applicationId: row.applicationId, offerId: row.offerId, opportunityId: row.opportunityId, applicantId: row.userId, applicantEmail: row.email, applicantName: 'Synthetic maintenance candidate', instructorEmail: space.instructor.email, termId: space.term.id, status: 'offered', clearance: 'not_started', acceptedAt: null, version: 1, startDate: new Date(now - 3600000), endDate: new Date(now + 86400000), offerExpiresAt: new Date(now - 1000) })));
    await expect.poll(() => db.collection('staffingAppointments').countDocuments({ id: { $in: appointmentIds }, status: 'expired' }), { timeout: 60000 }).toBe(count);
    await expect.poll(() => db.collection('staffingNotifications').countDocuments({ eventId: { $in: eventIds }, recipientId: { $in: userIds } }), { timeout: 30000 }).toBe(count);
    await expect.poll(() => db.collection('staffingEvents').countDocuments({ targetId: { $in: appointmentIds }, kind: 'AppointmentExpired', delivery: 'delivered' }), { timeout: 30000 }).toBe(count);
    expect(await db.collection('staffingEvents').countDocuments({ targetId: { $in: appointmentIds }, kind: 'AppointmentExpired' })).toBe(count);
    expect(await db.collection('staffingAllocations').countDocuments({ applicantId: { $in: userIds }, status: 'released' })).toBe(count);
    expect(await db.collection('staffingOpportunities').countDocuments({ id: { $in: opportunityIds }, committedPositions: 0 })).toBe(count);
  } finally {
    await db.collection('staffingNotifications').deleteMany({ recipientId: { $in: userIds } });
    await db.collection('staffingEvents').deleteMany({ $or: [{ id: { $in: eventIds } }, { targetId: { $in: appointmentIds } }] });
    await db.collection('staffingAppointments').deleteMany({ id: { $in: appointmentIds } });
    await db.collection('staffingAllocations').deleteMany({ applicantId: { $in: userIds } });
    await db.collection('staffingOffers').deleteMany({ id: { $in: offerIds } });
    await db.collection('staffingApplications').deleteMany({ id: { $in: applicationIds } });
    await db.collection('staffingOpportunities').deleteMany({ id: { $in: opportunityIds } });
    await db.collection('users').deleteMany({ id: { $in: userIds } });
    await client.close();
  }
});
