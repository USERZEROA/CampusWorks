import {
  test,
  expect,
  json,
  pause,
  type AutomaticAiHarness,
} from "../automatic-ai-fixtures";

test.setTimeout(180000);

const candidateCalls = (service: AutomaticAiHarness, posting: any) =>
  service.seen.filter(
    (call) =>
      call.input.kind === "candidate_fit" &&
      call.input.evidence.some(
        (entry: any) =>
          entry.reference === "opportunity:requirements" &&
          entry.value.description === posting.description,
      ),
  );
async function completedPage(
  service: AutomaticAiHarness,
  opportunityId: string,
  page: number,
) {
  await expect
    .poll(
      async () =>
        !!(await service.completed("candidate_fit", opportunityId, {
          candidatePage: page,
          candidatePageSize: 10,
        })),
      { timeout: 60000, intervals: [100, 200, 500] },
    )
    .toBe(true);
  return service.completed("candidate_fit", opportunityId, {
    candidatePage: page,
    candidatePageSize: 10,
  });
}
const scopeVersions = async (
  service: AutomaticAiHarness,
  opportunityId: string,
) =>
  (
    await service.db
      .collection("staffingAiAutomationJobs")
      .find({ kind: "candidate_fit", targetId: opportunityId, pageSize: 10 })
      .sort({ page: 1 })
      .toArray()
  ).map((job) => ({
    id: job._id,
    page: job.page,
    generation: job.generation,
    inputHash: job.inputHash,
    lastTaskId: job.lastTaskId,
  }));

test("automatic ten-candidate pages cover all twelve applicants and Next candidates only reads existing guidance", async ({
  automation: service,
  browser,
}) => {
  const posting = await service.opportunity();
  const applications: any[] = [];
  for (let index = 0; index < 12; index++) {
    const candidate =
      index === 0
        ? service.student
        : await service.actor(`automatic-page-${index}`);
    applications.push(
      await service.application(posting, candidate, {
        qualificationText: `Synthetic qualification ${index}: algorithms coursework and tutoring.`,
      }),
    );
  }
  const outsider = await service.actor("page-scope-outsider", "ta");
  expect(service.seen).toHaveLength(0);
  await service.startAutomatic();
  // No page or AI route is opened while both comparison pages are discovered.
  const first = await completedPage(service, posting.id, 1);
  const second = await completedPage(service, posting.id, 2);
  expect(first!.coverage).toMatchObject({
    page: 1,
    pageSize: 10,
    compared: 10,
    totalSubmitted: 12,
    hasMore: true,
  });
  expect(second!.coverage).toMatchObject({
    page: 2,
    pageSize: 10,
    compared: 2,
    totalSubmitted: 12,
    hasMore: false,
  });
  const compared = [...first!.result.items, ...second!.result.items].map(
    (item: any) => item.targetId,
  );
  expect(compared).toHaveLength(12);
  expect(new Set(compared).size).toBe(12);
  expect([...compared].sort()).toEqual(
    applications.map((application) => application.id).sort(),
  );
  for (const task of [first, second])
    for (const item of task!.result.items)
      expect(
        item.evidenceRefs.some((reference: string) =>
          reference.startsWith(`app:${item.targetId}:`),
        ),
      ).toBe(true);
  // Wait for the other kinds so page navigation is observed after initial work
  // has drained, rather than accidentally measuring an unfinished setup job.
  await expect
    .poll(
      async () =>
        service.db
          .collection("staffingAiTasks")
          .countDocuments({
            kind: "cv_summary",
            automatic: true,
            status: "completed",
            targetId: {
              $in: applications.map((application) => application.id),
            },
          }),
      { timeout: 60000 },
    )
    .toBe(12);
  await expect
    .poll(
      async () => !!(await service.completed("opportunity_draft", posting.id)),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () => !!(await service.completed("term_review", service.code)),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        service.db
          .collection("staffingAiAutomationJobs")
          .countDocuments({ status: { $nin: ["idle", "ended", "revoked"] } }),
      { timeout: 30000 },
    )
    .toBe(0);
  const before = await scopeVersions(service, posting.id);
  expect(before.map((job) => job.page)).toEqual([1, 2]);
  expect(candidateCalls(service, posting)).toHaveLength(2);
  const context = await browser.newContext({
    baseURL: service.origins[0],
    storageState: await service.faculty.api.storageState(),
  });
  const requests: Array<{ method: string; url: URL }> = [];
  try {
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/ai/tasks")
        requests.push({ method: request.method(), url });
    });
    expect((await page.goto(`/staffing/${posting.id}`))?.status()).toBe(200);
    const panel = page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", {
          name: "Candidate Review Assistance",
          exact: true,
        }),
      });
    await expect(panel.getByTestId("ai-result")).toBeVisible();
    await expect(panel.getByTestId("ai-coverage")).toContainText(
      "10 eligible candidates",
    );
    await expect(
      panel.getByTestId("ai-result").locator('a[href^="/applications/"]'),
    ).toHaveCount(10);
    await panel.getByTestId("ai-next-comparison").click();
    await expect(panel.getByTestId("ai-coverage")).toContainText("Page 2:");
    await expect(panel.getByTestId("ai-coverage")).toContainText(
      "2 eligible candidates",
    );
    const resultLinks = panel
      .getByTestId("ai-result")
      .locator('a[href^="/applications/"]');
    await expect(resultLinks).toHaveCount(2);
    expect(
      (
        await resultLinks.evaluateAll((links) =>
          links.map((link) => link.getAttribute("href")!.split("/").at(-1)!),
        )
      ).sort(),
    ).toEqual(second!.result.items.map((item: any) => item.targetId).sort());
    await expect(panel.getByTestId("ai-next-comparison")).toHaveCount(0);
    await panel.getByTestId("ai-previous-comparison").click();
    await expect(panel.getByTestId("ai-coverage")).toContainText("Page 1:");
    await expect(
      panel.getByTestId("ai-result").locator('a[href^="/applications/"]'),
    ).toHaveCount(10);
    await pause(1600);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.searchParams.get("kind") === "candidate_fit" &&
          request.url.searchParams.get("page") === "2",
      ),
    ).toBe(true);
    expect(candidateCalls(service, posting)).toHaveLength(2);
    expect(await scopeVersions(service, posting.id)).toEqual(before);
    const allowed = await json(
      service.faculty.api.get(
        `/api/staffing/applications/${applications[11].id}`,
      ),
    );
    expect(allowed.application.id).toBe(applications[11].id);
    expect(
      (
        await outsider.api.get("/api/ai/tasks", {
          params: { kind: "candidate_fit", targetId: posting.id, page: 2 },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await outsider.api.get(
          `/api/staffing/applications/${applications[11].id}`,
        )
      ).status(),
    ).toBe(403);
    expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
      0,
    );
  } finally {
    await context.close();
  }
});

