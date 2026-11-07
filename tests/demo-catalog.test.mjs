import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createError } from 'h3';
import { createDemoCatalog, DEMO_STAGE_ACTIONS } from '../scripts/demo-catalog.mjs';

function actualFunctions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source).replace(/^export\s+/, '')).join('\n');
}
const definitions = [
  actualFunctions('server/utils/staffing.ts', ['fail', 'text', 'number', 'flag', 'date', 'object', 'slots', 'eligibility']),
  actualFunctions('server/utils/qualification-questions.ts', ['administrativeQuestion', 'qualificationQuestionPurpose']),
  actualFunctions('server/utils/staffing-catalog.ts', ['opportunityInput']),
  actualFunctions('server/utils/staffing-applications.ts', ['applicantInput']),
].join('\n');
const javascript = ts.transpileModule(definitions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const actual = new Function('createError', `${javascript}\nreturn {opportunityInput, applicantInput, eligibility};`)(createError);
const referenceTime = '2026-11-07T17:00:00.000Z';
const liveStages = new Set(['offered', 'pending_clearance', 'needs_information', 'active', 'pending_start', 'suspended']);

test('the showcase is deterministic, isolated to synthetic identities and rich in every workflow', () => {
  const catalog = createDemoCatalog(referenceTime);
  assert.deepEqual(catalog, createDemoCatalog(new Date(referenceTime)));
  assert.equal(catalog.synthetic, true);
  assert.match(catalog.disclosure, /synthetic demonstration records/);
  assert.equal(new Set(catalog.actors.map(actor => actor.key)).size, catalog.actors.length);
  assert.equal(new Set(catalog.actors.map(actor => actor.email)).size, catalog.actors.length);
  assert.ok(catalog.actors.every(actor => actor.email.endsWith('@example.com')));
  assert.deepEqual([...new Set(catalog.actors.map(actor => actor.role))].sort(), ['admin', 'instructor', 'student', 'ta']);
  assert.ok(catalog.courses.length >= 10 && catalog.opportunities.length >= 20 && catalog.applications.length >= 60);
  assert.ok(catalog.workloads.length >= 28 && catalog.history.length >= 240 && catalog.feedback.length >= 80);
  assert.ok(['draft', 'pending_approval', 'published', 'applications_closed', 'filled', 'archived', 'cancelled'].every(stage => catalog.opportunities.some(opportunity => opportunity.stage === stage)));
});

test('each posting passes the real opportunity validator and fits the shared semester and duty budget', () => {
  for (const time of [referenceTime, '2028-02-29T12:30:00.000Z', '2027-01-01T00:15:00.000Z']) {
    const catalog = createDemoCatalog(time);
    const courseKeys = new Set(catalog.courses.map(course => course.key));
    const actors = new Map(catalog.actors.map(actor => [actor.key, actor]));
    for (const opportunity of catalog.opportunities) {
      const input = actual.opportunityInput({ ...opportunity.input, termId: 'synthetic-current-semester' });
      assert.ok(input.appointmentStart >= new Date(catalog.terms.current.startDate));
      assert.ok(input.appointmentEnd <= new Date(catalog.terms.current.endDate));
      assert.ok(input.applicationDeadline < input.appointmentEnd);
      assert.equal(input.applicationDeadline.toISOString(), catalog.cycle.closesAt);
      assert.equal(actors.get(opportunity.ownerKey)?.role, 'instructor');
      assert.ok(input.questions.every(question => question.purpose === 'qualification'));
      assert.ok(input.type === 'ta' ? courseKeys.has(opportunity.courseKey) : !opportunity.courseKey && !input.courseId);
      assert.ok(!('projectId' in input));
    }
  }
});

test('submitted and selected qualifications pass real profile and eligibility checks; drafts retain deliberate missing materials', () => {
  const catalog = createDemoCatalog(referenceTime);
  const opportunities = new Map(catalog.opportunities.map(opportunity => [opportunity.key, opportunity]));
  const actors = new Map(catalog.actors.map(actor => [actor.key, actor]));
  assert.equal(new Set(catalog.applications.map(application => application.key)).size, catalog.applications.length);
  for (const application of catalog.applications) {
    const input = actual.applicantInput(application);
    assert.equal(input.profile.preferredEmail, actors.get(application.actorKey).email);
    assert.deepEqual(application.seedActions, DEMO_STAGE_ACTIONS[application.stage]);
    assert.ok(application.qualificationText.startsWith('Synthetic qualification record'));
    if (application.seedActions.includes('submit')) {
      assert.ok(input.profile.firstName && input.profile.lastName && input.profile.department && input.profile.graduationTerm && input.profile.availability);
      assert.ok(!input.profile.priorTaExperience || input.profile.priorCourses);
      assert.equal(actual.eligibility(input, opportunities.get(application.opportunityKey).input).eligible, true);
      assert.ok(application.cv?.text.startsWith('SYNTHETIC DEMONSTRATION CV'));
      for (const question of opportunities.get(application.opportunityKey).input.questions) assert.ok(input.answers[question.id]);
    }
    if (application.stage === 'draft_missing_cv') assert.equal(application.cv, null);
    if (application.stage === 'draft_missing_answers') assert.equal(input.answers.approach, undefined);
    assert.equal(Object.hasOwn(input.profile, 'dukeUniqueId'), false);
  }
});

test('the featured candidate has seven applications and exactly one offer while the primary pool keeps twelve eligible people', () => {
  const catalog = createDemoCatalog(referenceTime);
  const liveByActor = new Map();
  for (const application of catalog.applications.filter(application => liveStages.has(application.stage))) {
    assert.equal(liveByActor.has(application.actorKey), false, 'One stable applicant cannot own multiple live commitments.');
    liveByActor.set(application.actorKey, application);
  }
  const own = catalog.applications.filter(application => application.actorKey === catalog.featured.applicantKey);
  assert.equal(own.length, 7);
  assert.equal(own.filter(application => liveStages.has(application.stage)).length, 1);
  assert.equal(liveByActor.get(catalog.featured.applicantKey).stage, 'offered');
  const pool = catalog.applications.filter(application => application.opportunityKey === catalog.featured.opportunityKey && ['submitted', 'under_review', 'shortlisted'].includes(application.stage) && !liveByActor.has(application.actorKey));
  assert.equal(pool.length, 12);
  assert.deepEqual(pool.map(application => application.actorKey).sort(), [...catalog.featured.eligibleCandidateKeys].sort());
  assert.equal(new Map(catalog.actors.map(actor => [actor.key, actor.email])).get(catalog.featured.applicantKey), 'student2@example.com');
});

test('historical and current observations preserve date, help attribution and work-record boundaries', () => {
  const catalog = createDemoCatalog(referenceTime);
  const actors = new Map(catalog.actors.map(actor => [actor.key, actor]));
  const courses = new Map(catalog.courses.map(course => [course.key, course]));
  const applications = new Map(catalog.applications.map(application => [application.key, application]));
  const opportunities = new Map(catalog.opportunities.map(opportunity => [opportunity.key, opportunity]));
  for (const session of catalog.history) {
    const term = catalog.terms[session.termKey];
    assert.ok(new Date(session.joinedAt) >= new Date(term.startDate));
    assert.ok(new Date(session.leftQueueAt) < new Date(term.endDate));
    assert.ok(actors.has(session.actorKey) && courses.has(session.courseKey) && actors.get(session.helperKey).role === 'ta');
    if (session.wasHelped) {
      assert.ok(new Date(session.helpStartAt) >= new Date(session.joinedAt));
      assert.equal((new Date(session.helpEndAt) - new Date(session.helpStartAt)) / 60000, session.helpMinutes);
      assert.equal(session.endReason, 'completed');
    } else assert.ok(session.helpMinutes === 0 && session.helpStartAt === null && session.endReason === 'left');
  }
  for (const observation of catalog.workloads) {
    const application = applications.get(observation.applicationKey);
    const opportunity = opportunities.get(application.opportunityKey);
    assert.equal(opportunity.input.type, 'ta');
    assert.ok(application.seedActions.indexOf('workload') < (application.seedActions.indexOf('end') < 0 ? Infinity : application.seedActions.indexOf('end')));
    assert.ok(observation.date >= opportunity.input.appointmentStart.slice(0, 10) && observation.date <= referenceTime.slice(0, 10));
    assert.ok(observation.hours > 0 && observation.hours <= 24);
  }
  assert.ok(catalog.feedback.every(record => record.rating >= 1 && record.rating <= 5 && record.positive && record.negative));
});

test('invalid clocks and colliding primary codes fail before any data can be generated', () => {
  assert.throws(() => createDemoCatalog('not-a-clock'), /reference time/);
  assert.throws(() => createDemoCatalog(referenceTime, { primaryCourse: '../outside' }), /course code/);
  assert.throws(() => createDemoCatalog(referenceTime, { primaryCourse: 'cs201' }), /unique/);
});
