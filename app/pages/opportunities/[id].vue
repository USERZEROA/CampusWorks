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
if ([403, 404].includes((error.value as any)?.statusCode))
  await navigationApp.runWithContext(() =>
    navigateTo("/courses", { replace: true }),
  );
const opportunity = computed(() => data.value?.opportunity);
const canApply = computed(
  () =>
    data.value?.viewer?.canApplyStaffing &&
    data.value?.currentCycle?.isOpen &&
    opportunity.value?.termId === data.value.currentCycle.termId,
);
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
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Opportunity'"
    :back-to="data?.canManage ? `/staffing/${id}` : '/opportunities'"
    :back-label="data?.canManage ? 'Candidates' : 'Positions'"
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
            <template v-if="data.course"
              ><dt>Course</dt>
              <dd>
                {{ data.course.code }} ? {{ data.course.title }}
              </dd></template
            >
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
          <ul v-if="opportunity.type === 'ta'">
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
          <template v-if="opportunity.requiredSlots?.length">
            <h3>Weekly schedule (Eastern Time)</h3>
            <ul>
              <li
                v-for="(slot, index) in opportunity.requiredSlots"
                :key="index"
              >
                {{
                  [
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ][slot.day]
                }}
                {{ slot.start }}–{{ slot.end }}
              </li>
            </ul>
          </template>
          <p>CV: {{ opportunity.cvRequired ? "Required" : "Optional" }}.</p>
          <div class="actions">
            <NuxtLink
              v-if="data.application"
              class="button"
              :to="`/applications/${data.application.id}`"
              >Open my application</NuxtLink
            ><button
              v-else-if="canApply"
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
