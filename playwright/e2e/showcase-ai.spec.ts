import { createServer } from "node:http";
import { test, expect, json } from "../showcase-fixtures";

test.setTimeout(300000);

test("the populated main demonstration generates its five AI scopes within the default daily budgets without analysis requests", async ({ showcase }, testInfo) => {
  const seen: Array<{ kind: string; targetIds: string[]; inputBytes: number; outputTokens: number; evidence: any[] }> = [];
  const provider = createServer(async (incoming, response) => {
    try {
      let body = "";
      for await (const chunk of incoming) {
        body += chunk;
        if (Buffer.byteLength(body) > 200000) throw new Error("Synthetic request exceeded its limit.");
      }
      const envelope = JSON.parse(body);
      const input = JSON.parse(envelope.messages.at(-1).content);
      seen.push({ kind: input.kind, targetIds: input.targetIds, inputBytes: Buffer.byteLength(JSON.stringify(input)), outputTokens: envelope.max_tokens, evidence: input.evidence });
      const first = input.evidence[0].reference;
      const result = {
        summary: "Synthetic test guidance cites the supplied record. All staffing decisions remain with a person.",
        summaryEvidenceRefs: [first],
        items: input.targetIds.map((targetId: string) => ({ targetId, explanation: "The supplied synthetic qualifications support human review; verify the full evidence before deciding.", evidenceRefs: [input.evidence.find((item: any) => item.reference.startsWith(`app:${targetId}:`))?.reference || first] })),
        cautions: ["Synthetic loopback provider used only in an isolated automated test."],
      };
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } catch { if (!response.headersSent) response.writeHead(500).end(); else response.destroy(); }
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const providerOrigin = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const { db, manifest, catalog } = showcase;
  const mainId = manifest.opportunityIds["intro-ta"];
  const courseId = manifest.courseIds.intro;
  const summaryId = manifest.applicationIds["candidate-04--intro-ta"];
  const scopes = [
    { kind: "candidate_fit", targetId: mainId, candidatePage: 1 },
    { kind: "candidate_fit", targetId: mainId, candidatePage: 2 },
    { kind: "cv_summary", targetId: summaryId },
    { kind: "opportunity_draft", targetId: mainId },
    { kind: "term_review", targetId: courseId, requestedTermId: manifest.termIds.current },
  ];
  const completed = () => Promise.all(scopes.map(scope => db.collection("staffingAiTasks").findOne({ automatic: true, status: "completed", ...scope }, { sort: { completedAt: -1 } })));
  try {
    expect(await db.collection("staffingAiTasks").countDocuments()).toBe(0);
    expect(await db.collection("staffingAiBudgets").countDocuments()).toBe(0);
    const faculty = await showcase.actor("faculty-main");
    await showcase.restartAi({ AI_BASE_URL: `${providerOrigin}/v1`, AI_MODEL: "synthetic-showcase-model" });
    await expect.poll(async () => (await completed()).filter(task => !!task?.result).length, { timeout: 120000, intervals: [200, 500, 1000] }).toBe(5);
    const tasks = await completed();
    expect(tasks[0]!.coverage).toMatchObject({ page: 1, pageSize: 10, compared: 10, hasMore: true });
    expect(tasks[1]!.coverage).toMatchObject({ page: 2, pageSize: 10, compared: 2, hasMore: false });
    const compared = [...tasks[0]!.result.items, ...tasks[1]!.result.items].map((item: any) => item.targetId);
    expect(new Set(compared).size).toBe(12);
    expect(compared.sort()).toEqual(catalog.featured.eligibleCandidateKeys.map((key: string) => manifest.applicationIds[`${key}--intro-ta`]).sort());
    await expect.poll(async () => db.collection("staffingAiAutomationJobs").countDocuments({ _id: { $in: tasks.map(task => task!.automationScopeId) }, status: "idle" }), { timeout: 10000 }).toBe(5);
    const eligibleIds = new Set(compared);
    const coreCall = (call: typeof seen[number]) => call.kind === "candidate_fit" ? call.targetIds.length > 0 && call.targetIds.every(id => eligibleIds.has(id)) : call.kind === "cv_summary" ? call.targetIds[0] === summaryId : call.kind === "opportunity_draft" ? call.targetIds[0] === mainId : call.kind === "term_review" && call.targetIds[0] === courseId && call.evidence.some(item => item.reference === "course:context" && item.value?.termId === manifest.termIds.current);
    const callsBeforeRead = seen.filter(coreCall).length;
    expect(callsBeforeRead).toBe(5);
    for (const scope of scopes) {
      const params = { kind: scope.kind, targetId: scope.targetId, ...(scope.kind === "candidate_fit" ? { page: String(scope.candidatePage) } : {}), ...(scope.kind === "term_review" ? { termId: manifest.termIds.current } : {}) };
      for (let read = 0; read < 3; read++) {
        const result = await json(faculty.api.get("/api/ai/tasks", { params }));
        expect(result.ai.limits).toMatchObject({ dailyRequestsPerUser: 20, dailyReservedTokensPerUser: 100000, concurrentRequests: 2 });
        expect(result.tasks.some((task: any) => task.status === "completed" && task.result && task.targetId === scope.targetId)).toBe(true);
      }
    }
    const ta = await showcase.actor("ta-main");
    expect((await ta.api.get("/api/ai/tasks", { params: { kind: "candidate_fit", targetId: mainId } })).status()).toBe(403);
    expect((await ta.api.get("/api/ai/tasks", { params: { kind: "cv_summary", targetId: summaryId } })).status()).toBe(403);
    await new Promise(resolve => setTimeout(resolve, 1600));
    expect(seen.filter(coreCall)).toHaveLength(callsBeforeRead);
    expect(seen.every(call => !/dukeUniqueId|payrollBefore|hasSsn|citizenship|authorizationExpiry/.test(JSON.stringify(call.evidence)))).toBe(true);
    for (const call of seen) expect(call.outputTokens).toBe(({ candidate_fit: 2500, cv_summary: 900, opportunity_draft: 1200, term_review: 1800 } as Record<string, number>)[call.kind]);
    const mainBudget = await db.collection("staffingAiBudgets").findOne({ _id: `user:${new Date().toISOString().slice(0, 10)}:${faculty.id}` as any });
    expect(mainBudget!.requests).toBeLessThanOrEqual(20);
    expect(mainBudget!.reservedTokens).toBeLessThanOrEqual(100000);
  } finally {
    try {
    const day = new Date().toISOString().slice(0, 10);
    const jobs = await db.collection("staffingAiAutomationJobs").find({ $or: [{ targetId: mainId }, { targetId: summaryId }, { kind: "term_review", targetId: courseId }] }, { projection: { _id: 0, kind: 1, page: 1, status: 1, reason: 1, requestedBy: 1, attempts: 1, lastTaskId: 1 } }).toArray();
    const budgets = await db.collection("staffingAiBudgets").find({ day }, { projection: { _id: 1, requests: 1, reservedTokens: 1 } }).toArray();
    const failures = await db.collection("staffingAiTasks").find({ failureCode: { $exists: true } }, { projection: { _id: 0, kind: 1, targetId: 1, requestedBy: 1, status: 1, failureCode: 1 } }).toArray();
    await testInfo.attach("showcase-ai-budget.json", { body: Buffer.from(JSON.stringify({ synthetic: true, configuredLimits: { perUserRequests: 20, perUserReservedTokens: 100000, globalRequests: 200, globalReservedTokens: 1000000 }, mainReviewerId: manifest.actors["faculty-main"].id, providerCalls: seen.length, jobs, budgets, failures }, null, 2)), contentType: "application/json" });
    // Stop the caller before its local provider so failed teardown cannot create
    // synthetic retry traffic or allow a later query to touch the fixture DB.
    } finally {
      try { await showcase.close(); } finally {
        provider.closeAllConnections();
        await new Promise<void>(resolve => provider.close(() => resolve()));
      }
    }
  }
});
