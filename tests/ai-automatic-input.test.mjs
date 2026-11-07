import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createError } from 'h3';

function definitions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return source.statements.filter(node => (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source)))))
    .map(node => node.getText(source).replace(/^export\s+/, '')).join('\n');
}
const source = [definitions('server/utils/staffing.ts', ['fail', 'text', 'object', 'publicRecord']), definitions('server/utils/ai.ts', ['aiKinds', 'taskDirections', 'aiOutputTokenLimit', 'safeAiFailureCategory', 'preparedAiInput', 'createAiTask'])].join('\n');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const build = (dependencies = {}) => new Function('createHash', 'createError', ...Object.keys(dependencies), `${javascript}\nreturn { preparedAiInput, createAiTask, aiOutputTokenLimit, safeAiFailureCategory };`)(createHash, createError, ...Object.values(dependencies));
const actual = build();
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
test('automatic output reservations fit each advisory task while manual limits remain compatible', () => {
  assert.equal(actual.aiOutputTokenLimit('candidate_fit', true), 2500);
  assert.equal(actual.aiOutputTokenLimit('cv_summary', true), 900);
  assert.equal(actual.aiOutputTokenLimit('opportunity_draft', true), 1200);
  assert.equal(actual.aiOutputTokenLimit('term_review', true), 1800);
  for (const kind of ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review']) assert.equal(actual.aiOutputTokenLimit(kind, false), 2500);
});
test('AI failure diagnostics retain only allowlisted categories and exclude provider or applicant text', () => {
  for (const category of ['output_limit', 'invalid_json', 'summary_references', 'cross_candidate_reference', 'candidate_coverage']) {
    const error = category === 'invalid_json' ? new SyntaxError('Private response content') : Object.assign(new Error('Private response content'), { aiFailureCategory: category });
    assert.equal(actual.safeAiFailureCategory(error), category);
  }
  assert.equal(actual.safeAiFailureCategory(Object.assign(new Error('Private applicant content'), { aiFailureCategory: 'Private provider content' })), 'provider_or_validation');
  assert.equal(actual.safeAiFailureCategory(Object.assign(new Error('Private provider content'), { name: 'AbortError' })), 'timeout_or_abort');
  assert.equal(actual.safeAiFailureCategory({ quotaCode: 'daily', message: 'Private provider content' }), 'budget');
});
function fixture(long = false) {
  const targetIds = Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  const coverage = { page: 1, pageSize: 10, compared: 10, totalSubmitted: 10, hasMore: false };
  const text = long ? '算法 😀 peer tutoring 🧑🏽‍💻 '.repeat(1600) + 'UNDISPLAYED-TAIL-A' : 'Algorithms and peer tutoring.';
  return { targetType: 'opportunity', opportunityId: 'synthetic-position', termId: 'synthetic-term', version: 1, targetIds, coverage, evidence: [
    { reference: 'opportunity:requirements', value: { requiredSkills: 'Algorithms', weeklyHours: 10, requiresAttendance: true, hasLab: false } },
    { reference: 'coverage:candidates', value: coverage },
    ...targetIds.flatMap(id => [
      { reference: `app:${id}:qualificationText`, value: text },
      { reference: `app:${id}:profile.availableHours`, value: 20 },
      { reference: `app:${id}:profile.slots`, value: [{ day: 1, start: '09:00', end: '10:00' }] },
      { reference: `app:${id}:answers.experience`, value: { question: 'Describe relevant experience.', answer: text } },
    ]),
  ] };
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}
function noUnpairedSurrogates(value) {
  for (const text of strings(value)) for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { assert.ok(index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff); index++; }
    else assert.ok(unit < 0xdc00 || unit > 0xdfff);
  }
}

test('ordinary automatic evidence and the legacy manual payload keep their complete values', () => {
  const ordinary = fixture();
  assert.strictEqual(actual.preparedAiInput(ordinary, true), ordinary);
  const large = fixture(true);
  assert.ok(bytes(large) > 50000);
  assert.strictEqual(actual.preparedAiInput(large, false), large);
});

