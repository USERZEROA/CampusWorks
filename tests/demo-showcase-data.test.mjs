import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCatalog, DEMO_CATALOG_VERSION } from '../scripts/demo-catalog.mjs';
import { assertShowcaseTarget, loadShowcaseManifest, seedShowcaseObservations, SHOWCASE_MANIFEST_ID } from '../scripts/demo-showcase-data.mjs';

test('showcase targets reject remote, credential-bearing browser URLs and ordinary databases before work', () => {
  const valid = { baseURL: 'http://localhost:3100', mongodbUri: 'mongodb://127.0.0.1:27017/?replicaSet=rs0', databaseName: 'campusworks_showcase' };
  assert.doesNotThrow(() => assertShowcaseTarget(valid));
  assert.doesNotThrow(() => assertShowcaseTarget({ ...valid, databaseName: 'campusworks_showcase_test_a1', baseURL: 'http://[::1]:3100' }));
  for (const input of [
    { baseURL: 'https://campus.example.com' }, { baseURL: 'http://localhost:3100/path' },
    { baseURL: 'http://user:secret@localhost:3100' }, { baseURL: 'http://localhost:3100/?token=value' },
    { mongodbUri: 'mongodb://database.example.com:27017' }, { databaseName: 'campusworks' },
    { databaseName: 'campusworks_interactive_demo' }, { databaseName: 'production' },
  ]) assert.throws(() => assertShowcaseTarget({ ...valid, ...input }), /showcase|loopback/i);
});

test('an existing application database is never adopted as showcase data', async () => {
  let writes = 0;
  const db = { databaseName: 'campusworks_showcase', collection: name => ({
    findOne: async () => null, countDocuments: async () => name === 'courses' ? 1 : 0,
    updateOne: async () => { writes++; },
  }) };
  await assert.rejects(loadShowcaseManifest(db, 3), /cannot adopt/);
  assert.equal(writes, 0);
});

test('the direct observation loader independently refuses a forged or mismatched database manifest', async () => {
  const catalog = createDemoCatalog('2026-11-07T17:00:00Z');
  let writes = 0;
  const collection = { findOne: async () => null, countDocuments: async () => 0, updateOne: async () => { writes++; } };
  const manifest = { _id: SHOWCASE_MANIFEST_ID, version: catalog.version, synthetic: true, marker: catalog.marker, referenceTime: catalog.referenceTime };
  await assert.rejects(seedShowcaseObservations({ db: { databaseName: 'campusworks', collection: () => collection }, catalog, manifest, save: async () => {} }), /verified showcase/);
  await assert.rejects(seedShowcaseObservations({ db: { databaseName: 'campusworks_showcase', collection: () => collection }, catalog, manifest, save: async () => {} }), /does not match/);
  assert.equal(writes, 0);
});

