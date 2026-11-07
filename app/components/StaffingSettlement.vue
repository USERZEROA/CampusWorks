<script setup lang="ts">
const props = defineProps<{ appointment: any }>();
const emit = defineEmits<{ saved: [] }>();
const incurredCost = ref<number | undefined>();
const { busy, message, failure, run } = useStaffingMutation();
async function settle() {
  const result = await run(
    () =>
      staffingRequest(
        `/api/staffing/appointments/${props.appointment.id}/settle`,
        { method: "POST", body: { incurredCost: incurredCost.value } },
      ),
    "Costs settled.",
  );
  if (result) emit("saved");
}
</script>
<template>
  <form
    v-if="appointment.budgetStatus === 'awaiting_settlement'"
    @submit.prevent="settle"
    :aria-busy="busy"
  >
    <p v-if="message" class="notice" :class="{ error: failure }" role="status">
      {{ message }}
    </p>
    <label
      >Final incurred cost<input
        v-model.number="incurredCost"
        type="number"
        min="0"
        :max="appointment.committedCost"
        step="0.01"
        required
        :data-testid="`settlement-cost-${appointment.id}`"
    /></label>
    <button
      :disabled="busy"
      :data-testid="`appointment-settle-${appointment.id}`"
    >
      Settle costs
    </button>
  </form>
</template>
