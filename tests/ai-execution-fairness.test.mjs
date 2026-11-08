import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file = ts.createSourceFile('server/utils/ai-automation.ts', readFileSync('server/utils/ai-automation.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['claimAutomaticJob', 'executeOne'];
const declarations = file.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(declarations.length, names.length, 'Exercise the actual claim and execution functions.');
const javascript = ts.transpileModule(declarations.map(node => node.getText(file)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const kinds = ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review'];
const job = (kind, id = kind, extra = {}) => ({ _id: id, kind, targetId: id, generation: 3, inputHash: `evidence-${id}`, status: 'queued', nextAttemptAt: new Date(0), priority: 100 - kinds.indexOf(kind) * 25, requestedBy: 'synthetic-faculty', attempts: 0, fence: 0, ...extra });
const equal = (actual, expected) => actual instanceof Date || expected instanceof Date ? new Date(actual).getTime() === new Date(expected).getTime() : actual === expected;
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(branch => matches(row, branch));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([operator, operand]) => ({
      $in: () => operand.includes(actual), $lte: () => actual <= operand, $gt: () => actual > operand,
    })[operator]?.() ?? false);
    return equal(actual, value);
  });
}
function first(rows, filter, sort = {}) {
  return rows.filter(row => matches(row, filter)).sort((left, right) => {
    for (const [key, direction] of Object.entries(sort)) {
      if (equal(left[key], right[key])) continue;
      return (left[key] < right[key] ? -1 : 1) * direction;
    }
    return 0;
  })[0] || null;
}
function apply(row, update) {
  Object.assign(row, structuredClone(update.$set || {}));
  for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const key of Object.keys(update.$unset || {})) delete row[key];
}

// This harness exercises source-level scheduling and fences. Real MongoDB
// transaction contention is verified separately with independent clients.
function harness({ rows = [], control, initializationError, concurrentControl, failProviderOnce = false, capacity = 0, mutateBeforeClaim } = {}) {
  const records = new Map(rows.map(row => [row._id, structuredClone(row)]));
  const controls = new Map(control ? [['execution', { _id: 'execution', ...control }]] : []);
  const tasks = new Map();
  const calls = [], claimFilters = [];
  let nextId = 0, transactions = 0, activeTransactions = 0;
  const controlCollection = {
    findOne: async filter => structuredClone(controls.get(filter._id) || null),
    updateOne: async (filter, update, options = {}) => {
      if (!options.session && initializationError) {
        const error = initializationError; initializationError = null;
        if (concurrentControl) controls.set('execution', { _id: 'execution', ...concurrentControl });
        throw error;
      }
      let row = controls.get(filter._id);
      if (!row && options.upsert) { row = { _id: filter._id, ...structuredClone(update.$setOnInsert) }; controls.set(filter._id, row); }
      if (row) apply(row, update);
      return { matchedCount: row ? 1 : 0 };
    },
  };
  const jobCollection = {
    findOne: async (filter, options = {}) => structuredClone(first([...records.values()], filter, options.sort)),
    findOneAndUpdate: async (filter, update) => {
      if (filter.generation !== undefined) {
        claimFilters.push(structuredClone(filter));
        if (mutateBeforeClaim) { const mutate = mutateBeforeClaim; mutateBeforeClaim = null; mutate(records); }
      }
      const row = first([...records.values()], filter);
      if (!row) return null;
      apply(row, update);
      return structuredClone(row);
    },
    updateOne: async (filter, update) => { const row = first([...records.values()], filter); if (row) apply(row, update); return { matchedCount: row ? 1 : 0 }; },
  };
  const taskCollection = {
    findOne: async filter => structuredClone(first([...tasks.values()], filter)),
    updateOne: async (filter, update, options = {}) => {
      let row = tasks.get(filter.id);
      if (!row && options.upsert) { row = { id: filter.id }; tasks.set(filter.id, row); }
      if (row) apply(row, update);
      return { matchedCount: row ? 1 : 0 };
    },
  };
  const db = { collection: name => ({
    staffingAiAutomationControl: controlCollection,
    staffingAiAutomationJobs: jobCollection,
    staffingAiTasks: taskCollection,
    staffingAiAutomationCache: { updateOne: async () => {} },
    staffingAiBudgets: { findOne: async () => ({ leases: Array.from({ length: capacity }, () => ({ expiresAt: new Date(Date.now() + 60000) })) }) },
  })[name] };
  const dependencies = {
    aiUsageCollection: db => db.collection('staffingAiBudgets'),
    jobs: () => jobCollection, randomUUID: () => `synthetic-token-${++nextId}`, boundedSetting: (_name, fallback) => fallback,
    withTransaction: async work => { transactions++; activeTransactions++; try { return await work(db, { synthetic: true }); } finally { activeTransactions--; } },
    scopeActor: async () => { assert.equal(activeTransactions, 0); return { id: 'synthetic-faculty' }; },
    aiTaskFingerprint: async (_db, _actor, scope) => { assert.equal(activeTransactions, 0); return { inputHash: scope.inputHash }; },
    actorId: actor => actor.id,
    fail: (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); },
    createAiTask: async (_db, _actor, scope) => {
      assert.equal(activeTransactions, 0, 'Provider work must remain outside the claim transaction.');
      calls.push(scope.kind);
      if (failProviderOnce) { failProviderOnce = false; throw new Error('synthetic-provider-failure'); }
      tasks.set(scope.taskId, { id: scope.taskId, inputHash: scope.inputHash, status: 'completed', result: { synthetic: true }, completedAt: new Date() });
    },
  };
  const actual = new Function(...Object.keys(dependencies), `${javascript}\nreturn {claimAutomaticJob, executeOne};`)(...Object.values(dependencies));
  return { records, controls, tasks, calls, claimFilters, transactions: () => transactions,
    claim: allowedIds => actual.claimAutomaticJob(db, allowedIds), run: allowedIds => actual.executeOne(db, undefined, allowedIds),
    restart: () => new Function(...Object.keys(dependencies), `${javascript}\nreturn claimAutomaticJob;`)(...Object.values(dependencies))(db),
  };
}

