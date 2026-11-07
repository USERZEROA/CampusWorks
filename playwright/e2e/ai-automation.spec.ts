import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  json,
  ok,
  answerAutomatically,
  automaticGate,
  pause,
  type AutomaticAiHarness,
  type AutomaticAiKind,
} from "../automatic-ai-fixtures";

test.setTimeout(120000);

const positionCalls = (
  service: AutomaticAiHarness,
  kind: AutomaticAiKind,
  posting: any,
) =>
  service.seen.filter(
    (call) =>
      call.input.kind === kind &&
      call.input.evidence.some(
        (entry: any) =>
          entry.reference === "opportunity:requirements" &&
          entry.value.description === posting.description,
      ),
  );
const courseCalls = (service: AutomaticAiHarness, courseId: string) =>
  service.seen.filter(
    (call) =>
      call.input.kind === "term_review" && call.input.targetIds[0] === courseId,
  );
async function completed(
  service: AutomaticAiHarness,
  kind: AutomaticAiKind,
  targetId: string,
  extra: Record<string, any> = {},
) {
  await expect
    .poll(async () => !!(await service.completed(kind, targetId, extra)), {
      timeout: 45000,
      intervals: [100, 200, 500],
    })
    .toBe(true);
  return service.completed(kind, targetId, extra);
}
async function allIdle(service: AutomaticAiHarness) {
  await expect
    .poll(
      async () =>
        service.db
          .collection("staffingAiAutomationJobs")
          .countDocuments({ status: { $nin: ["idle", "ended", "revoked"] } }),
      { timeout: 45000, intervals: [100, 200, 500] },
    )
    .toBe(0);
}
const guidance = (
  api: any,
  kind: AutomaticAiKind,
  targetId: string,
  extra: Record<string, string | number> = {},
) => json(api.get("/api/ai/tasks", { params: { kind, targetId, ...extra } }));

test("four kinds of TA and RA guidance start unattended, are shared by current faculty and do not buy calls on reads", async ({
  automation: service,
  browser,
}) => {
  const peer = await service.actor("same-course-faculty", "instructor");
  await ok(
    service.admin.api.patch(`/api/courses/${service.code}/enrollments/role`, {
      data: { email: peer.email, role: "instructor" },
    }),
  );
  const outsider = await service.actor("unrelated-ta", "ta");
  const teaching = await service.opportunity();
  const research = await service.opportunity({ type: "ra", courseId: "" });
  const first = await service.application(teaching);
  const other = await service.actor("research-candidate");
  const second = await service.application(research, other);
  expect(service.seen).toHaveLength(0);
  await service.startAutomatic();
  // Until all seven jobs complete this test makes no resource/AI HTTP request
  // and opens no page: only the database and fake provider are observed.
  for (const [kind, id] of [
    ["candidate_fit", teaching.id],
    ["candidate_fit", research.id],
    ["cv_summary", first.id],
    ["cv_summary", second.id],
    ["opportunity_draft", teaching.id],
    ["opportunity_draft", research.id],
    ["term_review", service.code],
  ] as const)
    await completed(service, kind, id);
  await allIdle(service);
  expect(service.seen).toHaveLength(7);
  expect(new Set(service.seen.map((call) => call.input.kind))).toEqual(
    new Set([
      "candidate_fit",
      "cv_summary",
      "opportunity_draft",
      "term_review",
    ]),
  );
  const tasks = await service.db
    .collection("staffingAiTasks")
    .find({ automatic: true, status: "completed" })
    .toArray();
  expect(tasks).toHaveLength(7);
  expect(
    new Set(tasks.map((task) => `${task.automationScopeId}:${task.inputHash}`))
      .size,
  ).toBe(7);
  const peerApi = await service.apiFor(peer, 1);
  const ownerResult = await guidance(
    service.faculty.api,
    "candidate_fit",
    teaching.id,
  );
  const peerResult = await guidance(peerApi, "candidate_fit", teaching.id);
  expect(
    peerResult.tasks.find((task: any) => task.status === "completed")?.id,
  ).toBe(
    ownerResult.tasks.find((task: any) => task.status === "completed")?.id,
  );
  expect(
    (
      await outsider.api.get("/api/ai/tasks", {
        params: { kind: "candidate_fit", targetId: teaching.id },
      })
    ).status(),
  ).toBe(403);
  const context = await browser.newContext({
    baseURL: service.origins[0],
    storageState: await service.faculty.api.storageState(),
  });
  let analysisPosts = 0;
  try {
    const page = await context.newPage();
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/ai/tasks" &&
        request.method() === "POST"
      )
        analysisPosts++;
    });
    expect((await page.goto(`/staffing/${teaching.id}`))?.status()).toBe(200);
    await expect(page.getByTestId("ai-result").first()).toBeVisible();
    for (let count = 0; count < 8; count++)
      await guidance(
        count % 2 ? peerApi : service.faculty.api,
        "candidate_fit",
        teaching.id,
      );
    await pause(1600);
    expect(analysisPosts).toBe(0);
    expect(service.seen).toHaveLength(7);
    expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
      0,
    );
    expect(
      await service.db.collection("staffingAppointments").countDocuments(),
    ).toBe(0);
  } finally {
    await context.close();
  }
});

