import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

function definitions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = source.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(source)))));
  assert.equal(selected.length, names.length);
  return selected.map(node => node.getText(source).replace(/^export\s+/, '')).join('\n');
}
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const domainSource = definitions('server/utils/staffing-applications.ts', ['candidateStatuses', 'updateApplication', 'submitApplication', 'uploadCv', 'reviewApplication']);

function applicationHarness(status = 'draft') {
  const session = { synthetic: true };
  const operations = [];
  const profile = { firstName: 'Synthetic', lastName: 'Applicant', preferredEmail: 'synthetic@example.com', undergraduateMajors: 'Computer Science', department: 'Computer Science', graduationTerm: 'Synthetic semester', availability: 'Weekdays', skills: 'Algorithms' };
  const application = { id: 'application', opportunityId: 'opportunity', applicantId: 'synthetic-applicant', status, version: 1, opportunityVersion: 1, profile, answers: {}, qualificationText: 'Synthetic qualification.', cvDocumentId: 'cv', revisions: [], ...(status !== 'draft' ? { submittedSnapshot: { profile, answers: {}, qualificationText: 'Synthetic qualification.' }, submittedAt: new Date(0) } : {}) };
  const opportunity = { id: 'opportunity', status: 'published', appointmentEnd: new Date(Date.now() + 86400000), requirementsVersion: 1, questions: [], cvRequired: true };
  const database = { collection: name => ({
    findOne: async () => name === 'staffingApplications' ? structuredClone(application) : null,
    updateOne: async (_filter, update, options) => {
      assert.equal(options.session, session);
      if (name === 'staffingApplications') {
        operations.push('write:' + update.$set.status);
        Object.assign(application, structuredClone(update.$set));
        application.version += update.$inc?.version || 0;
        if (update.$push?.revisions) application.revisions.push(structuredClone(update.$push.revisions));
      }
      return { matchedCount: 1 };
    },
    insertOne: async (_row, options) => { assert.equal(options.session, session); },
    countDocuments: async () => 0,
  }) };
  const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
  const dependencies = {
    applicationAccess: async () => ({ application: structuredClone(application), opportunity: structuredClone(opportunity), owner: true, canManage: true }),
    lockStaffingResource: async (_db, _opportunity, actualSession) => { assert.equal(actualSession, session); operations.push('lock'); },
    assertRecruitmentGate: async () => {}, assertApplicationEditable: async () => {},
    assertVersion: (row, expected) => { if (row.version !== expected) fail(409, 'Version changed'); },
    applicantInput: body => ({ profile: body.profile, answers: body.answers || {}, qualificationText: body.qualificationText || '', administrative: {} }),
    object: value => value, eligibility: () => ({ eligible: true }),
    invalidateCandidateRefresh: async (_db, actualSession, change) => { assert.equal(actualSession, session); assert.equal(change.opportunityId, opportunity.id); operations.push('invalidate:' + application.status); },
    event: async (_db, actualSession, _user, kind) => { assert.equal(actualSession, session); operations.push('event:' + kind); },
    applicationDto: value => value, publicRecord: value => value, actorId: () => application.applicantId,
    text: value => value || '', flag: (value, _label, fallback) => value ?? fallback, isGlobalAdmin: () => false, uid: () => 'new-cv', fail,
  };
  const actual = new Function(...Object.keys(dependencies), compile(domainSource) + '\nreturn { updateApplication, submitApplication, uploadCv, reviewApplication };')(...Object.values(dependencies));
  const user = { id: application.applicantId, email: 'synthetic@example.com' };
  const body = () => ({ expectedVersion: application.version, profile, answers: {}, qualificationText: 'Synthetic qualification.' });
  return { application, operations, body, run: (name, ...args) => actual[name](database, session, user, application.id, ...args) };
}

test('submission queues candidate invalidation in its original write transaction while repeated submission preserves the snapshot', async () => {
  const run = applicationHarness();
  await run.run('submitApplication', run.body());
  assert.deepEqual(run.operations, ['lock', 'write:submitted', 'invalidate:submitted', 'event:ApplicationSubmitted']);
  const completed = structuredClone(run.application);
  run.operations.length = 0;
  await run.run('submitApplication', run.body());
  assert.deepEqual(run.operations, ['lock']);
  assert.deepEqual(run.application, completed);
  run.application.status = 'shortlisted';
  await run.run('submitApplication', run.body());
  assert.equal(run.application.status, 'shortlisted');
});

test('saving or uploading a CV invalidates only when the application leaves the submitted candidate set', async () => {
  for (const status of ['draft', 'withdrawn', 'not_selected', 'submitted', 'under_review', 'shortlisted']) {
    for (const method of ['updateApplication', 'uploadCv']) {
      const run = applicationHarness(status);
      const args = method === 'uploadCv' ? [{ filename: 'synthetic.txt', type: 'text/plain', data: Buffer.from('Synthetic CV') }, run.application.version] : [run.body()];
      await run.run(method, ...args);
      assert.equal(run.application.status, 'draft');
      assert.deepEqual(run.operations.filter(value => value.startsWith('invalidate:')), ['submitted', 'under_review', 'shortlisted'].includes(status) ? ['invalidate:draft'] : []);
    }
  }
});

test('review membership changes invalidate once while review labels and stale writes do not invalidate candidates', async () => {
  for (const [status, rejected, expected] of [['submitted', false, 0], ['shortlisted', false, 0], ['submitted', true, 1], ['not_selected', false, 1], ['not_selected', true, 0]]) {
    const run = applicationHarness(status);
    await run.run('reviewApplication', { shortlisted: true, reason: 'Synthetic review.' }, rejected);
    assert.equal(run.operations.filter(value => value.startsWith('invalidate:')).length, expected);
  }
  const run = applicationHarness();
  await assert.rejects(run.run('submitApplication', { ...run.body(), expectedVersion: 99 }), error => error.statusCode === 409);
  assert.deepEqual(run.operations, ['lock']);
});

