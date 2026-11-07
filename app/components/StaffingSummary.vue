<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: number }>;
  label?: string;
}>();
const number = new Intl.NumberFormat("en-US");
</script>

<template>
  <dl
    v-if="items.length"
    class="staffing-summary"
    :aria-label="label || 'Overview'"
  >
    <div v-for="item in items" :key="item.label" class="summary-item">
      <dt>{{ item.label }}</dt>
      <dd>{{ number.format(item.value) }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.staffing-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr));
  gap: 12px;
  margin: 20px 0;
}
.summary-item {
  padding: 16px 18px;
  border: 1px solid #d9e2ef;
  border-left: 3px solid #17408b;
  border-radius: 9px;
  background: #fff;
}
.summary-item dt {
  color: #536174;
  font-size: 12px;
  font-weight: 600;
}
.summary-item dd {
  margin: 6px 0 0;
  color: #012169;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
</style>
