<script setup lang="ts">
const access = useStaffingCapabilities();
</script>

<template>
  <section
    v-if="access"
    class="recruitment-home"
    aria-labelledby="recruitment-title"
  >
    <h2 id="recruitment-title">TA &amp; RA</h2>
    <div class="home-actions">
      <NuxtLink
        v-if="access.viewer.canApplyStaffing"
        to="/opportunities"
        data-testid="opportunities-link"
        >Find positions</NuxtLink
      >
      <NuxtLink
        v-if="access.viewer.canApplyStaffing"
        to="/applications"
        data-testid="applications-link"
        >My applications</NuxtLink
      >
      <NuxtLink
        v-if="access.viewer.canManageStaffing"
        to="/staffing"
        data-testid="staffing-link"
        >Recruitment</NuxtLink
      >
      <NuxtLink
        v-if="access.viewer.isGlobalAdmin"
        to="/admin/staffing"
        data-testid="staffing-admin-link"
        >Recruitment settings</NuxtLink
      >
    </div>
  </section>
</template>

<style scoped>
.recruitment-home {
  margin-bottom: 24px;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 30px rgb(0 0 0 / 6%);
}
h2 {
  margin: 0;
  padding: 10px 20px;
  background: #17408b;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}
.home-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px 20px;
  align-items: stretch;
}
a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: var(--control-height);
  padding: 8px 14px;
  border: 1px solid #17408b;
  border-radius: 6px;
  background: #17408b;
  color: #fff;
  font: 13px system-ui;
  text-decoration: none;
  line-height: 1.25;
  text-align: center;
}
a:hover {
  background: #012169;
}
@media (max-width: 600px) {
  h2 {
    padding-inline: 14px;
  }
  .home-actions {
    padding: 14px;
  }
  a {
    flex: 1 1 160px;
  }
}
</style>
