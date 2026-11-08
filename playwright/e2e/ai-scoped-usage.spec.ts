import { randomBytes } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { test as base } from "@playwright/test";
import {
  createAutomaticAiHarness,
  expect,
  json,
  pause,
  type AutomaticAiHarness,
} from "../automatic-ai-fixtures";

type UsageFixture = { name: string; db: Db };
const test = base.extend<{ usage: UsageFixture; scoped: AutomaticAiHarness }>({
  usage: async ({}, use) => {
    const uri = process.env.TEST_MONGODB_URI || "";
    const applicationDatabase = process.env.TEST_MONGODB_DB || "";
    if (!applicationDatabase.startsWith("campusworks_") || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(uri).hostname)) throw new Error("Shared AI usage checks require the isolated loopback replica set.");
    const name = `campusworks_test_ai_usage_${randomBytes(8).toString("hex")}`;
    const client = new MongoClient(uri);
    await client.connect();
    try { await use({ name, db: client.db(name) }); }
    finally {
      if (!/^campusworks_test_ai_usage_[a-f0-9]{16}$/.test(name) || name === applicationDatabase) throw new Error("Refusing to clean an unowned AI usage database.");
      await client.db(name).dropDatabase();
      await client.close();
    }
  },
  scoped: async ({ usage }, use) => {
    const service = await createAutomaticAiHarness({ environment: { AI_USAGE_DATABASE: usage.name } });
    try { await use(service); } finally { await service.close(); }
  },
});
test.setTimeout(180000);

const fourScopes = (service: AutomaticAiHarness, posting: any, application: any) => [
  { kind: "candidate_fit", targetId: posting.id },
  { kind: "cv_summary", targetId: application.id },
  { kind: "opportunity_draft", targetId: posting.id },
  { kind: "term_review", targetId: service.code, termId: service.term.id },
];
async function waitCompleted(service: AutomaticAiHarness, scopes: ReturnType<typeof fourScopes>) {
  for (const item of scopes) await expect.poll(async () => !!await service.completed(item.kind as any, item.targetId), { timeout: 45000, intervals: [100, 200, 500] }).toBe(true);
  await expect.poll(() => service.db.collection("staffingAiAutomationJobs").countDocuments({ status: { $nin: ["idle", "ended", "revoked"] } }), { timeout: 30000 }).toBe(0);
}
async function usageSnapshot(usage: UsageFixture) {
  const rows = usage.db.collection<any>("staffingAiBudgets");
  const day = new Date().toISOString().slice(0, 10);
  const global = await rows.findOne({ _id: `global:${day}` });
  const accounts = await rows.find({ _id: { $regex: `^user:${day}:` } }).sort({ _id: 1 }).toArray();
  const concurrency = await rows.findOne({ _id: "concurrency" });
  return { global, accounts, concurrency };
}

test("an explicit empty AI scope list performs no provider calls despite eligible populated resources", async ({ scoped: service, usage }) => {
  const posting = await service.opportunity();
  await service.application(posting);
  await service.opportunity({ type: "ra", courseId: "" });
  await service.startAutomatic({ AI_AUTOMATION_SCOPES: "[]" });
  // Many 50 ms discovery/execution ticks pass without any browser or AI read.
  await pause(1600);
  expect(service.seen).toHaveLength(0);
  expect(await service.db.collection("staffingAiTasks").countDocuments()).toBe(0);
  expect(await service.db.collection("staffingAiAutomationJobs").countDocuments()).toBe(0);
  expect(await usage.db.collection("staffingAiBudgets").countDocuments()).toBe(0);
});

test("four selected AI scopes exclude other eligible resources and still require current management authority", async ({ scoped: service }) => {
  const selected = await service.opportunity();
  const application = await service.application(selected);
  const otherFaculty = await service.actor("unselected-faculty", "instructor");
  const otherCourse = await service.course(otherFaculty, "unselected");
  const otherPosting = await service.opportunity({ courseId: otherCourse }, otherFaculty);
  await service.application(otherPosting);
  const research = await service.opportunity({ type: "ra", courseId: "" });
  await service.application(research);
  const scopes = fourScopes(service, selected, application);
  const environment = { AI_AUTOMATION_SCOPES: JSON.stringify(scopes) };
  await service.startAutomatic(environment);
  await waitCompleted(service, scopes);
  await pause(1000);
  expect(service.seen).toHaveLength(4);
  const jobs = await service.db.collection("staffingAiAutomationJobs").find().toArray();
  expect(jobs.map(job => `${job.kind}:${job.targetId}`).sort()).toEqual(scopes.map(item => `${item.kind}:${item.targetId}`).sort());
  expect(await service.db.collection("staffingAiTasks").countDocuments({ automatic: true, status: "completed" })).toBe(4);
  await service.stopApps();
  await service.db.collection("enrollments").deleteMany({ courseId: service.code, userEmail: service.faculty.email });
  // Changed input plus a due observation would require another call if the
  // allowlist were incorrectly treated as an authorization grant.
  await service.db.collection("staffingOpportunities").updateOne({ id: selected.id }, { $set: { description: "Synthetic changed requirements after authority was revoked." } });
  await service.db.collection("staffingAiAutomationJobs").updateMany({}, { $set: { nextObserveAt: new Date(0), nextAttemptAt: new Date(0) } });
  await service.startAutomatic(environment);
  await expect.poll(() => service.db.collection("staffingAiAutomationJobs").countDocuments({ status: { $in: ["ended", "revoked"] } }), { timeout: 30000 }).toBe(4);
  await pause(800);
  expect(service.seen).toHaveLength(4);
  expect((await service.faculty.api.get("/api/ai/tasks", { params: { kind: "candidate_fit", targetId: selected.id } })).status()).toBe(403);
  expect((await service.student.api.get("/api/ai/tasks", { params: { kind: "candidate_fit", targetId: selected.id } })).status()).toBe(403);
});

