<script setup lang="ts">
const id = String(useRoute().params.id);
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useStaffingPagedRecord(
  `staffing-opportunity-${id}`,
  `/api/staffing/opportunities/${id}`,
);
const opportunity = computed(() => data.value?.opportunity);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const keys = new Map<string, string>();
const reason = ref("");
const applications = computed(() => data.value?.applications || []);
async function select(candidate: any) {
  const key = `${candidate.id}:${candidate.version}`;
  if (!keys.has(key)) keys.set(key, crypto.randomUUID());
  await run(
    () =>
      staffingRequest(`/api/staffing/applications/${candidate.id}/select`, {
        method: "POST",
        body: {
          expectedVersion: candidate.version,
          idempotencyKey: keys.get(key),
        },
      }),
    "Candidate selected and offer issued. Other reviewers will see the updated term availability.",
  );
  if (failure.value) await refresh();
}
async function command(path: string, body: any = {}, success = "Saved.") {
  await run(() => staffingRequest(path, { method: "POST", body }), success);
}
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Opportunity Review'"
    subtitle="Review submitted evidence and make an explicit selection. Current availability is rechecked by the server."
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to open this review.") }}
    </p>
    <p
      v-if="message"
      class="notice"
      :class="{ error: failure, success: !failure }"
      role="status"
      data-testid="staffing-notice"
    >
      {{ message }}
    </p>
    <template v-if="opportunity && data.canManage">
      <section class="panel">
        <div class="panel-heading"><h2>Publication and Capacity</h2></div>
        <div class="panel-body">
          <p>
            <span class="status" data-testid="opportunity-status">{{
              staffingState(opportunity.status || opportunity.state)
            }}</span>
            · {{ opportunity.type?.toUpperCase() }} ·
            {{ opportunity.positions }} positions ·
            {{ opportunity.weeklyHours }} hours/week
          </p>
          <p>{{ opportunity.description }}</p>
          <p>
            Application deadline:
            {{ staffingDate(opportunity.applicationDeadline) }}. Appointment:
            {{ staffingDate(opportunity.appointmentStart) }} –
            {{ staffingDate(opportunity.appointmentEnd) }}.
          </p>
          <div class="actions">
            <NuxtLink
              v-if="(opportunity.status || opportunity.state) === 'draft'"
              class="button secondary"
              :to="`/staffing/edit?id=${id}`"
              data-testid="opportunity-edit"
              >Edit draft requirements</NuxtLink
            ><button
              v-if="
                ['draft', 'applications_closed'].includes(
                  opportunity.status || opportunity.state,
                )
              "
              :disabled="busy"
              @click="
                command(
                  `/api/staffing/opportunities/${id}/publish`,
                  {},
                  'Publication requested. The current approval status is shown above.',
                )
              "
              data-testid="opportunity-publish"
            >
              Publish opportunity</button
            ><button
              v-if="(opportunity.status || opportunity.state) === 'published'"
              class="secondary"
              :disabled="busy"
              @click="
                command(
                  `/api/staffing/opportunities/${id}/close`,
                  {},
                  'Applications closed.',
                )
              "
              data-testid="opportunity-close"
            >
              Close applications</button
            ><NuxtLink class="button secondary" :to="`/opportunities/${id}`"
              >View published requirements</NuxtLink
            ><NuxtLink
              v-if="opportunity.courseId"
              class="button secondary"
              :to="`/courses/${opportunity.courseId}/admin`"
              >Course Admin</NuxtLink
            >
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Applications and Availability</h2></div>
        <div class="panel-body">
          <p class="notice">
            A shortlist does not reserve a candidate. The first successfully
            committed selection holds the candidate for this term; competing
            selections receive a conflict and refresh the list.
          </p>
          <div class="table-scroll">
            <table v-if="applications.length">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Application</th>
                  <th>Availability</th>
                  <th>Evidence</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="candidate in applications"
                  :key="candidate.id"
                  :data-testid="`candidate-row-${candidate.id}`"
                >
                  <td>
                    {{ candidate.profile?.firstName }}
                    {{ candidate.profile?.lastName }}<br />{{
                      candidate.applicantEmail ||
                      candidate.userEmail ||
                      candidate.studentEmail
                    }}
                  </td>
                  <td>{{ staffingState(candidate.status) }}</td>
                  <td>
                    {{
                      candidate.available === false ||
                      candidate.availability?.unavailable === true
                        ? "Unavailable for this term"
                        : "Rechecked at selection"
                    }}
                  </td>
                  <td>
                    <NuxtLink :to="`/applications/${candidate.id}`"
                      >Review application</NuxtLink
                    >
                    <p v-if="candidate.cv?.id || candidate.cvDocumentId">
                      <a
                        :href="`/api/staffing/documents/${candidate.cv?.id || candidate.cvDocumentId}`"
                        >Download CV</a
                      >
                    </p>
                  </td>
                  <td>
                    <div class="actions">
                      <button
                        class="secondary"
                        :disabled="
                          busy ||
                          ![
                            'submitted',
                            'under_review',
                            'shortlisted',
                          ].includes(candidate.status)
                        "
                        @click="
                          command(
                            `/api/staffing/applications/${candidate.id}/shortlist`,
                            { shortlisted: candidate.status !== 'shortlisted' },
                            'Review status updated.',
                          )
                        "
                        :data-testid="`shortlist-candidate-${candidate.id}`"
                      >
                        {{
                          candidate.status === "shortlisted"
                            ? "Remove shortlist"
                            : "Shortlist"
                        }}</button
                      ><button
                        :disabled="
                          busy ||
                          ![
                            'submitted',
                            'under_review',
                            'shortlisted',
                          ].includes(candidate.status) ||
                          candidate.available === false ||
                          candidate.availability?.unavailable === true ||
                          candidate.availability?.eligible === false
                        "
                        @click="select(candidate)"
                        :data-testid="`select-candidate-${candidate.id}`"
                      >
                        Select and issue offer
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="empty">No submitted applications yet.</p>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Offers and Appointments</h2></div>
        <div class="panel-body">
          <label
            >Reason for a lifecycle change<input
              v-model="reason"
              maxlength="1000"
              data-testid="appointment-reason"
          /></label>
          <article
            v-for="item in data.offers || []"
            :key="item.id"
            class="opportunity-card"
          >
            <h3>Offer · {{ item.applicantEmail || item.userEmail }}</h3>
            <p>
              {{ staffingState(item.status) }} · Response deadline
              {{ staffingDate(item.expiresAt || item.responseDeadline) }}
            </p>
            <button
              v-if="item.status === 'issued'"
              class="danger"
              :disabled="busy || !reason.trim()"
              @click="
                command(
                  `/api/staffing/offers/${item.id}/rescind`,
                  { reason },
                  'Offer rescinded and availability released.',
                )
              "
              :data-testid="`rescind-offer-${item.id}`"
            >
              Rescind offer
            </button>
          </article>
          <article
            v-for="item in data.appointments || []"
            :key="item.id"
            class="opportunity-card"
            :data-testid="`appointment-row-${item.id}`"
          >
            <h3>
              {{ item.applicantEmail || item.userEmail || item.studentEmail }} ·
              {{ item.type?.toUpperCase() }}
            </h3>
            <p>
              <span class="status">{{ staffingState(item.status) }}</span> ·
              Clearance:
              {{ staffingState(item.clearanceStatus || item.clearance) }}
            </p>
            <div class="actions">
              <button
                v-if="item.status === 'active'"
                class="secondary"
                :disabled="busy || !reason.trim()"
                @click="
                  command(
                    `/api/staffing/appointments/${item.id}/suspend`,
                    { reason },
                    'Appointment suspended; appointment-derived access removed.',
                  )
                "
              >
                Suspend appointment</button
              ><button
                v-if="item.status === 'suspended'"
                class="secondary"
                :disabled="busy"
                @click="
                  command(
                    `/api/staffing/appointments/${item.id}/resume`,
                    { reason },
                    'Appointment rechecked for activation.',
                  )
                "
              >
                Resume appointment</button
              ><button
                v-if="
                  !['ended', 'cancelled', 'not_cleared', 'expired'].includes(
                    item.status,
                  )
                "
                class="danger"
                :disabled="busy || !reason.trim()"
                @click="
                  command(
                    `/api/staffing/appointments/${item.id}/end`,
                    { reason },
                    'Appointment ended; independent course roles are preserved.',
                  )
                "
                :data-testid="`appointment-end-${item.id}`"
              >
                End appointment
              </button>
            </div>
          </article>
          <p
            v-if="!data.appointments?.length && !data.offers?.length"
            class="empty"
          >
            No offers or appointments yet.
          </p>
        </div>
      </section>
      <AiAssistance
        kind="candidate_fit"
        :target-id="id"
        title="Candidate Review Assistance"
      />
      <AiAssistance
        kind="opportunity_draft"
        :target-id="id"
        title="Requirement Draft Assistance"
      />
    </template>
    <StaffingPaging
      :cache-key="`staffing-opportunity-${id}`"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
