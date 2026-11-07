<script setup lang="ts">
const { data, error, refresh } = await useStaffingOverview(
  "staffing-management",
);
const app = useNuxtApp();
const search = ref("");
const state = ref("");
const positions = computed(() =>
  (data.value?.managedOpportunities || []).filter(
    (item: any) =>
      (!state.value || (item.status || item.state) === state.value) &&
      (!search.value ||
        `${item.title} ${item.courseId || ""} ${item.department || ""}`
          .toLowerCase()
          .includes(search.value.toLowerCase())),
  ),
);
const summary = computed(() =>
  [
    {
      label: "Opportunities",
      value: data.value?.pagination?.totals?.managedOpportunities,
    },
    {
      label: "Course offerings",
      value: data.value?.pagination?.totals?.courses,
    },
  ].filter((item) => Number.isFinite(item.value)),
);
watch(
  () => data.value?.viewer?.canManageStaffing,
  (allowed) => {
    if (allowed === false)
      app.runWithContext(() => navigateTo("/courses", { replace: true }));
  },
  { immediate: true },
);
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell title="Recruitment">
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load staffing.") }}
    </p>
    <template v-if="data?.viewer?.canManageStaffing && !error">
      <StaffingSummary :items="summary" label="Recruitment overview" />
      <div class="actions">
        <NuxtLink
          to="/staffing/new"
          v-if="data.currentCycle?.isOpen"
          class="button"
          data-testid="new-opportunity"
          >Create opportunity</NuxtLink
        ><NuxtLink
          v-if="data.viewer.isGlobalAdmin"
          to="/admin/staffing"
          class="button secondary"
          >Recruitment settings</NuxtLink
        >
      </div>
      <section class="panel">
        <div class="panel-heading"><h2>Positions</h2></div>
        <div v-if="data.managedOpportunities?.length" class="list-toolbar">
          <label
            >Search positions<input
              v-model="search"
              type="search"
              data-testid="managed-position-search"
          /></label>
          <label
            >State<select v-model="state" data-testid="managed-position-state">
              <option value="">All states</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending approval</option>
              <option value="published">Published</option>
              <option value="applications_closed">Applications closed</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
              <option value="archived">Archived</option>
            </select></label
          >
        </div>
        <div
          class="panel-body table-scroll"
          tabindex="0"
          role="region"
          aria-label="Managed opportunities table"
        >
          <table v-if="positions.length">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Type</th>
                <th>State</th>
                <th>Positions</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in positions"
                :key="item.id"
                :data-testid="`managed-opportunity-${item.id}`"
              >
                <td>
                  <span class="record-title">{{ item.title }}</span
                  ><span class="record-meta">{{
                    item.courseId?.toUpperCase() || item.department
                  }}</span>
                </td>
                <td>
                  <span class="type-tag">{{ item.type?.toUpperCase() }}</span>
                </td>
                <td><StaffingStatus :state="item.status || item.state" /></td>
                <td>
                  {{ item.positions
                  }}<span v-if="item.committedPositions" class="record-meta"
                    >{{ item.committedPositions }} reserved</span
                  >
                </td>
                <td>
                  <NuxtLink :to="`/staffing/${item.id}`"
                    >Review and manage</NuxtLink
                  >
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty">
            {{
              search || state
                ? "No matching loaded positions."
                : "No managed opportunities yet."
            }}
          </p>
          <p
            v-if="
              search ||
              state ||
              (data.pagination?.totals?.managedOpportunities || 0) >
                (data.managedOpportunities?.length || 0)
            "
            class="record-count"
            role="status"
          >
            {{ positions.length }} of
            {{ data.managedOpportunities?.length || 0 }} loaded positions
          </p>
        </div>
      </section>
    </template>
    <StaffingPaging
      cache-key="staffing-management"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
