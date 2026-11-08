import { SEED_CATALOG, SEED_REFERENCE } from './data.mjs';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'campusworks.browser-demo.v1';
export const PERSONAS = Object.freeze([
  { id: 'student-two', role: 'student', label: 'Student', name: 'Avery Chen', description: 'Accept a prepared CS201 offer and become a TA.' },
  { id: 'ta-labs', role: 'ta', label: 'TA', name: 'Quinn Bennett', description: 'Run the CS201 office-hours queue.' },
  { id: 'faculty-algorithms', role: 'instructor', label: 'Instructor', name: 'Prof. Cameron Wells', description: 'Review applicants and manage CS201 staffing.' },
  { id: 'admin', role: 'admin', label: 'Administrator', name: 'Morgan Ellis', description: 'Approve positions, record clearance and review the department.' },
]);

const DAY = 86400000;
const TERMINAL = new Set(['ended', 'declined', 'rescinded', 'expired', 'not_cleared', 'cancelled']);
const REVIEWABLE = new Set(['submitted', 'under_review', 'shortlisted']);
const PUBLIC = new Set(['published', 'applications_closed', 'filled']);
const persistenceBase = new WeakMap();
const clone = value => structuredClone(value);
const iso = value => new Date(value).toISOString();
const validDate = value => Number.isFinite(new Date(value).getTime());
const fail = message => { throw new Error(message); };
const need = (condition, message) => { if (!condition) fail(message); };
const trimmed = (value, maximum = 4000) => String(value ?? '').trim().slice(0, maximum);
const find = (rows, id, label = 'Record') => rows.find(row => row.id === id) || fail(`${label} was not found.`);
const actor = (state, actorId) => find(state.actors, actorId, 'Account');
const overlap = (left, right) => new Date(left.startDate) < new Date(right.endDate) && new Date(right.startDate) < new Date(left.endDate);
const activeCommitment = appointment => !TERMINAL.has(appointment.status);

function rebase(value, offset) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return new Date(new Date(value).getTime() + offset).toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(new Date(`${value}T12:00:00.000Z`).getTime() + offset).toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(item => rebase(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, offset)]));
  return value;
}

function appointmentForStage(application, opportunity, timestamp) {
  const stage = application.stage;
  if (!['offered', 'pending_clearance', 'needs_information', 'active', 'pending_start', 'suspended', 'ended', 'declined', 'rescinded', 'not_cleared'].includes(stage)) return null;
  const accepted = ['pending_clearance', 'needs_information', 'active', 'pending_start', 'suspended', 'ended', 'not_cleared'].includes(stage);
  return {
    id: `appointment-${application.key}`, applicationId: application.key, opportunityId: opportunity.id,
    applicantId: application.actorKey, courseId: opportunity.courseId, type: opportunity.type, termId: opportunity.termId,
    status: stage === 'needs_information' ? 'pending_clearance' : stage,
    clearance: stage === 'needs_information' ? 'needs_information' : ['active', 'pending_start', 'suspended', 'ended'].includes(stage) ? 'cleared' : stage === 'not_cleared' ? 'not_cleared' : accepted ? 'pending' : 'not_started',
    startDate: opportunity.appointmentStart, endDate: opportunity.appointmentEnd,
    offerExpiresAt: new Date(new Date(timestamp).getTime() + 7 * DAY).toISOString(),
    acceptedAt: accepted ? new Date(new Date(timestamp).getTime() - 2 * DAY).toISOString() : null,
    createdAt: new Date(new Date(timestamp).getTime() - 3 * DAY).toISOString(),
    ...(stage === 'ended' ? { endedAt: new Date(new Date(timestamp).getTime() - DAY).toISOString(), endReason: application.reason } : {}),
  };
}

