import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, command, getCourseRole, getRoleViews, getInsights, loadState, saveState, STORAGE_KEY } from '../docs/try/model.mjs';

const NOW = new Date('2026-11-07T17:00:00.000Z');
const later = minutes => new Date(NOW.getTime() + minutes * 60000);
const run = (state, actorId, type, values = {}, now = NOW) => command(state, { type, actorId, ...values }, now);
const login = (state, actorId) => run(state, actorId, 'signIn');
const currentAppointment = (state, applicationId) => state.appointments.find(item => item.applicationId === applicationId && !['ended', 'declined', 'expired', 'cancelled'].includes(item.status));

function apply(state, opportunityId = 'structures-ta', studentId = 'student-main') {
  state = run(state, studentId, 'saveApplication', { opportunityId, profile: { undergraduateMajors: 'Computer Science', availableHours: 10, skills: 'Java and data structures' }, answers: { experience: 'Peer tutoring.', approach: 'Use a small example and ask questions.', availability: 'Tuesday afternoon.' }, qualificationText: 'Synthetic visitor application.', cv: { name: 'demo-cv.txt', type: 'text/plain', size: 200 } });
  const application = state.applications.find(item => item.applicantId === studentId && item.opportunityId === opportunityId);
  state = run(state, studentId, 'submitApplication', { applicationId: application.id });
  return { state, id: application.id };
}

test('browser workspace contains complete relative-date synthetic scenarios without a server', () => {
  const state = createInitialState(NOW);
  assert.deepEqual([state.actors.length, state.courses.length, state.opportunities.length, state.applications.length, state.appointments.length, state.queueEntries.length, state.helpSessions.length, state.workload.length, state.feedback.length], [41, 10, 21, 68, 15, 11, 380, 30, 80]);
  assert.equal(state.opportunities.find(item => item.id === 'structures-ta').openPositions, 2);
  const future = createInitialState(new Date('2031-06-12T10:00:00Z'));
  assert.ok(new Date(future.cycle.closesAt) > new Date('2031-06-12T10:00:00Z'));
  assert.ok(new Date(future.opportunities.find(item => item.id === 'structures-ta').appointmentEnd) > new Date('2031-06-12T10:00:00Z'));
  assert.equal(future.term.name, 'Summer 2031 · Demo');
  assert.ok(future.workload.every(item => item.date.startsWith('2031-')));
  assert.equal(new Date(future.helpSessions[0].joinedAt).getUTCHours(), new Date(state.helpSessions[0].joinedAt).getUTCHours());
  assert.deepEqual(createInitialState(NOW), state);
});

test('prepared applicant accepts, waits for administrator clearance and gains only dated TA access', () => {
  let state = login(createInitialState(NOW), 'student-two');
  const id = 'appointment-student-two--structures-ta';
  assert.equal(getCourseRole(state, 'student-two', 'cs201', NOW), 'student');
  assert.throws(() => run(state, 'admin', 'clearAppointment', { appointmentId: id, status: 'cleared' }), /Acceptance/);
  state = run(state, 'student-two', 'respondOffer', { appointmentId: id, accept: true });
  assert.equal(getCourseRole(state, 'student-two', 'cs201', NOW), 'student');
  assert.throws(() => run(state, 'ta-labs', 'clearAppointment', { appointmentId: id, status: 'cleared' }), /manage|administrator/);
  assert.throws(() => run(state, 'faculty-algorithms', 'clearAppointment', { appointmentId: id, status: 'cleared' }), /administrator/);
  state = run(state, 'admin', 'clearAppointment', { appointmentId: id, status: 'cleared' });
  assert.equal(getCourseRole(state, 'student-two', 'cs201', NOW), 'ta');
  assert.equal(getCourseRole(state, 'cs201', 'student-two', NOW), 'ta');
  assert.equal(getRoleViews(state, 'student-two', NOW).canHire, false);
  assert.equal(getCourseRole(state, 'student-two', 'cs101', NOW), 'student');
});