test('dated sample observations retain archive identity, measured segments and immutable idempotent provenance', async () => {
  const catalog = createDemoCatalog('2026-11-07T17:00:00Z');
  const manifest = { _id: SHOWCASE_MANIFEST_ID, version: catalog.version, synthetic: true, marker: catalog.marker, referenceTime: catalog.referenceTime, actors: Object.fromEntries(catalog.actors.map(actor => [actor.key, { ...actor, id: actor.key }])), courseIds: Object.fromEntries(catalog.courses.map(course => [course.key, course.code])), termIds: { current: 'term-current', previous: 'term-previous' }, stages: {} };
  const stored = new Map(); let writes = 0, saves = 0;
  const db = { databaseName: 'campusworks_showcase_test_a1', collection: name => ({
    findOne: async filter => {
      if (name === 'showcaseManifests') return manifest;
      const row = filter._id?.toHexString ? stored.get(`${name}:${filter._id.toHexString()}`) : null;
      return row ? { _id: filter._id, ...row } : null;
    },
    countDocuments: async () => 0,
    updateOne: async (filter, update) => {
      const key = `${name}:${filter._id.toHexString()}`;
      if (!stored.has(key)) stored.set(key, update.$setOnInsert);
      writes++;
    },
  }) };
  const save = async () => { saves++; };
  await seedShowcaseObservations({ db, catalog, manifest, save });
  assert.equal(stored.size, catalog.history.length + catalog.feedback.length);
  for (const [key, row] of stored) {
    assert.equal(row.synthetic, true); assert.equal(row.scenario, catalog.marker);
    if (key.startsWith('helpSessions:')) {
      assert.equal(row.entryId, key.split(':')[1]);
      assert.ok(row.joinedAt instanceof Date);
      assert.ok(row.leftQueueAt >= row.joinedAt);
      if (row.wasHelped) {
        assert.equal(row.helpSegments.length, 1);
        assert.equal(row.helpSegments[0].durationMs / 60000, row.helpMinutes);
        assert.equal((row.helpStartAt - row.joinedAt) / 60000, row.waitMinutes);
      } else { assert.equal(row.helpStartAt, null); assert.deepEqual(row.helpSegments, []); }
    } else {
      assert.equal(row.identified, true); assert.ok(row.createdAt instanceof Date);
      if (row.ratingScope === 'helper') {
        const session = stored.get(`helpSessions:${row.helpSessionId}`);
        assert.ok(session?.wasHelped);
        assert.equal(row.studentId, session.studentId);
        assert.equal(row.courseId, session.courseId);
        assert.ok(row.createdAt >= session.helpEndAt && row.createdAt >= session.leftQueueAt);
        assert.ok(session.helpSegments.some(segment => segment.taEmail === row.taEmail && segment.taName === row.taName));
      } else {
        assert.equal(row.ratingScope, 'course');
        assert.equal(Object.hasOwn(row, 'taEmail'), false);
        assert.equal(Object.hasOwn(row, 'taName'), false);
        assert.equal(Object.hasOwn(row, 'helpSessionId'), false);
      }
    }
  }
  const firstWrites = writes;
  await seedShowcaseObservations({ db, catalog, manifest, save });
  assert.equal(writes, firstWrites); assert.equal(saves, 1);
});

function observationFixture(catalog, mutateSession = value => value) {
  const manifest = { _id: SHOWCASE_MANIFEST_ID, version: catalog.version, synthetic: true, marker: catalog.marker, referenceTime: catalog.referenceTime,
    actors: Object.fromEntries(catalog.actors.map(actor => [actor.key, { ...actor, id: actor.key }])), courseIds: Object.fromEntries(catalog.courses.map(course => [course.key, course.code])), termIds: { current: 'term-current', previous: 'term-previous' }, stages: {} };
  const stored = new Map();
  let writes = 0;
  const db = { databaseName: 'campusworks_showcase_test_linkage', collection: name => ({
    findOne: async filter => {
      if (name === 'showcaseManifests') return manifest;
      const row = filter._id?.toHexString ? stored.get(`${name}:${filter._id.toHexString()}`) : null;
      if (!row) return null;
      const record = { _id: filter._id, ...row };
      return name === 'helpSessions' ? mutateSession({ ...structuredClone(row), _id: filter._id }) : record;
    },
    countDocuments: async () => 0,
    updateOne: async (filter, update) => {
      writes++;
      const key = `${name}:${filter._id.toHexString()}`;
      if (!stored.has(key)) stored.set(key, update.$setOnInsert);
    },
  }) };
  return { db, manifest, stored, get writes() { return writes; }, save: async () => {} };
}

test('invalid helper attribution, chronology and repeated ratings fail before any observation insert', async () => {
  const valid = createDemoCatalog('2026-11-07T17:00:00Z');
  for (const change of [
    catalog => { catalog.feedback[0].actorKey = 'candidate-05'; },
    catalog => { catalog.feedback[0].courseKey = 'structures'; },
    catalog => { catalog.feedback[0].helperKey = 'ta-two'; },
    catalog => { catalog.feedback[0].helpSessionKey = 'unknown-session'; },
    catalog => { const session = catalog.history.find(row => row.key === catalog.feedback[0].helpSessionKey); catalog.feedback[0].createdAt = new Date(new Date(session.helpEndAt).getTime() - 1).toISOString(); },
    catalog => { catalog.feedback.push({ ...catalog.feedback[0], key: 'duplicate-helper-rating' }); },
    catalog => { catalog.feedback[6].helpSessionKey = catalog.feedback[0].helpSessionKey; },
    catalog => { const session = catalog.history.find(row => row.courseKey === 'intro' && !row.wasHelped); catalog.feedback[0] = { ...catalog.feedback[0], actorKey: session.actorKey, helperKey: session.helperKey, helpSessionKey: session.key }; },
  ]) {
    const catalog = structuredClone(valid);
    change(catalog);
    const fixture = observationFixture(catalog);
    await assert.rejects(seedShowcaseObservations({ catalog, ...fixture }), /rating|feedback|helper|session/i);
    assert.equal(fixture.writes, 0);
    assert.equal(fixture.stored.size, 0);
  }
});

