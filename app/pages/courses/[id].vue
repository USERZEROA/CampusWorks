<script setup lang="ts">
/**
 * Bare `/courses/:id` paths open the student view by default (which forwards
 * staff to the TA view). Admin/TA/student subpaths are left untouched.
 */
definePageMeta({
  middleware: [
    (to) => {
      if (!/\/(admin|ta|student)\/?$/.test(to.path)) {
        return navigateTo(`/courses/${to.params.id}/student`, { replace: true })
      }
    }
  ]
})
</script>

<template>
  <!-- Render nested course pages (admin / TA / student). -->
  <NuxtPage />
</template>