test('new application, exclusive offer, queue service, attributed feedback and appointment end close the loop', () => {
  const prepared = apply(createInitialState(NOW));
  let state = prepared.state;
  const id = prepared.id;
  assert.throws(() => run(state, 'ta-labs', 'selectApplication', { applicationId: id }), /managing/);
  state = run(state, 'faculty-algorithms', 'selectApplication', { applicationId: id });
  const appointment = currentAppointment(state, id);
  const competing = apply(state, 'intro-ta');
  state = competing.state;
  assert.throws(() => run(state, 'faculty-main', 'selectApplication', { applicationId: competing.id }), /conflicting/);
  state = run(state, 'student-main', 'respondOffer', { appointmentId: appointment.id, accept: true });
  state = run(state, 'admin', 'clearAppointment', { appointmentId: appointment.id, status: 'cleared' });
  state = run(state, 'student-main', 'duty', { courseId: 'cs201', on: true });
  const request = state.queueEntries.find(item => item.courseId === 'cs201' && item.status === 'waiting');
  state = run(state, 'student-main', 'queueAction', { entryId: request.id, action: 'claim' }, later(1));
  assert.throws(() => run(state, 'ta-labs', 'queueAction', { entryId: request.id, action: 'claim' }, later(1)), /no longer/);
  state = run(state, 'student-main', 'queueAction', { entryId: request.id, action: 'complete' }, later(4));
  const session = state.helpSessions.at(-1);
  assert.equal(session.helperId, 'student-main');
  assert.equal(session.studentId, request.studentId);
  assert.equal(session.helpMinutes, 3);
  assert.throws(() => run(state, 'student-three', 'submitFeedback', { sessionId: session.id, rating: 5 }), /own/);
  state = run(state, request.studentId, 'submitFeedback', { sessionId: session.id, rating: 5, positive: 'A clear example.' }, later(5));
  assert.throws(() => run(state, request.studentId, 'submitFeedback', { sessionId: session.id, rating: 4 }, later(5)), /already submitted/);
  state = run(state, 'student-main', 'recordWork', { appointmentId: appointment.id, courseId: 'cs201', kind: 'preparation', hours: 1.5, notes: 'Prepared a worksheet.' }, later(6));
  state = run(state, 'faculty-algorithms', 'endAppointment', { appointmentId: appointment.id, reason: 'The workshop is complete.' }, later(7));
  assert.equal(getCourseRole(state, 'student-main', 'cs201', later(7)), 'student');
  assert.equal(state.courses.find(item => item.id === 'cs201').onDutyIds.includes('student-main'), false);
  assert.throws(() => run(state, 'student-main', 'duty', { courseId: 'cs201', on: true }, later(7)), /staff/);
  assert.equal(getInsights(state, 'faculty-algorithms', 'cs201', later(7)).courses[0].helpers.find(item => item.actorId === 'student-main').ratingCount, 1);
});

test('closed recruitment, required answers, immutable submissions and approved vacancies remain authoritative', () => {
  let state = createInitialState(NOW);
  const initial = structuredClone(state);
  state = run(state, 'admin', 'setCycle', { enabled: false });
  assert.throws(() => apply(state), /not accepting/);
  assert.deepEqual(initial, createInitialState(NOW));
  state = run(state, 'admin', 'setCycle', { enabled: true });
  const result = apply(state); state = result.state;
  const snapshot = structuredClone(state.applications.find(item => item.id === result.id).submittedSnapshot);
  assert.throws(() => run(state, 'student-main', 'saveApplication', { opportunityId: 'structures-ta', applicationId: result.id, qualificationText: 'Changed.' }), /draft/);
  assert.deepEqual(state.applications.find(item => item.id === result.id).submittedSnapshot, snapshot);
  const student = 'candidate-32';
  assert.throws(() => run(state, student, 'submitApplication', { applicationId: 'candidate-32--ra-data-quality' }), /CV/);
  assert.throws(() => run(state, 'student-three', 'submitApplication', { applicationId: 'student-three--intro-ta' }), /question/);
  const unapproved = structuredClone(state);
  unapproved.opportunities.find(item => item.id === 'structures-ta').approved = false;
  assert.throws(() => run(unapproved, 'faculty-algorithms', 'selectApplication', { applicationId: result.id }), /available/);
});

