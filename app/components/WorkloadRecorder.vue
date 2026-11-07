<script setup lang="ts">
const props = defineProps<{ appointmentId: string }>();
const { busy, message, failure, run } = useStaffingMutation();
const now = new Date();
const observation = reactive({
  kind: "office_hours",
  hours: 1,
  date: now.toISOString().slice(0, 10),
  notes: "",
});
let idempotencyKey = "";
async function save() {
  if (!idempotencyKey) idempotencyKey = crypto.randomUUID();
  const result = await run(
    () =>
      staffingRequest("/api/staffing/workload", {
        method: "POST",
        body: {
          ...observation,
          appointmentId: props.appointmentId,
          idempotencyKey,
        },
      }),
    "Workload observation recorded. This is a self-reported observation, not a payroll record.",
  );
  if (result) {
    idempotencyKey = "";
    observation.hours = 0;
    observation.notes = "";
  }
}
</script>
<template>
  <section class="panel">
    <div class="panel-heading"><h2>Record Workload Observation</h2></div>
    <form @submit.prevent="save" class="panel-body" :aria-busy="busy">
      <p class="muted">
        Record actual work by category so the term review can distinguish office
        hours, grading, labs, and preparation. Do not duplicate the same work in
        multiple categories.
      </p>
      <p
        v-if="message"
        class="notice"
        :class="{ error: failure }"
        role="status"
      >
        {{ message }}
      </p>
      <div class="grid">
        <label
          >Work category<select v-model="observation.kind" aria-label="Work category">
            <option value="attendance">Attendance</option>
            <option value="lab">Lab</option>
            <option value="discussion">Discussion</option>
            <option value="grading">Grading</option>
            <option value="office_hours">Office hours</option>
            <option value="preparation">Preparation</option>
            <option value="coordination">Coordination</option>
            <option value="research">Research</option>
          </select></label
        ><label
          >Hours<input
            v-model.number="observation.hours"
            type="number"
            min="0.05"
            max="24"
            step="0.05"
            required
            data-testid="workload-hours" /></label
        ><label
          >Work date (UTC)<input
            v-model="observation.date"
            type="date"
            required
            data-testid="workload-date"
        /></label>
      </div>
      <label
        >Notes<textarea v-model="observation.notes" maxlength="2000" /></label
      ><button :disabled="busy" data-testid="workload-save">
        Record workload
      </button>
    </form>
  </section>
</template>
