import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';
import { request } from '@playwright/test';
import { loadAiProviderConfig, confirmedProviderDefaults } from './ai-provider-config.mjs';
import { prepareShowcase, showcaseWindows } from './demo-showcase.mjs';
import { loadShowcaseManifest } from './demo-showcase-data.mjs';
import { DEMO_CATALOG_VERSION } from './demo-catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
mkdirSync('.cache', { recursive: true });
const flags = new Set(process.argv.slice(2));
const accepted = ['--prepare-only', '--serve-only', '--no-ai', '--warm-ai', '--fresh', '--resume', '--skip-build'];
if ([...flags].some(flag => !accepted.includes(flag))) throw new Error('Unsupported showcase option.');
const port = Number(process.env.SHOWCASE_PORT || 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SHOWCASE_PORT must be between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const databaseName = flags.has('--fresh') ? `campusworks_showcase_${Date.now().toString(36)}` : process.env.SHOWCASE_DATABASE || `campusworks_showcase_v${DEMO_CATALOG_VERSION}`;
if (!/^campusworks_showcase(?:_[a-z0-9]+)*$/.test(databaseName)) throw new Error('Use a dedicated showcase database name.');
const privateSettings = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const mongoPassword = encodeURIComponent(process.env.MONGO_PASSWORD || privateSettings.MONGO_PASSWORD || 'campusworks-dev');
const mongoPort = Number(process.env.SHOWCASE_MONGO_PORT || 27017);
if (mongoPort !== 27017) throw new Error('This local Compose showcase uses MongoDB port 27017.');
const mongodbUri = `mongodb://campusworks:${mongoPassword}@127.0.0.1:${mongoPort}/?authSource=admin&replicaSet=rs0&directConnection=true`;
const pause = ms => new Promise(done => setTimeout(done, ms));
const children = new Set();
let app, mongoStarted = false, databaseClient, cleaning;
const capture = (command, args) => new Promise((done, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.resume();
  child.once('error', () => reject(new Error('The local showcase command could not run.')));
  child.once('exit', code => code === 0 ? done(output.trim()) : reject(new Error('The local showcase command did not complete.')));
});
const run = (command, args) => new Promise((done, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('error', () => reject(new Error('The local build could not start.')));
  child.once('exit', code => { children.delete(child); code === 0 ? done() : reject(new Error('The local build did not complete.')); });
});
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') await capture('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  else {
    child.kill('SIGTERM');
    await Promise.race([new Promise(done => child.once('exit', done)), pause(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(done => child.once('exit', done)), pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; }
    throw new Error('An owned showcase process could not be stopped.');
  }
}
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    const stopped = await Promise.allSettled([...children].map(stopChild));
    let complete = stopped.every(result => result.status === 'fulfilled');
    let realAiRequestsReservedAtClose;
    if (databaseClient) {
      try {
        const budget = await databaseClient.db(databaseName).collection('staffingAiBudgets').findOne({ _id: `global:${new Date().toISOString().slice(0, 10)}` });
        realAiRequestsReservedAtClose = budget?.requests || 0;
      } catch { complete = false; }
    }
    if (databaseClient) await databaseClient.close().catch(() => {});
    if (mongoStarted) {
      try {
        await capture('docker', ['compose', '-p', 'campusworks-demo', '-f', 'docker-compose.yml', 'stop', 'mongo']);
        if (await capture('docker', ['ps', '--filter', 'label=com.docker.compose.project=campusworks-demo', '--filter', 'name=^/campusworks-demo-mongo-1$', '--format', '{{.ID}}'])) complete = false;
      } catch { complete = false; }
    }
    const path = '.cache/showcase-state.json';
    if (existsSync(path)) {
      const state = JSON.parse(readFileSync(path, 'utf8'));
      if (state.launcherPid === process.pid) writeFileSync(path, JSON.stringify({ ...state, ...(realAiRequestsReservedAtClose !== undefined ? { realAiRequestsReservedAtClose } : {}), closedAt: new Date().toISOString(), cleanup: complete ? 'complete' : 'incomplete' }, null, 2));
    }
    return { complete };
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().then(result => process.exit(result.complete ? 0 : 1)); });