test('only managers publish and approve, and full reservations prevent another selection', () => {
  let state = createInitialState(NOW);
  const input = { title: 'One-position browser workshop', courseId: 'cs201', positions: 1, weeklyHours: 10, description: 'Synthetic one-position plan.', questions: [], cvRequired: false };
  assert.throws(() => run(state, 'ta-labs', 'createOpportunity', { input }), /instructors/);
  state = run(state, 'faculty-algorithms', 'createOpportunity', { input });
  const posting = state.opportunities[0];
  state = run(state, 'faculty-algorithms', 'publishOpportunity', { opportunityId: posting.id });
  assert.equal(state.opportunities[0].status, 'pending_approval');
  assert.throws(() => run(state, 'faculty-algorithms', 'approveOpportunity', { opportunityId: posting.id }), /administrator/);
  state = run(state, 'admin', 'approveOpportunity', { opportunityId: posting.id });
  let first = apply(state, posting.id); state = first.state;
  let second = apply(state, posting.id, 'student-three'); state = second.state;
  state = run(state, 'faculty-algorithms', 'selectApplication', { applicationId: first.id });
  assert.throws(() => run(state, 'faculty-algorithms', 'selectApplication', { applicationId: second.id }), /reserved/);
  assert.throws(() => run(state, 'faculty-algorithms', 'archiveOpportunity', { opportunityId: posting.id }), /unresolved/);
});

test('course restrictions persist until restoration and do not create enrollment or reactivate suspended TA access', () => {
  let state = createInitialState(NOW);
  state = run(state, 'faculty-algorithms', 'removeStudent', { courseId: 'cs201', studentId: 'student-main' });
  assert.throws(() => run(state, 'student-main', 'enroll', { courseId: 'cs201', enroll: true }), /restore/);
  state = run(state, 'faculty-algorithms', 'restoreStudent', { courseId: 'cs201', studentId: 'student-main' });
  assert.equal(getCourseRole(state, 'student-main', 'cs201', NOW), 'none');
  state = run(state, 'student-main', 'enroll', { courseId: 'cs201', enroll: true });
  assert.equal(getCourseRole(state, 'student-main', 'cs201', NOW), 'student');
  assert.equal(getCourseRole(state, 'ta-labs', 'cs201', NOW), 'ta');
});

test('RA clearance provides an appointment without manufacturing TA course authority', () => {
  let state = createInitialState(NOW);
  const result = apply(state, 'ra-data-quality'); state = result.state;
  state = run(state, 'faculty-data', 'selectApplication', { applicationId: result.id });
  const appointment = currentAppointment(state, result.id);
  state = run(state, 'student-main', 'respondOffer', { appointmentId: appointment.id, accept: true });
  state = run(state, 'admin', 'clearAppointment', { appointmentId: appointment.id, status: 'cleared' });
  assert.equal(state.appointments.find(item => item.id === appointment.id).status, 'active');
  assert.equal(getCourseRole(state, 'student-main', 'cs201', NOW), 'student');
});

test('role scopes and analytics keep student/TA review controls and other faculty courses unavailable', () => {
  const state = createInitialState(NOW);
  assert.equal(getRoleViews(state, 'student-main').canHire, false);
  assert.equal(getRoleViews(state, 'ta-labs').canHire, false);
  assert.equal(getRoleViews(state, 'faculty-algorithms').managedOpportunities.some(item => item.courseId === 'cs101'), false);
  assert.throws(() => getInsights(state, 'student-main'), /managers/);
  assert.throws(() => getInsights(state, 'faculty-algorithms', 'cs101'), /manage/);
  const report = getInsights(state, 'admin', null, NOW);
  assert.equal(report.courses.length, 10);
  assert.ok(report.totals.requests > 100);
  assert.ok(report.courses.some(course => course.helpers.some(helper => helper.ratingCount >= 2)));
});

