import { createError } from "h3";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CourseInsights,
  InsightsAccess,
  InsightsCourse,
  InsightsHelper,
  InsightsMetrics,
  InsightsSignal,
} from "../../shared/course-insights";
import type { SessionUser } from "./auth";
import { isGlobalAdmin } from "./auth";
import { withTransaction } from "./db";
import { getRecruitmentCycle } from "./staffing-cycle";
import { feedbackHelpers, ownsHelpRecord } from "./help-feedback";
import { getServerConfig } from "./config";

export const insightsTimezone = "America/New_York" as const;
const dayMs = 86400000;
const minimumWaitSamples = 5;
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: insightsTimezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: insightsTimezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: insightsTimezone,
  hour: "2-digit",
  hourCycle: "h23",
});
type Row = Record<string, any>;
type InsightsRange = CourseInsights["range"];
export type InsightsEvidence = {
  courses: Row[];
  enrollments: Row[];
  restrictions: Row[];
  users: Row[];
  globalDutyEmails?: string[];
  history: Row[];
  live: Row[];
  feedback: Row[];
  feedbackSessions?: Row[];
  workload: Row[];
  opportunities: Row[];
  appointments: Row[];
};

function fail(message: string, statusCode = 400): never {
  throw createError({ statusCode, statusMessage: message });
}
function instant(value: unknown): number | null {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  )
    return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}
