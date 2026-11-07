<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview('my-applications')
const titleOf = (item: any) => item.opportunityTitle || (data.value?.opportunities || []).find((o: any) => o.id === item.opportunityId)?.title || item.opportunityId
useIntervalRefresh(refresh)
</script>
<template>
  <StaffingShell title="My Applications" subtitle="Track your submissions, respond to offers, and open your active course or research workspace.">
    <p v-if="error" class="notice error" role="alert">{{ apiErrorMessage(error, 'Unable to load your applications.') }}</p>
    <section class="panel"><div class="panel-heading"><h2>Applications</h2></div><div class="panel-body table-scroll">
      <table v-if="data?.myApplications?.length"><thead><tr><th>Opportunity</th><th>State</th><th>Updated</th><th>Action</th></tr></thead><tbody><tr v-for="item in data.myApplications" :key="item.id" :data-testid="`application-row-${item.id}`"><td>{{ titleOf(item) }}</td><td><span class="status">{{ staffingState(item.status || item.state) }}</span></td><td>{{ staffingDate(item.updatedAt) }}</td><td><NuxtLink :to="`/applications/${item.id}`">Open application</NuxtLink></td></tr></tbody></table>
      <p v-else class="empty">You have no applications yet. <NuxtLink to="/opportunities">Browse opportunities</NuxtLink>.</p>
    </div></section>
    <section class="panel"><div class="panel-heading"><h2>Appointments and Workspaces</h2></div><div class="panel-body">
      <p class="muted">Access starts only after acceptance, required clearance, and the appointment start date. It ends when the appointment expires, is suspended, or is ended.</p>
      <article v-for="item in data?.myAppointments || []" :key="item.id" class="opportunity-card" :data-testid="`my-appointment-${item.id}`">
        <h3>{{ titleOf(item) }}</h3><p><span class="status">{{ item.type?.toUpperCase() }} · {{ staffingState(item.status || item.state) }}</span></p><p>{{ staffingDate(item.startDate || item.appointmentStart) }} – {{ staffingDate(item.endDate || item.appointmentEnd) }}</p>
        <NuxtLink v-if="item.status === 'active' && item.courseId" class="button" :to="`/courses/${item.courseId}/ta`" data-testid="appointment-workspace">Open TA Queue</NuxtLink>
        <NuxtLink v-if="item.status === 'active' && item.projectId" class="button" :to="`/projects/${item.projectId}`" data-testid="appointment-workspace">Open Research Workspace</NuxtLink>
      </article><p v-if="!data?.myAppointments?.length" class="empty">No appointments yet.</p>
    </div></section>
  </StaffingShell>
</template>