export function createInitialState(now = new Date()) {
  const timestamp = iso(now);
  const reference = new Date(timestamp).getTime();
  const catalog = rebase(SEED_CATALOG, (Math.floor(reference / DAY) - Math.floor(new Date(SEED_REFERENCE).getTime() / DAY)) * DAY);
  const courses = catalog.courses.map(course => ({
    id: course.code, code: course.code, title: course.title, key: course.key,
    instructorId: course.instructorKey, taIds: [...course.taKeys], enrolledIds: [...course.studentKeys], restrictedIds: [],
    onDutyIds: course.queueState === 'closed' ? [] : [...course.taKeys], queueState: course.queueState, skills: course.skills,
    announcements: course.announcements.map((message, index) => ({ id: `${course.code}-announcement-${index}`, authorId: course.instructorKey, message, createdAt: timestamp })),
  }));
  const courseMap = new Map(courses.map(course => [course.key, course.id]));
  const opportunities = catalog.opportunities.map(posting => ({
    ...posting.input, id: posting.key, ownerId: posting.ownerKey, termId: 'current', status: posting.stage,
    approved: !['draft', 'pending_approval'].includes(posting.stage), version: 1, createdAt: timestamp,
  }));
  const opportunityMap = new Map(opportunities.map(posting => [posting.id, posting]));
  const appointments = catalog.applications.map(application => appointmentForStage(application, opportunityMap.get(application.opportunityKey), timestamp)).filter(Boolean);
  const appointmentMap = new Map(appointments.map(appointment => [appointment.applicationId, appointment]));
  const applications = catalog.applications.map(application => {
    const appointment = appointmentMap.get(application.key);
    const draft = application.stage.startsWith('draft');
    const status = draft ? 'draft' : appointment ? 'selected' : application.stage;
    const record = {
      id: application.key, applicantId: application.actorKey, opportunityId: application.opportunityKey, status,
      profile: { ...application.profile, graduationTerm: `Spring ${new Date(timestamp).getUTCFullYear() + 1}` },
      answers: application.answers, qualificationText: application.qualificationText,
      cv: application.cv ? { name: application.cv.name, type: 'text/plain', size: application.cv.text.length } : null,
      version: 1, createdAt: timestamp, submittedAt: draft ? null : timestamp,
    };
    if (!draft) record.submittedSnapshot = { profile: clone(record.profile), answers: clone(record.answers), qualificationText: record.qualificationText, cv: clone(record.cv) };
    return record;
  });
  const queueEntries = catalog.queuePlans.flatMap(plan => plan.entries.map((entry, index) => ({
    id: `queue-${plan.courseKey}-${index}`, courseId: courseMap.get(plan.courseKey), studentId: entry.actorKey,
    location: entry.location, question: entry.question, status: entry.state, helperId: entry.helperKey || null,
    joinedAt: new Date(reference - (20 - index * 2) * 60000).toISOString(),
    helpStartedAt: entry.state === 'helping' ? new Date(reference - 5 * 60000).toISOString() : null,
  })));
  const helpSessions = catalog.history.map(session => ({
    ...session, id: session.key, courseId: courseMap.get(session.courseKey), termId: session.termKey,
    studentId: session.actorKey, helperId: session.wasHelped ? session.helperKey : null,
  }));
  const state = {
    schemaVersion: SCHEMA_VERSION, workspaceId: `workspace-${reference}`, revision: 0, nextId: 1,
    createdAt: timestamp, savedAt: timestamp, currentActorId: null, synthetic: true,
    term: { id: 'current', ...catalog.terms.current, name: `${new Date(timestamp).getUTCMonth() >= 7 ? 'Fall' : new Date(timestamp).getUTCMonth() >= 5 ? 'Summer' : 'Spring'} ${new Date(timestamp).getUTCFullYear()} · Demo` },
    cycle: { ...catalog.cycle, termId: 'current' },
    actors: catalog.actors.map(person => ({ ...person, id: person.key })),
    courses, opportunities, applications, appointments, queueEntries, helpSessions,
    workload: catalog.workloads.map(work => ({ ...work, id: work.key, actorId: find(applications, work.applicationKey).applicantId, appointmentId: `appointment-${work.applicationKey}`, courseId: opportunityMap.get(find(applications, work.applicationKey).opportunityId).courseId })),
    feedback: catalog.feedback.map(feedback => ({ ...feedback, id: feedback.key, courseId: courseMap.get(feedback.courseKey), termId: feedback.termKey, studentId: feedback.actorKey, helperId: feedback.helperKey || null, sessionId: feedback.helpSessionKey || null })),
    events: [],
  };
  refreshCapacity(state);
  persistenceBase.set(state, null);
  return state;
}

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function loadState(storage, now = new Date()) {
  try {
    const saved = JSON.parse(safeStorage(storage)?.getItem(STORAGE_KEY) || 'null');
    need(saved?.schemaVersion === SCHEMA_VERSION && typeof saved.workspaceId === 'string' && Number.isInteger(saved.revision), 'The local scenario format changed.');
    for (const key of ['actors', 'courses', 'opportunities', 'applications', 'appointments', 'queueEntries', 'helpSessions', 'workload', 'feedback', 'events']) need(Array.isArray(saved[key]), 'Incomplete local scenario.');
    need(saved.actors.length > 0 && saved.term && saved.cycle && Number.isInteger(saved.nextId), 'Incomplete local scenario.');
    need(saved.actors.every(person => person && typeof person.id === 'string' && typeof person.name === 'string' && ['student', 'ta', 'instructor', 'admin'].includes(person.role)), 'Invalid local account.');
    need(saved.courses.every(course => course && typeof course.id === 'string' && ['taIds', 'enrolledIds', 'restrictedIds', 'onDutyIds', 'announcements'].every(key => Array.isArray(course[key]))), 'Invalid local course.');
    need(['opportunities', 'applications', 'appointments', 'queueEntries', 'helpSessions', 'workload', 'feedback', 'events'].every(key => saved[key].every(item => item && typeof item.id === 'string')), 'Invalid local record.');
    if (saved.currentActorId && !saved.actors.some(person => person.id === saved.currentActorId)) saved.currentActorId = null;
    reconcile(saved, now);
    persistenceBase.set(saved, saved.revision);
    return saved;
  } catch { return createInitialState(now); }
}

export function saveState(storage, state) {
  if (state === undefined) { state = storage; storage = undefined; }
  try {
    const target = safeStorage(storage);
    if (!target) return false;
    let existing = null;
    const serialized = target.getItem(STORAGE_KEY);
    try { existing = JSON.parse(serialized || 'null'); } catch {}
    const base = persistenceBase.has(state) ? persistenceBase.get(state) : state.revision - 1;
    if (base !== null && existing?.workspaceId !== state.workspaceId) return false;
    if (existing?.workspaceId === state.workspaceId && existing.revision !== base) {
      if (JSON.stringify(existing) === JSON.stringify(state)) return true;
      return false;
    }
    target.setItem(STORAGE_KEY, JSON.stringify(state));
    persistenceBase.set(state, state.revision);
    return true;
  } catch { return false; }
}

