import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createError } from 'h3';

function definitions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(source).replace(/^export\s+/, '')).join('\n');
}
const source = [
  definitions('server/utils/staffing.ts', ['fail', 'text', 'number', 'flag', 'date', 'object', 'slots', 'publicRecord']),
  definitions('server/utils/qualification-questions.ts', ['administrativeQuestion', 'qualificationQuestionPurpose']),
  definitions('server/utils/staffing-catalog.ts', ['opportunityInput']),
  definitions('server/utils/staffing-appointments.ts', ['appointmentAction']),
].join('\n');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const { opportunityInput, publicRecord, appointmentAction } = new Function('createError', `${javascript}\nreturn { opportunityInput, publicRecord, appointmentAction };`)(createError);
const duty = kind => ({ kind, sessionsPerWeek: 1, minutesPerSession: 60 });
const position = (type, duties) => ({
  type, title: 'Synthetic assistant position', termId: 'synthetic-term', courseId: type === 'ta' ? 'synthetic-course' : '',
  department: 'Computer Science', description: 'Synthetic qualification-focused opportunity.', positions: 2, weeklyHours: 10,
  appointmentStart: '2031-01-01T00:00:00.000Z', appointmentEnd: '2031-05-01T00:00:00.000Z',
  applicationDeadline: '2030-12-15T00:00:00.000Z', duties,
});

test('teaching positions cannot publish a research duty that teaching workload records cannot represent', () => {
  assert.throws(() => opportunityInput(position('ta', [duty('office_hours'), duty('research')])), error =>
    error.statusCode === 400 && /research appointments/.test(error.statusMessage));
});

test('teaching duties retain supported instruction and coordination categories', () => {
  const categories = ['attendance', 'lab', 'discussion', 'grading', 'office_hours', 'preparation', 'coordination'];
  assert.deepEqual(opportunityInput(position('ta', categories.map(duty))).duties.map(item => item.kind), categories);
});

test('research positions keep research and existing permitted API duty categories', () => {
  const categories = ['research', 'preparation', 'coordination', 'office_hours'];
  assert.deepEqual(opportunityInput(position('ra', categories.map(duty))).duties.map(item => item.kind), categories);
});

test('staffing requirements need positions and hours without a financial plan', () => {
  const output = opportunityInput(position('ta', [duty('office_hours')]));
  assert.equal(output.positions, 2);
  assert.equal(output.weeklyHours, 10);
  for (const field of ['budget', 'hourlyRate', 'weeks', 'appointmentCost', 'committedBudget']) assert.equal(Object.hasOwn(output, field), false);
  assert.throws(() => opportunityInput({ ...position('ta', []), positions: 1.5 }), error => error.statusCode === 400);
  assert.throws(() => opportunityInput({ ...position('ta', []), weeklyHours: 41 }), error => error.statusCode === 400);
});

test('legacy financial input is ignored without carrying money into a new opportunity', () => {
  const clean = opportunityInput(position('ta', [duty('office_hours')]));
  const stale = opportunityInput({ ...position('ta', [duty('office_hours')]), hourlyRate: -100, budget: 'old form', committedCost: 1000, weeks: 20 });
  assert.deepEqual(stale, clean);
});

test('public staffing records conceal stored financial fields without mutating history or AI quotas', () => {
  const legacy = Object.freeze({ _id: 'db-id', bytes: Buffer.from('private'), projectId: 'retired', id: 'appointment', positions: 2, committedPositions: 1, weeklyHours: 10, hourlyRate: 20, budget: 1000, weeks: 5, appointmentCost: 1000, committedBudget: 1000, committedCost: 1000, incurredCost: 200, budgetStatus: 'awaiting_settlement', releasedBudget: 800, settledBy: 'admin@example.com', settledAt: new Date(), requestBudget: 50, tokenBudget: 1000 });
  assert.deepEqual(publicRecord(legacy), { id: 'appointment', positions: 2, committedPositions: 1, weeklyHours: 10, requestBudget: 50, tokenBudget: 1000 });
  assert.equal(legacy.committedCost, 1000);
  assert.equal(legacy.budgetStatus, 'awaiting_settlement');
  assert.equal(publicRecord(null), null);
});

test('removed settlement commands return gone before any database read or mutation', async () => {
  const database = { collection() { throw new Error('Removed commands must not touch the database'); } };
  await assert.rejects(appointmentAction(database, {}, { email: 'admin@example.com' }, 'old-appointment', 'settle', { incurredCost: 100 }), error => error.statusCode === 410);
});
