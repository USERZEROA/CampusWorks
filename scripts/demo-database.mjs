import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const container = 'campusworks-demo-mongo-1';
const compose = ['compose', '-p', 'campusworks-demo', '-f', 'docker-compose.yml'];
const runningArgs = ['ps', '--filter', 'label=com.docker.compose.project=campusworks-demo', '--filter', `name=^/${container}$`, '--format', '{{.ID}}'];
const capture = async (command, args, options) => (await execute(command, args, { windowsHide: true, ...options })).stdout.trim();

/** Docker assigns an unused loopback port; only a database started here is stopped. */
export async function openDemoDatabase({ environment = process.env, settings = {}, requestedPort, run = capture } = {}) {
  const requested = requestedPort ?? environment.DEMO_MONGO_PORT ?? settings.DEMO_MONGO_PORT;
  const port = requested === undefined || requested === '' ? 0 : Number(requested);
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) {
    throw new Error('DEMO_MONGO_PORT must be an integer from 1024 to 65535, or omitted for an automatic port.');
  }
  const options = { env: { ...environment, MONGO_PORT: String(port) } };
  let started = false;
  let stopped = false;
  const close = async () => {
    if (!started || stopped) return true;
    await run('docker', [...compose, 'stop', 'mongo'], options);
    stopped = !(await run('docker', runningArgs));
    return stopped;
  };
  try {
    if (!(await run('docker', runningArgs))) {
      started = true;
      await run('docker', [...compose, 'up', '-d', 'mongo-init'], options);
      if ((await run('docker', ['wait', 'campusworks-demo-mongo-init-1'])).trim() !== '0') {
        throw new Error('The demonstration database initialization failed. Inspect the campusworks-demo mongo-init container logs.');
      }
    }
    const mapping = await run('docker', ['port', container, '27017/tcp']);
    const match = /^127\.0\.0\.1:([0-9]+)$/.exec(mapping.trim());
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
      throw new Error('The demonstration database must publish exactly one loopback port.');
    }
    const actualPort = Number(match[1]);
    if (port && actualPort !== port) {
      throw new Error('The running demonstration database uses another port. Stop its launcher before changing DEMO_MONGO_PORT.');
    }
    const password = encodeURIComponent(environment.MONGO_PASSWORD || settings.MONGO_PASSWORD || 'campusworks-dev');
    return { port: actualPort, started, close, mongodbUri: `mongodb://campusworks:${password}@127.0.0.1:${actualPort}/?authSource=admin&replicaSet=rs0&directConnection=true` };
  } catch (error) {
    const cleanedUp = await close().catch(() => false);
    const failure = /^The (demonstration|running demonstration) database/.test(error?.message)
      ? error
      : new Error('The demonstration database could not start. Check Docker Desktop and any configured DEMO_MONGO_PORT.');
    failure.demoDatabaseCleanupComplete = cleanedUp;
    throw failure;
  }
}
