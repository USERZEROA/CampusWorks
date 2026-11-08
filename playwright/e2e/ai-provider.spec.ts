import { createServer, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { test, expect, json, ok, database, type StaffingSpace } from '../staffing-fixtures';

type Provider = { api: APIRequestContext; origin: string; seen: any[]; close: () => Promise<void> };
async function providerApp(space: StaffingSpace, responder: (input: any, response: ServerResponse) => void | Promise<void>): Promise<Provider> {
  const seen: any[] = [];
  const provider = createServer(async (req, res) => {
    let encoded = '';
    for await (const chunk of req) encoded += chunk;
    const envelope = JSON.parse(encoded);
    const input = JSON.parse(envelope.messages.at(-1).content);
    seen.push({ input, envelope, authorization: req.headers.authorization });
    try { await responder(input, res); } catch { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as any).port;
  const portAllocator = createServer();
  await new Promise<void>(resolve => portAllocator.listen(0, '127.0.0.1', resolve));
  const appPort = (portAllocator.address() as any).port;
  await new Promise<void>(resolve => portAllocator.close(() => resolve()));
  const origin = `http://127.0.0.1:${appPort}`;
  const log = openSync(`.cache/ai-provider-app-${appPort}.log`, 'w');
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { stdio: ['ignore', log, log], env: {
    ...process.env, NODE_ENV: 'production', MONGODB_URI: process.env.TEST_MONGODB_URI, MONGODB_DB: process.env.TEST_MONGODB_DB,
    HOST: '127.0.0.1', PORT: String(appPort), PUBLIC_ORIGIN: origin, TRUST_PROXY: 'false',
    SESSION_SECRET: randomBytes(32).toString('hex'), ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false',
    API_RATE_LIMIT: '10000', LOGIN_RATE_LIMIT: '1000', AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, AI_API_KEY: 'synthetic-provider-test-key', AI_MODEL: 'synthetic-evidence-model',
    AI_AUTO_REFRESH_ENABLED: 'false',
    AI_AUTO_DISCOVERY_ENABLED: 'false',
  } });
  closeSync(log);
  let api: APIRequestContext | undefined;
  const stop = async () => {
    if (api) await api.dispose();
    if (child.exitCode === null) child.kill('SIGTERM');
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Provider test application exited.');
      try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Provider test application did not become ready.');
    api = await request.newContext({ baseURL: origin });
    await ok(api.post('/api/auth/mock', { data: { as: space.instructor.role, email: space.instructor.email } }));
    return { api, origin, seen, close: stop };
  } catch (error) { await stop(); throw error; }
}

function answer(input: any, response: ServerResponse, overrides: Record<string, any> = {}) {
  const applicationReference = input.evidence.find((item: any) => item.reference.startsWith('app:'))?.reference;
  const reference = applicationReference || input.evidence[0].reference;
  const result = {
    summary: 'Synthetic evidence-linked background comparison.', summaryEvidenceRefs: [reference],
    items: input.targetIds.map((targetId: string) => ({ targetId, explanation: 'Relevant submitted qualification evidence is available; a human must decide.', evidenceRefs: [input.evidence.find((item: any) => item.reference.startsWith(`app:${targetId}:`))?.reference || reference] })),
    cautions: ['Synthetic provider fixture; no hiring decision was made.'], ...overrides,
  };
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
}

test('configured AI uses a local provider, qualification evidence and validated citations', async ({ space }) => {
  const posting = await space.opportunity();
  await space.application(posting);
  const provider = await providerApp(space, (input, response) => answer(input, response));
  try {
    expect((await json(provider.api.get('/api/ai/status'))).configured).toBe(true);
    const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
    expect(result.task.status).toBe('completed');
    expect(result.task.result.items).toHaveLength(1);
    expect(provider.seen).toHaveLength(1);
    expect(provider.seen[0].authorization).toBe('Bearer synthetic-provider-test-key');
    const transmitted = JSON.stringify(provider.seen[0].input);
    expect(transmitted).not.toContain(space.student.email);
    expect(transmitted).not.toMatch(/"(firstName|lastName|citizenship|hasSsn|payrollBefore|dukeUniqueId)"/);
    expect(JSON.stringify(result)).not.toContain('synthetic-provider-test-key');
    const detail = await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`));
    expect(detail.offers).toHaveLength(0);
  } finally { await provider.close(); }
});

for (const kind of ['term_review', 'opportunity_draft'] as const) {
  test(`${kind} browser assistance displays completed evidence without an analysis control`, async ({ space, browser }) => {
    const posting = await space.opportunity();
    const provider = await providerApp(space, (input, response) => answer(input, response));
    const context = await browser.newContext({ baseURL: provider.origin, storageState: await provider.api.storageState() });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const courseReview = kind === 'term_review';
      const submitted = await json(provider.api.post('/api/ai/tasks', { data: { kind, targetId: courseReview ? space.code : posting.id, ...(courseReview ? { termId: space.term.id } : {}) } }));
      expect(submitted.task).toMatchObject({ kind, status: 'completed', result: expect.any(Object) });
      await page.goto(courseReview ? `/courses/${space.code}/review` : `/staffing/${posting.id}`);
      const title = courseReview ? 'Course Suggestions' : 'Requirement Draft Assistance';
      const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await expect(panel.getByTestId('ai-request')).toHaveCount(0);
      await expect(panel.getByTestId('ai-result')).toBeVisible();
      await expect(panel.getByTestId('ai-result')).toContainText('Synthetic evidence-linked background comparison.');
      expect(provider.seen).toHaveLength(1);
      expect(provider.seen[0].input.kind).toBe(kind);
      const transmitted = JSON.stringify(provider.seen[0].input);
      expect(transmitted).not.toMatch(/"(budget|hourlyRate|appointmentCost|committedCost|committedBudget|incurredCost)"/);
      if (courseReview) expect(provider.seen[0].input.evidence.find((entry: any) => entry.reference === 'metrics:staffing')?.value).toEqual({ approvedPositions: posting.positions, committedPositions: 0 });
      expect((await json(provider.api.get(`/api/staffing/opportunities/${posting.id}`))).offers).toHaveLength(0);
      expect(errors).toEqual([]);
    } finally { await context.close(); await provider.close(); }
  });
}

test('AI results with invented or cross-candidate citations are rejected', async ({ space }) => {
  const posting = await space.opportunity();
  await space.application(posting);
  const provider = await providerApp(space, (input, response) => answer(input, response, { summaryEvidenceRefs: ['invented:reference'] }));
  try {
    const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
    expect(result.task.status).toBe('failed');
    expect(result.task.result).toBeFalsy();
    expect((await json(space.instructor.api.get(`/api/staffing/opportunities/${posting.id}`))).offers).toHaveLength(0);
  } finally { await provider.close(); }
});

test('AI excludes administrative and unclassified screening while retaining technical qualification answers', async ({ space }) => {
  const posting = await space.opportunity({ questions: [
    { id: 'race', prompt: 'Explain race conditions and mutexes.', required: true, purpose: 'qualification' },
    { id: 'health', prompt: 'Describe a software health check.', required: true, purpose: 'qualification' },
  ] });
  const { client, db } = await database();
  const provider = await providerApp(space, (input, response) => answer(input, response));
  try {
    // Existing stored questions without a reviewed qualification purpose remain
    // readable by people, but do not become model input through compatibility.
    await db.collection('staffingOpportunities').updateOne({ id: posting.id }, { $push: { questions: { $each: [
      { id: 'duke', prompt: 'Enter your Duke Unique ID.', required: false, purpose: 'qualification' },
      { id: 'authorization', prompt: 'When does your work authorization expire?', required: false, purpose: 'qualification' },
      { id: 'legacy', prompt: 'Describe relevant teaching experience.', required: false },
    ] } } } as any);
    const application = await space.application(posting, space.student, { answers: { race: 'Mutexes protect shared state.', health: 'Use readiness and liveness endpoints.', duke: '1234567', authorization: '2030-01-01', legacy: 'Synthetic legacy answer.' } });
    const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
    expect(result.task.status).toBe('completed');
    const transmitted = JSON.stringify(provider.seen[0].input);
    expect(transmitted).toContain(`app:${application.id}:answers.race`);
    expect(transmitted).toContain(`app:${application.id}:answers.health`);
    for (const omitted of ['1234567', '2030-01-01', 'Synthetic legacy answer.', 'Duke Unique ID', 'work authorization']) expect(transmitted).not.toContain(omitted);
    expect(result.task.coverage.omittedQuestions).toBe(3);
    expect(result.task.result.cautions).toContain('Unclassified or administrative screening questions were omitted from this analysis.');
    for (const prompt of ['Enter your Duke Unique ID.', 'When does your work authorization expire?']) {
      expect((await space.instructor.api.post('/api/staffing/opportunities', { data: { ...posting, title: 'Synthetic invalid question', questions: [{ id: 'admin', prompt, required: true, purpose: 'qualification' }] } })).status()).toBe(400);
    }
  } finally { await provider.close(); await client.close(); }
});

for (const invalid of ['empty', 'omitted', 'duplicate'] as const) {
  test(`candidate comparison rejects ${invalid} target coverage`, async ({ space }) => {
    const posting = await space.opportunity({ positions: 2 });
    await space.application(posting);
    await space.application(posting, await space.actor(`coverage-${invalid}`));
    const provider = await providerApp(space, (input, response) => {
      const item = (targetId: string) => ({ targetId, explanation: 'Synthetic candidate evidence.', evidenceRefs: [input.evidence.find((entry: any) => entry.reference.startsWith(`app:${targetId}:`)).reference] });
      const first = item(input.targetIds[0]);
      answer(input, response, { items: invalid === 'empty' ? [] : invalid === 'omitted' ? [first] : [first, first] });
    });
    try {
      const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
      expect(result.task.status).toBe('failed');
      expect(result.task.result).toBeFalsy();
      expect(provider.seen).toHaveLength(1);
    } finally { await provider.close(); }
  });
}

test('AI output becomes stale when a candidate is reserved during analysis', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  let received!: () => void;
  const requestArrived = new Promise<void>(resolve => { received = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const provider = await providerApp(space, async (input, response) => { received(); await released; answer(input, response); });
  try {
    const pending = provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } });
    await requestArrived;
    await space.select(application);
    release();
    const result = await (await ok(pending)).json();
    expect(result.task.status).toBe('stale');
    expect(result.task.result).toBeFalsy();
  } finally { release(); await provider.close(); }
});

test('provider failures expose a safe task error and leave manual staffing usable', async ({ space }) => {
  const posting = await space.opportunity();
  const application = await space.application(posting);
  const provider = await providerApp(space, (_input, response) => { response.writeHead(503).end('synthetic-provider-test-key private upstream error'); });
  try {
    const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
    expect(result.task.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('private upstream');
    expect(JSON.stringify(result)).not.toContain('synthetic-provider-test-key');
    expect((await space.select(application)).offer.status).toBe('issued');
  } finally { await provider.close(); }
});

test('durable per-user AI quota refuses a call before contacting the provider', async ({ space }) => {
  const posting = await space.opportunity();
  await space.application(posting);
  const provider = await providerApp(space, (input, response) => answer(input, response));
  let connection: Awaited<ReturnType<typeof database>> | undefined;
  const saved: Array<{ id: string; previous: any }> = [];
  try {
    connection = await database();
    const budgets = connection.db.collection<any>('staffingAiBudgets');
    const status = await json(provider.api.get('/api/ai/status'));
    expect(status.configured).toBe(true);
    const identity = await json(provider.api.get('/api/auth/me'));
    const userId = identity.user.id;
    expect(userId).toBe(space.instructor.user.id);
    const requestLimit = status.limits.dailyRequestsPerUser;
    expect(requestLimit).toBeGreaterThan(0);
    // Include the following UTC date so this check remains valid across midnight.
    // Only this test's unique user rows are changed; global counters stay intact.
    for (const timestamp of [Date.now(), Date.now() + 86400000]) {
      const day = new Date(timestamp).toISOString().slice(0, 10);
      const id = `user:${day}:${userId}`;
      if (saved.some(entry => entry.id === id)) continue;
      saved.push({ id, previous: await budgets.findOne({ _id: id }) });
      await budgets.replaceOne({ _id: id }, { _id: id, day, requests: requestLimit, reservedTokens: 0 }, { upsert: true });
    }
    const callsBefore = provider.seen.length;
    const result = await json(provider.api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: posting.id } }));
    expect(result.task.status).toBe('failed');
    expect(result.task.message).toMatch(/budget/i);
    expect(result.task.result).toBeFalsy();
    expect(provider.seen).toHaveLength(callsBefore);
    const concurrency = await budgets.findOne({ _id: 'concurrency' });
    expect((concurrency?.leases || []).some((lease: any) => lease.taskId === result.task.id)).toBe(false);
    for (const entry of saved) {
      const quota = await budgets.findOne({ _id: entry.id });
      expect(quota.requests).toBe(requestLimit);
      expect(quota.reservedTokens).toBe(0);
    }
  } finally {
    try {
      if (connection) {
        const budgets = connection.db.collection<any>('staffingAiBudgets');
        for (const entry of saved) {
          if (entry.previous) await budgets.replaceOne({ _id: entry.id }, entry.previous);
          else await budgets.deleteOne({ _id: entry.id });
        }
      }
    } finally {
      await connection?.client.close();
      await provider.close();
    }
  }
});