test("manual selection refreshes both faculty comparisons while unchanged summaries and requirements reuse their results", async ({
  automation: service,
}) => {
  const secondFaculty = await service.actor("second-faculty", "instructor");
  const otherCourse = await service.course(secondFaculty, "other");
  const firstPosting = await service.opportunity();
  const secondPosting = await service.opportunity(
    { courseId: otherCourse },
    secondFaculty,
  );
  const secondCandidate = await service.actor("second-candidate");
  const first = await service.application(firstPosting);
  const nextFirst = await service.application(firstPosting, secondCandidate);
  const otherFirst = await service.application(secondPosting);
  const nextOther = await service.application(secondPosting, secondCandidate);
  await service.startAutomatic();
  await completed(service, "candidate_fit", firstPosting.id);
  await completed(service, "candidate_fit", secondPosting.id);
  for (const application of [first, nextFirst, otherFirst, nextOther])
    await completed(service, "cv_summary", application.id);
  for (const posting of [firstPosting, secondPosting])
    await completed(service, "opportunity_draft", posting.id);
  for (const courseId of [service.code, otherCourse])
    await completed(service, "term_review", courseId);
  await allIdle(service);
  expect(service.seen).toHaveLength(10);
  expect(
    positionCalls(service, "candidate_fit", firstPosting)[0]!.input.targetIds,
  ).toEqual([first.id, nextFirst.id]);
  expect(
    positionCalls(service, "candidate_fit", secondPosting)[0]!.input.targetIds,
  ).toEqual([otherFirst.id, nextOther.id]);
  const before = await service.db
    .collection("staffingAiTasks")
    .find({
      kind: { $in: ["cv_summary", "opportunity_draft"] },
      automatic: true,
      status: "completed",
    })
    .toArray();
  // Zero-rate fixtures keep the course financial evidence unchanged, isolating
  // the two real candidate-list changes from legitimate report regeneration.
  const selected = await json(
    service.faculty.api.post(`/api/staffing/applications/${first.id}/select`, {
      data: { expectedVersion: first.version, idempotencyKey: randomUUID() },
    }),
  );
  expect(selected.appointment.status).toBe("offered");
  for (const [posting, id] of [
    [firstPosting, nextFirst.id],
    [secondPosting, nextOther.id],
  ] as const) {
    await expect
      .poll(
        () =>
          positionCalls(service, "candidate_fit", posting).at(-1)?.input
            .targetIds,
        { timeout: 30000 },
      )
      .toEqual([id]);
  }
  await allIdle(service);
  await pause(1000);
  expect(service.seen).toHaveLength(12);
  const after = await service.db
    .collection("staffingAiTasks")
    .find({
      kind: { $in: ["cv_summary", "opportunity_draft"] },
      automatic: true,
      status: "completed",
    })
    .toArray();
  expect(after.map((task) => task.id).sort()).toEqual(
    before.map((task) => task.id).sort(),
  );
  expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
    1,
  );
  expect(
    await service.db
      .collection("staffingAppointments")
      .countDocuments({
        status: "offered",
        clearance: "not_started",
        acceptedAt: null,
      }),
  ).toBe(1);
});