export function currentActor(state) { return state.actors.find(person => person.id === state.currentActorId) || null; }
export function getCourseRole(state, actorId, courseId, now = new Date()) {
  if (state.courses.some(item => item.id === actorId)) [actorId, courseId] = [courseId || state.currentActorId, actorId];
  const person = state.actors.find(item => item.id === actorId);
  const course = state.courses.find(item => item.id === courseId);
  if (!person || !course) return 'none';
  if (person.role === 'admin') return 'admin';
  if (course.instructorId === actorId) return 'instructor';
  if (course.taIds.includes(actorId)) return 'ta';
  const time = new Date(now).getTime();
  if (state.appointments.some(appointment => appointment.applicantId === actorId && appointment.courseId === courseId && appointment.type === 'ta' && appointment.status === 'active' && appointment.clearance === 'cleared' && appointment.acceptedAt && new Date(appointment.startDate).getTime() <= time && new Date(appointment.endDate).getTime() > time)) return 'ta';
  return course.enrolledIds.includes(actorId) && !course.restrictedIds.includes(actorId) ? 'student' : 'none';
}

function canManage(state, person, posting) { return person.role === 'admin' || posting.ownerId === person.id || (posting.type === 'ta' && state.courses.some(course => course.id === posting.courseId && course.instructorId === person.id)); }
function courseManager(state, person, course) { return person.role === 'admin' || course.instructorId === person.id; }
function refreshCapacity(state) {
  for (const posting of state.opportunities) {
    posting.committedPositions = state.appointments.filter(appointment => appointment.opportunityId === posting.id && activeCommitment(appointment)).length;
    posting.openPositions = Math.max(0, posting.positions - posting.committedPositions);
  }
}
function hasConflict(state, personId, proposed, exceptId) {
  return state.appointments.some(item => item.id !== exceptId && item.applicantId === personId && activeCommitment(item) && (item.termId === proposed.termId || overlap(item, proposed)));
}
function clearClaims(state, personId, courseId, timestamp) {
  for (const entry of state.queueEntries.filter(item => item.helperId === personId && (!courseId || item.courseId === courseId))) {
    closeSegment(entry, timestamp);
    entry.helperId = null; entry.helpStartedAt = null; entry.status = 'waiting';
  }
  for (const course of state.courses) if (!courseId || course.id === courseId) course.onDutyIds = course.onDutyIds.filter(id => id !== personId);
}
function endAppointment(state, appointment, reason, timestamp, status = 'ended') {
  appointment.status = status; appointment.endedAt = timestamp; appointment.endReason = reason;
  if (appointment.type === 'ta' && getCourseRole(state, appointment.applicantId, appointment.courseId, timestamp) !== 'ta') clearClaims(state, appointment.applicantId, appointment.courseId, timestamp);
}
function reconcile(state, now) {
  const timestamp = iso(now);
  for (const appointment of state.appointments) {
    if (TERMINAL.has(appointment.status)) continue;
    if (appointment.status === 'offered' && new Date(appointment.offerExpiresAt) <= new Date(timestamp)) endAppointment(state, appointment, 'The offer expired.', timestamp, 'expired');
    else if (new Date(appointment.endDate) <= new Date(timestamp)) endAppointment(state, appointment, 'The appointment period ended.', timestamp);
    else if (appointment.status === 'pending_start' && appointment.clearance === 'cleared' && appointment.acceptedAt && new Date(appointment.startDate) <= new Date(timestamp)) {
      const course = state.courses.find(item => item.id === appointment.courseId);
      if (appointment.type === 'ta' && course?.restrictedIds.includes(appointment.applicantId)) appointment.status = 'suspended';
      else if (!hasConflict(state, appointment.applicantId, appointment, appointment.id)) appointment.status = 'active';
    }
  }
  refreshCapacity(state);
}
function cycleOpen(state, now, submission = false) {
  const time = new Date(now).getTime();
  return state.cycle.enabled && time >= new Date(state.cycle.opensAt).getTime() && time < new Date(state.term.endDate).getTime() && (!submission || time < new Date(state.cycle.closesAt).getTime());
}
function allocation(state, application, posting, timestamp) {
  const course = state.courses.find(item => item.id === posting.courseId);
  need(!course?.restrictedIds.includes(application.applicantId), 'Restore this student before making an offer.');
  need(posting.openPositions > 0, 'All approved positions are reserved.');
  const proposed = { applicantId: application.applicantId, termId: posting.termId, startDate: posting.appointmentStart, endDate: posting.appointmentEnd };
  need(!hasConflict(state, application.applicantId, proposed), 'This applicant already has a conflicting offer or appointment.');
  const appointment = { ...proposed, id: `appointment-${application.id}-${state.nextId++}`, applicationId: application.id, opportunityId: posting.id, courseId: posting.courseId, type: posting.type, status: 'offered', clearance: 'not_started', acceptedAt: null, createdAt: timestamp, offerExpiresAt: new Date(Math.min(new Date(timestamp).getTime() + 7 * DAY, new Date(posting.appointmentEnd).getTime())).toISOString() };
  state.appointments.push(appointment); application.status = 'selected'; application.version++;
}
function closeSegment(entry, timestamp) {
  if (!entry.helperId || !entry.helpStartedAt) return;
  entry.segments ||= [];
  entry.segments.push({ helperId: entry.helperId, startedAt: entry.helpStartedAt, endedAt: timestamp, helpMinutes: Math.max(0.01, (new Date(timestamp).getTime() - new Date(entry.helpStartedAt).getTime()) / 60000) });
  entry.helpStartedAt = null;
}
function sessionFrom(state, entry, timestamp, reason) {
  closeSegment(entry, timestamp);
  const joined = new Date(entry.joinedAt).getTime();
  const segments = entry.segments || [];
  const helpStart = segments.length ? new Date(segments[0].startedAt).getTime() : null;
  const session = { id: `session-${state.nextId++}`, courseId: entry.courseId, termId: 'current', studentId: entry.studentId, helperId: segments.at(-1)?.helperId || null, helperIds: [...new Set(segments.map(segment => segment.helperId))], segments: clone(segments), question: entry.question, location: entry.location, joinedAt: entry.joinedAt, closedAt: timestamp, leftQueueAt: timestamp, wasHelped: segments.length > 0, waitMinutes: helpStart ? Math.max(0, (helpStart - joined) / 60000) : null, helpMinutes: segments.reduce((total, segment) => total + segment.helpMinutes, 0), endReason: reason, synthetic: true };
  state.helpSessions.push(session); state.queueEntries = state.queueEntries.filter(item => item.id !== entry.id);
  return session;
}
function requireStaff(state, person, course, now) {
  const role = getCourseRole(state, person.id, course.id, now);
  need(['admin', 'instructor', 'ta'].includes(role), 'Course staff access is required.');
  if (role === 'ta') need(course.onDutyIds.includes(person.id), 'Start duty before operating the queue.');
}
function nextRecord(state, prefix) { return `${prefix}-${state.nextId++}`; }

