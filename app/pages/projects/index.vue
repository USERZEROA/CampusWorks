<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const { data, error, refresh } = await useStaffingOverview("research-projects");
const { busy, message, failure, run } = useStaffingMutation(refresh);
const project = reactive({
  title: "",
  department: "Computer Science",
  description: "",
});
async function create() {
  const result = await run(
    () =>
      staffingRequest<any>("/api/staffing/projects", {
        method: "POST",
        body: project,
      }),
    "Research project created.",
  );
  if (result?.project)
    await navigateWithContext(`/projects/${result.project.id}`);
}
</script>
<template>
  <StaffingShell
    title="Research Projects"
    subtitle="Research appointments provide project-scoped access without granting course queue permissions."
  >
    <p v-if="error" class="notice error" role="alert">
      {{ apiErrorMessage(error, "Unable to load projects.") }}
    </p>
    <p v-if="message" class="notice" :class="{ error: failure }" role="status">
      {{ message }}
    </p>
    <section v-if="data?.viewer?.canManageStaffing" class="panel">
      <div class="panel-heading"><h2>Create Research Project</h2></div>
      <form @submit.prevent="create" class="panel-body" :aria-busy="busy">
        <label
          >Project title<input
            v-model="project.title"
            required
            maxlength="200"
            data-testid="project-title" /></label
        ><label
          >Department<input
            v-model="project.department"
            required
            maxlength="200" /></label
        ><label
          >Project description<textarea
            v-model="project.description"
            required
            maxlength="6000"
            data-testid="project-description"
          /></label
        ><button :disabled="busy" data-testid="project-create">
          Create project
        </button>
      </form>
    </section>
    <div class="grid">
      <article
        v-for="item in data?.projects || []"
        :key="item.id"
        class="opportunity-card"
      >
        <h2>{{ item.title }}</h2>
        <p>{{ item.description }}</p>
        <NuxtLink class="button" :to="`/projects/${item.id}`"
          >Open project</NuxtLink
        >
      </article>
    </div>
    <p v-if="!data?.projects?.length" class="empty">
      No research projects are available to your account.
    </p>
    <StaffingPaging
      cache-key="research-projects"
      :pagination="data?.pagination"
    />
  </StaffingShell>
</template>