test("semester end generates final course advice without a page and bypasses preview cooldown using changed metrics", async ({
  automation: service,
}) => {
  const posting = await service.opportunity();
  await service.application(posting);
  await service.startAutomatic({ AI_TERM_REVIEW_COOLDOWN_MS: "60000" });
  await completed(service, "term_review", service.code);
  await completed(service, "candidate_fit", posting.id);
  await completed(service, "opportunity_draft", posting.id);
  await allIdle(service);
  const preview = courseCalls(service, service.code)[0]!;
  expect(
    preview.input.evidence.find(
      (item: any) => item.reference === "course:context",
    ).value.phase,
  ).toBe("preview");
  expect(
    preview.input.evidence.find(
      (item: any) => item.reference === "metrics:recorded_sessions",
    ).value.sessions,
  ).toBe(0);
  const end = new Date(Date.now() + 1800);
  await service.db
    .collection("staffingTerms")
    .updateOne({ id: service.term.id }, { $set: { endDate: end } });
  await service.db
    .collection("helpSessions")
    .insertOne({
      id: randomUUID(),
      courseId: service.code,
      entryId: randomUUID(),
      joinedAt: new Date(Date.now() - 500),
      endedAt: new Date(),
      wasHelped: true,
      waitMinutes: 5,
      helpMinutes: 10,
      source: "synthetic-automatic-acceptance",
    });
  await expect
    .poll(
      () =>
        courseCalls(service, service.code)
          .at(-1)
          ?.input.evidence.find(
            (item: any) => item.reference === "course:context",
          ).value.phase,
      { timeout: 20000 },
    )
    .toBe("final");
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationJobs")
            .findOne({ kind: "term_review", targetId: service.code })
        )?.status,
      { timeout: 15000 },
    )
    .toBe("idle");
  const final = courseCalls(service, service.code).at(-1)!;
  expect(final.at).toBeGreaterThanOrEqual(end.getTime());
  expect(final.at - preview.at).toBeLessThan(60000);
  expect(
    final.input.evidence.find(
      (item: any) => item.reference === "metrics:recorded_sessions",
    ).value,
  ).toMatchObject({ sessions: 1, helped: 1, recordedHelpMinutes: 10 });
  expect(courseCalls(service, service.code)).toHaveLength(2);
  await pause(1200);
  expect(courseCalls(service, service.code)).toHaveLength(2);
  expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
    0,
  );
});

test("provider failures back off and exhausted daily capacity stays blocked despite repeated reads", async ({
  automation: service,
}) => {
  const posting = await service.opportunity();
  await service.application(posting);
  service.setResponder((call, response) =>
    call.input.kind === "candidate_fit"
      ? void response.writeHead(503).end()
      : answerAutomatically(call, response),
  );
  await service.startAutomatic({ AI_AUTO_RETRY_BASE_MS: "2500" });
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationJobs")
            .findOne({ kind: "candidate_fit", targetId: posting.id })
        )?.attempts,
      { timeout: 20000 },
    )
    .toBe(1);
  const first = positionCalls(service, "candidate_fit", posting)[0]!;
  for (let index = 0; index < 8; index++)
    await guidance(service.faculty.api, "candidate_fit", posting.id);
  expect(positionCalls(service, "candidate_fit", posting)).toHaveLength(1);
  await expect
    .poll(() => positionCalls(service, "candidate_fit", posting).length, {
      timeout: 20000,
    })
    .toBe(2);
  expect(
    positionCalls(service, "candidate_fit", posting)[1]!.at - first.at,
  ).toBeGreaterThanOrEqual(2000);
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationJobs")
            .findOne({ kind: "candidate_fit", targetId: posting.id })
        )?.attempts,
      { timeout: 15000 },
    )
    .toBe(2);
  await service.stopApps();
  await service.db
    .collection("staffingAiAutomationJobs")
    .updateOne(
      { kind: "candidate_fit", targetId: posting.id },
      { $set: { status: "queued", nextAttemptAt: new Date(0) } },
    );
  const callsBeforeQuota = service.seen.length;
  await service.startAutomatic({
    AI_GLOBAL_DAILY_REQUEST_LIMIT: "1",
    AI_AUTO_RETRY_BASE_MS: "2500",
  });
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationJobs")
            .findOne({ kind: "candidate_fit", targetId: posting.id })
        )?.status,
      { timeout: 20000 },
    )
    .toBe("blocked");
  const blocked = await service.db
    .collection("staffingAiAutomationJobs")
    .findOne({ kind: "candidate_fit", targetId: posting.id });
  expect(new Date(blocked!.nextAttemptAt).getTime()).toBeGreaterThan(
    Date.now(),
  );
  const failed = await service.db
    .collection("staffingAiTasks")
    .findOne({ id: blocked!.taskId });
  expect(failed).toMatchObject({
    status: "failed",
    failureCode: "quota_daily",
    result: null,
  });
  const taskCount = await service.db
    .collection("staffingAiTasks")
    .countDocuments();
  for (let index = 0; index < 8; index++)
    await guidance(service.faculty.api, "candidate_fit", posting.id);
  await pause(1500);
  expect(service.seen).toHaveLength(callsBeforeQuota);
  expect(await service.db.collection("staffingAiTasks").countDocuments()).toBe(
    taskCount,
  );
});

