import { randomUUID } from 'node:crypto';
import { createDemoCatalog, DEMO_CATALOG_VERSION } from './demo-catalog.mjs';
import { seedShowcaseApi } from './demo-showcase-api.mjs';
import { assertShowcaseTarget, loadShowcaseManifest, seedShowcaseObservations, seedShowcaseLiveQueues, SHOWCASE_MANIFEST_ID } from './demo-showcase-data.mjs';

/** Prepare only an explicitly isolated, labelled showcase database. */
export async function prepareShowcase({ baseURL, mongodbUri, database, referenceTime = new Date(), primaryCourse = 'cs101', resume = false, onProgress = () => {} }) {
  assertShowcaseTarget({ baseURL, mongodbUri, databaseName: database.databaseName });
  const manifest = await loadShowcaseManifest(database, DEMO_CATALOG_VERSION, referenceTime);
  if (manifest.primaryCourse && manifest.primaryCourse !== primaryCourse) throw new Error('Use the original primary course or start a fresh showcase.');
  manifest.primaryCourse = primaryCourse;
  const catalog = createDemoCatalog(manifest.referenceTime, { primaryCourse });
  if (manifest.complete) return { catalog, manifest };
  if (!resume && Object.keys(manifest.actions || {}).length) throw new Error('An earlier preparation was interrupted. Use a fresh dataset, or explicitly resume before making manual changes.');
  const token = randomUUID();
  const records = database.collection('showcaseManifests');
  const lease = await records.findOneAndUpdate({ _id: SHOWCASE_MANIFEST_ID, $or: [{ preparationLeaseUntil: { $exists: false } }, { preparationLeaseUntil: { $lte: new Date() } }] }, { $set: { preparationToken: token, preparationLeaseUntil: new Date(Date.now() + 90000) } }, { returnDocument: 'after' });
  if (!lease) throw new Error('Another process is preparing this showcase.');
  let lost = false;
  let renewing;
  const renew = async () => {
    const updated = await records.updateOne({ _id: SHOWCASE_MANIFEST_ID, preparationToken: token, preparationLeaseUntil: { $gt: new Date() } }, { $set: { preparationLeaseUntil: new Date(Date.now() + 90000) } });
    if (!updated.matchedCount) lost = true;
  };
  const timer = setInterval(() => { if (!renewing) renewing = renew().catch(() => { lost = true; }).finally(() => { renewing = undefined; }); }, 20000);
  timer.unref?.();
  const save = async current => {
    if (lost) throw new Error('The showcase preparation lease was lost.');
    // Match the API's signed-in account to this exact database before bulk work.
    if (current.actors?.admin && !await database.collection('users').findOne({ id: current.actors.admin.id, email: current.actors.admin.email }, { projection: { _id: 1 } })) throw new Error('The API and showcase database do not match.');
    const { _id, preparationToken, preparationLeaseUntil, ...data } = current;
    const saved = await records.updateOne({ _id: SHOWCASE_MANIFEST_ID, preparationToken: token, preparationLeaseUntil: { $gt: new Date() } }, { $set: { ...data, preparationLeaseUntil: new Date(Date.now() + 90000), updatedAt: new Date() } });
    if (!saved.matchedCount) { lost = true; throw new Error('The showcase preparation lease was lost.'); }
  };
  try {
    onProgress('Preparing courses, positions, candidates and appointments.');
    await seedShowcaseApi({ baseURL, catalog, manifest, save });
    onProgress('Loading labelled observations and feedback.');
    await seedShowcaseObservations({ db: database, catalog, manifest, save });
    onProgress('Preparing live queue claims, pauses and duty.');
    await seedShowcaseLiveQueues({ baseURL, catalog, manifest, save });
    manifest.complete = true; manifest.completedAt = new Date().toISOString();
    await save(manifest);
    return { catalog, manifest };
  } finally {
    clearInterval(timer); await renewing;
    await records.updateOne({ _id: SHOWCASE_MANIFEST_ID, preparationToken: token }, { $unset: { preparationToken: '', preparationLeaseUntil: '' } });
  }
}

export function showcaseWindows(catalog, manifest) {
  const course = manifest.courseIds[catalog.featured.courseKey];
  const definitions = [
    ['Student Queue', 'student-main', `/courses/${course}/student`],
    ['TA Queue', 'ta-main', `/courses/${course}/ta`],
    ['Instructor Selection', 'faculty-main', `/staffing/${manifest.opportunityIds[catalog.featured.opportunityKey]}`],
    ['Administrator', 'admin', '/admin/staffing'],
    ['Student Applications', 'student-two', '/applications'],
    ['Second Instructor', 'faculty-algorithms', `/staffing/${manifest.opportunityIds['structures-ta']}`],
  ];
  return definitions.map(([label, key, path]) => {
    const actor = manifest.actors[key];
    return { label, as: actor.role, email: actor.email, name: actor.name, path };
  });
}
