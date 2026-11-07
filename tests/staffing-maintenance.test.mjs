import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const path = 'server/utils/staffing-maintenance.ts';
const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const source = parsed.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness(appointments = [], outbox = [], signal) {
  let clock = 100000;
  let control;
  const calls = [];
  const copy = value => structuredClone(value);
  const matches = filter => control && Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$lte' in expected) return control[key] <= expected.$lte;
    if (expected && typeof expected === 'object' && '$gt' in expected) return control[key] > expected.$gt;
    return control[key] === expected;
  });
  const apply = (update, inserted = false) => {
    if (inserted) Object.assign(control, copy(update.$setOnInsert || {}));
    Object.assign(control, copy(update.$set || {}));
    for (const [key, value] of Object.entries(update.$inc || {})) control[key] = (control[key] || 0) + value;
    for (const key of Object.keys(update.$unset || {})) delete control[key];
  };
  const collection = {
    async updateOne(filter, update, options = {}) {
      if (!control && options.upsert) { control = { _id: filter._id }; apply(update, true); return { matchedCount: 0, upsertedCount: 1 }; }
      if (!matches(filter)) return { matchedCount: 0 };
      apply(update); return { matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      if (!matches(filter)) return null;
      apply(update); return copy(control);
    },
  };
  const db = { collection(name) { assert.equal(name, 'staffingMaintenanceControl'); return collection; } };
  class ClockDate extends Date {
    constructor(value) { super(value === undefined ? clock : value); }
    static now() { return clock; }
  }
  const operation = (name, results) => async () => {
    calls.push(name);
    const result = results.shift() ?? false;
    if (typeof result === 'function') return result();
    if (result instanceof Error) throw result;
    return { hasMore: result };
  };
  const run = new Function('randomUUID', 'performance', 'reconcileDueStaffing', 'processStaffingOutbox', 'process', 'Date', `${javascript}\nreturn runStaffingMaintenance;`)(
    randomUUID, { now: () => clock }, operation('appointments', appointments), operation('outbox', outbox),
    { env: { STAFFING_MAINTENANCE_MAX_BATCHES: '1', STAFFING_MAINTENANCE_INTERVAL_MS: '5000' } }, ClockDate,
  );
  return { calls, run: () => run(db, signal), advance(ms) { clock += ms; }, get now() { return clock; }, get control() { return copy(control); } };
}

test('one-batch maintenance returns to the idle interval after both lanes are empty', async () => {
  const state = harness();
  assert.equal((await state.run()).hasMore, true);
  state.advance(250);
  assert.equal((await state.run()).hasMore, false);
  assert.deepEqual(state.calls, ['appointments', 'outbox']);
  assert.equal(state.control.nextAttemptAt.getTime() - state.now, 5000);
  for (let interval = 0; interval < 19; interval++) {
    state.advance(250);
    assert.equal((await state.run()).acquired, false);
  }
  assert.equal(state.calls.length, 2);
  state.advance(250);
  assert.equal((await state.run()).acquired, true);
  assert.deepEqual(state.calls, ['appointments', 'outbox', 'appointments']);
});

test('one busy lane does not prevent discovery of new work in the previously empty lane', async () => {
  const state = harness([true, true, false], [false, true, false]);
  for (let batch = 0; batch < 6; batch++) {
    assert.equal((await state.run()).hasMore, batch < 5);
    state.advance(250);
  }
  assert.deepEqual(state.calls, ['appointments', 'outbox', 'appointments', 'outbox', 'appointments', 'outbox']);
  assert.equal((await state.run()).acquired, false);
});

test('shutdown completes its current batch without starting the other lane', async () => {
  const shutdown = new AbortController();
  const state = harness([() => { shutdown.abort(); return { hasMore: true }; }], [true], shutdown.signal);
  await state.run();
  assert.deepEqual(state.calls, ['appointments']);
  assert.equal(state.control.leaseToken, undefined);
  assert.equal(state.control.status, 'stopped');
  assert.equal((await state.run()).acquired, false);
});

test('maintenance failures persist increasing retry delays while alternating lanes', async () => {
  const state = harness([new Error('Synthetic appointment failure')], [new Error('Synthetic notification failure')]);
  assert.equal((await state.run()).hasMore, false);
  assert.equal(state.control.nextAttemptAt.getTime() - state.now, 5000);
  assert.equal((await state.run()).acquired, false);
  state.advance(5000);
  assert.equal((await state.run()).hasMore, false);
  assert.equal(state.control.nextAttemptAt.getTime() - state.now, 10000);
  assert.deepEqual(state.calls, ['appointments', 'outbox']);
});
