import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('server/utils/ai-scope-selection.ts', 'utf8');
assert.match(source, /export function selectedAutomaticScopes/);
const javascript = ts.transpileModule(source.replace(/^export\s+/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const selectedAutomaticScopes = new Function(`${javascript}\nreturn selectedAutomaticScopes;`)();
const candidate = (extra = {}) => ({ kind: 'candidate_fit', targetId: 'synthetic-position', ...extra });
const select = (values, comparisonSize) => selectedAutomaticScopes(JSON.stringify(values), comparisonSize);

test('an absent operational selection retains discovery while an explicit empty array disables all scopes', () => {
  assert.equal(selectedAutomaticScopes(undefined), null);
  assert.deepEqual(selectedAutomaticScopes('[]'), []);
});

test('malformed or non-array selection fails closed without silently restoring discovery', () => {
  for (const value of ['', ' ', '[', '[] trailing', '{}', 'null', 'true', '0', '"[]"'])
    assert.throws(() => selectedAutomaticScopes(value), /Automatic AI scopes/, value);
  for (const value of [null, 1, true, 'candidate_fit', [], {}, { ...candidate(), unexpected: 'field' }])
    assert.throws(() => select([value]), /Invalid automatic AI scope/, JSON.stringify(value));
});

test('each of the four supported task kinds has normalized explicit coordinates', () => {
  const result = select([
    candidate({ targetId: ' synthetic-position ' }),
    { kind: 'cv_summary', targetId: 'application' },
    { kind: 'opportunity_draft', targetId: 'position-draft' },
    { kind: 'term_review', targetId: 'course', termId: ' fall ' },
  ]);
  assert.deepEqual(result, [
    { kind: 'candidate_fit', targetId: 'synthetic-position', termId: '', page: 1, pageSize: 10 },
    { kind: 'cv_summary', targetId: 'application', termId: '', page: 1, pageSize: 50 },
    { kind: 'opportunity_draft', targetId: 'position-draft', termId: '', page: 1, pageSize: 50 },
    { kind: 'term_review', targetId: 'course', termId: 'fall', page: 1, pageSize: 50 },
  ]);
});

test('duplicate normalized scopes collapse without dropping distinct comparison pages or semesters', () => {
  const result = select([
    candidate(), candidate({ targetId: ' synthetic-position ', page: 1, pageSize: 10 }),
    candidate({ page: 2 }),
    { kind: 'term_review', targetId: 'course', termId: 'fall' },
    { kind: 'term_review', targetId: 'course', termId: 'spring' },
  ]);
  assert.equal(result.length, 4);
  assert.deepEqual(result.filter(item => item.kind === 'candidate_fit').map(item => item.page), [1, 2]);
  assert.deepEqual(result.filter(item => item.kind === 'term_review').map(item => item.termId), ['fall', 'spring']);
});

test('selection size and identifiers are bounded before any resource lookup', () => {
  assert.equal(select(Array.from({ length: 64 }, (_, index) => candidate({ targetId: `position-${index}` }))).length, 64);
  assert.throws(() => select(Array.from({ length: 65 }, () => candidate())), /bounded array/);
  for (const targetId of ['', ' ', 'a'.repeat(65), 'line\nbreak', 'nul\0byte', null, 42])
    assert.throws(() => select([candidate({ targetId })]), /Invalid automatic AI scope/);
  assert.equal(select([candidate({ targetId: 'a'.repeat(64) })])[0].targetId.length, 64);
  for (const kind of ['unknown', 'constructor', '__proto__', null, 1])
    assert.throws(() => select([candidate({ kind })]), /Invalid automatic AI scope/);
});

test('course reviews require an explicit valid semester and reject malformed semester coordinates', () => {
  for (const termId of [undefined, '', ' ', 'a'.repeat(65), 'line\nbreak', null, 1])
    assert.throws(() => select([{ kind: 'term_review', targetId: 'course', termId }]), /semester/);
  for (const termId of [null, 1, 'line\nbreak'])
    assert.throws(() => select([candidate({ termId })]), /semester/);
});

test('candidate pages use the configured comparison size and strict bounded JSON integers', () => {
  assert.equal(select([candidate({ page: 10000 })])[0].page, 10000);
  assert.equal(select([candidate()], 3)[0].pageSize, 3);
  assert.equal(select([candidate({ page: 2, pageSize: 3 })], 3)[0].page, 2);
  for (const page of [0, -1, 10001, 1.5, '1', true, null, [], {}])
    assert.throws(() => select([candidate({ page })]), /page/, JSON.stringify(page));
  for (const pageSize of [0, 1, 9, 11, 50, '10', true, null, [], {}])
    assert.throws(() => select([candidate({ pageSize })]), /page/, JSON.stringify(pageSize));
  assert.throws(() => select([candidate({ pageSize: true })], 1), /page/);
});

test('summaries, requirements and course reviews cannot smuggle candidate pagination', () => {
  for (const kind of ['cv_summary', 'opportunity_draft', 'term_review']) {
    const item = { kind, targetId: 'scope', ...(kind === 'term_review' ? { termId: 'fall' } : {}) };
    assert.equal(select([{ ...item, page: 1, pageSize: 50 }])[0].pageSize, 50);
    for (const extra of [{ page: 2 }, { pageSize: 10 }, { page: true }, { pageSize: '50' }])
      assert.throws(() => select([{ ...item, ...extra }]), /page/);
  }
});

const automationFile = ts.createSourceFile('server/utils/ai-automation.ts', readFileSync('server/utils/ai-automation.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const executionDefinitions = automationFile.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && node.name?.text === 'assertAutomaticExecution') ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(automationFile) === 'automaticScopeId'))
);
assert.equal(executionDefinitions.length, 2, 'Exercise the actual execution authority guard and scope fingerprint.');
const executionJavascript = ts.transpileModule(executionDefinitions.map(node => node.getText(automationFile).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function executionHarness(selection, { live = true, currentActor = { id: 'reviewer' } } = {}) {
  const scope = select([candidate()])[0];
  const seen = [];
  let authorityReads = 0;
  const dependencies = {
    createHash, selectedAutomaticScopes, automaticCandidatePageSize: () => 10,
    process: { env: { AI_AUTOMATION_SCOPES: selection } },
    jobs: () => ({ findOne: async filter => { seen.push(filter); return live ? { ...scope, _id: actual.automaticScopeId(scope) } : null; } }),
    scopeActor: async () => { authorityReads++; return currentActor; },
    actorId: actor => actor.id,
    fail: (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); },
  };
  const actual = new Function(...Object.keys(dependencies), `${executionJavascript}\nreturn { automaticScopeId, assertAutomaticExecution };`)(...Object.values(dependencies));
  const execution = { automationScopeId: actual.automaticScopeId(scope), leaseToken: 'current-lease', generation: 7 };
  return { seen, authorityReads: () => authorityReads, run: minimumLease => actual.assertAutomaticExecution({}, { id: 'reviewer' }, execution, 'current-input', minimumLease) };
}

test('a scope disabled or removed after a claim fails closed before current-actor lookup', async () => {
  for (const selection of ['[]', JSON.stringify([candidate({ targetId: 'another-position' })])]) {
    const setup = executionHarness(selection);
    await assert.rejects(setup.run(), error => error.statusCode === 409);
    assert.equal(setup.authorityReads(), 0);
  }
  const malformed = executionHarness('not JSON');
  await assert.rejects(malformed.run(), /valid JSON/);
  assert.equal(malformed.authorityReads(), 0);
});

test('execution retains generation, input and live-lease fences plus current reviewer authority', async () => {
  const setup = executionHarness(JSON.stringify([candidate()]));
  const started = Date.now();
  await setup.run(15000);
  assert.equal(setup.authorityReads(), 1);
  const query = setup.seen[0];
  assert.equal(query.status, 'running');
  assert.equal(query.generation, 7);
  assert.equal(query.runningGeneration, 7);
  assert.equal(query.runningInputHash, 'current-input');
  assert.equal(query.inputHash, 'current-input');
  assert.equal(query.leaseToken, 'current-lease');
  assert.ok(query.leaseUntil.$gt.getTime() >= started + 15000);
  for (const currentActor of [null, { id: 'another-reviewer' }]) {
    const revoked = executionHarness(undefined, { currentActor });
    await assert.rejects(revoked.run(), error => error.statusCode === 403);
  }
  const expired = executionHarness(undefined, { live: false });
  await assert.rejects(expired.run(), error => error.statusCode === 409);
  assert.equal(expired.authorityReads(), 0);
});
