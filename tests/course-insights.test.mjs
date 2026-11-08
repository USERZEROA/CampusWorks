import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createError } from "h3";

function definitions(filename) {
  const parsed = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return parsed.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(parsed).replace(/^export\s+/, ""))
    .join("\n");
}
const javascript = ts.transpileModule(
  [
    definitions("shared/course-time.ts"),
    definitions("server/utils/help-feedback.ts"),
    definitions("server/utils/course-insights.ts"),
  ].join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const {
  buildCourseInsights,
  easternMidnight,
  easternDate,
  insightsRange,
  selectManagedCourses,
  insightPercentile,
  eligibleGlobalDutyEmails,
} = new Function(
  "createError",
  `${javascript}\nreturn { buildCourseInsights, easternMidnight, easternDate, insightsRange, selectManagedCourses, insightPercentile, eligibleGlobalDutyEmails };`,
)(createError);

const now = new Date("2026-11-07T23:00:00Z");
const term = {
  id: "fall",
  name: "Fall 2026",
  startDate: "2026-10-01T04:00:00Z",
  endDate: "2026-12-31T05:00:00Z",
};
const range = insightsRange(
  term,
  { from: "2026-11-01", to: "2026-11-07" },
  now,
);
const courseA = {
  id: "course-a",
  code: "CS201",
  title: "Structures",
  state: "open",
  onDutyTAs: [],
};
const courseB = {
  id: "course-b",
  code: "CS101",
  title: "Programming",
  state: "closed",
  onDutyTAs: [],
};
const at = (seconds) =>
  new Date(Date.parse("2026-11-03T15:00:00Z") + seconds * 1000);
const segment = (email, start, end, name = email) => ({
  taEmail: email,
  taName: name,
  startAt: at(start),
  endAt: at(end),
  durationMs: (end - start) * 1000,
});
function record(id = "000000000000000000000001", options = {}) {
  return {
    _id: id,
    entryId: id,
    courseId: "course-a",
    studentEmail: "learner@example.com",
    joinedAt: at(0),
    helpStartAt: at(60),
    leftQueueAt: at(420),
    closedAt: at(420),
    helpEndAt: at(420),
    helpMinutes: 6,
    waitMinutes: 1,
    wasHelped: true,
    endReason: "completed",
    helpSegments: [segment("a@example.com", 60, 420, "Alex")],
    ...options,
  };
}
function evidence(overrides = {}) {
  return {
    courses: [courseA],
    users: [],
    enrollments: [],
    restrictions: [],
    history: [],
    live: [],
    feedback: [],
    feedbackSessions: [],
    opportunities: [],
    appointments: [],
    workload: [],
    ...overrides,
  };
}
const report = (data) =>
  buildCourseInsights(evidence(data), range, term, true, now);

test("Eastern midnight follows both DST transitions rather than a fixed offset", () => {
  assert.equal(
    new Date(easternMidnight("2026-03-08")).toISOString(),
    "2026-03-08T05:00:00.000Z",
  );
  assert.equal(
    easternMidnight("2026-03-09") - easternMidnight("2026-03-08"),
    23 * 3600000,
  );
  assert.equal(
    easternMidnight("2026-11-02") - easternMidnight("2026-11-01"),
    25 * 3600000,
  );
  assert.equal(easternDate("2026-11-02T04:30:00Z"), "2026-11-01");
  assert.doesNotThrow(() => easternMidnight("2028-02-29"));
});

test("range defaults to 28 Eastern dates, clips to semester and now, and rejects malformed/oversized windows", () => {
  const result = insightsRange(term, {}, now);
  assert.deepEqual([result.from, result.to], ["2026-10-11", "2026-11-07"]);
  assert.equal(result.toAt, now.toISOString());
  const clipped = insightsRange(
    { ...term, startDate: "2026-11-05T18:00:00Z" },
    {},
    now,
  );
  assert.equal(clipped.fromAt, "2026-11-05T18:00:00.000Z");
  assert.throws(
    () => insightsRange(term, { from: "2026-02-31" }, now),
    /valid/,
  );
  assert.throws(
    () => insightsRange(term, { from: ["2026-11-01"] }, now),
    /valid/,
  );
  assert.throws(
    () => insightsRange(term, { from: "2024-01-01", to: "2026-01-01" }, now),
    /366/,
  );
  const future = insightsRange(
    {
      ...term,
      startDate: "2027-01-01T05:00:00Z",
      endDate: "2027-05-01T04:00:00Z",
    },
    {},
    now,
  );
  assert.equal(future.fromAt, future.toAt);
});

test("late-evening Eastern work is included in the default department window", () => {
  const late = new Date("2026-11-08T04:33:00Z");
  const selected = insightsRange(term, {}, late);
  assert.equal(selected.to, "2026-11-07");
  const result = buildCourseInsights(
    evidence({
      opportunities: [{ id: "posting", type: "ta", courseId: "course-a", termId: term.id }],
      appointments: [{ id: "appointment", type: "ta", courseId: "course-a", termId: term.id, applicantId: "worker", applicantEmail: "alex@example.com" }],
      workload: [{ appointmentId: "appointment", opportunityId: "posting", applicantId: "worker", courseId: "course-a", termId: term.id, date: easternDate(late), hours: 0.5, kind: "office_hours" }],
    }),
    selected,
    term,
    true,
    late,
  );
  assert.equal(result.workload.totalHours, 0.5);
  assert.equal(result.helpers.find((helper) => helper.email === "alex@example.com").reportedHours, 0.5);
});

test("scope comes from actual course manager memberships, not TA, student or RA ownership", () => {
  const courses = [courseA, courseB];
  const memberships = [
    {
      courseId: "course-a",
      userEmail: "faculty@example.com",
      role: "instructor",
    },
    { courseId: "course-b", userEmail: "faculty@example.com", role: "ta" },
  ];
  assert.deepEqual(
    selectManagedCourses(
      courses,
      memberships,
      "faculty@example.com",
      false,
    ).map((row) => row.id),
    ["course-a"],
  );
  assert.deepEqual(
    selectManagedCourses(courses, memberships, "ra-owner@example.com", false),
    [],
  );
  assert.deepEqual(
    selectManagedCourses(
      courses,
      [{ ...memberships[0], role: "student" }],
      "faculty@example.com",
      false,
    ),
    [],
  );
  assert.equal(
    selectManagedCourses(courses, [], "admin@example.com", true).length,
    2,
  );
});

test("A to B to A attributes one request to each helper and all actual intervals to their contributor", () => {
  const result = report({
    history: [
      record(undefined, {
        helpSegments: [
          segment("a@example.com", 60, 120, "Same Name"),
          segment("b@example.com", 120, 240, "Same Name"),
          segment("a@example.com", 240, 420, "Same Name"),
        ],
        taEmail: "a@example.com",
      }),
    ],
  });
  assert.equal(result.summary.requestCount, 1);
  assert.equal(result.summary.helpedCount, 1);
  assert.equal(result.summary.helpMinutes, 6);
  assert.equal(result.helpers.length, 2);
  const a = result.helpers.find((row) => row.email === "a@example.com"),
    b = result.helpers.find((row) => row.email === "b@example.com");
  assert.deepEqual(
    [a.requests, a.helpMinutes, a.handoffRequests, a.completedRequests],
    [1, 4, 1, 1],
  );
  assert.deepEqual([b.requests, b.helpMinutes, b.handoffRequests], [1, 2, 1]);
  assert.equal(result.summary.helperCount, 2);
});

test("all valid waits determine department P90 instead of averaging course percentiles", () => {
  const history = [
    record("high", { waitMinutes: 100 }),
    ...Array.from({ length: 9 }, (_, i) =>
      record(`low-${i}`, { courseId: "course-b", waitMinutes: i + 1 }),
    ),
  ];
  const result = report({ courses: [courseA, courseB], history });
  assert.equal(result.summary.waitSampleCount, 10);
  assert.equal(result.summary.p90WaitMinutes, 9);
  assert.equal(result.summary.avgWaitMinutes, 14.5);
  assert.equal(
    result.courses.find((row) => row.id === "course-a").p90WaitMinutes,
    100,
  );
  assert.equal(insightPercentile([NaN, -1, 3, 8]), 8);
});

test("a historical/current duplicate counts only once and uses the archived result", () => {
  const archived = record();
  const result = report({
    history: [archived],
    live: [
      {
        ...archived,
        createdAt: archived.joinedAt,
        activeHelpStartAt: at(60),
        taEmail: "b@example.com",
      },
    ],
  });
  assert.equal(result.summary.requestCount, 1);
  assert.equal(result.summary.closedCount, 1);
  assert.equal(result.summary.activeCount, 0);
  assert.equal(result.helpers[0].email, "a@example.com");
});

test("current requests stay unresolved, include clipped in-progress contact and net first-help wait", () => {
  const result = report({
    live: [
      {
        _id: "live",
        courseId: "course-a",
        studentEmail: "learner@example.com",
        createdAt: new Date(now.getTime() - 120000),
        helpStartAt: new Date(now.getTime() - 60000),
        activeHelpStartAt: new Date(now.getTime() - 60000),
        taEmail: "a@example.com",
        ta: "Alex",
        pausedBeforeHelpMs: 30000,
        helpSegments: [],
      },
    ],
  });
  assert.deepEqual(
    [
      result.summary.requestCount,
      result.summary.activeCount,
      result.summary.closedCount,
      result.summary.unhelpedCount,
    ],
    [1, 1, 0, 0],
  );
  assert.equal(result.summary.helpMinutes, 1);
  assert.equal(result.summary.avgWaitMinutes, 0.5);
});

test("unhelped endings and sparse samples are disclosed without a fabricated TA failure score", () => {
  const result = report({
    history: [
      record("left", {
        wasHelped: false,
        helpMinutes: 0,
        helpStartAt: null,
        waitMinutes: null,
        helpSegments: [],
        endReason: "left",
      }),
      record("close", {
        wasHelped: false,
        helpMinutes: 0,
        helpStartAt: null,
        waitMinutes: null,
        helpSegments: [],
        endReason: "queue-closed",
      }),
    ],
  });
  assert.equal(result.summary.unhelpedCount, 2);
  assert.equal(result.summary.p90WaitMinutes, null);
  assert.equal(result.coverage.sparseSample, true);
  assert.equal(result.helpers.length, 0);
  assert.ok(result.attention.some((row) => row.code === "unhelped"));
  assert.equal(result.coverage.completeObservationEstablished, false);
});

test("unknown helpers and malformed intervals do not get assigned to the last helper or a guessed name", () => {
  const result = report({
    history: [
      record("bad", {
        helpSegments: [segment("bad@example.com", 120, 60)],
        taEmail: "last@example.com",
        taName: "Last Helper",
      }),
      record("legacy", {
        helpSegments: [],
        taEmail: "",
        taName: "Unattributed Name",
      }),
    ],
  });
  assert.equal(result.helpers.length, 0);
  assert.equal(result.coverage.invalidSegments, 1);
  assert.equal(result.coverage.unattributedRequests, 2);
  assert.ok(!JSON.stringify(result).includes("Unattributed Name"));
});

test("Eastern heatmap combines the repeated fall hour and keeps the actual local day", () => {
  const early = record("early", {
    joinedAt: "2026-11-01T05:15:00Z",
    helpStartAt: null,
    leftQueueAt: "2026-11-01T05:16:00Z",
    helpSegments: [],
    wasHelped: false,
    helpMinutes: 0,
  });
  const late = {
    ...early,
    _id: "late",
    entryId: "late",
    joinedAt: "2026-11-01T06:15:00Z",
    leftQueueAt: "2026-11-01T06:16:00Z",
  };
  const result = report({ history: [early, late] });
  assert.deepEqual(
    result.heatmap.find((row) => row.weekday === 7 && row.hour === 1),
    { weekday: 7, hour: 1, requests: 2, observedDates: 1 },
  );
  assert.equal(
    result.daily.find((row) => row.date === "2026-11-01").requests,
    2,
  );
  assert.equal(result.heatmap.length, 168);
});

test("only explicit feedback linked to the same student, course and actual >=6s helper affects personal ratings", () => {
  const session = record();
  const base = {
    courseId: "course-a",
    category: "ta",
    createdAt: at(500),
    studentEmail: "learner@example.com",
    studentId: "learner-id",
    rating: 4,
  };
  const named = {
    ...base,
    ratingScope: "helper",
    helpSessionId: session._id,
    taEmail: "a@example.com",
    taName: "Forged Display Name",
    rating: 2,
  };
  const result = report({
    history: [session],
    feedback: [
      { ...base, category: "ta", rating: 5 },
      named,
      { ...named },
      { ...named, taEmail: "stranger@example.com" },
      { ...named, studentEmail: "another@example.com" },
    ],
  });
  assert.equal(result.summary.feedbackCount, 1);
  assert.equal(result.summary.feedbackAverage, 5);
  assert.equal(result.summary.helperFeedbackCount, 1);
  assert.equal(result.helpers[0].feedbackAverage, 2);
  assert.equal(result.helpers[0].name, "Alex");
  assert.equal(result.helpers[0].feedbackDistribution[1].count, 1);
  assert.equal(result.coverage.excludedHelperFeedback, 3);
});

test("valid feedback may concern an earlier joined session without adding that earlier request to current arrivals", () => {
  const old = record("000000000000000000000002", {
    joinedAt: "2026-10-31T12:00:00Z",
  });
  const result = report({
    feedbackSessions: [old],
    feedback: [
      {
        courseId: "course-a",
        category: "ta",
        createdAt: at(500),
        studentEmail: old.studentEmail,
        ratingScope: "helper",
        helpSessionId: old._id,
        taEmail: "a@example.com",
        rating: 3,
      },
    ],
  });
  assert.equal(result.summary.requestCount, 0);
  assert.equal(result.helpers[0].feedbackCount, 1);
});

test("department helpers and students deduplicate across courses while unauthorized evidence cannot enter totals", () => {
  const first = record("a");
  const second = record("b", {
    courseId: "CS101",
    studentId: "same-student-id",
  });
  const result = report({
    courses: [courseA, courseB],
    history: [first, second],
  });
  assert.equal(result.summary.uniqueStudents, 1);
  assert.equal(result.summary.helperCount, 1);
  assert.equal(result.helpers[0].requests, 2);
  assert.equal(result.coverage.peakConcurrentHelpers, 1);
  const scoped = report({ courses: [courseA], history: [first, second] });
  assert.equal(scoped.summary.requestCount, 1);
  assert.deepEqual(scoped.helpers[0].courseIds, ["course-a"]);
});

test("current staffing deduplicates manual/appointment grants and excludes disabled, restricted and expired capacity", () => {
  const users = ["a", "disabled", "restricted", "old"].map((name) => ({
    id: name,
    email: `${name}@example.com`,
    name,
    ...(name === "disabled" ? { disabledAt: now } : {}),
  }));
  const appointments = ["a", "old"].map((name) => ({
    id: name,
    courseId: "course-a",
    type: "ta",
    termId: "fall",
    applicantEmail: `${name}@example.com`,
    applicantId: name,
    weeklyHours: 10,
    startDate: term.startDate,
    endDate: name === "old" ? at(0) : term.endDate,
    status: "active",
    acceptedAt: term.startDate,
    clearance: "cleared",
  }));
  const result = report({
    users,
    appointments,
    enrollments: users
      .filter((user) => user.id !== "old")
      .map((user) => ({
        courseId: "course-a",
        userEmail: user.email,
        role: "ta",
      })),
    restrictions: [
      { courseId: "course-a", userEmail: "restricted@example.com" },
    ],
  });
  assert.equal(result.summary.activeTAs, 1);
  assert.equal(result.courses[0].appointedWeeklyHours, 10);
  assert.equal(result.courses[0].manualTAs, 1);
  assert.equal(result.courses[0].manualCapacityUnknown, 0);
});

test("reported teaching work is separate from recorded help and RA observations are excluded", () => {
  const posting = {
    id: "ta-position",
    courseId: "course-a",
    type: "ta",
    termId: "fall",
    status: "published",
    approved: true,
    positions: 2,
    committedPositions: 1,
    weeklyHours: 10,
    appointmentEnd: term.endDate,
  };
  const result = report({
    history: [record()],
    opportunities: [posting, { ...posting, id: "ra-position", type: "ra" }],
    workload: [
      {
        id: "work",
        courseId: "course-a",
        opportunityId: "ta-position",
        termId: "fall",
        date: "2026-11-03",
        kind: "office_hours",
        hours: 10,
      },
      {
        id: "research",
        courseId: "course-a",
        opportunityId: "ra-position",
        termId: "fall",
        date: "2026-11-03",
        kind: "research",
        hours: 9,
      },
    ],
  });
  assert.equal(result.summary.reportedHours, 10);
  assert.equal(result.summary.helpMinutes, 6);
  assert.equal(result.workload.count, 1);
  assert.equal(result.courses[0].approvedPositions, 2);
  assert.equal(result.courses[0].committedPositions, 1);
  assert.equal(result.summary.openPositions, 1);
});

test("staffing coverage counts only current approved teaching plans and clamps unfilled seats", () => {
  const posting = {
    id: "position",
    courseId: "course-a",
    type: "ta",
    termId: term.id,
    status: "published",
    approved: true,
    positions: 3,
    committedPositions: 1,
    appointmentEnd: term.endDate,
  };
  const result = report({
    opportunities: [
      posting,
      { ...posting, id: "closed", status: "applications_closed", positions: 2 },
      {
        ...posting,
        id: "filled",
        status: "filled",
        positions: 1,
        committedPositions: 2,
      },
      { ...posting, id: "ended", appointmentEnd: now.toISOString() },
      { ...posting, id: "unapproved", approved: false },
      { ...posting, id: "draft", status: "draft" },
      { ...posting, id: "archived", status: "archived" },
      { ...posting, id: "cancelled", status: "cancelled" },
      { ...posting, id: "research-assistant", type: "ra" },
      { ...posting, id: "old-semester", termId: "previous" },
      { ...posting, id: "other-course", courseId: "course-b" },
    ],
  });
  assert.equal(result.courses[0].approvedPositions, 6);
  assert.equal(result.courses[0].committedPositions, 4);
  assert.equal(result.summary.openPositions, 3);
});

test("adjacent help intervals do not create artificial simultaneous helpers and no student prose leaks", () => {
  const result = report({
    history: [
      record("one", {
        question: "PRIVATE QUESTION",
        studentName: "PRIVATE STUDENT",
        helpSegments: [segment("a@example.com", 60, 120)],
      }),
      record("two", { helpSegments: [segment("b@example.com", 120, 180)] }),
    ],
  });
  assert.equal(result.coverage.peakConcurrentHelpers, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("request-start cohorts preserve the full later help interval and exclude requests that started before the boundary", () => {
  const selected = insightsRange(
    term,
    { from: "2026-11-03", to: "2026-11-03" },
    now,
  );
  const crossing = record("crossing", {
    joinedAt: "2026-11-04T04:58:00Z",
    helpStartAt: "2026-11-04T04:59:00Z",
    leftQueueAt: "2026-11-04T05:04:00Z",
    closedAt: "2026-11-04T05:04:00Z",
    helpEndAt: "2026-11-04T05:04:00Z",
    helpMinutes: 5,
    helpSegments: [
      {
        taEmail: "a@example.com",
        taName: "Alex",
        startAt: "2026-11-04T04:59:00Z",
        endAt: "2026-11-04T05:04:00Z",
        durationMs: 300000,
      },
    ],
  });
  const earlier = record("earlier", { joinedAt: "2026-11-03T04:59:00Z" });
  const result = buildCourseInsights(
    evidence({ history: [crossing, earlier] }),
    selected,
    term,
    true,
    now,
  );
  assert.equal(result.summary.requestCount, 1);
  assert.equal(result.summary.helpMinutes, 5);
  assert.equal(result.summary.closedCount, 1);
  assert.equal(result.daily[0].date, "2026-11-03");
  assert.equal(result.daily[0].helped, 1);
  assert.equal(result.helpers[0].activeDays, 2);
  assert.match(result.coverage.source, /Request-start cohort/);
});

test("multiple valid ratings from one student retain rating count but disclose unique reviewers and dates", () => {
  const first = record("000000000000000000000001");
  const second = record("000000000000000000000002");
  const third = record("000000000000000000000003", {
    studentEmail: "other@example.com",
  });
  const feedback = [first, second, third].map((session, index) => ({
    courseId: "course-a",
    category: "ta",
    createdAt: index < 2 ? at(500) : new Date("2026-11-04T16:00:00Z"),
    studentEmail: session.studentEmail,
    ratingScope: "helper",
    helpSessionId: session._id,
    taEmail: "a@example.com",
    rating: index + 3,
  }));
  const result = report({ history: [first, second, third], feedback });
  assert.deepEqual(
    [
      result.helpers[0].feedbackCount,
      result.helpers[0].feedbackReviewers,
      result.helpers[0].feedbackDays,
    ],
    [3, 2, 2],
  );
  assert.equal(result.helpers[0].feedbackAverage, 4);
  assert.ok(!JSON.stringify(result).includes("other@example.com"));
});

test("forged cross-course, premature and short-contact helper feedback never enters a rating aggregate", () => {
  const session = record();
  const short = record("000000000000000000000002", {
    helpSegments: [segment("a@example.com", 60, 65)],
  });
  const base = {
    category: "ta",
    createdAt: at(500),
    studentEmail: session.studentEmail,
    ratingScope: "helper",
    helpSessionId: session._id,
    taEmail: "a@example.com",
    rating: 5,
  };
  const result = report({
    courses: [courseA, courseB],
    history: [session, short],
    feedback: [
      { ...base, courseId: "course-b" },
      { ...base, courseId: "course-a", createdAt: at(100) },
      { ...base, courseId: "course-a", helpSessionId: short._id },
    ],
  });
  assert.equal(result.summary.helperFeedbackCount, 0);
  assert.equal(result.coverage.excludedHelperFeedback, 3);
  assert.equal(result.helpers[0].feedbackAverage, null);
});

test("complete aggregates include records beyond the first 500 and preserve all valid percentile samples", () => {
  const history = Array.from({ length: 1001 }, (_, index) =>
    record(String(index), {
      waitMinutes: index,
      studentEmail: `learner-${index}@example.com`,
    }),
  );
  const result = report({ history });
  assert.equal(result.summary.requestCount, 1001);
  assert.equal(result.summary.waitSampleCount, 1001);
  assert.equal(result.summary.p90WaitMinutes, 900);
  assert.equal(result.helpers[0].requests, 1001);
  assert.equal(result.summary.uniqueStudents, 1001);
});

test("published duty includes eligible global administrators without inflating TA capacity or trusting ordinary mock sessions", () => {
  const names = [
    "configured",
    "mock-admin",
    "disabled",
    "bound",
    "institutional",
    "expired",
    "revoked",
    "student",
    "ta",
  ];
  const users = names.map((name) => ({
    id: name,
    email: `${name}@example.com`,
    name,
    identityKind: ["configured", "institutional"].includes(name)
      ? "gitlab"
      : "mock",
    ...(name === "disabled" ? { disabledAt: now } : {}),
  }));
  const sessions = names.map((name) => ({
    user: {
      id: name,
      email: `${name}@example.com`,
      provider: "mock",
      primaryRole:
        name === "student" ? "student" : name === "ta" ? "ta" : "admin",
    },
    expiresAt: name === "expired" ? at(0) : new Date(now.getTime() + 10000),
    revokedAt: name === "revoked" ? at(0) : null,
  }));
  const dutyEmails = users.map((user) => user.email);
  const globalDutyEmails = eligibleGlobalDutyEmails(
    users,
    dutyEmails,
    [{ userId: "bound", email: "bound@example.com" }],
    sessions,
    {
      adminEmails: ["configured@example.com", "disabled@example.com"],
      mockLoginEnabled: true,
    },
    now.getTime(),
  );
  assert.deepEqual(globalDutyEmails.sort(), [
    "configured@example.com",
    "mock-admin@example.com",
  ]);
  const result = report({
    users,
    globalDutyEmails,
    courses: [
      {
        ...courseA,
        onDutyTAs: users.map((user) => ({
          email: user.email,
          name: user.name,
        })),
      },
    ],
    enrollments: [
      { courseId: "course-a", userEmail: "ta@example.com", role: "ta" },
    ],
  });
  assert.equal(result.courses[0].onDuty, 3);
  assert.equal(result.summary.activeTAs, 1);
  assert.deepEqual(
    eligibleGlobalDutyEmails(
      users,
      dutyEmails,
      [],
      sessions,
      { adminEmails: ["configured@example.com"], mockLoginEnabled: false },
      now.getTime(),
    ),
    ["configured@example.com"],
  );
  assert.ok(!JSON.stringify(result).includes("mock-admin@example.com"));
});
