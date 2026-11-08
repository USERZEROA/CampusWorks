import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createError } from 'h3';
import ts from 'typescript';

const javascript = ts.transpileModule(readFileSync('server/utils/help-feedback.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', javascript)(name => {
  assert.equal(name, 'h3'); return { createError };
}, loaded, loaded.exports);
const { ownsHelpRecord, feedbackHelpers, requireFeedbackHelper } = loaded.exports;
const user = { id: 'student-one', email: 'student@example.com' };
const start = Date.parse('2026-11-01T16:00:00Z');
const segment = (taEmail, offset, seconds) => ({ taEmail, taName: taEmail.split('@')[0], startAt: new Date(start + offset * 1000), endAt: new Date(start + (offset + seconds) * 1000), durationMs: seconds * 1000 });
const record = { studentId: user.id, studentEmail: user.email, wasHelped: true, leftQueueAt: new Date(start + 60000), taEmail: 'last-helper@example.com', helpSegments: [segment('a@example.com', 0, 3), segment('b@example.com', 3, 7), segment('a@example.com', 10, 4)] };

test('help feedback retains stable student ownership and does not transfer through a reused email', () => {
  assert.equal(ownsHelpRecord(record, user), true);
  assert.equal(ownsHelpRecord({ ...record, studentId: 'another-person' }, user), false);
  assert.equal(ownsHelpRecord({ studentEmail: 'STUDENT@example.com' }, user), true);
  assert.equal(ownsHelpRecord({ studentEmail: 'other@example.com' }, user), false);
});

test('feedback attribution follows real helper segments, including a returning helper, rather than the final name', () => {
  assert.deepEqual(feedbackHelpers(record, start + 120000), [
    { email: 'a@example.com', name: 'a', durationMs: 7000 },
    { email: 'b@example.com', name: 'b', durationMs: 7000 },
  ]);
  assert.deepEqual(feedbackHelpers({ ...record, helpSegments: [segment('short@example.com', 0, 5), segment('negative@example.com', 10, -1), segment('future@example.com', 70, 10)] }, start + 120000), []);
  assert.deepEqual(feedbackHelpers({ ...record, wasHelped: false }, start + 120000), []);
  assert.deepEqual(feedbackHelpers({ ...record, leftQueueAt: new Date(start + 180000) }, start + 120000), []);
  assert.deepEqual(feedbackHelpers({ ...record, helpSegments: undefined }, start + 120000), []);
});

test('a targeted rating requires the requesting student and a recorded non-self helper', () => {
  assert.equal(requireFeedbackHelper(record, user, 'a@example.com').durationMs, 7000);
  assert.throws(() => requireFeedbackHelper(record, { id: 'other', email: user.email }, 'a@example.com'), error => error.statusCode === 404);
  assert.throws(() => requireFeedbackHelper(record, user, 'last-helper@example.com'), error => error.statusCode === 400);
  assert.throws(() => requireFeedbackHelper({ ...record, helpSegments: [segment(user.email, 0, 10)] }, user, user.email), error => error.statusCode === 400);
});