test("shared AI usage survives application database disposal and enforces account and global limits after new mock IDs", async ({ usage }) => {
  const identitySuffix = `shared-${randomBytes(6).toString("hex")}`;
  const initial = { AI_USAGE_DATABASE: usage.name, AI_DAILY_REQUEST_LIMIT: "4", AI_GLOBAL_DAILY_REQUEST_LIMIT: "100" };
  let first: AutomaticAiHarness | undefined;
  let second: AutomaticAiHarness | undefined;
  try {
    first = await createAutomaticAiHarness({ environment: initial, identitySuffix });
    const posting = await first.opportunity();
    const scopes = fourScopes(first, posting, await first.application(posting));
    await first.startAutomatic({ AI_AUTOMATION_SCOPES: JSON.stringify(scopes) });
    await waitCompleted(first, scopes);
    expect(first.seen).toHaveLength(4);
    const firstId = first.faculty.user.id;
    const firstDatabase = first.name;
    const email = first.faculty.email;
    const before = await usageSnapshot(usage);
    expect(before.global).toMatchObject({ requests: 4 });
    expect(before.global.reservedTokens).toBeGreaterThan(0);
    expect(before.accounts).toHaveLength(1);
    expect(before.accounts[0]).toMatchObject({ requests: 4 });
    expect(before.accounts[0]._id).toMatch(/^user:\d{4}-\d{2}-\d{2}:shared:[a-f0-9]{64}$/);
    expect(JSON.stringify(before.accounts)).not.toContain(email);
    expect(before.concurrency.leases).toHaveLength(0);
    await first.close();
    first = undefined;
    expect((await usage.db.client.db(firstDatabase).listCollections().toArray())).toHaveLength(0);
    expect(await usageSnapshot(usage)).toEqual(before);

    second = await createAutomaticAiHarness({ environment: initial, identitySuffix });
    expect(second.name).not.toBe(firstDatabase);
    expect(second.faculty.user.id).not.toBe(firstId);
    expect(second.faculty.email).toBe(email);
    const nextPosting = await second.opportunity();
    const nextScopes = fourScopes(second, nextPosting, await second.application(nextPosting));
    await second.startAutomatic({ AI_AUTOMATION_SCOPES: JSON.stringify(nextScopes) });
    await expect.poll(() => second!.db.collection("staffingAiTasks").countDocuments({ failureCode: "quota_daily" }), { timeout: 30000 }).toBe(4);
    expect(second.seen).toHaveLength(0);
    expect(await usageSnapshot(usage)).toEqual(before);

    const globalPosting = await second.opportunity();
    await second.startAutomatic({ AI_DAILY_REQUEST_LIMIT: "100", AI_GLOBAL_DAILY_REQUEST_LIMIT: "4", AI_AUTOMATION_SCOPES: JSON.stringify([{ kind: "opportunity_draft", targetId: globalPosting.id }]) });
    await expect.poll(() => second!.db.collection("staffingAiTasks").countDocuments({ targetId: globalPosting.id, failureCode: "quota_daily" }), { timeout: 30000 }).toBe(1);
    await pause(800);
    expect(second.seen).toHaveLength(0);
    expect(await usageSnapshot(usage)).toEqual(before);
    expect(await second.db.collection("staffingAiBudgets").countDocuments()).toBe(0);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
  }
});

test("two application databases racing the same shared account cannot consume the final AI request twice", async ({ usage }) => {
  const identitySuffix = `race-${randomBytes(6).toString("hex")}`;
  const environment = { AI_USAGE_DATABASE: usage.name, AI_DAILY_REQUEST_LIMIT: "1", AI_GLOBAL_DAILY_REQUEST_LIMIT: "1", AI_AUTOMATION_SCOPES: "[]" };
  const services: AutomaticAiHarness[] = [];
  try {
    for (let index = 0; index < 2; index++) services.push(await createAutomaticAiHarness({ environment, identitySuffix }));
    const postings = await Promise.all(services.map(service => service.opportunity()));
    const results = await Promise.all(services.map((service, index) => json(service.faculty.api.post("/api/ai/tasks", { data: { kind: "opportunity_draft", targetId: postings[index].id } }))));
    expect(results.map(result => result.task.status).sort()).toEqual(["completed", "failed"]);
    expect(results.find(result => result.task.status === "failed").task.failureCode).toBe("quota_daily");
    expect(services.reduce((count, service) => count + service.seen.length, 0)).toBe(1);
    const snapshot = await usageSnapshot(usage);
    expect(snapshot.global).toMatchObject({ requests: 1 });
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({ requests: 1, reservedTokens: snapshot.global.reservedTokens });
    expect(snapshot.concurrency.leases).toHaveLength(0);
    for (const service of services) expect(await service.db.collection("staffingAiBudgets").countDocuments()).toBe(0);
  } finally { for (const service of services) await service.close(); }
});