test('continuous candidate work cannot postpone an existing due summary, requirements or course review', async () => {
  const setup = harness({ rows: kinds.map(kind => job(kind)) });
  const claimed = [];
  for (let turn = 0; turn < 12; turn++) {
    const current = await setup.claim();
    claimed.push(current.kind);
    const candidate = setup.records.get('candidate_fit');
    Object.assign(candidate, { status: 'queued', nextAttemptAt: new Date(0), generation: candidate.generation + 1 });
  }
  assert.deepEqual(claimed.slice(0, 4), kinds);
  assert.ok(claimed.slice(4).every(kind => kind === 'candidate_fit'));
});

test('the execution turn persists across callers and normalizes missing or invalid legacy cursors', async () => {
  for (const nextKind of [undefined, -1, 99, '2']) {
    const setup = harness({ rows: kinds.map(kind => job(kind)), control: { nextKind } });
    assert.equal((await setup.claim()).kind, 'candidate_fit');
    assert.equal(setup.controls.get('execution').nextKind, 1);
    assert.equal((await setup.restart()).kind, 'cv_summary');
    assert.equal(setup.controls.get('execution').nextKind, 2);
  }
});

test('empty kinds are skipped and the same kind is claimed by retry date then id rather than priority', async () => {
  const setup = harness({ control: { nextKind: 2 }, rows: [
    job('cv_summary', 'b', { nextAttemptAt: new Date(1), priority: 100 }),
    job('cv_summary', 'a', { nextAttemptAt: new Date(1), priority: 1 }),
    job('cv_summary', 'c', { nextAttemptAt: new Date(0), priority: 0 }),
  ] });
  assert.deepEqual([(await setup.claim())._id, (await setup.claim())._id, (await setup.claim())._id], ['c', 'a', 'b']);
  assert.equal(setup.controls.get('execution').nextKind, 2);
});

test('future retries and live leases remain untouched while an expired running generation is fenced and reclaimed', async () => {
  const future = new Date(Date.now() + 60000);
  const rows = [
    job('candidate_fit', 'future-retry', { nextAttemptAt: future }),
    job('candidate_fit', 'live-lease', { status: 'running', leaseUntil: future, leaseToken: 'live-token' }),
    ...['idle', 'ended', 'revoked'].map(status => job('candidate_fit', status, { status })),
    job('cv_summary', 'expired', { status: 'running', leaseUntil: new Date(0), leaseToken: 'expired-token', nextAttemptAt: future, generation: 7, runningGeneration: 6, runningInputHash: 'old-evidence', fence: 4 }),
  ];
  const setup = harness({ rows });
  const claimed = await setup.claim();
  assert.equal(claimed._id, 'expired');
  assert.equal(claimed.generation, 7);
  assert.equal(claimed.runningGeneration, 7);
  assert.equal(claimed.runningInputHash, claimed.inputHash);
  assert.equal(claimed.fence, 5);
  assert.notEqual(claimed.leaseToken, 'expired-token');
  assert.ok(claimed.leaseUntil > new Date());
  assert.deepEqual(claimed.nextAttemptAt, future, 'Claiming does not rewrite execution backoff.');
  for (const row of rows.filter(row => row._id !== 'expired')) assert.deepEqual(setup.records.get(row._id), row);
  assert.ok(setup.claimFilters[0].$or, 'The write repeats due status and lease eligibility.');
  assert.equal(setup.claimFilters[0].generation, 7);
});

