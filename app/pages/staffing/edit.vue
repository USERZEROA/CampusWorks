<script setup lang="ts">
const id = String(useRoute().query.id || '')
if (!id) await navigateTo('/staffing')
</script>
<template><OpportunityEditor v-if="id" :opportunity-id="id" /></template>
