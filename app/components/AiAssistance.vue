<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    kind: "candidate_fit" | "cv_summary" | "opportunity_draft" | "term_review";
    targetId: string;
    title?: string;
    termId?: string;
    authorizedTargets?: Array<{ id: string; label: string }>;
    canAnalyze?: boolean;
  }>(),
  { canAnalyze: true },
);
const nuxtApp = useNuxtApp();
const currentUser = useAuthUser();
const authError = useAuthError();
const loading = ref(false);
const authorized = ref(true);
const reconnecting = ref(false);
const configured = ref<boolean | null>(null);
const serverCanAnalyze = ref(true);
const analysisAllowed = computed(
  () => props.canAnalyze !== false && serverCanAnalyze.value,
);
const task = ref<any>(null);
const refreshJobs = ref<any[]>([]);
const subscriptions = ref<any[]>([]);
const message = ref("Preparing suggestions...");
const comparisonPage = ref(1);
let requestGeneration = 0;
const scope = computed(
  () =>
    `${props.kind}:${props.targetId}:${props.termId || ""}:${comparisonPage.value}`,
);
let activeRequest: AbortController | null = null;
const matchesTask = (item: any) =>
  item?.kind === props.kind &&
  item.targetId === props.targetId &&
  (props.kind !== "term_review" ||
    (item.requestedTermId || "") === (props.termId || "")) &&
  (props.kind !== "candidate_fit" ||
    (item.candidatePage || 1) === comparisonPage.value);