test('provider failure keeps retry backoff and releases its lease without taking the next kind turn', async () => {
  const setup = harness({ rows: kinds.map(kind => job(kind)), failProviderOnce: true });
  await setup.run();
  const failed = setup.records.get('candidate_fit');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 1);
  assert.ok(failed.nextAttemptAt > new Date());
  assert.equal(failed.leaseToken, undefined);
  assert.equal(failed.leaseUntil, undefined);
  assert.equal(setup.controls.get('execution').nextKind, 1);
  await setup.run();
  assert.deepEqual(setup.calls, ['candidate_fit', 'cv_summary']);
  assert.equal(setup.records.get('cv_summary').status, 'idle');
  assert.equal(setup.controls.get('execution').nextKind, 2);
});

test('an empty execution queue does not advance a saved turn', async () => {
  const setup = harness({ control: { nextKind: 3 } });
  assert.equal(await setup.claim(), null);
  assert.equal(setup.controls.get('execution').nextKind, 3);
  assert.equal(setup.controls.get('execution').updatedAt, undefined);
});

test('concurrent first initialization accepts only a visible execution control after a duplicate-key collision', async () => {
  const collision = () => Object.assign(new Error('synthetic-initialization-collision'), { code: 11000 });
  const setup = harness({ rows: kinds.map(kind => job(kind)), initializationError: collision(), concurrentControl: { nextKind: 2 } });
  assert.equal((await setup.claim()).kind, 'opportunity_draft');
  assert.equal(setup.controls.get('execution').nextKind, 3);
  const missing = harness({ initializationError: collision() });
  await assert.rejects(missing.claim(), error => error.code === 11000);
  assert.equal(missing.transactions(), 0);
  const unavailable = harness({ initializationError: Object.assign(new Error('unavailable'), { code: 91 }) });
  await assert.rejects(unavailable.claim(), error => error.code === 91);
  assert.equal(unavailable.transactions(), 0);
});

test('a changed pending generation cannot be claimed or advance that kind ahead of another due task', async () => {
  const setup = harness({ rows: kinds.map(kind => job(kind)), mutateBeforeClaim: records => { records.get('candidate_fit').generation++; } });
  assert.equal((await setup.claim()).kind, 'cv_summary');
  assert.equal(setup.records.get('candidate_fit').status, 'queued');
  assert.equal(setup.records.get('candidate_fit').leaseToken, undefined);
  assert.equal(setup.controls.get('execution').nextKind, 2);
});

test('the default two occupied provider slots prevent claims without initializing or advancing execution state', async () => {
  const setup = harness({ rows: kinds.map(kind => job(kind)), capacity: 2 });
  await setup.run();
  assert.equal(setup.controls.size, 0);
  assert.equal(setup.transactions(), 0);
  assert.equal(setup.calls.length, 0);
  assert.ok([...setup.records.values()].every(row => row.status === 'queued'));
});

test('an explicit empty scope cannot claim queued work or call the provider', async () => {
  const setup = harness({ rows: kinds.map(kind => job(kind)) });
  assert.equal(await setup.claim([]), null);
  await setup.run([]);
  assert.deepEqual(setup.calls, []);
  assert.ok([...setup.records.values()].every(row => row.status === 'queued'));
});

test('selected scope claims skip earlier kinds and leave every excluded job unchanged', async () => {
  const rows = kinds.map(kind => job(kind));
  const setup = harness({ rows });
  await setup.run(['term_review']);
  assert.deepEqual(setup.calls, ['term_review']);
  assert.equal(setup.records.get('term_review').status, 'idle');
  for (const row of rows.filter(row => row.kind !== 'term_review'))
    assert.deepEqual(setup.records.get(row._id), row);
  assert.equal(await setup.claim(['missing']), null);
});
