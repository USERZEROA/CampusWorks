<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview("my-applications");
const { busy, message, failure, run } = useStaffingMutation(refresh);
async function markRead(id: string) {
  await run(
    () =>
      staffingRequest(`/api/staffing/notifications/${id}/read`, {
        method: "POST",
      }),
    "Notification marked as read.",
  );
}
const notificationPath = (item: any) =>
  typeof item.path === "string" &&
  item.path.startsWith("/") &&
  !item.path.startsWith("//")
    ? item.path
    : "/applications";
const titleOf = (item: any) =>
  item.opportunityTitle ||
  item.title ||
  (data.value?.opportunities || []).find(
    (o: any) => o.id === item.opportunityId,
  )?.title ||
  item.opportunityId;
const state = ref("");
const applications = computed(() =>
  (data.value?.myApplications || []).filter(
    (item: any) => !state.value || (item.status || item.state) === state.value,
  ),
);
const summary = computed(() =>
  [
    {
      label: "Applications",
      value: data.value?.pagination?.totals?.myApplications,
    },
    {
      label: "Appointments",
      value: data.value?.pagination?.totals?.myAppointments,
    },
    {
      label: "Notifications",
      value: data.value?.pagination?.totals?.notifications,
    },
  ].filter((item) => Number.isFinite(item.value)),
);
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell title="My Applications">
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load your applications.") }}
    </p>
    <p v-if="message" class="notice" :class="{ error: failure }" role="status">
      {{ message }}
    </p>
    <StaffingSummary
      v-if="data && !error"
      :items="summary"
      label="Application overview"
    />
    <section v-if="!error" id="notifications" class="panel">
      <div class="panel-heading"><h2>Notifications</h2></div>
      <div
        class="panel-body notification-feed"
        tabindex="0"
        role="region"
        aria-label="Notifications"
      >
        <article
          v-for="item in data?.notifications || []"
          :key="item.id"
          class="notification-row"
          :class="{ 'is-unread': !item.read }"
          :data-testid="`notification-${item.id}`"
        >
          <div>
            <h3>
              <NuxtLink :to="notificationPath(item)">{{ item.title }}</NuxtLink>
            </h3>
            <p class="muted">
              {{ staffingDate(item.createdAt) }} ·
              {{ item.read ? "Read" : "Unread" }}
            </p>
          </div>
          <button
            v-if="!item.read"
            type="button"
            class="secondary"
            :disabled="busy"
            @click="markRead(item.id)"
          >
            Mark as read
          </button>
        </article>
        <p v-if="!data?.notifications?.length" class="empty">
          No notifications yet.
        </p>
      </div>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Applications</h2></div>
      <div v-if="data?.myApplications?.length" class="list-toolbar">
        <label
          >Application state<select
            v-model="state"
            data-testid="my-application-state"
          >
            <option value="">All states</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="selected">Selected</option>
            <option value="not_selected">Not selected</option>
            <option value="withdrawn">Withdrawn</option>
          </select></label
        >
      </div>
      <div
        class="panel-body table-scroll"
        tabindex="0"
        role="region"
        aria-label="My applications table"
      >
        <table v-if="applications.length">
          <thead>
            <tr>
              <th>Opportunity</th>
              <th>State</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in applications"
              :key="item.id"
              :data-testid="`application-row-${item.id}`"
            >
              <td>
                <span class="record-title">{{ titleOf(item) }}</span>
              </td>
              <td>
                <StaffingStatus :state="item.status || item.state" />
              </td>
              <td>{{ staffingDate(item.updatedAt) }}</td>
              <td>
                <NuxtLink :to="`/applications/${item.id}`"
                  >Open application</NuxtLink
                >
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="state" class="empty">No matching loaded applications.</p>
        <p v-else class="empty">
          You have no applications yet.
          <NuxtLink to="/opportunities">Browse opportunities</NuxtLink>.
        </p>
        <p
          v-if="
            state ||
            (data?.pagination?.totals?.myApplications || 0) >
              (data?.myApplications?.length || 0)
          "
          class="record-count"
          role="status"
        >
          {{ applications.length }} of
          {{ data?.myApplications?.length || 0 }} loaded applications
        </p>
      </div>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Appointments</h2></div>
      <div class="panel-body grid">
        <article
          v-for="item in data?.myAppointments || []"
          :key="item.id"
          class="opportunity-card"
          :data-testid="`my-appointment-${item.id}`"
        >
          <div class="card-heading">
            <span class="type-tag">{{ item.type?.toUpperCase() }}</span
            ><StaffingStatus :state="item.status || item.state" />
          </div>
          <h3 class="record-title">{{ titleOf(item) }}</h3>
          <p>
            {{ staffingDate(item.startDate || item.appointmentStart) }} –
            {{ staffingDate(item.endDate || item.appointmentEnd) }}
          </p>
          <NuxtLink
            v-if="
              item.type === 'ta' && item.status === 'active' && item.courseId
            "
            class="button"
            :to="`/courses/${item.courseId}/ta`"
            data-testid="appointment-workspace"
            >Open TA Queue</NuxtLink
          >
        </article>
        <p v-if="!data?.myAppointments?.length" class="empty">
          No appointments yet.
        </p>
      </div>
    </section>
    <StaffingPaging
      cache-key="my-applications"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
