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
  definitions('server/utils/staffing.ts', ['fail', 'text', 'number', 'flag', 'date', 'object', 'slots']),
  definitions('server/utils/qualification-questions.ts', ['administrativeQuestion', 'qualificationQuestionPurpose']),
  definitions('server/utils/staffing-catalog.ts', ['opportunityInput']),
].join('\n');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const opportunityInput = new Function('createError', `${javascript}\nreturn opportunityInput;`)(createError);
const duty = kind => ({ kind, sessionsPerWeek: 1, minutesPerSession: 60 });
const position = (type, duties) => ({
  type, title: 'Synthetic assistant position', termId: 'synthetic-term', courseId: type === 'ta' ? 'synthetic-course' : '',
  department: 'Computer Science', description: 'Synthetic qualification-focused opportunity.', positions: 2, weeklyHours: 10,
  appointmentStart: '2031-01-01T00:00:00.000Z', appointmentEnd: '2031-05-01T00:00:00.000Z',
  applicationDeadline: '2030-12-15T00:00:00.000Z', hourlyRate: 20, budget: 10000, duties,
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
