<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const busyActions = ref(false);

import {
  computed,
  ref,
  watch,
  reactive,
} from "vue";
import {
  useRoute,
  useRouter,
  useAsyncData,
  useRequestFetch,
  navigateTo,
} from "#app";

type AdminCourse = {
  id: string;
  code: string;
  title: string;
  state?: "open" | "paused" | "closed";
  activeEntries?: number;
};

type Enrollment = {
  courseId: string;
  userEmail: string;
  role: "student" | "ta" | "instructor" | "admin";
};

type HelpSession = {
  helpMinutes?: number;
  waitMinutes?: number;
  helpSegments?: Array<{
    taEmail: string;
    taName: string;
    startAt: string;
    endAt: string;
    durationMs: number;
  }>;
  courseId: string;
  studentEmail: string;
  studentName?: string;
  taEmail?: string;
  taName?: string;
  location?: string;
  question?: string;
  joinedAt?: string;
  helpStartAt?: string;
  helpEndAt?: string;
  closedAt?: string;
  leftQueueAt?: string;
  wasHelped?: boolean;
  endReason?: string;
};

type Feedback = {
  courseId: string;
  courseCode?: string;
  studentEmail?: string;
  studentName?: string;
  category: string;
  rating: number;
  positive: string;
  negative: string;
  allowContact: boolean;
  createdAt?: string;
};

type AdminApiResult = {
  pagination?: {
    offset: number;
    limit: number;
    snapshot: string;
    totals: { feedback: number; enrollments: number; helpSessions: number };
    hasMore: { feedback: boolean; enrollments: boolean; helpSessions: boolean };
  };
  course: AdminCourse;
  viewer: {
    email: string;
    name: string;
    role: Enrollment["role"] | null;
    isGlobalAdmin: boolean;
  };
  enrollments: Enrollment[];
  restrictions: Array<{ userEmail: string; restrictedAt?: string; restrictedBy?: string }>;
  queueEntries: any[];
  helpSessions: HelpSession[];
  feedback: Feedback[];
};

/**
 * Compute a "nice" upper bound for y-axis based on max value.
 * Adds padding and snaps to human-friendly steps.
 */
const makeYMax = (max: number) => {
  if (!max || max <= 0) return 1;

  const padded = max * 1.1;

  if (padded <= 1) {
    return Number((Math.ceil(padded / 0.2) * 0.2).toFixed(2));
  }

  if (padded <= 5) {
    return Math.ceil(padded);
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
  const scaled = padded / magnitude;
  let nice;
  if (scaled <= 1) nice = 1;
  else if (scaled <= 2) nice = 2;
  else if (scaled <= 5) nice = 5;
  else nice = 10;

  return nice * magnitude;
};

const route = useRoute();
const router = useRouter();
const courseId = route.params.id as string;
const requestFetch = useRequestFetch();
const refreshNotice = ref("");
let lastComplete: AdminApiResult | undefined;
const loadAdminData = async (_app: unknown, { signal }: { signal: AbortSignal }): Promise<AdminApiResult> => {
  for (let attempt = 0; ; attempt++) {
    let result: AdminApiResult | undefined;
    try {
      for (let page = 0; ; page++) {
        const current = await requestFetch<AdminApiResult>(
          `/api/courses/${courseId}/admin`,
          { signal, query: { offset: page * 500, limit: 500, snapshot: result?.pagination?.snapshot } },
        );
        if (!result) result = current;
        else {
          result.feedback.push(...current.feedback);
          result.enrollments.push(...current.enrollments);
          result.helpSessions.push(...current.helpSessions);
          result.pagination = current.pagination;
        }
        if (!Object.values(current.pagination?.hasMore || {}).some(Boolean)) break;
      }
      lastComplete = result!;
      refreshNotice.value = "";
      return result!;
    } catch (error: any) {
      const status = error?.statusCode || error?.response?.status;
      if (status === 409 && attempt < 2 && !signal.aborted) continue;
      if (lastComplete && ![401, 403, 404].includes(status) && !signal.aborted) {
        refreshNotice.value = "Refresh failed. Showing previous results.";
        return lastComplete;
      }
      throw error;
    }
  }
};

const { data, error, refresh } = await useAsyncData<AdminApiResult>(
  `course-admin-${courseId}`,
  loadAdminData,
  { dedupe: "defer" },
);
lastComplete = data.value || lastComplete;
watch(error, (value) => {
  const status = (value as any)?.statusCode;
  if (status === 401) {
    capturedUser.value = null;
    navigateWithContext("/login");
  } else if (status === 403 || status === 404) navigateWithContext("/courses");
});

if (error.value) {
  const status = (error.value as any).statusCode;
  if (status === 401) {
    capturedUser.value = null;
    await navigateWithContext("/login");
  } else if (status === 403 || status === 404) {
    await navigateWithContext("/courses");
  }
}

const viewer = computed(() => data.value?.viewer);

/** Only course admins and site admins may grant or change the admin role. */
const canManageAdmins = computed(
  () => !!viewer.value?.isGlobalAdmin || viewer.value?.role === "admin",
);

const feedback = computed<Feedback[]>(() => data.value?.feedback || []);

/**
 * Normalize feedback category across new and legacy values.
 */
const feedbackCategoryLabel = (c: string) => {
  const key = (c || "").toLowerCase();

  switch (key) {
    case "queue":
      return "Queue / UI";
    case "ta":
      return "TA / Staff";
    case "wait":
      return "Wait time";
    case "other":
      return "Other";

    case "queue-ui":
      return "Queue / UI (legacy)";
    case "ta-help":
      return "TA helpfulness (legacy)";
    case "wait-time":
      return "Wait time (legacy)";

    default:
      return c || "—";
  }
};

/**
 * Human-readable label for feedback rating.
 */
const feedbackRatingLabel = (r: number) => {
  switch (r) {
    case 5:
      return "Excellent";
    case 4:
      return "Good";
    case 3:
      return "OK";
    case 2:
      return "Fair";
    case 1:
      return "Poor";
    default:
      return "";
  }
};

/**
 * Course meta and queue state.
 */
const course = computed<AdminCourse>(() => {
  const c = data.value?.course;
  return (
    c || {
      id: courseId,
      code: courseId,
      title: "",
      state: "closed",
      activeEntries: 0,
    }
  );
});

const enrollments = computed<Enrollment[]>(() => data.value?.enrollments || []);

const rawHelpSessions = computed<HelpSession[]>(
  () => data.value?.helpSessions || [],
);

const queueState = computed<"open" | "paused" | "closed">(
  () => (course.value.state ?? "closed") as "open" | "paused" | "closed",
);

const activeEntries = computed(
  () => course.value.activeEntries ?? (data.value?.queueEntries || []).length,
);

const stateLabel = computed(() => {
  if (queueState.value === "open") return "Open";
  if (queueState.value === "paused") return "Paused";
  return "Closed";
});

const stateClass = computed(() => {
  if (queueState.value === "open") return "pill-open";
  if (queueState.value === "paused") return "pill-paused";
  return "pill-closed";
});

/**
 * Update queue state for this course.
 */
const setQueueState = async (state: "open" | "paused" | "closed") => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    const waiting = (data.value?.queueEntries || []).length;
    if (
      state === "closed" &&
      waiting &&
      !window.confirm(
        `Close the queue? The ${waiting} remaining entries will be ended and saved to history.`,
      )
    ) {
      return;
    }
    try {
      await $fetch(`/api/courses/${courseId}/state`, {
        method: "PATCH",
        body: { state },
      });
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to update queue state"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Date helpers and derived wait/help durations.
 */
const toDate = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getDurations = (s: HelpSession) => {
  const joined = toDate(s.joinedAt);
  const helpStart = toDate(s.helpStartAt);
  const helpEnd =
    toDate(s.helpEndAt) || toDate(s.closedAt) || toDate(s.leftQueueAt) || null;

  let wait = 0;
  let help = 0;

  if (joined && helpStart) {
    wait = Math.max(helpStart.getTime() - joined.getTime(), 0) / 60000;
  }
  if (helpStart && helpEnd) {
    help = Math.max(helpEnd.getTime() - helpStart.getTime(), 0) / 60000;
  }

  return {
    wait:
      typeof s.waitMinutes === "number" && Number.isFinite(s.waitMinutes)
        ? Math.max(s.waitMinutes, 0)
        : wait,
    help:
      typeof s.helpMinutes === "number" && Number.isFinite(s.helpMinutes)
        ? Math.max(s.helpMinutes, 0)
        : help,
  };
};

const sessions = computed(() =>
  rawHelpSessions.value.map((s) => {
    const { wait, help } = getDurations(s);
    const waitMinutes = wait;
    const helpMinutes = help;
    return { ...s, waitMinutes, helpMinutes };
  }),
);

/**
 * Default reporting window: last 30 days.
 */
const today = new Date();
const firstReportingDay = new Date(today);
firstReportingDay.setDate(firstReportingDay.getDate() - 29);
const formatDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const startDate = ref(formatDateInput(firstReportingDay));
const endDate = ref(formatDateInput(today));

const filteredSessions = computed(() => {
  const list = sessions.value;
  if (!startDate.value && !endDate.value) return list;

  const midnight = (value: string, nextDay = false) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year!, month! - 1, day! + (nextDay ? 1 : 0)).getTime();
  };
  const start = startDate.value
    ? midnight(startDate.value)
    : Number.MIN_SAFE_INTEGER;
  const end = endDate.value
    ? midnight(endDate.value, true)
    : Number.MAX_SAFE_INTEGER;

  return list.filter((s) => {
    const t = toDate(s.joinedAt)?.getTime();
    if (t === undefined) return false;
    return t >= start && t < end;
  });
});

