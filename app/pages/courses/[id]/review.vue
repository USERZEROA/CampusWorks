<script setup lang="ts">
const courseId = String(useRoute().params.id);
const reportCacheKey = `term-review-${courseId}`;
const { data, error, refresh, pending } = await useStaffingPagedRecord(
  reportCacheKey,
  `/api/staffing/reviews/${courseId}`,
);
const termId = computed(() => data.value?.termId || "");
useIntervalRefresh(refresh, 10000);
const opportunityTitles = computed(
  () =>
    new Map<string, string>(
      (data.value?.budget?.opportunities || []).map((item: any) => [
        item.id,
        item.title,
      ]),
    ),
);
</script>
<template>
  <StaffingShell
    :title="`${data?.course?.code || ''} Course Review`"
    back-to="/staffing"
    back-label="Recruitment"
  >
    <p v-if="data?.currentCycle?.termName" class="muted">
      {{ data.currentCycle.termName }}
    </p>
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load this review.") }}
    </p>
    <button class="secondary" :disabled="pending" @click="refresh()">
      Refresh
    </button>
    <p v-if="pending" class="notice" role="status">Loading review…</p>
    <template v-if="data && !error">
      <section class="panel">
        <div class="panel-heading"><h2>Course Activity</h2></div>
        <div class="panel-body">
          <dl>
            <dt>Sessions</dt>
            <dd>{{ data.metrics?.sessions }}</dd>
            <dt>Helped requests</dt>
            <dd>{{ data.metrics?.helped }}</dd>
            <dt>Average wait</dt>
            <dd>
              {{
                data.metrics?.avgWaitMinutes == null
                  ? "Unavailable"
                  : Number(data.metrics.avgWaitMinutes).toFixed(1) + " min"
              }}
            </dd>
            <dt>P90 wait</dt>
            <dd>
              {{
                data.metrics?.p90WaitMinutes == null
                  ? "Unavailable"
                  : Number(data.metrics.p90WaitMinutes).toFixed(1) + " min"
              }}
            </dd>
            <dt>Recorded help</dt>
            <dd>
              {{ Number(data.metrics?.recordedHelpMinutes || 0).toFixed(1) }}
              min
            </dd>
            <dt>Feedback responses</dt>
            <dd>{{ data.metrics?.feedbackCount }}</dd>
            <dt>Reported workload</dt>
            <dd>
              {{ Number(data.workload?.totalHours || 0).toFixed(1) }} hours
            </dd>
          </dl>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Staffing Budget</h2></div>
        <div class="panel-body">
          <dl>
            <dt>Approved</dt>
            <dd>{{ data.budget?.approvedBudget ?? "Unavailable" }}</dd>
            <dt>Committed</dt>
            <dd>{{ data.budget?.committedBudget ?? "Unavailable" }}</dd>
          </dl>
          <p class="muted">
            {{ data.budget?.opportunities?.length || 0 }} of
            {{ data.pagination?.totals?.opportunities || 0 }} positions shown
          </p>
          <article
            v-for="(item, index) in data.budget?.scenarios || []"
            :key="index"
            class="opportunity-card"
          >
            <h3>
              {{ opportunityTitles.get(item.opportunityId) || "Position" }} ·
              {{ item.positions }} assistant(s)
            </h3>
            <p>
              {{ item.weeklyHours }} hours/week · Estimated cost
              {{ Number(item.estimatedCost || 0).toFixed(2) }}
            </p>
            <span class="status">{{
              item.budgetCovered ? "Within budget" : "Exceeds budget"
            }}</span>
          </article>
          <p v-if="!data.budget?.scenarios?.length" class="empty">
            No budget scenarios yet.
          </p>
        </div>
      </section>
      <StaffingPaging
        :cache-key="reportCacheKey"
        :pagination="data.pagination"
      />
      <AiAssistance
        kind="term_review"
        :term-id="termId"
        :target-id="courseId"
        title="Course Suggestions"
      />
    </template>
  </StaffingShell>
</template>
