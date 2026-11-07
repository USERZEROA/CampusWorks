<script setup lang="ts">
const props = defineProps<{
  kind: "candidate_fit" | "cv_summary" | "opportunity_draft" | "term_review";
  targetId: string;
  title?: string;
  termId?: string;
  authorizedTargets?: Array<{ id: string; label: string }>;
}>();
const nuxtApp = useNuxtApp();
const currentUser = useAuthUser();
const authError = useAuthError();
const busy = ref(false);
const loading = ref(false);
const configured = ref<boolean | null>(null);
const task = ref<any>(null);
const refreshJobs = ref<any[]>([]);
const subscriptions = ref<any[]>([]);
const failed = ref(false);
const message = ref("Loading AI...");
const comparisonPage = ref(1);
const comparisonSize = 50;
let requestGeneration = 0;
const scope = computed(
  () => `${props.kind}:${props.targetId}:${props.termId || ""}`,
);
const matchesTask = (item: any) =>
  item?.kind === props.kind &&
  item.targetId === props.targetId &&
  (props.kind !== "term_review" ||
    (item.requestedTermId || "") === (props.termId || "")) &&
  (props.kind !== "candidate_fit" ||
    ((item.candidatePage || 1) === comparisonPage.value &&
      (item.candidatePageSize || 50) === comparisonSize));