/**
 * TA identification and filtering.
 */
const taLabelOf = (s: HelpSession) =>
  (s.taName || s.taEmail || "").toString().trim();

const isUnknownTA = (label: string) => !label || /^unknown/i.test(label);

/**
 * Only count sessions that are attributable and have positive help duration.
 */
const isValidHelpSession = (s: any) => {
  if (!s.studentEmail) return false;

  const ta = taLabelOf(s);
  if (
    isUnknownTA(ta) &&
    !s.helpSegments?.some(
      (segment: any) => segment.taEmail && segment.durationMs > 0,
    )
  )
    return false;

  const joined = toDate(s.joinedAt);
  if (!joined) return false;

  const hm = typeof s.helpMinutes === "number" ? s.helpMinutes : 0;
  if (hm <= 0) return false;

  return true;
};

const validSessions = computed(() =>
  filteredSessions.value.filter(isValidHelpSession),
);

/** One contribution per actual helper and request, summed across help intervals. */
const helperContributions = computed(() => {
  const rows: Array<
    HelpSession & {
      helperKey: string;
      helperLabel: string;
      helpMinutes: number;
    }
  > = [];
  for (const session of validSessions.value) {
    const helpers = new Map<
      string,
      { email: string; name: string; minutes: number }
    >();
    if (session.helpSegments?.length) {
      for (const segment of session.helpSegments) {
        if (!Number.isFinite(segment.durationMs) || segment.durationMs <= 0)
          continue;
        const key = segment.taEmail || segment.taName;
        if (!key) continue;
        const item = helpers.get(key) || {
          email: segment.taEmail,
          name: segment.taName,
          minutes: 0,
        };
        item.minutes += segment.durationMs / 60000;
        helpers.set(key, item);
      }
    } else {
      const key = session.taEmail || session.taName || "";
      if (key)
        helpers.set(key, {
          email: session.taEmail || "",
          name: session.taName || "",
          minutes: session.helpMinutes || 0,
        });
    }
    for (const [key, helper] of helpers)
      rows.push({
        ...session,
        taEmail: helper.email,
        taName: helper.name,
        helperKey: key,
        helperLabel: helper.name || helper.email,
        helpMinutes: helper.minutes,
      });
  }
  const names = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!names.has(row.helperLabel)) names.set(row.helperLabel, new Set());
    names.get(row.helperLabel)!.add(row.helperKey);
  }
  return rows.map((row) => ({
    ...row,
    helperLabel:
      (names.get(row.helperLabel)?.size || 0) > 1
        ? `${row.helperLabel} (${row.helperKey})`
        : row.helperLabel,
  }));
});

/**
 * Summary metrics.
 */
const sessionsInRange = computed(() => validSessions.value.length);

