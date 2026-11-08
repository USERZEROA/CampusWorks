import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createError } from "h3";

function functions(filename, names) {
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return source.statements
    .filter(
      (node) =>
        ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
    )
    .map((node) => node.getText(source).replace(/^export\s+/, ""))
    .join("\n");
}
const javascript = ts.transpileModule(
  [
    functions("server/utils/help-feedback.ts", [
      "ownsHelpRecord",
      "feedbackHelpers",
    ]),
    functions("server/api/courses/[id]/feedback-context.get.ts", [
      "availableFeedbackSessions",
    ]),
  ].join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const actual = new Function(
  "createError",
  "assertEnrolled",
  `${javascript}\nreturn availableFeedbackSessions;`,
)(createError, (access) => assert.equal(access.user.id, "learner-id"));

const user = { id: "learner-id", email: "learner@example.com" };
const start = Date.now() - 600000;
function history(index, overrides = {}) {
  return {
    _id: String(index),
    courseId: "course-a",
    studentId: user.id,
    studentEmail: user.email,
    wasHelped: true,
    joinedAt: new Date(start - index * 1000),
    leftQueueAt: new Date(start + 30000),
    helpSegments: [
      {
        taEmail: "helper@example.com",
        taName: "Actual Helper",
        startAt: new Date(start),
        endAt: new Date(start + 10000),
        durationMs: 10000,
      },
    ],
    ...overrides,
  };
}
function database(records, ratings = [], { failRatings = false } = {}) {
  const state = {
    closed: false,
    yielded: 0,
    batches: 0,
    batchSize: 0,
    historyFilter: null,
  };
  const cursor = {
    sort() {
      return this;
    },
    project() {
      return this;
    },
    batchSize(value) {
      state.batchSize = value;
      return this;
    },
    async close() {
      state.closed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const row of records) {
        state.yielded++;
        yield row;
      }
    },
  };
  const access = {
    courseKey: "course-a",
    user,
    db: {
      collection(name) {
        if (name === "helpSessions")
          return {
            find(filter) {
              state.historyFilter = filter;
              return cursor;
            },
          };
        assert.equal(name, "feedback");
        return {
          find(filter) {
            assert.equal(filter.courseId, "course-a");
            assert.equal(filter.studentId, user.id);
            assert.equal(filter.ratingScope, "helper");
            state.batches++;
            return {
              project() {
                return this;
              },
              async toArray() {
                if (failRatings)
                  throw new Error("Synthetic rating read failure");
                return ratings.filter((row) =>
                  filter.helpSessionId.$in.includes(row.helpSessionId),
                );
              },
            };
          },
        };
      },
    },
  };
  return { access, state };
}

test("twenty recent rated sessions do not hide the next eligible session", async () => {
  const records = Array.from({ length: 21 }, (_, index) => history(index));
  const rated = records
    .slice(0, 20)
    .map((row) => ({ helpSessionId: row._id, taEmail: "helper@example.com" }));
  const { access, state } = database(records, rated);
  const result = await actual(access, {});
  assert.deepEqual(
    result.sessions.map((row) => row.id),
    ["20"],
  );
  assert.equal(result.sessions[0].at, new Date(start + 30000).toISOString());
  assert.equal(state.historyFilter.wasHelped, true);
  assert.equal(state.batchSize, 100);
  assert.equal(state.closed, true);
});

test("short contacts and foreign stable identities are skipped before applying the eligible limit", async () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    history(index, { helpSegments: [] }),
  );
  records.push(history(20, { studentId: "different-id" }), history(21));
  const { access, state } = database(records);
  const result = await actual(access, {});
  assert.deepEqual(
    result.sessions.map((row) => row.id),
    ["21"],
  );
  assert.equal(state.closed, true);
});

test("batched discovery reaches older eligible sessions without fetching all later history", async () => {
  const records = Array.from({ length: 1000 }, (_, index) => history(index));
  const rated = records
    .slice(0, 150)
    .map((row) => ({ helpSessionId: row._id, taEmail: "helper@example.com" }));
  const { access, state } = database(records, rated);
  const result = await actual(access, {});
  assert.equal(result.sessions.length, 20);
  assert.equal(result.sessions[0].id, "150");
  assert.equal(result.sessions.at(-1).id, "169");
  assert.equal(result.selection.limit, 20);
  assert.equal(result.selection.reachedLimit, true);
  assert.equal(state.yielded, 200);
  assert.equal(state.batches, 2);
  assert.equal(state.closed, true);
});

test("rating one participant does not hide another returning helper in the same session", async () => {
  const row = history(1);
  row.helpSegments.push({
    taEmail: "other@example.com",
    taName: "Other Helper",
    startAt: new Date(start + 11000),
    endAt: new Date(start + 18000),
    durationMs: 7000,
  });
  const { access } = database(
    [row],
    [{ helpSessionId: row._id, taEmail: "helper@example.com" }],
  );
  const result = await actual(access, {});
  assert.deepEqual(result.sessions[0].helpers, [
    { email: "other@example.com", name: "Other Helper" },
  ]);
});

test("a batch read failure closes its cursor and never returns partial successful-looking options", async () => {
  const { access, state } = database([history(1)], [], { failRatings: true });
  await assert.rejects(actual(access, {}), /Synthetic rating read failure/);
  assert.equal(state.closed, true);
});

test("empty discovery closes the cursor without querying ratings", async () => {
  const { access, state } = database([]);
  const result = await actual(access, {});
  assert.deepEqual(result.sessions, []);
  assert.equal(state.batches, 0);
  assert.equal(state.closed, true);
});
