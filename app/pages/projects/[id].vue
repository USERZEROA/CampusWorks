<script setup lang="ts">
const id = String(useRoute().params.id);
const signedInUser = useAuthUser();
const requestFetch = useRequestFetch();
const { data, error, refresh } = await useAsyncData<any>(`project-${id}`, () =>
  requestFetch(`/api/staffing/projects/${id}/workspace`),
);
const { busy, message, failure, run } = useStaffingMutation(refresh);
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
    <template v-if="data?.project"
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
              {{
                item.kind === "ResearchUpdate"
                  ? "Project update"
                  : staffingState(item.kind)
              }}
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
        v-for="item in (data.appointments || []).filter(
          (item: any) =>
            item.status === 'active' &&
            item.applicantEmail === signedInUser?.email,
        )"
        :key="item.id"
        :appointment-id="item.id"
      />
    </template>
  </StaffingShell>
</template>