test('helper feedback derives only from the stored synthetic session and its positive matching segment', async () => {
  const catalog = createDemoCatalog('2026-11-07T17:00:00Z');
  for (const mutate of [
    session => ({ ...session, _id: 'wrong-session-id' }),
    session => ({ ...session, courseId: 'unrelated-course' }),
    session => ({ ...session, studentId: 'another-student' }),
    session => ({ ...session, synthetic: false }),
    session => ({ ...session, scenario: 'unrelated-scenario' }),
    session => ({ ...session, helpSegments: [{ ...session.helpSegments[0], taEmail: 'another-helper@example.com' }] }),
    session => ({ ...session, helpSegments: [] }),
    session => ({ ...session, helpSegments: [{ ...session.helpSegments[0], durationMs: 0 }] }),
    session => ({ ...session, leftQueueAt: new Date(catalog.referenceTime) }),
  ]) {
    const fixture = observationFixture(catalog, mutate);
    await assert.rejects(seedShowcaseObservations({ catalog, ...fixture }), /stored help-session evidence/i);
    assert.equal([...fixture.stored.keys()].filter(key => key.startsWith('feedback:')).length, 0);
    assert.equal(fixture.manifest.stages.observations, undefined);
  }
});

test('interrupted fixture replay retains one rating per student session helper and never replaces stored feedback', async () => {
  const catalog = createDemoCatalog('2026-11-07T17:00:00Z');
  const fixture = observationFixture(catalog);
  await seedShowcaseObservations({ catalog, ...fixture });
  const first = [...fixture.stored.entries()].find(([key]) => key.startsWith('feedback:'));
  first[1].positive = 'Retained synthetic note.';
  fixture.manifest.stages.observations = false;
  await seedShowcaseObservations({ catalog, ...fixture });
  assert.equal(fixture.stored.size, 460);
  assert.equal(fixture.stored.get(first[0]).positive, 'Retained synthetic note.');
  const ratings = [...fixture.stored.entries()].filter(([key, row]) => key.startsWith('feedback:') && row.ratingScope === 'helper').map(([, row]) => row);
  assert.equal(ratings.length, 60);
  assert.equal(new Set(ratings.map(row => [row.courseId, row.studentId, row.helpSessionId, row.taEmail].join(':'))).size, 60);
});

test('version and reference guards leave earlier complete showcase datasets untouched', async () => {
  const current = createDemoCatalog('2026-11-07T17:00:00Z');
  for (const change of [
    fixture => { fixture.manifest.version = DEMO_CATALOG_VERSION - 1; fixture.manifest.marker = `campusworks-showcase-v${DEMO_CATALOG_VERSION - 1}`; },
    fixture => { fixture.manifest.referenceTime = '2026-11-06T17:00:00Z'; },
  ]) {
    const fixture = observationFixture(current);
    fixture.manifest.stages.observations = true;
    change(fixture);
    await assert.rejects(seedShowcaseObservations({ catalog: current, ...fixture }), /data version/);
    assert.equal(fixture.writes, 0);
  }
  for (const version of [4, 5]) {
    const prior = { ...current, version, marker: `campusworks-showcase-v${version}` };
    const fixture = observationFixture(prior);
    fixture.manifest.stages.observations = true;
    await assert.rejects(seedShowcaseObservations({ catalog: prior, ...fixture }), /data version/);
    assert.equal(fixture.writes, 0);
  }
});
