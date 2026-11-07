<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const busyActions = ref(false);

import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  useRoute,
  useRouter,
  useAsyncData,
  useRequestFetch,
  navigateTo,
  refreshNuxtData,
} from "#app";

type Announcement = {
  id: string;
  at: string;
  by: string;
  message: string;
};

type QueueEntry = {
  id: string;
  email: string;
  name: string;
  location: string;
  question: string;
  paused: boolean;
  ta: string;
  position?: number;
  otherTa?: boolean;
  assignedToMe?: boolean;
};

type CourseApiResult = {
  id: string;
  code: string;
  title: string;
  state: string;
  role?: string | null;
  isStaff: boolean;
  isManager: boolean;
  onDuty: boolean;
  user: { email: string; name?: string };
  announcements: Announcement[];
  queue: QueueEntry[];
  onDutyTAs?: string[];
};

/**
 * Load course/queue data for TA-facing view.
 */
const route = useRoute();
const router = useRouter();
const courseId = route.params.id as string;
const requestFetch = useRequestFetch();

const { data, error } = await useAsyncData<CourseApiResult>(
  `course-ta-${courseId}`,
  () => requestFetch<CourseApiResult>(`/api/courses/${courseId}`),
);

if (error.value) {
  const status = (error.value as any).statusCode;
  if (status === 401) {
    capturedUser.value = null;
    await navigateWithContext("/login");
  } else {
    await navigateWithContext("/courses");
  }
}

watch(error, (value) => {
  const status = (value as any)?.statusCode;
  if (status === 401) {
    capturedUser.value = null;
    navigateWithContext("/login");
  } else if (status === 403) navigateWithContext("/courses");
});
const course = computed(() => data.value);
const user = computed(() => course.value?.user || { email: "", name: "" });

/**
 * Require TA/staff role for this view; non-staff are redirected.
 */
const isStaff = computed(() => !!course.value?.isStaff);
const isManager = computed(() => !!course.value?.isManager);

if (course.value && !isStaff.value) {
  await navigateWithContext(`/courses/${courseId}/student`, { replace: true });
}
watch(isStaff, (value) => {
  if (course.value && !value)
    navigateWithContext(`/courses/${courseId}/student`, { replace: true });
});

/**
 * Queue state handling.
 */
const normalizeState = (s?: string): "open" | "closed" | "paused" => {
  const v = (s || "closed").toLowerCase();
  if (v === "open") return "open";
  if (v === "paused") return "paused";
  return "closed";
};

const queueStatus = ref<"open" | "closed" | "paused">(
  normalizeState(course.value?.state),
);

watch(
  () => course.value?.state,
  (v) => {
    queueStatus.value = normalizeState(v);
  },
);

const isOpen = computed(() => queueStatus.value === "open");
const isPaused = computed(() => queueStatus.value === "paused");
const isClosed = computed(() => queueStatus.value === "closed");

/**
 * TA duty state and queue operation permissions.
 */
const onDutyTAs = computed(() => course.value?.onDutyTAs || []);

const taOnDuty = computed(() => !!course.value?.onDuty);

const canOperateQueue = computed(() => isStaff.value && taOnDuty.value);

const toggleOnDuty = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isStaff.value) return;
    try {
      await $fetch(`/api/courses/${courseId}/ta-duty`, {
        method: "POST",
        body: { onDuty: !taOnDuty.value },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to toggle duty"));
    }
  } finally {
    busyActions.value = false;
  }
};

const setQueueStatus = async (status: "open" | "closed" | "paused") => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isStaff.value) return;
    try {
      await $fetch(`/api/courses/${courseId}/state`, {
        method: "PATCH",
        body: { state: status },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to update queue state"));
    }
  } finally {
    busyActions.value = false;
  }
};

const closeQueue = async () => {
  if (
    queueEntries.value.length &&
    !window.confirm(
      `Close the queue? The ${queueEntries.value.length} remaining entries will be ended and saved to history.`,
    )
  ) {
    return;
  }
  await setQueueStatus("closed");
};

/**
 * Reactive queue + announcements.
 */
const queueEntries = ref<QueueEntry[]>(course.value?.queue || []);

watch(
  () => course.value?.queue,
  (val) => {
    queueEntries.value = val || [];
  },
);

const announcements = ref<Announcement[]>(course.value?.announcements || []);

watch(
  () => course.value?.announcements,
  (val) => {
    announcements.value = val || [];
  },
);

