<script setup lang="ts">
const props = defineProps<{
  cacheKey: string;
  pagination?: {
    hasMore?: boolean | Record<string, boolean>;
    totals?: Record<string, number>;
    page?: number;
    limit?: number;
  };
}>();
const loading = ref(false);
const nuxtApp = useNuxtApp();
const count = useState<number>(`${props.cacheKey}-page-count`, () => 1);
const error = ref("");
const waiting = computed(
  () => loading.value || count.value > (props.pagination?.page || 1),
);
const hasMore = computed(() =>
  typeof props.pagination?.hasMore === "object"
    ? Object.values(props.pagination.hasMore).some(Boolean)
    : !!props.pagination?.hasMore,
);
async function load() {
  if (waiting.value) return;
  loading.value = true;
  error.value = "";
  count.value++;
  try {
    await nuxtApp.runWithContext(() => refreshNuxtData(props.cacheKey));
  } catch (failure) {
    count.value--;
    error.value = apiErrorMessage(
      failure,
      "Additional records will load when the connection returns.",
    );
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <div v-if="hasMore || error" class="notice" role="status">
    <p v-if="hasMore">More records are available.</p>
    <p v-if="error">{{ error }}</p>
    <button
      type="button"
      class="secondary"
      :disabled="waiting"
      @click="load"
      data-testid="staffing-load-more"
    >
      {{ waiting ? "Loading…" : "Load more records" }}
    </button>
  </div>
</template>
