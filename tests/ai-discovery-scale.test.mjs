import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file = ts.createSourceFile('server/utils/ai-automation.ts', readFileSync('server/utils/ai-automation.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['hint', 'discover', 'scope', 'priorities'];
const source = file.statements.filter(node => (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(file)))))
  .map(node => node.getText(file)).join('\n');
assert.ok(names.every(name => source.includes(name)));
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const idOf = scope => `${scope.kind}:${scope.targetId}:${scope.termId || ''}:${scope.page || 1}`;
const coordinate = (kind, targetId, page = 1) => ({ kind, targetId, termId: kind === 'term_review' ? 'current' : '', page, pageSize: kind === 'candidate_fit' ? 10 : 50 });
const same = (actual, expected) => actual instanceof Date || expected instanceof Date ? new Date(actual).getTime() === new Date(expected).getTime() : actual === expected;
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(value => matches(row, value));
    if (key === '$and') return expected.every(value => matches(row, value));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) return Object.entries(expected).every(([operator, operand]) => ({
      $gt: () => actual > operand, $gte: () => actual >= operand, $lt: () => actual < operand, $lte: () => actual <= operand,
      $exists: () => (actual !== undefined) === operand, $in: () => operand.includes(actual), $nin: () => !operand.includes(actual), $ne: () => !same(actual, operand),
    })[operator]?.() ?? false);
    return same(actual, expected);
  });
}
function first(rows, filter, sort = {}) {
  return rows.filter(row => matches(row, filter)).sort((left, right) => {
    for (const [key, direction] of Object.entries(sort)) {
      if (same(left[key], right[key])) continue;
      return (left[key] < right[key] ? -1 : 1) * direction;
    }
    return 0;
  })[0] || null;
}
const apply = (row, update) => {
  Object.assign(row, structuredClone(update.$set || {}));
  for (const [key, delta] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + delta;
  for (const key of Object.keys(update.$unset || {})) delete row[key];
};

function harness({ phase = 5, rows = {}, pending = [], due = [], continuousCandidate = false, failOnce = false, observationCost = 0 } = {}) {
  const jobs = new Map(due.map(row => [idOf(row), { _id: idOf(row), ...row }]));
  const hintRows = new Map(pending.map((row, index) => [idOf(row), { _id: idOf(row), ...row, generation: 7, nextAttemptAt: new Date(0), createdAt: new Date(index) }]));
  if (continuousCandidate) {
    const row = coordinate('candidate_fit', 'continuous-candidate');
    hintRows.set(idOf(row), { _id: idOf(row), ...row, generation: 7, nextAttemptAt: new Date(0), createdAt: new Date(0) });
  }
  const observed = [], deleted = [];
  let clock = 0, batch = 12, leaseNumber = 0;
  const control = { _id: 'discovery', leaseUntil: new Date(0), nextAttemptAt: new Date(0), state: { phase, cursors: {}, cycleTermId: 'current', hintNext: true, hintKind: 0, eventTime: new Date(0), eventId: '', reportTerm: '', reportCourse: '' } };
  const controlCollection = {
    findOneAndUpdate: async (_query, update) => { apply(control, update); return structuredClone(control); },
    updateOne: async (query, update) => {
      if (query.leaseToken && query.leaseToken !== control.leaseToken) return { matchedCount: 0 };
      apply(control, update); return { matchedCount: 1 };
    },
  };
  const jobCollection = {
    findOne: async (filter, options = {}) => first([...jobs.values()], filter, options.sort),
    updateOne: async (filter, update) => { const row = first([...jobs.values()], filter); if (row) apply(row, update); return { matchedCount: row ? 1 : 0 }; },
    updateMany: async (filter, update) => { for (const row of jobs.values()) if (matches(row, filter)) apply(row, update); },
  };
  const hints = {
    findOne: async (filter, options = {}) => first([...hintRows.values()], filter, options.sort),
    updateOne: async (filter, update) => {
      let row = hintRows.get(filter._id);
      if (!row) { row = { _id: filter._id, ...structuredClone(update.$setOnInsert) }; hintRows.set(filter._id, row); }
      apply(row, update); return { matchedCount: 1 };
    },
    deleteOne: async filter => { deleted.push(filter); const row = hintRows.get(filter._id); if (row && matches(row, filter) && !(continuousCandidate && row.targetId === 'continuous-candidate')) hintRows.delete(filter._id); },
  };
  const defaultTerm = { id: 'current', startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000) };
  const allRows = { staffingTerms: [defaultTerm], ...rows };
  const db = { collection: name => name === 'staffingAiAutomationControl' ? controlCollection : {
    findOne: async (filter, options = {}) => first(allRows[name] || [], filter, options.sort),
    distinct: async (key, filter) => [...new Set((allRows[name] || []).filter(row => matches(row, filter)).map(row => row[key]))],
  } };
  const observeScope = async (_db, scope) => {
    observed.push({ ...scope }); clock += observationCost;
    if (failOnce) { failOnce = false; throw new Error('synthetic-observation-failure'); }
    const id = idOf(scope);
    jobs.set(id, { _id: id, ...scope, status: 'queued', requestedBy: 'synthetic-faculty', inputHash: 'synthetic-hash', nextObserveAt: new Date(Date.now() + 86400000) });
    return { inputHash: 'synthetic-hash' };
  };
  const dependencies = {
    performance: { now: () => clock }, randomUUID: () => `synthetic-lease-${++leaseNumber}`,
    jobs: () => jobCollection, hints: () => hints, observeScope, automaticScopeId: idOf, automaticCandidatePageSize: () => 10,
    getRecruitmentCycle: async () => ({ termId: 'current', canReview: true }),
    boundedSetting: (name, fallback) => name === 'AI_AUTO_DISCOVERY_BATCH_SIZE' ? batch : fallback,
    staffingCourseAliases: async (_db, id) => [id],
    findOpportunity: async (_db, id) => (allRows.staffingOpportunities || []).find(row => row.id === id),
  };
  const actual = new Function(...Object.keys(dependencies), `${javascript}\nreturn {hint, discover};`)(...Object.values(dependencies));
  return { jobs, hints: hintRows, observed, deleted, control,
    hint: scope => actual.hint(db, scope),
    run: async (count = 12, signal) => { batch = count; control.nextAttemptAt = new Date(0); return actual.discover(db, signal); },
  };
}