export function command(previous, input, now = new Date()) {
  need(previous?.schemaVersion === SCHEMA_VERSION && input && typeof input.type === 'string', 'The local command is invalid.');
  if (input.expectedRevision !== undefined) need(input.expectedRevision === previous.revision, 'The workspace changed. Review its latest state before trying again.');
  const state = clone(previous);
  const timestamp = iso(now);
  reconcile(state, timestamp);
  if (input.type === 'signIn') {
    actor(state, input.actorId); state.currentActorId = input.actorId;
  } else if (input.type === 'signOut') state.currentActorId = null;
  else {
    const person = actor(state, input.actorId || state.currentActorId);
    const posting = input.opportunityId ? find(state.opportunities, input.opportunityId, 'Position') : null;
    const application = input.applicationId ? find(state.applications, input.applicationId, 'Application') : null;
    const appointment = input.appointmentId ? find(state.appointments, input.appointmentId, 'Appointment') : null;
    const course = input.courseId ? find(state.courses, input.courseId, 'Course') : null;
    if (input.type === 'setCycle') {
      need(person.role === 'admin', 'Only the administrator controls recruitment.');
      state.cycle.enabled = !!input.enabled;
    } else if (input.type === 'createOpportunity') {
      need(['admin', 'instructor'].includes(person.role), 'Only instructors and administrators publish positions.');
      need(cycleOpen(state, timestamp, true), 'Recruitment is not open.');
      const values = input.input || input;
      const type = values.type === 'ra' ? 'ra' : 'ta';
      const linked = type === 'ta' ? find(state.courses, values.courseId, 'Course') : null;
      if (linked) need(courseManager(state, person, linked), 'Choose a course you manage.');
      const positions = Number(values.positions ?? 1), weeklyHours = Number(values.weeklyHours ?? 10);
      need(trimmed(values.title, 160), 'Enter a position title.');
      need(Number.isInteger(positions) && positions >= 1 && positions <= 20, 'Positions must be between 1 and 20.');
      need(Number.isFinite(weeklyHours) && weeklyHours > 0 && weeklyHours <= 20, 'Weekly hours must be greater than zero and at most 20.');
      const start = values.appointmentStart || timestamp, end = values.appointmentEnd || new Date(new Date(timestamp).getTime() + 49 * DAY).toISOString();
      need(validDate(start) && validDate(end) && new Date(start) < new Date(end) && new Date(end) > new Date(timestamp), 'Choose valid appointment dates.');
      state.opportunities.unshift({
        id: nextRecord(state, 'position'), ownerId: person.id, courseId: linked?.id || '', type, termId: 'current',
        title: trimmed(values.title, 160), description: trimmed(values.description), requiredSkills: trimmed(values.requiredSkills), preferredSkills: trimmed(values.preferredSkills),
        positions, weeklyHours, appointmentStart: iso(start), appointmentEnd: iso(end), applicationDeadline: state.cycle.closesAt,
        requiresAttendance: !!values.requiresAttendance, hasLab: !!values.hasLab, hasDiscussion: !!values.hasDiscussion, requiresGrading: !!values.requiresGrading, holdsOfficeHours: !!values.holdsOfficeHours,
        duties: Array.isArray(values.duties) ? clone(values.duties).slice(0, 12) : [],
        questions: (Array.isArray(values.questions) ? values.questions : [{ id: 'experience', prompt: 'What preparation would you bring to this role?', required: true }]).slice(0, 10).map((question, index) => ({ id: question.id || `question-${index + 1}`, prompt: trimmed(question.prompt, 500), required: question.required !== false })),
        cvRequired: values.cvRequired !== false, status: 'draft', approved: person.role === 'admin', version: 1, createdAt: timestamp,
      });
    } else if (['publishOpportunity', 'approveOpportunity', 'closeOpportunity', 'archiveOpportunity'].includes(input.type)) {
      need(posting && canManage(state, person, posting), 'You do not manage this position.');
      if (input.type === 'publishOpportunity') {
        need(cycleOpen(state, timestamp, true), 'Recruitment is not open.'); need(posting.status === 'draft', 'Only a draft can be published.');
        posting.status = posting.approved ? 'published' : 'pending_approval';
      } else if (input.type === 'approveOpportunity') {
        need(person.role === 'admin', 'Only the administrator can approve publication.'); need(posting.status === 'pending_approval', 'This position is not awaiting approval.');
        need(cycleOpen(state, timestamp, true), 'Recruitment is not open.'); posting.approved = true; posting.status = 'published';
      } else if (input.type === 'closeOpportunity') { need(PUBLIC.has(posting.status), 'This position is not open.'); posting.status = 'applications_closed'; }
      else { need(!state.appointments.some(item => item.opportunityId === posting.id && activeCommitment(item)), 'End unresolved appointments before archiving.'); posting.status = 'archived'; }
      posting.version++;
    } else if (input.type === 'saveApplication') {
      need(['student', 'ta'].includes(person.role), 'Use a student or TA identity to apply.');
      need(posting && posting.approved && posting.status === 'published' && new Date(posting.appointmentEnd) > new Date(timestamp) && cycleOpen(state, timestamp, true), 'This position is not accepting applications.');
      let record = application || state.applications.find(item => item.opportunityId === posting.id && item.applicantId === person.id);
      if (record) need(record.opportunityId === posting.id, 'The application and position do not match.');
      if (record) need(record.applicantId === person.id && ['draft', 'withdrawn'].includes(record.status), 'Only your draft can be edited.');
      else { record = { id: nextRecord(state, 'application'), applicantId: person.id, opportunityId: posting.id, status: 'draft', profile: {}, answers: {}, qualificationText: '', cv: null, version: 0, createdAt: timestamp, submittedAt: null }; state.applications.push(record); }
      if (input.profile) record.profile = { ...record.profile, ...clone(input.profile) };
      const name = person.name.split(' ');
      record.profile.firstName ||= name[0]; record.profile.lastName ||= name.slice(1).join(' '); record.profile.preferredEmail ||= person.email;
      record.profile.availableHours = Number(record.profile.availableHours ?? 10);
      need(Number.isFinite(record.profile.availableHours) && record.profile.availableHours > 0 && record.profile.availableHours <= 20, 'Available hours must be greater than zero and at most 20.');
      if (input.answers) record.answers = Object.fromEntries(Object.entries(input.answers).map(([key, value]) => [trimmed(key, 80), trimmed(value)]));
      if (input.qualificationText !== undefined) record.qualificationText = trimmed(input.qualificationText);
      if (input.cv !== undefined) {
        if (input.cv === null) record.cv = null;
        else {
          need(Number(input.cv.size) > 0 && Number(input.cv.size) <= 5 * 1024 * 1024 && /\.(?:pdf|txt)$/i.test(input.cv.name || ''), 'Choose a PDF or TXT CV of at most 5 MB.');
          record.cv = { name: trimmed(input.cv.name, 160), type: trimmed(input.cv.type, 100), size: Number(input.cv.size) };
        }
      }
      record.status = 'draft'; record.version++; record.updatedAt = timestamp;
    } else if (input.type === 'submitApplication') {
      need(application?.applicantId === person.id, 'Only the applicant can submit.');
      const position = find(state.opportunities, application.opportunityId, 'Position');
      need(position.status === 'published' && position.approved && cycleOpen(state, timestamp, true) && new Date(position.appointmentEnd) > new Date(timestamp), 'This position is not accepting applications.');
      need(application.status === 'draft', 'Only a draft can be submitted.');
      need(!position.cvRequired || application.cv, 'Add a CV filename before submitting.');
      need(position.questions.every(question => !question.required || trimmed(application.answers[question.id])), 'Answer every required question.');
      need(application.profile.availableHours >= position.weeklyHours, 'Available hours do not cover the stated weekly work.');
      application.submittedSnapshot = { profile: clone(application.profile), answers: clone(application.answers), qualificationText: application.qualificationText, cv: clone(application.cv) };
      application.status = 'submitted'; application.submittedAt = timestamp; application.version++;
    } else if (input.type === 'withdrawApplication') {
      need(application?.applicantId === person.id, 'Only the applicant can withdraw.');
      const live = state.appointments.find(item => item.applicationId === application.id && activeCommitment(item));
      need(!live?.acceptedAt, 'An accepted appointment must be ended by its manager.');
      if (live) endAppointment(state, live, 'The applicant withdrew.', timestamp, 'cancelled');
      application.status = 'withdrawn'; application.version++;
    } else if (input.type === 'reviewApplication' || input.type === 'selectApplication') {
      need(application, 'Choose an application.');
      const position = find(state.opportunities, application.opportunityId, 'Position');
      need(canManage(state, person, position), 'Only the managing instructor or administrator can review.');
      need(cycleOpen(state, timestamp) && position.approved && PUBLIC.has(position.status) && new Date(position.appointmentEnd) > new Date(timestamp), 'This position is not available for review.');
      need(REVIEWABLE.has(application.status), 'This application is not available for a new decision.');
      if (input.type === 'selectApplication') allocation(state, application, position, timestamp);
      else { need(['under_review', 'shortlisted', 'not_selected'].includes(input.decision), 'Choose a valid review decision.'); application.status = input.decision; application.version++; }
    } else if (input.type === 'respondOffer') {
      need(appointment?.applicantId === person.id && appointment.status === 'offered', 'Only the recipient can answer an open offer.');
      if (input.accept) {
        need(!hasConflict(state, person.id, appointment, appointment.id), 'Another appointment conflicts with this offer.');
        appointment.acceptedAt = timestamp; appointment.status = 'pending_clearance'; appointment.clearance = 'pending';
      } else endAppointment(state, appointment, 'The recipient declined.', timestamp, 'declined');
    } else if (['clearAppointment', 'endAppointment', 'suspendAppointment', 'resumeAppointment'].includes(input.type)) {
      need(appointment, 'Choose an appointment.');
      const position = find(state.opportunities, appointment.opportunityId, 'Position');
      need(canManage(state, person, position), 'You do not manage this appointment.');
      if (input.type === 'clearAppointment') {
        need(person.role === 'admin', 'Only the administrator records clearance.');
        need(appointment.acceptedAt && ['pending_clearance', 'pending_start'].includes(appointment.status), 'Acceptance must come before clearance.');
        need(['cleared', 'needs_information', 'not_cleared'].includes(input.status), 'Choose a clearance result.');
        if (input.status === 'not_cleared') { appointment.clearance = 'not_cleared'; endAppointment(state, appointment, 'Administrative clearance was not granted.', timestamp, 'not_cleared'); }
        else {
          need(!hasConflict(state, appointment.applicantId, appointment, appointment.id), 'A conflicting appointment prevents activation.');
          const linked = state.courses.find(item => item.id === appointment.courseId);
          need(!linked?.restrictedIds.includes(appointment.applicantId), 'Restore the student before activating course access.');
          appointment.clearance = input.status; appointment.status = input.status === 'cleared' ? new Date(appointment.startDate) <= new Date(timestamp) ? 'active' : 'pending_start' : 'pending_clearance';
        }
      } else if (input.type === 'endAppointment') {
        need(!TERMINAL.has(appointment.status), 'This appointment has already ended.');
        need(trimmed(input.reason), 'Enter a reason for ending the appointment.'); endAppointment(state, appointment, trimmed(input.reason), timestamp);
      } else if (input.type === 'suspendAppointment') {
        need(appointment.status === 'active', 'Only an active appointment can be suspended.'); need(trimmed(input.reason), 'Enter a suspension reason.'); appointment.status = 'suspended'; appointment.suspensionReason = trimmed(input.reason);
        if (getCourseRole(state, appointment.applicantId, appointment.courseId, timestamp) !== 'ta') clearClaims(state, appointment.applicantId, appointment.courseId, timestamp);
      } else {
        need(appointment.status === 'suspended' && appointment.clearance === 'cleared' && appointment.acceptedAt, 'This appointment cannot be resumed.');
        need(!hasConflict(state, appointment.applicantId, appointment, appointment.id), 'A conflicting appointment prevents resuming.');
        const linked = state.courses.find(item => item.id === appointment.courseId);
        need(!linked?.restrictedIds.includes(appointment.applicantId), 'Restore the student before resuming.'); appointment.status = new Date(appointment.startDate) <= new Date(timestamp) ? 'active' : 'pending_start';
      }
    } else if (input.type === 'enroll') {
      need(course, 'Choose a course.'); need(!course.restrictedIds.includes(person.id), 'An instructor or administrator must restore your access.');
      if (input.enroll === false) {
        course.enrolledIds = course.enrolledIds.filter(id => id !== person.id);
        for (const entry of state.queueEntries.filter(item => item.courseId === course.id && item.studentId === person.id)) sessionFrom(state, entry, timestamp, 'left');
      } else if (!course.enrolledIds.includes(person.id)) course.enrolledIds.push(person.id);
    } else if (input.type === 'duty') {
      need(course && ['ta', 'instructor', 'admin'].includes(getCourseRole(state, person.id, course.id, timestamp)), 'Course staff access is required.');
      if (input.on) { if (!course.onDutyIds.includes(person.id)) course.onDutyIds.push(person.id); }
      else clearClaims(state, person.id, course.id, timestamp);
    } else if (input.type === 'setQueueState') {
      need(course, 'Choose a course.'); requireStaff(state, person, course, timestamp);
      need(['open', 'paused', 'closed'].includes(input.status), 'Choose a queue state.'); course.queueState = input.status;
      if (input.status === 'closed') { for (const entry of [...state.queueEntries].filter(item => item.courseId === course.id)) sessionFrom(state, entry, timestamp, 'queue_closed'); course.onDutyIds = []; }
    } else if (input.type === 'joinQueue') {
      need(course && getCourseRole(state, person.id, course.id, timestamp) === 'student', 'Enroll as a student before joining this queue.');
      need(course.queueState === 'open', 'The course queue is not open.');
      need(!state.queueEntries.some(item => item.studentId === person.id && item.courseId === course.id), 'You already have a request in this queue.');
      need(trimmed(input.question) && trimmed(input.location, 160), 'Enter your question and location.');
      state.queueEntries.push({ id: nextRecord(state, 'queue'), courseId: course.id, studentId: person.id, question: trimmed(input.question), location: trimmed(input.location, 160), status: 'waiting', helperId: null, helpStartedAt: null, joinedAt: timestamp });
    } else if (input.type === 'leaveQueue') {
      const entry = state.queueEntries.find(item => item.courseId === course?.id && item.studentId === person.id);
      need(entry, 'You have no request in this queue.'); sessionFrom(state, entry, timestamp, 'left');
    } else if (input.type === 'queueAction') {
      const entry = find(state.queueEntries, input.entryId, 'Queue entry');
      const linked = find(state.courses, entry.courseId, 'Course'); requireStaff(state, person, linked, timestamp);
      const manager = courseManager(state, person, linked);
      need(entry.studentId !== person.id, 'You cannot operate your own student request.');
      if (input.action === 'claim') {
        need(entry.status === 'waiting' && !entry.helperId, 'This request is no longer available.');
        need(!state.queueEntries.some(item => item.helperId === person.id && item.status === 'helping'), 'Complete or hand off your current student first.');
        entry.status = 'helping'; entry.helperId = person.id; entry.helpStartedAt = timestamp;
      } else if (input.action === 'complete') {
        need(entry.status === 'helping' && (entry.helperId === person.id || manager), 'Only the assigned helper or course manager can complete this request.'); sessionFrom(state, entry, timestamp, 'completed');
      } else if (input.action === 'pause') {
        need(!entry.helperId || entry.helperId === person.id || manager, 'Another helper owns this request.'); closeSegment(entry, timestamp); entry.status = 'paused'; entry.helperId = null; entry.helpStartedAt = null;
      } else if (input.action === 'resume') { need(entry.status === 'paused', 'This request is not paused.'); entry.status = 'waiting'; }
      else if (input.action === 'remove') { need(!entry.helperId || entry.helperId === person.id || manager, 'Another helper owns this request.'); sessionFrom(state, entry, timestamp, 'removed'); }
      else if (input.action === 'handoff') {
        need(entry.status === 'helping' && (entry.helperId === person.id || manager), 'Only the assigned helper or course manager can hand off.');
        const target = input.helperId;
        need(target && target !== entry.studentId && linked.onDutyIds.includes(target) && ['ta', 'instructor', 'admin'].includes(getCourseRole(state, target, linked.id, timestamp)), 'Choose an available on-duty helper.');
        need(!state.queueEntries.some(item => item.id !== entry.id && item.helperId === target && item.status === 'helping'), 'That helper already has a student.');
        closeSegment(entry, timestamp);
        entry.helperId = target; entry.helpStartedAt = timestamp;
      } else if (['up', 'down'].includes(input.action)) {
        const ordered = state.queueEntries.filter(item => item.courseId === linked.id);
        const at = ordered.findIndex(item => item.id === entry.id), other = ordered[at + (input.action === 'up' ? -1 : 1)];
        if (other) { const left = state.queueEntries.indexOf(entry), right = state.queueEntries.indexOf(other); [state.queueEntries[left], state.queueEntries[right]] = [state.queueEntries[right], state.queueEntries[left]]; }
      } else fail('Choose a valid queue action.');
    } else if (input.type === 'postAnnouncement') {
      need(course, 'Choose a course.'); requireStaff(state, person, course, timestamp); need(trimmed(input.message), 'Enter an announcement.');
      course.announcements.unshift({ id: nextRecord(state, 'announcement'), authorId: person.id, message: trimmed(input.message), createdAt: timestamp });
    } else if (input.type === 'removeStudent' || input.type === 'restoreStudent') {
      need(course && courseManager(state, person, course), 'Only the instructor or administrator manages enrollment restrictions.');
      const student = actor(state, input.studentId); need(student.role === 'student', 'Choose a student account.');
      if (input.type === 'removeStudent') {
        if (!course.restrictedIds.includes(student.id)) course.restrictedIds.push(student.id);
        course.enrolledIds = course.enrolledIds.filter(id => id !== student.id);
        for (const entry of state.queueEntries.filter(item => item.courseId === course.id && item.studentId === student.id)) sessionFrom(state, entry, timestamp, 'restricted');
        for (const item of state.appointments.filter(item => item.applicantId === student.id && item.courseId === course.id && ['active', 'pending_start'].includes(item.status))) item.status = 'suspended';
        clearClaims(state, student.id, course.id, timestamp);
      } else course.restrictedIds = course.restrictedIds.filter(id => id !== student.id);
    } else if (input.type === 'recordWork') {
      if (appointment) need(appointment.applicantId === person.id && appointment.status === 'active', 'Choose your own active appointment.');
      const own = appointment || state.appointments.find(item => item.applicantId === person.id && item.courseId === course?.id && item.status === 'active');
      const linked = course || state.courses.find(item => item.id === own?.courseId);
      need((own?.applicantId === person.id && own.status === 'active') || (linked && getCourseRole(state, person.id, linked.id, timestamp) === 'ta'), 'Record work only for your active assignment.');
      const hours = Number(input.hours); need(Number.isFinite(hours) && hours > 0 && hours <= 20, 'Hours must be greater than zero and at most 20.');
      need(['office_hours', 'lab', 'discussion', 'grading', 'preparation', 'coordination', ...(own?.type === 'ra' ? ['research'] : [])].includes(input.kind), 'Choose a work category.');
      state.workload.push({ id: nextRecord(state, 'work'), actorId: person.id, courseId: linked?.id || '', appointmentId: own?.id || null, kind: input.kind, hours, notes: trimmed(input.notes), date: timestamp.slice(0, 10), createdAt: timestamp });
    } else if (input.type === 'submitFeedback') {
      const session = find(state.helpSessions, input.sessionId, 'Help session');
      need(session.studentId === person.id && session.wasHelped && session.helperId, 'Choose your own completed help session.');
      const helperId = input.helperId || session.helperId;
      need((session.helperIds || [session.helperId]).includes(helperId), 'Choose a recorded helper from your session.');
      need(!state.feedback.some(item => item.sessionId === session.id && item.studentId === person.id && item.helperId === helperId), 'You already submitted feedback for this helper session.');
      const rating = Number(input.rating); need(Number.isInteger(rating) && rating >= 1 && rating <= 5, 'Choose a rating from 1 to 5.');
      state.feedback.unshift({ id: nextRecord(state, 'feedback'), courseId: session.courseId, termId: 'current', studentId: person.id, helperId, sessionId: session.id, ratingScope: 'helper', rating, positive: trimmed(input.positive), negative: trimmed(input.negative), allowContact: !!input.allowContact, createdAt: timestamp });
    } else fail('This browser action is not supported.');
    state.events.unshift({ id: nextRecord(state, 'event'), actorId: person.id, type: input.type, targetId: input.applicationId || input.appointmentId || input.opportunityId || input.courseId || input.entryId || '', createdAt: timestamp });
    state.events = state.events.slice(0, 100);
  }
  state.revision++; state.savedAt = timestamp; refreshCapacity(state);
  persistenceBase.set(state, persistenceBase.has(previous) ? persistenceBase.get(previous) : previous.revision);
  return state;
}