async function startApp(provider = null) {
  await stopChild(app); if (app) children.delete(app);
  const output = openSync('.cache/showcase-app.log', 'a');
  app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', output, output], env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin,
    MONGODB_URI: mongodbUri, MONGODB_DB: databaseName, SESSION_SECRET: sessionSecret,
    ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false', TRUST_PROXY: 'false',
    ADMIN_EMAILS: '', ALLOWED_EMAIL_DOMAINS: '', GITLAB_BASE_URL: '', GITLAB_CLIENT_ID: '', GITLAB_CLIENT_SECRET: '',
    NUXT_PUBLIC_DEMO_LABEL: 'Synthetic demo data',
    AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '', AI_AUTO_DISCOVERY_ENABLED: 'true', AI_AUTO_REFRESH_ENABLED: provider ? 'true' : 'false',
    STAFFING_MAINTENANCE_ENABLED: 'true', ...(provider || {}),
  } });
  closeSync(output); children.add(app);
  let startupFailed = false;
  app.once('error', () => { startupFailed = true; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupFailed || app.exitCode !== null) throw new Error('The showcase app exited before readiness.');
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    await pause(300);
  }
  throw new Error('The showcase database or app is not ready.');
}
const sessionSecret = randomBytes(32).toString('hex');

try {
  await new Promise((done, reject) => {
    const socket = createServer();
    socket.once('error', () => reject(new Error('The showcase port is in use. Set SHOWCASE_PORT to a free local port.')));
    socket.listen(port, '127.0.0.1', () => socket.close(done));
  });
  if (!flags.has('--skip-build')) {
    const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await run(process.execPath, [npmCli, 'run', 'build']);
  }
  if (!existsSync('.output/server/index.mjs')) throw new Error('Build the application before preparing a showcase.');
  const running = await capture('docker', ['ps', '--filter', 'label=com.docker.compose.project=campusworks-demo', '--filter', 'name=^/campusworks-demo-mongo-1$', '--format', '{{.ID}}']);
  mongoStarted = !running;
  await capture('docker', ['compose', '-p', 'campusworks-demo', '-f', 'docker-compose.yml', 'up', '-d', 'mongo-init']);
  databaseClient = new MongoClient(mongodbUri, { serverSelectionTimeoutMS: 5000 });
  await databaseClient.connect();
  const db = databaseClient.db(databaseName);
  // Reject existing or institutional data before any app maintenance can run.
  await loadShowcaseManifest(db, DEMO_CATALOG_VERSION);
  await startApp();
  const prepared = await prepareShowcase({ baseURL: origin, mongodbUri, database: db, resume: flags.has('--resume'), onProgress: message => process.stdout.write(`${message}\n`) });
  const windows = showcaseWindows(prepared.catalog, prepared.manifest);
  const collections = { people: 'users', courses: 'courses', opportunities: 'staffingOpportunities', applications: 'staffingApplications', offers: 'staffingOffers', appointments: 'staffingAppointments', workload: 'staffingWorkload', history: 'helpSessions', feedback: 'feedback', queue: 'queueEntries', notifications: 'staffingNotifications' };
  const counts = Object.fromEntries(await Promise.all(Object.entries(collections).map(async ([key, collection]) => [key, await db.collection(collection).countDocuments()])));
  const safeState = { origin, database: databaseName, launcherPid: process.pid, appPid: app.pid, referenceTime: prepared.manifest.referenceTime, readyAt: new Date().toISOString(), windows, counts };
  writeFileSync('.cache/showcase-state.json', JSON.stringify(safeState, null, 2));
  writeFileSync('.cache/showcase-windows.json', JSON.stringify(windows, null, 2));
  let provider = null;
  if (!flags.has('--no-ai') && (!flags.has('--prepare-only') || flags.has('--warm-ai'))) provider = await loadAiProviderConfig(confirmedProviderDefaults);
  if (provider) {
    await startApp(provider);
    safeState.appPid = app.pid; safeState.aiConfigured = true;
    writeFileSync('.cache/showcase-state.json', JSON.stringify(safeState, null, 2));
    if (flags.has('--warm-ai')) {
      const comparison = prepared.manifest.opportunityIds[prepared.catalog.featured.opportunityKey];
      const summary = prepared.manifest.applicationIds[`${prepared.catalog.featured.eligibleCandidateKeys[0]}--${prepared.catalog.featured.opportunityKey}`];
      const scopes = [{ kind: 'opportunity_draft', targetId: comparison }, { kind: 'candidate_fit', targetId: comparison, page: 1 }, { kind: 'cv_summary', targetId: summary }, { kind: 'term_review', targetId: prepared.manifest.courseIds[prepared.catalog.featured.courseKey], termId: prepared.manifest.termIds.current }];
      let ready = false;
      const reviewer = prepared.manifest.actors[prepared.catalog.featured.reviewerKey];
      const viewer = await request.newContext({ baseURL: origin, timeout: 5000 });
      try {
        const signedIn = await viewer.post('/api/auth/mock', { data: { as: reviewer.role, email: reviewer.email, name: reviewer.name } });
        if (!signedIn.ok()) throw new Error('The showcase reviewer could not sign in.');
        const currentResult = async scope => {
          const response = await viewer.get('/api/ai/tasks', { params: scope });
          if (!response.ok()) return null;
          const data = await response.json();
          // The protected read rechecks current evidence, permissions and fences.
          return data.tasks.find(task => task.automatic && task.status === 'completed' && !task.historical && (task.result || task.deterministic));
        };
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
          const results = await Promise.all(scopes.map(currentResult));
          ready = results.every(Boolean);
          if (ready && results[1].coverage?.hasMore) ready = !!await currentResult({ kind: 'candidate_fit', targetId: comparison, page: 2 });
          if (ready) break;
          await pause(500);
        }
      } finally { await viewer.dispose(); }
      safeState.featuredAiReady = ready;
      safeState.realAiRequestsReserved = (await db.collection('staffingAiBudgets').findOne({ _id: `global:${new Date().toISOString().slice(0, 10)}` }))?.requests || 0;
      writeFileSync('.cache/showcase-state.json', JSON.stringify(safeState, null, 2));
      process.stdout.write(ready ? 'Featured automatic AI guidance is ready.\n' : 'Featured AI guidance is not current; inspect the cycle, authority and provider budget.\n');
    }
  }
  process.stdout.write(`Showcase ready at ${origin}: ${safeState.counts.courses} courses, ${safeState.counts.opportunities} positions and ${safeState.counts.applications} applications.\n`);
  if (flags.has('--serve-only')) {
    await new Promise(done => {
      const close = message => {
        if (message?.command !== 'close-showcase') return;
        process.off('message', close);
        if (process.connected) process.disconnect();
        done();
      };
      process.on('message', close);
    });
  } else if (!flags.has('--prepare-only')) {
    const browser = spawn(process.execPath, ['scripts/demo-windows.mjs'], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, BASE_URL: origin, DEMO_LAYOUT: 'showcase', SHOWCASE_WINDOWS_FILE: resolve('.cache/showcase-windows.json') } });
    children.add(browser);
    writeFileSync('.cache/showcase-state.json', JSON.stringify({ ...safeState, windowPid: browser.pid }, null, 2));
    await new Promise((done, reject) => { browser.once('error', reject); browser.once('exit', code => code === 0 ? done() : reject(new Error('The showcase windows did not open.'))); });
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error && !/key|token|password|mongodb:\/\//i.test(error.message) ? error.message : 'The local showcase could not start; check its private configuration.'}\n`);
  process.exitCode = 1;
} finally {
  const result = await cleanup();
  if (!result.complete) { process.stderr.write('Showcase cleanup is incomplete; an owned service may still be running.\n'); process.exitCode = 1; }
}
