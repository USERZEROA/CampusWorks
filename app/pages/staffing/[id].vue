<script setup lang="ts">
const id = String(useRoute().params.id);
const app = useNuxtApp();
const access = useStaffingCapabilities();
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useStaffingPagedRecord(
  `staffing-opportunity-${id}`,
  `/api/staffing/opportunities/${id}`,
);
const opportunity = computed(() => data.value?.opportunity);
if (data.value && !data.value.canManage)
  await app.runWithContext(() => navigateTo("/courses", { replace: true }));
if ([403, 404].includes((error.value as any)?.statusCode))
  await app.runWithContext(() => navigateTo("/courses", { replace: true }));
watch(
  () => data.value?.canManage,
  (allowed) => {
    if (allowed === false)
      app.runWithContext(() => navigateTo("/courses", { replace: true }));
  },
  { immediate: true },
);
const currentCycle = computed(
  () => data.value?.currentCycle || access.value?.currentCycle,
);
const canReview = computed(
  () =>
    currentCycle.value?.canReview &&
    opportunity.value?.canAnalyzeCandidates !== false &&
    opportunity.value?.termId === currentCycle.value.termId,
);
const canPublish = computed(
  () =>
    currentCycle.value?.isOpen &&
    opportunity.value?.termId === currentCycle.value.termId,
);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const keys = new Map<string, string>();
const reason = ref("");
const applications = computed(() => data.value?.applications || []);
const authorizedCandidateTargets = computed(() =>
  applications.value.map((application: any) => {
    const submitted = application.submittedSnapshot?.profile || {};
    return {
      id: application.id,
      label:
        [submitted.firstName, submitted.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        application.applicantName ||
        "",
    };
  }),
);
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
    "Offer sent.",
  );
  if (failure.value) await refresh();
}
async function command(path: string, body: any = {}, success = "Saved.") {
  if (path.startsWith(`/api/staffing/opportunities/${id}/`))
    body = { ...body, expectedVersion: opportunity.value.version };
  await run(() => staffingRequest(path, { method: "POST", body }), success);
}
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Opportunity Review'"
    back-to="/staffing"
    back-label="Recruitment"
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
    <template v-if="opportunity && data.canManage && !error">
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
              v-if="
                canPublish &&
                (opportunity.status || opportunity.state) === 'draft'
              "
              class="button secondary"
              :to="`/staffing/edit?id=${id}`"
              data-testid="opportunity-edit"
              >Edit draft requirements</NuxtLink
            ><button
              v-if="
                canPublish &&
                ['draft', 'applications_closed'].includes(
                  opportunity.status || opportunity.state,
                )
              "
              :disabled="busy"
              @click="
                command(
                  `/api/staffing/opportunities/${id}/publish`,
                  {},
                  'Publication requested.',
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
              v-if="opportunity.type === 'ta' && opportunity.courseId"
              class="button secondary"
              :to="`/courses/${opportunity.courseId}/review`"
              >Course review</NuxtLink
            >
            <button
              v-if="data.canCloseout"
              class="secondary"
              :disabled="busy"
              @click="
                command(
                  `/api/staffing/opportunities/${id}/archive`,
                  {},
                  'Opportunity archived.',
                )
              "
              data-testid="opportunity-archive"
            >
              Archive opportunity
            </button>
            <button
              v-if="data.canCloseout"
              class="danger"
              :disabled="busy"
              @click="
                command(
                  `/api/staffing/opportunities/${id}/cancel`,
                  {},
                  'Opportunity cancelled.',
                )
              "
              data-testid="opportunity-cancel"
            >
              Cancel opportunity
            </button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Applications and Availability</h2></div>
        <div class="panel-body">
          <div
            class="table-scroll"
            tabindex="0"
            role="region"
            aria-label="Applicant review table"
          >
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
                        ? "Unavailable for this term or overlapping appointment dates"
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
                    <div v-if="canReview" class="actions">
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
            <StaffingSettlement
              v-if="
                data.viewer?.isGlobalAdmin &&
                item.budgetStatus === 'awaiting_settlement'
              "
              :appointment="item"
              @saved="refresh"
            />
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
        v-if="data.canManage"
        kind="candidate_fit"
        :target-id="id"
        :authorized-targets="authorizedCandidateTargets"
        :can-analyze="!!canReview"
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