test('automatic excerpts preserve every candidate, reference and structural qualification without mutating the source', () => {
  const source = fixture(true);
  const before = structuredClone(source);
  const prepared = actual.preparedAiInput(source, true);
  assert.ok(bytes(prepared) <= 48000);
  assert.deepEqual(prepared.targetIds, source.targetIds);
  assert.deepEqual(prepared.evidence.map(item => item.reference), source.evidence.map(item => item.reference));
  assert.equal(prepared.coverage.evidenceExcerpt, true);
  assert.equal(prepared.coverage.excerptedEvidenceCount, 20);
  assert.match(prepared.coverage.excerptNote, /Every candidate and evidence reference remains included/);
  assert.deepEqual(prepared.evidence.find(item => item.reference === 'coverage:candidates').value, prepared.coverage);
  for (const item of prepared.evidence.filter(item => /availableHours|profile.slots|opportunity:requirements/.test(item.reference))) assert.deepEqual(item, source.evidence.find(original => original.reference === item.reference));
  assert.deepEqual(source, before);
  noUnpairedSurrogates(prepared);
});

test('unshown tail changes remain part of the source fingerprint and identical evidence is deterministic', () => {
  const source = fixture(true);
  const changed = structuredClone(source);
  changed.evidence.find(item => item.reference.endsWith(':qualificationText')).value += '-TAIL-B';
  const first = actual.preparedAiInput(source, true);
  const second = actual.preparedAiInput(changed, true);
  assert.deepEqual(first.evidence.filter(item => item.reference !== 'coverage:candidates'), second.evidence.filter(item => item.reference !== 'coverage:candidates'));
  assert.notEqual(first.coverage.sourceEvidenceHash, second.coverage.sourceEvidenceHash);
  assert.equal(first.coverage.sourceEvidenceHash, createHash('sha256').update(JSON.stringify(source.evidence)).digest('hex'));
  assert.deepEqual(actual.preparedAiInput(structuredClone(source), true), first);
});

test('structural overload stays complete and is refused before any budget reservation or provider request', async () => {
  const input = fixture();
  const structure = Array.from({ length: 20000 }, (_, index) => index);
  input.evidence.push({ reference: `app:${input.targetIds[0]}:syntheticStructuralOverload`, value: structure });
  const prepared = actual.preparedAiInput(input, true);
  assert.ok(bytes(prepared) > 50000);
  assert.deepEqual(prepared.targetIds, input.targetIds);
  assert.deepEqual(prepared.evidence.at(-1).value, structure);
  let reservations = 0;
  let calls = 0;
  let task;
  const database = { collection: () => ({
    insertOne: async value => { task = structuredClone(value); },
    updateOne: async (_query, update) => { Object.assign(task, update.$set); },
    findOne: async () => task,
  }) };
  const runtime = build({
    taskInput: async () => input, actorId: actor => actor.id, uid: () => 'synthetic-task', aiStatus: () => ({ configured: true }),
    reserveAiBudget: async () => { reservations++; throw new Error('unexpected_reservation'); },
    fetch: async () => { calls++; throw new Error('unexpected_provider'); },
    process: { env: { AI_BASE_URL: 'http://127.0.0.1:1/v1', AI_API_KEY: 'synthetic-unused-key', AI_MODEL: 'synthetic-unused-model' } },
  });
  const result = await runtime.createAiTask(database, { id: 'synthetic-faculty', email: 'faculty@example.com' }, { kind: 'candidate_fit', targetId: 'synthetic-position', pageSize: 10 }, { automationScopeId: 'synthetic-scope', generation: 1 });
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.failureCode, 'input_budget');
  assert.equal(reservations, 0);
  assert.equal(calls, 0);
});

test('a provider output-limit response is rejected without retaining its content and releases its capacity lease', async () => {
  const input = fixture();
  let task, requests = 0, released = 0;
  const database = { collection: () => ({
    insertOne: async value => { task = structuredClone(value); },
    updateOne: async (_query, update) => { if (update.$set) Object.assign(task, update.$set); if (update.$pull) released++; },
    findOne: async () => task,
  }) };
  const runtime = build({
    taskInput: async () => input, actorId: actor => actor.id, uid: () => 'synthetic-task', aiStatus: () => ({ configured: true }),
    reserveAiBudget: async () => 'concurrency', confirmAiLease: async () => {},
    fetch: async () => { requests++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Private model text that must not be stored.' } }] })); },
    process: { env: { AI_BASE_URL: 'http://127.0.0.1:1/v1', AI_API_KEY: 'synthetic-unused-key', AI_MODEL: 'synthetic-unused-model' } },
  });
  const result = await runtime.createAiTask(database, { id: 'synthetic-faculty', email: 'faculty@example.com' }, { kind: 'candidate_fit', targetId: 'synthetic-position', pageSize: 10 });
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.failureCategory, 'output_limit');
  assert.equal(result.task.failureCode, 'provider_or_validation');
  assert.equal(JSON.stringify(result).includes('Private model text'), false);
  assert.equal(requests, 1);
  assert.equal(released, 1);
});
