<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview("opportunities");
const search = ref("");
const kind = ref("");
const opportunities = computed(() =>
  (data.value?.opportunities || []).filter(
    (item: any) =>
      (!kind.value || item.type === kind.value) &&
      (!search.value ||
        `${item.title} ${item.description} ${item.requiredSkills}`
          .toLowerCase()
          .includes(search.value.toLowerCase())),
  ),
);
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell title="TA &amp; RA Positions">
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load opportunities.") }}
    </p>
    <p v-if="data?.currentCycle?.termName" class="muted">
      {{ data.currentCycle.termName }} · Applications close
      {{ staffingDate(data.currentCycle.closesAt) }}
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
