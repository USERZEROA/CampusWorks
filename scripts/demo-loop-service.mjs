import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { BSON, MongoClient } from "mongodb";
import { prepareShowcase } from "./demo-showcase.mjs";
import { DEMO_CATALOG_VERSION } from "./demo-catalog.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownershipCollection = "demoLoopOwnership";
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function command(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.resume();
    child.once("error", () =>
      reject(new Error("A local demonstration dependency could not start.")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error("A local demonstration dependency did not complete."),
          ),
    );
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await command("taskkill.exe", [
      "/PID",
      String(child.pid),
      "/T",
      "/F",
    ]).catch(() => {});
  } else {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      wait(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      wait(3000),
    ]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(child.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
    }
    throw new Error("An owned demonstration process could not be stopped.");
  }
}

/**
 * A disposable, loopback-only presentation service. Only the newly generated
 * database can be restored; existing interactive demonstration data is untouched.
 * AI is deliberately unconfigured, so restarting a round cannot buy model calls.
 */
export async function createLoopService({
  build = false,
  provider = "disabled",
  configureBaseline,
  onProgress = () => {},
} = {}) {
  if (provider !== "disabled")
    throw new Error(
      "Continuous demonstration loops require AI to remain unconfigured.",
    );
  if (
    configureBaseline !== undefined &&
    typeof configureBaseline !== "function"
  )
    throw new Error("The baseline hook must be a function.");
  mkdirSync(join(root, ".cache"), { recursive: true });
  const instance = randomBytes(12).toString("hex");
  const databaseName = `campusworks_showcase_loop_${instance}`;
  const ownerToken = randomBytes(24).toString("hex");
  const origin = `http://127.0.0.1:${await availablePort()}`;
  const sessionSecret = randomBytes(32).toString("hex");
  const settings = existsSync(join(root, ".env"))
    ? parseEnv(readFileSync(join(root, ".env"), "utf8"))
    : {};
  const mongoPassword = encodeURIComponent(
    process.env.MONGO_PASSWORD || settings.MONGO_PASSWORD || "campusworks-dev",
  );
  const mongodbUri = `mongodb://campusworks:${mongoPassword}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0&directConnection=true`;
  const client = new MongoClient(mongodbUri, {
    serverSelectionTimeoutMS: 5000,
  });
  const db = client.db(databaseName);
  const children = new Set();
  const state = {
    synthetic: true,
    catalogVersion: DEMO_CATALOG_VERSION,
    origin,
    database: databaseName,
    launcherPid: process.pid,
    providerConfigured: false,
    providerKeyLoaded: false,
    generation: 0,
    resetCount: 0,
    createdAt: new Date().toISOString(),
  };
  const statePath = join(root, `.cache/demo-loop-service-${instance}.json`);
  const saveState = () =>
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  let app,
    buildChild,
    mongoStarted = false,
    databaseOwned = false,
    connected = false,
    baseline;
  let closing = false,
    closePromise,
    operation = Promise.resolve();
  const serialized = (action) => {
    const next = operation.then(action);
    operation = next.catch(() => {});
    return next;
  };

  async function assertOwnership({ allowMissingMarker = false } = {}) {
    if (
      !databaseOwned ||
      db.databaseName !== databaseName ||
      databaseName !== `campusworks_showcase_loop_${instance}` ||
      !/^campusworks_showcase_loop_[a-f0-9]{24}$/.test(databaseName)
    ) {
      throw new Error(
        "The generated demonstration database is not owned by this service.",
      );
    }
    const marker = await db
      .collection(ownershipCollection)
      .findOne({ _id: "loop-owner" });
    if (
      (!marker && !allowMissingMarker) ||
      (marker &&
        (marker.ownerToken !== ownerToken ||
          marker.synthetic !== true ||
          marker.database !== databaseName))
    ) {
      throw new Error(
        "The demonstration ownership marker does not match this service.",
      );
    }
    if (
      (await db
        .collection("providerIdentities")
        .countDocuments({}, { limit: 1 })) ||
      (await db
        .collection("users")
        .findOne(
          { email: { $not: /@example\.com$/i } },
          { projection: { _id: 1 } },
        ))
    ) {
      throw new Error(
        "Institutional identities cannot be restored or removed by a demonstration loop.",
      );
    }
  }

  async function startApplication() {
    if (closing) throw new Error("The demonstration service is closing.");
    const log = openSync(
      join(root, `.cache/demo-loop-app-${instance}.log`),
      "a",
    );
    app = spawn(process.execPath, [".output/server/index.mjs"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: new URL(origin).port,
        PUBLIC_ORIGIN: origin,
        MONGODB_URI: mongodbUri,
        MONGODB_DB: databaseName,
        SESSION_SECRET: sessionSecret,
        ENABLE_MOCK_LOGIN: "true",
        SEED_DEMO_DATA: "false",
        TRUST_PROXY: "false",
        ADMIN_EMAILS: "",
        ALLOWED_EMAIL_DOMAINS: "",
        GITLAB_BASE_URL: "",
        GITLAB_CLIENT_ID: "",
        GITLAB_CLIENT_SECRET: "",
        NUXT_PUBLIC_DEMO_LABEL: "Synthetic demo data",
        AI_BASE_URL: "",
        AI_API_KEY: "",
        AI_MODEL: "",
        AI_AUTO_DISCOVERY_ENABLED: "false",
        AI_AUTO_REFRESH_ENABLED: "false",
        STAFFING_MAINTENANCE_ENABLED: "true",
        API_RATE_LIMIT: "100000",
        LOGIN_RATE_LIMIT: "10000",
      },
    });
    closeSync(log);
    children.add(app);
    let failed = false;
    app.once("error", () => {
      failed = true;
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failed || app.exitCode !== null)
        throw new Error(
          "The loop application exited before readiness; inspect its local log.",
        );
      try {
        if (
          (
            await fetch(`${origin}/api/health`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          state.appPid = app.pid;
          state.readyAt = new Date().toISOString();
          saveState();
          return;
        }
      } catch {}
      await wait(200);
    }
    throw new Error(
      "The loop application did not become ready; inspect its local log.",
    );
  }

  async function stopApplication() {
    await stopChild(app);
    children.delete(app);
    app = undefined;
    delete state.appPid;
  }

  async function captureBaseline() {
    await assertOwnership();
    const collections = await db
      .listCollections({}, { nameOnly: false })
      .toArray();
    const result = [];
    for (const info of collections.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (info.type !== "collection")
        throw new Error(
          "The demonstration baseline contains an unsupported collection type.",
        );
      const collection = db.collection(info.name);
      const documents = await collection.find().toArray();
      const indexes = (await collection.listIndexes().toArray())
        .filter((index) => index.name !== "_id_")
        .map(({ v, ns, ...index }) => index);
      result.push({
        name: info.name,
        options: info.options || {},
        indexes,
        bytes: BSON.serialize({ documents }),
        count: documents.length,
      });
    }
    return result;
  }

  const reset = () => {
    if (closing)
      return Promise.reject(new Error("The demonstration service is closing."));
    return serialized(async () => {
      if (closing || !baseline)
        throw new Error("The demonstration baseline is not available.");
      onProgress("Restoring the isolated demonstration to its starting point.");
      await stopApplication();
      await assertOwnership();
      await db.dropDatabase();
      // Restore the ownership marker first so failed restores remain identifiable.
      const ordered = [...baseline].sort(
        (left, right) =>
          Number(right.name === ownershipCollection) -
          Number(left.name === ownershipCollection),
      );
      for (const item of ordered) {
        const collection = await db.createCollection(item.name, item.options);
        const { documents } = BSON.deserialize(item.bytes);
        if (documents.length)
          await collection.insertMany(documents, { ordered: true });
        if (item.indexes.length) await collection.createIndexes(item.indexes);
      }
      await assertOwnership();
      state.generation++;
      state.resetCount++;
      state.lastResetAt = new Date().toISOString();
      await startApplication();
      onProgress("The same isolated baseline is ready for the next round.");
      return { generation: state.generation, database: databaseName, origin };
    });
  };

  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = serialized(async () => {
      const receipt = {
        complete: true,
        applicationStopped: false,
        databaseDropped: false,
        reusedMongo: !mongoStarted,
        ownedMongoStopped: false,
      };
      const stopped = await Promise.allSettled([...children].map(stopChild));
      receipt.applicationStopped = stopped.every(
        (result) => result.status === "fulfilled",
      );
      receipt.complete &&= receipt.applicationStopped;
      if (databaseOwned && connected && receipt.applicationStopped) {
        try {
          await assertOwnership({ allowMissingMarker: true });
          await db.dropDatabase();
          receipt.databaseDropped = true;
        } catch {
          receipt.complete = false;
        }
      } else if (databaseOwned && connected) receipt.complete = false;
      await client.close().catch(() => {
        receipt.complete = false;
      });
      connected = false;
      if (mongoStarted) {
        try {
          await command("docker", [
            "compose",
            "-p",
            "campusworks-demo",
            "-f",
            "docker-compose.yml",
            "stop",
            "mongo",
          ]);
          receipt.ownedMongoStopped = !(await command("docker", [
            "ps",
            "--filter",
            "label=com.docker.compose.project=campusworks-demo",
            "--filter",
            "name=^/campusworks-demo-mongo-1$",
            "--format",
            "{{.ID}}",
          ]));
          receipt.complete &&= receipt.ownedMongoStopped;
        } catch {
          receipt.complete = false;
        }
      }
      state.closedAt = new Date().toISOString();
      state.cleanup = receipt.complete ? "complete" : "incomplete";
      state.cleanupReceipt = receipt;
      delete state.appPid;
      saveState();
      return receipt;
    });
    return closePromise;
  };

  try {
    if (build) {
      onProgress("Building the current application.");
      const npmCli =
        process.env.npm_execpath ||
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      await new Promise((resolve, reject) => {
        buildChild = spawn(process.execPath, [npmCli, "run", "build"], {
          cwd: root,
          windowsHide: true,
          stdio: "inherit",
          env: { ...process.env, NUXT_TELEMETRY_DISABLED: "1" },
        });
        children.add(buildChild);
        buildChild.once("error", () =>
          reject(new Error("The local demonstration build could not start.")),
        );
        buildChild.once("exit", (code) => {
          children.delete(buildChild);
          code === 0
            ? resolve()
            : reject(
                new Error("The local demonstration build did not complete."),
              );
        });
      });
    }
    if (!existsSync(join(root, ".output/server/index.mjs")))
      throw new Error(
        "Build the application before opening a continuous demonstration.",
      );
    const running = await command("docker", [
      "ps",
      "--filter",
      "label=com.docker.compose.project=campusworks-demo",
      "--filter",
      "name=^/campusworks-demo-mongo-1$",
      "--format",
      "{{.ID}}",
    ]);
    if (!running) {
      mongoStarted = true;
      onProgress(
        "Starting the local transaction-capable demonstration database.",
      );
      await command("docker", [
        "compose",
        "-p",
        "campusworks-demo",
        "-f",
        "docker-compose.yml",
        "up",
        "-d",
        "mongo-init",
      ]);
    }
    await client.connect();
    connected = true;
    if ((await db.listCollections().toArray()).length)
      throw new Error(
        "The generated demonstration database must be new and empty.",
      );
    databaseOwned = true;
    await db
      .collection(ownershipCollection)
      .insertOne({
        _id: "loop-owner",
        ownerToken,
        database: databaseName,
        synthetic: true,
        createdAt: new Date(),
      });
    await startApplication();
    const { manifest, catalog } = await prepareShowcase({
      baseURL: origin,
      mongodbUri,
      database: db,
      onProgress,
    });
    if (configureBaseline)
      await configureBaseline({ db, origin, manifest, catalog });
    await stopApplication();
    baseline = await captureBaseline();
    state.baselineCollections = baseline.length;
    state.baselineDocuments = baseline.reduce(
      (total, collection) => total + collection.count,
      0,
    );
    state.referenceTime = manifest.referenceTime;
    await startApplication();
    return { origin, db, databaseName, manifest, catalog, reset, close, state };
  } catch {
    const cleanupReceipt = await close();
    const failure = new Error(
      "The isolated demonstration service could not start; inspect the local application log or dependency availability.",
    );
    failure.cleanupReceipt = cleanupReceipt;
    throw failure;
  }
}