const queueLength = computed(() => queueEntries.value.length);

/**
 * Assign, complete, or reassign a queue entry.
 * - If already assigned to current TA => complete (remove).
 * - Otherwise claim it; the server releases any other entry this TA had
 *   claimed (one active entry per TA).
 */
const assignOrComplete = async (entry: QueueEntry) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!canOperateQueue.value || entry.paused) return;

    try {
      if (entry.assignedToMe) {
        // Mark as completed.
        await $fetch(`/api/courses/${courseId}/queue/remove`, {
          method: "POST",
          body: { entryId: entry.id },
        });
      } else {
        await $fetch(`/api/courses/${courseId}/queue/assign`, {
          method: "POST",
          body: { entryId: entry.id, assign: true },
        });
      }

      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to update entry"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Reorder entries (priority adjustments).
 */
const moveEntry = async (index: number, direction: "up" | "down") => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!canOperateQueue.value) return;
    const e = queueEntries.value[index];
    if (!e) return;
    if (direction === "up" && index <= 0) return;
    if (direction === "down" && index >= queueEntries.value.length - 1) return;

    try {
      await $fetch(`/api/courses/${courseId}/queue/move`, {
        method: "POST",
        body: { entryId: e.id, direction },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (err: any) {
      alert(apiErrorMessage(err, "Failed to move entry"));
    }
  } finally {
    busyActions.value = false;
  }
};

const moveUp = (index: number) => moveEntry(index, "up");
const moveDown = (index: number) => moveEntry(index, "down");

/**
 * Pause/resume a specific entry.
 */
const togglePauseEntry = async (entry: QueueEntry) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!canOperateQueue.value) return;
    try {
      await $fetch(`/api/courses/${courseId}/queue/pause`, {
        method: "POST",
        body: {
          entryId: entry.id,
          paused: !entry.paused,
        },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (err: any) {
      alert(apiErrorMessage(err, "Failed to pause entry"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Remove an entry from the queue.
 */
const removeEntry = async (entry: QueueEntry) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!canOperateQueue.value) return;
    if (
      !window.confirm(`Remove ${entry.name || "this student"} from the queue?`)
    )
      return;
    try {
      await $fetch(`/api/courses/${courseId}/queue/remove`, {
        method: "POST",
        body: { entryId: entry.id },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (err: any) {
      alert(apiErrorMessage(err, "Failed to remove entry"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Mark entry as needing a different TA.
 */
const handoffEntry = async (entry: QueueEntry) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!canOperateQueue.value) return;
    if (entry.otherTa) return;
    if (!entry.assignedToMe) return;

    try {
      await $fetch(`/api/courses/${courseId}/queue/assign`, {
        method: "POST",
        body: { entryId: entry.id, assign: "other" },
      });
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (err: any) {
      alert(apiErrorMessage(err, "Failed to handoff entry"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Announcements: create/delete.
 */
const newAnnouncement = ref("");

const postAnnouncement = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isStaff.value) return;
    const message = newAnnouncement.value.trim();
    if (!message) return;

    try {
      await $fetch(`/api/courses/${courseId}/announcements`, {
        method: "POST",
        body: { message },
      });
      newAnnouncement.value = "";
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to post announcement"));
    }
  } finally {
    busyActions.value = false;
  }
};

const deleteAnnouncement = async (id: string) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isStaff.value) return;
    try {
      await $fetch(
        `/api/courses/${courseId}/announcements/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      await refreshNuxtData(`course-ta-${courseId}`);
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to delete announcement"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Timestamp formatting for table display.
 */
const formatAt = (at: string) => {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(
    d.getMonth() + 1,
  )}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Poll server for live updates.
 */
let timer: any = null;

onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden) refreshNuxtData(`course-ta-${courseId}`);
  }, 3000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

/**
 * Navigation / auth.
 */
const logout = signOut;

const goBack = () => {
  router.push("/courses");
};

const goHelp = () => {
  navigateWithContext("/help");
};

const goAnalytics = () => {
  router.push(`/courses/${courseId}/admin`);
};
</script>

<template>
  <div v-if="course" class="page-root">
    <header class="app-navbar">
      <button
        type="button"
        class="app-left"
        aria-label="Back to courses"
        @click="goBack"
      >
        <img
          src="/duke-cs-logo.png"
          alt="Duke Department of Computer Science"
          class="app-logo"
          width="381"
          height="70"
          decoding="async"
        />
      </button>
      <button
        type="button"
        class="app-center"
        aria-label="Back to courses"
        @click="goBack"
      >
        <span class="brand-main"> CampusWorks </span>
      </button>
      <div class="app-right">
        <button
          v-if="isManager"
          class="help-link"
          type="button"
          @click="goAnalytics"
          data-testid="course-admin-link"
        >
          Course Admin
        </button>
        <button class="help-link" type="button" @click="goHelp">
          Help &amp; Info
        </button>
        <div class="user-pill">
          <span class="user-email" data-testid="current-user-email">
            {{ user.email }}
          </span>
          <button
            class="logout-mini"
            @click.prevent="logout"
            data-testid="logout-btn"
          >
            Logout
          </button>
        </div>
      </div>
    </header>

    <main
      :aria-busy="busyActions"
      id="main-content"
      tabindex="-1"
      class="content"
    >
      <button class="back-btn" type="button" @click="goBack">
        ← Back to Courses
      </button>

      <section class="course-header">
        <div class="course-title-block">
          <h1 class="course-code">
            {{ course?.code || courseId }}
          </h1>
          <div class="course-subtitle">
            {{ course?.title || "CampusWorks Course" }}
          </div>
        </div>
        <div class="course-state">
          <div class="meta-label">
            State:
            <span
              class="state-pill"
              :class="{
                closed: isClosed,
                paused: isPaused,
              }"
              data-testid="queue-state"
            >
              {{ isOpen ? "Open" : isPaused ? "Paused" : "Closed" }}
            </span>
          </div>
          <div class="meta-label">Length: {{ queueLength }}</div>
        </div>
      </section>

      <section class="layout">
        <!-- Left: TA duty and queue controls -->
        <div class="left-column">
          <section class="panel">
            <div class="panel-header">TA on Duty</div>
            <div class="panel-body ta-body">
              <template v-if="onDutyTAs.length">
                <div v-for="ta in onDutyTAs" :key="ta" class="ta-name">
                  {{ ta }}
                </div>
              </template>
              <span v-else> No TA currently marked on duty. </span>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">Queue Controls</div>
            <div class="panel-body controls-body">
              <div class="queue-buttons">
                <button
                  :disabled="busyActions"
                  v-if="isClosed"
                  class="primary-btn"
                  @click="setQueueStatus('open')"
                  data-testid="open-queue-btn"
                >
                  Open Queue
                </button>
                <template v-else>
                  <button
                    :disabled="busyActions"
                    class="primary-btn"
                    :class="{ active: taOnDuty }"
                    @click="toggleOnDuty"
                    data-testid="on-duty-btn"
                  >
                    {{ taOnDuty ? "End Duty" : "On Duty" }}
                  </button>
                  <button
                    :disabled="busyActions"
                    v-if="isOpen"
                    class="outline-btn"
                    @click="setQueueStatus('paused')"
                    data-testid="pause-queue-btn"
                  >
                    Pause Queue
                  </button>
                  <button
                    :disabled="busyActions"
                    v-if="isPaused"
                    class="outline-btn"
                    @click="setQueueStatus('open')"
                    data-testid="resume-queue-btn"
                  >
                    Resume Queue
                  </button>
                  <button
                    :disabled="busyActions"
                    class="danger-btn"
                    @click="closeQueue"
                    data-testid="close-queue-btn"
                  >
                    Close Queue
                  </button>
                </template>
              </div>
              <div class="logged-as">
                Logged in as
                <span>{{ user.email }}</span>
              </div>
              <div class="hint">
                Only TAs marked
                <strong>On Duty</strong>
                can operate the live queue.
              </div>
            </div>
          </section>
        </div>

        <!-- Right: announcements and live queue -->
        <div class="right-column">
          <section class="panel">
            <div class="panel-header">Announcements</div>
            <div class="panel-body announcements-body">
              <table v-if="announcements.length" class="ann-table">
                <thead>
                  <tr>
                    <th class="ann-col-datetime">Date / Time</th>
                    <th class="ann-col-by">Posted By</th>
                    <th class="ann-col-msg">Announcement</th>
                    <th class="ann-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="a in announcements" :key="a.id">
                    <td class="ann-datetime">
                      {{ formatAt(a.at) }}
                    </td>
                    <td class="ann-poster">
                      {{ a.by }}
                    </td>
                    <td class="ann-message">
                      {{ a.message }}
                    </td>
                    <td class="ann-actions-cell">
                      <button
                        :disabled="busyActions"
                        class="ann-delete"
                        @click="deleteAnnouncement(a.id)"
                        title="Delete announcement"
                        aria-label="Delete announcement"
                        data-testid="announcement-delete"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-text">No announcements yet.</div>
            </div>
            <div class="announce-input-row">
              <input
                v-model="newAnnouncement"
                aria-label="Announcement message"
                class="announce-input"
                placeholder="Post a new announcement to students…"
                data-testid="announce-input"
                @keyup.enter="postAnnouncement"
              />
              <button
                :disabled="busyActions"
                class="announce-btn"
                @click="postAnnouncement"
                data-testid="announce-post"
              >
                Post
              </button>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">Live Queue</div>
            <div class="panel-body">
              <table
                class="queue-table"
                tabindex="0"
                aria-label="Live help queue"
              >
                <thead>
                  <tr>
                    <th class="col-num">#</th>
                    <th class="col-student">Student</th>
                    <th class="col-location">Location</th>
                    <th class="col-question">Question</th>
                    <th class="col-ta">TA</th>
                    <th class="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(entry, idx) in queueEntries"
                    :key="entry.id"
                    :class="[
                      'queue-row',
                      {
                        'is-paused': entry.paused,
                        'is-needs-other': !entry.paused && entry.otherTa,
                        'is-assigned':
                          !entry.paused && !entry.otherTa && !!entry.ta,
                        'is-assigned-self': !entry.paused && entry.assignedToMe,
                      },
                    ]"
                    :data-testid="`ta-row-${entry.email}`"
                  >
                    <td class="col-num">
                      {{ idx + 1 }}
                    </td>
                    <td class="col-student">
                      {{ entry.name }}
                    </td>
                    <td class="col-location">
                      {{ entry.location }}
                    </td>
                    <td class="col-question">
                      {{ entry.question || "—" }}
                    </td>
                    <td class="col-ta">
                      {{ entry.otherTa ? "Needs another TA" : entry.ta || "—" }}
                    </td>
                    <td class="col-actions">
                      <div class="actions-wrap">
                        <button
                          class="action-btn"
                          :class="{
                            'select-paused': entry.paused,
                            'select-priority': entry.otherTa && !entry.paused,
                            'select-self': !entry.paused && entry.assignedToMe,
                            'select-reselect':
                              !entry.otherTa &&
                              !entry.paused &&
                              !!entry.ta &&
                              !entry.assignedToMe,
                            'select-default':
                              !entry.otherTa && !entry.paused && !entry.ta,
                          }"
                          :disabled="
                            busyActions || !canOperateQueue || entry.paused
                          "
                          @click="assignOrComplete(entry)"
                          data-testid="ta-select-btn"
                        >
                          {{
                            entry.paused
                              ? "Paused"
                              : entry.otherTa
                                ? "Select"
                                : entry.assignedToMe
                                  ? "Complete"
                                  : entry.ta
                                    ? "Re-select"
                                    : "Select"
                          }}
                        </button>

                        <button
                          :disabled="busyActions"
                          v-if="
                            canOperateQueue &&
                            !entry.paused &&
                            entry.assignedToMe
                          "
                          class="action-btn other-ta"
                          @click="handoffEntry(entry)"
                          data-testid="ta-other-btn"
                        >
                          Other TA
                        </button>

                        <button
                          class="action-btn pause"
                          :disabled="busyActions || !canOperateQueue"
                          @click="togglePauseEntry(entry)"
                          :title="entry.paused ? 'Resume entry' : 'Pause entry'"
                          :aria-label="
                            entry.paused ? 'Resume entry' : 'Pause entry'
                          "
                          data-testid="ta-pause-btn"
                        >
                          {{ entry.paused ? "▶" : "||" }}
                        </button>

                        <button
                          class="action-btn danger"
                          :disabled="busyActions || !canOperateQueue"
                          @click="removeEntry(entry)"
                          title="Remove from queue"
                          aria-label="Remove from queue"
                          data-testid="ta-remove-btn"
                        >
                          ✕
                        </button>

                        <button
                          class="action-btn move"
                          :disabled="
                            busyActions || !canOperateQueue || idx === 0
                          "
                          @click="moveUp(idx)"
                          title="Move up"
                          aria-label="Move up"
                          data-testid="ta-up-btn"
                        >
                          ↑
                        </button>

                        <button
                          class="action-btn move"
                          :disabled="
                            busyActions ||
                            !canOperateQueue ||
                            idx === queueEntries.length - 1
                          "
                          @click="moveDown(idx)"
                          title="Move down"
                          aria-label="Move down"
                          data-testid="ta-down-btn"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>

                  <tr v-if="!queueEntries.length">
                    <td colspan="6" class="empty-text">
                      No one is currently in the queue.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  min-height: 100vh;
  background: #f3f5fa;
  color: #111827;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.app-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 32px;
  background: #012169;
  color: #ffffff;
}

.app-left {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.app-logo {
  height: 40px;
  object-fit: contain;
}

.app-center {
  display: flex;
  flex: 1;
  justify-content: center;
  cursor: pointer;
}

.brand-main {
  font-size: 20px;
  font-weight: 600;
}

.app-right {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.help-link {
  padding: 4px 10px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 11px;
  cursor: pointer;
}

.user-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.user-email {
  font-size: 11px;
}

.logout-mini {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: transparent;
  color: #ffffff;
  font-size: 10px;
  cursor: pointer;
}

.outline-btn.top-analytics {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid #ffffff;
  background: transparent;
  color: #ffffff;
  font-size: 11px;
  cursor: pointer;
}

.content {
  max-width: 1300px;
  margin: 24px auto 40px;
  padding: 0 24px 40px;
}

.back-btn {
  padding: 10px 24px;
  margin-bottom: 18px;
  border-radius: 999px;
  border: none;
  background: #e5ecff;
  color: #012169;
  font-weight: 500;
  cursor: pointer;
}

.course-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-end;
  margin-bottom: 18px;
}

.course-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.course-code {
  font-size: 40px;
  font-weight: 700;
  margin: 0;
  color: #012169;
  text-transform: lowercase;
}

.course-subtitle {
  font-size: 20px;
  color: #4b5563;
}

.course-state {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 18px;
  font-size: 14px;
  color: #4b5563;
}

.meta-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.state-pill {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #10b981;
  color: #022c16;
}

.state-pill.closed {
  background: #dc2626;
  color: #ffffff;
}

.state-pill.paused {
  background: #f59e0b;

  color: #422006;
}

.layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 18px;
  margin-top: 4px;
}

.left-column,
.right-column {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.panel-header {
  padding: 10px 18px;
  background: #17408b;
  color: #ffffff;
  font-weight: 600;
  font-size: 17px;
}

.panel-body {
  padding: 12px 18px 14px;
}

.ta-body {
  font-size: 14px;
  color: #536174;
}

.ta-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.controls-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.queue-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.primary-btn,
.outline-btn,
.danger-btn {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.primary-btn {
  background: #17408b;
  color: #ffffff;
  border: none;
}

.primary-btn:hover {
  background: #012169;
  transform: translateY(-1px);
}

.primary-btn.active {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6) inset;
}

.outline-btn {
  background: #ffffff;
  color: #17408b;
  border: 1px solid #17408b;
}

.outline-btn:hover {
  background: #17408b;
  color: #ffffff;
  transform: translateY(-1px);
}

.danger-btn {
  background: #dc2626;
  color: #ffffff;
  border: none;
}

.danger-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

.logged-as {
  font-size: 12px;
  color: #536174;
  margin-top: 6px;
}

.logged-as span {
  font-weight: 500;
  color: #111827;
}

.hint {
  margin-top: 4px;
  font-size: 11px;
  color: #596579;
}

.announcements-body {
  max-height: 220px;
  overflow-y: auto;
  padding: 0;
}

.ann-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
}

.ann-table th,
.ann-table td {
  padding: 8px 14px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}

.ann-table thead {
  background: #f9fafb;
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 600;
  color: #4b5563;
}

.ann-col-datetime {
  width: 160px;
}

.ann-col-by {
  width: 140px;
}

.ann-col-msg {
  width: auto;
}

.ann-col-actions {
  width: 60px;
}

.ann-datetime {
  white-space: nowrap;
  color: #4b5563;
}

.ann-poster {
  white-space: nowrap;
  color: #374151;
  font-weight: 500;
}

.ann-message {
  color: #111827;
}

.ann-actions-cell {
  text-align: right;
}

.ann-delete {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 11px;
  cursor: pointer;
}

.ann-delete:hover {
  background: #fee2e2;
}

.announce-input-row {
  display: flex;
  gap: 8px;
  padding: 8px 14px 12px;
  border-top: 1px solid #e5e7eb;
}

.announce-input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
}

.announce-btn {
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: #17408b;
  color: #ffffff;
  font-size: 13px;
  cursor: pointer;
}

.queue-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.queue-table th,
.queue-table td {
  padding: 9px 14px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}

.queue-table thead {
  background: #f9fafb;
  font-weight: 600;
  color: #4b5563;
}

.col-num {
  width: 10px;
  text-align: center;
}

.col-student {
  width: 80px;
}

.col-location {
  width: 220px;
}

.col-question {
  width: 320px;
}

.col-ta {
  width: 80px;
  text-align: center;
}

.col-actions {
  width: 430px;
  padding-left: 12px;
}

.queue-row.is-paused {
  background: #fef9c3;
}

.queue-row.is-assigned {
  background: #bfdbfe;
  border-left: 3px solid #2563eb;
}

.queue-row.is-assigned-self {
  background: #bfdbfe;
  border-left: 3px solid #2563eb;
}

.queue-row.is-needs-other {
  background: #dcfce7;
  border-left: 3px solid #22c55e;
}

.actions-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  margin-left: 3px;
}

.action-btn {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}

.action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.action-btn.select-default {
  background: #ffffff;
  border-color: #2563eb;
  color: #2563eb;
}

.action-btn.select-self {
  background: #16a34a;
  border-color: #16a34a;
  color: #022c16;
}

.action-btn.select-priority {
  background: #fee2e2;
  border-color: #dc2626;
  color: #b91c1c;
}

.action-btn.select-reselect {
  border-color: #dc2626;
  color: #b91c1c;
  background: #ffffff;
}

.action-btn.select-paused {
  background: #9ca3af;
  border-color: #596579;
  color: #172033;
}

.action-btn.other-ta {
  border-color: #22c55e;
  color: #166534;
  background: #f0fdf4;
}

.action-btn.pause {
  border-color: #fbbf24;
  background: #fffbeb;
  color: #92400e;
}

.action-btn.danger {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.action-btn.danger:hover:not(:disabled) {
  background: #fee2e2;
}

.action-btn.move {
  min-width: 22px;
  padding-inline: 6px;
}

.empty-text {
  padding: 10px 14px;
  font-size: 13px;
  color: #536174;
  text-align: left;
}

@media (max-width: 1100px) {
  /* minmax(0, 1fr) keeps wide tables from stretching the page past the viewport */
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .left-column,
  .right-column {
    min-width: 0;
  }

  .ann-table {
    table-layout: auto;
  }

  .ann-col-datetime,
  .ann-col-by {
    width: auto;
  }

  .course-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .course-state {
    margin-top: 6px;
  }

  .col-actions {
    width: auto;
  }
}

@media (max-width: 768px) {
  .app-navbar {
    flex-wrap: wrap;
    padding: 8px 16px;
    row-gap: 8px;
  }

  .app-left {
    order: 1;
  }

  .app-center {
    order: 2;
    width: 100%;
    justify-content: center;
    text-align: center;
    margin-top: 4px;
  }

  .app-right {
    order: 3;
    width: 100%;
    justify-content: flex-end;
  }

  .content {
    margin: 16px auto 24px;
    padding: 0 12px 24px;
  }

  .course-code {
    font-size: 32px;
  }

  .course-subtitle {
    font-size: 16px;
  }

  .panel-body {
    padding: 10px 12px 12px;
  }

  .announcements-body {
    max-height: none;
  }

  .queue-table {
    font-size: 12px;
  }

  .panel-body .queue-table,
  .panel-body .ann-table {
    display: block;
    overflow-x: auto;
  }

  .actions-wrap {
    flex-wrap: wrap;
  }
}

@media (max-width: 480px) {
  .brand-main {
    font-size: 16px;
  }

  .user-email {
    display: none;
  }

  .course-code {
    font-size: 26px;
  }

  .course-subtitle {
    font-size: 14px;
  }

  .back-btn {
    padding-inline: 16px;
  }

  .primary-btn,
  .outline-btn,
  .danger-btn {
    font-size: 13px;
  }

  .ann-table {
    font-size: 12px;
  }
}
</style>