const currentJob = computed(() => {
  const ids = new Set(
    subscriptions.value
      .filter(
        (item) =>
          item.kind === props.kind &&
          item.targetId === props.targetId &&
          (item.page || 1) === comparisonPage.value &&
          (item.pageSize || 50) === comparisonSize,
      )
      .map((item) => item.id),
  );
  return refreshJobs.value
    .filter((item) => ids.has(item.subscriptionId))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    )[0];
});
const refreshPending = computed(() =>
  ["queued", "running", "blocked"].includes(currentJob.value?.status),
);
const refreshWorking = computed(() =>
  ["queued", "running"].includes(currentJob.value?.status),
);
const completedTask = computed(() =>
  task.value?.status === "completed" &&
  matchesTask(task.value) &&
  !refreshPending.value &&
  !busy.value &&
  !failed.value
    ? task.value
    : null,
);
function candidateLabel(id: string, index?: number): string {
  const authorized = props.authorizedTargets?.find((item) => item.id === id);
  if (authorized?.label?.trim()) return authorized.label;
  const resultIndex =
    index ??
    completedTask.value?.result?.items?.findIndex(
      (item: any) => item.targetId === id,
    );
  return resultIndex != null && resultIndex >= 0
    ? `Candidate ${resultIndex + 1}`
    : "Candidate";
}
const evidenceFields: Record<string, string> = {
  "profile.undergraduateMajors": "Undergraduate major(s)",
  "profile.skills": "Relevant skills",
  "profile.experience": "Teaching or research experience",
  "profile.priorTaExperience": "Previous TA experience",
  "profile.priorCourses": "Previous courses and departments",
  "profile.availableHours": "Available hours per week",
  "profile.slots": "Confirmed schedule availability",
  "profile.positionPreference": "Position preference",
  qualificationText: "Qualification text",
  "opportunity:requirements": "Published appointment requirements",
  "coverage:candidates": "Candidate comparison coverage",
  "course:context": "Course and term",
  "metrics:recorded_sessions": "Recorded queue activity",
  "metrics:recorded_workload": "Reported workload",
  "metrics:budget": "Staffing budget",
  "metrics:limitations": "Evidence limitations",
};
function evidenceLabel(reference: string): string {
  const applicationReference = /^app:([^:]+):(.+)$/.exec(reference);
  if (!applicationReference)
    return evidenceFields[reference] || "Supporting evidence";
  const [, applicationId, field] = applicationReference;
  const label = field?.startsWith("answers.")
    ? "Screening answer"
    : evidenceFields[field || ""] || "Submitted qualifications";
  return props.kind === "candidate_fit"
    ? `${candidateLabel(applicationId || "")}  -  ${label}`
    : label;
}
const statusMessage = computed(() => {
  if (failed.value) return message.value;
  if (configured.value === false) return "AI is not configured.";
  const job = currentJob.value;
  if (job?.status === "queued") return "Updated candidate analysis is queued.";
  if (job?.status === "running") return "Updating recommendations...";
  if (job?.status === "blocked")
    return (
      job.reason ||
      "Analysis is waiting for eligible candidates or provider capacity."
    );
  if (["failed", "revoked"].includes(job?.status))
    return job.reason || "AI analysis is unavailable.";
  if (task.value?.status === "stale")
    return props.kind === "candidate_fit"
      ? "Candidate details changed; recommendations will update automatically."
      : "The evidence changed; request a new analysis.";
  if (task.value?.status === "pending") return "Analysis is pending.";
  return task.value?.message || message.value;
});
async function handleFailure(error: any, fallback: string) {
  failed.value = true;
  task.value = null;
  refreshJobs.value = [];
  subscriptions.value = [];
  const status = error?.statusCode || error?.response?.status;
  if (status === 401) {
    currentUser.value = null;
    authError.value = "Your session expired. Please sign in again.";
    await nuxtApp.runWithContext(() => navigateTo("/login", { replace: true }));
    return;
  }
  message.value = apiErrorMessage(error, fallback);
}
async function loadTasks() {
  if (loading.value || !props.targetId) return;
  const requestedScope = scope.value;
  const generation = requestGeneration;
  loading.value = true;
  try {
    const result = await staffingRequest<any>("/api/ai/tasks", {
      query: {
        kind: props.kind,
        targetId: props.targetId,
        termId: props.termId || undefined,
        ...(props.kind === "candidate_fit"
          ? { page: comparisonPage.value, pageSize: comparisonSize }
          : {}),
      },
    });
    if (requestedScope !== scope.value || generation !== requestGeneration)
      return;
    configured.value = result.ai?.configured === true;
    subscriptions.value = result.refresh?.subscriptions || [];
    refreshJobs.value = result.refresh?.jobs || [];
    task.value =
      [result.refresh?.latest, ...(result.tasks || [])]
        .filter(matchesTask)
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )[0] || null;
    failed.value = false;
    message.value = result.ai?.message || "AI assistance is available.";
  } catch (error) {
    if (requestedScope !== scope.value || generation !== requestGeneration)
      return;
    await handleFailure(error, "AI availability could not be checked.");
  } finally {
    loading.value = false;
  }
}
async function requestAssistance(page = comparisonPage.value) {
  if (busy.value || configured.value !== true || !props.targetId) return;
  const requestedScope = scope.value;
  requestGeneration++;
  busy.value = true;
  failed.value = false;
  comparisonPage.value = page;
  task.value = null;
  try {
    const result = await staffingRequest<any>("/api/ai/tasks", {
      method: "POST",
      body: {
        kind: props.kind,
        targetId: props.targetId,
        termId: props.termId || undefined,
        ...(props.kind === "candidate_fit"
          ? { page, pageSize: comparisonSize }
          : {}),
      },
    });
    if (requestedScope !== scope.value) return;
    task.value = matchesTask(result.task) ? result.task : null;
    message.value = result.task?.message || "Analysis requested.";
    await loadTasks();
  } catch (error) {
    if (requestedScope !== scope.value) return;
    await handleFailure(error, "Unable to request AI assistance.");
  } finally {
    busy.value = false;
  }
}
watch(scope, () => {
  requestGeneration++;
  task.value = null;
  refreshJobs.value = [];
  subscriptions.value = [];
  configured.value = null;
  comparisonPage.value = 1;
  message.value = "Loading AI...";
  failed.value = false;
  loadTasks();
});
onMounted(loadTasks);
useIntervalRefresh(loadTasks, 2500);
</script>
<template>
  <section class="panel" aria-label="AI assistance">
    <div class="panel-heading">
      <h2>{{ title || "AI Assistance" }}</h2>
    </div>
    <div class="panel-body" :aria-busy="busy || refreshPending">
      <p
        class="notice"
        :class="{ error: failed }"
        role="status"
        data-testid="ai-status"
      >
        {{ statusMessage }}
      </p>
      <p v-if="kind === 'candidate_fit'" class="muted">
        Recommendations update automatically when candidates or availability
        change.
      </p>

      <div class="actions">
        <button
          type="button"
          :disabled="busy || refreshWorking || configured !== true || !targetId"
          @click="requestAssistance()"
          data-testid="ai-request"
        >
          {{
            busy
              ? "Requesting..."
              : configured === false
                ? "AI not configured"
                : kind === "candidate_fit"
                  ? "Analyze candidates"
                  : kind === "cv_summary"
                    ? "Summarize application"
                    : kind === "opportunity_draft"
                      ? "Draft requirements"
                      : "Draft course review"
          }}
        </button>
        <button
          v-if="kind === 'candidate_fit' && task?.coverage?.hasMore"
          type="button"
          class="secondary"
          :disabled="busy || refreshWorking || configured !== true"
          @click="requestAssistance(comparisonPage + 1)"
          data-testid="ai-next-comparison"
        >
          Compare next page
        </button>
      </div>
      <p v-if="task" class="muted">
        Analysis {{ staffingState(task.status) }} -
        {{ staffingDate(task.completedAt || task.createdAt) }}
      </p>
      <p v-if="task?.coverage" class="muted" data-testid="ai-coverage">
        <template v-if="task.coverage.compared != null">
          Page {{ task.coverage.page || comparisonPage }}:
          {{ task.coverage.compared }} eligible candidates ?
          {{ task.coverage.totalSubmitted }} applications
        </template>
      </p>
      <div v-if="completedTask?.result" data-testid="ai-result">
        <h3>Suggestions</h3>
        <p class="preserve-lines">{{ completedTask.result.summary }}</p>
        <p
          v-if="completedTask.result.summaryEvidenceRefs?.length"
          class="muted"
        >
          Evidence:
          <template
            v-for="(reference, index) in completedTask.result
              .summaryEvidenceRefs"
            :key="reference"
          >
            <span :title="reference">{{ evidenceLabel(reference) }}</span
            >{{
              index < completedTask.result.summaryEvidenceRefs.length - 1
                ? ", "
                : ""
            }}
          </template>
        </p>
        <article
          v-for="(item, index) in completedTask.result.items || []"
          :key="index"
          class="opportunity-card"
        >
          <h3 v-if="kind === 'candidate_fit'">
            <NuxtLink
              :to="`/applications/${encodeURIComponent(item.targetId)}`"
            >
              {{ candidateLabel(item.targetId, Number(index)) }}
            </NuxtLink>
          </h3>
          <p>{{ item.explanation }}</p>
          <p class="muted">
            Evidence:
            <template v-if="item.evidenceRefs?.length">
              <template
                v-for="(reference, referenceIndex) in item.evidenceRefs"
                :key="reference"
              >
                <span :title="reference">{{ evidenceLabel(reference) }}</span
                >{{ referenceIndex < item.evidenceRefs.length - 1 ? ", " : "" }}
              </template>
            </template>
            <template v-else
              >No evidence reference supplied; review manually.</template
            >
          </p>
        </article>
        <ul v-if="completedTask.result.cautions?.length">
          <li
            v-for="(caution, index) in completedTask.result.cautions"
            :key="index"
          >
            {{ caution }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
