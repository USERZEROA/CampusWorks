import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.NUXT_TELEMETRY_DISABLED = '1';
mkdirSync('.cache', { recursive: true });
const label = `campusworks-local-${Date.now()}-${randomBytes(3).toString('hex')}`;
const database = 'campusworks_local_tests';
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const servers = [];
let created = false, stopping = false;
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve(code) : reject(new Error(`${command} exited ${code}`)));
});
const capture = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', error = '';
  child.stdout.on('data', data => { out += data; });
  child.stderr.on('data', data => { error += data; });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(error.trim() || `${command} exited ${code}`)));
});
const freePort = () => new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('Application exited before readiness.');
    try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await pause(500);
  }
  throw new Error(`Application did not become ready at ${url}; inspect .cache/local-server logs.`);
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const child of servers) if (child.exitCode === null) {
    if (process.platform === 'win32') await capture('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill('SIGTERM');
  }
  if (created) await capture('docker', ['rm', '--force', label]).catch(error => console.error(error.message));
}
process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });

try {
  await run('docker', ['run', '--detach', '--name', label, '--publish', '127.0.0.1::27017', 'mongo:7', '--replSet', 'rs0', '--bind_ip_all', '--setParameter', 'enableTestCommands=1']);
  created = true;
  const mongoPort = Number((await capture('docker', ['port', label, '27017/tcp'])).split(':').at(-1));
  if (!Number.isInteger(mongoPort)) throw new Error('Invalid loopback database port.');
  const mongoUri = `mongodb://127.0.0.1:${mongoPort}/?replicaSet=rs0&directConnection=true`;
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  for (let attempt = 0; ; attempt++) {
    try { await client.connect(); break; } catch (error) { if (attempt >= 40) throw error; await pause(500); }
  }
  await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
  for (let attempt = 0; ; attempt++) {
    if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
    if (attempt >= 60) throw new Error('Test replica set did not elect a primary.');
    await pause(500);
  }
  await client.close();
  await run(process.execPath, [npmCli, 'run', 'test:unit']);
  await run(process.execPath, [npmCli, 'run', 'typecheck']);
  await run(process.execPath, [npmCli, 'run', 'build']);
  const origins = [`http://127.0.0.1:${await freePort()}`, `http://127.0.0.1:${await freePort()}`];
  const common = {
    ...process.env, NODE_ENV: 'production', MONGODB_URI: mongoUri, MONGODB_DB: database,
    SESSION_SECRET: randomBytes(32).toString('hex'), ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'true',
    GITLAB_BASE_URL: '', GITLAB_CLIENT_ID: '', GITLAB_CLIENT_SECRET: '', AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '',
    HOST: '127.0.0.1', TRUST_PROXY: 'false', API_RATE_LIMIT: '10000', LOGIN_RATE_LIMIT: '1000',
  };
  for (const [index, origin] of origins.entries()) {
    const log = openSync(`.cache/local-server-${index}.log`, 'w');
    const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, stdio: ['ignore', log, log], env: { ...common, PORT: new URL(origin).port, PUBLIC_ORIGIN: origin } });
    closeSync(log);
    servers.push(child);
    await ready(origin, child);
  }
  writeFileSync('.cache/local-targets.json', JSON.stringify({ primary: origins[0], secondary: origins[1], database, mongoPort }, null, 2));
  console.log(`Local browsers target ${origins[0]} and ${origins[1]}; all records are synthetic.`);
  const args = ['node_modules/@playwright/test/cli.js', 'test', '--reporter=list,json'];
  if (process.env.E2E_HEADED === '1') args.push('--headed');
  await run(process.execPath, args, { env: { ...common, BASE_URL: origins[0], SECONDARY_BASE_URL: origins[1], TEST_MONGODB_URI: mongoUri, TEST_MONGODB_DB: database, PLAYWRIGHT_JSON_OUTPUT_FILE: '.cache/local-e2e-results.json' } });
  const report = JSON.parse(readFileSync('.cache/local-e2e-results.json', 'utf8'));
  if (report.stats.unexpected || report.stats.flaky || report.stats.skipped) throw new Error('Local acceptance run is not fully passing.');
  console.log(`Local acceptance passed: ${report.stats.expected} tests, no skipped or flaky results.`);
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
