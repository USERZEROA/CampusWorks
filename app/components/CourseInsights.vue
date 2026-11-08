<script setup lang="ts">
import type {
  InsightsCourse,
  InsightsHelper,
} from "../../shared/course-insights";
import { useCourseInsights } from "../composables/useCourseInsights";

const props = defineProps<{
  courseId?: string;
  standalone?: boolean;
  from?: string;
  to?: string;
}>();
const emit = defineEmits<{
  "update:from": [value: string];
  "update:to": [value: string];
}>();
const {
  data,
  error,
  status,
  notice,
  denied,
  selection,
  from,
  to,
  courseOptions,
} = await useCourseInsights(() => props.courseId, {
  from: () => props.from,
  to: () => props.to,
});
watch(from, (value) => {
  if (value) emit("update:from", value);
});
watch(to, (value) => {
  if (value) emit("update:to", value);
});
const navigation = useNuxtApp();
const viewer = useAuthUser();
watch(
  denied,
  (value) => {
    if (value && props.standalone)
      void navigation.runWithContext(() =>
        navigateTo(viewer.value ? "/courses" : "/login", { replace: true }),
      );
  },
  { immediate: true },
);
const prefix = props.standalone ? "insights" : "report";
const chartId = `${useId()}-demand`;
const helperSearch = ref("");
const helperSort = ref("name");
const scenarioId = ref("");
const quantity = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const count = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
const decimal = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
const money = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
const dayLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
const updated = computed(() =>
  data.value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(data.value.generatedAt))
    : "",
);
const helperRatings = computed(() => {
  const records =
    data.value?.helpers.filter(
      (item) =>
        item.feedbackCount > 0 &&
        Number.isFinite(item.feedbackCount) &&
        item.feedbackAverage != null &&
        Number.isFinite(item.feedbackAverage),
    ) || [];
  const samples = records.reduce(
    (total, item) => total + item.feedbackCount,
    0,
  );
  return {
    samples,
    average: samples
      ? records.reduce(
          (total, item) => total + item.feedbackAverage! * item.feedbackCount,
          0,
        ) / samples
      : null,
  };
});
const feedbackRule =
  "At least 5 ratings from at least 3 distinct students: below 3.5/5 needs follow-up; 4.0/5 or above is positive; other averages are mixed. Smaller samples are limited.";
const feedbackBand = (helper: InsightsHelper) => {
  if (!helper.feedbackCount)
    return { key: "none", label: "No individual feedback" };
  if (
    helper.feedbackAverage == null ||
    !Number.isFinite(helper.feedbackAverage) ||
    helper.feedbackCount < 5 ||
    helper.feedbackReviewers < 3
  )
    return { key: "limited", label: "Limited feedback" };
  if (helper.feedbackAverage < 3.5)
    return { key: "follow-up", label: "Feedback follow-up" };
  if (helper.feedbackAverage >= 4)
    return { key: "positive", label: "Positive feedback" };
  return { key: "mixed", label: "Mixed feedback" };
};
const feedbackFollowups = computed(
  () =>
    (data.value?.helpers || []).filter(
      (helper) => feedbackBand(helper).key === "follow-up",
    ).length,
);
const helpers = computed(() => {
  const query = helperSearch.value.trim().toLowerCase();
  return [...(data.value?.helpers || [])]
    .filter(
      (item) =>
        !query || `${item.name} ${item.email}`.toLowerCase().includes(query),
    )
    .sort((left, right) => {
      if (["feedback-high", "feedback-low"].includes(helperSort.value)) {
        const leftRating = left.feedbackCount ? left.feedbackAverage : null;
        const rightRating = right.feedbackCount ? right.feedbackAverage : null;
        if (leftRating == null && rightRating != null) return 1;
        if (rightRating == null && leftRating != null) return -1;
        if (
          leftRating != null &&
          rightRating != null &&
          leftRating !== rightRating
        )
          return helperSort.value === "feedback-high"
            ? rightRating - leftRating
            : leftRating - rightRating;
      }
      const difference =
        helperSort.value === "requests"
          ? right.requests - left.requests
          : helperSort.value === "minutes"
            ? right.helpMinutes - left.helpMinutes
            : 0;
      return (
        difference ||
        (left.name || left.email).localeCompare(right.name || right.email)
      );
    });
});
const ratingLabel = (helper: InsightsHelper) =>
  helper.feedbackDistribution
    .map((item) => `${item.rating} stars: ${item.count}`)
    .join(", ");
const daily = computed(() => data.value?.daily || []);
const chartMax = computed(() =>
  Math.max(
    4,
    Math.ceil(
      Math.max(
        0,
        ...daily.value.flatMap((item) => [
          quantity(item.requests),
          quantity(item.helped),
        ]),
      ) / 4,
    ) * 4,
  ),
);
const ticks = computed(() =>
  Array.from({ length: 5 }, (_, index) => (chartMax.value * index) / 4),
);
const chartStep = computed(() => 810 / Math.max(daily.value.length, 1));
const chartX = (index: number) => 54 + index * chartStep.value;
const chartY = (value: number) =>
  230 - (quantity(value) / chartMax.value) * 190;
const visibleDate = (index: number) =>
  index === 0 ||
  index === daily.value.length - 1 ||
  index % Math.max(1, Math.ceil(daily.value.length / 6)) === 0;
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = Array.from({ length: 24 }, (_, index) => index);
const heatmap = computed(
  () =>
    new Map(
      (data.value?.heatmap || []).map((item) => [
        `${item.weekday}:${item.hour}`,
        item,
      ]),
    ),
);
const heatMax = computed(() =>
  Math.max(
    1,
    ...(data.value?.heatmap || []).map((item) => quantity(item.requests)),
  ),
);
const heatValue = (weekday: number, hour: number) =>
  quantity(heatmap.value.get(`${weekday}:${hour}`)?.requests);
