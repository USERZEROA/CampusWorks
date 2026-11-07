import { createServer, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { test, expect, database, json, ok, activateCycle, type StaffingSpace } from '../staffing-fixtures';

function respond(input: any, response: ServerResponse) {
  const reference = input.evidence.find((entry: any) => entry.reference.startsWith('app:'))?.reference || input.evidence[0].reference;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    summary: 'Synthetic automatic comparison using submitted evidence.', summaryEvidenceRefs: [reference],
    items: input.targetIds.map((targetId: string) => ({ targetId, explanation: 'Synthetic evidence; a human must make the decision.', evidenceRefs: [input.evidence.find((entry: any) => entry.reference.startsWith(`app:${targetId}:`))?.reference || reference] })),
    cautions: ['Local synthetic provider; no real hiring or paid model call.'],
  }) } }] }));
}
async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function exited(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
async function harness(space: StaffingSpace, handle: (input: any, response: ServerResponse, ordinal: number) => void | Promise<void> = (input, response) => respond(input, response), options: { automaticRefresh?: boolean } = {}) {
  const seen: any[] = [];
  const provider = createServer(async (req, res) => {
    let encoded = ''; for await (const chunk of req) encoded += chunk;
    const input = JSON.parse(JSON.parse(encoded).messages.at(-1).content);
    seen.push(input);
    try { await handle(input, res, seen.length); } catch { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const children: ChildProcess[] = [];
  const apis: APIRequestContext[] = [];
  const origins: string[] = [];
  const startApps = async (count = 2) => {
    for (let index = 0; index < count; index++) {
      const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
      origins.push(origin);
      const log = openSync(`.cache/ai-refresh-${port}.log`, 'w');
      const child = spawn(process.execPath, ['.output/server/index.mjs'], { stdio: ['ignore', log, log], env: {
        ...process.env, NODE_ENV: 'production', MONGODB_URI: process.env.TEST_MONGODB_URI, MONGODB_DB: process.env.TEST_MONGODB_DB,
        HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin, TRUST_PROXY: 'false', SESSION_SECRET: randomBytes(32).toString('hex'),
        ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false', API_RATE_LIMIT: '10000', LOGIN_RATE_LIMIT: '1000',
        AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_API_KEY: 'synthetic-refresh-key', AI_MODEL: 'synthetic-refresh-model',
        AI_DAILY_REQUEST_LIMIT: '100', AI_DAILY_TOKEN_BUDGET: '1000000',
        AI_AUTO_REFRESH_ENABLED: options.automaticRefresh === false ? 'false' : 'true',
        AI_AUTO_DISCOVERY_ENABLED: 'false',
      } });
      closeSync(log); children.push(child);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Automatic-analysis app exited during startup.');
        try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Automatic-analysis app did not become ready.');
      const api = await request.newContext({ baseURL: origin }); apis.push(api);
      await ok(api.post('/api/auth/mock', { data: { as: 'instructor', email: space.instructor.email } }));
    }
  };
  const stopApps = async () => { for (const api of apis.splice(0)) await api.dispose(); await Promise.all(children.splice(0).map(exited)); origins.splice(0); };
  const close = async () => { await stopApps(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); };
  try { await startApps(); return { seen, apis, origins, startApps, stopApps, close }; } catch (error) { await close(); throw error; }
}
const analysis = (api: APIRequestContext, opportunityId: string) => json(api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: opportunityId } }));
const history = (api: APIRequestContext, opportunityId: string) => json(api.get('/api/ai/tasks', { params: { kind: 'candidate_fit', targetId: opportunityId, page: 1, pageSize: 50 } }));

const refreshMutationKinds = ['ApplicationSubmitted', 'ApplicationRevised', 'ApplicationWithdrawn', 'ApplicationReviewed', 'CvUploaded', 'OfferIssued', 'OfferAccepted', 'OfferDeclined', 'OfferRescinded', 'AppointmentExpired', 'AppointmentEnded', 'AppointmentActivated', 'AppointmentClearance', 'AppointmentSuspend', 'AppointmentResume', 'OpportunityUpdated', 'RecruitmentCycleConfigured'];

test.afterEach(async ({ space }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const { client, db } = await database();
  try {
    const opportunities = await db.collection('staffingOpportunities').find({ courseId: space.code }, { projection: { _id: 0, id: 1, status: 1, termId: 1 } }).toArray();
    const ids = opportunities.map(row => row.id);
    const pending = { kind: { $in: refreshMutationKinds }, aiRefreshProcessedAt: { $exists: false } };
    const state = {
      synthetic: true, recordedAt: new Date().toISOString(),
      pendingEventCount: await db.collection('staffingEvents').countDocuments(pending),
      oldestPendingEvents: await db.collection('staffingEvents').find(pending, { projection: { _id: 0, id: 1, kind: 1, targetId: 1, createdAt: 1 } }).sort({ createdAt: 1, id: 1 }).limit(12).toArray(),
      opportunities,
      subscriptions: await db.collection('staffingAiSubscriptions').find({ opportunityId: { $in: ids } }, { projection: { _id: 0, id: 1, opportunityId: 1, active: 1, status: 1, approvalVersion: 1 } }).toArray(),
      jobs: await db.collection('staffingAiRefreshJobs').find({ opportunityId: { $in: ids } }, { projection: { _id: 1, subscriptionId: 1, opportunityId: 1, status: 1, generation: 1, runningGeneration: 1, fence: 1, dirty: 1, lastInputHash: 1, lastAttemptedInputHash: 1, nextAttemptAt: 1, updatedAt: 1, leaseUntil: 1, taskId: 1, lastTaskId: 1 } }).toArray(),
      taskStates: await db.collection('staffingAiTasks').find({ opportunityId: { $in: ids } }, { projection: { _id: 0, id: 1, status: 1, failureCode: 1, inputHash: 1, createdAt: 1, completedAt: 1 } }).sort({ createdAt: -1 }).limit(12).toArray(),
      concurrency: await db.collection<any>('staffingAiBudgets').findOne({ _id: 'concurrency' }, { projection: { leases: 1 } }),
    };
    await testInfo.attach('legacy-refresh-state.json', { body: Buffer.from(JSON.stringify(state, null, 2)), contentType: 'application/json' });
  } finally { await client.close(); }
});

async function insertRefreshBacklog(db: Awaited<ReturnType<typeof database>>['db'], suffix: string) {
  const ids = Array.from({ length: 250 }, (_, index) => `synthetic-refresh-backlog-${suffix}-${index}`);
  await db.collection('staffingEvents').insertMany(ids.map((id, index) => ({ id, kind: 'ApplicationSubmitted', targetId: `missing-${id}`, createdAt: new Date(Date.now() - 3600000 + index), details: { synthetic: true }, delivery: 'pending' })));
  return ids;
}

test('exact candidate-page refresh metadata remains reachable beyond one hundred approved scopes', async ({ space }) => {
  const posting = await space.opportunity();
  const peer = await space.actor('metadata-peer', 'instructor');
  await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: peer.email, role: 'instructor' } }));
  const service = await harness(space, undefined, { automaticRefresh: false });
  const { client, db } = await database();
  const prefix = `metadata-${posting.id}`;
  const lastScope = `${prefix}-101`;
  const peerScope = `${prefix}-peer`;
  try {
    const createdAt = new Date();
    await db.collection('staffingAiSubscriptions').insertMany([
      ...Array.from({ length: 101 }, (_, index) => ({ id: `${prefix}-${String(index + 1).padStart(3, '0')}`, requesterId: space.instructor.user.id, requesterEmail: space.instructor.email, opportunityId: posting.id, kind: 'candidate_fit', page: index + 1, pageSize: 50, active: true, status: 'active', createdAt })),
      { id: peerScope, requesterId: peer.user.id, requesterEmail: peer.email, opportunityId: posting.id, kind: 'candidate_fit', page: 101, pageSize: 50, active: true, status: 'active', createdAt },
    ]);
    await db.collection<any>('staffingAiRefreshJobs').insertMany([
      { _id: lastScope, subscriptionId: lastScope, opportunityId: posting.id, status: 'queued', generation: 101, updatedAt: createdAt },
      { _id: peerScope, subscriptionId: peerScope, opportunityId: posting.id, status: 'queued', generation: 77, updatedAt: createdAt },
    ]);
    await db.collection('staffingAiTasks').insertMany([
      { id: `${prefix}-task`, kind: 'candidate_fit', targetId: posting.id, opportunityId: posting.id, targetType: 'opportunity', candidatePage: 101, candidatePageSize: 50, requestedBy: space.instructor.user.id, status: 'pending', refreshSubscriptionId: lastScope, createdAt },
      { id: `${prefix}-peer-task`, kind: 'candidate_fit', targetId: posting.id, opportunityId: posting.id, targetType: 'opportunity', candidatePage: 101, candidatePageSize: 50, requestedBy: peer.user.id, status: 'pending', refreshSubscriptionId: peerScope, createdAt },
    ]);
    const params = { targetId: posting.id, kind: 'candidate_fit', page: 101, pageSize: 50 };
    const exact = await json(service.apis[0]!.get('/api/ai/tasks', { params }));
    expect(exact.refresh.subscriptions.map((scope: any) => scope.id)).toEqual([lastScope]);
    expect(exact.refresh.jobs).toEqual([expect.objectContaining({ subscriptionId: lastScope, status: 'queued', generation: 101 })]);
    expect(exact.tasks.map((task: any) => task.id)).toEqual([`${prefix}-task`]);
    const bounded = await json(service.apis[0]!.get('/api/ai/tasks', { params: { kind: 'candidate_fit' } }));
    expect(bounded.refresh.subscriptions).toHaveLength(100);
    await ok(service.apis[1]!.post('/api/auth/mock', { data: { as: 'instructor', email: peer.email } }));
    const peerView = await json(service.apis[1]!.get('/api/ai/tasks', { params }));
    expect(peerView.refresh.subscriptions.map((scope: any) => scope.id)).toEqual([peerScope]);
    expect(peerView.refresh.jobs.map((job: any) => job.subscriptionId)).toEqual([peerScope]);
    expect(peerView.tasks.map((task: any) => task.id)).toEqual([`${prefix}-peer-task`]);
    expect((await space.student.api.get('/api/ai/tasks', { params })).status()).toBe(403);
    for (const invalid of [{ ...params, page: '0x65' }, { ...params, pageSize: '5e1' }, { ...params, kind: 'unknown' }]) {
      expect((await service.apis[0]!.get('/api/ai/tasks', { params: invalid })).status()).toBe(400);
    }
    expect(service.seen).toHaveLength(0);
  } finally { await service.close(); await client.close(); }
});

