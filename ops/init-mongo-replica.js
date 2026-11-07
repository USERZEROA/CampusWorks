// Run inside mongosh; secrets remain process environment values.
const replicaHost = process.env.MONGO_REPLICA_HOST || 'mongo:27017';
const username = encodeURIComponent(process.env.MONGO_INITDB_ROOT_USERNAME || '');
const password = encodeURIComponent(process.env.MONGO_INITDB_ROOT_PASSWORD || '');
const credentials = username ? `${username}:${password}@` : '';
const connection = new Mongo(`mongodb://${credentials}${replicaHost}/?authSource=admin&directConnection=true`);
const adminDatabase = connection.getDB('admin');
const status = adminDatabase.runCommand({ replSetGetStatus: 1 });
if (!status.ok) {
  if (status.code !== 94) throw new Error(`Replica readiness failed: ${status.codeName}`);
  const initiated = adminDatabase.runCommand({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: replicaHost }] } });
  if (!initiated.ok && initiated.code !== 23) throw new Error(`Replica initialization failed: ${initiated.codeName}`);
}
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (adminDatabase.runCommand({ hello: 1 }).isWritablePrimary) { ready = true; break; }
  sleep(1000);
}
if (!ready) throw new Error('Replica set did not become writable within sixty seconds.');
print('CampusWorks transaction-capable database is ready.');