export const transition = (state, actorId, action, now) => command(state, { ...action, actorId }, now);
export function getRoleViews(state, actorId = state.currentActorId, now = new Date()) {
  const person = state.actors.find(item => item.id === actorId) || null;
  if (!person) return { actor: null, isAdmin: false, canHire: false, canApply: false, myCourses: [], publicOpportunities: [], managedOpportunities: [], myApplications: [], managedApplications: [], myAppointments: [], managedAppointments: [] };
  const managed = state.opportunities.filter(posting => canManage(state, person, posting));
  const managedIds = new Set(managed.map(posting => posting.id));
  return {
    actor: person, isAdmin: person.role === 'admin', canHire: person.role === 'admin' || person.role === 'instructor', canApply: ['student', 'ta'].includes(person.role),
    myCourses: state.courses.filter(course => getCourseRole(state, person.id, course.id, now) !== 'none'),
    publicOpportunities: state.opportunities.filter(posting => PUBLIC.has(posting.status) && posting.approved && new Date(posting.appointmentEnd) > new Date(now)),
    managedOpportunities: managed,
    myApplications: state.applications.filter(application => application.applicantId === person.id),
    managedApplications: state.applications.filter(application => managedIds.has(application.opportunityId) && application.status !== 'draft'),
    myAppointments: state.appointments.filter(appointment => appointment.applicantId === person.id),
    managedAppointments: state.appointments.filter(appointment => managedIds.has(appointment.opportunityId)),
  };
}