test("revoking the in-flight reviewer prevents publication, allows a current peer to take over and stops with no manager", async ({
  automation: service,
}, testInfo) => {
  const peer = await service.actor("takeover-faculty", "instructor");
  await ok(
    service.admin.api.patch(`/api/courses/${service.code}/enrollments/role`, {
      data: { email: peer.email, role: "instructor" },
    }),
  );
  const posting = await service.opportunity();
  const application = await service.application(posting);
  const gate = automaticGate();
  let held = false;
  service.setResponder(async (call, response) => {
    if (call.input.kind === "candidate_fit" && !held) {
      held = true;
      await gate.promise;
    }
    answerAutomatically(call, response);
  });
  try {
    await service.startAutomatic();
    await expect.poll(() => held, { timeout: 20000 }).toBe(true);
    const original = await service.db
      .collection("staffingAiAutomationJobs")
      .findOne({
        kind: "candidate_fit",
        targetId: posting.id,
        status: "running",
      });
    expect(original?.requestedBy).toBe(service.faculty.user.id);
    await service.db
      .collection("enrollments")
      .deleteOne({ courseId: service.code, userEmail: service.faculty.email });
    expect(await service.db.collection("enrollments").distinct("userEmail", { courseId: service.code, role: { $in: ["instructor", "admin"] } })).toEqual([peer.email]);
    gate.release();
    await expect
      .poll(
        async () =>
          (
            await service.db
              .collection("staffingAiTasks")
              .findOne({ id: original!.taskId })
          )?.status,
        { timeout: 15000 },
      )
      .toMatch(/failed|stale/);
    expect(
      (
        await service.db
          .collection("staffingAiTasks")
          .findOne({ id: original!.taskId })
      )?.result,
    ).toBeFalsy();
    let replacement;
    try {
      replacement = await completed(service, "candidate_fit", posting.id, {
        requestedBy: peer.user.id,
      });
    } catch (failure) {
      const jobs = await service.db.collection('staffingAiAutomationJobs').find({ targetId: posting.id }, { projection: { _id: 1, kind: 1, targetId: 1, requestedBy: 1, status: 1, generation: 1, runningGeneration: 1, inputHash: 1, runningInputHash: 1, lastInputHash: 1, taskId: 1, lastTaskId: 1, attempts: 1, leaseUntil: 1, nextAttemptAt: 1, nextObserveAt: 1, observationVersion: 1, lastObservedAt: 1, updatedAt: 1 } }).toArray();
      const tasks = await service.db.collection('staffingAiTasks').find({ targetId: posting.id }, { projection: { _id: 0, id: 1, kind: 1, requestedBy: 1, status: 1, failureCode: 1, inputHash: 1, automationScopeId: 1, automationGeneration: 1, createdAt: 1, completedAt: 1 } }).sort({ createdAt: -1 }).limit(30).toArray();
      const members = await service.db.collection('enrollments').find({ courseId: service.code }, { projection: { _id: 0, userEmail: 1, role: 1 } }).toArray();
      const diagnostic = { synthetic: true, expectedPeerId: peer.user.id, originalActorId: service.faculty.user.id, memberships: members.map(member => ({ actor: member.userEmail === peer.email ? 'peer' : member.userEmail === service.faculty.email ? 'original' : 'other', role: member.role })), jobs, tasks, providerKinds: service.seen.map(call => call.input.kind) };
      await testInfo.attach('revocation-state.json', { body: Buffer.from(JSON.stringify(diagnostic, null, 2)), contentType: 'application/json' });
      throw failure;
    }
    expect(replacement!.id).not.toBe(original!.taskId);
    await allIdle(service);
    await service.db
      .collection("enrollments")
      .deleteOne({ courseId: service.code, userEmail: peer.email });
    expect(await service.db.collection("enrollments").countDocuments({ courseId: service.code, role: { $in: ["instructor", "admin"] } })).toBe(0);
    const saved = (
      await json(
        service.student.api.patch(
          `/api/staffing/applications/${application.id}`,
          {
            data: {
              expectedVersion: application.version,
              profile: application.profile,
              answers: application.answers,
              qualificationText:
                "Synthetic changed evidence after all manager grants were removed.",
            },
          },
        ),
      )
    ).application;
    await ok(
      service.student.api.post(
        `/api/staffing/applications/${application.id}/submit`,
        { data: { expectedVersion: saved.version } },
      ),
    );
    await expect
      .poll(
        async () =>
          (
            await service.db
              .collection("staffingAiAutomationJobs")
              .findOne({ kind: "candidate_fit", targetId: posting.id })
          )?.status,
        { timeout: 20000 },
      )
      .toMatch(/ended|revoked/);
    const callsWithoutManagers = service.seen.length;
    await pause(1600);
    expect(service.seen).toHaveLength(callsWithoutManagers);
    expect(
      (
        await service.faculty.api.get("/api/ai/tasks", {
          params: { kind: "candidate_fit", targetId: posting.id },
        })
      ).status(),
    ).toBe(403);
    expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
      0,
    );
  } finally {
    gate.release();
  }
});