test('replayed events wake an existing scope without refilling hint priority or resetting execution backoff', async () => {
  const scope = coordinate('candidate_fit', 'existing');
  const setup = harness({ due: [{ ...scope, status: 'failed', generation: 4, attempts: 3, nextAttemptAt: new Date('2030-01-01T00:00:00Z'), nextObserveAt: new Date('2030-01-01T00:00:00Z') }] });
  for (let event = 0; event < 100; event++) await setup.hint(scope);
  assert.equal(setup.hints.size, 0);
  const job = setup.jobs.get(idOf(scope));
  assert.equal(job.observationVersion, 100);
  assert.equal(job.nextObserveAt.getTime(), 0);
  assert.equal(job.status, 'failed');
  assert.equal(job.generation, 4);
  assert.equal(job.attempts, 3);
  assert.equal(job.nextAttemptAt.toISOString(), '2030-01-01T00:00:00.000Z');
  const missing = coordinate('cv_summary', 'new-application');
  await setup.hint(missing); await setup.hint(missing);
  assert.equal(setup.hints.size, 1);
  assert.equal(setup.hints.get(idOf(missing)).generation, 2);
});

test('dirty events preserve a running execution lease, generation and retry deadline', async () => {
  const scope = coordinate('candidate_fit', 'running-pool');
  const setup = harness({ due: [{ ...scope, status: 'running', generation: 5, runningGeneration: 4, runningInputHash: 'in-flight-evidence', leaseToken: 'in-flight-lease', leaseUntil: new Date('2030-01-01T00:01:00Z'), attempts: 3, nextAttemptAt: new Date('2030-01-01T00:00:00Z'), nextObserveAt: new Date('2030-01-01T00:00:00Z') }] });
  const before = structuredClone(setup.jobs.get(idOf(scope)));
  await setup.hint(scope);
  const after = setup.jobs.get(idOf(scope));
  for (const key of ['status', 'generation', 'runningGeneration', 'runningInputHash', 'leaseToken', 'leaseUntil', 'attempts', 'nextAttemptAt']) assert.deepEqual(after[key], before[key], key);
  assert.equal(after.observationVersion, 1);
  assert.equal(after.nextObserveAt.getTime(), 0);
  assert.equal(setup.hints.size, 0);
});

