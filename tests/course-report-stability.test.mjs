import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const path = 'server/utils/staffing-reports.ts';
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const report = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'courseReview');
const declaration = report.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'byKind'));
assert.ok(declaration, 'The actual report must expose its work-category aggregation.');
const javascript = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const categories = new Function('workloadGroups', `${javascript}\nreturn byKind;`);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index)).map(rest => [value, ...rest]));
}

test('unchanged teaching-work evidence has one fingerprint across unordered database aggregation results', () => {
  const rows = [{ _id: 'office_hours', hours: 4.5 }, { _id: 'grading', hours: 8 }, { _id: 'lab', hours: 3 }, { _id: 'preparation', hours: 2.25 }];
  const expected = categories(structuredClone(rows));
  for (const order of permutations(rows)) {
    const result = categories(structuredClone(order));
    assert.deepEqual(result, { grading: 8, lab: 3, office_hours: 4.5, preparation: 2.25 });
    assert.equal(digest(result), digest(expected));
  }
  assert.notEqual(digest(categories([{ _id: 'grading', hours: 9 }])), digest(categories([{ _id: 'grading', hours: 8 }])));
});