function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
function nonnegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
function emailOf(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+$/.test(normalized) ? normalized : "";
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
function average(values: number[]): number | null {
  return values.length
    ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}
export function insightPercentile(
  values: number[],
  percentile = 0.9,
): number | null {
  const valid = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  return valid.length
    ? round(valid[Math.max(0, Math.ceil(valid.length * percentile) - 1)]!)
    : null;
}
export function easternDate(value: Date | number | string): string {
  const parts = Object.fromEntries(
    dateFormat
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    instant(`${value}T00:00:00Z`) !== null &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
function shiftDay(value: string, count: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + count * dayMs)
    .toISOString()
    .slice(0, 10);
}
export function easternMidnight(value: string): number {
  if (!validDay(value)) fail("Use valid YYYY-MM-DD reporting dates");
  const target = Date.parse(`${value}T00:00:00Z`);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(
      clockFormat
        .formatToParts(new Date(candidate))
        .map((part) => [part.type, part.value]),
    );
    const local = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const correction = target - local;
    if (!correction) return candidate;
    candidate += correction;
  }
  return fail("The reporting date could not be resolved in Eastern Time");
}
export function insightsRange(
  term: Row,
  query: Row = {},
  now = new Date(),
): InsightsRange {
  const start = instant(term.startDate),
    end = instant(term.endDate);
  if (start === null || end === null || start >= end)
    fail("The selected semester has invalid dates", 409);
  const today = easternDate(now);
  const first = easternDate(start),
    last = easternDate(end - 1);
  const defaultTo = first > today ? first : [today, last].sort()[0]!;
  const defaultFrom = [first, shiftDay(defaultTo, -27)].sort().at(-1)!;
  const from = query.from === undefined ? defaultFrom : query.from;
  const to = query.to === undefined ? defaultTo : query.to;
  if (!validDay(from) || !validDay(to) || from > to)
    fail("Choose increasing valid YYYY-MM-DD reporting dates");
  if (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs >
    365
  )
    fail("Choose a reporting window of at most 366 calendar days");
  const fromAt = Math.max(start, easternMidnight(from));
  const toAt = Math.max(
    fromAt,
    Math.min(end, now.getTime(), easternMidnight(shiftDay(to, 1))),
  );
  return {
    from,
    to,
    fromAt: new Date(fromAt).toISOString(),
    toAt: new Date(toAt).toISOString(),
  };
}
export function selectManagedCourses(
  courses: Row[],
  enrollments: Row[],
  email: string,
  global: boolean,
): Row[] {
  const managed = new Set(
    enrollments
      .filter(
        (row) =>
          emailOf(row.userEmail) === emailOf(email) &&
          ["instructor", "admin"].includes(row.role),
      )
      .map((row) => String(row.courseId).toLowerCase()),
  );
  return courses
    .filter(
      (course) =>
        global ||
        managed.has(String(course.id).toLowerCase()) ||
        managed.has(String(course.code).toLowerCase()),
    )
    .sort((a, b) =>
      String(a.code || a.id).localeCompare(String(b.code || b.id)),
    );
}
function aliasesFor(courses: Row[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const course of courses)
    for (const alias of [course.id, course.code])
      if (typeof alias === "string") {
        const key = alias.toLowerCase();
        if (map.has(key) && map.get(key) !== String(course.id))
          fail("Course identifiers are ambiguous", 409);
        map.set(key, String(course.id));
      }
  return map;
}

/** Mirrors queue-duty cleanup without granting department analytics access. */
export function eligibleGlobalDutyEmails(
  users: Row[],
  dutyEmails: string[],
  identities: Row[],
  sessions: Row[],
  configuration: { adminEmails: string[]; mockLoginEnabled: boolean },
  now = Date.now(),
): string[] {
  const declared = new Set(dutyEmails.map(emailOf));
  return users
    .filter((account) => {
      const email = emailOf(account.email);
      if (!email || !declared.has(email) || account.disabledAt) return false;
      if (configuration.adminEmails.includes(email)) return true;
      if (!configuration.mockLoginEnabled || account.identityKind === "gitlab")
        return false;
      if (
        identities.some(
          (identity) =>
            identity.userId === account.id || emailOf(identity.email) === email,
        )
      )
        return false;
      return sessions.some(
        (record) =>
          record.user?.id === account.id &&
          emailOf(record.user?.email) === email &&
          record.user?.provider === "mock" &&
          record.user?.primaryRole === "admin" &&
          record.revokedAt == null &&
          (instant(record.expiresAt) ?? 0) > now,
      );
    })
    .map((account) => emailOf(account.email));
}
function emptyMetrics(): InsightsMetrics {
  return {
    requestCount: 0,
    closedCount: 0,
    activeCount: 0,
    helpedCount: 0,
    completedCount: 0,
    unhelpedCount: 0,
    uniqueStudents: 0,
    helperCount: 0,
    helpMinutes: 0,
    avgWaitMinutes: null,
    p90WaitMinutes: null,
    waitSampleCount: 0,
    feedbackCount: 0,
    feedbackAverage: null,
    helperFeedbackCount: 0,
    reportedHours: 0,
    activeTAs: 0,
    openPositions: 0,
    pendingClearance: 0,
    pendingStart: 0,
  };
}
type Segment = {
  email: string;
  name: string;
  start: number | null;
  end: number | null;
  minutes: number;
};
type Helper = {
  dto: InsightsHelper;
  requests: Set<string>;
  students: Set<string>;
  days: Set<string>;
  courses: Set<string>;
  reviewers: Set<string>;
  feedbackDays: Set<string>;
  ratings: number[];
};

/** Pure calculations on complete, already authorized snapshot evidence. */
export function buildCourseInsights(
  evidence: InsightsEvidence,
  range: InsightsRange,
  term: Row,
  global: boolean,
  now = new Date(),
  selectedCourse = false,
): CourseInsights {
  const from = Date.parse(range.fromAt),
    until = Date.parse(range.toAt),
    observedThrough = now.getTime();
  const aliases = aliasesFor(evidence.courses);
  const keyOf = (row: Row) =>
    aliases.get(String(row.courseId || "").toLowerCase());
  const users = new Map(
    evidence.users.map((user) => [emailOf(user.email), user]),
  );
  const usersById = new Map(
    evidence.users.map((user) => [String(user.id), user]),
  );
  const globalDuty = new Set((evidence.globalDutyEmails || []).map(emailOf));
  const courseRows = new Map<string, InsightsCourse>();
  const waits = new Map<string, number[]>(),
    courseStudents = new Map<string, Set<string>>(),
    courseHelpers = new Map<string, Set<string>>(),
    courseDays = new Map<string, Set<string>>();
  const allStudents = new Set<string>(),
    allDays = new Set<string>(),
    allWaits: number[] = [],
    helpers = new Map<string, Helper>();
  const daily = new Map<
    string,
    { date: string; requests: number; helped: number; closed: number }
  >();
  for (let day = range.from; day <= range.to; day = shiftDay(day, 1))
    daily.set(day, { date: day, requests: 0, helped: 0, closed: 0 });
  const heatmap = Array.from({ length: 168 }, (_, index) => ({
    weekday: Math.floor(index / 24) + 1,
    hour: index % 24,
    requests: 0,
    observedDates: 0,
  }));
  const heatDates = heatmap.map(() => new Set<string>());
  const concurrency: Array<{ time: number; email: string; delta: number }> = [];
  let invalidSegments = 0,
    attributedRequests = 0,
    unattributedRequests = 0;
  const helper = (email: string, name = ""): Helper => {
    let record = helpers.get(email);
    if (!record) {
      record = {
        dto: {
          email,
          name: name || users.get(email)?.name || email,
          role: "historical",
          courseIds: [],
          requests: 0,
          students: 0,
          helpMinutes: 0,
          averageHelpMinutes: 0,
          activeDays: 0,
          handoffRequests: 0,
          completedRequests: 0,
          reportedHours: 0,
          feedbackCount: 0,
          feedbackReviewers: 0,
          feedbackDays: 0,
          feedbackAverage: null,
          feedbackDistribution: Array.from({ length: 5 }, (_, index) => ({
            rating: index + 1,
            count: 0,
          })),
        },
        requests: new Set(),
        students: new Set(),
        days: new Set(),
        courses: new Set(),
        reviewers: new Set(),
        feedbackDays: new Set(),
        ratings: [],
      };
      helpers.set(email, record);
    }
    return record;
  };
  for (const course of evidence.courses) {
    const id = String(course.id);
    courseRows.set(id, {
      ...emptyMetrics(),
      id,
      code: String(course.code || id),
      title: String(course.title || ""),
      state: String(course.state || "closed"),
      onDuty: 0,
      manualTAs: 0,
      manualCapacityUnknown: 0,
      approvedPositions: 0,
      committedPositions: 0,
      appointedWeeklyHours: 0,
      workloadReporters: 0,
      observedDays: 0,
      attention: [],
    });
    waits.set(id, []);
    courseStudents.set(id, new Set());
    courseHelpers.set(id, new Set());
    courseDays.set(id, new Set());
  }
  const requests = new Map<string, { row: Row; historical: boolean }>();
  // History wins in a supplied duplicate; the transactional reader normally sees only one copy.
  for (const [historical, records] of [
    [false, evidence.live],
    [true, evidence.history],
  ] as const) {
    for (const [index, row] of records.entries()) {
      const courseId = keyOf(row),
        joined = instant(historical ? row.joinedAt : row.createdAt);
      if (!courseId || joined === null || joined < from || joined >= until)
        continue;
      const id = String(
        row.entryId || row._id || `${historical ? "history" : "live"}-${index}`,
      );
      requests.set(`${courseId}:${id}`, { row, historical });
    }
  }
  for (const [requestId, { row, historical }] of requests) {
    const courseId = keyOf(row)!,
      course = courseRows.get(courseId)!;
    const joined = instant(historical ? row.joinedAt : row.createdAt)!;
    const day = easternDate(joined),
      learner = String(emailOf(row.studentEmail) || row.studentId || "");
    course.requestCount++;
    daily.get(day)!.requests++;
    allDays.add(day);
    courseDays.get(courseId)!.add(day);
    if (learner) {
      allStudents.add(learner);
      courseStudents.get(courseId)!.add(learner);
    }
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
    const hour = Number(hourFormat.format(new Date(joined)));
    const bucket = heatmap[(weekday - 1) * 24 + hour]!;
    bucket.requests++;
    heatDates[(weekday - 1) * 24 + hour]!.add(day);
    const closedAt =
      instant(row.leftQueueAt) ??
      instant(row.closedAt) ??
      instant(row.helpEndAt);
    const ended =
      historical && closedAt !== null && closedAt <= observedThrough;
    if (ended) {
      course.closedCount++;
      daily.get(day)!.closed++;
    } else course.activeCount++;
    const segments: Segment[] = [];
    const rawSegments = Array.isArray(row.helpSegments) ? row.helpSegments : [];
    for (const raw of rawSegments) {
      const email = emailOf(raw?.taEmail),
        start = instant(raw?.startAt),
        end = instant(raw?.endAt);
      if (
        !email ||
        start === null ||
        end === null ||
        start < joined ||
        end <= start ||
        !positive(raw?.durationMs)
      ) {
        invalidSegments++;
        continue;
      }
      const clippedStart = start,
        clippedEnd = Math.min(end, observedThrough);
      if (clippedEnd > clippedStart)
        segments.push({
          email,
          name: String(raw.taName || ""),
          start: clippedStart,
          end: clippedEnd,
          minutes: Math.min(raw.durationMs, clippedEnd - clippedStart) / 60000,
        });
    }
    if (!historical) {
      const email = emailOf(row.taEmail),
        start =
          instant(row.activeHelpStartAt) ??
          (email ? instant(row.helpStartAt) : null);
      if (email && start !== null && start >= joined && observedThrough > start)
        segments.push({
          email,
          name: String(row.ta || ""),
          start,
          end: observedThrough,
          minutes: (observedThrough - start) / 60000,
        });
    } else if (
      !rawSegments.length &&
      emailOf(row.taEmail) &&
      positive(row.helpMinutes) &&
      (instant(row.helpStartAt) ?? Infinity) < observedThrough
    ) {
      const start = instant(row.helpStartAt),
        end = instant(row.helpEndAt) ?? closedAt;
      segments.push({
        email: emailOf(row.taEmail),
        name: String(row.taName || ""),
        start,
        end,
        minutes:
          start !== null && end !== null && start >= joined
            ? Math.min(
                positive(row.helpMinutes),
                Math.max(0, Math.min(end, observedThrough) - start) / 60000,
              )
            : 0,
      });
    }
    const valid = segments.filter((segment) => segment.minutes > 0);
    const helped =
      valid.length > 0 ||
      (row.wasHelped === true &&
        positive(row.helpMinutes) > 0 &&
        (instant(row.helpStartAt) ?? Infinity) >= joined &&
        (instant(row.helpStartAt) ?? Infinity) < observedThrough);
    if (helped) {
      course.helpedCount++;
      daily.get(day)!.helped++;
    }
    if (ended && row.endReason === "completed" && helped)
      course.completedCount++;
    if (ended && !helped) course.unhelpedCount++;
    const firstHelp = instant(row.helpStartAt);
    if (
      firstHelp !== null &&
      firstHelp >= joined &&
      firstHelp < observedThrough &&
      typeof row.waitMinutes === "number" &&
      Number.isFinite(row.waitMinutes) &&
      row.waitMinutes >= 0
    ) {
      waits.get(courseId)!.push(row.waitMinutes);
      allWaits.push(row.waitMinutes);
    } else if (
      !historical &&
      firstHelp !== null &&
      firstHelp >= joined &&
      firstHelp < observedThrough &&
      Number.isFinite(row.pausedBeforeHelpMs)
    ) {
      const wait =
        Math.max(0, firstHelp - joined - nonnegative(row.pausedBeforeHelpMs)) /
        60000;
      waits.get(courseId)!.push(wait);
      allWaits.push(wait);
    }
    if (valid.length) attributedRequests++;
    else if (helped) unattributedRequests++;
    const distinct = new Set(valid.map((segment) => segment.email));
    for (const email of distinct) {
      const record = helper(
        email,
        valid.find((segment) => segment.email === email)?.name,
      );
      record.requests.add(requestId);
      record.courses.add(courseId);
      for (const segment of valid.filter((item) => item.email === email)) {
        const firstDay = easternDate(segment.start ?? joined),
          lastDay = easternDate(
            segment.end === null
              ? joined
              : Math.max(segment.start ?? joined, segment.end - 1),
          );
        for (
          let activeDay = firstDay;
          activeDay <= lastDay;
          activeDay = shiftDay(activeDay, 1)
        )
          record.days.add(activeDay);
      }
      if (learner) record.students.add(learner);
      if (ended && row.endReason === "completed")
        record.dto.completedRequests++;
      if (distinct.size > 1) record.dto.handoffRequests++;
      courseHelpers.get(courseId)!.add(email);
    }
    for (const segment of valid) {
      helper(segment.email, segment.name).dto.helpMinutes += segment.minutes;
      course.helpMinutes += segment.minutes;
      if (
        segment.start !== null &&
        segment.end !== null &&
        segment.end > segment.start
      ) {
        concurrency.push(
          { time: segment.start, email: segment.email, delta: 1 },
          { time: segment.end, email: segment.email, delta: -1 },
        );
      }
    }
  }
  const feedbackRatings = new Map<string, number[]>(),
    allRatings: number[] = [];
  const linkedHelp = new Map(
    [...evidence.history, ...(evidence.feedbackSessions || [])].map((row) => [
      String(row._id || row.entryId),
      row,
    ]),
  );
  const rated = new Set<string>();
  let excludedHelperFeedback = 0;
  for (const raw of evidence.feedback) {
    const id = keyOf(raw),
      timestamp = instant(raw.createdAt);
    if (
      !id ||
      timestamp === null ||
      timestamp < from ||
      timestamp >= until ||
      !Number.isInteger(raw.rating) ||
      raw.rating < 1 ||
      raw.rating > 5
    )
      continue;
    const course = courseRows.get(id)!;
    if (raw.ratingScope === "helper") {
      const email = emailOf(raw.taEmail),
        linked = linkedHelp.get(String(raw.helpSessionId || ""));
      const reviewer =
        emailOf(raw.studentEmail) ||
        (typeof raw.studentId === "string" ? raw.studentId.trim() : "");
      const participant =
        linked &&
        keyOf(linked) === id &&
        ownsHelpRecord(linked, {
          id: String(raw.studentId || ""),
          email: emailOf(raw.studentEmail),
        })
          ? feedbackHelpers(linked, timestamp).find(
              (item) => item.email === email,
            )
          : null;
      const ratingKey = `${id}:${raw.studentId || emailOf(raw.studentEmail)}:${raw.helpSessionId}:${email}`;
      if (
        raw.category !== "ta" ||
        !email ||
        !reviewer ||
        !participant ||
        email === emailOf(raw.studentEmail) ||
        rated.has(ratingKey)
      ) {
        excludedHelperFeedback++;
        continue;
      }
      rated.add(ratingKey);
      const record = helper(email, participant.name);
      record.courses.add(id);
      record.ratings.push(raw.rating);
      record.reviewers.add(reviewer);
      record.feedbackDays.add(easternDate(timestamp));
      course.helperFeedbackCount++;
    } else {
      const ratings = feedbackRatings.get(id) || [];
      ratings.push(raw.rating);
      feedbackRatings.set(id, ratings);
      allRatings.push(raw.rating);
      course.feedbackCount++;
    }
  }
  const restricted = new Set(
    evidence.restrictions
      .filter((row) => keyOf(row))
      .map((row) => `${keyOf(row)}:${emailOf(row.userEmail)}`),
  );
  const eligible = (id: string, email: string) =>
    !!email &&
    !!users.get(email) &&
    !users.get(email)!.disabledAt &&
    !restricted.has(`${id}:${email}`);
  const active = new Map<string, Set<string>>(),
    staff = new Map<string, Set<string>>(),
    manual = new Map<string, Set<string>>(),
    appointed = new Map<string, Set<string>>();
  for (const course of courseRows.values()) {
    active.set(course.id, new Set());
    staff.set(course.id, new Set());
    manual.set(course.id, new Set());
    appointed.set(course.id, new Set());
  }
  for (const enrollment of evidence.enrollments) {
    const id = keyOf(enrollment),
      email = emailOf(enrollment.userEmail);
    if (!id || !eligible(id, email)) continue;
    if (["instructor", "admin", "ta"].includes(enrollment.role))
      staff.get(id)!.add(email);
    if (enrollment.role === "ta") {
      courseRows.get(id)!.manualTAs++;
      active.get(id)!.add(email);
      manual.get(id)!.add(email);
      const record = helper(email);
      record.courses.add(id);
      record.dto.role = "ta";
    } else if (
      ["instructor", "admin"].includes(enrollment.role) &&
      helpers.has(email)
    )
      helpers.get(email)!.dto.role = "staff";
  }
  const appointmentById = new Map<string, Row>();
  for (const appointment of evidence.appointments) {
    const id = keyOf(appointment);
    if (!id || appointment.type !== "ta" || appointment.termId !== term.id)
      continue;
    appointmentById.set(String(appointment.id), appointment);
    const course = courseRows.get(id)!,
      email = emailOf(appointment.applicantEmail);
    const end = instant(appointment.endDate),
      start = instant(appointment.startDate);
    if (end === null || end <= now.getTime()) continue;
    if (appointment.status === "pending_clearance") course.pendingClearance++;
    if (
      appointment.status === "pending_start" &&
      start !== null &&
      start > now.getTime()
    )
      course.pendingStart++;
    if (
      ["active", "pending_start"].includes(appointment.status) &&
      appointment.clearance === "cleared" &&
      appointment.acceptedAt &&
      start !== null &&
      start <= now.getTime() &&
      eligible(id, email)
    ) {
      active.get(id)!.add(email);
      staff.get(id)!.add(email);
      appointed.get(id)!.add(email);
      course.appointedWeeklyHours += nonnegative(appointment.weeklyHours);
      const record = helper(email, String(appointment.applicantName || ""));
      record.courses.add(id);
      record.dto.role = "ta";
    }
  }
  const workloadByKind: Record<string, number> = {},
    reporters = new Set<string>(),
    courseReporters = new Map<string, Set<string>>();
  let workloadCount = 0,
    reportedHours = 0;
  for (const raw of evidence.workload) {
    const id = keyOf(raw),
      hours = positive(raw.hours);
    if (
      !id ||
      raw.termId !== term.id ||
      !validDay(raw.date) ||
      raw.date < range.from ||
      raw.date > range.to ||
      !hours
    )
      continue;
    const appointment = appointmentById.get(String(raw.appointmentId));
    // Legacy observations need a TA posting link; never mix RA hours into teaching evidence.
    const posting = evidence.opportunities.find(
      (item) =>
        item.id === raw.opportunityId &&
        item.type === "ta" &&
        keyOf(item) === id,
    );
    if (!posting) continue;
    const identity = String(raw.applicantId || appointment?.applicantId || "");
    const email = emailOf(
      appointment?.applicantEmail || usersById.get(identity)?.email,
    );
    if (email) {
      const record = helper(email);
      record.courses.add(id);
      record.dto.reportedHours += hours;
    }
    if (identity) {
      reporters.add(identity);
      const group = courseReporters.get(id) || new Set();
      group.add(identity);
      courseReporters.set(id, group);
    }
    const kind =
      typeof raw.kind === "string" &&
      [
        "attendance",
        "lab",
        "discussion",
        "grading",
        "office_hours",
        "preparation",
        "coordination",
      ].includes(raw.kind)
        ? raw.kind
        : "unclassified";
    workloadByKind[kind] = (workloadByKind[kind] || 0) + hours;
    reportedHours += hours;
    workloadCount++;
    courseRows.get(id)!.reportedHours += hours;
  }
  for (const opportunity of evidence.opportunities) {
    const id = keyOf(opportunity);
    if (!id || opportunity.type !== "ta" || opportunity.termId !== term.id)
      continue;
    const approved =
      opportunity.approved === true &&
      ["published", "applications_closed", "filled"].includes(
        opportunity.status,
      ) &&
      (instant(opportunity.appointmentEnd) ?? 0) > now.getTime();
    if (!approved) continue;
    const course = courseRows.get(id)!;
    course.approvedPositions += nonnegative(opportunity.positions);
    course.committedPositions += nonnegative(opportunity.committedPositions);
    course.openPositions += Math.max(
      0,
      nonnegative(opportunity.positions) -
        nonnegative(opportunity.committedPositions),
    );
  }
  const attention: InsightsSignal[] = [],
    allActive = new Set<string>();
  for (const course of courseRows.values()) {
    course.activeTAs = active.get(course.id)!.size;
    for (const email of active.get(course.id)!) allActive.add(email);
    course.manualCapacityUnknown = [...manual.get(course.id)!].filter(
      (email) => !appointed.get(course.id)!.has(email),
    ).length;
    const raw = evidence.courses.find((item) => String(item.id) === course.id)!;
    course.onDuty = new Set(
      (Array.isArray(raw.onDutyTAs) ? raw.onDutyTAs : [])
        .map((row: Row) => emailOf(row.email))
        .filter(
          (email: string) =>
            !!users.get(email) &&
            !users.get(email)!.disabledAt &&
            (globalDuty.has(email) ||
              (eligible(course.id, email) && staff.get(course.id)!.has(email))),
        ),
    ).size;
    course.uniqueStudents = courseStudents.get(course.id)!.size;
    course.helperCount = courseHelpers.get(course.id)!.size;
    course.observedDays = courseDays.get(course.id)!.size;
    course.workloadReporters = courseReporters.get(course.id)?.size || 0;
    const samples = waits.get(course.id)!;
    course.waitSampleCount = samples.length;
    course.avgWaitMinutes = average(samples);
    course.p90WaitMinutes = insightPercentile(samples);
    course.feedbackAverage = average(feedbackRatings.get(course.id) || []);
    course.helpMinutes = round(course.helpMinutes);
    course.reportedHours = round(course.reportedHours);
    const add = (
      code: string,
      title: string,
      detail: string,
      severity: InsightsSignal["severity"] = "info",
    ) =>
      course.attention.push({
        code,
        title,
        detail,
        severity,
        courseId: course.id,
      });
    if (course.pendingClearance)
      add(
        "pending-clearance",
        "Complete appointment clearance",
        `${course.pendingClearance} accepted appointment(s) await clearance.`,
        "attention",
      );
    if (course.unhelpedCount)
      add(
        "unhelped",
        "Review requests that ended without recorded help",
        `${course.unhelpedCount} of ${course.closedCount} ended requests have no positive recorded help. Inspect outcomes and queue hours.`,
        "attention",
      );
    if (course.waitSampleCount < minimumWaitSamples)
      add(
        "sparse-waits",
        "Limited waiting-time evidence",
        `${course.waitSampleCount} valid first-help wait observation(s); the reporting minimum is ${minimumWaitSamples}.`,
      );
    if (course.manualCapacityUnknown)
      add(
        "manual-capacity",
        "Confirm the complete teaching schedule",
        `${course.manualCapacityUnknown} manual TA assignment(s) have no current contractual hours in the appointment ledger.`,
      );
    if (course.helpedCount && !course.reportedHours)
      add(
        "missing-workload",
        "Collect teaching workload records",
        "Help activity exists, but no matching teaching workload was reported in this window.",
      );
    attention.push(...course.attention);
  }
  const summary = emptyMetrics();
  const additive: Array<keyof InsightsMetrics> = [
    "requestCount",
    "closedCount",
    "activeCount",
    "helpedCount",
    "completedCount",
    "unhelpedCount",
    "helpMinutes",
    "feedbackCount",
    "helperFeedbackCount",
    "openPositions",
    "pendingClearance",
    "pendingStart",
  ];
  for (const course of courseRows.values())
    for (const key of additive)
      (summary[key] as number) += course[key] as number;
  summary.uniqueStudents = allStudents.size;
  summary.helperCount = new Set(
    [...courseHelpers.values()].flatMap((group) => [...group]),
  ).size;
  summary.activeTAs = allActive.size;
  summary.reportedHours = round(reportedHours);
  summary.helpMinutes = round(summary.helpMinutes);
  summary.avgWaitMinutes = average(allWaits);
  summary.p90WaitMinutes = insightPercentile(allWaits);
  summary.waitSampleCount = allWaits.length;
  summary.feedbackAverage = average(allRatings);
  for (const record of helpers.values()) {
    record.dto.courseIds = [...record.courses].sort();
    record.dto.requests = record.requests.size;
    record.dto.students = record.students.size;
    record.dto.activeDays = record.days.size;
    record.dto.helpMinutes = round(record.dto.helpMinutes);
    record.dto.reportedHours = round(record.dto.reportedHours);
    record.dto.averageHelpMinutes = record.requests.size
      ? round(record.dto.helpMinutes / record.requests.size)
      : 0;
    record.dto.feedbackCount = record.ratings.length;
    record.dto.feedbackReviewers = record.reviewers.size;
    record.dto.feedbackDays = record.feedbackDays.size;
    record.dto.feedbackAverage = average(record.ratings);
    for (const rating of record.ratings)
      record.dto.feedbackDistribution[rating - 1]!.count++;
  }
  const activeHelpers = new Map<string, number>();
  let peakConcurrentHelpers = 0;
  concurrency.sort((a, b) => a.time - b.time || a.delta - b.delta);
  for (const event of concurrency) {
    const count = (activeHelpers.get(event.email) || 0) + event.delta;
    if (count > 0) activeHelpers.set(event.email, count);
    else activeHelpers.delete(event.email);
    peakConcurrentHelpers = Math.max(peakConcurrentHelpers, activeHelpers.size);
  }
  heatmap.forEach((bucket, index) => {
    bucket.observedDates = heatDates[index]!.size;
  });
  return {
    scope: selectedCourse ? "course" : global ? "department" : "courses",
    generatedAt: now.toISOString(),
    timezone: insightsTimezone,
    range,
    currentCycle: {
      termId: String(term.id),
      termName: String(term.name || ""),
    },
    summary,
    courses: [...courseRows.values()],
    helpers: [...helpers.values()]
      .map((row) => row.dto)
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
      ),
    daily: [...daily.values()],
    heatmap,
    workload: {
      totalHours: round(reportedHours),
      count: workloadCount,
      byKind: Object.fromEntries(
        Object.entries(workloadByKind)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, hours]) => [key, round(hours)]),
      ),
      reporters: reporters.size,
      source:
        "Self-reported UTC work dates; not payroll or complete observation evidence.",
    },
    attention,
    coverage: {
      source:
        "One authorized database snapshot. Request-start cohort: arrivals within the Eastern date range, with outcomes and full recorded help intervals observed through generatedAt. Feedback uses submission dates; workload uses UTC work dates. Staffing state is current for the selected semester.",
      completeObservationEstablished: false,
      feedbackAttribution:
        "Only explicit helper-scoped feedback linked to the student and an actual recorded helper contributes to an individual rating. Unattributed feedback remains course-level.",
      historicalDutyAvailable: false,
      attributedRequests,
      unattributedRequests,
      invalidSegments,
      excludedHelperFeedback,
      observedDays: allDays.size,
      waitSampleCount: allWaits.length,
      sparseSample: allWaits.length < minimumWaitSamples,
      minimumWaitSamples,
      peakConcurrentHelpers,
      limitations: [
        "No complete observation or historical duty coverage is established.",
        "Counts and duration describe recorded support, not a quality ranking.",
        "Course feedback is never assigned to an individual helper.",
        "Self-reported work and queue minutes overlap and must not be added together.",
        "Manual TA assignments without an effective appointment lack contractual weekly-hour evidence.",
        "Observed support does not establish required TA headcount.",
        "Eastern repeated DST hours are combined; zero records do not establish zero demand.",
      ],
    },
  };
}