test('current-semester review survives application closing while a disabled cycle revokes automatic analysis', async ({ space }) => {
  const posting = await space.opportunity();
  await space.application(posting);
  const service = await harness(space);
  const { client, db } = await database();
  try {
    await activateCycle(space.admin, space.term, { closesAt: new Date(Date.now() - 1000).toISOString() });
    expect((await analysis(service.apis[0]!, posting.id)).task.status).toBe('completed');
    expect(service.seen).toHaveLength(1);
    await activateCycle(space.admin, space.term, { enabled: false });
    expect((await service.apis[0]!.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } })).status()).toBe(409);
    const immediate = await history(service.apis[0]!, posting.id);
    expect(immediate.tasks.some((task: any) => task.status === 'completed' && task.result)).toBe(false);
    await expect.poll(async () => (await db.collection('staffingAiSubscriptions').findOne({ opportunityId: posting.id }))?.active, { timeout: 15000 }).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(service.seen).toHaveLength(1);
  } finally { await service.close(); await client.close(); }
});

test('ended appointments stop new candidate analysis and automatic calls while retaining authorized history and course reviews', async ({ space, browser }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const service = await harness(space);
  const { client, db } = await database();
  const context = await browser.newContext({ baseURL: service.origins[0] });
  try {
    await db.collection('staffingOpportunities').updateOne({ id: posting.id }, { $set: { appointmentEnd: new Date(Date.now() + 5000) } });
    const comparison = await analysis(service.apis[0]!, posting.id);
    expect(comparison.task.status).toBe('completed');
    expect((await json(service.apis[0]!.post('/api/ai/tasks', { data: { kind: 'cv_summary', targetId: application.id } }))).task.status).toBe('completed');
    expect(service.seen).toHaveLength(2);
    await expect.poll(async () => (await history(service.apis[0]!, posting.id)).canAnalyze, { timeout: 15000 }).toBe(false);
    await expect.poll(async () => (await db.collection('staffingAiSubscriptions').findOne({ opportunityId: posting.id }))?.active, { timeout: 15000 }).toBe(false);
    const historical = await history(service.apis[0]!, posting.id);
    expect(historical.tasks.find((task: any) => task.id === comparison.task.id)).toMatchObject({ status: 'completed', historical: true, result: expect.any(Object) });
    await db.collection('staffingAiTasks').updateOne({ id: comparison.task.id }, { $set: { status: 'stale', result: null } });
    const cachedHistory = await history(service.apis[0]!, posting.id);
    expect(cachedHistory.tasks.find((task: any) => task.id === comparison.task.id)).toMatchObject({ status: 'completed', historical: true, inputHash: comparison.task.inputHash, result: comparison.task.result });
    for (const request of [{ kind: 'candidate_fit', targetId: posting.id }, { kind: 'cv_summary', targetId: application.id }]) {
      expect((await service.apis[0]!.post('/api/ai/tasks', { data: request })).status()).toBe(409);
    }
    expect(service.seen).toHaveLength(2);
    await ok(context.request.post('/api/auth/mock', { data: { as: 'instructor', email: space.instructor.email } }));
    const page = await context.newPage();
    await page.goto(`/staffing/${posting.id}`);
    const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Candidate Review Assistance', exact: true }) });
    await expect(panel.getByTestId('ai-request')).toHaveCount(0);
    await expect(panel.getByTestId('ai-result')).toBeVisible();
    expect(service.seen).toHaveLength(2);
    expect((await json(service.apis[0]!.post('/api/ai/tasks', { data: { kind: 'term_review', targetId: posting.id } }))).task.status).toBe('completed');
    expect(service.seen).toHaveLength(3);
    await db.collection('staffingApplications').updateOne({ id: application.id }, { $set: { status: 'draft' } });
    expect((await history(service.apis[0]!, posting.id)).tasks).toEqual([]);
    await db.collection('staffingApplications').updateOne({ id: application.id }, { $set: { status: 'submitted' } });
    await ok(service.apis[1]!.post('/api/auth/mock', { data: { as: 'student', email: space.student.email } }));
    expect((await service.apis[1]!.get('/api/ai/tasks', { params: { kind: 'candidate_fit', targetId: posting.id } })).status()).toBe(403);
  } finally { await context.close(); await service.close(); await client.close(); }
});

