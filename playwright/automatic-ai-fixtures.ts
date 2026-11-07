import { createServer, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import {
  request,
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { createCourse, type DemoRole } from "./helpers";
import { json, ok, type Actor } from "./staffing-fixtures";

export type AutomaticAiKind =
  "candidate_fit" | "cv_summary" | "opportunity_draft" | "term_review";
export type AutomaticAiCall = {
  input: any;
  envelope: any;
  at: number;
  ordinal: number;
};
export type AutomaticAiResponder = (
  call: AutomaticAiCall,
  response: ServerResponse,
) => void | Promise<void>;

/** A local provider returns only citations present in the current synthetic input. */
export function answerAutomatically(
  call: AutomaticAiCall,
  response: ServerResponse,
) {
  if (response.destroyed || response.writableEnded) return;
  const { input } = call;
  const reference =
    input.evidence.find((item: any) => item.reference.startsWith("app:"))
      ?.reference || input.evidence[0].reference;
  const result = {
    summary: "Synthetic automatic guidance from the supplied evidence.",
    summaryEvidenceRefs: [reference],
    items: input.targetIds.map((targetId: string) => ({
      targetId,
      explanation:
        "Synthetic evidence is available; the staffing decision remains with a person.",
      evidenceRefs: [
        input.evidence.find((item: any) =>
          item.reference.startsWith(`app:${targetId}:`),
        )?.reference || reference,
      ],
    })),
    cautions: [
      "Synthetic loopback provider; no employment decision or paid request.",
    ],
  };
  response.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }),
  );
}

export const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
export function automaticGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function freePort() {
  const allocator = createServer();
  await new Promise<void>((resolve) =>
    allocator.listen(0, "127.0.0.1", resolve),
  );
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>((resolve) => allocator.close(() => resolve()));
  return port;
}
async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export type AutomaticAiHarness = {
  db: Db;
  name: string;
  code: string;
  term: any;
  origins: string[];
  seen: AutomaticAiCall[];
  admin: Actor;
  faculty: Actor;
  student: Actor;
  actor: (label: string, role?: DemoRole) => Promise<Actor>;
  apiFor: (actor: Actor, node?: number) => Promise<APIRequestContext>;
  course: (owner: Actor, label: string, peers?: Actor[]) => Promise<string>;
  opportunity: (overrides?: Record<string, any>, owner?: Actor) => Promise<any>;
  application: (
    posting: any,
    candidate?: Actor,
    overrides?: Record<string, any>,
  ) => Promise<any>;
  startAutomatic: (
    environment?: Record<string, string>,
    nodes?: number,
  ) => Promise<void>;
  stopApps: () => Promise<void>;
  setResponder: (responder: AutomaticAiResponder) => void;
  completed: (
    kind: AutomaticAiKind,
    targetId: string,
    extra?: Record<string, any>,
  ) => Promise<any>;
  close: () => Promise<void>;
};