test("persisted discovery resumes beyond twelve predecessor resources after restart without repeating completed scopes", async ({
  automation: service,
}) => {
  const tail = await service.opportunity();
  const application = await service.application(tail);
  const predecessors = Array.from({ length: 12 }, (_, index) => ({
    ...tail,
    id: `000-automatic-predecessor-${String(index).padStart(2, "0")}`,
    title: `Synthetic discovery predecessor ${index}`,
    description: `Synthetic preceding resource ${index}.`,
    appointmentStart: new Date(tail.appointmentStart),
    appointmentEnd: new Date(tail.appointmentEnd),
    applicationDeadline: new Date(tail.applicationDeadline),
    createdAt: new Date(tail.createdAt),
    updatedAt: new Date(tail.updatedAt),
  }));
  await service.db.collection("staffingOpportunities").insertMany(predecessors);
  // This isolated discovery experiment removes mutation hints, so discovering
  // the last resource must come from the durable baseline cursor itself.
  await service.db.collection("staffingEvents").deleteMany({});
  const environment = {
    AI_AUTO_DISCOVERY_BATCH_SIZE: "1",
    AI_AUTO_DISCOVERY_WORK_MS: "100",
    AI_AUTO_SCOPE_SCAN_INTERVAL_MS: "1000",
    AI_TERM_REVIEW_SCAN_INTERVAL_MS: "1000",
  };
  await service.startAutomatic(environment, 1);
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationControl")
            .findOne({ _id: "discovery" as any })
        )?.state?.cursors?.candidates || "",
      { timeout: 30000 },
    )
    .toMatch(/^000-automatic-predecessor-/);
  await expect
    .poll(
      async () =>
        (
          await service.db
            .collection("staffingAiAutomationJobs")
            .findOne({ kind: "candidate_fit", targetId: predecessors[0]!.id })
        )?.status,
      { timeout: 30000 },
    )
    .toBe("idle");
  const firstScope = await service.db
    .collection("staffingAiAutomationJobs")
    .findOne({ kind: "candidate_fit", targetId: predecessors[0]!.id });
  const completedId = firstScope!.lastTaskId;
  expect(
    (
      await service.db
        .collection("staffingAiTasks")
        .findOne({ id: completedId })
    )?.deterministic,
  ).toBe(true);
  expect(candidateCalls(service, tail)).toHaveLength(0);
  await service.stopApps();
  const stored = await service.db
    .collection("staffingAiAutomationControl")
    .findOne({ _id: "discovery" as any });
  expect(stored?.state?.cursors?.candidates).toMatch(
    /^000-automatic-predecessor-/,
  );
  // A stopped process may leave a crash lease. Expire only that lease; the
  // persisted discovery cursor and completed-task cache are kept untouched.
  await service.db
    .collection("staffingAiAutomationControl")
    .updateOne(
      { _id: "discovery" as any },
      {
        $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
        $unset: { leaseToken: "" },
      },
    );
  await service.db
    .collection("staffingAiAutomationJobs")
    .updateMany(
      { status: "running" },
      { $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } },
    );
  expect(
    (
      await service.db
        .collection("staffingAiAutomationControl")
        .findOne({ _id: "discovery" as any })
    )?.state,
  ).toEqual(stored!.state);
  await service.startAutomatic(environment, 2);
  const comparison = await completedPage(service, tail.id, 1);
  expect(comparison!.result.items.map((item: any) => item.targetId)).toEqual([
    application.id,
  ]);
  await expect
    .poll(
      async () => !!(await service.completed("opportunity_draft", tail.id)),
      { timeout: 90000 },
    )
    .toBe(true);
  const resumed = await service.db
    .collection("staffingAiAutomationJobs")
    .findOne({ kind: "candidate_fit", targetId: predecessors[0]!.id });
  expect(resumed).toMatchObject({
    generation: firstScope!.generation,
    lastTaskId: completedId,
    status: "idle",
  });
  expect(
    await service.db
      .collection("staffingAiTasks")
      .countDocuments({ automationScopeId: firstScope!._id }),
  ).toBe(1);
  expect(candidateCalls(service, tail)).toHaveLength(1);
  expect(await service.db.collection("staffingOffers").countDocuments()).toBe(
    0,
  );
});