const heatStyle = (value: number) => {
  const colors = [
    "#f1f5fb",
    "#dbe7fb",
    "#9bb6e3",
    "#416caf",
    "#17408b",
    "#012169",
  ];
  const level = value
    ? Math.min(5, Math.max(1, Math.ceil((quantity(value) / heatMax.value) * 5)))
    : 0;
  return {
    backgroundColor: colors[level],
    color: level >= 3 ? "#ffffff" : "#233e68",
  };
};
const workload = computed(() =>
  Object.entries(data.value?.workload.byKind || {})
    .filter(([, hours]) => Number.isFinite(hours) && hours >= 0)
    .sort((left, right) => right[1] - left[1])
    .map(([kind, hours]) => ({ kind, hours })),
);
const workloadMax = computed(() =>
  Math.max(1, ...workload.value.map((item) => item.hours)),
);
const workLabels: Record<string, string> = {
  office_hours: "Office hours",
  grading: "Grading",
  lab: "Lab",
  discussion: "Discussion",
  attendance: "Attendance",
  preparation: "Preparation",
  coordination: "Coordination",
};
const workLabel = (kind: string) =>
  workLabels[kind] || kind.replaceAll("_", " ");
const scenarioChoices = computed(() => [
  ...new Map(
    (data.value?.budget.scenarios || []).map((item) => [
      item.opportunityId,
      { id: item.opportunityId, title: item.title, courseId: item.courseId },
    ]),
  ).values(),
]);
const selectedScenario = computed({
  get: () =>
    scenarioChoices.value.some((item) => item.id === scenarioId.value)
      ? scenarioId.value
      : scenarioChoices.value[0]?.id || "",
  set: (value: string) => {
    scenarioId.value = value;
  },
});
const scenarios = computed(() =>
  (data.value?.budget.scenarios || [])
    .filter((item) => item.opportunityId === selectedScenario.value)
    .sort((left, right) => left.change - right.change),
);
const attentionGroups = computed(() => {
  const courses = data.value?.courses || [];
  const priorities = [
    "pending-clearance",
    "unsettled",
    "unhelped",
    "manual-capacity",
    "missing-workload",
    "sparse-waits",
  ];
  const codes = [
    ...new Set(
      courses.flatMap((course) =>
        course.attention.map((signal) => signal.code),
      ),
    ),
  ];
  const priority = (code: string) =>
    priorities.includes(code) ? priorities.indexOf(code) : priorities.length;
  return codes
    .sort(
      (left, right) =>
        priority(left) - priority(right) || left.localeCompare(right),
    )
    .map((code) => {
      const affected = courses.filter((course) =>
        course.attention.some((signal) => signal.code === code),
      );
      const sum = (read: (course: InsightsCourse) => number) =>
        affected.reduce((total, course) => total + quantity(read(course)), 0);
      const units = (
        value: number,
        singular: string,
        plural = singular + "s",
      ) => `${count(value)} ${value === 1 ? singular : plural}`;
      let title =
        affected[0]?.attention.find((signal) => signal.code === code)?.title ||
        "Course follow-up";
      let detail = units(affected.length, "course");
      if (code === "pending-clearance") {
        title = "Appointment clearance";
        detail = units(
          sum((course) => course.pendingClearance),
          "appointment",
        );
      } else if (code === "unsettled") {
        title = "Cost settlement";
        detail = units(
          sum((course) => course.unsettled),
          "appointment",
        );
      } else if (code === "unhelped") {
        title = "Requests without recorded help";
        detail = units(
          sum((course) => course.unhelpedCount),
          "ended request",
        );
      } else if (code === "manual-capacity") {
        title = "Teaching schedules";
        detail = units(
          sum((course) => course.manualCapacityUnknown),
          "manual assignment",
        );
      } else if (code === "missing-workload") {
        title = "Missing workload records";
        detail = units(
          sum((course) => course.helpedCount),
          "helped request",
        );
      } else if (code === "sparse-waits") {
        title = "Wait-time samples";
        detail = `<${data.value?.coverage.minimumWaitSamples || 0} samples per course`;
      }
      if (props.standalone && priorities.includes(code))
        detail += ` · ${units(affected.length, "course")}`;
      return { code, title, detail };
    });
});
const courseName = (id: string) =>
  data.value?.courses.find((item) => item.id === id)?.code.toUpperCase() ||
  id.toUpperCase();
</script>

