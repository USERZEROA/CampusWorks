<script setup lang="ts">
/**
 * Bare `/courses/:id` paths open the student view by default (which forwards
 * staff to the TA view). Nested course pages enforce their own permissions.
 */
definePageMeta({
  middleware: [
    (to) => {
      if (/^\/courses\/[^/]+\/?$/.test(to.path)) {
        return navigateTo(`/courses/${to.params.id}/student`, {
          replace: true,
        });
      }
    },
  ],
});
</script>

<template>
  <!-- Render the selected course workspace. -->
  <NuxtPage />
</template>