test("an expired execution lease cannot publish after another node takes over the same scope", async ({
  automation: service,
}) => {
  const posting = await service.opportunity();
  await service.application(posting);
  const gate = automaticGate();
  let held = false;
  service.setResponder(async (call, response) => {
    if (call.input.kind === "candidate_fit" && !held) {
      held = true;
      await gate.promise;
    }
    answerAutomatically(call, response);
  });
  try {
    await service.startAutomatic();
    await expect.poll(() => held, { timeout: 20000 }).toBe(true);
    const original = await service.db
      .collection("staffingAiAutomationJobs")
      .findOne({
        kind: "candidate_fit",
        targetId: posting.id,
        status: "running",
      });
    expect(original).toBeTruthy();
    await service.db
      .collection("staffingAiAutomationJobs")
      .updateOne(
        { _id: original!._id, leaseToken: original!.leaseToken },
        { $set: { leaseUntil: new Date(0) } },
      );
    await expect
      .poll(() => positionCalls(service, "candidate_fit", posting).length, {
        timeout: 15000,
      })
      .toBe(2);
    gate.release();
    await expect
      .poll(
        async () =>
          (
            await service.db
              .collection("staffingAiTasks")
              .findOne({ id: original!.taskId })
          )?.status,
        { timeout: 15000 },
      )
      .toMatch(/failed|stale/);
    expect(
      (
        await service.db
          .collection("staffingAiTasks")
          .findOne({ id: original!.taskId })
      )?.result,
    ).toBeFalsy();
    await allIdle(service);
    const job = await service.db
      .collection("staffingAiAutomationJobs")
      .findOne({ kind: "candidate_fit", targetId: posting.id });
    expect(job!.lastTaskId).not.toBe(original!.taskId);
    const current = await service.db
      .collection("staffingAiTasks")
      .findOne({ id: job!.lastTaskId });
    expect(current).toMatchObject({
      status: "completed",
      requestedBy: service.faculty.user.id,
      automatic: true,
      result: expect.any(Object),
    });
    expect(
      await service.db
        .collection("staffingAiTasks")
        .countDocuments({
          automationScopeId: original!._id,
          status: "completed",
          result: { $ne: null },
        }),
    ).toBe(1);
  } finally {
    gate.release();
  }
});