const average = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const percentile = values => values.length ? [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.9) - 1] : null;
export function getInsights(state, actorId = state.currentActorId, courseId = null, now = new Date()) {
  if (state.courses.some(item => item.id === actorId)) [actorId, courseId] = [state.currentActorId, actorId];
  const person = actor(state, actorId);
  need(['admin', 'instructor'].includes(person.role), 'Course managers review operational insights.');
  const accessible = state.courses.filter(course => courseManager(state, person, course));
  if (courseId) need(accessible.some(course => course.id === courseId), 'You do not manage this course.');
  const courses = accessible.filter(course => !courseId || course.id === courseId);
  const time = new Date(now).getTime();
  const since = time - 30 * DAY;
  const allSessions = state.helpSessions.filter(session => courses.some(course => course.id === session.courseId) && new Date(session.joinedAt).getTime() >= since && new Date(session.joinedAt).getTime() <= time);
  const reports = courses.map(course => {
    const sessions = allSessions.filter(session => session.courseId === course.id);
    const helped = sessions.filter(session => session.wasHelped);
    const ratings = state.feedback.filter(item => item.courseId === course.id && item.ratingScope === 'helper' && new Date(item.createdAt).getTime() >= since);
    const plans = state.opportunities.filter(posting => posting.courseId === course.id && posting.type === 'ta' && posting.approved && PUBLIC.has(posting.status) && new Date(posting.appointmentEnd).getTime() > time);
    const approvedPositions = plans.reduce((total, posting) => total + posting.positions, 0);
    const committedPositions = plans.reduce((total, posting) => total + posting.committedPositions, 0);
    const helpers = [...new Set([...course.taIds, ...helped.flatMap(session => session.helperIds || [session.helperId])])].filter(Boolean).map(helperId => {
      const owned = helped.filter(session => (session.helperIds || [session.helperId]).includes(helperId)), feedback = ratings.filter(item => item.helperId === helperId);
      return { actorId: helperId, name: actor(state, helperId).name, sessions: owned.length, averageHelpMinutes: average(owned.map(session => session.segments?.length ? session.segments.filter(segment => segment.helperId === helperId).reduce((total, segment) => total + segment.helpMinutes, 0) : session.helpMinutes)), rating: average(feedback.map(item => item.rating)), ratingCount: feedback.length, distinctReviewers: new Set(feedback.map(item => item.studentId)).size };
    });
    const busy = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const session of sessions) {
      const date = new Date(session.joinedAt), parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
      const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
      if (day >= 0) busy[day][Number(values.hour)]++;
    }
    const workload = state.workload.filter(item => item.courseId === course.id);
    return { id: course.id, courseId: course.id, code: course.code, title: course.title, queueState: course.queueState, requests: sessions.length, helped: helped.length, uniqueStudents: new Set(sessions.map(item => item.studentId)).size, averageWait: average(helped.map(item => item.waitMinutes).filter(Number.isFinite)), p90Wait: percentile(helped.map(item => item.waitMinutes).filter(Number.isFinite)), averageHelp: average(helped.map(item => item.helpMinutes).filter(Number.isFinite)), approvedPositions, committedPositions, openPositions: Math.max(0, approvedPositions - committedPositions), onDuty: course.onDutyIds.length, workloadHours: workload.reduce((total, item) => total + item.hours, 0), helpers, busyHours: busy, feedbackCount: ratings.length, averageRating: average(ratings.map(item => item.rating)) };
  });
  return { courses: reports, totals: { courses: reports.length, requests: reports.reduce((total, course) => total + course.requests, 0), helped: reports.reduce((total, course) => total + course.helped, 0), approvedPositions: reports.reduce((total, course) => total + course.approvedPositions, 0), committedPositions: reports.reduce((total, course) => total + course.committedPositions, 0), openPositions: reports.reduce((total, course) => total + course.openPositions, 0), workloadHours: reports.reduce((total, course) => total + course.workloadHours, 0) }, limitations: ['All observations are synthetic examples.', 'Queue demand is not total teaching work or required headcount.', 'Helper ratings retain explicit session attribution and limited sample counts.', 'Reported work is self-reported and independent from queue contact.'] };
}
