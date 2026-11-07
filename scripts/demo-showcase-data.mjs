import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { request } from '@playwright/test';

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
  if (manifest.stages?.observations) return manifest;
  await assertBoundShowcase(db, manifest);
  const provenance = { synthetic: true, scenario: catalog.marker, source: 'synthetic-demo-observation' };
  for (const sample of catalog.history) {
    const person = manifest.actors[sample.actorKey];
    const helper = manifest.actors[sample.helperKey];
    const courseId = manifest.courseIds[sample.courseKey];
    if (!person || !helper || !courseId || !manifest.termIds[sample.termKey]) throw new Error('A history fixture references an unknown resource.');
    const helpStartAt = instant(sample.helpStartAt), helpEndAt = instant(sample.helpEndAt);
    const record = {
      ...provenance, courseId, studentId: person.id, studentEmail: person.email, studentName: person.name,
      taEmail: sample.wasHelped ? helper.email : null, taName: sample.wasHelped ? helper.name : null,
      entryId: syntheticId(catalog.marker, 'history', sample.key), location: sample.location, question: sample.question,
      joinedAt: instant(sample.joinedAt), helpStartAt, helpEndAt, closedAt: instant(sample.closedAt), leftQueueAt: instant(sample.leftQueueAt),
      waitMinutes: sample.waitMinutes, helpMinutes: sample.helpMinutes, wasHelped: sample.wasHelped, endReason: sample.endReason,
      helpSegments: sample.wasHelped ? [{ taEmail: helper.email, taName: helper.name, startAt: helpStartAt, endAt: helpEndAt, durationMs: helpEndAt.getTime() - helpStartAt.getTime() }] : [],
      removedBy: sample.wasHelped ? helper.email : person.email,
    };
    await db.collection('helpSessions').updateOne({ _id: new ObjectId(syntheticId(catalog.marker, 'history', sample.key)) }, { $setOnInsert: record }, { upsert: true });
  }
  for (const sample of catalog.feedback) {
    const person = manifest.actors[sample.actorKey];
    const courseId = manifest.courseIds[sample.courseKey];
    if (!person || !courseId) throw new Error('A feedback fixture references an unknown resource.');
    const course = catalog.courses.find(item => item.key === sample.courseKey);
    const record = { ...provenance, courseId, courseCode: course.code, studentId: person.id, studentEmail: person.email, studentName: person.name, category: sample.category, rating: sample.rating, positive: sample.positive, negative: sample.negative, identified: true, allowContact: sample.allowContact, createdAt: instant(sample.createdAt) };
    await db.collection('feedback').updateOne({ _id: new ObjectId(syntheticId(catalog.marker, 'feedback', sample.key)) }, { $setOnInsert: record }, { upsert: true });
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
