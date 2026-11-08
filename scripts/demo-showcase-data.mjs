import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { request } from '@playwright/test';
import { DEMO_CATALOG_VERSION } from './demo-catalog.mjs';

export const SHOWCASE_MANIFEST_ID = 'campusworks-showcase';
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function assertShowcaseTarget({ baseURL, mongodbUri, databaseName }) {
  let origin, database;
  try { origin = new URL(baseURL); database = new URL(mongodbUri); } catch { throw new Error('A loopback showcase target is required.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || !loopback(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || database.protocol !== 'mongodb:' || !loopback(database.hostname) || !/^campusworks_showcase(?:_[a-z0-9]+)*$/.test(databaseName || '')) {
    throw new Error('Showcase preparation requires a dedicated loopback database.');
  }
}

export async function loadShowcaseManifest(db, version, referenceTime = new Date()) {
  if (!/^campusworks_showcase(?:_[a-z0-9]+)*$/.test(db.databaseName)) throw new Error('The showcase database name is invalid.');
  const collection = db.collection('showcaseManifests');
  const existing = await collection.findOne({ _id: SHOWCASE_MANIFEST_ID });
  if (existing) {
    if (!existing.synthetic || existing.version !== version || !existing.referenceTime) throw new Error('This showcase uses another data version; start a fresh dataset.');
    if (await db.collection('providerIdentities').countDocuments({}, { limit: 1 }) || await db.collection('users').findOne({ email: { $not: /@example\.com$/i } }, { projection: { _id: 1 } })) throw new Error('Institutional accounts cannot be used for showcase preparation.');
    return existing;
  }
  for (const name of ['users', 'courses', 'staffingOpportunities', 'staffingApplications', 'helpSessions', 'providerIdentities']) {
    if (await db.collection(name).countDocuments({}, { limit: 1 })) throw new Error('Showcase preparation cannot adopt an existing application database.');
  }
  const manifest = { _id: SHOWCASE_MANIFEST_ID, version, synthetic: true, referenceTime: new Date(referenceTime).toISOString(), createdAt: new Date(), actors: {}, courseIds: {}, termIds: {}, opportunityIds: {}, applicationIds: {}, offerIds: {}, appointmentIds: {}, actions: {}, stages: {} };
  await collection.updateOne({ _id: SHOWCASE_MANIFEST_ID }, { $setOnInsert: manifest }, { upsert: true });
  return collection.findOne({ _id: SHOWCASE_MANIFEST_ID });
}

export async function saveShowcaseManifest(db, manifest) {
  const { _id, ...record } = manifest;
  await db.collection('showcaseManifests').updateOne({ _id: SHOWCASE_MANIFEST_ID, synthetic: true, version: manifest.version }, { $set: { ...record, updatedAt: new Date() } });
}

const syntheticId = (marker, kind, key) => createHash('sha256').update(`${marker}:${kind}:${key}`).digest('hex').slice(0, 24);
const instant = value => value ? new Date(value) : null;

async function assertBoundShowcase(db, manifest) {
  if (!/^campusworks_showcase(?:_[a-z0-9]+)*$/.test(db.databaseName) || !manifest.synthetic || manifest._id !== SHOWCASE_MANIFEST_ID) throw new Error('A verified showcase database is required.');
  const stored = await db.collection('showcaseManifests').findOne({ _id: SHOWCASE_MANIFEST_ID, synthetic: true, version: manifest.version });
  if (!stored || stored.referenceTime !== manifest.referenceTime || stored.marker !== manifest.marker) throw new Error('The showcase manifest does not match its database.');
  if (await db.collection('providerIdentities').countDocuments({}, { limit: 1 }) || await db.collection('users').findOne({ email: { $not: /@example\.com$/i } }, { projection: { _id: 1 } })) throw new Error('Institutional accounts cannot be used for showcase preparation.');
}

/** Dated observations are labelled fixtures; lifecycle records use ordinary APIs. */
export async function seedShowcaseObservations({ db, catalog, manifest, save }) {
  if (!catalog.synthetic || catalog.version !== DEMO_CATALOG_VERSION || catalog.version !== manifest.version || catalog.marker !== `campusworks-showcase-v${catalog.version}` || catalog.marker !== manifest.marker || catalog.referenceTime !== manifest.referenceTime) throw new Error('The observation catalog does not match this showcase data version.');
  if (manifest.stages?.observations) return manifest;
  await assertBoundShowcase(db, manifest);
  const provenance = { synthetic: true, scenario: catalog.marker, source: 'synthetic-demo-observation' };
  const history = new Map();
  const validDate = value => value instanceof Date && Number.isFinite(value.getTime());
  const referenceTime = new Date(catalog.referenceTime);
  if (!validDate(referenceTime)) throw new Error('The observation reference time is invalid.');
  for (const sample of catalog.history) {
    const person = manifest.actors[sample.actorKey];
    const helper = manifest.actors[sample.helperKey];
    const courseId = manifest.courseIds[sample.courseKey];
    const course = catalog.courses.find(item => item.key === sample.courseKey);
    if (!person || !helper || helper.role !== 'ta' || !course?.taKeys.includes(sample.helperKey) || !courseId || !manifest.termIds[sample.termKey] || history.has(sample.key)) throw new Error('A history fixture references an unknown or repeated resource.');
    const helpStartAt = instant(sample.helpStartAt), helpEndAt = instant(sample.helpEndAt);
    const joinedAt = instant(sample.joinedAt), leftQueueAt = instant(sample.leftQueueAt);
    const term = catalog.terms[sample.termKey];
    if (!validDate(joinedAt) || !validDate(leftQueueAt) || leftQueueAt < joinedAt || leftQueueAt > referenceTime || !term || joinedAt < new Date(term.startDate) || leftQueueAt >= new Date(term.endDate)) throw new Error('A history fixture has invalid observation dates.');
    if (sample.wasHelped && (!validDate(helpStartAt) || !validDate(helpEndAt) || helpStartAt < joinedAt || helpEndAt <= helpStartAt || helpEndAt > leftQueueAt || (helpEndAt - helpStartAt) / 60000 !== sample.helpMinutes || (helpStartAt - joinedAt) / 60000 !== sample.waitMinutes)) throw new Error('A helped fixture must contain an actual positive help interval.');
    if (!sample.wasHelped && (helpStartAt || helpEndAt || sample.helpMinutes !== 0)) throw new Error('An unhelped fixture cannot attribute helper time.');
    const record = {
      ...provenance, courseId, studentId: person.id, studentEmail: person.email, studentName: person.name,
      taEmail: sample.wasHelped ? helper.email : null, taName: sample.wasHelped ? helper.name : null,
      entryId: syntheticId(catalog.marker, 'history', sample.key), location: sample.location, question: sample.question,
      joinedAt, helpStartAt, helpEndAt, closedAt: instant(sample.closedAt), leftQueueAt,
      waitMinutes: sample.waitMinutes, helpMinutes: sample.helpMinutes, wasHelped: sample.wasHelped, endReason: sample.endReason,
      helpSegments: sample.wasHelped ? [{ taEmail: helper.email, taName: helper.name, startAt: helpStartAt, endAt: helpEndAt, durationMs: helpEndAt.getTime() - helpStartAt.getTime() }] : [],
      removedBy: sample.wasHelped ? helper.email : person.email,
    };
    history.set(sample.key, { sample, helper, id: new ObjectId(syntheticId(catalog.marker, 'history', sample.key)), record });
  }
  const feedback = [];
  const feedbackKeys = new Set(), helperRatings = new Set();
  for (const sample of catalog.feedback) {
    const person = manifest.actors[sample.actorKey];
    const courseId = manifest.courseIds[sample.courseKey];
    if (!person || !courseId || feedbackKeys.has(sample.key)) throw new Error('A feedback fixture references an unknown or repeated resource.');
    feedbackKeys.add(sample.key);
    const course = catalog.courses.find(item => item.key === sample.courseKey);
    const createdAt = instant(sample.createdAt);
    if (!course || !validDate(createdAt) || createdAt > referenceTime || !Number.isInteger(sample.rating) || sample.rating < 1 || sample.rating > 5 || !['helper', 'course'].includes(sample.ratingScope)) throw new Error('A feedback fixture has invalid rating evidence.');
    const record = { ...provenance, courseId, courseCode: course.code, studentId: person.id, studentEmail: person.email, studentName: person.name, ratingScope: sample.ratingScope, category: sample.category, rating: sample.rating, positive: sample.positive, negative: sample.negative, identified: true, allowContact: sample.allowContact, createdAt };
    let linked;
    if (sample.ratingScope === 'helper') {
      linked = history.get(sample.helpSessionKey);
      if (!linked || !linked.sample.wasHelped || linked.sample.actorKey !== sample.actorKey || linked.sample.courseKey !== sample.courseKey || linked.sample.termKey !== sample.termKey || linked.sample.helperKey !== sample.helperKey || createdAt < linked.record.leftQueueAt) throw new Error('A helper rating must follow a matching completed student session.');
      const identity = `${courseId}:${person.id}:${linked.id.toHexString()}:${linked.helper.email}`;
      if (helperRatings.has(identity)) throw new Error('A student cannot rate the same session helper twice.');
      helperRatings.add(identity);
    } else if (sample.helpSessionKey || sample.helperKey) throw new Error('Course feedback cannot claim a helper-session link.');
    feedback.push({ id: new ObjectId(syntheticId(catalog.marker, 'feedback', sample.key)), linked, record });
  }
  for (const { id, record } of history.values()) await db.collection('helpSessions').updateOne({ _id: id }, { $setOnInsert: record }, { upsert: true });
  for (const { id, linked, record } of feedback) {
    if (linked) {
      const session = await db.collection('helpSessions').findOne({ _id: linked.id });
      const segment = Array.isArray(session?.helpSegments) ? session.helpSegments.find(item => item.taEmail === linked.helper.email && item.taName === linked.helper.name && validDate(item.startAt) && validDate(item.endAt) && item.endAt - item.startAt >= 6000 && item.durationMs === item.endAt - item.startAt) : undefined;
      if (!session || String(session._id) !== linked.id.toHexString() || !session.synthetic || session.scenario !== catalog.marker || session.source !== provenance.source || session.courseId !== record.courseId || session.studentId !== record.studentId || session.studentEmail !== record.studentEmail || !session.wasHelped || !segment || !validDate(session.helpEndAt) || !validDate(session.leftQueueAt) || record.createdAt < session.helpEndAt || record.createdAt < session.leftQueueAt || record.createdAt < segment.endAt) throw new Error('The stored help-session evidence does not authorize this synthetic helper rating.');
      record.helpSessionId = String(session._id);
      record.taEmail = segment.taEmail;
      record.taName = segment.taName;
    }
    await db.collection('feedback').updateOne({ _id: id }, { $setOnInsert: record }, { upsert: true });
  }
  manifest.stages ||= {};
  manifest.stages.observations = true;
  await save(manifest);
  return manifest;
}

export async function seedShowcaseLiveQueues({ baseURL, catalog, manifest, save }) {
  if (manifest.stages?.liveQueues) return manifest;
  const clients = new Map();
  const call = async pending => { const response = await pending; if (!response.ok()) throw new Error(`Showcase queue action failed (${response.status()}).`); return response.json(); };
  const actor = async key => {
    if (clients.has(key)) return clients.get(key);
    const person = manifest.actors[key];
    if (!person) throw new Error('The queue actor is unavailable.');
    const api = await request.newContext({ baseURL });
    clients.set(key, api);
    await call(api.post('/api/auth/mock', { data: { as: person.role, email: person.email, name: person.name } }));
    return api;
  };
  const once = async (key, action) => {
    manifest.actions ||= {};
    if (manifest.actions[key]) return;
    await action(); manifest.actions[key] = true; await save(manifest);
  };
  try {
    for (const plan of catalog.queuePlans) {
      const courseId = manifest.courseIds[plan.courseKey];
      const course = catalog.courses.find(item => item.key === plan.courseKey);
      const teacher = await actor(course.instructorKey);
      await once(`queue:open:${course.key}`, () => call(teacher.patch(`/api/courses/${courseId}/state`, { data: { state: 'open' } })));
      for (const helperKey of new Set(plan.entries.map(entry => entry.helperKey).filter(Boolean))) {
        const helper = await actor(helperKey);
        await once(`queue:duty:${course.key}:${helperKey}`, () => call(helper.post(`/api/courses/${courseId}/ta-duty`, { data: { onDuty: true } })));
      }
      for (const entry of plan.entries) {
        const student = await actor(entry.actorKey);
        await once(`queue:enroll:${course.key}:${entry.actorKey}`, () => call(student.post('/api/courses/enroll', { data: { courseId, enroll: true } })));
        await once(`queue:join:${course.key}:${entry.actorKey}`, () => call(student.post(`/api/courses/${courseId}/queue/join`, { data: { action: 'join', location: entry.location, question: entry.question } })));
        const snapshot = await call(student.get(`/api/courses/${courseId}`));
        const current = snapshot.queue.find(item => item.isMine);
        if (!current) throw new Error('The showcase queue request is unavailable.');
        if (entry.state === 'paused') await once(`queue:pause:${course.key}:${entry.actorKey}`, () => call(student.post(`/api/courses/${courseId}/queue/pause`, { data: { entryId: current.id, paused: true } })));
        if (entry.state === 'helping') {
          const helper = await actor(entry.helperKey);
          await once(`queue:claim:${course.key}:${entry.actorKey}`, () => call(helper.post(`/api/courses/${courseId}/queue/assign`, { data: { entryId: current.id, assign: true } })));
        }
      }
    }
    manifest.stages ||= {}; manifest.stages.liveQueues = true; await save(manifest);
    return manifest;
  } finally { await Promise.allSettled([...clients.values()].map(api => api.dispose())); }
}
