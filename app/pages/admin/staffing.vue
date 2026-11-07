<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview(
  "staffing-administration",
);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const term = reactive({ name: "", startDate: "", endDate: "" });
const cycle = reactive({
  termId: "",
  opensAt: "",
  closesAt: "",
  enabled: true,
});
const cycleDirty = ref(false);
const cycleVersion = ref(0);
const cycleBaseline = ref("");
const cycleConflict = ref(false);
const latestCycle = shallowRef<any>();
const localDateTime = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const cycleSnapshot = (current: any) =>
  staffingSnapshot({
    termId: current?.termId || "",
    opensAt: current?.opensAt || null,
    closesAt: current?.closesAt || null,
    enabled: current?.enabled !== false,
  });
function loadCycle(current = latestCycle.value || data.value?.currentCycle) {
  if (latestCycle.value?.version > (current?.version || 0))
    current = latestCycle.value;
  if (current) latestCycle.value = { ...current };
  cycleVersion.value = current?.version || 0;
  cycle.termId = current?.termId || "";
  cycle.opensAt = localDateTime(current?.opensAt);
  cycle.closesAt = localDateTime(current?.closesAt);
  cycle.enabled = current?.enabled !== false;
  cycleBaseline.value = cycleSnapshot(current);
  cycleConflict.value = false;
  cycleDirty.value = false;
}
watch(
  [() => data.value?.currentCycle?.version, busy],
  () => {
    if (busy.value) return;
    const current = data.value?.currentCycle;
    if (
      !current ||
      current.version <
        Math.max(cycleVersion.value, latestCycle.value?.version || 0)
    )
      return;
    latestCycle.value = { ...current };
    if (!cycleDirty.value) loadCycle(current);
    else if (cycleSnapshot(data.value?.currentCycle) === cycleBaseline.value) {
      cycleVersion.value = data.value?.currentCycle?.version || 0;
      cycleConflict.value = false;
    } else cycleConflict.value = true;
  },
  { immediate: true },
);
async function saveCycle() {
  if (cycleConflict.value) return;
  const result = await run(
    () =>
      staffingRequest("/api/staffing/cycle", {
        method: "PUT",
        body: {
          expectedVersion: cycleVersion.value,
          termId: cycle.termId,
          opensAt: new Date(cycle.opensAt).toISOString(),
          closesAt: new Date(cycle.closesAt).toISOString(),
          enabled: cycle.enabled,
        },
      }),
    "Recruitment schedule saved.",
  );
  if (result) {
    loadCycle(result.currentCycle);
  }
}
const clearance = reactive<Record<string, string>>({});
const reason = ref("");
const pending = computed(() => data.value?.admin?.pendingOpportunities || []);
const appointments = computed(
  () => data.value?.admin?.appointments || data.value?.adminAppointments || [],
);
const summary = computed(() =>
  [
    {
      label: "Publication approvals",
      value: data.value?.pagination?.totals?.pendingOpportunities,
    },
    {
      label: "Appointment records",
      value: data.value?.pagination?.totals?.adminAppointments,
    },
    { label: "Semesters", value: data.value?.pagination?.totals?.terms },
  ].filter((item) => Number.isFinite(item.value)),
);
async function createTerm() {
  await run(
    () =>
      staffingRequest("/api/staffing/terms", {
        method: "POST",
        body: {
          name: term.name,
          startDate: new Date(term.startDate).toISOString(),
          endDate: new Date(term.endDate).toISOString(),
        },
      }),
    "Term created.",
  );
}
async function approve(item: any, approved: boolean) {
  await run(
    () =>
      staffingRequest(`/api/staffing/opportunities/${item.id}/approve`, {
        method: "POST",
        body: { approved, reason: reason.value, expectedVersion: item.version },
      }),
    approved
      ? "Opportunity approved and published."
      : "Opportunity returned to draft.",
  );
}
async function decide(item: any) {
  await run(
    () =>
      staffingRequest(`/api/staffing/appointments/${item.id}/clearance`, {
        method: "POST",
        body: { status: clearance[item.id] || "cleared", reason: reason.value },
      }),
    "Clearance recorded and appointment activation rechecked.",
  );
}
useIntervalRefresh((options) =>
  busy.value ? Promise.resolve() : refresh(options),
);
</script>
<template>
  <StaffingShell title="Recruitment Settings">
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load staffing administration.") }}
    </p>
    <p
      v-if="message"
      class="notice"
      :class="{ error: failure, success: !failure }"
      role="status"
      data-testid="admin-staffing-notice"
    >
      {{ message }}
    </p>
    <StaffingSummary
      v-if="data && !error"
      :items="summary"
      label="Administration overview"
    />
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Current Recruitment Cycle</h2></div>
      <form
        @submit.prevent="saveCycle"
        @input="cycleDirty = true"
        @change="cycleDirty = true"
        class="panel-body"
        :aria-busy="busy"
      >
        <p
          v-if="cycleConflict"
          class="notice"
          role="status"
          data-testid="cycle-conflict"
        >
          Schedule changed elsewhere. Your edits are kept.
        </p>
        <div class="grid">
          <label
            >Semester<select
              v-model="cycle.termId"
              required
              data-testid="cycle-term"
            >
              <option value="">Choose a semester</option>
              <option
                v-for="item in data?.terms || []"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select></label
          >
          <label
            >Applications open<input
              v-model="cycle.opensAt"
              type="datetime-local"
              required
              data-testid="cycle-open"
          /></label>
          <label
            >Applications close<input
              v-model="cycle.closesAt"
              type="datetime-local"
              required
              data-testid="cycle-close"
          /></label>
        </div>
        <label class="check"
          ><input
            v-model="cycle.enabled"
            type="checkbox"
            data-testid="cycle-enabled"
          />Enable this cycle</label
        >
        <button :disabled="busy || cycleConflict" data-testid="cycle-save">
          Save schedule
        </button>
        <button
          v-if="cycleDirty"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="
            cycleDirty = false;
            loadCycle();
          "
          data-testid="cycle-reset"
        >
          Discard changes
        </button>
      </form>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Semesters</h2></div>
      <div class="panel-body">
        <form @submit.prevent="createTerm" :aria-busy="busy">
          <div class="grid">
            <label
              >Semester name<input
                v-model="term.name"
                required
                maxlength="100"
                data-testid="term-name" /></label
            ><label
              >Semester starts<input
                v-model="term.startDate"
                type="datetime-local"
                required
                data-testid="term-start" /></label
            ><label
              >Semester ends<input
                v-model="term.endDate"
                type="datetime-local"
                required
                data-testid="term-end"
            /></label>
          </div>
          <button type="submit" :disabled="busy" data-testid="term-create">
            Add semester
          </button>
        </form>
        <ul class="semester-list">
          <li v-for="item in data?.terms || []" :key="item.id">
            <div>
              <strong>{{ item.name }}</strong
              ><span class="record-meta"
                >{{ staffingDate(item.startDate) }} –
                {{ staffingDate(item.endDate) }}</span
              >
            </div>
            <StaffingStatus
              v-if="item.id === data?.currentCycle?.termId"
              state="active"
              label="Current"
            />
          </li>
        </ul>
      </div>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Publication Approvals</h2></div>
      <div class="panel-body">
        <label
          >Administrative decision reason<input
            v-model="reason"
            maxlength="1000"
            data-testid="admin-staffing-reason"
        /></label>
        <div class="card-list">
          <article
            v-for="item in pending"
            :key="item.id"
            class="opportunity-card"
          >
            <div class="card-heading">
              <span class="type-tag">{{ item.type?.toUpperCase() }}</span
              ><StaffingStatus :state="item.status || item.state" />
            </div>
            <h3 class="record-title">{{ item.title }}</h3>
            <p>
              {{ item.type?.toUpperCase() }} · {{ item.positions }} position(s)
              · {{ item.weeklyHours }} hours/week · Budget {{ item.budget }}
            </p>
            <p>{{ item.description }}</p>
            <div class="actions">
              <NuxtLink :to="`/staffing/${item.id}`"
                >Inspect requirements</NuxtLink
              ><button
                :disabled="busy"
                @click="approve(item, true)"
                :data-testid="`approve-opportunity-${item.id}`"
              >
                Approve and publish</button
              ><button
                class="secondary"
                :disabled="busy || !reason.trim()"
                @click="approve(item, false)"
              >
                Return to draft
              </button>
            </div>
          </article>
        </div>
        <p v-if="!pending.length" class="empty">
          No opportunities await approval.
        </p>
      </div>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Appointment Clearance</h2></div>
      <div class="panel-body card-list">
        <article
          v-for="item in appointments"
          :key="item.id"
          class="opportunity-card"
          :data-testid="`admin-appointment-${item.id}`"
        >
          <h3 class="record-title">
            {{ item.applicantEmail || item.userEmail || item.studentEmail }} ·
            {{ item.type?.toUpperCase() }}
          </h3>
          <p>
            Status: <StaffingStatus :state="item.status" /> · Clearance:
            <StaffingStatus :state="item.clearanceStatus || item.clearance" />
          </p>
          <p>
            {{ staffingDate(item.startDate || item.appointmentStart) }} –
            {{ staffingDate(item.endDate || item.appointmentEnd) }}
          </p>
          <NuxtLink :to="`/applications/${item.applicationId}`"
            >Appointment details</NuxtLink
          >
          <StaffingSettlement
            v-if="item.budgetStatus === 'awaiting_settlement'"
            :appointment="item"
            @saved="refresh"
          />
          <div
            v-if="
              !['ended', 'cancelled', 'not_cleared', 'expired'].includes(
                item.status,
              ) && ['pending_clearance', 'pending_start'].includes(item.status)
            "
            class="grid"
          >
            <label
              >Clearance decision<select
                v-model="clearance[item.id]"
                :data-testid="`clearance-status-${item.id}`"
              >
                <option :value="undefined">Cleared</option>
                <option value="cleared">Cleared</option>
                <option value="needs_information">Needs information</option>
                <option value="not_cleared">Not cleared</option>
              </select></label
            ><button
              :disabled="
                busy || (clearance[item.id] === 'not_cleared' && !reason.trim())
              "
              @click="decide(item)"
              :data-testid="`clearance-${item.id}`"
            >
              Record clearance
            </button>
          </div>
        </article>
        <p v-if="!appointments.length" class="empty">No appointments yet.</p>
      </div>
    </section>
    <StaffingPaging
      cache-key="staffing-administration"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
