<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview('staffing-management')
useIntervalRefresh(refresh)
</script>
<template>
  <StaffingShell title="Staffing" subtitle="Publish course or project requirements, review applications, and manage appointment decisions.">
    <p v-if="error" class="notice error" role="alert">{{ apiErrorMessage(error, 'Unable to load staffing.') }}</p>
    <p v-if="!data?.viewer?.canManageStaffing && !error" class="notice">Only authorized instructors and administrators can publish or review staffing opportunities. You can <NuxtLink to="/opportunities">browse opportunities</NuxtLink> and manage your own applications.</p>
    <template v-if="data?.viewer?.canManageStaffing">
      <div class="actions"><NuxtLink to="/staffing/new" class="button" data-testid="new-opportunity">Create opportunity</NuxtLink><NuxtLink v-if="data.viewer.isGlobalAdmin" to="/admin/staffing" class="button secondary">Terms and approvals</NuxtLink></div>
      <section class="panel"><div class="panel-heading"><h2>Managed Opportunities</h2></div><div class="panel-body table-scroll">
        <table v-if="data.managedOpportunities?.length"><thead><tr><th>Opportunity</th><th>Type</th><th>State</th><th>Positions</th><th>Action</th></tr></thead><tbody><tr v-for="item in data.managedOpportunities" :key="item.id" :data-testid="`managed-opportunity-${item.id}`"><td>{{ item.title }}</td><td>{{ item.type?.toUpperCase() }}</td><td>{{ staffingState(item.status || item.state) }}</td><td>{{ item.positions }}</td><td><NuxtLink :to="`/staffing/${item.id}`">Review and manage</NuxtLink></td></tr></tbody></table>
        <p v-else class="empty">No managed opportunities yet.</p>
      </div></section>
    </template>
  </StaffingShell>
</template>
