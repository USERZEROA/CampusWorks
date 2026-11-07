import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, json, database } from '../staffing-fixtures';

test('transactional course cursors read beyond the first batch and roll back after a getMore failure', async ({ space }) => {
  const { client, db } = await database();
  try {
    const rows = Array.from({ length: 125 }, (_, index) => ({ index, email: `cursor-${index}-${space.suffix}@example.com` }));
    await db.collection('enrollments').insertMany(rows.map(row => ({ courseId: space.code, userEmail: row.email, role: 'student' })));
    await db.collection('feedback').insertMany(rows.map(row => ({ courseId: space.code, rating: 5, message: `Synthetic cursor feedback ${row.index}`, createdAt: new Date() })));
    await db.collection('helpSessions').insertMany(rows.map(row => ({ courseId: space.code, entryId: randomUUID(), studentEmail: row.email, studentName: 'Synthetic Student', joinedAt: new Date(), endedAt: new Date(), wasHelped: true, waitMinutes: 1, helpMinutes: 2 })));
    const before = (await db.collection('courses').findOne({ id: space.code }))!.mutationVersion;
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['getMore'], errorCode: 2, errorLabels: [] } });
    try {
      expect((await space.admin.api.get(`/api/courses/${space.code}/admin?limit=500`)).status()).toBe(500);
    } finally { await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' }); }
    expect((await db.collection('courses').findOne({ id: space.code }))!.mutationVersion).toBe(before);
    const replica = await space.secondary(space.admin);
    for (const api of [space.admin.api, replica]) {
      const result = await json(api.get(`/api/courses/${space.code}/admin?limit=500`));
      expect(result.feedback).toHaveLength(125);
      expect(result.helpSessions).toHaveLength(125);
      expect(result.enrollments.filter((row: any) => row.userEmail.startsWith('cursor-'))).toHaveLength(125);
      expect(result.pagination.totals.feedback).toBe(125);
      expect(result.pagination.hasMore).toMatchObject({ feedback: false, helpSessions: false, enrollments: false });
    }
    expect((await db.collection('courses').findOne({ id: space.code }))!.mutationVersion).toBe(before + 2);
  } finally {
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
    await client.close();
  }
});

test('approval outbox delivers once to more than 101 active administrators and excludes revoked or bound identities', async ({ space }) => {
  const { client, db } = await database();
  const valid = Array.from({ length: 125 }, (_, index) => ({ id: randomUUID(), email: `bulk-admin-${index}-${space.suffix}@example.com`, name: 'Synthetic Administrator', identityKind: 'mock', disabledAt: null }));
  const blocked = [
    { id: randomUUID(), email: `disabled-admin-${space.suffix}@example.com`, name: 'Synthetic Disabled Administrator', identityKind: 'mock', disabledAt: new Date() },
    { id: randomUUID(), email: `revoked-admin-${space.suffix}@example.com`, name: 'Synthetic Revoked Administrator', identityKind: 'mock', disabledAt: null },
    { id: randomUUID(), email: `bound-admin-${space.suffix}@example.com`, name: 'Synthetic Bound Identity', identityKind: 'mock', disabledAt: null },
    { id: randomUUID(), email: `mismatched-admin-${space.suffix}@example.com`, name: 'Synthetic Mismatched Identity', identityKind: 'mock', disabledAt: null },
    { id: randomUUID(), email: `wrong-email-admin-${space.suffix}@example.com`, name: 'Synthetic Mismatched Email', identityKind: 'mock', disabledAt: null },
  ];
  const ids = [...valid, ...blocked].map(account => account.id);
  const session = (account: { id: string; email: string; name: string }) => ({ _id: randomBytes(32).toString('hex'), userId: account.id, user: { id: account.id, email: account.email, name: account.name, provider: 'mock', primaryRole: 'admin' }, expiresAt: new Date(Date.now() + 3600000), revokedAt: null as Date | null, createdAt: new Date() });
  const blockedSessions = blocked.map(session);
  blockedSessions[1]!.revokedAt = new Date();
  blockedSessions[3]!.userId = space.student.user.id;
  blockedSessions[4]!.user.email = valid[0]!.email;
  const sessions = [...valid.map(session), ...blockedSessions, session(valid[0]!)];
  let opportunityId = '';
  try {
    // Synthetic database fixtures create no sign-in cookies or external accounts.
    await db.collection('users').insertMany([...valid, ...blocked]);
    await db.collection<any>('authSessions').insertMany(sessions);
    await db.collection('providerIdentities').insertOne({ id: randomUUID(), userId: blocked[2]!.id, email: blocked[2]!.email, provider: 'gitlab', issuer: `https://synthetic-${space.suffix}.example.test`, subject: '123456', revokedAt: null });
    expect(await db.collection('authSessions').countDocuments({ userId: { $in: valid.map(account => account.id) }, revokedAt: null })).toBeGreaterThan(101);
    const posting = await space.opportunity({ approvalRequired: true });
    opportunityId = posting.id;
    expect(posting.status).toBe('pending_approval');
    await json(space.admin.api.get('/api/staffing/overview'));
    const notificationEvent = await db.collection('staffingEvents').findOne({ kind: 'OpportunityUpdated', targetId: posting.id });
    expect(notificationEvent?.delivery).toBe('delivered');
    expect(await db.collection('staffingNotifications').countDocuments({ eventId: notificationEvent!.id, recipientId: { $in: valid.map(account => account.id) } })).toBe(125);
    expect(await db.collection('staffingNotifications').countDocuments({ eventId: notificationEvent!.id, recipientId: { $in: blocked.map(account => account.id) } })).toBe(0);
    await json(space.admin.api.get('/api/staffing/overview'));
    expect(await db.collection('staffingNotifications').countDocuments({ eventId: notificationEvent!.id, recipientId: { $in: valid.map(account => account.id) } })).toBe(125);
  } finally {
    await db.collection('authSessions').deleteMany({ _id: { $in: sessions.map(record => record._id) } } as any);
    await db.collection('providerIdentities').deleteMany({ userId: { $in: ids } });
    await db.collection('staffingNotifications').deleteMany({ recipientId: { $in: ids } });
    await db.collection('users').deleteMany({ id: { $in: ids } });
    if (opportunityId) await db.collection('staffingEvents').deleteMany({ targetId: opportunityId });
    await client.close();
  }
});