const currentJob = computed(() => {
  const ids = new Set(
    subscriptions.value
      .filter(
        (item) =>
          item.kind === props.kind &&
          item.targetId === props.targetId &&
          (props.kind !== "term_review" ||
            (item.termId || "") === (props.termId || "")) &&
          (item.page || 1) === comparisonPage.value,
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
  (!refreshPending.value || task.value?.historical) &&
  authorized.value
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
  "metrics:staffing": "Staffing plan",
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
  if (reconnecting.value) return "Reconnecting...";
  if (!analysisAllowed.value)
    return "Candidate analysis has ended; history remains available.";
  if (configured.value === false) return "AI is not configured.";
  const job = currentJob.value;
  if (job?.status === "queued") return "Suggestions are queued.";
  if (job?.status === "running") return "Updating suggestions...";
  if (job?.status === "blocked")
    return job.reason || "Waiting for provider capacity.";
  if (["failed", "revoked"].includes(job?.status))
    return job.reason || "AI analysis is unavailable.";
  if (task.value?.status === "stale")
    return props.kind === "candidate_fit"
      ? "Candidate details changed; updating automatically."
      : "Evidence changed; updating automatically.";
  if (task.value?.status === "pending") return "Analysis is pending.";
  if (task.value?.status === "completed")
    return task.value?.deterministic
      ? task.value.message
      : "Updated automatically.";
  return task.value?.message || message.value;
});
async function handleFailure(error: any, fallback: string) {
  const status = error?.statusCode || error?.response?.status;
  if (status === 401) {
    currentUser.value = null;
    authError.value = "Your session expired. Please sign in again.";
    await nuxtApp.runWithContext(() => navigateTo("/login", { replace: true }));
    return;
  }
  if (status === 403 || status === 404) {
    authorized.value = false;
    task.value = null;
    refreshJobs.value = [];
    subscriptions.value = [];
    return;
  }
  reconnecting.value = true;
  message.value = apiErrorMessage(error, fallback);
}
async function loadTasks(options?: { signal?: AbortSignal }) {
  if (loading.value || !props.targetId) return;
  const requestedScope = scope.value;
  const generation = requestGeneration;
  const controller = new AbortController();
  activeRequest = controller;
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  loading.value = true;
  try {
    const result = await staffingRequest<any>("/api/ai/tasks", {
      signal,
      query: {
        kind: props.kind,
        targetId: props.targetId,
        termId: props.termId || undefined,
        ...(props.kind === "candidate_fit"
          ? { page: comparisonPage.value }
          : {}),
      },
    });
    if (requestedScope !== scope.value || generation !== requestGeneration)
      return;
    configured.value = result.ai?.configured === true;
    authorized.value = true;
    serverCanAnalyze.value = result.canAnalyze !== false;
    subscriptions.value = result.refresh?.subscriptions || [];
    refreshJobs.value = result.refresh?.jobs || [];
    task.value =
      [result.refresh?.latest, ...(result.tasks || [])]
        .filter(matchesTask)
        .sort(
          (left, right) =>
            (!analysisAllowed.value
              ? Number(right.status === "completed" && !!right.result) -
                Number(left.status === "completed" && !!left.result)
              : 0) ||
            Number(!!right.automatic) - Number(!!left.automatic) ||
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime(),
        )[0] || null;
    reconnecting.value = false;
    message.value = configured.value
      ? "Preparing suggestions..."
      : "AI is not configured.";
  } catch (error) {
    if (
      signal.aborted ||
      requestedScope !== scope.value ||
      generation !== requestGeneration
    )
      return;
    await handleFailure(error, "AI availability could not be checked.");
  } finally {
    if (generation === requestGeneration) loading.value = false;
    if (activeRequest === controller) activeRequest = null;
  }
}
watch(
  () => `${props.kind}:${props.targetId}:${props.termId || ""}`,
  () => {
    comparisonPage.value = 1;
  },
);
watch(scope, () => {
  requestGeneration++;
  activeRequest?.abort();
  loading.value = false;
  task.value = null;
  refreshJobs.value = [];
  subscriptions.value = [];
  configured.value = null;
  serverCanAnalyze.value = true;
  authorized.value = true;
  reconnecting.value = false;
  message.value = "Preparing suggestions...";
  void loadTasks();
});
onMounted(() => {
  void loadTasks();
});
onBeforeUnmount(() => {
  requestGeneration++;
  activeRequest?.abort();
});
useIntervalRefresh(loadTasks, 2500);
</script>
<template>
  <section v-if="authorized" class="panel" aria-label="AI assistance">
    <div class="panel-heading">
      <h2>{{ title || "AI Assistance" }}</h2>
    </div>
    <div class="panel-body" :aria-busy="!task && (loading || refreshWorking)">
      <p class="notice" role="status" data-testid="ai-status">
        {{ statusMessage }}
      </p>
      <div
        v-if="
          kind === 'candidate_fit' &&
          (comparisonPage > 1 || task?.coverage?.hasMore)
        "
        class="actions"
      >
        <button
          v-if="comparisonPage > 1"
          type="button"
          class="secondary"
          @click="comparisonPage--"
          data-testid="ai-previous-comparison"
        >
          Previous candidates
        </button>
        <button
          v-if="kind === 'candidate_fit' && task?.coverage?.hasMore"
          type="button"
          class="secondary"
          @click="comparisonPage++"
          data-testid="ai-next-comparison"
        >
          Next candidates
        </button>
      </div>
      <p v-if="task" class="muted">
        <span v-if="completedTask?.provider?.host === 'api.openai.com'" data-testid="ai-provider">OpenAI · </span>
        {{
          task.historical
            ? "Historical analysis"
            : `Analysis ${staffingState(task.status)}`
        }}
        -
        {{ staffingDate(task.completedAt || task.createdAt) }}
      </p>
      <p v-if="task?.coverage" class="muted" data-testid="ai-coverage">
        <template v-if="task.coverage.compared != null">
          Page {{ task.coverage.page || comparisonPage }}:
          {{ task.coverage.compared }} eligible candidates ·
          {{ task.coverage.totalSubmitted }} applications
        </template>
      </p>
      <div v-if="completedTask?.result" data-testid="ai-result">
        <h3>
          {{
            completedTask.historical ? "Historical suggestions" : "Suggestions"
          }}
        </h3>
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
