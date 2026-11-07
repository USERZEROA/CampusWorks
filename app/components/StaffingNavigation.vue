<script setup lang="ts">
const user = useAuthUser();
</script>

<template>
  <nav
    v-if="user"
    class="staffing-navigation"
    aria-label="CampusWorks workspaces"
  >
    <NuxtLink to="/courses">Courses</NuxtLink>
    <NuxtLink to="/opportunities" data-testid="opportunities-link"
      >Opportunities</NuxtLink
    >
    <NuxtLink to="/applications" data-testid="applications-link"
      >My Applications</NuxtLink
    >
    <NuxtLink to="/staffing" data-testid="staffing-link">Staffing</NuxtLink>
    <NuxtLink to="/projects">Research Projects</NuxtLink>
    <NuxtLink v-if="user.isGlobalAdmin" to="/admin/staffing"
      >Staffing Administration</NuxtLink
    >
  </nav>
</template>

<style scoped>
.staffing-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 24px;
  background: #fff;
  border-bottom: 1px solid #d9e2f2;
  font:
    13px system-ui,
    sans-serif;
}
a {
  color: #17408b;
  padding: 4px 0;
  text-decoration: none;
  border-bottom: 2px solid transparent;
}
a:hover,
a:focus-visible,
a.router-link-active {
  color: #012169;
  border-color: #012169;
}
@media (max-width: 600px) {
  .staffing-navigation {
    padding: 8px 12px;
    gap: 5px 14px;
  }
}
</style>
