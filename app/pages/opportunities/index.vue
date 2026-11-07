<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview("opportunities");
const search = ref("");
const kind = ref("");
const term = ref("");
const opportunities = computed(() =>
  (data.value?.opportunities || []).filter(
    (item: any) =>
      (!kind.value || item.type === kind.value) &&
      (!term.value || item.termId === term.value) &&
      (!search.value ||
        `${item.title} ${item.description} ${item.requiredSkills}`
          .toLowerCase()
          .includes(search.value.toLowerCase())),
  ),
);
</script>
<template>
  <StaffingShell
    title="Opportunities"
    subtitle="Find teaching and research appointments, review the weekly expectations, and submit an application."
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load opportunities.") }}
      <button @click="refresh()">Retry</button>
    </p>
    <p class="notice">
      You may apply to several opportunities. One appointment can be reserved or
      held per term. A selection is confirmed by the server; a recommendation
      does not reserve a position.
    </p>
    <section class="panel" aria-label="Filter opportunities">
      <div class="panel-body grid">
        <label
          >Search<input
            v-model="search"
            type="search"
            data-testid="opportunity-search"
        /></label>
        <label
          >Appointment type<select v-model="kind">
            <option value="">All types</option>
            <option value="ta">TA</option>
            <option value="ra">RA</option>
          </select></label
        >
        <label
          >Term<select v-model="term">
            <option value="">All terms</option>
            <option
              v-for="item in data?.terms || []"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </select></label
        >
      </div>
    </section>
    <div class="grid" aria-live="polite">
      <article
        v-for="item in opportunities"
        :key="item.id"
        class="opportunity-card"
        :data-testid="`opportunity-${item.id}`"
      >
        <span class="status"
          >{{ item.type?.toUpperCase() }} ·
          {{ staffingState(item.state || item.status) }}</span
        >
        <h2>{{ item.title }}</h2>
        <p class="muted">
          {{ item.department }} · {{ item.weeklyHours }} hours/week ·
          {{ item.positions }} position(s)
        </p>
        <p>{{ item.description }}</p>
        <p>
          <strong>Apply by:</strong>
          {{ staffingDate(item.applicationDeadline) }}
        </p>
        <NuxtLink class="button" :to="`/opportunities/${item.id}`"
          >View requirements</NuxtLink
        >
      </article>
    </div>
    <p
      v-if="!opportunities.length && !error"
      class="empty"
      data-testid="opportunities-empty"
    >
      No matching published opportunities are available.
    </p>
    <StaffingPaging cache-key="opportunities" :pagination="data?.pagination" />
  </StaffingShell>
</template>
