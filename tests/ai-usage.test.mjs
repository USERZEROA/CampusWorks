import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const usageFile = ts.createSourceFile('server/utils/ai-usage.ts', readFileSync('server/utils/ai-usage.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const aiFile = ts.createSourceFile('server/utils/ai.ts', readFileSync('server/utils/ai.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const quotaNames = ['limit', 'quotaError', 'reserveAiBudget', 'confirmAiLease'];
const quotas = aiFile.statements.filter(node => ts.isFunctionDeclaration(node) && quotaNames.includes(node.name?.text));
assert.equal(quotas.length, quotaNames.length, 'Exercise the actual reservation and lease functions.');
const usage = usageFile.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(usageFile).replace(/^export\s+/, '')).join('\n');
let importCount = 0;
const quota = quotas.map(node => node.getText(aiFile)).join('\n').replace(/await import\((['"])\.\/db\1\)/g, () => { importCount++; return 'await loadDb()'; });
assert.equal(importCount, 1, 'Only the database loader is replaced by a local transaction harness.');
const javascript = ts.transpileModule(`${usage}\n${quota}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// This harness verifies routing, quota boundaries and transaction/session use.
// MongoDB concurrency is exercised separately by the integration suite.
function databaseHarness() {
  const databases = new Map();
  const calls = [];
  const client = { db: name => database(name) };
  function database(name) {
    if (databases.has(name)) return databases.get(name).db;
    const collections = new Map();
    const db = { databaseName: name, client, collection: collectionName => {
      if (collections.has(collectionName)) return collections.get(collectionName).api;
      const rows = new Map();
      const apply = (row, update, lease) => {
        for (const [key, value] of Object.entries(update.$set || {})) {
          if (key === 'leases.$.expiresAt') lease.expiresAt = structuredClone(value);
          else row[key] = structuredClone(value);
        }
        for (const [key, amount] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + amount;
        if (update.$pull?.leases) row.leases = row.leases.filter(item => item.taskId !== update.$pull.leases.taskId);
      };
      const api = {
        findOneAndUpdate: async (filter, update, options = {}) => {
          calls.push({ database: name, collectionName, filter: structuredClone(filter), options });
          let row = rows.get(filter._id);
          if (!row && options.upsert) { row = { _id: filter._id, ...structuredClone(update.$setOnInsert || {}) }; rows.set(filter._id, row); }
          const match = filter.leases?.$elemMatch;
          const lease = match ? row?.leases?.find(item => item.taskId === match.taskId && item.expiresAt > match.expiresAt.$gt) : undefined;
          if (!row || (match && !lease)) return null;
          apply(row, update, lease);
          return structuredClone(row);
        },
        updateOne: async (filter, update, options = {}) => {
          calls.push({ database: name, collectionName, filter: structuredClone(filter), options });
          const row = rows.get(filter._id);
          if (!row) return { matchedCount: 0 };
          apply(row, update);
          return { matchedCount: 1 };
        },
      };
      collections.set(collectionName, { rows, api });
      return api;
    } };
    databases.set(name, { db, collections });
    return db;
  }
  const session = { synthetic: 'same-client-transaction' };
  function runtime(name, environment = {}) {
    const db = database(name);
    const loadDb = async () => ({ withTransaction: async work => {
      const saved = [...databases.values()].flatMap(value => [...value.collections.values()].map(collection => ({ collection, rows: structuredClone(collection.rows) })));
      try { return await work(db, session); }
      catch (error) {
        for (const value of databases.values()) for (const collection of value.collections.values()) collection.rows.clear();
        for (const { collection, rows } of saved) { collection.rows.clear(); for (const [key, value] of rows) collection.rows.set(key, value); }
        throw error;
      }
    } });
    return { db, actual: new Function('createHash', 'process', 'loadDb', `${javascript}\nreturn { aiUsageActorKey, aiUsageCollection, reserveAiBudget, confirmAiLease };`)(createHash, { env: { ...environment } }, loadDb) };
  }
  const rows = (name) => { database(name).collection('staffingAiBudgets'); return databases.get(name).collections.get('staffingAiBudgets').rows; };
  const release = (actual, db, taskId) => actual.aiUsageCollection(db).updateOne({ _id: 'concurrency' }, { $pull: { leases: { taskId } } });
  return { database, runtime, rows, calls, session, release };
}
const actor = (extra = {}) => ({ id: 'synthetic-account-a', email: 'reviewer@example.com', provider: 'gitlab', ...extra });

test('default usage remains in the application database with the existing account key', () => {
  for (const value of [undefined, '', ' ']) {
    const setup = databaseHarness();
    const { db, actual } = setup.runtime('application', { AI_USAGE_DATABASE: value });
    assert.strictEqual(actual.aiUsageCollection(db), db.collection('staffingAiBudgets'));
    assert.equal(actual.aiUsageActorKey(actor()), 'synthetic-account-a');
    assert.equal(actual.aiUsageActorKey(actor({ id: undefined })), 'reviewer@example.com');
  }
});

test('shared usage uses the same Mongo client and a stable provider/email hash across account resets', () => {
  const setup = databaseHarness();
  const first = setup.runtime('cycle_one', { AI_USAGE_DATABASE: ' shared_usage ' });
  const second = setup.runtime('cycle_two', { AI_USAGE_DATABASE: 'shared_usage' });
  assert.strictEqual(first.actual.aiUsageCollection(first.db), second.actual.aiUsageCollection(second.db));
  assert.strictEqual(first.actual.aiUsageCollection(first.db), setup.database('shared_usage').collection('staffingAiBudgets'));
  assert.strictEqual(first.db.client, setup.database('shared_usage').client);
  const key = first.actual.aiUsageActorKey(actor());
  assert.match(key, /^shared:[a-f0-9]{64}$/);
  assert.equal(second.actual.aiUsageActorKey(actor({ id: 'new-account-after-reset', email: ' Reviewer@Example.COM ' })), key);
  assert.notEqual(first.actual.aiUsageActorKey(actor({ provider: 'mock' })), key);
  assert.notEqual(first.actual.aiUsageActorKey(actor({ email: 'other@example.com' })), key);
  assert.equal(key.includes('reviewer'), false);
  assert.equal(key.includes('synthetic-account'), false);
});

test('invalid or reserved usage databases fail closed before any collection operation', () => {
  for (const value of ['admin', 'ADMIN', 'Config', 'LOCAL', '_usage', '1usage', 'usage.name', 'usage/name', 'usage\\name', 'usage name', 'a'.repeat(64), 'usage\0hidden']) {
    const setup = databaseHarness();
    const { db, actual } = setup.runtime('application', { AI_USAGE_DATABASE: value });
    assert.throws(() => actual.aiUsageCollection(db), /configuration is invalid/, value);
    assert.equal(setup.calls.length, 0);
  }
  for (const value of ['Usage_2026', 'a'.repeat(63)]) {
    const setup = databaseHarness();
    const { db, actual } = setup.runtime('application', { AI_USAGE_DATABASE: value });
    assert.strictEqual(actual.aiUsageCollection(db), setup.database(value).collection('staffingAiBudgets'));
  }
});

test('default per-user request limit remains twenty and refusal preserves reserved counters', async () => {
  const setup = databaseHarness();
  const { db, actual } = setup.runtime('application');
  for (let index = 0; index < 20; index++) {
    await actual.reserveAiBudget(actor(), `task-${index}`, 100);
    await setup.release(actual, db, `task-${index}`);
  }
  await assert.rejects(actual.reserveAiBudget(actor(), 'one-too-many', 100), error => error.statusCode === 429 && error.quotaCode === 'daily');
  const counters = [...setup.rows('application').values()].filter(row => row.requests !== undefined);
  assert.deepEqual(counters.map(row => [row.requests, row.reservedTokens]), [[20, 2000], [20, 2000]]);
  assert.deepEqual(setup.rows('application').get('concurrency').leases, []);
});

test('default per-user token limit accepts the boundary and rejects the next reservation', async () => {
  const setup = databaseHarness();
  const { db, actual } = setup.runtime('application');
  await actual.reserveAiBudget(actor(), 'at-boundary', 100000);
  await setup.release(actual, db, 'at-boundary');
  await assert.rejects(actual.reserveAiBudget(actor(), 'over-boundary', 1), error => error.quotaCode === 'daily');
  assert.ok([...setup.rows('application').values()].filter(row => row.requests !== undefined).every(row => row.requests === 1 && row.reservedTokens === 100000));
});

test('default global request and token limits remain shared across distinct reviewers', async () => {
  for (const [mode, requests, tokens] of [['requests', 200, 1], ['tokens', 10, 100000]]) {
    const setup = databaseHarness();
    const { db, actual } = setup.runtime('application');
    for (let index = 0; index < requests; index++) {
      await actual.reserveAiBudget(actor({ id: `reviewer-${index}`, email: `reviewer-${index}@example.com` }), `task-${index}`, tokens);
      await setup.release(actual, db, `task-${index}`);
    }
    await assert.rejects(actual.reserveAiBudget(actor({ id: 'new-reviewer' }), 'over-global', mode === 'tokens' ? 1 : tokens), error => error.quotaCode === 'daily');
    const global = [...setup.rows('application').values()].find(row => row._id.startsWith('global:'));
    assert.equal(global.requests, requests);
    assert.equal(global.reservedTokens, requests * tokens);
  }
});

test('shared daily reservations survive disposable database and account-ID changes', async () => {
  const setup = databaseHarness();
  const env = { AI_USAGE_DATABASE: 'persistent_usage', AI_DAILY_REQUEST_LIMIT: '1' };
  const first = setup.runtime('presentation_one', env);
  await first.actual.reserveAiBudget(actor(), 'first-cycle', 100);
  await setup.release(first.actual, first.db, 'first-cycle');
  const second = setup.runtime('presentation_two', env);
  await assert.rejects(second.actual.reserveAiBudget(actor({ id: 'new-cycle-user' }), 'second-cycle', 100), error => error.quotaCode === 'daily');
  assert.equal(setup.rows('presentation_one').size, 0);
  assert.equal(setup.rows('presentation_two').size, 0);
  const own = [...setup.rows('persistent_usage').values()].find(row => row._id.startsWith('user:'));
  assert.equal(own.requests, 1);
  assert.equal(own.reservedTokens, 100);
  const reservationCalls = setup.calls.filter(call => call.database === 'persistent_usage' && call.options.session);
  assert.ok(reservationCalls.length >= 6);
  assert.ok(reservationCalls.every(call => call.options.session === setup.session));
});

test('shared concurrency and lease renewal fence independent application databases', async () => {
  const setup = databaseHarness();
  const env = { AI_USAGE_DATABASE: 'persistent_usage' };
  const first = setup.runtime('presentation_one', env);
  const second = setup.runtime('presentation_two', env);
  await first.actual.reserveAiBudget(actor(), 'first-slot', 100);
  await second.actual.reserveAiBudget(actor({ id: 'other', email: 'other@example.com' }), 'second-slot', 100);
  await assert.rejects(first.actual.reserveAiBudget(actor(), 'third-slot', 100), error => error.quotaCode === 'concurrency');
  await second.actual.confirmAiLease(second.db, 'first-slot');
  await assert.rejects(second.actual.confirmAiLease(second.db, 'missing-slot'), error => error.quotaCode === 'concurrency');
  await setup.release(first.actual, first.db, 'first-slot');
  await assert.rejects(second.actual.confirmAiLease(second.db, 'first-slot'), error => error.quotaCode === 'concurrency');
  setup.rows('persistent_usage').get('concurrency').leases[0].expiresAt = new Date(0);
  await first.actual.reserveAiBudget(actor(), 'reclaimed-slot', 100);
  assert.deepEqual(setup.rows('persistent_usage').get('concurrency').leases.map(lease => lease.taskId), ['reclaimed-slot']);
});