test('course restrictions update TA recommendations automatically while leaving RA evidence and provider usage unchanged', async ({ space }) => {
  const teaching = await space.opportunity({ positions: 2, budget: 2400 });
  const research = await space.opportunity({ type: 'ra', courseId: '' });
  const first = await space.application(teaching);
  const second = await space.application(teaching, await space.actor('restriction-peer'));
  const researchApplication = await space.application(research);
  await ok(space.student.api.post('/api/courses/enroll', { data: { courseId: space.code, enroll: true } }));
  const service = await harness(space);
  try {
    expect((await analysis(service.apis[0]!, teaching.id)).task.result.items.map((item: any) => item.targetId)).toEqual([first.id, second.id]);
    expect((await analysis(service.apis[0]!, research.id)).task.result.items.map((item: any) => item.targetId)).toEqual([researchApplication.id]);
    expect(service.seen).toHaveLength(2);
    await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/kick`, { data: { email: space.student.email } }));
    expect((await space.instructor.api.post(`/api/staffing/applications/${first.id}/select`, { data: { expectedVersion: first.version, idempotencyKey: `restriction-${space.suffix}` } })).status()).toBe(409);
    await expect.poll(async () => {
      const current = await history(service.apis[0]!, teaching.id);
      return current.tasks.find((task: any) => task.status === 'completed' && task.result)?.result.items.map((item: any) => item.targetId);
    }, { timeout: 20000 }).toEqual([second.id]);
    await expect.poll(async () => (await history(service.apis[0]!, research.id)).tasks.find((task: any) => task.status === 'completed' && task.result)?.result.items.map((item: any) => item.targetId), { timeout: 20000 }).toEqual([researchApplication.id]);
    expect(service.seen).toHaveLength(3);
    await ok(space.instructor.api.post(`/api/courses/${space.code}/enrollments/restore`, { data: { email: space.student.email } }));
    await expect.poll(async () => (await history(service.apis[0]!, teaching.id)).tasks.find((task: any) => task.status === 'completed' && task.result)?.result.items.map((item: any) => item.targetId), { timeout: 20000 }).toEqual([first.id, second.id]);
    await expect.poll(async () => (await history(service.apis[0]!, research.id)).tasks.find((task: any) => task.status === 'completed' && task.result)?.result.items.map((item: any) => item.targetId), { timeout: 20000 }).toEqual([researchApplication.id]);
    // Both TA roster changes receive a fresh comparison. The unchanged RA
    // evidence reuses its validated result without another provider request.
    expect(service.seen).toHaveLength(4);
  } finally { await service.close(); }
});

test('the reviewer browser updates named candidate advice automatically without another analysis request', async ({ space, browser }, testInfo) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  const first = await space.application(posting);
  const second = await space.application(posting, await space.actor('browser-refresh-second'));
  const service = await harness(space);
  const context = await browser.newContext({ baseURL: service.origins[0], viewport: { width: 1440, height: 1000 } });
  try {
    await analysis(service.apis[0]!, posting.id);
    await ok(context.request.post('/api/auth/mock', { data: { as: 'instructor', email: space.instructor.email } }));
    const page = await context.newPage();
    let browserAnalysisPosts = 0;
    const errors: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/ai/tasks' && request.method() === 'POST') browserAnalysisPosts++; });
    page.on('pageerror', error => errors.push(error.message));
    expect((await page.goto(`/staffing/${posting.id}`))?.status()).toBe(200);
    const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Candidate Review Assistance', exact: true }) });
    await expect(panel.getByTestId('ai-result')).toBeVisible();
    await expect(panel.locator(`a[href="/applications/${first.id}"]`)).toBeVisible();
    await expect(panel.locator(`a[href="/applications/${second.id}"]`)).toBeVisible();
    await space.select(first, space.admin);
    await expect(panel.locator(`a[href="/applications/${first.id}"]`)).toHaveCount(0, { timeout: 20000 });
    await expect(panel.getByTestId('ai-result')).toBeVisible({ timeout: 20000 });
    await expect(panel.locator(`a[href="/applications/${second.id}"]`)).toBeVisible();
    expect(service.seen).toHaveLength(2);
    expect(browserAnalysisPosts).toBe(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('automatic-candidate-refresh.png'), fullPage: true });
  } finally { await context.close(); await service.close(); }
});

test('two application workers coalesce selection, submission and withdrawal refreshes without read cycles', async ({ space }) => {
  const posting = await space.opportunity({ positions: 3, budget: 3600 });
  const first = await space.application(posting);
  const secondActor = await space.actor('refresh-second');
  const second = await space.application(posting, secondActor);
  const service = await harness(space);
  try {
    expect((await analysis(service.apis[0]!, posting.id)).task.status).toBe('completed');
    for (const api of service.apis) await ok(api.post('/api/auth/logout'));
    await ok(space.instructor.api.post('/api/auth/logout'));
    await space.select(first, space.admin);
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(2);
    expect(service.seen[1].targetIds).toEqual([second.id]);
    // Scoped faculty consent survives closing/logging out of their browser;
    // current course authority, not a serialized primary role, authorizes refresh.
    for (const api of service.apis) await ok(api.post('/api/auth/mock', { data: { as: 'instructor', email: space.instructor.email } }));
    const thirdActor = await space.actor('refresh-third');
    const third = await space.application(posting, thirdActor);
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(3);
    expect(service.seen[2].targetIds).toEqual([second.id, third.id]);
    await ok(secondActor.api.post(`/api/staffing/applications/${second.id}/withdraw`, { data: {} }));
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(4);
    await expect.poll(async () => (await history(service.apis[1]!, posting.id)).refresh.latest?.status, { timeout: 15000 }).toBe('completed');
    expect(service.seen[3].targetIds).toEqual([third.id]);
    for (let index = 0; index < 6; index++) await history(service.apis[index % 2]!, posting.id);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(service.seen).toHaveLength(4);
    const { client, db } = await database();
    try { expect(await db.collection('staffingAiRefreshJobs').countDocuments({ opportunityId: posting.id })).toBe(1); } finally { await client.close(); }
  } finally { await service.close(); }
});

test('a change during an in-flight model call hides the old result and schedules one fresh generation', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  await space.application(posting);
  let arrived!: () => void; const received = new Promise<void>(resolve => { arrived = resolve; });
  let release!: () => void; const released = new Promise<void>(resolve => { release = resolve; });
  const service = await harness(space, async (input, response, ordinal) => { if (ordinal === 1) { arrived(); await released; } respond(input, response); });
  try {
    const pending = analysis(service.apis[0]!, posting.id);
    await received;
    const other = await space.actor('inflight-new');
    const application = await space.application(posting, other);
    const during = await history(service.apis[1]!, posting.id);
    expect(during.tasks.some((task: any) => task.result && task.status === 'completed')).toBe(false);
    release();
    expect((await pending).task.status).toBe('stale');
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(2);
    await expect.poll(async () => (await history(service.apis[1]!, posting.id)).refresh.latest?.status, { timeout: 15000 }).toBe('completed');
    expect(service.seen[1].targetIds).toContain(application.id);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(service.seen).toHaveLength(2);
  } finally { release(); await service.close(); }
});

test('offer expiry triggers automatic reconsideration without any reviewer page or polling request', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  const first = await space.application(posting);
  const other = await space.actor('expiry-other');
  const second = await space.application(posting, other);
  const selected = await space.select(first);
  const service = await harness(space);
  try {
    await analysis(service.apis[0]!, posting.id);
    expect(service.seen[0].targetIds).toEqual([second.id]);
    const { client, db } = await database();
    try {
      const expired = new Date(Date.now() - 1000);
      await db.collection('staffingOffers').updateOne({ id: selected.offer.id }, { $set: { expiresAt: expired } });
      await db.collection('staffingAppointments').updateOne({ id: selected.appointment.id }, { $set: { offerExpiresAt: expired } });
    } finally { await client.close(); }
    // This observes only the local fake provider, not a route that could perform maintenance.
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(2);
    expect(service.seen[1].targetIds).toEqual([first.id, second.id]);
  } finally { await service.close(); }
});

test('revoked reviewer authority prevents automatic generation after a genuine list change', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  await space.application(posting);
  const service = await harness(space);
  try {
    await analysis(service.apis[0]!, posting.id);
    await ok(space.admin.api.patch(`/api/courses/${space.code}/enrollments/role`, { data: { email: space.instructor.email, role: 'student' } }));
    await space.application(posting, await space.actor('after-revocation'));
    const { client, db } = await database();
    try { await expect.poll(async () => (await db.collection<any>('staffingAiRefreshJobs').findOne({ opportunityId: posting.id }))?.status, { timeout: 15000 }).toBe('revoked'); } finally { await client.close(); }
    expect(service.seen).toHaveLength(1);
    expect((await service.apis[0]!.get('/api/ai/tasks', { params: { kind: 'candidate_fit', targetId: posting.id } })).status()).toBe(403);
  } finally { await service.close(); }
});

test('a provider failure does not retry historical events or ordinary status reads', async ({ space }) => {
  const posting = await space.opportunity(); await space.application(posting);
  const service = await harness(space, (_input, response) => { response.writeHead(503).end('Synthetic failure'); });
  try {
    expect((await analysis(service.apis[0]!, posting.id)).task.status).toBe('failed');
    for (let index = 0; index < 4; index++) await history(service.apis[index % 2]!, posting.id);
    await new Promise(resolve => setTimeout(resolve, 1600));
    expect(service.seen).toHaveLength(1);
    const state = await history(service.apis[0]!, posting.id);
    expect(state.refresh.jobs[0].status).toBe('failed');
  } finally { await service.close(); }
});

test('provider-disabled instances retain pending changes without making an automatic call', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 }); await space.application(posting);
  const service = await harness(space);
  try {
    expect((await analysis(service.apis[0]!, posting.id)).task.status).toBe('completed');
    await service.stopApps();
    await space.application(posting, await space.actor('provider-disabled-new'));
    const pending = await history(space.instructor.api, posting.id);
    expect(pending.ai.configured).toBe(false);
    expect(pending.tasks.some((task: any) => task.status === 'completed' && task.result)).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(service.seen).toHaveLength(1);
    await service.startApps(1);
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(2);
  } finally { await service.close(); }
});

test('an automatic refresh respects durable per-user quota without a provider retry storm', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 }); await space.application(posting);
  const service = await harness(space);
  const { client, db } = await database();
  const budgets = db.collection<any>('staffingAiBudgets');
  const saved: Array<{ id: string; previous: any }> = [];
  try {
    expect((await analysis(service.apis[0]!, posting.id)).task.status).toBe('completed');
    const status = await json(service.apis[0]!.get('/api/ai/status'));
    for (const time of [Date.now(), Date.now() + 86400000]) {
      const day = new Date(time).toISOString().slice(0, 10); const id = `user:${day}:${space.instructor.user.id}`;
      if (saved.some(row => row.id === id)) continue;
      saved.push({ id, previous: await budgets.findOne({ _id: id }) });
      await budgets.replaceOne({ _id: id }, { _id: id, day, requests: status.limits.dailyRequestsPerUser, reservedTokens: 0 }, { upsert: true });
    }
    await space.application(posting, await space.actor('quota-refresh-new'));
    await expect.poll(async () => (await db.collection<any>('staffingAiRefreshJobs').findOne({ opportunityId: posting.id }))?.status, { timeout: 20000 }).toBe('blocked');
    const latest = await history(service.apis[0]!, posting.id);
    expect(latest.tasks.some((task: any) => task.status === 'completed' && task.result)).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1600));
    expect(service.seen).toHaveLength(1);
    const task = await db.collection('staffingAiTasks').findOne({ opportunityId: posting.id, failureCode: 'quota_daily' });
    expect(task).not.toBeNull();
    expect(((await budgets.findOne({ _id: 'concurrency' }))?.leases || []).some((lease: any) => lease.taskId === task!.id)).toBe(false);
  } finally {
    await service.close();
    for (const row of saved) { if (row.previous) await budgets.replaceOne({ _id: row.id }, row.previous); else await budgets.deleteOne({ _id: row.id }); }
    await client.close();
  }
});

test('a provider-disabled submission queues before historical events drain and resumes past an orphan job', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  await space.application(posting);
  const service = await harness(space);
  const { client, db } = await database();
  let backlog: string[] = [];
  try {
    const first = (await analysis(service.apis[0]!, posting.id)).task;
    expect(first.status).toBe('completed');
    await service.stopApps();
    backlog = await insertRefreshBacklog(db, space.suffix);
    await space.application(posting, await space.actor('durable-submission'));
    const queued = await db.collection<any>('staffingAiRefreshJobs').findOne({ _id: first.refreshSubscriptionId });
    expect(queued).toMatchObject({ status: 'queued', dirty: true });
    expect(queued!.generation).toBeGreaterThan(first.refreshGeneration);
    expect(await db.collection('staffingEvents').countDocuments({ id: { $in: backlog }, aiRefreshProcessedAt: { $exists: false } })).toBe(250);
    expect((await db.collection('staffingAiTasks').findOne({ id: first.id }))?.status).toBe('stale');
    const orphanId = `synthetic-orphan-${space.suffix}`;
    await db.collection<any>('staffingAiRefreshJobs').insertOne({ _id: orphanId, subscriptionId: orphanId, opportunityId: posting.id, status: 'queued', generation: 1, fence: 0, updatedAt: new Date(0), nextAttemptAt: new Date(0) });
    await service.startApps(1);
    await expect.poll(() => service.seen.length, { timeout: 20000 }).toBe(2);
    await expect.poll(async () => (await db.collection('staffingAiRefreshJobs').findOne({ _id: first.refreshSubscriptionId }))?.status, { timeout: 20000 }).toBe('idle');
    expect((await db.collection<any>('staffingAiRefreshJobs').findOne({ _id: orphanId }))?.status).toBe('revoked');
    for (let index = 0; index < 4; index++) await history(service.apis[0]!, posting.id);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(service.seen).toHaveLength(2);
  } finally {
    await service.close();
    if (backlog.length) await db.collection('staffingEvents').deleteMany({ id: { $in: backlog } });
    await client.close();
  }
});

test('a queued submission reaches exhausted reviewer capacity behind historical events without repeated attempts', async ({ space }) => {
  const posting = await space.opportunity({ positions: 2, budget: 2400 });
  await space.application(posting);
  const service = await harness(space);
  const { client, db } = await database();
  const budgets = db.collection<any>('staffingAiBudgets');
  const saved: Array<{ id: string; previous: any }> = [];
  let backlog: string[] = [];
  try {
    const first = (await analysis(service.apis[0]!, posting.id)).task;
    expect(first.status).toBe('completed');
    const status = await json(service.apis[0]!.get('/api/ai/status'));
    await service.stopApps();
    for (const timestamp of [Date.now(), Date.now() + 86400000]) {
      const day = new Date(timestamp).toISOString().slice(0, 10);
      const id = `user:${day}:${space.instructor.user.id}`;
      if (saved.some(row => row.id === id)) continue;
      saved.push({ id, previous: await budgets.findOne({ _id: id }) });
      await budgets.replaceOne({ _id: id }, { _id: id, day, requests: status.limits.dailyRequestsPerUser, reservedTokens: 0 }, { upsert: true });
    }
    backlog = await insertRefreshBacklog(db, space.suffix);
    await space.application(posting, await space.actor('durable-capacity'));
    expect(await db.collection('staffingAiRefreshJobs').findOne({ _id: first.refreshSubscriptionId })).toMatchObject({ status: 'queued', dirty: true });
    expect(await db.collection('staffingEvents').countDocuments({ id: { $in: backlog }, aiRefreshProcessedAt: { $exists: false } })).toBe(250);
    await service.startApps(1);
    await expect.poll(async () => (await db.collection('staffingAiRefreshJobs').findOne({ _id: first.refreshSubscriptionId }))?.status, { timeout: 20000 }).toBe('blocked');
    const failed = await db.collection('staffingAiTasks').find({ refreshSubscriptionId: first.refreshSubscriptionId, failureCode: 'quota_daily' }).toArray();
    expect(failed).toHaveLength(1);
    for (let index = 0; index < 4; index++) await history(service.apis[0]!, posting.id);
    await new Promise(resolve => setTimeout(resolve, 1600));
    expect(await db.collection('staffingAiTasks').countDocuments({ refreshSubscriptionId: first.refreshSubscriptionId, failureCode: 'quota_daily' })).toBe(1);
    expect(service.seen).toHaveLength(1);
    expect(((await budgets.findOne({ _id: 'concurrency' }))?.leases || []).some((lease: any) => lease.taskId === failed[0].id)).toBe(false);
  } finally {
    await service.close();
    if (backlog.length) await db.collection('staffingEvents').deleteMany({ id: { $in: backlog } });
    for (const row of saved) { if (row.previous) await budgets.replaceOne({ _id: row.id }, row.previous); else await budgets.deleteOne({ _id: row.id }); }
    await client.close();
  }
});
