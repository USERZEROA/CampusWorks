import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createError } from 'h3';

function definitions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return source.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))))
  ).map(node => node.getText(source).replace(/^export\s+/, '')).join('\n');
}
const source = [
  definitions('server/utils/staffing.ts', ['fail', 'text', 'object']),
  definitions('server/utils/qualification-questions.ts', ['administrativeQuestion', 'aiQualificationQuestion', 'qualificationQuestionPurpose']),
  definitions('server/utils/ai.ts', ['redactText', 'qualificationEvidence', 'validatedResult', 'quotaError', 'confirmAiLease']),
].join('\n');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const actual = new Function('createError', 'aiUsageCollection', `${javascript}\nreturn { qualificationQuestionPurpose, qualificationEvidence, validatedResult, confirmAiLease };`)(createError, db => db.collection('staffingAiBudgets'));

test('qualification screening preserves computing evidence and isolates administrative or unclassified answers', () => {
  const questions = [
    { id: 'race', prompt: 'Explain race conditions and mutexes.', purpose: 'qualification' },
    { id: 'health', prompt: 'Describe a software health check.', purpose: 'qualification' },
    { id: 'duke', prompt: 'Enter your Duke Unique ID.', purpose: 'qualification' },
    { id: 'authorization', prompt: 'When does your work authorization expire?', purpose: 'qualification' },
    { id: 'legacy', prompt: 'Describe relevant teaching experience.' },
  ];
  for (const question of questions.slice(0, 2)) assert.equal(actual.qualificationQuestionPurpose(question.prompt), 'qualification');
  for (const question of questions.slice(2, 4)) assert.throws(() => actual.qualificationQuestionPurpose(question.prompt), error => error.statusCode === 400);
  assert.throws(() => actual.qualificationQuestionPurpose('Describe teaching experience.', 'administrative'), error => error.statusCode === 400);
  const application = { id: 'app-a', profile: { skills: 'Algorithms' }, answers: { race: 'Use mutexes.', health: 'Check readiness.', duke: '1234567', authorization: '2030-01-01', legacy: 'Peer tutoring.' } };
  const evidence = actual.qualificationEvidence(application, { questions });
  assert.deepEqual(evidence.map(item => item.reference), ['app:app-a:profile.skills', 'app:app-a:answers.race', 'app:app-a:answers.health']);
  assert.equal(JSON.stringify(evidence).includes('1234567'), false);
  assert.equal(JSON.stringify(evidence).includes('2030-01-01'), false);
});

test('candidate comparisons require each supplied candidate exactly once and cite their own evidence', () => {
  const evidence = [{ reference: 'opportunity:requirements', value: 'Algorithms' }, ...['a', 'b'].map(id => ({ reference: `app:${id}:profile.skills`, value: 'Algorithms' }))];
  const base = { summary: 'Synthetic comparison', summaryEvidenceRefs: ['opportunity:requirements'], cautions: [] };
  const item = id => ({ targetId: id, explanation: 'Relevant coursework.', evidenceRefs: [`app:${id}:profile.skills`] });
  for (const items of [[], [item('a')], [item('a'), item('a')], [item('a'), { ...item('b'), evidenceRefs: ['app:a:profile.skills'] }]]) {
    assert.throws(() => actual.validatedResult({ ...base, items }, evidence, ['a', 'b'], 'candidate_fit'));
  }
  assert.deepEqual(actual.validatedResult({ ...base, items: [item('b'), item('a')] }, evidence, ['a', 'b'], 'candidate_fit').items.map(item => item.targetId), ['b', 'a']);
});

test('a provider call requires a live concurrency lease after budget confirmation', async () => {
  const seen = [];
  const database = record => ({ collection: () => ({ findOneAndUpdate: async (...args) => { seen.push(args); return record; } }) });
  await assert.rejects(actual.confirmAiLease(database(null), 'task-a'), error => error.quotaCode === 'concurrency');
  await assert.rejects(actual.confirmAiLease(database({ leases: [{ taskId: 'task-a', expiresAt: new Date(Date.now() - 1) }] }), 'task-a'), error => error.quotaCode === 'concurrency');
  await assert.rejects(actual.confirmAiLease(database({ leases: [{ taskId: 'task-a', expiresAt: new Date(Date.now() + 1000) }] }), 'task-a'), error => error.quotaCode === 'concurrency');
  await actual.confirmAiLease(database({ leases: [{ taskId: 'task-a', expiresAt: new Date(Date.now() + 30000) }] }), 'task-a');
  assert.equal(seen[0][0].leases.$elemMatch.taskId, 'task-a');
  assert.ok(seen[0][0].leases.$elemMatch.expiresAt.$gt instanceof Date);
});
