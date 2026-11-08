<script setup lang="ts">
import { splitAnnouncementLinks } from "#shared/announcement-links";

const props = defineProps<{ text: string }>();
const parts = computed(() => splitAnnouncementLinks(props.text));
</script>

<template>
  <span class="announcement-text"
    ><template v-for="(part, index) in parts" :key="index"
      ><a
        v-if="part.href"
        :href="part.href"
        target="_blank"
        rel="noopener noreferrer"
        class="announcement-link"
        >{{ part.text }}</a
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>

<style scoped>
.announcement-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.announcement-link {
  color: #012169;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.announcement-link:focus-visible {
  outline: 2px solid #00539b;
  outline-offset: 3px;
}
</style>
