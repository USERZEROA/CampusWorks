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
    <section v-if="!error" id="notifications" class="panel">
      <div class="panel-heading"><h2>Notifications</h2></div>
      <div class="panel-body">
        <article
          v-for="item in data?.notifications || []"
          :key="item.id"
          class="opportunity-card"
          :data-testid="`notification-${item.id}`"
        >
          <h3>
            <NuxtLink :to="notificationPath(item)">{{ item.title }}</NuxtLink>
          </h3>
          <p class="muted">
            {{ staffingDate(item.createdAt) }} ·
            {{ item.read ? "Read" : "Unread" }}
          </p>
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
      <div
        class="panel-body table-scroll"
        tabindex="0"
        role="region"
        aria-label="My applications table"
      >
        <table v-if="data?.myApplications?.length">
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
              v-for="item in data.myApplications"
              :key="item.id"
              :data-testid="`application-row-${item.id}`"
            >
              <td>{{ titleOf(item) }}</td>
              <td>
                <span class="status">{{
                  staffingState(item.status || item.state)
                }}</span>
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
        <p v-else class="empty">
          You have no applications yet.
          <NuxtLink to="/opportunities">Browse opportunities</NuxtLink>.
        </p>
      </div>
    </section>
    <section v-if="!error" class="panel">
      <div class="panel-heading"><h2>Appointments</h2></div>
      <div class="panel-body">
        <article
          v-for="item in data?.myAppointments || []"
          :key="item.id"
          class="opportunity-card"
          :data-testid="`my-appointment-${item.id}`"
        >
          <h3>{{ titleOf(item) }}</h3>
          <p>
            <span class="status"
              >{{ item.type?.toUpperCase() }} ·
              {{ staffingState(item.status || item.state) }}</span
            >
          </p>
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
