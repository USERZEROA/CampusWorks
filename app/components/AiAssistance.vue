<script setup lang="ts">
const props = defineProps<{ kind: 'candidate_fit' | 'cv_summary' | 'opportunity_draft' | 'term_review'; targetId: string; title?: string }>()
const busy = ref(false)
const message = ref('AI assistance is awaiting provider configuration. All application and appointment actions work without AI.')
const task = ref<any>(null)
const failed = ref(false)
async function requestAssistance() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    const result = await $fetch<any>('/api/ai/tasks', { method: 'POST', body: { kind: props.kind, targetId: props.targetId } })
    task.value = result.task
    message.value = result.task?.message || (result.task?.status === 'unconfigured' ? 'No AI provider is configured. Your request is recorded; no private material was sent to a provider.' : `Request status: ${result.task?.status || 'pending'}.`)
  } catch (error) {
    failed.value = true
    message.value = apiErrorMessage(error, 'Unable to request AI assistance. You can continue the workflow manually.')
  } finally { busy.value = false }
}
</script>
<template>
  <section class="panel" aria-label="AI assistance">
    <div class="panel-heading"><h2>{{ title || 'AI Assistance' }}</h2></div>
    <div class="panel-body">
      <p class="notice" :class="{error:failed}" role="status" data-testid="ai-status">{{ message }}</p>
      <p class="muted">Recommendations require evidence from submitted qualifications and remain advisory. AI cannot select candidates, issue offers, grant permissions, or change a budget.</p>
      <button type="button" :disabled="busy || !targetId" @click="requestAssistance" data-testid="ai-request">{{ busy ? 'Requesting…' : 'Request assistance' }}</button>
      <p v-if="task" class="muted">Task {{ task.id }} · {{ task.status }}</p>
    </div>
  </section>
</template>