async function authorizedCourses(
  db: Db,
  user: SessionUser,
  session: ClientSession,
) {
  const all = await db
    .collection("courses")
    .find(
      {},
      {
        session,
        projection: { id: 1, code: 1, title: 1, state: 1, onDutyTAs: 1 },
      },
    )
    .toArray();
  const memberships = await db
    .collection("enrollments")
    .find(
      { userEmail: user.email, role: { $in: ["instructor", "admin"] } },
      { session },
    )
    .toArray();
  return selectManagedCourses(
    all,
    memberships,
    user.email,
    isGlobalAdmin(user),
  );
}
export async function courseInsightsAccess(
  user: SessionUser,
): Promise<InsightsAccess> {
  return withTransaction(async (db, session) => {
    const courses = await authorizedCourses(db, user, session);
    return {
      allowed: isGlobalAdmin(user) || courses.length > 0,
      isGlobalAdmin: isGlobalAdmin(user),
      scope: isGlobalAdmin(user) ? "department" : "courses",
      courseCount: courses.length,
    };
  });
}
export async function readCourseInsights(
  user: SessionUser,
  query: Row = {},
): Promise<CourseInsights> {
  return withTransaction(async (db, session) => {
    let courses = await authorizedCourses(db, user, session);
    if (!isGlobalAdmin(user) && !courses.length)
      fail("Only course instructors and administrators can view insights", 403);
    const selected = query.courseId !== undefined;
    if (selected) {
      if (
        typeof query.courseId !== "string" ||
        !query.courseId.trim() ||
        query.courseId.length > 64
      )
        fail("Use a valid course identifier");
      const aliases = aliasesFor(courses),
        id = aliases.get(query.courseId.trim().toLowerCase());
      if (!id) fail("This course is outside your managed scope", 403);
      courses = courses.filter((course) => String(course.id) === id);
    }
    const cycle = await getRecruitmentCycle(db, session);
    if (!cycle.termId)
      fail(
        "An administrator must select the current recruitment semester",
        409,
      );
    if (query.expectedTermId !== undefined) {
      if (
        typeof query.expectedTermId !== "string" ||
        !query.expectedTermId ||
        query.expectedTermId.length > 64
      )
        fail("Use a valid expected semester identifier");
      if (query.expectedTermId !== cycle.termId)
        throw createError({
          statusCode: 409,
          statusMessage: "Current semester changed",
          data: { code: "INSIGHTS_TERM_CHANGED" },
        });
    }
    const term = await db
      .collection("staffingTerms")
      .findOne({ id: cycle.termId }, { session });
    if (!term) fail("The current recruitment semester is unavailable", 409);
    const now = new Date(),
      range = insightsRange(term, query, now);
    const aliases = [...aliasesFor(courses).keys()].map(
      (value) =>
        new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    );
    const byCourse = { courseId: { $in: aliases } },
      inWindow = { $gte: new Date(range.fromAt), $lt: new Date(range.toAt) };
    const history = await db
      .collection("helpSessions")
      .find(
        { ...byCourse, joinedAt: inWindow },
        { session, projection: { question: 0, location: 0, studentName: 0 } },
      )
      .toArray();
    const live = await db
      .collection("queueEntries")
      .find(
        { ...byCourse, createdAt: inWindow },
        { session, projection: { question: 0, location: 0, studentName: 0 } },
      )
      .toArray();
    const feedback = await db
      .collection("feedback")
      .find(
        { ...byCourse, createdAt: inWindow },
        {
          session,
          projection: {
            positive: 0,
            negative: 0,
            studentName: 0,
            allowContact: 0,
          },
        },
      )
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const feedbackIds = [
      ...new Set(
        feedback
          .filter(
            (row) =>
              row.ratingScope === "helper" &&
              /^[a-f0-9]{24}$/i.test(row.helpSessionId || ""),
          )
          .map((row) => String(row.helpSessionId)),
      ),
    ].map((id) => new ObjectId(id));
    const feedbackSessions = feedbackIds.length
      ? await db
          .collection("helpSessions")
          .find(
            { ...byCourse, _id: { $in: feedbackIds } },
            {
              session,
              projection: { question: 0, location: 0, studentName: 0 },
            },
          )
          .toArray()
      : [];
    const opportunities = await db
      .collection("staffingOpportunities")
      .find(
        { ...byCourse, termId: term.id, type: "ta" },
        {
          session,
          projection: {
            id: 1,
            courseId: 1,
            termId: 1,
            type: 1,
            approved: 1,
            status: 1,
            appointmentEnd: 1,
            positions: 1,
            committedPositions: 1,
          },
        },
      )
      .toArray();
    const appointments = await db
      .collection("staffingAppointments")
      .find(
        { ...byCourse, termId: term.id, type: "ta" },
        {
          session,
          projection: {
            id: 1,
            courseId: 1,
            termId: 1,
            type: 1,
            applicantId: 1,
            applicantEmail: 1,
            applicantName: 1,
            status: 1,
            clearance: 1,
            acceptedAt: 1,
            startDate: 1,
            endDate: 1,
            weeklyHours: 1,
          },
        },
      )
      .toArray();
    const workload = await db
      .collection("staffingWorkload")
      .find(
        {
          ...byCourse,
          termId: term.id,
          date: { $gte: range.from, $lte: range.to },
        },
        { session, projection: { notes: 0, authorEmail: 0 } },
      )
      .toArray();
    const enrollments = await db
      .collection("enrollments")
      .find(byCourse, { session })
      .toArray();
    const restrictions = await db
      .collection("courseRestrictions")
      .find(byCourse, { session })
      .toArray();
    const users = await db
      .collection("users")
      .find(
        {},
        {
          session,
          projection: {
            id: 1,
            email: 1,
            name: 1,
            disabledAt: 1,
            identityKind: 1,
          },
        },
      )
      .toArray();
    const configuration = getServerConfig();
    const dutyEmails = [
      ...new Set(
        courses
          .flatMap((course) =>
            (Array.isArray(course.onDutyTAs) ? course.onDutyTAs : []).map(
              (item: Row) => emailOf(item.email),
            ),
          )
          .filter(Boolean),
      ),
    ];
    const possibleMockAdmins = users.filter(
      (account) =>
        dutyEmails.includes(emailOf(account.email)) &&
        !account.disabledAt &&
        account.identityKind !== "gitlab" &&
        !configuration.adminEmails.includes(emailOf(account.email)),
    );
    const candidateIds = possibleMockAdmins.map((account) => account.id);
    const candidateEmails = possibleMockAdmins.map((account) =>
      emailOf(account.email),
    );
    // One read snapshot, sequentially queried; no session or provider details enter the DTO.
    const dutyIdentities =
      configuration.mockLoginEnabled && candidateIds.length
        ? await db
            .collection("providerIdentities")
            .find(
              {
                $or: [
                  { userId: { $in: candidateIds } },
                  { email: { $in: candidateEmails } },
                ],
              },
              { session, projection: { _id: 0, userId: 1, email: 1 } },
            )
            .toArray()
        : [];
    const dutyAdminSessions =
      configuration.mockLoginEnabled && candidateIds.length
        ? await db
            .collection("authSessions")
            .find(
              {
                "user.id": { $in: candidateIds },
                "user.email": { $in: candidateEmails },
                "user.provider": "mock",
                "user.primaryRole": "admin",
                expiresAt: { $gt: now },
                revokedAt: null,
              },
              {
                session,
                projection: {
                  _id: 0,
                  "user.id": 1,
                  "user.email": 1,
                  "user.provider": 1,
                  "user.primaryRole": 1,
                  expiresAt: 1,
                  revokedAt: 1,
                },
              },
            )
            .toArray()
        : [];
    const globalDutyEmails = eligibleGlobalDutyEmails(
      users,
      dutyEmails,
      dutyIdentities,
      dutyAdminSessions,
      configuration,
      now.getTime(),
    );
    return buildCourseInsights(
      {
        courses,
        history,
        live,
        feedback,
        feedbackSessions,
        opportunities,
        appointments,
        workload,
        enrollments,
        restrictions,
        users,
        globalDutyEmails,
      },
      range,
      term,
      isGlobalAdmin(user),
      now,
      selected,
    );
  });
}
