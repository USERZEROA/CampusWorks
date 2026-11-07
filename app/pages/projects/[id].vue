<script setup lang="ts">
const id = String(useRoute().params.id);
const signedInUser = useAuthUser();
const cacheKey = `project-${id}`;
const { data, error, refresh } = await useStaffingPagedRecord(
  cacheKey,
  `/api/staffing/projects/${id}/workspace`,
);
const { busy, message, failure, run } = useStaffingMutation(refresh);
const ownActiveAppointments = computed(() => {
  const user = signedInUser.value;
  if (!user || !data.value?.canWork) return [];
  return (data.value.appointments || []).filter(
    (item: any) =>
      item.status === "active" &&
      ((!!user.id && item.applicantId === user.id) ||
        item.applicantEmail === user.email),
  );
});
function projectEntryLabel(item: any) {
  if (item.kind !== "ResearchUpdate") return staffingState(item.kind);
  switch (item.details?.entryKind) {
    case "task":
      return "Task";
    case "note":
      return "Research note";
    default:
      return "Project update";
  }
}
const entry = reactive({ kind: "update", text: "" });
async function post() {
  const result = await run(
    () =>
      staffingRequest(`/api/staffing/projects/${id}/workspace`, {
        method: "POST",
        body: entry,
      }),
    "Project update recorded.",
  );
  if (result) entry.text = "";
}
useIntervalRefresh(refresh);
</script>
<template>
  <StaffingShell
    :title="data?.project?.title || 'Research Workspace'"
    subtitle="Only the project owner and active, authorized research assistants may work in this scope."
  >
    <p v-if="error" class="notice error" role="alert">
      {{
        apiErrorMessage(
          error,
          "You do not have access to this research workspace.",
        )
      }}
    </p>
    <p v-if="message" class="notice" :class="{ error: failure }" role="status">
      {{ message }}
    </p>
    <template v-if="data?.project && !error"
      ><p class="preserve-lines">{{ data.project.description }}</p>
      <p class="notice">
        Research access does not grant a teaching role or permission to operate
        any course queue.
      </p>
      <section v-if="data.canWork || data.canManage" class="panel">
        <div class="panel-heading"><h2>Record Project Work</h2></div>
        <form @submit.prevent="post" class="panel-body">
          <label
            >Entry type<select v-model="entry.kind">
              <option value="update">Progress update</option>
              <option value="task">Task</option>
              <option value="note">Research note</option>
            </select></label
          ><label
            >Update<textarea
              v-model="entry.text"
              required
              maxlength="6000"
              data-testid="project-update"
            /></label
          ><button :disabled="busy" data-testid="project-update-post">
            Post update
          </button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Project Activity</h2></div>
        <div class="panel-body">
          <article
            v-for="item in data.entries || []"
            :key="item.id"
            class="opportunity-card"
          >
            <h3>
              {{ projectEntryLabel(item) }}
              ·
              {{ item.byName || item.actorEmail || item.by || item.userEmail }}
            </h3>
            <p class="preserve-lines">{{ item.details?.text || item.text }}</p>
            <p class="muted">{{ staffingDate(item.createdAt) }}</p>
          </article>
          <p v-if="!data.entries?.length" class="empty">
            No project updates yet.
          </p>
        </div>
      </section>
      <WorkloadRecorder
        v-for="item in ownActiveAppointments"
        :key="item.id"
        :appointment-id="item.id"
      />
      <StaffingPaging :cache-key="cacheKey" :pagination="data.pagination" />
    </template>
  </StaffingShell>
</template>
