<script setup lang="ts">
const props = defineProps<{ opportunityId?: string }>();
const nuxtApp = useNuxtApp();
const currentUser = useAuthUser();
const authError = useAuthError();
const requestFetch = useRequestFetch();
const { data, error } = await useStaffingOverview("staffing-create");
const { busy, message, failure, run } = useStaffingMutation();
const form = reactive({
  title: "",
  type: "ta",
  courseId: "",
  department: "Computer Science",
  description: "",
  positions: 1,
  weeklyHours: 10,
  requiresAttendance: false,
  hasLab: false,
  hasDiscussion: false,
  requiresGrading: false,
  holdsOfficeHours: true,
  requiredSkills: "",
  preferredSkills: "",
  cvRequired: true,
  hourlyRate: 20,
  budget: 10000,
  approvalRequired: true,
  allowedPositionPreferences: ["full", "half", "either", "other"],
  duties: [{ kind: "office_hours", sessionsPerWeek: 1, minutesPerSession: 60 }],
  questions: [] as Array<{ id: string; prompt: string; required: boolean }>,
  requiredSlots: [] as Array<{ day: number; start: string; end: string }>,
});
const courses = computed(() =>
  (data.value?.courses || []).filter(
    (c: any) =>
      data.value?.viewer?.isGlobalAdmin ||
      ["instructor", "admin"].includes(c.role || c.primaryRole),
  ),
);
if (!props.opportunityId && !courses.value.length) {
  form.type = "ra";
  form.holdsOfficeHours = false;
  form.duties = [
    { kind: "research", sessionsPerWeek: 1, minutesPerSession: 60 },
  ];
}
const originalVersion = ref<number | undefined>();
const draftEditable = ref(!props.opportunityId);
const editorError = ref("");
if (props.opportunityId) {
  try {
    const current = await requestFetch<any>(
      `/api/staffing/opportunities/${props.opportunityId}`,
    );
    draftEditable.value =
      !!current.canManage &&
      current.opportunity?.status === "draft" &&
      current.opportunity.termId === data.value?.currentCycle?.termId &&
      data.value?.currentCycle?.isOpen;
    if (!draftEditable.value)
      await nuxtApp.runWithContext(() =>
        navigateTo(
          current.canManage ? `/staffing/${props.opportunityId}` : "/courses",
          { replace: true },
        ),
      );
    const item = current.opportunity;
    if (draftEditable.value) {
      for (const key of Object.keys(form))
        if (key in item) (form as any)[key] = item[key];
      originalVersion.value = item.version;
    }
  } catch (error: any) {
    draftEditable.value = false;
    editorError.value = apiErrorMessage(
      error,
      "This opportunity draft is unavailable.",
    );
    if ([403, 404].includes(error?.statusCode || error?.response?.status))
      await nuxtApp.runWithContext(() =>
        navigateTo("/courses", { replace: true }),
      );
    if ((error?.statusCode || error?.response?.status) === 401) {
      currentUser.value = null;
      authError.value = "Your session expired. Please sign in again.";
      await nuxtApp.runWithContext(() =>
        navigateTo("/login", { replace: true }),
      );
    }
  }
}
watch(
  () => form.type,
  (type) => {
    if (type === "ra") {
      form.requiresGrading = false;
      form.hasDiscussion = false;
      form.hasLab = false;
      form.holdsOfficeHours = false;
      form.duties = form.duties.map((duty) =>
        ["lab", "discussion", "grading", "office_hours"].includes(duty.kind)
          ? { ...duty, kind: "research" }
          : duty,
      );
    } else {
      form.holdsOfficeHours = true;
      form.duties = form.duties.map((duty) =>
        duty.kind === "research" ? { ...duty, kind: "office_hours" } : duty,
      );
    }
  },
);
if (!props.opportunityId && !data.value?.currentCycle?.isOpen)
  await nuxtApp.runWithContext(() =>
    navigateTo("/staffing", { replace: true }),
  );
