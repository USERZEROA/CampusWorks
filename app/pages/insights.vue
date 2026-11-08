<script setup lang="ts">
import type { InsightsAccess } from "../../shared/course-insights";

const request = useRequestFetch();
const access = await request<InsightsAccess>("/api/insights/access");
if (!access.allowed) await navigateTo("/courses", { replace: true });
</script>

<template>
  <StaffingShell
    :title="access.isGlobalAdmin ? 'Department Insights' : 'My Course Insights'"
  >
    <CourseInsights v-if="access.allowed" standalone />
  </StaffingShell>
</template>
