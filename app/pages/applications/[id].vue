<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const id = String(useRoute().params.id);
const signedInUser = useAuthUser();
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useAsyncData<any>(
  `application-${id}`,
  () => requestFetch(`/api/staffing/applications/${id}`),
);
guardStaffingAccess(data, error);
const application = computed(() => data.value?.application);
const opportunity = computed(() => data.value?.opportunity);
const offer = computed(() => data.value?.offer);
const appointment = computed(() => data.value?.appointment);
const profile = reactive({
  firstName: "",
  lastName: "",
  preferredEmail: capturedUser.value?.email || "",
  undergraduateMajors: "",
  department: "Computer Science",
  positionPreference: "either",
  priorTaExperience: false,
  priorCourses: "",
  multipleCourses: false,
  graduationTerm: "",
  availableHours: 0,
  availability: "",
  skills: "",
  experience: "",
  slots: [] as any[],
});
const answers = reactive<Record<string, string>>(Object.create(null));
const formElement = ref<HTMLFormElement | null>(null);
const qualificationText = ref("");
const administrative = reactive({
  dukeUniqueId: "",
  payrollBefore: false,
  hasSsn: false,
  citizenship: "",
  authorizationExpiry: "",
});
const selectedCv = ref<File | null>(null);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const editable = computed(
  () =>
    !!application.value &&
    [
      "draft",
      "submitted",
      "under_review",
      "shortlisted",
      "withdrawn",
      "not_selected",
    ].includes(application.value.status) &&
    data.value?.owner &&
    !["issued", "accepted"].includes(offer.value?.status),
);
function loadDraft() {
  for (const key of Object.keys(answers)) delete answers[key];
  Object.assign(profile, application.value?.profile || {});
  Object.assign(answers, application.value?.answers || {});
  qualificationText.value = application.value?.qualificationText || "";
  Object.assign(administrative, application.value?.administrative || {});
}
loadDraft();
async function save() {
  return run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}`, {
        method: "PATCH",
        body: {
          expectedVersion: application.value.version,
          profile: { ...profile },
          answers: { ...answers },
          qualificationText: qualificationText.value,
        },
      }),
    "Application saved.",
  );
}
async function submit() {
  if (formElement.value && !formElement.value.reportValidity()) return;
  if (!(await save())) return;
  await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/submit`, {
        method: "POST",
        body: { expectedVersion: application.value.version },
      }),
    "Application submitted. Your submitted answers and CV version are recorded.",
  );
}
async function upload() {
  if (!selectedCv.value) return;
  const form = new FormData();
  form.append("file", selectedCv.value);
  form.append("expectedVersion", String(application.value.version));
  await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/cv`, {
        method: "POST",
        body: form,
      }),
    "CV uploaded privately.",
  );
}
async function action(path: string, success: string) {
  await run(() => staffingRequest(path, { method: "POST" }), success);
  await refreshNuxtData("courses");
}
function fileChanged(event: Event) {
  selectedCv.value = (event.target as HTMLInputElement).files?.[0] || null;
}
async function saveAdministrative() {
  await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/administrative`, {
        method: "POST",
        body: {
          administrative: { ...administrative },
          expectedAdministrativeVersion:
            application.value.administrativeVersion || 0,
        },
      }),
    "Restricted administrative details saved separately from your submitted qualifications.",
  );
}
async function reloadApplication() {
  const result = await run(
    async () => ({ ok: true }),
    "The current application version is loaded. Unsaved local changes were replaced.",
  );
  if (result) loadDraft();
}
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Application'"
    subtitle="Your application and appointment status are private to you and authorized reviewers."
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to open this application.") }}
    </p>
    <p
      v-if="message"
      class="notice"
      :class="{ error: failure, success: !failure }"
      role="status"
      data-testid="application-notice"
    >
      {{ message }}
    </p>
    <template v-if="application && !error">
      <p class="muted">
        If another browser changes this application, refresh before saving.
        Refresh replaces unsaved local answers.
      </p>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="reloadApplication"
        data-testid="application-refresh"
      >
        Refresh current application
      </button>
      <p>
        <span class="status" data-testid="application-status">{{
          staffingState(application.status)
        }}</span>
      </p>
      <section v-if="offer" class="panel" data-testid="offer-panel">
        <div class="panel-heading"><h2>Offer</h2></div>
        <div class="panel-body">
          <p>
            <strong>Status:</strong> {{ staffingState(offer.status) }} ·
            <strong>Respond by:</strong>
            {{ staffingDate(offer.expiresAt || offer.responseDeadline) }}
          </p>
          <p>
            {{ opportunity?.weeklyHours }} hours/week,
            {{ staffingDate(opportunity?.appointmentStart) }} –
            {{ staffingDate(opportunity?.appointmentEnd) }}.
            {{ opportunity?.type?.toUpperCase() }} appointment for
            {{ opportunity?.courseId || opportunity?.projectId }}.
          </p>
          <p>
            Acceptance confirms these published duties. Staff access follows the
            required clearance and start date.
          </p>
          <div v-if="offer.status === 'issued' && data.owner" class="actions">
            <button
              :disabled="busy"
              @click="
                action(
                  `/api/staffing/offers/${offer.id}/accept`,
                  'Offer accepted. Your appointment is checked for activation.',
                )
              "
              data-testid="offer-accept"
            >
              Accept offer</button
            ><button
              class="danger"
              :disabled="busy"
              @click="
                action(
                  `/api/staffing/offers/${offer.id}/decline`,
                  'Offer declined; your term allocation has been released.',
                )
              "
              data-testid="offer-decline"
            >
              Decline offer
            </button>
          </div>
        </div>
      </section>
      <section v-if="appointment" class="panel">
        <div class="panel-heading"><h2>Appointment</h2></div>
        <div class="panel-body">
          <p>
            <span class="status" data-testid="appointment-status">{{
              staffingState(appointment.status)
            }}</span>
            · Clearance:
            {{
              staffingState(
                appointment.clearanceStatus || appointment.clearance,
              )
            }}
          </p>
          <p v-if="appointment.status !== 'active'" class="notice">
            Access remains unavailable until all appointment conditions hold.
            Pending clearance or a future start date does not grant queue
            permissions.
          </p>
          <NuxtLink
            v-if="appointment.status === 'active' && appointment.courseId"
            class="button"
            :to="`/courses/${appointment.courseId}/ta`"
            data-testid="appointment-workspace"
            >Open TA Queue</NuxtLink
          >
          <NuxtLink
            v-if="appointment.status === 'active' && appointment.projectId"
            class="button"
            :to="`/projects/${appointment.projectId}`"
            data-testid="appointment-workspace"
            >Open Research Workspace</NuxtLink
          >
          <button class="secondary" :disabled="busy" @click="refresh()">
            Refresh appointment status
          </button>
        </div>
      </section>
      <form
        ref="formElement"
        novalidate
        @submit.prevent="save"
        :aria-busy="busy"
        class="panel"
      >
        <div class="panel-heading"><h2>Application Information</h2></div>
        <div class="panel-body">
          <p v-if="data.canManage && !data.owner" class="notice">
            Reviewer view. Applicant answers cannot be edited here. Restricted
            administrative fields are excluded.
          </p>
          <fieldset :disabled="!editable || busy">
            <legend>Personal and academic background</legend>
            <div class="grid">
              <label
                >First name<input
                  v-model="profile.firstName"
                  required
                  maxlength="100"
                  autocomplete="given-name"
                  data-testid="app-first-name"
              /></label>
              <label
                >Last name<input
                  v-model="profile.lastName"
                  required
                  maxlength="100"
                  autocomplete="family-name"
                  data-testid="app-last-name"
              /></label>
              <label
                >Preferred email<input
                  v-model="profile.preferredEmail"
                  type="email"
                  required
                  autocomplete="email"
                  data-testid="app-email"
              /></label>
              <label
                >Undergraduate major(s)<input
                  v-model="profile.undergraduateMajors"
                  required
                  maxlength="500"
                  data-testid="app-majors"
              /></label>
              <label
                >Department<input
                  v-model="profile.department"
                  required
                  maxlength="200"
              /></label>
              <label
                >Position preference<select
                  v-model="profile.positionPreference"
                >
                  <option value="full">Full</option>
                  <option value="half">Half</option>
                  <option value="either">Either</option>
                  <option value="other">Other</option>
                </select></label
              >
              <label
                >Available hours per week<input
                  v-model.number="profile.availableHours"
                  type="number"
                  min="1"
                  max="40"
                  required
                  data-testid="app-available-hours"
              /></label>
              <label
                >Expected graduation term<input
                  v-model="profile.graduationTerm"
                  required
                  maxlength="100"
              /></label>
            </div>
            <label class="check"
              ><input v-model="profile.priorTaExperience" type="checkbox" />I
              have previous TA experience</label
            >
            <label v-if="profile.priorTaExperience"
              >Previous courses and departments<textarea
                v-model="profile.priorCourses"
                :required="profile.priorTaExperience"
                maxlength="2000"
              />
            </label>
            <label class="check"
              ><input v-model="profile.multipleCourses" type="checkbox" />I
              would be willing to assist more than one course if departmental
              policy permits</label
            >
            <p class="muted">
              Current allocation policy allows one held appointment per term,
              including half appointments, and prevents overlapping appointment
              dates across terms. This preference does not override those rules.
            </p>
            <label
              >Availability and scheduling constraints<textarea
                v-model="profile.availability"
                required
                maxlength="2000"
                data-testid="app-availability"
              />
            </label>
            <label
              >Relevant skills<textarea
                v-model="profile.skills"
                required
                maxlength="4000"
                data-testid="app-skills"
              />
            </label>
            <label
              >Teaching or research experience<textarea
                v-model="profile.experience"
                maxlength="4000"
              />
            </label>
            <fieldset v-if="opportunity?.requiredSlots?.length">
              <legend>
                Required weekly schedule (America/New_York campus time)
              </legend>
              <p
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
              </p>
              <button
                type="button"
                class="secondary"
                @click="
                  profile.slots = opportunity.requiredSlots.map(
                    (slot: any) => ({ ...slot }),
                  )
                "
              >
                Confirm I am available for all required slots
              </button>
              <p v-if="profile.slots.length" role="status">
                Schedule availability confirmed.
              </p>
            </fieldset>
          </fieldset>
          <fieldset
            v-if="opportunity?.questions?.length"
            :disabled="!editable || busy"
          >
            <legend>Opportunity Questions</legend>
            <label v-for="question in opportunity.questions" :key="question.id"
              >{{ question.prompt }}
              {{ question.required ? "(required)" : "(optional)"
              }}<textarea
                v-model="answers[question.id]"
                :required="question.required"
                maxlength="5000"
                :data-testid="`app-answer-${question.id}`"
              />
            </label>
          </fieldset>
          <fieldset :disabled="!editable || busy">
            <legend>CV and qualification material</legend>
            <p>
              Upload a PDF or plain-text CV, maximum 2 MiB. Files are private
              and may be downloaded only by you and authorized reviewers. Do not
              include an SSN or confidential third-party material.
            </p>
            <label
              >CV file<input
                type="file"
                accept="application/pdf,text/plain,.pdf,.txt"
                @change="fileChanged"
                data-testid="application-cv" /></label
            ><button
              type="button"
              class="secondary"
              :disabled="!selectedCv || busy"
              @click="upload"
              data-testid="application-cv-upload"
            >
              Upload CV
            </button>
            <p class="muted">
              PDF files are stored as private attachments. This version does not
              extract their text; provide optional qualification text below when
              you want it included in a future AI review.
            </p>
            <label
              >Qualification text for review or future AI assistance<textarea
                v-model="qualificationText"
                maxlength="20000"
                placeholder="Optional accessible text version of your qualifications; do not invent or add private administrative details."
              />
            </label>
          </fieldset>
          <p
            v-if="
              application.cv ||
              application.documentId ||
              application.cvDocumentId
            "
          >
            CV on file.
            <a
              :href="`/api/staffing/documents/${application.cv?.id || application.cvDocumentId || application.documentId}`"
              data-testid="application-cv-download"
              >Download submitted CV</a
            >
          </p>
          <p class="muted">
            Payroll, SSN and immigration information are not qualification
            signals. Any required administrative eligibility check is handled
            separately by authorized administrators.
          </p>
          <div v-if="editable" class="actions">
            <button
              type="submit"
              :disabled="busy"
              data-testid="application-save"
            >
              Save draft</button
            ><button
              type="button"
              :disabled="busy"
              @click="submit"
              data-testid="application-submit"
            >
              Submit application</button
            ><button
              v-if="application.status !== 'draft'"
              type="button"
              class="danger"
              :disabled="busy"
              @click="
                action(
                  `/api/staffing/applications/${id}/withdraw`,
                  'Application withdrawn.',
                )
              "
              data-testid="application-withdraw"
            >
              Withdraw application
            </button>
          </div>
        </div>
      </form>
      <section
        v-if="offer && (data.owner || signedInUser?.isGlobalAdmin)"
        class="panel"
      >
        <div class="panel-heading">
          <h2>Restricted Appointment Administration</h2>
        </div>
        <form @submit.prevent="saveAdministrative" class="panel-body">
          <p class="notice">
            These optional processing details are shared only with you and site
            administrators. Course reviewers and AI qualification assistance do
            not receive them. Do not enter an SSN number or upload identity
            documents.
          </p>
          <fieldset
            :disabled="
              busy ||
              appointment?.status === 'active' ||
              (appointment?.clearance || appointment?.clearanceStatus) ===
                'cleared'
            "
          >
            <legend>Administrative details</legend>
            <div class="grid">
              <label
                >Duke unique ID<input
                  v-model="administrative.dukeUniqueId"
                  maxlength="64"
                  autocomplete="off"
                  data-testid="admin-duke-id" /></label
              ><label
                >Citizenship category<select
                  v-model="administrative.citizenship"
                >
                  <option value="">Not supplied</option>
                  <option value="US Citizen">US citizen</option>
                  <option value="Permanent Resident">Permanent resident</option>
                  <option value="Foreign National">Foreign national</option>
                </select></label
              ><label v-if="administrative.citizenship === 'Foreign National'"
                >Work authorization expires<input
                  v-model="administrative.authorizationExpiry"
                  type="date"
              /></label>
            </div>
            <label class="check"
              ><input v-model="administrative.payrollBefore" type="checkbox" />I
              have previously been on Duke payroll</label
            ><label class="check"
              ><input v-model="administrative.hasSsn" type="checkbox" />I have
              an SSN (status only; do not enter the number)</label
            ><button :disabled="busy" data-testid="administrative-save">
              Save administrative details
            </button>
          </fieldset>
        </form>
      </section>
      <WorkloadRecorder
        v-if="appointment?.status === 'active' && data.owner"
        :appointment-id="appointment.id"
      />
      <AiAssistance
        v-if="data.canManage"
        kind="cv_summary"
        :target-id="id"
        title="Qualification Summary Assistance"
      />
    </template>
  </StaffingShell>
</template>