test('local storage handles unavailable persistence, malformed data and stale tab updates without overwriting newer work', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const initial = createInitialState(NOW);
  assert.equal(saveState(storage, initial), true);
  const first = loadState(storage, NOW), second = loadState(storage, NOW);
  const changed = login(first, 'student-two');
  assert.equal(saveState(storage, changed), true);
  assert.equal(saveState(storage, login(second, 'admin')), false);
  assert.equal(loadState(storage, NOW).currentActorId, 'student-two');
  assert.equal(saveState({ getItem() { throw new Error('Unavailable'); } }, initial), false);
  values.set(STORAGE_KEY, '{malformed');
  assert.equal(loadState(storage, NOW).actors.length, 41);
  values.set(STORAGE_KEY, JSON.stringify({ ...initial, actors: [null] }));
  assert.equal(loadState(storage, NOW).actors.length, 41);
});

test('handoff preserves each helper contact interval and feedback cannot target an unrelated person', () => {
  let state = createInitialState(NOW);
  const first = state.queueEntries.find(item => item.courseId === 'cs101' && item.helperId === 'ta-main');
  const occupied = state.queueEntries.find(item => item.courseId === 'cs101' && item.helperId === 'ta-two');
  state = run(state, 'ta-two', 'queueAction', { entryId: occupied.id, action: 'complete' });
  state = run(state, 'ta-main', 'queueAction', { entryId: first.id, action: 'handoff', helperId: 'ta-two' }, later(1));
  state = run(state, 'ta-two', 'queueAction', { entryId: first.id, action: 'complete' }, later(4));
  const session = state.helpSessions.at(-1);
  assert.deepEqual(session.helperIds, ['ta-main', 'ta-two']);
  assert.equal(session.helpMinutes, 9);
  assert.equal(session.segments[0].helpMinutes, 6);
  assert.equal(session.segments[1].helpMinutes, 3);
  assert.throws(() => run(state, first.studentId, 'submitFeedback', { sessionId: session.id, helperId: 'ta-labs', rating: 5 }, later(5)), /recorded helper/);
  state = run(state, first.studentId, 'submitFeedback', { sessionId: session.id, helperId: 'ta-main', rating: 4 }, later(5));
  assert.equal(state.feedback[0].helperId, 'ta-main');
});

test('future appointments activate only after their start and expired access cannot start another shift', () => {
  let state = createInitialState(NOW);
  assert.notEqual(getCourseRole(state, 'candidate-20', 'cs316', NOW), 'ta');
  const start = new Date(NOW.getTime() + 15 * 86400000);
  state = run(state, 'candidate-20', 'signIn', {}, start);
  assert.equal(getCourseRole(state, 'candidate-20', 'cs316', start), 'ta');
  const end = new Date(NOW.getTime() + 80 * 86400000);
  assert.notEqual(getCourseRole(state, 'candidate-20', 'cs316', end), 'ta');
  assert.throws(() => run(state, 'candidate-20', 'duty', { courseId: 'cs316', on: true }, end), /staff/);
});

test('an older tab cannot resurrect a workspace after another tab resets or removes it', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(saveState(storage, createInitialState(NOW)), true);
  const old = loadState(storage, NOW);
  const reset = createInitialState(later(1));
  assert.equal(saveState(storage, reset), true);
  assert.equal(saveState(storage, login(old, 'admin')), false);
  assert.equal(loadState(storage, later(1)).workspaceId, reset.workspaceId);
  values.delete(STORAGE_KEY);
  assert.equal(saveState(storage, login(old, 'student-two')), false);
});

test('an explicit fresh scenario repairs malformed storage while a previously persisted tab cannot repair it with stale data', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(saveState(storage, createInitialState(NOW)), true);
  const old = loadState(storage, NOW);
  values.set(STORAGE_KEY, '{malformed');
  assert.equal(saveState(storage, login(old, 'admin')), false);
  const reset = loadState(storage, later(1));
  assert.equal(saveState(storage, reset), true);
  const restored = loadState(storage, later(1));
  assert.equal(restored.workspaceId, reset.workspaceId);
  assert.equal(restored.actors.length, 41);
  assert.equal(restored.currentActorId, null);
  assert.equal(saveState(storage, login(old, 'student-two')), false);
});
