import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { test, expect, json, ok, database } from '../staffing-fixtures';

test('institutional identity binding rejects email changes, reused addresses and demo impersonation', async ({ space }) => {
  test.setTimeout(60000);
  const email = `institutional-${space.suffix}@example.com`;
  let profile: any = { id: 11001, email, name: 'Synthetic institutional student', username: `institutional-${space.suffix}` };
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Consume the synthetic token request. */ }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/oauth/token') res.end(JSON.stringify({ access_token: 'synthetic-institutional-access-token' }));
    else if (req.url === '/api/v4/user') res.end(JSON.stringify(profile));
    else res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as any).port;
  const allocator = createServer();
  await new Promise<void>(resolve => allocator.listen(0, '127.0.0.1', resolve));
  const port = (allocator.address() as any).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const log = openSync(`.cache/institutional-app-${port}.log`, 'w');
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { stdio: ['ignore', log, log], env: {
    ...process.env, NODE_ENV: 'production', MONGODB_URI: process.env.TEST_MONGODB_URI, MONGODB_DB: process.env.TEST_MONGODB_DB,
    SESSION_SECRET: randomBytes(32).toString('hex'), HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin, TRUST_PROXY: 'false',
    ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false', API_RATE_LIMIT: '10000', LOGIN_RATE_LIMIT: '1000',
    GITLAB_BASE_URL: `http://127.0.0.1:${providerPort}`, GITLAB_CLIENT_ID: 'synthetic-client', GITLAB_CLIENT_SECRET: 'synthetic-client-secret', ADMIN_EMAILS: '', ALLOWED_EMAIL_DOMAINS: '', AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '',
  } });
  closeSync(log);
  let api: APIRequestContext | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      if (child.exitCode !== null) throw new Error('Institutional fixture app exited.');
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      if (attempt > 100) throw new Error('Institutional fixture app not ready.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    api = await request.newContext({ baseURL: origin });
    const login = async () => {
      const begin = await api!.get('/api/auth/gitlab/login', { maxRedirects: 0 });
      expect(begin.status()).toBe(302);
      const state = new URL(begin.headers().location!).searchParams.get('state');
      expect(state).toMatch(/^[a-f0-9]{32}$/);
      return api!.get(`/api/auth/gitlab?code=synthetic-code&state=${state}`, { maxRedirects: 0 });
    };
    expect((await login()).status()).toBe(302);
    const first = (await json(api.get('/api/auth/me'))).user;
    expect(first.email).toBe(email);
    await ok(api.post('/api/auth/logout'));
    expect((await login()).status()).toBe(302);
    expect((await json(api.get('/api/auth/me'))).user.id).toBe(first.id);
    await ok(api.post('/api/auth/logout'));
    profile = { ...profile, email: `changed-${space.suffix}@example.com` };
    expect((await login()).status()).toBe(403);
    profile = { ...profile, id: 11002, email };
    expect((await login()).status()).toBe(403);
    expect((await api.post('/api/auth/mock', { data: { as: 'admin', email } })).status()).toBe(403);
    profile = { id: 11003, email: `invalid-${space.suffix}@example.com`, name: { invalid: true }, username: 'invalid' };
    expect((await login()).status()).toBe(502);
    const { client, db } = await database();
    try {
      expect(await db.collection('users').countDocuments({ email })).toBe(1);
      expect(await db.collection('users').countDocuments({ email: `changed-${space.suffix}@example.com` })).toBe(0);
      expect(await db.collection('providerIdentities').countDocuments({ userId: first.id })).toBe(1);
    } finally { await client.close(); }
  } finally {
    if (api) await api.dispose();
    if (child.exitCode === null) child.kill('SIGTERM');
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});
