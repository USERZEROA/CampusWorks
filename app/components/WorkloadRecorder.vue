<script setup lang="ts">
import { courseDate } from "#shared/course-time";

const props = defineProps<{ appointmentId: string }>();
const { busy, message, failure, run } = useStaffingMutation();
const now = new Date();
const observation = reactive({
  kind: "office_hours",
  hours: 1,
  date: courseDate(now),
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
    "Workload recorded.",
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
    <div class="panel-heading"><h2>Record Workload</h2></div>
    <form @submit.prevent="save" class="panel-body" :aria-busy="busy">
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
          >Work category<select
            v-model="observation.kind"
            aria-label="Work category"
          >
            <option value="attendance">Attendance</option>
            <option value="lab">Lab</option>
            <option value="discussion">Discussion</option>
            <option value="grading">Grading</option>
            <option value="office_hours">Office hours</option>
            <option value="preparation">Preparation</option>
            <option value="coordination">Coordination</option>
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
          >Work date (Eastern Time)<input
            v-model="observation.date"
            type="date"
            required
            data-testid="workload-date"
        /></label>
      </div>
      <label
        >Notes<textarea v-model="observation.notes" maxlength="2000" />
      </label>
      <div class="actions form-actions">
        <button :disabled="busy" data-testid="workload-save">
          Record workload
        </button>
      </div>
    </form>
  </section>
</template>
