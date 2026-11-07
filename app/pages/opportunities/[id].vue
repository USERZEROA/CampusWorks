<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const id = String(useRoute().params.id);
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useAsyncData<any>(
  `opportunity-${id}`,
  () => requestFetch(`/api/staffing/opportunities/${id}`),
);
guardStaffingAccess(data, error);
const opportunity = computed(() => data.value?.opportunity);
const { busy, message, failure, run } = useStaffingMutation(refresh);
async function apply() {
  const result = await run(
    () =>
      staffingRequest<any>(`/api/staffing/opportunities/${id}/applications`, {
        method: "POST",
      }),
    "Application draft created.",
  );
  if (result?.application)
    await navigateWithContext(
      `/applications/${staffingId(result.application)}`,
    );
}
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Opportunity'"
    subtitle="Review the appointment scope and requirements before applying."
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load this opportunity.") }}
    </p>
    <template v-if="opportunity && !error">
      <p
        v-if="message"
        class="notice"
        :class="{ error: failure }"
        role="status"
      >
        {{ message }}
      </p>
      <section class="panel">
        <div class="panel-heading">
          <h2>
            {{ opportunity.type?.toUpperCase() }} Appointment Requirements
          </h2>
        </div>
        <div class="panel-body">
          <dl>
            <dt>Status</dt>
            <dd>
              {{ staffingState(opportunity.state || opportunity.status) }}
            </dd>
            <dt>Department</dt>
            <dd>{{ opportunity.department }}</dd>
            <dt>Weekly hours</dt>
            <dd>{{ opportunity.weeklyHours }}</dd>
            <dt>Positions</dt>
            <dd>{{ opportunity.positions }}</dd>
            <dt>Appointment dates</dt>
            <dd>
              {{ staffingDate(opportunity.appointmentStart) }} –
              {{ staffingDate(opportunity.appointmentEnd) }}
            </dd>
            <dt>Application deadline</dt>
            <dd>{{ staffingDate(opportunity.applicationDeadline) }}</dd>
            <dt>Course or project</dt>
            <dd>{{ opportunity.courseId || opportunity.projectId }}</dd>
          </dl>
          <p class="preserve-lines">{{ opportunity.description }}</p>
          <h3>Required skills</h3>
          <p class="preserve-lines">
            {{ opportunity.requiredSkills || "See the published duties." }}
          </p>
          <h3>Preferred skills</h3>
          <p class="preserve-lines">
            {{
              opportunity.preferredSkills ||
              "No additional preferences specified."
            }}
          </p>
          <ul>
            <li>
              Attendance:
              {{ opportunity.requiresAttendance ? "Required" : "Not required" }}
            </li>
            <li>Lab: {{ opportunity.hasLab ? "Required" : "Not required" }}</li>
            <li>
              Discussion:
              {{ opportunity.hasDiscussion ? "Required" : "Not required" }}
            </li>
            <li>
              Grading:
              {{ opportunity.requiresGrading ? "Required" : "Not required" }}
            </li>
            <li>
              Office hours:
              {{ opportunity.holdsOfficeHours ? "Required" : "Not required" }}
            </li>
          </ul>
          <div
            v-if="opportunity.duties?.length"
            class="table-scroll"
            tabindex="0"
            role="region"
            aria-label="Published weekly duties table"
          >
            <table>
              <caption class="muted">
                Published weekly duties
              </caption>
              <thead>
                <tr>
                  <th>Duty</th>
                  <th>Sessions/week</th>
                  <th>Minutes/session</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(duty, index) in opportunity.duties" :key="index">
                  <td>{{ staffingState(duty.kind) }}</td>
                  <td>{{ duty.sessionsPerWeek }}</td>
                  <td>{{ duty.minutesPerSession }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            CV: {{ opportunity.cvRequired ? "Required" : "Optional" }}.
            Submitted qualification material is visible to the authorized
            opportunity reviewers.
          </p>
          <div class="actions">
            <NuxtLink
              v-if="data.application"
              class="button"
              :to="`/applications/${data.application.id}`"
              >Open my application</NuxtLink
            ><button
              v-else
              :disabled="
                busy ||
                (opportunity.state || opportunity.status) !== 'published'
              "
              @click="apply"
              data-testid="start-application"
            >
              Start application</button
            ><NuxtLink
              v-if="data.canManage"
              class="button secondary"
              :to="`/staffing/${id}`"
              >Review applications</NuxtLink
            >
          </div>
        </div>
      </section>
    </template>
  </StaffingShell>
</template>
