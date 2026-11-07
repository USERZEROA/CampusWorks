import { createServer, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { test, expect, database, json, ok, type StaffingSpace } from '../staffing-fixtures';

function respond(input: any, response: ServerResponse) {
  const reference = input.evidence.find((entry: any) => entry.reference.startsWith('app:'))?.reference || input.evidence[0].reference;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    summary: 'Synthetic automatic comparison using submitted evidence.', summaryEvidenceRefs: [reference],
    items: input.targetIds.map((targetId: string) => ({ targetId, explanation: 'Synthetic evidence; a human must make the decision.', evidenceRefs: [input.evidence.find((entry: any) => entry.reference.startsWith(`app:${targetId}:`)).reference] })),
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
async function harness(space: StaffingSpace, handle: (input: any, response: ServerResponse, ordinal: number) => void | Promise<void> = (input, response) => respond(input, response)) {
  const seen: any[] = [];
  const provider = createServer(async (req, res) => {
    let encoded = ''; for await (const chunk of req) encoded += chunk;
    const input = JSON.parse(JSON.parse(encoded).messages.at(-1).content);
    seen.push(input);
    try { await handle(input, res, seen.length); } catch { res.writeHead(500).end(); }
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
    await analysis(service.apis[0]!, posting.id);
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
    await analysis(service.apis[0]!, posting.id);
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