const jobSource = definitions('server/utils/ai-refresh.ts', ['nextRefreshJob']).replace("const { withTransaction } = await import('./db')", '');
function jobHarness({ orphanCount = 1, reapprove = false, insertDuringCleanup = false } = {}) {
  const rows = Array.from({ length: orphanCount }, (_, index) => ({ _id: 'orphan-' + index, subscriptionId: 'orphan-' + index, status: 'queued', generation: 1, fence: 0, updatedAt: new Date(index), nextAttemptAt: new Date(0) }));
  const valid = { _id: 'valid', subscriptionId: 'valid', status: 'queued', generation: 1, fence: 0, updatedAt: new Date(orphanCount), nextAttemptAt: new Date(0) };
  rows.push(valid);
  const subscriptions = new Map([['valid', { id: 'valid', active: true }]]);
  const stale = [];
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => value && typeof value === 'object' ? '$exists' in value ? (row[key] !== undefined) === value.$exists : true : row[key] === value);
  const apply = (row, update) => {
    Object.assign(row, update.$set || {});
    for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
    for (const key of Object.keys(update.$unset || {})) delete row[key];
  };
  const jobCollection = {
    findOne: async () => structuredClone(rows.find(row => row.status === 'queued') || null),
    findOneAndUpdate: async (filter, update) => {
      if (insertDuringCleanup && filter._id === 'orphan-0') {
        insertDuringCleanup = false;
        subscriptions.set('orphan-0', { id: 'orphan-0', active: true });
        rows[0].fence++; // A new approval writes the existing job in its transaction.
      }
      const row = rows.find(value => match(value, filter)); if (!row) return null; apply(row, update); return structuredClone(row);
    },
    updateOne: async (filter, update) => { const row = rows.find(value => match(value, filter)); if (row) apply(row, update); },
  };
  const scopeCollection = {
    findOne: async filter => { const row = subscriptions.get(filter.id); return row && row.active ? structuredClone(row) : null; },
    findOneAndUpdate: async (filter, update) => {
      if (reapprove && filter.id === 'orphan-0') { subscriptions.set(filter.id, { id: filter.id, active: true }); reapprove = false; }
      const row = subscriptions.get(filter.id); if (!row) return null; apply(row, update); return structuredClone(row);
    },
  };
  const database = { collection: () => ({ updateMany: async filter => stale.push(filter.refreshSubscriptionId) }) };
  const dependencies = { withTransaction: async work => work(database, { synthetic: true }), jobs: () => jobCollection, scopes: () => scopeCollection };
  const next = new Function(...Object.keys(dependencies), compile(jobSource) + '\nreturn nextRefreshJob;')(...Object.values(dependencies));
  return { rows, stale, run: () => next(database) };
}

test('orphan refresh jobs become terminal without blocking the next approved scope', async () => {
  const run = jobHarness({ orphanCount: 2 });
  const next = await run.run();
  assert.equal(next.job._id, 'valid');
  assert.deepEqual(run.rows.slice(0, 2).map(row => row.status), ['revoked', 'revoked']);
  assert.deepEqual(run.stale, ['orphan-0', 'orphan-1']);
});

test('orphan cleanup preserves a concurrently renewed approval and bounds its own work', async () => {
  const approval = jobHarness({ reapprove: true });
  const next = await approval.run();
  assert.equal(next.subscription.id, 'orphan-0');
  assert.equal(approval.rows[0].status, 'queued');
  assert.equal(approval.rows[0].fence, 0);
  assert.deepEqual(approval.stale, []);
  const bounded = jobHarness({ orphanCount: 12 });
  assert.equal(await bounded.run(), null);
  assert.equal(bounded.rows.filter(row => row.status === 'revoked').length, 10);
  assert.equal((await bounded.run()).job._id, 'valid');
});

test('an approval inserted after a missing-scope read changes the job fence before orphan cleanup can revoke it', async () => {
  const run = jobHarness({ insertDuringCleanup: true });
  const pending = await run.run();
  assert.equal(pending.subscription.id, 'orphan-0');
  assert.equal(run.rows[0].status, 'queued');
  assert.equal(run.rows[0].fence, 1);
  assert.deepEqual(run.stale, []);
});

test('every approval fences the job as well as activating the subscription, preserving existing lifecycle fields', async () => {
  const source = definitions('server/utils/ai-refresh.ts', ['register']).replace("const { withTransaction } = await import('./db')", '');
  const session = { synthetic: true };
  for (const status of ['queued', 'running', 'revoked']) {
    const job = { status, generation: 4, fence: 7 };
    const scope = {};
    const database = {};
    const dependencies = {
      createHash, initializeAiRefresh: async () => {}, actorId: user => user.id,
      withTransaction: async work => work(database, session),
      scopes: () => ({ updateOne: async (_filter, update, options) => { assert.equal(options.session, session); Object.assign(scope, update.$set); } }),
      jobs: () => ({ updateOne: async (_filter, update, options) => {
        assert.equal(options.session, session);
        for (const [key, value] of Object.entries(update.$inc || {})) job[key] = (job[key] || 0) + value;
      } }),
    };
    const register = new Function(...Object.keys(dependencies), compile(source) + '\nreturn register;')(...Object.values(dependencies));
    await register(database, { id: 'synthetic-reviewer', email: 'synthetic@example.com' }, { targetId: 'synthetic-opportunity', page: 1, pageSize: 50 });
    assert.equal(scope.active, true);
    assert.equal(job.fence, 8);
    assert.equal(job.generation, 4);
    assert.equal(job.status, status);
  }
});