const uniqueStudents = computed(() => {
  const st = new Set<string>();
  for (const s of validSessions.value) {
    st.add(s.studentEmail.toLowerCase());
  }
  return st.size;
});

const activeTAsSummary = computed(() => {
  const tas = new Set<string>();
  for (const s of helperContributions.value) {
    const key = s.helperKey;
    if (!isUnknownTA(key)) tas.add(key);
  }
  return tas.size;
});

const avgWait = computed(() => {
  const arr = validSessions.value.map((s) => s.waitMinutes || 0);
  if (!arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.round((sum / arr.length) * 10) / 10;
});

const avgHelp = computed(() => {
  const arr = validSessions.value.map((s) => s.helpMinutes || 0);
  if (!arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.round((sum / arr.length) * 10) / 10;
});

const p90Wait = computed(() => {
  const arr = validSessions.value
    .map((s) => s.waitMinutes || 0)
    .sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = Math.ceil(arr.length * 0.9) - 1;
  const v = arr[Math.max(idx, 0)] ?? 0;
  return Math.round(v * 10) / 10;
});

/**
 * TA color mapping for charts.
 */
const COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#0ea5e9",
  "#a855f7",
  "#64748b",
  "#eab308",
  "#84cc16",
  "#06b6d4",
  "#fb7185",
];
const colorMap = reactive(new Map<string, string>());

const colorOf = (ta: string) => {
  if (!colorMap.has(ta)) {
    const col = (COLORS[colorMap.size % COLORS.length] ?? COLORS[0]) as string;
    colorMap.set(ta, col);
  }
  return colorMap.get(ta)!;
};

/**
 * Lightweight tooltip state for custom charts.
 */
const tip = ref<{
  show: boolean;
  x: number;
  y: number;
  text: string;
}>({
  show: false,
  x: 0,
  y: 0,
  text: "",
});

const showTip = (e: MouseEvent, text: string) => {
  const host = (e.currentTarget as HTMLElement).closest(
    ".chart-body",
  ) as HTMLElement | null;
  const rect = host?.getBoundingClientRect();
  tip.value = {
    show: true,
    x: e.clientX - (rect?.left || 0) + 8,
    y: e.clientY - (rect?.top || 0) + 8,
    text,
  };
};

const moveTip = (e: MouseEvent) => {
  if (!tip.value.show) return;
  const host = (e.currentTarget as HTMLElement).closest(
    ".chart-body",
  ) as HTMLElement | null;
  const rect = host?.getBoundingClientRect();
  tip.value.x = e.clientX - (rect?.left || 0) + 8;
  tip.value.y = e.clientY - (rect?.top || 0) + 8;
};

const hideTip = () => {
  tip.value.show = false;
};

/**
 * Chart mode:
 * - perDay: stacked bars by TA per day
 * - share: TA share donut
 * - avgHelp: avg help time per TA
 */
const chartMode = ref<"perDay" | "share" | "avgHelp">("perDay");

/**
 * 1) Help requests assisted per day (stacked by TA).
 */
const perDayData = computed(() => {
  const byDay = new Map<string, Map<string, number>>();

  for (const s of helperContributions.value) {
    const ta = s.helperLabel;
    const d = toDate(s.joinedAt);
    if (!d) continue;

    const day =
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0");

    if (!byDay.has(day)) byDay.set(day, new Map());
    const m = byDay.get(day)!;
    m.set(ta, (m.get(ta) || 0) + 1);
  }

  const days = Array.from(byDay.keys()).sort();
  const taSet = new Set<string>();
  for (const day of days) {
    for (const ta of byDay.get(day)!.keys()) {
      taSet.add(ta);
    }
  }
  const tas = Array.from(taSet).sort();

  let maxTotal = 0;
  const rows = days.map((day) => {
    const m = byDay.get(day)!;
    let total = 0;
    const parts = tas.map((ta) => {
      const v = m.get(ta) || 0;
      total += v;
      return { ta, count: v };
    });
    if (total > maxTotal) maxTotal = total;
    return { day, parts, total };
  });

  const yMax = makeYMax(maxTotal);

  return { days, tas, rows, maxTotal, yMax };
});

const buildTicks = (max: number, steps: number, decimals: number) => {
  const ticks: number[] = [];
  const interval = max / steps;
  for (let i = 0; i <= steps; i++) {
    const raw = interval * i;
    const v = Number(raw.toFixed(decimals));
    ticks.push(v);
  }
  ticks[ticks.length - 1] = Number(max.toFixed(decimals));
  return ticks;
};

// Counts are integers: pick a step count that divides the axis evenly so
// rounding never produces duplicate tick labels (e.g. 0, 1, 2, 2, 3).
const perDayTicks = computed(() => {
  const yMax = perDayData.value.yMax || 1;
  const steps =
    yMax <= 5 ? yMax : ([5, 4, 3, 2].find((s) => yMax % s === 0) ?? 4);
  return buildTicks(yMax, steps, 0);
});

/**
 * 2) Assisted-request share by TA (donut).
 */
const shareData = computed(() => {
  const map = new Map<string, number>();
  for (const s of helperContributions.value) {
    const ta = s.helperLabel;
    map.set(ta, (map.get(ta) || 0) + 1);
  }
  const items = Array.from(map.entries())
    .map(([ta, count]) => ({ ta, count }))
    .sort((a, b) => b.count - a.count);
  const total = items.reduce((a, b) => a + b.count, 0);
  return { items, total };
});

const polar = (cx: number, cy: number, r: number, angle: number) => {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
) => {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  // SVG requires two arcs when the endpoints describe a complete circle.
  if (end - start >= 360 - 1e-6) {
    const midpoint = polar(cx, cy, r, start + 180);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 0 ${midpoint.x} ${midpoint.y} A ${r} ${r} 0 0 0 ${e.x} ${e.y}`;
  }
  const large = end - start <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
};

/**
 * 3) Average TA help time (vertical bars).
 */
const avgHelpData = computed(() => {
  const map: Record<string, { total: number; count: number }> =
    Object.create(null);

  for (const s of helperContributions.value) {
    const ta = s.helperLabel;
    if (!map[ta]) map[ta] = { total: 0, count: 0 };
    map[ta].total += s.helpMinutes || 0;
    map[ta].count += 1;
  }

  const rows = Object.entries(map).map(([ta, v]) => ({
    ta,
    avg: v.count ? Math.round((v.total / v.count) * 10) / 10 : 0,
  }));

  rows.sort((a, b) => b.avg - a.avg);

  const max = rows.length ? Math.max(...rows.map((r) => r.avg)) : 0;
  const nice = makeYMax(max);

  // Add slight headroom to avoid bars touching the top edge for small ranges.
  const axisMax = nice <= 1 ? nice + 0.1 : nice;

  return { rows, max, axisMax };
});

const avgHelpTicks = computed(() =>
  buildTicks(avgHelpData.value.axisMax || 1, 4, 1),
);

/**
 * How a queue entry ended (see server/utils/queue.ts).
 */
const outcomeLabel = (s: HelpSession) => {
  switch (s.endReason) {
    case "completed":
      return "Helped";
    case "removed":
      return "Removed by staff";
    case "left":
      return s.wasHelped ? "Helped, then left" : "Left queue";
    case "queue-closed":
      return s.wasHelped ? "Helped (queue closed)" : "Queue closed";
    case "kicked":
      return "Removed from course";
    default:
      return s.wasHelped === false ? "Not helped" : "Helped";
  }
};

/**
 * CSV export for filtered sessions.
 */
const formatDateTime = (v?: string) => {
  const d = toDate(v);
  if (!d) return "—";
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0") +
    " " +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
};

const exportCsv = () => {
  const rows = filteredSessions.value;
  if (!rows.length) {
    alert("No sessions in selected range.");
    return;
  }

  const header = [
    "courseId",
    "studentName",
    "studentEmail",
    "taName",
    "taEmail",
    "joinedAt",
    "helpStartAt",
    "helpEndAt",
    "leftQueueAt",
    "wasHelped",
    "endReason",
    "location",
    "question",
    "helpMinutes",
    "waitMinutes",
    "helpSegments",
  ];
  const lines = [header.join(",")];

  // Quote every cell and neutralize formula markers and leading control characters.
  const cell = (value: unknown) => {
    let text = value === undefined || value === null ? "" : String(value);
    if (/^[=+\-@\t\r\n????]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  for (const s of rows) {
    lines.push(
      [
        s.courseId || courseId,
        s.studentName,
        s.studentEmail,
        s.taName,
        s.taEmail,
        s.joinedAt,
        s.helpStartAt,
        s.helpEndAt || s.closedAt,
        s.leftQueueAt,
        s.wasHelped ? "yes" : "no",
        s.endReason,
        s.location,
        s.question,
        s.helpMinutes,
        s.waitMinutes,
        JSON.stringify(s.helpSegments || []),
      ]
        .map(cell)
        .join(","),
    );
  }

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${course.value.code || courseId}-sessions.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Enrollment and role management.
 */
const newTaEmail = ref("");
const roleNotice = ref("");

const updateRole = async (
  email: string,
  role: "student" | "ta" | "instructor" | "admin",
) => {
  if (busyActions.value) return;
  busyActions.value = true;
  roleNotice.value = "";
  try {
    try {
      const result = await $fetch(`/api/courses/${courseId}/enrollments/role`, {
        method: "PATCH",
        body: { email, role },
      });
      roleNotice.value =
        result.role !== result.manualRole
          ? `The manual role for ${email} is now ${result.manualRole}. Their TA appointment still grants access.`
          : `The manual role for ${email} is now ${result.manualRole}.`;
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to update role"));
      await refresh();
    }
  } finally {
    busyActions.value = false;
  }
};

const kickUser = async (email: string, role: Enrollment["role"]) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    const ok = window.confirm(role === "student" ? `Remove ${email} and restrict rejoining until restored?` : `Remove ${email} from this course and queue?`);
    if (!ok) return;
    try {
      await $fetch(`/api/courses/${courseId}/enrollments/kick`, {
        method: "POST",
        body: { email },
      });
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to remove user"));
    }
  } finally {
    busyActions.value = false;
  }
};

const restoreStudent = async (email: string) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    await $fetch(`/api/courses/${courseId}/enrollments/restore`, { method: "POST", body: { email } });
    await refresh();
  } catch (error: any) {
    alert(apiErrorMessage(error, "Failed to restore course access"));
  } finally {
    busyActions.value = false;
  }
};

const addOrUpdateTa = async () => {
  const email = newTaEmail.value.trim();
  if (!email) return;
  await updateRole(email, "ta");
  newTaEmail.value = "";
};

/**
 * Navigation & polling.
 */
const goBack = () => {
  router.push(viewer.value?.isGlobalAdmin ? "/admin/courses" : "/courses");
};

const goLiveQueue = () => {
  router.push(`/courses/${courseId}/ta`);
};

const logout = signOut;

const goHelp = () => {
  navigateWithContext("/help");
};

useIntervalRefresh((options) => busyActions.value ? Promise.resolve() : refresh(options), 10000);
</script>

<template>
  <div class="page-root">
    <header class="app-navbar">
      <button
        type="button"
        class="app-left"
        aria-label="Back to courses"
        @click="goBack"
      >
        <img
          src="/duke-cs-logo.png"
          alt="Duke Department of Computer Science"
          class="app-logo"
          width="381"
          height="70"
          decoding="async"
        />
      </button>
      <div class="app-center">
        <div class="brand-main">CampusWorks – Course Admin</div>
      </div>
      <div class="app-right">
        <button
          class="help-link"
          type="button"
          @click="goLiveQueue"
          data-testid="live-queue-link"
        >
          Live Queue
        </button>
        <button class="help-link" type="button" @click="goHelp">
          Help &amp; Info
        </button>
        <div class="user-pill">
          <span class="user-email" data-testid="current-user-email">
            {{ viewer?.email }}
          </span>
          <button
            class="logout-mini"
            @click.prevent="logout"
            data-testid="logout-btn"
          >
            Logout
          </button>
        </div>
      </div>
    </header>

    <main
      :aria-busy="busyActions"
      id="main-content"
      tabindex="-1"
      class="content"
    >
      <button class="back-btn" type="button" @click="goBack">
        ← Back to Courses
      </button>

      <section class="course-header">
        <div class="course-title-block">
          <h1 class="course-code" data-testid="course-code">
            {{ course.code }}
          </h1>
          <div class="course-subtitle">
            {{ course.title }}
          </div>
        </div>

        <div class="queue-header-block">
          <div class="queue-row">
            <div class="queue-controls-inline">
              <button
                :disabled="busyActions"
                class="qc-btn open"
                :class="{ active: queueState === 'open' }"
                @click="setQueueState('open')"
              >
                Open
              </button>
              <button
                :disabled="busyActions"
                class="qc-btn pause"
                :class="{ active: queueState === 'paused' }"
                @click="setQueueState('paused')"
              >
                Pause
              </button>
              <button
                :disabled="busyActions"
                class="qc-btn close"
                :class="{ active: queueState === 'closed' }"
                @click="setQueueState('closed')"
              >
                Close
              </button>
            </div>
            <div class="queue-status-row">
              <span>Queue:</span>
              <span
                :class="['state-pill', stateClass]"
                data-testid="queue-state"
              >
                {{ stateLabel }}
              </span>
              <span class="active-label">
                Active entries:
                <strong>{{ activeEntries }}</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      <p v-if="refreshNotice" class="pagination-note" role="status">{{ refreshNotice }}</p>

      <!-- Analytics -->
      <section class="panel">
        <div class="panel-header">TA Performance &amp; Queue Analytics</div>
        <div class="panel-body analytics-body">
          <div class="analytics-filters">
            <div class="field">
              <label for="report-start">Start Date</label>
              <input v-model="startDate" id="report-start" type="date" />
            </div>
            <div class="field">
              <label for="report-end">End Date</label>
              <input v-model="endDate" id="report-end" type="date" />
            </div>
            <div class="field">
              <label for="report-chart">Chart</label>
              <select
                v-model="chartMode"
                id="report-chart"
                class="metric-select"
              >
                <option value="perDay">Students helped per day</option>
                <option value="share">Portion by TA</option>
                <option value="avgHelp">Average TA help time</option>
              </select>
            </div>
          </div>

          <div class="analytics-layout">
            <!-- Left: CSV export and raw sessions table -->
            <div class="sessions-panel">
              <div class="sessions-header">
                <div>
                  Sessions in range:
                  <strong data-testid="sessions-in-range">{{
                    filteredSessions.length
                  }}</strong>
                </div>
                <button
                  class="btn-export"
                  :disabled="!data"
                  @click="exportCsv"
                  data-testid="export-csv-btn"
                >
                  Export CSV
                </button>
              </div>
              <div
                class="sessions-table-wrap"
                tabindex="0"
                role="region"
                aria-label="Session history table"
              >
                <table class="sessions-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Student Email</th>
                      <th>TA</th>
                      <th>TA Email</th>
                      <th>Joined</th>
                      <th>Help Start</th>
                      <th>Help End</th>
                      <th>Left Queue</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(s, i) in filteredSessions"
                      :key="`${i}-${s.studentEmail}-${s.joinedAt}-${s.leftQueueAt}`"
                      data-testid="session-row"
                    >
                      <td>{{ s.studentName || "—" }}</td>
                      <td>{{ s.studentEmail }}</td>
                      <td>{{ s.taName || "—" }}</td>
                      <td>{{ s.taEmail || "—" }}</td>
                      <td>{{ formatDateTime(s.joinedAt) }}</td>
                      <td>
                        {{
                          s.wasHelped === false
                            ? "—"
                            : formatDateTime(s.helpStartAt || s.joinedAt)
                        }}
                      </td>
                      <td>
                        {{
                          formatDateTime(
                            s.helpEndAt || s.closedAt || s.helpStartAt,
                          )
                        }}
                      </td>
                      <td>
                        {{
                          formatDateTime(
                            s.leftQueueAt || s.closedAt || s.helpEndAt,
                          )
                        }}
                      </td>
                      <td>{{ outcomeLabel(s) }}</td>
                    </tr>
                    <tr v-if="!filteredSessions.length">
                      <td colspan="9" class="empty-text">
                        No queue activity in the selected range yet.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Right: summary metrics + charts -->
            <div class="metrics-panel">
              <div class="summary-cards">
                <div class="summary-card">
                  <div class="summary-label">Sessions</div>
                  <div class="summary-value">
                    {{ sessionsInRange }}
                  </div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">Unique Students</div>
                  <div class="summary-value">
                    {{ uniqueStudents }}
                  </div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">Active TAs</div>
                  <div class="summary-value">
                    {{ activeTAsSummary }}
                  </div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">Avg Wait (min)</div>
                  <div class="summary-value">
                    {{ avgWait.toFixed(1) }}
                  </div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">Avg Help (min)</div>
                  <div class="summary-value">
                    {{ avgHelp.toFixed(1) }}
                  </div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">P90 Wait (min)</div>
                  <div class="summary-value">
                    {{ p90Wait.toFixed(1) }}
                  </div>
                </div>
              </div>

              <div class="chart-block">
                <!-- Per-day stacked bar chart -->
                <div v-if="chartMode === 'perDay'" class="chart-body">
                  <div v-if="perDayData.rows.length" class="stacked-chart">
                    <div class="y-axis">
                      <div
                        v-for="tick in perDayTicks"
                        :key="tick"
                        class="y-label"
                      >
                        {{ tick }}
                      </div>
                    </div>
                    <div class="stacked-cols">
                      <div
                        v-for="row in perDayData.rows"
                        :key="row.day"
                        class="stacked-col"
                      >
                        <div class="stack">
                          <div
                            v-for="seg in row.parts"
                            v-show="seg.count > 0"
                            :key="seg.ta"
                            class="seg"
                            :style="{
                              height: (seg.count / perDayData.yMax) * 100 + '%',
                              background: colorOf(seg.ta),
                            }"
                            @mouseenter="
                              (e) =>
                                showTip(
                                  e,
                                  `${row.day} · ${seg.ta}: ${seg.count}`,
                                )
                            "
                            @mousemove="moveTip"
                            @mouseleave="hideTip"
                          />
                        </div>
                        <div class="x-label">
                          {{ row.day.slice(5) }}
                        </div>
                        <div v-if="row.total" class="x-total">
                          {{ row.total }}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-text">
                    No TA activity in this range.
                  </div>

                  <div
                    v-if="tip.show"
                    class="tooltip"
                    :style="{
                      left: tip.x + 'px',
                      top: tip.y + 'px',
                    }"
                  >
                    {{ tip.text }}
                  </div>

                  <div v-if="perDayData.tas.length" class="legend">
                    <div
                      v-for="ta in perDayData.tas"
                      :key="ta"
                      class="legend-item"
                    >
                      <span
                        class="swatch"
                        :style="{
                          background: colorOf(ta),
                        }"
                      />
                      {{ ta }}
                    </div>
                  </div>
                </div>

                <!-- TA share donut chart -->
                <div v-else-if="chartMode === 'share'" class="chart-body">
                  <div v-if="shareData.total" class="pie-wrap">
                    <svg
                      viewBox="0 0 240 240"
                      class="pie"
                      role="img"
                      aria-label="Share of assisted requests by helper; exact observations are in the chart data table"
                    >
                      <g>
                        <template
                          v-for="(item, i) in shareData.items"
                          :key="item.ta"
                        >
                          <path
                            :d="
                              (() => {
                                const prev = shareData.items
                                  .slice(0, i)
                                  .reduce((a, b) => a + b.count, 0);
                                const curr = prev + item.count;
                                const start = (prev / shareData.total) * 360;
                                const end = (curr / shareData.total) * 360;
                                return arcPath(120, 120, 90, start, end);
                              })()
                            "
                            :stroke="colorOf(item.ta)"
                            stroke-width="32"
                            fill="none"
                            @mouseenter="
                              (e) =>
                                showTip(
                                  e,
                                  `${item.ta}: ${item.count} (${(
                                    (item.count / shareData.total) *
                                    100
                                  ).toFixed(1)}%)`,
                                )
                            "
                            @mousemove="moveTip"
                            @mouseleave="hideTip"
                          />
                        </template>
                      </g>
                      <circle cx="120" cy="120" r="56" fill="#fff" />
                    </svg>

                    <div
                      v-if="tip.show"
                      class="tooltip"
                      :style="{
                        left: tip.x + 'px',
                        top: tip.y + 'px',
                      }"
                    >
                      {{ tip.text }}
                    </div>

                    <div class="legend">
                      <div
                        v-for="item in shareData.items"
                        :key="item.ta"
                        class="legend-item"
                      >
                        <span
                          class="swatch"
                          :style="{
                            background: colorOf(item.ta),
                          }"
                        />
                        {{ item.ta }}
                        ({{
                          ((item.count / shareData.total) * 100).toFixed(1)
                        }}%)
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-text">
                    No TA activity in this range.
                  </div>
                </div>

                <!-- Avg help time per TA -->
                <div v-else class="chart-body">
                  <div v-if="avgHelpData.rows.length" class="vbar-chart">
                    <div class="y-axis vbar-axis">
                      <div
                        v-for="tick in avgHelpTicks"
                        :key="tick"
                        class="y-label"
                      >
                        {{ tick }}
                      </div>
                    </div>

                    <div class="vbar-wrap">
                      <div
                        v-for="r in avgHelpData.rows"
                        :key="r.ta"
                        class="vbar"
                      >
                        <div class="vbar-bar">
                          <div
                            class="vbar-fill"
                            :style="{
                              height:
                                Math.min(
                                  (r.avg / avgHelpData.axisMax) * 100,
                                  100,
                                ) + '%',
                              background: colorOf(r.ta),
                            }"
                            @mouseenter="
                              (e) =>
                                showTip(
                                  e,
                                  `${r.ta}: ${r.avg.toFixed(1)} min avg`,
                                )
                            "
                            @mousemove="moveTip"
                            @mouseleave="hideTip"
                          />
                        </div>
                        <div class="vbar-label">
                          {{ r.ta }}
                        </div>
                        <div class="vbar-value">
                          {{ r.avg.toFixed(1) }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-else class="empty-text">
                    No TA activity in this range.
                  </div>

                  <div
                    v-if="tip.show"
                    class="tooltip"
                    :style="{
                      left: tip.x + 'px',
                      top: tip.y + 'px',
                    }"
                  >
                    {{ tip.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" aria-label="Accessible chart observations">
        <div class="panel-header" role="heading" aria-level="2">
          Assistance Chart Data
        </div>
        <div class="panel-body">
          <details data-testid="chart-data-table">
            <summary>
              Read the exact assistance observations used by the charts
            </summary>
            <p>
              Each row credits one helper for one request. Minutes sum only that
              helper's recorded help intervals. Shared requests can appear under
              multiple helpers.
            </p>
            <div
              class="chart-data-scroll"
              tabindex="0"
              role="region"
              aria-label="Assistance observation table"
            >
              <table class="sessions-table">
                <caption class="sr-only">
                  Helper contributions in the selected local-date range
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Request date</th>
                    <th scope="col">Student</th>
                    <th scope="col">Helper</th>
                    <th scope="col">Recorded help (minutes)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, index) in helperContributions" :key="index">
                    <td>{{ formatDateTime(item.joinedAt) }}</td>
                    <td>{{ item.studentName || item.studentEmail }}</td>
                    <td>{{ item.helperLabel }}</td>
                    <td>{{ item.helpMinutes.toFixed(3) }}</td>
                  </tr>
                  <tr v-if="!helperContributions.length">
                    <td colspan="4">
                      No qualifying assistance observations in this range.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      <!-- Feedback -->
      <section class="panel">
        <div class="panel-header">Course Feedback</div>
        <div class="panel-body">
          <div v-if="feedback.length">
            <table
              class="feedback-table"
              tabindex="0"
              aria-label="Course feedback"
            >
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student</th>
                  <th>Topic</th>
                  <th>Rating</th>
                  <th>What worked well</th>
                  <th>What can be improved</th>
                  <th>Allow Contact</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(f, i) in feedback"
                  :key="i"
                  data-testid="feedback-row"
                >
                  <td>
                    {{
                      f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"
                    }}
                  </td>
                  <td>
                    {{ f.studentName || f.studentEmail || "—" }}
                  </td>
                  <td>
                    {{ feedbackCategoryLabel(f.category) }}
                  </td>
                  <td>
                    <span class="rating-label">
                      {{ f.rating }}
                      <span v-if="feedbackRatingLabel(f.rating)">
                        -
                        {{ feedbackRatingLabel(f.rating) }}
                      </span>
                    </span>
                  </td>
                  <td class="fb-text">
                    {{ f.positive }}
                  </td>
                  <td class="fb-text">
                    {{ f.negative }}
                  </td>
                  <td>
                    {{ f.allowContact ? "Yes" : "No" }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-text">
            No feedback submitted for this course yet.
          </div>
        </div>
      </section>

      <!-- Enrollments -->
      <section class="panel">
        <div class="panel-header">Enrollments &amp; Roles</div>
        <div class="panel-body">
          <p class="role-guidance">
            Appointment access is managed from
            <NuxtLink to="/courses">Home</NuxtLink> separately from manual
            roles.
          </p>
          <p v-if="roleNotice" class="role-guidance" role="status">
            {{ roleNotice }}
          </p>
          <div class="add-ta-row">
            <input
              v-model="newTaEmail"
              aria-label="New TA email"
              type="email"
              class="ta-input"
              placeholder="Add TA by email"
              data-testid="add-ta-email"
              @keyup.enter="addOrUpdateTa"
            />
            <button
              :disabled="busyActions"
              class="btn-add-ta"
              @click="addOrUpdateTa"
              data-testid="add-ta-btn"
            >
              Add / Update TA
            </button>
          </div>
          <table
            class="enroll-table"
            tabindex="0"
            aria-label="Course enrollments"
          >
            <thead>
              <tr>
                <th>Email</th>
                <th>Manual role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="enr in enrollments"
                :key="enr.userEmail"
                :data-testid="`enrollment-row-${enr.userEmail}`"
              >
                <td>
                  {{ enr.userEmail }}
                  <span v-if="enr.userEmail === viewer?.email" class="you-tag">
                    you
                  </span>
                </td>
                <td>
                  <select
                    v-model="enr.role"
                    :aria-label="`Course role for ${enr.userEmail}`"
                    :disabled="
                      busyActions ||
                      enr.userEmail === viewer?.email ||
                      (enr.role === 'admin' && !canManageAdmins)
                    "
                    @change="updateRole(enr.userEmail, enr.role)"
                  >
                    <option value="student">Student</option>
                    <option value="ta">TA</option>
                    <option value="instructor">Instructor</option>
                    <option value="admin" :disabled="!canManageAdmins">
                      Admin
                    </option>
                  </select>
                </td>
                <td class="actions">
                  <div class="enrollment-actions">
                  <template
                    v-if="
                      enr.userEmail !== viewer?.email &&
                      (enr.role !== 'admin' || canManageAdmins)
                    "
                  >
                    <button
                      :disabled="busyActions"
                      class="btn-outline"
                      @click="updateRole(enr.userEmail, 'ta')"
                    >
                      Set TA
                    </button>
                    <button
                      :disabled="busyActions"
                      class="btn-outline"
                      @click="updateRole(enr.userEmail, 'student')"
                    >
                      Set Student
                    </button>
                    <button
                      :disabled="busyActions"
                      class="btn-danger"
                      @click="kickUser(enr.userEmail, enr.role)"
                    >
                      Remove
                    </button>
                  </template>
                  <span v-else class="muted-text">—</span>
                  </div>
                </td>
              </tr>
              <tr v-if="!enrollments.length">
                <td colspan="3" class="empty-text">No enrollments yet.</td>
              </tr>
            </tbody>
          </table>
          <template v-if="data?.restrictions?.length">
            <h3>Restricted students</h3>
            <table class="enroll-table" aria-label="Restricted students">
              <thead><tr><th>Email</th><th>Action</th></tr></thead>
              <tbody>
                <tr v-for="restriction in data.restrictions" :key="restriction.userEmail" :data-testid="`restriction-row-${restriction.userEmail}`">
                  <td>{{ restriction.userEmail }}</td>
                  <td><button type="button" class="btn-outline" :disabled="busyActions" @click="restoreStudent(restriction.userEmail)">Restore access</button></td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.chart-data-scroll {
  overflow-x: auto;
  max-width: 100%;
}
details > summary {
  cursor: pointer;
  color: #012169;
  font-weight: 600;
}
.page-root {
  min-height: 100vh;
  background: #f3f5fa;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  color: #111827;
}

.you-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e5ecff;
  color: #0f4c81;
  font-size: 10px;
  font-weight: 600;
}

.muted-text {
  color: #596579;
  font-size: 12px;
}
.role-guidance {
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
}
.role-guidance a {
  color: #17408b;
}

.app-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 32px;
  background: #012169;
  color: #ffffff;
}

.app-left {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.app-logo {
  height: 40px;
}

.app-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.brand-main {
  font-size: 20px;
  font-weight: 600;
}

.app-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.help-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 10px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
}

.user-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.user-email {
  font-size: 11px;
}

.logout-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: transparent;
  color: #ffffff;
  font-size: 10px;
  line-height: 1.3;
  cursor: pointer;
}

.content {
  max-width: 1200px;
  margin: 24px auto 40px;
  padding: 0 16px 32px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 18px;
  border-radius: 999px;
  border: none;
  background: #e5ecff;
  color: #012169;
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
  margin-bottom: 18px;
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 18px;
}

.course-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.course-code {
  margin: 0;
  font-size: 40px;
  font-weight: 700;
  color: #012169;
}

.course-subtitle {
  font-size: 18px;
  color: #536174;
}

.queue-header-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.queue-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.queue-controls-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.qc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  min-width: 70px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
  font-weight: 500;
}

.qc-btn.open {
  background: #10b981;
  color: #022c16;
}

.qc-btn.pause {
  background: #fbbf24;
  color: #422006;
}

.qc-btn.close {
  background: #dc2626;
  color: #ffffff;
}

.qc-btn.active {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6) inset;
}

.queue-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4b5563;
}

.state-pill {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
}

.pill-open {
  background: #10b981;

  color: #022c16;
}

.pill-paused {
  background: #f59e0b;

  color: #422006;
}

.pill-closed {
  background: #dc2626;
}

.active-label {
  font-size: 13px;
}

.panel {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
  margin-bottom: 18px;
  overflow: hidden;
}

.panel-header {
  padding: 10px 18px;
  background: #17408b;
  color: #ffffff;
  font-weight: 600;
  font-size: 18px;
}

.panel-body {
  padding: 12px 18px 16px;
}

.analytics-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.analytics-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
  margin-bottom: 4px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #536174;
}

.field input,
.metric-select {
  box-sizing: border-box;
  min-height: 36px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 13px;
  line-height: 1.35;
}

.analytics-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(380px, 2.6fr);
  gap: 18px;
  align-items: stretch;
}

.sessions-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sessions-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}

.btn-export {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid #17408b;
  background: #ffffff;
  color: #17408b;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
}

.sessions-table-wrap {
  max-height: 330px;
  min-height: 220px;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.sessions-table th,
.sessions-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  white-space: nowrap;
}

.metrics-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  padding: 8px 10px;
  border-radius: 10px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-label {
  font-size: 10px;
  color: #536174;
}

.summary-value {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.chart-block {
  margin-top: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
}

.chart-body {
  position: relative;
  min-height: 220px;
  font-size: 10px;
}

.tooltip {
  position: absolute;
  pointer-events: none;
  transform: translate(-50%, -100%);
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.9);
  color: #ffffff;
  font-size: 11px;
  white-space: nowrap;
  z-index: 2;
}

.stacked-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: 180px;
  padding-bottom: 20px;
}

.y-axis {
  display: flex;
  flex-direction: column-reverse;
  justify-content: space-between;
  align-items: flex-end;
  height: 160px;
  margin-right: 4px;
  padding-right: 2px;
  border-right: 1px solid #e5e7eb;
}

.y-label {
  font-size: 9px;
  color: #536174;
}

.stacked-cols {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.stacked-col {
  position: relative;
  width: 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stack {
  position: relative;
  height: 160px;
  width: 100%;
  border-radius: 6px;
  background: transparent;
  overflow: hidden;
  display: flex;
  flex-direction: column-reverse;
}

.seg {
  width: 100%;
}

.x-label {
  position: absolute;
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: #536174;
  text-align: center;
}

.x-total {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: #536174;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #374151;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.pie-wrap {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 12px;
  align-items: center;
}

.pie {
  width: 240px;
  height: 240px;
}

.vbar-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: 180px;
  padding-bottom: 26px;
  position: relative;
}

.vbar-axis {
  height: 160px;
}

.vbar-wrap {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 160px;
}

.vbar {
  position: relative;
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.vbar-bar {
  width: 100%;
  height: 160px;
  display: flex;
  align-items: flex-end;
}

.vbar-fill {
  width: 100%;
  min-height: 2px;
  border-radius: 6px 6px 0 0;
}

.vbar-label {
  position: absolute;
  bottom: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: #536174;
  white-space: nowrap;
  max-width: 56px;
  text-overflow: ellipsis;
  overflow: hidden;
}

.vbar-value {
  position: absolute;
  bottom: -30px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: #111827;
}

.add-ta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ta-input {
  flex: 1 1 220px;
  min-width: 0;
  min-height: 40px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
}

.btn-add-ta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #17408b;
  color: #ffffff;
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
}

.enroll-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  /* Keep a minimum width so columns do not collapse; scroll horizontally on mobile */
  min-width: 520px;
}

.enroll-table th,
.enroll-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
}

.enroll-table select {
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 13px;
  line-height: 1.3;
}

.actions {
  vertical-align: middle;
}

.enrollment-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.btn-outline,
.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  flex: 0 0 auto;
  line-height: 1.3;
}

.btn-outline {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #17408b;
  color: #17408b;
  background: #ffffff;
  font-size: 12px;
  cursor: pointer;
}

.btn-danger {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #dc2626;
  color: #b91c1c;
  background: #ffffff;
  font-size: 12px;
  cursor: pointer;
}

.feedback-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
  /* Same minimum width; scroll horizontally on mobile to see everything */
  min-width: 600px;
}

.feedback-table th,
.feedback-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
}

.feedback-table th:nth-child(1),
.feedback-table th:nth-child(2),
.feedback-table th:nth-child(3),
.feedback-table th:nth-child(4) {
  width: 110px;
  white-space: nowrap;
}

.fb-text {
  white-space: normal;
  word-break: break-word;
}

.rating-label {
  white-space: nowrap;
  font-size: 12px;
  color: #111827;
}

.empty-text {
  padding: 6px 2px;
  font-size: 11px;
  color: #596579;
}

@media (max-width: 1100px) {
  /* minmax(0, 1fr) keeps wide tables from stretching the page past the viewport */
  .analytics-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .pie-wrap {
    grid-template-columns: 1fr;
    justify-items: center;
  }
}

@media (max-width: 900px) {
  .course-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .queue-header-block {
    align-items: flex-start;
  }

  .queue-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}

@media (max-width: 768px) {
  .app-navbar {
    flex-wrap: wrap;
    padding: 8px 12px;
    row-gap: 8px;
  }

  .app-left {
    order: 1;
  }

  .app-center {
    order: 2;
    width: 100%;
    justify-content: center;
    text-align: center;
    margin-top: 4px;
  }

  .app-right {
    order: 3;
    width: 100%;
    justify-content: flex-end;
  }

  .content {
    margin: 16px auto 24px;
    padding: 0 12px 24px;
  }

  .analytics-filters {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .summary-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sessions-table-wrap {
    max-height: 260px;
  }

  .sessions-table {
    font-size: 10px;
  }

  /* On small screens let the whole panel scroll horizontally instead of clipping */
  .panel-body {
    overflow-x: auto;
  }

  /* Feedback / Enrollments tables scroll horizontally on small screens */
  .feedback-table,
  .enroll-table {
    display: block;
    overflow-x: auto;
  }

  .btn-add-ta {
    margin-left: auto;
  }

  .feedback-table {
    font-size: 12px;
  }

  .enroll-table {
    font-size: 13px;
  }

  .pie {
    width: 200px;
    height: 200px;
  }
}

@media (max-width: 480px) {
  .brand-main {
    font-size: 16px;
  }

  .user-email {
    display: none;
  }

  .course-code {
    font-size: 28px;
  }

  .course-subtitle {
    font-size: 14px;
  }

  .summary-value {
    font-size: 14px;
  }

  .legend {
    max-height: 80px;
    overflow: auto;
  }
}
</style>
