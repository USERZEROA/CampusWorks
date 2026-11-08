<script setup lang="ts">
const courseId = String(useRoute().params.id);
const reportCacheKey = `term-review-${courseId}`;
const { data, error, refresh, pending } = await useStaffingPagedRecord(
  reportCacheKey,
  `/api/staffing/reviews/${courseId}`,
);
const termId = computed(() => data.value?.termId || "");
useIntervalRefresh(refresh, 10000);
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
    <p v-if="pending && !data" class="notice" role="status">Loading review…</p>
    <template v-if="data">
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
        <div class="panel-heading"><h2>Staffing Plan</h2></div>
        <div class="panel-body">
          <dl>
            <dt>Approved positions</dt>
            <dd>{{ data.staffing?.approvedPositions ?? 0 }}</dd>
            <dt>Reserved positions</dt>
            <dd>{{ data.staffing?.committedPositions ?? 0 }}</dd>
            <dt>Unfilled seats</dt>
            <dd>{{ data.staffing?.openPositions ?? 0 }}</dd>
          </dl>
          <p class="muted">
            {{ data.staffing?.opportunities?.length || 0 }} of
            {{ data.pagination?.totals?.opportunities || 0 }} opportunities
            shown
          </p>
          <article
            v-for="item in data.staffing?.opportunities || []"
            :key="item.id"
            class="opportunity-card"
          >
            <h3>{{ item.title }} · {{ item.positions }} planned</h3>
            <p>
              {{ item.committedPositions || 0 }} reserved ·
              {{ staffingState(item.status) }}
            </p>
          </article>
          <p v-if="!data.staffing?.opportunities?.length" class="empty">
            No staffing plans yet.
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
