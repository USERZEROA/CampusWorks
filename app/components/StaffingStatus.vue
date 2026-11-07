<script setup lang="ts">
const props = defineProps<{ state?: string | null; label?: string }>();
const tone = computed(() => {
  const state = props.state || "draft";
  if (
    ["published", "active", "accepted", "cleared", "shortlisted"].includes(
      state,
    )
  )
    return "positive";
  if (
    [
      "pending_approval",
      "pending_clearance",
      "pending_start",
      "pending",
      "needs_information",
      "offered",
      "issued",
    ].includes(state)
  )
    return "waiting";
  if (["declined", "not_selected", "not_cleared", "suspended"].includes(state))
    return "attention";
  if (
    [
      "draft",
      "ended",
      "cancelled",
      "archived",
      "withdrawn",
      "expired",
      "applications_closed",
      "filled",
    ].includes(state)
  )
    return "neutral";
  return "info";
});
</script>

<template>
  <span class="status staffing-status" :class="`status-${tone}`">
    {{ label || staffingState(state) }}
  </span>
</template>

<style scoped>
.staffing-status.status-positive {
  color: #17603c;
  background: #e9f7ef;
}
.staffing-status.status-waiting {
  color: #714b00;
  background: #fff5d6;
}
.staffing-status.status-attention {
  color: #9f1239;
  background: #fff1f2;
}
.staffing-status.status-neutral {
  color: #475569;
  background: #eef1f6;
}
.staffing-status.status-info {
  color: #012169;
  background: #e5ecff;
}
</style>
