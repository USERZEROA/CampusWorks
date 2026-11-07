import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCatalog } from '../scripts/demo-catalog.mjs';
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
    findOne: async () => name === 'showcaseManifests' ? manifest : null,
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
    } else { assert.equal(row.identified, true); assert.ok(row.createdAt instanceof Date); }
  }
  const firstWrites = writes;
  await seedShowcaseObservations({ db, catalog, manifest, save });
  assert.equal(writes, firstWrites); assert.equal(saves, 1);
});
