import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { json, ok } from "./staffing-fixtures";
import type { DemoRole } from "./helpers";

type ShowcaseActor = { api: APIRequestContext; id: string; email: string; name: string; role: DemoRole };
export type Showcase = {
  catalog: any;
  manifest: any;
  db: Db;
  baseURL: string;
  mongodbUri: string;
  databaseName: string;
  actor: (key: string) => Promise<ShowcaseActor>;
  prepare: () => Promise<{ catalog: any; manifest: any }>;
  restartAi: (environment: Record<string, string>) => Promise<void>;
  close: () => Promise<void>;
};

const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function stopProcess(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill("SIGTERM");
  });
}

export async function createShowcase(): Promise<Showcase> {
  const mongodbUri = process.env.TEST_MONGODB_URI || "";
  const mainDatabase = process.env.TEST_MONGODB_DB || "";
  let address: URL;
  try { address = new URL(mongodbUri); } catch { throw new Error("Showcase checks require the isolated local acceptance database."); }
  if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1", "[::1]"].includes(address.hostname) || !mainDatabase.startsWith("campusworks_")) throw new Error("Showcase checks require the isolated local acceptance database.");
  const suffix = randomBytes(7).toString("hex");
  const databaseName = `campusworks_showcase_test_${suffix}`;
  if (databaseName === mainDatabase) throw new Error("An independent showcase database is required.");
  const client = new MongoClient(mongodbUri, { serverSelectionTimeoutMS: 5000 });
  const db = client.db(databaseName);
  const baseURL = `http://127.0.0.1:${await freePort()}`;
  const contexts = new Map<string, ShowcaseActor>();
  const sessionSecret = randomBytes(32).toString("hex");
  let generation = 0;
  let application: ChildProcess | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([...contexts.values()].map(actor => actor.api.dispose()));
    await stopProcess(application);
    try {
      if (/^campusworks_showcase_test_[a-f0-9]{14}$/.test(databaseName) && databaseName !== mainDatabase) await db.dropDatabase();
    } finally { await client.close(); }
  };
  const startApplication = async (overrides: Record<string, string> = {}) => {
    await stopProcess(application);
    mkdirSync(".cache", { recursive: true });
    const log = openSync(`.cache/showcase-test-${suffix}-${generation++}.log`, "w");
    application = spawn(process.execPath, [".output/server/index.mjs"], {
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: new URL(baseURL).port,
        PUBLIC_ORIGIN: baseURL, MONGODB_URI: mongodbUri, MONGODB_DB: databaseName,
        SESSION_SECRET: sessionSecret, TRUST_PROXY: "false",
        ENABLE_MOCK_LOGIN: "true", SEED_DEMO_DATA: "false", ADMIN_EMAILS: "", ALLOWED_EMAIL_DOMAINS: "",
        GITLAB_BASE_URL: "", GITLAB_CLIENT_ID: "", GITLAB_CLIENT_SECRET: "",
        AI_BASE_URL: "", AI_API_KEY: "", AI_MODEL: "", AI_AUTO_REFRESH_ENABLED: "false",
        AI_DAILY_REQUEST_LIMIT: "20", AI_DAILY_TOKEN_BUDGET: "100000",
        AI_GLOBAL_DAILY_REQUEST_LIMIT: "200", AI_GLOBAL_DAILY_TOKEN_BUDGET: "1000000", AI_MAX_CONCURRENT: "2",
        STAFFING_MAINTENANCE_ENABLED: "true", API_RATE_LIMIT: "100000", LOGIN_RATE_LIMIT: "10000",
        NUXT_PUBLIC_DEMO_LABEL: "Synthetic demo data",
        ...overrides,
      },
    });
    closeSync(log);
    let startupFailure = false;
    application.once("error", () => { startupFailure = true; });
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupFailure || application.exitCode !== null) throw new Error("The isolated showcase application could not start.");
      try { if ((await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await pause(100);
    }
    if (!ready) throw new Error("The isolated showcase application did not become ready.");
  };
  const restartAi = async (environment: Record<string, string>) => {
    let provider: URL;
    try { provider = new URL(environment.AI_BASE_URL); } catch { throw new Error("Showcase AI checks require a loopback synthetic provider."); }
    if (!["http:", "https:"].includes(provider.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(provider.hostname) || provider.username || provider.password || provider.search || provider.hash) throw new Error("Showcase AI checks require a loopback synthetic provider.");
    await startApplication({ AI_BASE_URL: provider.toString().replace(/\/$/, ""), AI_API_KEY: "synthetic-showcase-provider-key", AI_MODEL: environment.AI_MODEL || "synthetic-showcase-model", AI_AUTO_REFRESH_ENABLED: "true", AI_AUTO_DISCOVERY_ENABLED: "true" });
  };
  try {
    await client.connect();
    if ((await db.listCollections().toArray()).length) throw new Error("The showcase database must be new and empty.");
    await startApplication();
    const { prepareShowcase } = await import(new URL("../scripts/demo-showcase.mjs", import.meta.url).href);
    const prepare = () => prepareShowcase({ baseURL, mongodbUri, database: db });
    const prepared = await prepare();
    const actor = async (key: string): Promise<ShowcaseActor> => {
      if (contexts.has(key)) return contexts.get(key)!;
      const person = prepared.manifest.actors[key];
      if (!person) throw new Error("Unknown showcase identity.");
      const api = await request.newContext({ baseURL });
      try {
        const response = await json(api.post("/api/auth/mock", { data: { as: person.role, email: person.email, name: person.name } }));
        const result = { api, id: response.user.id, email: person.email, name: person.name, role: person.role as DemoRole };
        contexts.set(key, result);
        return result;
      } catch (failure) { await api.dispose(); throw failure; }
    };
    return { ...prepared, db, baseURL, mongodbUri, databaseName, actor, prepare, restartAi, close };
  } catch (failure) { await close(); throw failure; }
}

export async function openShowcasePage(page: Page, path: string) {
  expect((await page.goto(path))?.status(), `Open ${path}`).toBe(200);
  await page.waitForFunction(() => !!(document.querySelector("#__nuxt") as any)?.__vue_app__);
  await expect(page.locator("main")).toBeVisible();
}
export async function auditShowcasePage(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  return result;
}

export const test = base.extend<{ showcase: Showcase }>({
  showcase: [async ({}, use) => {
    const service = await createShowcase();
    try { await use(service); } finally { await service.close(); }
  }, { timeout: 240000 }],
});
export { expect, json, ok };
