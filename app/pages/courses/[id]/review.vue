<script setup lang="ts">
const courseId = String(useRoute().params.id);
const { data: overview } = await useStaffingOverview(
  `review-terms-${courseId}`,
);
const termId = ref(String(useRoute().query.termId || ""));
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useAsyncData<any>(
  `term-review-${courseId}`,
  () =>
    requestFetch(`/api/staffing/reviews/${courseId}`, {
      query: { termId: termId.value || undefined },
    }),
  { watch: [termId] },
);
guardStaffingAccess(data, error);
</script>
<template>
  <StaffingShell
    :title="`${data?.course?.code || courseId} Term Review`"
    subtitle="Review recorded operations and staffing cost scenarios with their evidence gaps."
  >
    <NuxtLink :to="`/courses/${courseId}/admin`">Back to Course Admin</NuxtLink>
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load this course review.") }}
    </p>
    <section class="panel">
      <div class="panel-body">
        <label
          >Term<select v-model="termId" data-testid="review-term">
            <option value="">Current course term</option>
            <option
              v-for="term in overview?.terms || []"
              :key="term.id"
              :value="term.id"
            >
              {{ term.name }}
            </option>
          </select></label
        ><button class="secondary" @click="refresh()">Refresh review</button>
      </div>
    </section>
    <template v-if="data && !error"
      ><section class="panel">
        <div class="panel-heading"><h2>Recorded Course Activity</h2></div>
        <div class="panel-body">
          <dl>
            <dt>Sessions</dt>
            <dd>{{ data.metrics?.sessions }}</dd>
            <dt>Helped requests</dt>
            <dd>{{ data.metrics?.helped }}</dd>
            <dt>Average wait (minutes)</dt>
            <dd>
              {{
                data.metrics?.avgWaitMinutes == null
                  ? "Unavailable"
                  : Number(data.metrics.avgWaitMinutes).toFixed(1)
              }}
            </dd>
            <dt>P90 wait (minutes)</dt>
            <dd>
              {{
                data.metrics?.p90WaitMinutes == null
                  ? "Unavailable"
                  : Number(data.metrics.p90WaitMinutes).toFixed(1)
              }}
            </dd>
            <dt>Recorded help (minutes)</dt>
            <dd>
              {{ Number(data.metrics?.recordedHelpMinutes || 0).toFixed(1) }}
            </dd>
            <dt>Feedback responses</dt>
            <dd>{{ data.metrics?.feedbackCount }}</dd>
            <dt>Reported workload (hours)</dt>
            <dd>{{ Number(data.workload?.totalHours || 0).toFixed(1) }}</dd>
          </dl>
          <p class="muted">
            Queue activity is not the entire teaching workload. Recorded help
            time is not a measure of payroll hours or an individual performance
            rating.
          </p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Evidence Coverage</h2></div>
        <div class="panel-body">
          <ul>
            <li
              v-for="(item, index) in data.missingEvidence || []"
              :key="index"
            >
              {{ item }}
            </li>
          </ul>
          <p v-if="!data.missingEvidence?.length">
            No additional evidence gaps were flagged by the available checks.
          </p>
          <p class="notice">
            Low observed queue use alone does not justify fewer assistants.
            Required attendance, grading, labs, discussions, preparation, and
            peak demand must remain covered.
          </p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Budget Scenarios</h2></div>
        <div class="panel-body">
          <p>
            Committed budget:
            {{ data.budget?.committedBudget ?? "Unavailable" }}
          </p>
          <article
            v-for="(item, index) in data.budget?.scenarios || []"
            :key="index"
            class="opportunity-card"
          >
            <h3>{{ item.name || item.label || `Scenario ${index + 1}` }}</h3>
            <dl>
              <template v-for="(value, key) in item" :key="key"
                ><dt>{{ staffingState(key) }}</dt>
                <dd>
                  {{
                    typeof value === "object" ? JSON.stringify(value) : value
                  }}
                </dd></template
              >
            </dl>
          </article>
          <p v-if="!data.budget?.scenarios?.length" class="empty">
            No cost scenarios are available for this term.
          </p>
        </div>
      </section>
      <AiAssistance
        kind="term_review"
        :term-id="termId"
        :target-id="courseId"
        title="Course Improvement Draft Assistance"
      />
    </template>
  </StaffingShell>
</template>
