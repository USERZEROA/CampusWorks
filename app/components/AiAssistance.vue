<script setup lang="ts">
const props = defineProps<{
  kind: "candidate_fit" | "cv_summary" | "opportunity_draft" | "term_review";
  targetId: string;
  title?: string;
  termId?: string;
}>();
const busy = ref(false);
const nuxtApp = useNuxtApp();
const currentUser = useAuthUser();
const authError = useAuthError();
const message = ref(
  "AI assistance is awaiting provider configuration. All application and appointment actions work without AI.",
);
const task = ref<any>(null);
const failed = ref(false);
async function requestAssistance() {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  try {
    const result = await staffingRequest<any>("/api/ai/tasks", {
      method: "POST",
      body: {
        kind: props.kind,
        targetId: props.targetId,
        termId: props.termId || undefined,
      },
    });
    task.value = result.task;
    message.value =
      result.task?.message ||
      (result.task?.status === "unconfigured"
        ? "No AI provider is configured. Your request is recorded; no private material was sent to a provider."
        : `Request status: ${result.task?.status || "pending"}.`);
  } catch (error: any) {
    failed.value = true;
    const status = error?.statusCode || error?.response?.status;
    if (status === 401 || status === 403) task.value = null;
    if (status === 401) {
      currentUser.value = null;
      authError.value = "Your session expired. Please sign in again.";
      await nuxtApp.runWithContext(() =>
        navigateTo("/login", { replace: true }),
      );
      return;
    }
    message.value = apiErrorMessage(
      error,
      "Unable to request AI assistance. You can continue the workflow manually.",
    );
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel" aria-label="AI assistance">
    <div class="panel-heading">
      <h2>{{ title || "AI Assistance" }}</h2>
    </div>
    <div class="panel-body">
      <p
        class="notice"
        :class="{ error: failed }"
        role="status"
        data-testid="ai-status"
      >
        {{ message }}
      </p>
      <p class="muted">
        Background summaries use the submitted qualification fields, screening
        answers, and optional qualification text. PDF CVs remain private
        attachments and are not automatically parsed.
      </p>
      <p class="muted">
        Recommendations require evidence from submitted qualifications and
        remain advisory. AI cannot select candidates, issue offers, grant
        permissions, or change a budget.
      </p>
      <button
        type="button"
        :disabled="busy || !targetId"
        @click="requestAssistance"
        data-testid="ai-request"
      >
        {{ busy ? "Requesting…" : "Request assistance" }}
      </button>
      <p v-if="task" class="muted">Task {{ task.id }} · {{ task.status }}</p>
      <div v-if="task?.result" data-testid="ai-result">
        <h3>Advisory output</h3>
        <p class="preserve-lines">{{ task.result.summary }}</p>
        <p v-if="task.result.summaryEvidenceRefs?.length" class="muted">
          Evidence: {{ task.result.summaryEvidenceRefs.join(", ") }}
        </p>
        <article
          v-for="(item, index) in task.result.items || []"
          :key="index"
          class="opportunity-card"
        >
          <p>{{ item.explanation }}</p>
          <p class="muted">
            Evidence:
            {{
              item.evidenceRefs?.join(", ") ||
              "No evidence reference supplied; review manually."
            }}
          </p>
        </article>
        <ul>
          <li
            v-for="(caution, index) in task.result.cautions || []"
            :key="index"
          >
            {{ caution }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
