import test from 'node:test';
import assert from 'node:assert/strict';
import { openDemoDatabase } from '../scripts/demo-database.mjs';

function dockerFixture({ running = false, mapping = '127.0.0.1:45987', failStart = false, initExitCode = '0' } = {}) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === 'ps') return running ? 'demo-container' : '';
    if (args[0] === 'port') return mapping;
    if (args[0] === 'wait') return initExitCode;
    if (args.includes('up')) {
      if (failStart || options.env.MONGO_PORT === '27017') throw new Error('Docker startup failed: synthetic-private-detail');
      running = true;
      return '';
    }
    if (args.includes('stop')) { running = false; return ''; }
    throw new Error('Unexpected Docker operation');
  };
  return { run, calls };
}

test('occupied default MongoDB ports do not prevent a new isolated demo database', async () => {
  const fixture = dockerFixture();
  const database = await openDemoDatabase({ run: fixture.run, environment: { MONGO_PORT: '27017', MONGODB_URI: 'mongodb://unrelated:27017' } });
  assert.equal(database.port, 45987);
  assert.equal(database.started, true);
  assert.equal(new URL(database.mongodbUri).port, '45987');
  assert.equal(fixture.calls.find(call => call.args.includes('up')).options.env.MONGO_PORT, '0');
  assert.equal(await database.close(), true);
  await database.close();
  const stops = fixture.calls.filter(call => call.args.includes('stop'));
  assert.equal(stops.length, 1);
  assert.deepEqual(stops[0].args.slice(0, 6), ['compose', '-p', 'campusworks-demo', '-f', 'docker-compose.yml', 'stop']);
  assert.ok(fixture.calls.every(call => !call.args.includes('down') && !call.args.includes('-v')));
});

test('a running shared demo database is discovered without recreating or stopping it', async () => {
  const fixture = dockerFixture({ running: true });
  const database = await openDemoDatabase({ run: fixture.run, environment: {} });
  assert.equal(database.started, false);
  assert.equal(database.port, 45987);
  await database.close();
  assert.equal(fixture.calls.filter(call => call.args[0] === 'compose').length, 0);
});

test('fixed demo ports and private passwords reach Docker and MongoDB without shell arguments', async () => {
  const fixture = dockerFixture({ mapping: '127.0.0.1:27019' });
  const database = await openDemoDatabase({ run: fixture.run, environment: {}, settings: { DEMO_MONGO_PORT: '27019', MONGO_PASSWORD: 'synthetic:p@ss' } });
  assert.equal(database.port, 27019);
  assert.equal(new URL(database.mongodbUri).password, 'synthetic%3Ap%40ss');
  assert.equal(fixture.calls.find(call => call.args.includes('up')).options.env.MONGO_PORT, '27019');
  assert.ok(fixture.calls.every(call => !call.args.join(' ').includes('synthetic:p@ss')));
  await database.close();
});

test('invalid requested ports fail before contacting Docker', async () => {
  for (const requestedPort of ['invalid', '27017.5', '-1', '80', '65536']) {
    const fixture = dockerFixture();
    await assert.rejects(openDemoDatabase({ run: fixture.run, environment: {}, requestedPort }), /DEMO_MONGO_PORT/);
    assert.equal(fixture.calls.length, 0);
  }
});

test('unsafe or mismatched published ports do not stop an existing shared service', async () => {
  for (const input of [{ mapping: '0.0.0.0:45987' }, { mapping: '127.0.0.1:45987', requestedPort: '27019' }]) {
    const fixture = dockerFixture({ ...input, running: true });
    await assert.rejects(openDemoDatabase({ run: fixture.run, environment: {}, requestedPort: input.requestedPort }), /loopback|another port/);
    assert.equal(fixture.calls.filter(call => call.args.includes('stop')).length, 0);
  }
});

test('failed startup stops its own database and returns an actionable private error', async () => {
  const fixture = dockerFixture({ failStart: true });
  await assert.rejects(openDemoDatabase({ run: fixture.run, environment: {} }), error => /Docker Desktop/.test(error.message) && !error.message.includes('synthetic-private-detail'));
  assert.equal(fixture.calls.filter(call => call.args.includes('stop')).length, 1);
});

test('replica initialization must finish successfully before the database is handed to the app', async () => {
  const success = dockerFixture();
  const database = await openDemoDatabase({ run: success.run, environment: {} });
  assert.ok(success.calls.findIndex(call => call.args[0] === 'wait') < success.calls.findIndex(call => call.args[0] === 'port'));
  await database.close();
  const failed = dockerFixture({ initExitCode: '1' });
  await assert.rejects(openDemoDatabase({ run: failed.run, environment: {} }), /initialization failed/);
  assert.equal(failed.calls.filter(call => call.args[0] === 'port').length, 0);
  assert.equal(failed.calls.filter(call => call.args.includes('stop')).length, 1);
});

test('an initialization failure reports unsuccessful cleanup instead of claiming resources were stopped', async () => {
  const fixture = dockerFixture({ initExitCode: '1' });
  const run = async (command, args, options) => {
    if (args.includes('stop')) throw new Error('synthetic-private-stop-detail');
    return fixture.run(command, args, options);
  };
  await assert.rejects(openDemoDatabase({ run, environment: {} }), error =>
    error.demoDatabaseCleanupComplete === false && /initialization failed/.test(error.message) && !error.message.includes('synthetic-private-stop-detail'));
});