async function save() {
  const result = await run(
    () =>
      staffingRequest<any>(
        props.opportunityId
          ? `/api/staffing/opportunities/${props.opportunityId}`
          : "/api/staffing/opportunities",
        {
          method: props.opportunityId ? "PATCH" : "POST",
          body: {
            ...form,
            expectedVersion: originalVersion.value,
            courseId: form.type === "ta" ? form.courseId : undefined,
          },
        },
      ),
    "Opportunity draft created.",
  );
  if (result?.opportunity)
    await nuxtApp.runWithContext(() =>
      navigateTo(`/staffing/${result.opportunity.id}`),
    );
}
function addQuestion() {
  form.questions.push({
    id: `question-${Date.now()}-${form.questions.length}`,
    prompt: "",
    required: true,
  });
}
</script>
<template>
  <StaffingShell
    :title="
      props.opportunityId ? 'Edit Opportunity Draft' : 'Create Opportunity'
    "
    back-to="/staffing"
    back-label="Recruitment"
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load staffing configuration.") }}
    </p>
    <p v-if="message" class="notice" :class="{ error: failure }" role="status">
      {{ message }}
    </p>
    <p v-if="editorError" class="notice error" role="alert">
      {{ editorError }}
    </p>
    <p v-if="data?.currentCycle?.termName" class="muted">
      {{ data.currentCycle.termName }} ·
      {{ staffingDate(data.currentCycle.startDate) }} –
      {{ staffingDate(data.currentCycle.endDate) }}
    </p>
    <form
      v-if="
        data?.viewer?.canManageStaffing &&
        draftEditable &&
        !error &&
        !editorError
      "
      @submit.prevent="save"
      class="panel"
      :aria-busy="busy"
    >
      <div class="panel-heading"><h2>Opportunity Details</h2></div>
      <div class="panel-body">
        <fieldset :disabled="busy">
          <legend>Scope and schedule</legend>
          <div class="grid">
            <label
              >Title<input
                v-model="form.title"
                required
                maxlength="160"
                data-testid="opportunity-title"
            /></label>
            <label
              >Appointment type<select
                v-model="form.type"
                data-testid="opportunity-type"
              >
                <option v-if="courses.length" value="ta">
                  Teaching Assistant
                </option>
                <option value="ra">Research Assistant</option>
              </select></label
            >
            <label v-if="form.type === 'ta'"
              >Course offering<select
                v-model="form.courseId"
                required
                data-testid="opportunity-course"
              >
                <option value="">Choose a course</option>
                <option
                  v-for="course in courses"
                  :key="course.id"
                  :value="course.id"
                >
                  {{ course.code }} — {{ course.title }}
                </option>
              </select></label
            >
            <label
              >Department<input
                v-model="form.department"
                required
                maxlength="120" /></label
            ><label
              >Positions<input
                v-model.number="form.positions"
                type="number"
                min="1"
                max="100"
                required
                data-testid="opportunity-positions"
            /></label>
            <label
              >Weekly hours<input
                v-model.number="form.weeklyHours"
                type="number"
                min="1"
                max="40"
                required
                data-testid="opportunity-hours"
            /></label>
          </div>
          <label
            >Description<textarea
              v-model="form.description"
              required
              maxlength="6000"
              data-testid="opportunity-description"
            />
          </label>
        </fieldset>
        <fieldset :disabled="busy">
          <legend>Weekly work expectations</legend>
          <div v-if="form.type === 'ta'" class="grid">
            <label class="check"
              ><input
                v-model="form.requiresAttendance"
                type="checkbox"
              />Attendance required</label
            ><label class="check"
              ><input v-model="form.hasLab" type="checkbox" />Lab
              responsibilities</label
            ><label class="check"
              ><input v-model="form.hasDiscussion" type="checkbox" />Discussion
              sections</label
            ><label class="check"
              ><input
                v-model="form.requiresGrading"
                type="checkbox"
              />Assignment or exam grading</label
            ><label class="check"
              ><input v-model="form.holdsOfficeHours" type="checkbox" />Hold
              office hours</label
            >
          </div>
          <div v-for="(duty, index) in form.duties" :key="index" class="grid">
            <label
              >Duty {{ index + 1
              }}<select v-model="duty.kind">
                <option value="attendance">Attendance</option>
                <option v-if="form.type === 'ta'" value="lab">Lab</option>
                <option v-if="form.type === 'ta'" value="discussion">
                  Discussion
                </option>
                <option v-if="form.type === 'ta'" value="grading">
                  Grading
                </option>
                <option v-if="form.type === 'ta'" value="office_hours">
                  Office hours
                </option>
                <option value="preparation">Preparation</option>
                <option v-if="form.type === 'ra'" value="research">
                  Research
                </option>
              </select></label
            ><label
              >Sessions per week<input
                v-model.number="duty.sessionsPerWeek"
                type="number"
                min="0"
                max="30"
                required /></label
            ><label
              >Minutes per session<input
                v-model.number="duty.minutesPerSession"
                type="number"
                min="0"
                max="600"
                required /></label
            ><button
              type="button"
              class="danger"
              @click="form.duties.splice(index, 1)"
              :aria-label="`Remove duty ${index + 1}`"
            >
              Remove duty
            </button>
          </div>
          <button
            type="button"
            class="secondary"
            @click="
              form.duties.push({
                kind: 'preparation',
                sessionsPerWeek: 1,
                minutesPerSession: 60,
              })
            "
          >
            Add weekly duty
          </button>
          <h3>Weekly schedule (Eastern Time)</h3>
          <div
            v-for="(slot, index) in form.requiredSlots"
            :key="index"
            class="grid"
          >
            <label
              >Day<select v-model.number="slot.day">
                <option
                  v-for="(day, n) in [
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ]"
                  :key="day"
                  :value="n"
                >
                  {{ day }}
                </option>
              </select></label
            ><label
              >Start time<input
                v-model="slot.start"
                type="time"
                required /></label
            ><label
              >End time<input v-model="slot.end" type="time" required /></label
            ><button
              type="button"
              class="danger"
              @click="form.requiredSlots.splice(index, 1)"
            >
              Remove schedule slot
            </button>
          </div>
          <button
            type="button"
            class="secondary"
            @click="
              form.requiredSlots.push({ day: 1, start: '09:00', end: '10:00' })
            "
          >
            Add required schedule slot
          </button>
        </fieldset>
        <fieldset :disabled="busy">
          <legend>Qualifications and application</legend>
          <label
            >Required skills<textarea
              v-model="form.requiredSkills"
              required
              maxlength="3000"
              data-testid="opportunity-required-skills"
            /></label
          ><label
            >Preferred skills<textarea
              v-model="form.preferredSkills"
              maxlength="3000"
            /></label
          ><label class="check"
            ><input v-model="form.cvRequired" type="checkbox" />Require a
            CV</label
          >
          <div v-for="(question, index) in form.questions" :key="question.id">
            <label
              >Question {{ index + 1
              }}<input
                v-model="question.prompt"
                required
                maxlength="1000" /></label
            ><label class="check"
              ><input v-model="question.required" type="checkbox" />Answer
              required</label
            ><button
              type="button"
              class="danger"
              @click="form.questions.splice(index, 1)"
            >
              Remove question {{ index + 1 }}
            </button>
          </div>
          <button
            type="button"
            class="secondary"
            @click="addQuestion"
            data-testid="opportunity-add-question"
          >
            Add screening question
          </button>
        </fieldset>
        <fieldset :disabled="busy">
          <legend>Budget and approval</legend>
          <div class="grid">
            <label
              >Hourly rate<input
                v-model.number="form.hourlyRate"
                type="number"
                min="0"
                step="0.01"
                required
                data-testid="opportunity-rate" /></label
            ><label
              >Total approved budget<input
                v-model.number="form.budget"
                type="number"
                min="0"
                step="0.01"
                required
                data-testid="opportunity-budget"
            /></label>
          </div>
        </fieldset>
        <button type="submit" :disabled="busy" data-testid="opportunity-save">
          {{
            busy
              ? "Saving…"
              : props.opportunityId
                ? "Save changes"
                : "Save opportunity draft"
          }}
        </button>
      </div>
    </form>
    <StaffingPaging
      cache-key="staffing-create"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