<template>
  <section
    v-if="!denied"
    class="course-insights"
    aria-label="Course support insights"
    :data-testid="standalone ? 'insights-root' : 'course-insights-root'"
  >
    <div class="insight-topline">
      <div>
        <p class="insight-eyebrow">
          {{ data?.currentCycle.termName || "Course support" }}
        </p>
        <h2>
          {{
            standalone
              ? data?.scope === "department"
                ? "Department overview"
                : data?.scope === "course"
                  ? "Course overview"
                  : "My course overview"
              : "Demand, staffing & support"
          }}
        </h2>
      </div>
      <p v-if="data" class="insight-updated">
        <span aria-hidden="true"></span> Updated automatically ·
        {{ updated }} ET
      </p>
    </div>
    <div class="insight-filters">
      <label v-if="standalone"
        >Course
        <select v-model="selection" data-testid="insights-course">
          <option value="">
            {{
              viewer?.isGlobalAdmin
                ? "All department courses"
                : "All my courses"
            }}
          </option>
          <option
            v-for="course in courseOptions"
            :key="course.id"
            :value="course.id"
          >
            {{ course.code.toUpperCase() }} · {{ course.title }}
          </option>
        </select>
      </label>
      <label :for="`${prefix}-start`"
        >From<input
          :id="`${prefix}-start`"
          v-model="from"
          type="date"
          data-testid="insights-from"
      /></label>
      <label :for="`${prefix}-end`"
        >Through<input
          :id="`${prefix}-end`"
          v-model="to"
          type="date"
          data-testid="insights-to"
      /></label>
      <p class="insight-filter-note">
        Request-arrival dates in Eastern Time · Staffing as of now.
      </p>
    </div>
    <p v-if="notice || error" class="insight-notice" role="status">
      {{
        notice ||
        apiErrorMessage(error, "Insights are temporarily unavailable.")
      }}
    </p>
    <p v-if="!data && status === 'pending'" class="insight-empty" role="status">
      Loading course insights…
    </p>
    <template v-if="data">
      <div class="insight-kpis" aria-label="Support overview">
        <article class="insight-kpi">
          <span>Recorded requests</span
          ><strong data-testid="insights-requests">{{
            count(data.summary.requestCount)
          }}</strong
          ><small
            >{{ count(data.summary.helpedCount) }} helped ·
            {{ count(data.summary.activeCount) }} active</small
          >
        </article>
        <article class="insight-kpi">
          <span>P90 wait</span
          ><strong data-testid="insights-p90"
            >{{ decimal(data.summary.p90WaitMinutes)
            }}<em v-if="data.summary.p90WaitMinutes != null">min</em></strong
          ><small
            >{{ count(data.summary.waitSampleCount) }} wait samples{{
              data.coverage.sparseSample && data.summary.waitSampleCount
                ? " · Small sample"
                : ""
            }}</small
          >
        </article>
        <article class="insight-kpi">
          <span>Active TAs</span
          ><strong data-testid="insights-active-tas">{{
            count(data.summary.activeTAs)
          }}</strong
          ><small
            >{{ count(data.summary.openPositions) }} unfilled seats ·
            {{ count(data.summary.pendingClearance) }} pending clearance</small
          >
        </article>
        <article class="insight-kpi">
          <span>Help-session feedback</span
          ><strong data-testid="insights-helper-rating"
            >{{ decimal(helperRatings.average)
            }}<em v-if="helperRatings.average != null">/ 5</em></strong
          ><small>{{ count(helperRatings.samples) }} attributed ratings</small>
        </article>
      </div>
      <p class="insight-range">
        {{ dayLabel(data.range.from) }} – {{ dayLabel(data.range.to) }} ·
        {{ data.courses.length }} course{{
          data.courses.length === 1 ? "" : "s"
        }}
        · Recorded activity · Sample counts shown
      </p>

      <div class="insight-overview-grid">
        <section
          class="insight-card demand-card"
          :aria-labelledby="`${chartId}-title`"
        >
          <div class="insight-card-heading">
            <div>
              <p class="insight-eyebrow">Demand over time</p>
              <h3 :id="`${chartId}-title`">When students need support</h3>
            </div>
            <div class="insight-legend">
              <span><i class="requests-key"></i> Requests</span
              ><span><i class="helped-key"></i> Helped</span>
            </div>
          </div>
          <div
            class="insight-chart-scroll"
            tabindex="0"
            role="region"
            aria-label="Daily request chart"
          >
            <svg
              class="demand-chart"
              viewBox="0 0 900 278"
              role="img"
              :aria-labelledby="`${chartId}-title ${chartId}-desc`"
              data-testid="insights-daily"
            >
              <desc :id="`${chartId}-desc`">
                {{ data.summary.requestCount }} recorded requests and
                {{ data.summary.helpedCount }} helped requests in the arrival
                cohort {{ data.range.from }} through {{ data.range.to }}.
                Outcomes reflect records through {{ data.generatedAt }}. Exact
                daily values follow the chart.
              </desc>
              <g v-for="tick in ticks" :key="tick">
                <line
                  x1="50"
                  x2="875"
                  :y1="chartY(tick)"
                  :y2="chartY(tick)"
                  stroke="#d9e2ef"
                />
                <text x="40" :y="chartY(tick) + 4" text-anchor="end">
                  {{ count(tick) }}
                </text>
              </g>
              <g v-for="(day, index) in daily" :key="day.date">
                <rect
                  :x="chartX(index)"
                  :y="chartY(day.requests)"
                  :width="Math.max(2, chartStep * 0.37)"
                  :height="230 - chartY(day.requests)"
                  rx="2"
                  fill="#17408b"
                >
                  <title>
                    {{ day.date }}: {{ day.requests }} recorded requests
                  </title>
                </rect>
                <rect
                  :x="chartX(index) + chartStep * 0.4"
                  :y="chartY(day.helped)"
                  :width="Math.max(2, chartStep * 0.37)"
                  :height="230 - chartY(day.helped)"
                  rx="2"
                  fill="#0f766e"
                >
                  <title>
                    {{ day.date }}: {{ day.helped }} helped requests
                  </title>
                </rect>
                <text
                  v-if="visibleDate(index)"
                  :x="chartX(index) + chartStep * 0.4"
                  y="254"
                  text-anchor="middle"
                >
                  {{ dayLabel(day.date) }}
                </text>
              </g>
            </svg>
          </div>
          <details class="insight-data">
            <summary>View daily values</summary>
            <div
              class="insight-table-scroll"
              tabindex="0"
              role="region"
              aria-label="Daily request data"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date · Eastern</th>
                    <th scope="col">Requests</th>
                    <th scope="col">Helped</th>
                    <th scope="col">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="day in daily" :key="day.date">
                    <th scope="row">{{ day.date }}</th>
                    <td>{{ day.requests }}</td>
                    <td>{{ day.helped }}</td>
                    <td>{{ day.closed }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section
          class="insight-card attention-card"
          aria-labelledby="insight-attention-title"
        >
          <div class="insight-card-heading">
            <div>
              <p class="insight-eyebrow">Next steps</p>
              <h3 id="insight-attention-title">Needs a closer look</h3>
            </div>
            <span class="insight-count"
              >{{ attentionGroups.length }}
              {{ attentionGroups.length === 1 ? "group" : "groups" }}</span
            >
          </div>
          <ul v-if="attentionGroups.length" class="insight-attention-list">
            <li v-for="item in attentionGroups.slice(0, 3)" :key="item.code">
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </li>
          </ul>
          <p v-else class="insight-empty">
            No outstanding staffing signals in these records.
          </p>
          <a
            v-if="attentionGroups.length && standalone"
            href="#insight-courses"
            class="insight-text-link"
            >View course details →</a
          >
        </section>
      </div>

      <section
        v-if="standalone"
        id="insight-courses"
        class="insight-card"
        aria-labelledby="insight-courses-title"
      >
        <div class="insight-card-heading">
          <div>
            <p class="insight-eyebrow">Course portfolio</p>
            <h3 id="insight-courses-title">Demand alongside staffing</h3>
          </div>
          <span class="insight-count">{{ data.courses.length }} courses</span>
        </div>
        <div
          class="insight-table-scroll"
          tabindex="0"
          role="region"
          aria-label="Course comparison"
        >
          <table class="insight-course-table">
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Requests</th>
                <th scope="col">Helped</th>
                <th scope="col">P90 wait</th>
                <th scope="col">TA coverage</th>
                <th scope="col">Staffing plan</th>
                <th scope="col">Follow-up</th>
                <th scope="col"><span class="sr-only">Course actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="course in data.courses"
                :key="course.id"
                :data-testid="`insights-course-${course.id}`"
              >
                <th scope="row">
                  <NuxtLink
                    :to="`/courses/${encodeURIComponent(course.id)}/admin`"
                    >{{ course.code.toUpperCase() }}</NuxtLink
                  ><span class="insight-secondary">{{ course.title }}</span>
                </th>
                <td>
                  <strong>{{ count(course.requestCount) }}</strong
                  ><span class="insight-secondary"
                    >{{ course.uniqueStudents }} students</span
                  >
                </td>
                <td>
                  {{ course.helpedCount
                  }}<span class="insight-secondary"
                    >{{ course.closedCount }} closed</span
                  >
                </td>
                <td>
                  {{ decimal(course.p90WaitMinutes)
                  }}<span class="insight-secondary"
                    >{{ course.waitSampleCount }} wait samples</span
                  >
                </td>
                <td>
                  <strong>{{ course.activeTAs }} active</strong>
                  <span class="insight-secondary"
                    >{{ course.onDuty }} on duty now ·
                    {{ decimal(course.appointedWeeklyHours) }} known
                    h/week</span
                  >
                  <span
                    v-if="course.manualCapacityUnknown"
                    class="insight-secondary insight-capacity-note"
                    >{{ course.manualCapacityUnknown }} manual TA{{
                      course.manualCapacityUnknown === 1 ? "" : "s"
                    }}
                    · hours unrecorded</span
                  >
                </td>
                <td>
                  <strong>{{ course.approvedPositions }} planned</strong
                  ><span class="insight-secondary"
                    >{{ course.committedPositions }} reserved ·
                    {{ course.openPositions }} unfilled</span
                  >
                </td>
                <td>
                  <div class="insight-signals">
                    <span
                      v-for="signal in course.attention"
                      :key="signal.code"
                      class="insight-signal"
                      :class="{
                        'is-attention': signal.severity === 'attention',
                      }"
                      >{{ signal.title }}</span
                    ><span
                      v-if="!course.attention.length"
                      class="insight-secondary"
                      >No open signals</span
                    >
                  </div>
                </td>
                <td>
                  <NuxtLink
                    class="insight-table-link"
                    :to="`/courses/${encodeURIComponent(course.id)}/admin`"
                    >View course →</NuxtLink
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="insight-card" aria-labelledby="insight-heatmap-title">
        <div class="insight-card-heading">
          <div>
            <p class="insight-eyebrow">Demand by day & hour</p>
            <h3 id="insight-heatmap-title">Find the busiest windows</h3>
          </div>
          <p class="insight-small">
            {{ data.coverage.observedDays }} dates with recorded requests
          </p>
        </div>
        <div
          class="insight-table-scroll heatmap-scroll"
          tabindex="0"
          role="region"
          aria-label="Recorded requests by weekday and hour in Eastern Time"
        >
          <table class="insight-heatmap" data-testid="insights-heatmap">
            <caption class="sr-only">
              Recorded request counts by weekday and hour, America/New_York.
              Each cell contains its exact count.
            </caption>
            <thead>
              <tr>
                <th scope="col">ET</th>
                <th v-for="hour in hours" :key="hour" scope="col">
                  {{ String(hour).padStart(2, "0") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(weekday, index) in weekdays" :key="weekday">
                <th scope="row">{{ weekday }}</th>
                <td
                  v-for="hour in hours"
                  :key="hour"
                  :style="heatStyle(heatValue(index + 1, hour))"
                  :title="`${weekday} ${String(hour).padStart(2, '0')}:00 ET · ${heatValue(index + 1, hour)} recorded requests`"
                >
                  {{ heatValue(index + 1, hour) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="heatmap-footer">
          <span>Recorded request arrivals · Eastern Time</span
          ><span class="heatmap-scale"
            >Fewer
            <i
              v-for="value in [0, 0.2, 0.4, 0.6, 0.8, 1]"
              :key="value"
              :style="heatStyle(value * heatMax)"
            ></i>
            More</span
          >
        </div>
      </section>

      <section class="insight-card" aria-labelledby="insight-helpers-title">
        <div class="insight-card-heading">
          <div>
            <p class="insight-eyebrow">Support contributors</p>
            <h3 id="insight-helpers-title">Observed help, with its context</h3>
          </div>
          <span class="insight-count"
            >{{ data.helpers.length }} helpers<template
              v-if="feedbackFollowups"
            >
              · {{ feedbackFollowups }} feedback follow-ups</template
            ></span
          >
        </div>
        <div class="insight-helper-filters">
          <label
            >Find a helper<input
              v-model="helperSearch"
              type="search"
              placeholder="Name or email"
              data-testid="insights-helper-search" /></label
          ><label
            >Sort by<select
              v-model="helperSort"
              data-testid="insights-helper-sort"
            >
              <option value="name">Name</option>
              <option value="requests">Recorded requests</option>
              <option value="minutes">Recorded help minutes</option>
              <option value="feedback-high">Feedback: highest observed</option>
              <option value="feedback-low">Feedback: lowest observed</option>
            </select></label
          >
        </div>
        <p class="insight-note">
          Session ratings submitted in this range; course feedback is shown
          separately.
        </p>
        <p class="insight-note feedback-rule">
          Feedback bands use ≥5 ratings from ≥3 students: below 3.5 follow-up,
          4.0+ positive, otherwise mixed.
        </p>
        <div
          class="insight-table-scroll"
          tabindex="0"
          role="region"
          aria-label="TA and staff assistance evidence"
        >
          <table class="insight-helper-table">
            <thead>
              <tr>
                <th scope="col">Helper</th>
                <th scope="col">Requests</th>
                <th scope="col">Recorded help</th>
                <th scope="col">Average / request</th>
                <th scope="col">Help-session ratings</th>
                <th scope="col">Reported work</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="helper in helpers"
                :key="helper.email"
                :data-testid="`insights-helper-${helper.email}`"
              >
                <th scope="row">
                  <strong>{{ helper.name || helper.email }}</strong>
                  <span class="insight-signal helper-role">{{
                    helper.role === "ta"
                      ? "TA"
                      : helper.role === "staff"
                        ? "Course staff"
                        : "Past course helper"
                  }}</span
                  ><span class="insight-secondary">{{ helper.email }}</span
                  ><span class="insight-secondary">{{
                    helper.courseIds.map(courseName).join(" · ")
                  }}</span>
                </th>
                <td>
                  <strong>{{ count(helper.requests) }}</strong
                  ><span class="insight-secondary"
                    >{{ helper.students }} students ·
                    {{ helper.activeDays }} days</span
                  >
                </td>
                <td>{{ decimal(helper.helpMinutes) }} min</td>
                <td>{{ decimal(helper.averageHelpMinutes) }} min</td>
                <td>
                  <template v-if="helper.feedbackCount"
                    ><strong>{{ decimal(helper.feedbackAverage) }} / 5</strong
                    ><span class="insight-secondary"
                      >{{ helper.feedbackCount }}
                      {{ helper.feedbackCount === 1 ? "rating" : "ratings" }} ·
                      {{ helper.feedbackReviewers }}
                      {{
                        helper.feedbackReviewers === 1 ? "student" : "students"
                      }}
                      · {{ helper.feedbackDays }}
                      {{ helper.feedbackDays === 1 ? "day" : "days" }}</span
                    ><span
                      class="rating-distribution"
                      role="img"
                      :aria-label="ratingLabel(helper)"
                      ><i
                        v-for="rating in helper.feedbackDistribution"
                        :key="rating.rating"
                        :style="{ flexGrow: rating.count }"
                        :class="`rating-${rating.rating}`"
                      ></i></span></template
                  ><span v-else class="insight-secondary"
                    >Not rated · n = 0</span
                  >
                  <span
                    class="insight-feedback-band"
                    :class="`feedback-${feedbackBand(helper).key}`"
                    :title="feedbackRule"
                    :data-testid="`insights-feedback-${helper.email}`"
                    >{{ feedbackBand(helper).label }}</span
                  >
                </td>
                <td>
                  {{ decimal(helper.reportedHours) }} h<span
                    class="insight-secondary"
                    >Self-reported</span
                  >
                </td>
                <td>
                  <span class="insight-signal">{{
                    helper.requests
                      ? `${helper.requests} observed requests`
                      : "No observed requests"
                  }}</span
                  ><span v-if="helper.handoffRequests" class="insight-secondary"
                    >{{ helper.handoffRequests }} shared requests</span
                  >
                </td>
              </tr>
              <tr v-if="!helpers.length">
                <td colspan="7" class="insight-empty">
                  No matching help observations in this range.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="insight-bottom-grid">
        <section class="insight-card" aria-labelledby="insight-workload-title">
          <div class="insight-card-heading">
            <div>
              <p class="insight-eyebrow">Work beyond the queue</p>
              <h3 id="insight-workload-title">Reported teaching work</h3>
            </div>
          </div>
          <div class="workload-total">
            <strong
              >{{ decimal(data.workload.totalHours) }}<small>h</small></strong
            ><span
              >{{ data.workload.count }} records<br />{{
                data.workload.reporters
              }}
              reporters</span
            >
          </div>
          <ul class="workload-bars">
            <li v-for="item in workload" :key="item.kind">
              <span>{{ workLabel(item.kind) }}</span
              ><strong>{{ decimal(item.hours) }} h</strong>
              <div aria-hidden="true">
                <i
                  :style="{ width: `${(item.hours / workloadMax) * 100}%` }"
                ></i>
              </div>
            </li>
          </ul>
          <p v-if="!workload.length" class="insight-empty">
            No work reports in this range.
          </p>
          <p class="insight-note">
            Self-reported teaching work; recorded help minutes are tracked
            separately.
          </p>
        </section>
        <section class="insight-card" aria-labelledby="insight-finance-title">
          <div class="insight-card-heading">
            <div>
              <p class="insight-eyebrow">Current semester</p>
              <h3 id="insight-finance-title">Staffing commitments</h3>
            </div>
          </div>
          <dl class="insight-financials">
            <div>
              <dt>Approved plans</dt>
              <dd>{{ money(data.budget.approved) }}</dd>
            </div>
            <div>
              <dt>Outstanding commitments</dt>
              <dd>{{ money(data.budget.committed) }}</dd>
            </div>
            <div>
              <dt>Settled incurred costs</dt>
              <dd>{{ money(data.budget.settled) }}</dd>
            </div>
            <div>
              <dt>Requested plans</dt>
              <dd>{{ money(data.budget.requested) }}</dd>
            </div>
          </dl>
          <div class="staffing-facts">
            <span
              ><strong>{{ data.summary.pendingClearance }}</strong> pending
              clearance</span
            ><span
              ><strong>{{ data.summary.pendingStart }}</strong> future
              starts</span
            ><span
              ><strong>{{ data.summary.unsettled }}</strong> awaiting
              settlement</span
            >
          </div>
        </section>
      </div>

      <section class="insight-card" aria-labelledby="insight-scenarios-title">
        <div class="insight-card-heading">
          <div>
            <p class="insight-eyebrow">Plan the next staffing conversation</p>
            <h3 id="insight-scenarios-title">
              One fewer, current plan, one more
            </h3>
          </div>
        </div>
        <label v-if="scenarioChoices.length" class="scenario-select"
          >Position<select
            v-model="selectedScenario"
            data-testid="insights-scenario"
          >
            <option value="" disabled>Choose a position</option>
            <option
              v-for="choice in scenarioChoices"
              :key="choice.id"
              :value="choice.id"
            >
              {{ courseName(choice.courseId) }} · {{ choice.title }}
            </option>
          </select></label
        >
        <div v-if="scenarios.length" class="scenario-grid">
          <article
            v-for="scenario in scenarios"
            :key="`${scenario.opportunityId}-${scenario.change}`"
            class="scenario-card"
            :class="{ 'is-current': scenario.change === 0 }"
          >
            <span class="scenario-label">{{
              scenario.change === 0
                ? "Current plan"
                : scenario.change < 0
                  ? "One fewer"
                  : "One more"
            }}</span>
            <h4>
              {{ scenario.positions }} TA{{
                scenario.positions === 1 ? "" : "s"
              }}
            </h4>
            <strong>{{ money(scenario.estimatedCost) }}</strong>
            <p>
              {{ scenario.weeklyHours }} h/week ·
              {{ decimal(scenario.weeks, 0) }} weeks ·
              {{ money(scenario.hourlyRate) }}/h
            </p>
            <span
              class="insight-signal"
              :class="{ 'is-attention': !scenario.budgetCovered }"
              >{{
                scenario.budgetCovered
                  ? "Within approved budget"
                  : "Exceeds approved budget"
              }}</span
            >
          </article>
        </div>
        <p v-else class="insight-empty">
          No approved-position scenarios are available.
        </p>
        <p class="insight-note">
          Review teaching coverage before changing staffing.
        </p>
      </section>

      <details class="insight-coverage">
        <summary>
          Data coverage · {{ data.coverage.observedDays }} observed dates ·
          {{ data.coverage.waitSampleCount }} wait samples
        </summary>
        <ul>
          <li>{{ data.coverage.source }}</li>
          <li v-for="limitation in data.coverage.limitations" :key="limitation">
            {{ limitation }}
          </li>
        </ul>
        <p>
          {{ data.summary.feedbackCount }} course-level feedback responses
          remain separate from {{ data.summary.helperFeedbackCount }} attributed
          help-session responses.
        </p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.course-insights {
  --insight-blue: #012169;
  --insight-accent: #17408b;
  --insight-muted: #536174;
  --insight-line: #d9e2ef;
  color: #172033;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  margin: 26px 0 30px;
  min-width: 0;
}
.course-insights * {
  box-sizing: border-box;
}
.insight-topline,
.insight-card-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.insight-topline {
  margin-bottom: 20px;
}
.insight-eyebrow {
  font-size: 10px !important;
  line-height: 1.5 !important;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-weight: 750;
  color: var(--insight-accent);
  margin: 0 0 5px !important;
}
.insight-topline h2 {
  font-size: clamp(23px, 2.6vw, 31px);
  line-height: 1.25;
  color: var(--insight-blue);
  margin: 0;
  letter-spacing: -0.025em;
}
.insight-updated {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--insight-muted);
  margin: 0;
}
.insight-updated span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0f766e;
}
.insight-filters {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid var(--insight-line);
  border-radius: 10px;
  margin-bottom: 20px;
}
.course-insights label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  margin: 0;
  min-width: 0;
}
.insight-filters > label {
  flex: 1 1 170px;
}
.insight-filters > label:first-child:has(select) {
  flex: 2 1 260px;
}
.course-insights input,
.course-insights select {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  border: 1px solid #b7c4d6;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fff;
  color: #172033;
  font: 13px/1.3 system-ui;
}
.insight-filter-note {
  font-size: 11px;
  line-height: 1.55;
  margin: 0 0 2px;
  color: var(--insight-muted);
  flex: 1 1 185px;
}
.insight-notice {
  padding: 12px 15px;
  border-left: 3px solid var(--insight-accent);
  background: #eaf0fc;
  border-radius: 5px;
  font-size: 13px;
}
.insight-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.insight-kpi {
  padding: 19px 20px;
  background: #fff;
  border: 1px solid var(--insight-line);
  border-top: 3px solid var(--insight-accent);
  border-radius: 10px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 8px 24px rgb(1 33 105 / 3%);
}
.insight-kpi > span {
  font-size: 12px;
  color: var(--insight-muted);
  font-weight: 600;
}
.insight-kpi > strong {
  font-size: 36px;
  line-height: 1.15;
  letter-spacing: -0.045em;
  color: var(--insight-blue);
  font-variant-numeric: tabular-nums;
}
.insight-kpi em {
  font-size: 15px;
  letter-spacing: 0;
  font-style: normal;
  font-weight: 500;
  margin-left: 5px;
  color: var(--insight-muted);
}
.insight-kpi small {
  font-size: 11px;
  line-height: 1.6;
  color: var(--insight-muted);
}
.insight-range {
  font-size: 11px;
  color: var(--insight-muted);
  line-height: 1.6;
  margin: 12px 0 20px;
}
.insight-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.5fr) minmax(230px, 1fr);
  gap: 18px;
  align-items: stretch;
}
.insight-card {
  background: #fff;
  border: 1px solid var(--insight-line);
  border-radius: 11px;
  padding: 22px;
  margin-bottom: 20px;
  min-width: 0;
  box-shadow: 0 8px 24px rgb(1 33 105 / 3%);
}
.insight-overview-grid > .insight-card {
  margin-bottom: 20px;
}
.insight-card-heading {
  margin-bottom: 20px;
}
.insight-card h3 {
  font-size: 19px;
  line-height: 1.4;
  color: var(--insight-blue);
  margin: 0;
  letter-spacing: -0.02em;
}
.insight-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 10px;
  color: var(--insight-muted);
}
.insight-legend span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.insight-legend i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.requests-key {
  background: #17408b;
}
.helped-key {
  background: #0f766e;
}
.insight-chart-scroll {
  overflow-x: auto;
}
.demand-chart {
  display: block;
  width: 100%;
  min-width: 560px;
  height: auto;
}
.demand-chart text {
  font: 11px system-ui;
  fill: #536174;
}
.insight-data {
  font-size: 11px;
  margin-top: 10px;
  color: var(--insight-muted);
}
.course-insights summary {
  cursor: pointer;
  line-height: 1.6;
  color: var(--insight-accent);
}
.insight-count {
  font-size: 11px;
  font-weight: 650;
  color: var(--insight-accent);
  background: #eaf0fc;
  padding: 5px 9px;
  border-radius: 20px;
  white-space: nowrap;
}
.insight-attention-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.insight-attention-list li {
  padding: 11px 0;
  border-top: 1px solid #e5ebf4;
}
.insight-attention-list li:first-child {
  border-top: 0;
  padding-top: 0;
}
.insight-attention-list strong {
  font-size: 12px;
  color: #7c3c0c;
}
.insight-attention-list p {
  font-size: 11px;
  line-height: 1.55;
  margin: 5px 0;
  color: var(--insight-muted);
}
.insight-attention-list a,
.insight-text-link {
  font-size: 11px;
  font-weight: 650;
  color: var(--insight-accent);
}
.insight-table-scroll {
  position: relative;
  overflow-x: auto;
  min-width: 0;
}
.course-insights table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.course-insights th,
.course-insights td {
  padding: 13px 11px;
  border-bottom: 1px solid #e4eaf3;
  text-align: left;
  vertical-align: middle;
  line-height: 1.5;
}
.course-insights thead th {
  background: #f6f8fc;
  color: var(--insight-muted);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.course-insights tbody th {
  font-size: 12px;
  font-weight: 600;
}
.course-insights tbody tr:last-child > th,
.course-insights tbody tr:last-child > td {
  border-bottom: 0;
}
.insight-course-table {
  min-width: 930px;
}
.insight-course-table tbody th {
  min-width: 180px;
  max-width: 250px;
}
.course-insights a {
  color: var(--insight-accent);
}
.insight-secondary {
  display: block;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--insight-muted);
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.helper-role {
  display: table;
  margin-top: 6px;
}
.insight-capacity-note {
  color: #854215;
}
.insight-feedback-band {
  display: table;
  margin-top: 8px;
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  background: #eef3fb;
  color: #244779;
}
.insight-feedback-band.feedback-follow-up {
  background: #fff1df;
  color: #854215;
}
.insight-feedback-band.feedback-positive {
  background: #e4f3ec;
  color: #0b614d;
}
.insight-feedback-band.feedback-limited,
.insight-feedback-band.feedback-none {
  background: #f0f2f6;
  color: #536174;
}
.feedback-rule {
  margin-top: -5px !important;
}
.insight-table-link {
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
}
.insight-signals {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 140px;
  max-width: 240px;
}
.insight-signal {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.5;
  background: #eef3fb;
  color: #244779;
}
.insight-signal.is-attention {
  background: #fff4e5;
  color: #854215;
}
.insight-small {
  font-size: 11px;
  color: var(--insight-muted);
  margin: 0;
}
.insight-heatmap {
  min-width: 820px;
  border-collapse: separate !important;
  border-spacing: 3px;
  table-layout: fixed;
}
.course-insights .insight-heatmap th,
.course-insights .insight-heatmap td {
  text-align: center;
  padding: 8px 1px;
  font-size: 10px;
  border: 0;
  min-width: 25px;
  border-radius: 3px;
}
.course-insights .insight-heatmap th:first-child {
  width: 43px;
  text-align: left;
  font-weight: 650;
  color: var(--insight-muted);
}
.course-insights .insight-heatmap thead th {
  background: transparent;
}
.heatmap-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 10px;
  color: var(--insight-muted);
  line-height: 1.6;
  margin-top: 13px;
}
.heatmap-scale {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  white-space: nowrap;
}
.heatmap-scale i {
  width: 13px;
  height: 13px;
  border-radius: 2px;
}
.insight-helper-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin-bottom: 12px;
}
.insight-helper-filters > label:first-child {
  flex: 1 1 260px;
}
.insight-helper-filters > label:last-child {
  flex: 0 1 210px;
}
.insight-note {
  font-size: 11px !important;
  line-height: 1.65 !important;
  color: var(--insight-muted);
  margin: 12px 0 !important;
}
.insight-helper-table {
  min-width: 950px;
}
.insight-helper-table tbody th {
  min-width: 185px;
}
.rating-distribution {
  display: flex;
  width: 90px;
  height: 6px;
  gap: 1px;
  margin-top: 8px;
  border-radius: 3px;
  overflow: hidden;
}
.rating-distribution i {
  background: #17408b;
  flex-basis: 0;
  min-width: 0;
}
.rating-distribution .rating-1 {
  background: #5f6b80;
}
.rating-distribution .rating-2 {
  background: #41628d;
}
.rating-distribution .rating-3 {
  background: #306a9c;
}
.rating-distribution .rating-4 {
  background: #177c89;
}
.rating-distribution .rating-5 {
  background: #0f766e;
}
.insight-bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.workload-total {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
}
.workload-total > strong {
  font-size: 38px;
  line-height: 1.2;
  letter-spacing: -0.04em;
  color: var(--insight-blue);
}
.workload-total small {
  font-size: 17px;
  font-weight: 400;
  margin-left: 4px;
}
.workload-total > span {
  font-size: 11px;
  line-height: 1.7;
  color: var(--insight-muted);
}
.workload-bars {
  list-style: none;
  padding: 0;
  margin: 0;
}
.workload-bars li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px 12px;
  margin-bottom: 15px;
  font-size: 11px;
}
.workload-bars strong {
  font-weight: 650;
  color: var(--insight-blue);
}
.workload-bars li > div {
  grid-column: 1/-1;
  height: 6px;
  border-radius: 5px;
  background: #eaf0fa;
  overflow: hidden;
}
.workload-bars i {
  display: block;
  height: 100%;
  background: #17408b;
  border-radius: 5px;
}
.course-insights .insight-financials {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 0 0 25px;
  padding: 0;
}
.insight-financials dt {
  font-size: 11px;
  font-weight: 400;
  color: var(--insight-muted);
  line-height: 1.5;
}
.course-insights .insight-financials dd {
  font-size: 24px;
  line-height: 1.3;
  letter-spacing: -0.025em;
  font-weight: 650;
  color: var(--insight-blue);
  margin: 6px 0 0;
  overflow-wrap: anywhere;
}
.staffing-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  border-top: 1px solid var(--insight-line);
  padding-top: 18px;
  font-size: 11px;
  color: var(--insight-muted);
}
.staffing-facts strong {
  color: var(--insight-blue);
}
.scenario-select {
  max-width: 650px;
  margin-bottom: 18px !important;
}
.scenario-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.scenario-card {
  padding: 18px;
  border: 1px solid var(--insight-line);
  border-radius: 9px;
  background: #fbfcff;
  min-width: 0;
}
.scenario-card.is-current {
  border-color: #17408b;
  background: #f0f5ff;
  box-shadow: inset 0 3px 0 #17408b;
}
.scenario-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--insight-accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.scenario-card h4 {
  font-size: 15px;
  margin: 12px 0 4px;
  color: var(--insight-blue);
}
.scenario-card > strong {
  font-size: 29px;
  letter-spacing: -0.03em;
  color: var(--insight-blue);
}
.scenario-card p {
  font-size: 10px;
  line-height: 1.6;
  color: var(--insight-muted);
  margin: 10px 0 13px;
}
.insight-empty {
  font-size: 12px;
  line-height: 1.7;
  padding: 15px 0;
  color: var(--insight-muted);
}
.insight-coverage {
  font-size: 11px;
  color: var(--insight-muted);
  padding: 14px 16px;
  border: 1px solid var(--insight-line);
  border-radius: 8px;
  line-height: 1.7;
}
.insight-coverage li {
  margin-block: 5px;
}
.insight-coverage p {
  font-size: 11px;
}
@media (max-width: 1100px) {
  .insight-overview-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .insight-attention-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
  }
  .insight-attention-list li:first-child {
    padding-top: 11px;
    border-top: 1px solid #e5ebf4;
  }
  .insight-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .demand-chart {
    min-width: 620px;
  }
}
@media (max-width: 700px) {
  .insight-card {
    padding: 17px 14px;
  }
  .insight-filters {
    padding: 14px;
  }
  .insight-topline h2 {
    font-size: 23px;
  }
  .insight-bottom-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .insight-kpi {
    padding: 16px 14px;
  }
  .insight-kpi > strong {
    font-size: 31px;
  }
  .insight-kpi small {
    font-size: 10px;
  }
  .insight-card h3 {
    font-size: 18px;
  }
  .scenario-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .scenario-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 12px;
    align-items: center;
  }
  .scenario-label {
    grid-column: 1/-1;
  }
  .scenario-card h4 {
    margin: 4px 0;
  }
  .scenario-card p {
    grid-column: 1/-1;
    margin: 0 0 4px;
  }
  .scenario-card > .insight-signal {
    grid-column: 1/-1;
    justify-self: start;
  }
  .scenario-card > strong {
    font-size: 27px;
  }
  .insight-attention-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .insight-filter-note {
    flex-basis: 100%;
  }
  .insight-helper-filters > label:last-child {
    flex: 1 1 210px;
  }
  .course-insights .insight-financials dd {
    font-size: 22px;
  }
}
@media (max-width: 380px) {
  .insight-kpis {
    gap: 9px;
  }
  .insight-kpi {
    padding: 14px 11px;
  }
  .insight-kpi > strong {
    font-size: 28px;
  }
  .insight-kpi > span {
    font-size: 11px;
  }
  .insight-topline h2 {
    font-size: 22px;
  }
  .insight-filters > label {
    flex-basis: 100%;
  }
}
</style>
