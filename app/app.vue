<script setup lang="ts">
const authError = useAuthError();
const demoLabel = useRuntimeConfig().public.demoLabel;
</script>

<template>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <aside v-if="demoLabel" class="demo-context" aria-label="Demonstration data">{{ demoLabel }}</aside>
  <p v-if="authError" class="global-auth-error" role="alert">{{ authError }}</p>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
.demo-context {
  padding: 5px 16px;
  color: #012169;
  background: #e8effb;
  text-align: center;
  font: 600 11px system-ui;
  letter-spacing: 0.025em;
}
.skip-link {
  position: fixed;
  left: 12px;
  top: -100px;
  z-index: 10000;
  padding: 10px 16px;
  background: white;
  color: #012169;
  border: 2px solid #012169;
  border-radius: 6px;
}
.skip-link:focus {
  top: 8px;
}
:focus-visible {
  outline: 3px solid #d97706 !important;
  outline-offset: 3px;
}
.global-auth-error {
  margin: 0;
  padding: 12px 20px;
  color: #991b1b;
  background: #fef2f2;
  font: 14px system-ui;
}
.sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.app-logo {
  width: auto;
  max-width: 100%;
  object-fit: contain;
}
button.app-left,
button.app-center {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
}
</style>
