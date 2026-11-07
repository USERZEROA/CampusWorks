import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const path = 'server/utils/ai-automation.ts';
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'discover');
assert.ok(declaration, 'The actual discovery function must exist.');
const javascript = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness({ due = [], hintsAvailable = true, failFirstHint = false, hintNext = true } = {}) {
  const seen = [];
  const deletions = [];
  const pending = [...due];
  const control = { _id: 'discovery', nextAttemptAt: new Date(0), leaseUntil: new Date(0), state: { phase: 5, hintNext, cursors: {}, cycleTermId: 'synthetic-term', eventTime: new Date(0), eventId: '', reportTerm: '', reportCourse: '' } };
  let batch = 1;
  let leases = 0;
  const controls = {
    updateOne: async (filter, update) => {
      if (filter.leaseToken && filter.leaseToken !== control.leaseToken) return { matchedCount: 0 };
      if (update.$set) Object.assign(control, structuredClone(update.$set));
      for (const key of Object.keys(update.$unset || {})) delete control[key];
      return { matchedCount: 1 };
    },
    findOneAndUpdate: async (_filter, update) => { Object.assign(control, structuredClone(update.$set)); return structuredClone(control); },
  };
  const hintRows = {
    findOne: async () => hintsAvailable ? { _id: 'continuous-backfill', kind: 'candidate_fit', targetId: 'backfill', termId: '', page: 1, pageSize: 10, generation: 7 } : null,
    deleteOne: async filter => { deletions.push(filter); return { deletedCount: 1 }; },
  };
  const jobRows = {
    findOne: async filter => filter.nextObserveAt ? pending[0] || null : null,
    updateOne: async () => ({ matchedCount: 1 }),
  };
  const database = { collection: name => name === 'staffingAiAutomationControl' ? controls : { findOne: async () => null } };
  const observeScope = async (_database, scope) => {
    if (scope._id === 'continuous-backfill') {
      seen.push('hint');
      if (failFirstHint) { failFirstHint = false; throw new Error('synthetic_observation_failure'); }
    } else { seen.push(scope.targetId); pending.shift(); }
    return { inputHash: 'synthetic-input' };
  };
  const dependencies = { performance, randomUUID: () => `synthetic-lease-${++leases}`, jobs: () => jobRows, hints: () => hintRows, observeScope, automaticScopeId: scope => scope.targetId, automaticCandidatePageSize: () => 10, getRecruitmentCycle: async () => ({ termId: 'synthetic-term', canReview: true }), boundedSetting: name => name === 'AI_AUTO_DISCOVERY_BATCH_SIZE' ? batch : name === 'AI_AUTO_DISCOVERY_WORK_MS' ? 5000 : 50 };
  const discover = new Function(...Object.keys(dependencies), `${javascript}\nreturn discover;`)(...Object.values(dependencies));
  return { seen, deletions, control, run: async count => { batch = count; control.nextAttemptAt = new Date(0); await discover(database); } };
}

const dueScope = (targetId, kind) => ({ _id: targetId, targetId, kind, termId: kind === 'term_review' ? 'synthetic-term' : '', page: 1, pageSize: 10, requestedBy: 'synthetic-faculty', nextObserveAt: new Date(0) });

test('continuous backfill hints leave observation turns for existing candidate and final-report scopes', async () => {
  const run = harness({ due: [dueScope('changed-candidate', 'candidate_fit'), dueScope('final-course', 'term_review')] });
  await run.run(22);
  assert.deepEqual(run.seen, ['hint', 'changed-candidate', 'hint', 'final-course']);
  assert.ok(run.deletions.every(filter => filter.generation === 7));
});

test('a separate discovery invocation resumes the persisted hint-versus-due turn', async () => {
  const run = harness({ due: [dueScope('existing-candidate', 'candidate_fit')] });
  await run.run(1);
  assert.equal(run.control.state.hintNext, false);
  assert.equal(run.control.state.phase, 6);
  await run.run(7);
  assert.deepEqual(run.seen, ['hint', 'existing-candidate']);
});

test('a failed hint cannot keep retrying ahead of a due final course', async () => {
  const run = harness({ due: [dueScope('final-course', 'term_review')], failFirstHint: true });
  await assert.rejects(run.run(1), /synthetic_observation_failure/);
  assert.equal(run.control.state.hintNext, false);
  assert.equal(run.deletions.length, 0);
  await run.run(1);
  assert.deepEqual(run.seen, ['hint', 'final-course']);
});

test('an empty preferred lane falls back to available work and keeps the hint generation fence', async () => {
  const noHints = harness({ due: [dueScope('due-candidate', 'candidate_fit')], hintsAvailable: false });
  await noHints.run(1);
  assert.deepEqual(noHints.seen, ['due-candidate']);
  const noDue = harness({ hintNext: false });
  await noDue.run(1);
  assert.deepEqual(noDue.seen, ['hint']);
  assert.deepEqual(noDue.deletions, [{ _id: 'continuous-backfill', generation: 7 }]);
});
