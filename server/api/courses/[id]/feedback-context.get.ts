import { defineEventHandler } from "h3";
import { assertEnrolled, withCourseTransaction } from "../../../utils/courses";
import type { CourseAccess } from "../../../utils/courses";
import type { ClientSession } from "mongodb";
import { feedbackHelpers, ownsHelpRecord } from "../../../utils/help-feedback";

export async function availableFeedbackSessions(
  access: CourseAccess,
  session: ClientSession,
) {
  assertEnrolled(access);
  const eligibleLimit = 20;
  const batchSize = 100;
  const history = access.db
    .collection("helpSessions")
    .find(
      {
        courseId: access.courseKey,
        wasHelped: true,
        $or: [
          { studentId: access.user.id },
          { studentId: { $in: [null, ""] }, studentEmail: access.user.email },
        ],
      },
      { session },
    )
    .sort({ joinedAt: -1, _id: -1 })
    .project({
      _id: 1,
      studentId: 1,
      studentEmail: 1,
      wasHelped: 1,
      joinedAt: 1,
      leftQueueAt: 1,
      closedAt: 1,
      helpEndAt: 1,
      helpSegments: 1,
    })
    .batchSize(batchSize);
  const sessions: Array<{
    id: string;
    at: string;
    helpers: Array<{ email: string; name: string }>;
  }> = [];
  let scannedRequests = 0;
  const appendBatch = async (rows: any[]) => {
    const ratings = await access.db
      .collection("feedback")
      .find(
        {
          courseId: access.courseKey,
          studentId: access.user.id,
          ratingScope: "helper",
          helpSessionId: { $in: rows.map((row) => String(row._id)) },
        },
        { session },
      )
      .project({ helpSessionId: 1, taEmail: 1 })
      .toArray();
    const rated = new Set(
      ratings.map(
        (row) =>
          `${row.helpSessionId}:${String(row.taEmail || "")
            .trim()
            .toLowerCase()}`,
      ),
    );
    for (const row of rows) {
      if (!ownsHelpRecord(row, access.user)) continue;
      const helpers = feedbackHelpers(row)
        .filter(
          (helper) =>
            helper.email !== access.user.email &&
            !rated.has(`${row._id}:${helper.email}`),
        )
        .map(({ email, name }) => ({ email, name }));
      if (helpers.length)
        sessions.push({
          id: String(row._id),
          at: new Date(
            row.leftQueueAt || row.closedAt || row.helpEndAt,
          ).toISOString(),
          helpers,
        });
      if (sessions.length === eligibleLimit) break;
    }
  };
  try {
    let batch: any[] = [];
    for await (const row of history) {
      scannedRequests++;
      batch.push(row);
      if (batch.length < batchSize) continue;
      await appendBatch(batch);
      batch = [];
      if (sessions.length === eligibleLimit) break;
    }
    if (batch.length && sessions.length < eligibleLimit)
      await appendBatch(batch);
  } finally {
    await history.close();
  }
  return {
    sessions,
    selection: {
      limit: eligibleLimit,
      order: "latest-unrated-eligible",
      reachedLimit: sessions.length === eligibleLimit,
      scannedRequests,
    },
  };
}

export default defineEventHandler((event) =>
  withCourseTransaction(event, availableFeedbackSessions),
);
