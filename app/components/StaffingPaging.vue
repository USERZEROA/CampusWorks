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
const error = ref("");
const hasMore = computed(() =>
  typeof props.pagination?.hasMore === "object"
    ? Object.values(props.pagination.hasMore).some(Boolean)
    : !!props.pagination?.hasMore,
);
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  const count = useState<number>(`${props.cacheKey}-page-count`, () => 1);
  count.value++;
  try {
    await refreshNuxtData(props.cacheKey);
  } catch (failure) {
    count.value--;
    error.value = apiErrorMessage(
      failure,
      "Unable to load the next page. Please retry.",
    );
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <div v-if="hasMore || error" class="notice" role="status">
    <p v-if="hasMore">
      More authorized records are available. Load the next page to include them
      in the lists and selectors.
    </p>
    <p v-if="error">{{ error }}</p>
    <button
      type="button"
      class="secondary"
      :disabled="loading"
      @click="load"
      data-testid="staffing-load-more"
    >
      {{ loading ? "Loading…" : "Load more records" }}
    </button>
  </div>
</template>
