<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview("opportunities");
const search = ref("");
const kind = ref("");
const duties = (item: any) =>
  [
    [item.requiresAttendance, "Attendance"],
    [item.hasLab, "Lab"],
    [item.hasDiscussion, "Discussion"],
    [item.requiresGrading, "Grading"],
    [item.holdsOfficeHours, "Office hours"],
  ]
    .filter(([enabled]) => enabled)
    .map(([, label]) => String(label));
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
    <p v-if="search || kind" class="record-count" role="status">
      {{ opportunities.length }} matching loaded positions
    </p>
    <div class="grid position-grid" aria-live="polite">
      <article
        v-for="item in opportunities"
        :key="item.id"
        class="opportunity-card position-card"
        :data-testid="`opportunity-${item.id}`"
      >
        <div class="card-heading">
          <span class="type-tag">{{ item.type?.toUpperCase() }}</span>
          <StaffingStatus :state="item.state || item.status" />
        </div>
        <h2>{{ item.title }}</h2>
        <p class="record-meta">
          <template v-if="item.courseId"
            >{{ item.courseId.toUpperCase() }} ·
          </template>
          {{ item.department }}
        </p>
        <p class="position-description">{{ item.description }}</p>
        <dl class="position-facts">
          <div>
            <dt>Hours / week</dt>
            <dd>{{ item.weeklyHours }}</dd>
          </div>
          <div>
            <dt>Positions</dt>
            <dd>{{ item.positions }}</dd>
          </div>
        </dl>
        <div
          v-if="duties(item).length"
          class="position-tags"
          aria-label="Responsibilities"
        >
          <span v-for="duty in duties(item)" :key="duty">{{ duty }}</span>
        </div>
        <div class="position-footer">
          <p>
            <strong>Apply by:</strong>
            {{ staffingDate(item.applicationDeadline) }}
          </p>
          <NuxtLink class="button" :to="`/opportunities/${item.id}`"
            >View requirements</NuxtLink
          >
        </div>
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