/** Disposable database and two stable loopback origins; no credential file is read. */
export async function createAutomaticAiHarness(): Promise<AutomaticAiHarness> {
  const uri = process.env.TEST_MONGODB_URI || "";
  const mainName = process.env.TEST_MONGODB_DB || "";
  if (
    !uri ||
    !mainName.startsWith("campusworks_") ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(uri).hostname)
  )
    throw new Error(
      "Automatic AI checks require the isolated loopback replica set.",
    );
  const suffix = randomBytes(6).toString("hex");
  const name = `campusworks_ai_auto_${suffix}`;
  if (name === mainName || !/^campusworks_ai_auto_[a-f0-9]+$/.test(name))
    throw new Error("Invalid isolated AI database.");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(name);
  const seen: AutomaticAiCall[] = [];
  let respond: AutomaticAiResponder = answerAutomatically;
  const provider = createServer(async (incoming, response) => {
    try {
      let body = "";
      for await (const chunk of incoming) body += chunk;
      const envelope = JSON.parse(body);
      const call = {
        input: JSON.parse(envelope.messages.at(-1).content),
        envelope,
        at: Date.now(),
        ordinal: seen.length + 1,
      };
      seen.push(call);
      if (seen.length > 300) {
        response.writeHead(503).end();
        return;
      }
      await respond(call, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    }
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const providerOrigin = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const firstPort = await freePort();
  let secondPort = await freePort();
  while (secondPort === firstPort) secondPort = await freePort();
  const ports = [firstPort, secondPort];
  const origins = ports.map((port) => `http://127.0.0.1:${port}`);
  const secret = randomBytes(32).toString("hex");
  const children: ChildProcess[] = [];
  const contexts: APIRequestContext[] = [];
  let administratorLoggedOut = false;
  mkdirSync(".cache", { recursive: true });
  const stopApps = async () => {
    await Promise.all(children.splice(0).map(stopChild));
  };
  const startApps = async (
    enabled: boolean,
    environment: Record<string, string> = {},
    nodes = 2,
  ) => {
    await stopApps();
    for (let index = 0; index < nodes; index++) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(ports[index]),
        PUBLIC_ORIGIN: origins[index],
        TRUST_PROXY: "false",
        MONGODB_URI: uri,
        MONGODB_DB: name,
        SESSION_SECRET: secret,
        ENABLE_MOCK_LOGIN: "true",
        SEED_DEMO_DATA: "false",
        ADMIN_EMAILS: "",
        ALLOWED_EMAIL_DOMAINS: "",
        GITLAB_BASE_URL: "",
        GITLAB_CLIENT_ID: "",
        GITLAB_CLIENT_SECRET: "",
        API_RATE_LIMIT: "100000",
        LOGIN_RATE_LIMIT: "10000",
        AI_BASE_URL: `${providerOrigin}/v1`,
        AI_API_KEY: "synthetic-automatic-key",
        AI_MODEL: "synthetic-automatic-model",
        AI_DAILY_REQUEST_LIMIT: "1000",
        AI_DAILY_TOKEN_BUDGET: "10000000",
        AI_GLOBAL_DAILY_REQUEST_LIMIT: "10000",
        AI_GLOBAL_DAILY_TOKEN_BUDGET: "100000000",
        AI_MAX_CONCURRENT: "2",
        AI_AUTO_REFRESH_ENABLED: enabled ? "true" : "false",
        AI_AUTO_DISCOVERY_INTERVAL_MS: "50",
        AI_AUTO_DEBOUNCE_MS: "50",
        AI_AUTO_RETRY_BASE_MS: "2000",
        AI_AUTO_DISCOVERY_BATCH_SIZE: "12",
        AI_AUTO_DISCOVERY_WORK_MS: "350",
        AI_AUTO_SCOPE_SCAN_INTERVAL_MS: "50",
        AI_TERM_REVIEW_SCAN_INTERVAL_MS: "50",
        AI_TERM_REVIEW_COOLDOWN_MS: "50",
        ...environment,
      };
      // Its absence verifies that four-kind discovery is enabled by default.
      delete env.AI_AUTO_DISCOVERY_ENABLED;
      const log = openSync(`.cache/automatic-ai-${suffix}-${index}.log`, "w");
      const child = spawn(process.execPath, [".output/server/index.mjs"], {
        env,
        stdio: ["ignore", log, log],
      });
      let startupError: Error | undefined;
      child.once("error", (error) => {
        startupError = error;
      });
      closeSync(log);
      children.push(child);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (startupError) throw startupError;
        if (child.exitCode !== null)
          throw new Error(`Automatic AI node ${index} exited during startup.`);
        try {
          if ((await fetch(`${origins[index]}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await pause(100);
      }
      if (!ready)
        throw new Error(`Automatic AI node ${index} did not become ready.`);
    }
  };
  const close = async () => {
    await stopApps();
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    if (/^campusworks_ai_auto_[a-f0-9]+$/.test(name) && name !== mainName)
      await db.dropDatabase();
    await client.close();
  };
  try {
    await startApps(false, {}, 1);
    const actor = async (
      label: string,
      role: DemoRole = "student",
    ): Promise<Actor> => {
      const api = await request.newContext({ baseURL: origins[0] });
      contexts.push(api);
      const email = `${label}-${suffix}@example.com`;
      const result = await json(
        api.post("/api/auth/mock", { data: { as: role, email } }),
      );
      return { api, email, role, user: result.user };
    };
    const admin = await actor("automatic-admin", "admin");
    const faculty = await actor("automatic-faculty", "instructor");
    const student = await actor("automatic-student");
    const course = async (owner: Actor, label: string, peers: Actor[] = []) => {
      const code = `auto-${label}-${suffix}`;
      await createCourse(
        admin.api,
        code,
        [owner, ...peers].map((account) => ({
          email: account.email,
          role: "instructor" as const,
        })),
      );
      return code;
    };
    const code = await course(faculty, "course");
    const term = (
      await json(
        admin.api.post("/api/staffing/terms", {
          data: {
            name: `Synthetic automatic semester ${suffix}`,
            startDate: new Date(Date.now() - 86400000).toISOString(),
            endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
            requiresApproval: false,
          },
        }),
      )
    ).term;
    const settings = (await json(admin.api.get("/api/staffing/cycle"))).cycle;
    await ok(
      admin.api.put("/api/staffing/cycle", {
        data: {
          expectedVersion: settings.version,
          termId: term.id,
          enabled: true,
          opensAt: new Date(Date.now() - 3600000).toISOString(),
          closesAt: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    );
    let positions = 0;
    const opportunity = async (
      overrides: Record<string, any> = {},
      owner = faculty,
    ) => {
      const label = ++positions;
      let posting = (
        await json(
          owner.api.post("/api/staffing/opportunities", {
            data: {
              type: "ta",
              courseId: code,
              title: `Synthetic automatic position ${label}`,
              department: "Computer Science",
              description: `Synthetic automatic requirements ${label}-${suffix}.`,
              weeklyHours: 10,
              positions: 2,
              appointmentStart: new Date(Date.now() - 3600000).toISOString(),
              appointmentEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
              requiredSkills: "Algorithms and communication",
              preferredSkills: "Teaching practice",
              questions: [
                {
                  id: "experience",
                  prompt: "Describe relevant technical experience.",
                  required: true,
                  purpose: "qualification",
                },
              ],
              cvRequired: false,
              approvalRequired: false,
              hourlyRate: 0,
              budget: 0,
              duties: [],
              ...overrides,
            },
          }),
        )
      ).opportunity;
      posting = (
        await json(
          owner.api.post(`/api/staffing/opportunities/${posting.id}/publish`, {
            data: { expectedVersion: posting.version },
          }),
        )
      ).opportunity;
      return posting;
    };
    const application = async (
      posting: any,
      candidate = student,
      overrides: Record<string, any> = {},
    ) => {
      let application = (
        await json(
          candidate.api.post(
            `/api/staffing/opportunities/${posting.id}/applications`,
            { data: {} },
          ),
        )
      ).application;
      application = (
        await json(
          candidate.api.patch(`/api/staffing/applications/${application.id}`, {
            data: {
              expectedVersion: application.version,
              profile: {
                firstName: "Synthetic",
                lastName: "Candidate",
                preferredEmail: candidate.email,
                undergraduateMajors: "Computer Science",
                department: "Computer Science",
                positionPreference: "either",
                priorTaExperience: false,
                priorCourses: "",
                multipleCourses: false,
                graduationTerm: term.name,
                availableHours: 20,
                availability: "Weekday afternoons",
                skills: "Algorithms",
                experience: "Synthetic peer tutoring",
                slots: [],
              },
              answers: {
                experience: "Synthetic technical coursework and tutoring.",
              },
              qualificationText:
                "Synthetic algorithms coursework and peer explanations.",
              ...overrides,
            },
          }),
        )
      ).application;
      return (
        await json(
          candidate.api.post(
            `/api/staffing/applications/${application.id}/submit`,
            { data: { expectedVersion: application.version } },
          ),
        )
      ).application;
    };
    const apiFor = async (account: Actor, node = 1) => {
      const api = await request.newContext({
        baseURL: origins[node],
        storageState: await account.api.storageState(),
      });
      contexts.push(api);
      return api;
    };
    const completed = async (
      kind: AutomaticAiKind,
      targetId: string,
      extra: Record<string, any> = {},
    ) =>
      db
        .collection("staffingAiTasks")
        .findOne(
          { automatic: true, kind, targetId, status: "completed", ...extra },
          { sort: { completedAt: -1, id: 1 } },
        );
    const startAutomatic = async (
      environment: Record<string, string> = {},
      nodes = 2,
    ) => {
      // The unattended manager must come from current course scope, not a
      // still-signed-in synthetic site administrator used only for setup.
      if (!administratorLoggedOut) {
        await ok(admin.api.post("/api/auth/logout"));
        administratorLoggedOut = true;
      }
      await startApps(true, environment, nodes);
    };
    return {
      db,
      name,
      code,
      term,
      origins,
      seen,
      admin,
      faculty,
      student,
      actor,
      apiFor,
      course,
      opportunity,
      application,
      startAutomatic,
      stopApps,
      setResponder: (handler) => {
        respond = handler;
      },
      completed,
      close,
    };
  } catch (failure) {
    await close();
    throw failure;
  }
}

export const test = base.extend<{ automation: AutomaticAiHarness }>({
  automation: async ({}, use) => {
    const service = await createAutomaticAiHarness();
    try {
      await use(service);
    } finally {
      await service.close();
    }
  },
});
export { expect, json, ok };