test('persistent hint kinds advance through summaries, requirements and course reviews despite continuous candidate hints', async () => {
  const setup = harness({ continuousCandidate: true, pending: [coordinate('cv_summary', 'summary'), coordinate('opportunity_draft', 'requirements'), coordinate('term_review', 'final-review')], due: ['due-a', 'due-b', 'due-c'].map(targetId => ({ ...coordinate('candidate_fit', targetId), nextObserveAt: new Date(0) })) });
  await setup.run(43);
  assert.deepEqual(setup.observed.filter(row => !row.targetId.startsWith('due-')).map(row => row.kind), ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review']);
  assert.deepEqual(setup.observed.filter(row => row.targetId.startsWith('due-')).map(row => row.targetId), ['due-a', 'due-b', 'due-c']);
  assert.equal(setup.control.state.hintKind, 0);
  assert.ok(setup.deleted.every(filter => filter.generation === 7));
});

test('a failed candidate hint preserves the next task-kind turn across separate discovery invocations', async () => {
  const setup = harness({ continuousCandidate: true, pending: [coordinate('cv_summary', 'summary')], due: [{ ...coordinate('term_review', 'due-final'), nextObserveAt: new Date(0) }], failOnce: true });
  await assert.rejects(setup.run(1), /synthetic-observation-failure/);
  assert.equal(setup.control.state.hintKind, 1);
  assert.equal(setup.control.state.hintNext, false);
  await setup.run(1);
  await setup.run(7);
  assert.deepEqual(setup.observed.map(row => row.kind), ['candidate_fit', 'term_review', 'cv_summary']);
});

test('continuous changes to an existing candidate pool do not starve other due task kinds', async () => {
  const candidate = { ...coordinate('candidate_fit', 'changing-pool'), priority: 100, status: 'idle', nextObserveAt: new Date(0) };
  const otherKinds = ['cv_summary', 'opportunity_draft', 'term_review'];
  const setup = harness({ due: [candidate, ...otherKinds.map(kind => ({ ...coordinate(kind, `due-${kind}`), priority: 10, nextObserveAt: new Date(0) }))] });
  assert.equal(setup.control.state.dueKind, undefined, 'Existing discovery state has no due-kind cursor.');
  for (let round = 0; round < 20; round++) {
    await setup.hint(candidate);
    await setup.run(7);
  }
  assert.deepEqual(setup.observed.slice(0, 4).map(row => row.kind), ['candidate_fit', ...otherKinds]);
  assert.ok(setup.observed.filter(row => row.kind === 'candidate_fit').length > 10, 'The candidate pool remains continuously dirty.');
  assert.equal(setup.hints.size, 0, 'Existing-scope changes do not refill the new-scope hint queue.');
});

test('a failed due observation persists the following kind without changing hint and due alternation', async () => {
  const kinds = ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review'];
  const setup = harness({ due: kinds.map(kind => ({ ...coordinate(kind, `due-${kind}`), nextObserveAt: new Date(0) })), failOnce: true });
  await assert.rejects(setup.run(1), /synthetic-observation-failure/);
  assert.equal(setup.control.state.dueKind, 1);
  assert.equal(setup.control.state.hintNext, false);
  assert.equal(setup.control.state.phase, 5);
  await setup.run(1);
  assert.equal(setup.control.state.dueKind, 2);
  assert.equal(setup.control.state.hintNext, true);
  await setup.run(7);
  await setup.run(7);
  assert.deepEqual(setup.observed.map(row => row.kind), kinds);
  assert.equal(setup.control.state.dueKind, 0);
});

test('due scopes recover an invalid legacy cursor and order the same kind by observation date then id', async () => {
  const setup = harness({ due: [
    { ...coordinate('cv_summary', 'b'), priority: 100, nextObserveAt: new Date(1) },
    { ...coordinate('cv_summary', 'a'), priority: 10, nextObserveAt: new Date(1) },
    { ...coordinate('cv_summary', 'c'), priority: 1, nextObserveAt: new Date(0) },
  ] });
  setup.control.state.dueKind = 99;
  await setup.run(1);
  await setup.run(7);
  await setup.run(7);
  assert.deepEqual(setup.observed.map(row => row.targetId), ['c', 'a', 'b']);
  assert.equal(setup.control.state.dueKind, 2);
});

test('baseline discovery creates 21 candidate pools, 68 summaries, requirements and reviews without the hint bottleneck', async () => {
  const courses = Array.from({ length: 10 }, (_, index) => ({ id: `course-${String(index).padStart(2, '0')}` }));
  const postings = Array.from({ length: 21 }, (_, index) => ({ id: `posting-${String(index).padStart(2, '0')}`, type: 'ta', courseId: courses[index % 10].id, termId: 'current', status: 'published' }));
  const applications = Array.from({ length: 68 }, (_, index) => ({ id: `application-${String(index).padStart(2, '0')}`, opportunityId: postings[index % 21].id, applicantId: `person-${index}`, termId: 'current', status: 'submitted', submittedAt: new Date() }));
  const setup = harness({ phase: 0, continuousCandidate: true, rows: { courses, staffingOpportunities: postings, staffingApplications: applications } });
  for (let round = 0; round < 42; round++) await setup.run();
  assert.equal([...setup.jobs.values()].filter(row => row.kind === 'cv_summary').length, 68);
  assert.equal([...setup.jobs.values()].filter(row => row.kind === 'opportunity_draft').length, 21);
  assert.equal([...setup.jobs.values()].filter(row => row.kind === 'term_review').length, 10);
  assert.equal([...setup.jobs.values()].filter(row => row.kind === 'candidate_fit' && row.targetId.startsWith('posting-')).length, 21);
  assert.equal(setup.hints.size, 1, 'The continuously supplied event hint is independent of baseline resources.');
});

test('new candidate pages have their own baseline lane and do not wait behind other task kinds', async () => {
  const parent = { ...coordinate('candidate_fit', 'pool'), status: 'idle', coverageHasMore: true, nextObserveAt: new Date(Date.now() + 86400000) };
  const setup = harness({ phase: 6, continuousCandidate: true, due: [parent] });
  await setup.run(1);
  assert.ok(setup.jobs.has(idOf(coordinate('candidate_fit', 'pool', 2))));
  assert.equal(setup.hints.size, 1);
});

test('direct initial observations retain the 350ms soft-work bound and resume the following phase', async () => {
  const course = { id: 'course' };
  const posting = { id: 'posting', courseId: course.id, type: 'ta', termId: 'current', status: 'published' };
  const setup = harness({ phase: 1, observationCost: 100, rows: { courses: [course], staffingOpportunities: [posting], staffingApplications: [{ id: 'application', termId: 'current', status: 'submitted', submittedAt: new Date() }] } });
  await setup.run(12);
  assert.deepEqual(setup.observed.map(row => row.kind), ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review']);
  assert.equal(setup.control.state.phase, 5);
  assert.equal(setup.control.leaseUntil.getTime(), 0);
  await setup.run(1);
  assert.equal(setup.control.state.phase, 6);
});
