<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const id = String(useRoute().params.id);
const signedInUser = useAuthUser();
const staffingAccess = useStaffingCapabilities();
const { data, error, refresh } = await useStaffingPagedRecord(
  `application-${id}`,
  `/api/staffing/applications/${id}`,
);
if ([403, 404].includes((error.value as any)?.statusCode))
  await navigateWithContext("/courses", { replace: true });
const application = computed(() => data.value?.application);
const opportunity = computed(() => data.value?.opportunity);
const offer = computed(() => data.value?.offer);
const appointment = computed(() => data.value?.appointment);
const profileDefaults = {
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
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const profile = reactive(clone(profileDefaults));
const answers = reactive<Record<string, string>>(Object.create(null));
const formElement = ref<HTMLFormElement | null>(null);
const qualificationText = ref("");
const formVersion = ref(0);
const administrativeVersion = ref(0);
const correctionReason = ref("");
const administrativeDefaults = {
  dukeUniqueId: "",
  payrollBefore: false,
  hasSsn: false,
  citizenship: "",
  authorizationExpiry: "",
};
const administrative = reactive({ ...administrativeDefaults });
const selectedCv = ref<File | null>(null);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const qualificationBaseline = ref("");
const qualificationSource = ref("");
const administrativeBaseline = ref("");
const qualificationConflict = ref(false);
const administrativeConflict = ref(false);
const latestQualifications = shallowRef<any>();
const latestAdministrative = shallowRef<any>();
const qualifications = (record?: any) =>
  record
    ? {
        profile: { ...profileDefaults, ...clone(record.profile || {}) },
        answers: clone(record.answers || {}),
        qualificationText: record.qualificationText || "",
      }
    : {
        profile: { ...profile },
        answers: { ...answers },
        qualificationText: qualificationText.value,
      };
const qualificationSnapshot = (record: any) =>
  staffingSnapshot({
    ...qualifications(record),
    cvDocumentId: record.cvDocumentId || null,
  });
const administrativeSnapshot = (record: any) =>
  staffingSnapshot({
    ...administrativeDefaults,
    ...(record.administrative || {}),
  });
const qualificationDirty = computed(
  () =>
    staffingSnapshot(qualifications()) !== qualificationBaseline.value ||
    !!selectedCv.value,
);
const administrativeDirty = computed(
  () =>
    staffingSnapshot(administrative) !== administrativeBaseline.value ||
    !!correctionReason.value,
);
const currentCycle = computed(
  () => data.value?.currentCycle || staffingAccess.value?.currentCycle,
);
const canWithdraw = computed(
  () =>
    data.value?.owner &&
    application.value?.status !== "withdrawn" &&
    !(
      appointment.value?.acceptedAt &&
      !["ended", "cancelled", "not_cleared", "expired"].includes(
        appointment.value.status,
      )
    ),
);
const clearedDetails = computed(
  () =>
    appointment.value?.clearance === "cleared" ||
    ["active", "suspended"].includes(appointment.value?.status),
);
const canEditAdministrative = computed(
  () =>
    !!appointment.value &&
    (clearedDetails.value
      ? signedInUser.value?.isGlobalAdmin
      : ["offered", "pending_clearance", "pending_start"].includes(
          appointment.value.status,
        )),
);
const editable = computed(
  () =>
    !!application.value &&
    !!currentCycle.value?.isOpen &&
    opportunity.value?.termId === currentCycle.value.termId &&
    opportunity.value?.status === "published" &&
    new Date(opportunity.value.appointmentEnd).getTime() > Date.now() &&
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
function loadQualifications(
  record = latestQualifications.value || application.value,
) {
  if (!record) return;
  formVersion.value = record.version;
  for (const key of Object.keys(answers)) delete answers[key];
  const saved = qualifications(record);
  Object.assign(profile, saved.profile);
  Object.assign(answers, saved.answers);
  qualificationText.value = saved.qualificationText;
  selectedCv.value = null;
  const fileInput =
    formElement.value?.querySelector<HTMLInputElement>('input[type="file"]');
  if (fileInput) fileInput.value = "";
  qualificationBaseline.value = staffingSnapshot(saved);
  qualificationSource.value = qualificationSnapshot(record);
  qualificationConflict.value = false;
}
function loadAdministrative(
  record = latestAdministrative.value || application.value,
) {
  if (!record) return;
  if (
    !latestAdministrative.value ||
    (latestAdministrative.value.administrativeVersion || 0) <=
      (record.administrativeVersion || 0)
  )
    latestAdministrative.value = clone(record);
  Object.assign(
    administrative,
    administrativeDefaults,
    clone(record.administrative || {}),
  );
  administrativeVersion.value = record.administrativeVersion || 0;
  administrativeBaseline.value = administrativeSnapshot(record);
  correctionReason.value = "";
  administrativeConflict.value = false;
}
function keepQualificationRevision(record: any) {
  if (
    !latestQualifications.value ||
    latestQualifications.value.version <= record.version
  )
    latestQualifications.value = clone(record);
  formVersion.value = record.version;
  qualificationBaseline.value = staffingSnapshot(qualifications(record));
  qualificationSource.value = qualificationSnapshot(record);
  qualificationConflict.value = false;
}
watch(
  [application, busy],
  ([record, saving]) => {
    if (!record || saving) return;
    if (
      record.version >=
      Math.max(formVersion.value, latestQualifications.value?.version || 0)
    ) {
      latestQualifications.value = clone(record);
      if (!formVersion.value || !qualificationDirty.value)
        loadQualifications(record);
      else if (qualificationSnapshot(record) === qualificationSource.value) {
        formVersion.value = record.version;
        qualificationConflict.value = false;
      } else qualificationConflict.value = true;
    }
    if (
      (record.administrativeVersion || 0) >=
      Math.max(
        administrativeVersion.value,
        latestAdministrative.value?.administrativeVersion || 0,
      )
    ) {
      latestAdministrative.value = clone(record);
      if (!administrativeBaseline.value || !administrativeDirty.value)
        loadAdministrative(record);
      else if (
        administrativeSnapshot(record) === administrativeBaseline.value
      ) {
        administrativeVersion.value = record.administrativeVersion || 0;
        administrativeConflict.value = false;
      } else administrativeConflict.value = true;
    }
  },
  { immediate: true },
);
async function save() {
  if (qualificationConflict.value) return null;
  const result = await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}`, {
        method: "PATCH",
        body: {
          expectedVersion: formVersion.value,
          profile: { ...profile },
          answers: { ...answers },
          qualificationText: qualificationText.value,
        },
      }),
    "Application saved.",
  );
  if (result) keepQualificationRevision(result.application);
  return result;
}
async function submit() {
  if (formElement.value && !formElement.value.reportValidity()) return;
  const saved = await save();
  if (!saved) return;
  const submitted = await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/submit`, {
        method: "POST",
        body: { expectedVersion: saved.application.version },
      }),
    "Application submitted.",
  );
  if (submitted) keepQualificationRevision(submitted.application);
}
async function upload() {
  if (!selectedCv.value || qualificationConflict.value) return;
  const form = new FormData();
  form.append("file", selectedCv.value);
  form.append("expectedVersion", String(formVersion.value));
  const result = await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/cv`, {
        method: "POST",
        body: form,
      }),
    "CV uploaded privately.",
  );
  if (result) {
    keepQualificationRevision(result.application);
    selectedCv.value = null;
  }
}
async function action(path: string, success: string) {
  const result = await run(
    () => staffingRequest(path, { method: "POST" }),
    success,
  );
  await refreshNuxtData("courses");
}
function fileChanged(event: Event) {
  selectedCv.value = (event.target as HTMLInputElement).files?.[0] || null;
}
async function saveAdministrative() {
  if (administrativeConflict.value) return;
  const result = await run(
    () =>
      staffingRequest(`/api/staffing/applications/${id}/administrative`, {
        method: "POST",
        body: {
          administrative: { ...administrative },
          expectedAdministrativeVersion: administrativeVersion.value,
          reason: correctionReason.value,
        },
      }),
    "Appointment details saved.",
  );
  if (result) {
    loadAdministrative(result.application);
  }
}
useIntervalRefresh((options) =>
  busy.value ? Promise.resolve() : refresh(options),
);
</script>
<template>
  <StaffingShell
    :title="opportunity?.title || 'Application'"
    :back-to="
      data?.canManage && !data?.owner
        ? `/staffing/${opportunity?.id}`
        : '/applications'
    "
    :back-label="
      data?.canManage && !data?.owner ? 'Candidates' : 'My applications'
    "
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
      <p
        v-if="qualificationConflict"
        class="notice"
        role="status"
        data-testid="application-conflict"
      >
        Application changed elsewhere. Your edits are kept.
      </p>
      <button
        v-if="qualificationDirty || qualificationConflict"
        type="button"
        class="secondary"
        :disabled="busy"
        @click="loadQualifications()"
        data-testid="application-discard"
      >
        Discard changes
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
            {{ opportunity?.type?.toUpperCase() }} appointment.
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
            Access begins after clearance and the appointment start date.
          </p>
          <NuxtLink
            v-if="
              appointment.type === 'ta' &&
              appointment.status === 'active' &&
              appointment.courseId
            "
            class="button"
            :to="`/courses/${appointment.courseId}/ta`"
            data-testid="appointment-workspace"
            >Open TA Queue</NuxtLink
          >
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
                  min="0"
                  max="40"
                  step="any"
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
            <label v-if="opportunity?.type === 'ta'" class="check"
              ><input v-model="profile.priorTaExperience" type="checkbox" />I
              have previous TA experience</label
            >
            <label
              v-if="opportunity?.type === 'ta' && profile.priorTaExperience"
              >Previous courses and departments<textarea
                v-model="profile.priorCourses"
                :required="profile.priorTaExperience"
                maxlength="2000"
              />
            </label>

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
              >{{
                opportunity?.type === "ra"
                  ? "Research experience"
                  : "Teaching experience"
              }}<textarea v-model="profile.experience" maxlength="4000" />
            </label>
            <fieldset v-if="opportunity?.requiredSlots?.length">
              <legend>Weekly schedule (Eastern Time)</legend>
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
                Confirm availability
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

            <label
              >CV (PDF or TXT, up to 2 MiB)<input
                type="file"
                accept="application/pdf,text/plain,.pdf,.txt"
                @change="fileChanged"
                data-testid="application-cv" /></label
            ><button
              type="button"
              class="secondary"
              :disabled="!selectedCv || busy || qualificationConflict"
              @click="upload"
              data-testid="application-cv-upload"
            >
              Upload CV
            </button>

            <label
              >Additional qualifications (optional)<textarea
                v-model="qualificationText"
                maxlength="20000"
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

          <div v-if="editable" class="actions">
            <button
              type="submit"
              :disabled="busy || qualificationConflict"
              data-testid="application-save"
            >
              Save draft</button
            ><button
              type="button"
              :disabled="busy || qualificationConflict"
              @click="submit"
              data-testid="application-submit"
            >
              Submit application
            </button>
          </div>
          <div v-if="canWithdraw" class="actions">
            <button
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
          <h2>Appointment Details</h2>
        </div>
        <form @submit.prevent="saveAdministrative" class="panel-body">
          <p
            v-if="administrativeConflict"
            class="notice"
            role="status"
            data-testid="administrative-conflict"
          >
            Administrative details changed elsewhere. Your edits are kept.
          </p>
          <button
            v-if="administrativeDirty || administrativeConflict"
            type="button"
            class="secondary"
            :disabled="busy"
            @click="loadAdministrative()"
            data-testid="administrative-discard"
          >
            Discard changes
          </button>
          <p class="notice">
            Only you and site administrators can view these details.
          </p>
          <fieldset :disabled="busy || !canEditAdministrative">
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
            >
            <label v-if="clearedDetails && signedInUser?.isGlobalAdmin"
              >Correction reason<input
                v-model="correctionReason"
                required
                maxlength="2000"
                data-testid="administrative-correction-reason"
            /></label>
            <button
              v-if="canEditAdministrative"
              :disabled="
                busy ||
                administrativeConflict ||
                (clearedDetails && !correctionReason.trim())
              "
              data-testid="administrative-save"
            >
              Save administrative details
            </button>
          </fieldset>
        </form>
        <details
          v-if="
            signedInUser?.isGlobalAdmin &&
            data.administrativeCorrections?.length
          "
          class="panel-body"
        >
          <summary>Recent administrative history</summary>
          <article
            v-for="entry in data.administrativeCorrections"
            :key="entry.id"
          >
            <p>
              {{ staffingDate(entry.createdAt) }} · {{ entry.actorEmail }} ·
              {{ entry.reason || "Details supplied" }}
            </p>
            <dl
              v-for="key in [
                'dukeUniqueId',
                'payrollBefore',
                'hasSsn',
                'citizenship',
                'authorizationExpiry',
              ]"
              :key="key"
            >
              <dt>{{ key }}</dt>
              <dd>
                {{ entry.before?.[key] ?? "Not supplied" }} →
                {{ entry.after?.[key] ?? "Not supplied" }}
              </dd>
            </dl>
          </article>
        </details>
      </section>
      <WorkloadRecorder
        v-if="
          appointment?.status === 'active' &&
          appointment.type === 'ta' &&
          data.owner
        "
        :appointment-id="appointment.id"
      />
      <AiAssistance
        v-if="data.canManage"
        kind="cv_summary"
        :target-id="id"
        :can-analyze="
          !!currentCycle?.canReview &&
          opportunity?.termId === currentCycle.termId &&
          new Date(opportunity.appointmentEnd).getTime() > Date.now() &&
          ['published', 'applications_closed', 'filled'].includes(
            opportunity.status,
          )
        "
        title="Qualification Summary Assistance"
      />
    </template>
  </StaffingShell>
</template>
