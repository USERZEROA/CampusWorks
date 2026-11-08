<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
import { vAccessibleDialog } from "../../../directives/accessibleDialog";
const busyActions = ref(false);

import { ref, computed, watch } from "vue";
import {
  useRoute,
  useRouter,
  useAsyncData,
  useRequestFetch,
  navigateTo,
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
  otherTa?: boolean;
  position?: number;
  isMine?: boolean;
};

type CourseApiResult = {
  id: string;
  code: string;
  title: string;
  state: string;
  role?: string | null;
  enrolled: boolean;
  restricted?: boolean;
  isStaff: boolean;
  user: { email: string; name?: string };
  announcements: Announcement[];
  queue: QueueEntry[];
  queueLength?: number;
  onDutyTAs?: string[];
};

/**
 * Load course + queue state for this student-facing view.
 */
const route = useRoute();
const router = useRouter();
const courseId = route.params.id as string;
const requestFetch = useRequestFetch();

let lastComplete: CourseApiResult | undefined;
const loadCourse = async (_app: unknown, { signal }: { signal: AbortSignal }): Promise<CourseApiResult> => {
  try {
    const current = await requestFetch<CourseApiResult>(`/api/courses/${courseId}`, { signal });
    lastComplete = current;
    return current;
  } catch (error: any) {
    const status = error?.statusCode || error?.response?.status;
    if (lastComplete && ![401, 403, 404].includes(status) && !signal.aborted) return lastComplete;
    throw error;
  }
};
const { data, error, refresh } = await useAsyncData<CourseApiResult>(
  `course-student-${courseId}`,
  loadCourse,
  { dedupe: "defer" },
);
lastComplete = data.value || lastComplete;

if (error.value) {
  const status = (error.value as any).statusCode;
  if (status === 401) {
    capturedUser.value = null;
    await navigateWithContext("/login");
  } else if (status === 403 || status === 404) {
    await navigateWithContext("/courses");
  }
}

watch(error, (value) => {
  const status = (value as any)?.statusCode;
  if (status === 401) {
    capturedUser.value = null;
    navigateWithContext("/login");
  } else if (status === 403 || status === 404) navigateWithContext("/courses");
});
const course = computed(() => data.value);
const user = computed(() => course.value?.user || { email: "", name: "" });

/**
 * Staff use the TA view of the same course.
 */
const isStaff = computed(() => !!course.value?.isStaff);
const isEnrolled = computed(() => !!course.value?.enrolled);

if (isStaff.value) {
  await navigateWithContext(`/courses/${courseId}/ta`, { replace: true });
}
watch(isStaff, (value) => {
  if (value) navigateWithContext(`/courses/${courseId}/ta`, { replace: true });
});

/**
 * Queue state normalization and derived flags.
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

const onDutyTAs = computed(() => course.value?.onDutyTAs || []);

/**
 * Reactive queue and announcements.
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

const queueLength = computed(
  () => course.value?.queueLength ?? queueEntries.value.length,
);

const myEntry = computed<QueueEntry | null>(
  () => queueEntries.value.find((e) => e.isMine) || null,
);

const myPosition = computed(() => {
  if (!myEntry.value) return null;
  const idx = queueEntries.value.findIndex((e) => e.id === myEntry.value!.id);
  return idx >= 0 ? idx + 1 : null;
});

/** TA currently helping the student, if any. */
const myHelper = computed(() =>
  myEntry.value && !myEntry.value.otherTa && !myEntry.value.paused
    ? myEntry.value.ta
    : "",
);

const canStudentJoin = computed(() => isOpen.value && isEnrolled.value);

/**
 * Enroll from the course page (joining the queue requires an enrollment).
 */
const enrolling = ref(false);

const enroll = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    enrolling.value = true;
    try {
      await $fetch("/api/courses/enroll", {
        method: "POST",
        body: { courseId, enroll: true },
      });
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Enroll failed"));
    } finally {
      enrolling.value = false;
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Join/edit queue modal state.
 */
const showJoinModal = ref(false);
const joinLocation = ref("");
const editingEntryId = ref<string | null>(null);
const joinQuestion = ref("");

/**
 * Feedback modal state.
 */
const showFeedbackModal = ref(false);

type FeedbackCategory = "queue" | "ta" | "wait" | "other";

const fbCategory = ref<FeedbackCategory>("queue");
const fbRating = ref(5);
const fbPositive = ref("");
const fbNegative = ref("");
const fbAllowContact = ref(true);
const fbSubmitting = ref(false);
type FeedbackSession = { id: string; at: string; helpers: Array<{ email: string; name: string }> };
const feedbackSessions = ref<FeedbackSession[]>([]);
const feedbackSessionId = ref("");
const feedbackHelperEmail = ref("");
const feedbackContextLoading = ref(false);
const feedbackContextError = ref("");
let feedbackContextGeneration = 0;
let feedbackContextRequest: AbortController | null = null;
const feedbackSession = computed(() => feedbackSessions.value.find(item => item.id === feedbackSessionId.value));
watch(feedbackSessionId, () => { feedbackHelperEmail.value = ""; });
watch(fbCategory, category => {
  if (category !== "ta") { feedbackSessionId.value = ""; feedbackHelperEmail.value = ""; }
});

const openFeedbackModal = async () => {
  showFeedbackModal.value = true;
  feedbackContextRequest?.abort();
  const generation = ++feedbackContextGeneration;
  const controller = new AbortController();
  feedbackContextRequest = controller;
  feedbackContextLoading.value = true;
  feedbackContextError.value = "";
  feedbackSessions.value = [];
  try {
    const result = await $fetch<{ sessions: FeedbackSession[] }>(`/api/courses/${courseId}/feedback-context`, { signal: controller.signal });
    if (generation === feedbackContextGeneration && showFeedbackModal.value) feedbackSessions.value = result.sessions;
  } catch {
    if (!controller.signal.aborted && generation === feedbackContextGeneration) feedbackContextError.value = "Specific help feedback is temporarily unavailable.";
  } finally {
    if (generation === feedbackContextGeneration) feedbackContextLoading.value = false;
  }
};

const resetFeedback = () => {
  feedbackContextGeneration++;
  feedbackContextRequest?.abort();
  feedbackContextLoading.value = false;
  feedbackContextError.value = "";
  feedbackSessions.value = [];
  feedbackSessionId.value = "";
  feedbackHelperEmail.value = "";
  fbCategory.value = "queue";
  fbRating.value = 5;
  fbPositive.value = "";
  fbNegative.value = "";
  fbAllowContact.value = true;
};
onBeforeUnmount(() => { feedbackContextGeneration++; feedbackContextRequest?.abort(); });

/**
 * Submit structured course feedback.
 */
const submitFeedback = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (feedbackSessionId.value && !feedbackSession.value?.helpers.some(helper => helper.email === feedbackHelperEmail.value)) {
      alert("Choose the TA you are reviewing.");
      return;
    }
    if (!fbPositive.value.trim() || !fbNegative.value.trim()) {
      alert(
        'Please fill in both "What worked well" and "What can be improved".',
      );
      return;
    }

    fbSubmitting.value = true;
    try {
      await $fetch(`/api/courses/${courseId}/feedback`, {
        method: "POST",
        body: {
          category: fbCategory.value,
          rating: fbRating.value,
          positive: fbPositive.value.trim(),
          negative: fbNegative.value.trim(),
          allowContact: fbAllowContact.value,
          ...(fbCategory.value === "ta" && feedbackSessionId.value ? { helpSessionId: feedbackSessionId.value, taEmail: feedbackHelperEmail.value } : {}),
        },
      });

      alert("Thank you for your feedback!");
      showFeedbackModal.value = false;
      resetFeedback();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to submit feedback"));
    } finally {
      fbSubmitting.value = false;
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Format announcement timestamp.
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
 * Open join/edit modal with state validation.
 */
const openJoinModal = () => {
  editingEntryId.value = myEntry.value?.id || null;
  if (myEntry.value) {
    joinLocation.value = myEntry.value.location || "";
    joinQuestion.value = myEntry.value.question || "";
    showJoinModal.value = true;
    return;
  }

  if (!isEnrolled.value) {
    alert("Please enroll in this course before joining the queue.");
    return;
  }

  if (isClosed.value) {
    alert("The queue is currently CLOSED. Please check back later.");
    return;
  }

  if (isPaused.value) {
    alert(
      "The queue is currently PAUSED. TAs are temporarily not accepting new questions.",
    );
    return;
  }

  joinLocation.value = "";
  joinQuestion.value = "";
  showJoinModal.value = true;
};

/**
 * Create or update the student's queue entry.
 */
const submitJoin = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    const location = joinLocation.value.trim();
    const question = (joinQuestion.value || "").trim();
    if (!location) {
      alert("Please enter your location.");
      return;
    }

    try {
      await $fetch(`/api/courses/${courseId}/queue/join`, {
        method: "POST",
        body: { action: editingEntryId.value ? "edit" : "join", entryId: editingEntryId.value || undefined, location, question },
      });
      showJoinModal.value = false;
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to join queue"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Remove current user from queue.
 */
const leaveQueue = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!myEntry.value) return;
    try {
      await $fetch(`/api/courses/${courseId}/queue/leave`, {
        method: "POST",
        body: { entryId: myEntry.value.id },
      });
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to leave queue"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Pause/resume this student's own queue entry.
 */
const togglePauseSelf = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!myEntry.value) return;
    try {
      await $fetch(`/api/courses/${courseId}/queue/pause`, {
        method: "POST",
        body: {
          entryId: myEntry.value.id,
          paused: !myEntry.value.paused,
        },
      });
      await refresh();
    } catch (e: any) {
      alert(apiErrorMessage(e, "Failed to update status"));
    }
  } finally {
    busyActions.value = false;
  }
};

/**
 * Lightweight polling to keep queue state fresh (skipped in background tabs).
 */
useIntervalRefresh((options) => busyActions.value ? Promise.resolve() : refresh(options), 2000);

/**
 * Navigation + auth actions.
 */
const logout = signOut;

const goBack = () => {
  router.push("/courses");
};

const goHelp = () => {
  navigateWithContext("/help");
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

          <section v-if="myPosition" class="panel queue-position-panel">
            <div
              class="panel-body queue-position-card"
              data-testid="queue-position"
            >
              You are #{{ myPosition }} in the queue.
              <div v-if="myHelper" class="position-note helping">
                {{ myHelper }} is helping you now.
              </div>
              <div v-else-if="myEntry?.paused" class="position-note">
                Your entry is paused. Resume when you are ready.
              </div>
              <div v-else-if="myEntry?.otherTa" class="position-note">
                Waiting for another TA to pick you up.
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">Queue Controls</div>
            <div class="panel-body controls-body">
              <p v-if="course.restricted" class="enroll-hint">Course access restricted.</p>
              <template v-else-if="!isEnrolled">
                <p class="enroll-hint">
                  You are not enrolled in this course yet. Enroll to join the
                  queue and leave feedback.
                </p>
                <button
                  class="primary-btn"
                  :disabled="busyActions || enrolling"
                  @click="enroll"
                  data-testid="course-enroll-btn"
                >
                  {{ enrolling ? "Enrolling…" : "Enroll in this course" }}
                </button>
              </template>

              <template v-else-if="!myEntry">
                <button
                  class="primary-btn"
                  @click="openJoinModal"
                  :disabled="!canStudentJoin"
                  data-testid="enter-queue-btn"
                >
                  {{
                    isOpen
                      ? "Enter Queue"
                      : isPaused
                        ? "Queue Paused"
                        : "Queue Closed"
                  }}
                </button>
              </template>

              <template v-else>
                <button
                  class="outline-btn"
                  @click="openJoinModal"
                  data-testid="edit-entry-btn"
                >
                  Edit Entry
                </button>
                <button
                  :disabled="busyActions"
                  class="outline-btn"
                  @click="togglePauseSelf"
                  data-testid="pause-self-btn"
                >
                  {{ myEntry.paused ? "Resume" : "Pause" }}
                </button>
                <button
                  :disabled="busyActions"
                  class="danger-btn"
                  @click="leaveQueue"
                  data-testid="leave-queue-btn"
                >
                  Leave Queue
                </button>
              </template>

              <div class="logged-as">
                Logged in as
                <span>{{ user.email }}</span>
              </div>

              <button
                v-if="isEnrolled"
                class="outline-btn"
                type="button"
                @click="openFeedbackModal"
                data-testid="feedback-open-btn"
              >
                Give Feedback for this course
              </button>
            </div>
          </section>
        </div>

        <div class="right-column">
          <section class="panel">
            <div class="panel-header">Announcements</div>
            <div
              class="panel-body announcements-body"
              tabindex="0"
              role="region"
              aria-label="Course announcements"
            >
              <table v-if="announcements.length" class="ann-table">
                <thead>
                  <tr>
                    <th class="ann-col-datetime">Date / Time</th>
                    <th class="ann-col-by">Posted By</th>
                    <th class="ann-col-msg">Announcement</th>
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
                      <AnnouncementMessage :text="a.message" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-text">No announcements yet.</div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">Live Queue</div>
            <div
              class="panel-body queue-panel"
              tabindex="0"
              role="region"
              aria-label="Live help queue table"
            >
              <table class="queue-table">
                <thead>
                  <tr>
                    <th class="col-num">#</th>
                    <th class="col-student">Student</th>
                    <th class="col-location">Location</th>
                    <th class="col-question">Question</th>
                    <th class="col-ta">TA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(entry, idx) in queueEntries"
                    :key="entry.id"
                    :class="[
                      'queue-row',
                      {
                        'is-self': entry.isMine,
                        'is-paused': entry.paused,
                        'is-assigned-self':
                          !entry.paused && !!entry.ta && !entry.otherTa,
                      },
                    ]"
                    :data-testid="entry.isMine ? 'queue-row-mine' : 'queue-row'"
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
                  </tr>

                  <tr v-if="!queueEntries.length">
                    <td colspan="5" class="empty-text">
                      {{
                        isEnrolled
                          ? "No one is currently in the queue."
                          : "Enroll in this course to see the live queue."
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <!-- Join / edit queue modal -->
      <div v-if="showJoinModal" class="modal-backdrop">
        <div
          class="modal"
          v-accessible-dialog="{
            label: myEntry ? 'Edit Queue Entry' : 'Join Queue',
            close: () => {
              if (!busyActions) showJoinModal = false;
            },
          }"
        >
          <div class="modal-header">
            <div class="modal-title">
              {{ myEntry ? "Edit Queue Entry" : "Join Queue" }}
            </div>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Name</label>
              <div class="readonly-input">
                {{ user.name || user.email }}
              </div>
            </div>
            <div class="field">
              <label for="join-location">Location</label>
              <input
                id="join-location"
                v-model="joinLocation"
                class="text-input"
                placeholder="e.g. Zoom link / Room number"
                data-testid="join-location"
              />
            </div>
            <div class="field">
              <label for="join-question">Question</label>
              <textarea
                id="join-question"
                v-model="joinQuestion"
                class="text-area"
                rows="3"
                placeholder="Briefly describe what you need help with"
                data-testid="join-question"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button class="outline-btn" @click="showJoinModal = false">
              Cancel
            </button>
            <button
              :disabled="busyActions"
              class="primary-btn"
              @click="submitJoin"
              data-testid="join-confirm"
            >
              {{ myEntry ? "Save" : "Join Queue" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Course feedback modal -->
      <div v-if="showFeedbackModal" class="modal-backdrop">
        <div
          class="modal"
          v-accessible-dialog="{
            label: 'Course Feedback',
            close: () => {
              if (!busyActions) {
                showFeedbackModal = false;
                resetFeedback();
              }
            },
          }"
        >
          <div class="modal-header">
            <div class="modal-title">Course Feedback</div>
          </div>

          <div class="modal-body">
            <p class="feedback-privacy">
              Course instructors and administrators can see your name and
              feedback. Declining follow-up contact does not make this feedback
              anonymous.
            </p>
            <div class="field">
              <label>Course</label>
              <div class="readonly-input">
                {{ course?.code || courseId }}
                –
                {{ course?.title || "CampusWorks Course" }}
              </div>
            </div>

            <div class="field">
              <label for="feedback-category">Topic</label>
              <select
                id="feedback-category"
                v-model="fbCategory"
                class="text-input"
                data-testid="fb-category"
              >
                <option value="queue">Queue / system</option>
                <option value="ta">TA support</option>
                <option value="wait">Wait time</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div v-if="fbCategory === 'ta'" class="feedback-target-row">
              <div class="field">
                <label for="feedback-help-session">Feedback about</label>
                <select id="feedback-help-session" v-model="feedbackSessionId" class="text-input" data-testid="fb-help-session" :disabled="feedbackContextLoading || fbSubmitting">
                  <option value="">Course-level TA support</option>
                  <option v-for="item in feedbackSessions" :key="item.id" :value="item.id">Help on {{ new Date(item.at).toLocaleString() }}</option>
                </select>
              </div>
              <div v-if="feedbackSession" class="field">
                <label for="feedback-helper">TA</label>
                <select id="feedback-helper" v-model="feedbackHelperEmail" class="text-input" data-testid="fb-helper" :disabled="fbSubmitting">
                  <option value="">Choose the TA</option>
                  <option v-for="helper in feedbackSession.helpers" :key="helper.email" :value="helper.email">{{ helper.name }}</option>
                </select>
              </div>
              <p v-if="feedbackContextError" class="feedback-target-notice" role="status">{{ feedbackContextError }}</p>
            </div>

            <div class="field">
              <label for="feedback-rating">Overall rating (1–5)</label>
              <select
                id="feedback-rating"
                v-model.number="fbRating"
                class="text-input"
                data-testid="fb-rating"
              >
                <option :value="5">5 - Excellent</option>
                <option :value="4">4 - Good</option>
                <option :value="3">3 - Okay / Neutral</option>
                <option :value="2">2 - Needs improvement</option>
                <option :value="1">1 - Poor</option>
              </select>
            </div>

            <div class="field">
              <label for="feedback-positive"> What worked well? </label>
              <textarea
                id="feedback-positive"
                v-model="fbPositive"
                class="text-area"
                rows="3"
                data-testid="fb-positive"
              />
            </div>

            <div class="field">
              <label for="feedback-negative"> What can be improved? </label>
              <textarea
                id="feedback-negative"
                v-model="fbNegative"
                class="text-area"
                rows="3"
                data-testid="fb-negative"
              />
            </div>

            <div class="field">
              <label class="checkbox-label">
                <input type="checkbox" v-model="fbAllowContact" />
                Allow course staff to contact me by email if needed.
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button
              class="outline-btn"
              type="button"
              :disabled="fbSubmitting"
              @click="
                showFeedbackModal = false;
                resetFeedback();
              "
            >
              Cancel
            </button>
            <button
              class="primary-btn"
              type="button"
              :disabled="busyActions || fbSubmitting"
              @click="submitFeedback"
              data-testid="fb-submit"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.feedback-target-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 0 12px;
}
.feedback-target-notice {
  grid-column: 1 / -1;
  margin: 0 0 12px;
  color: #536174;
  font-size: 12px;
}
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
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}

.help-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 10px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
}

.user-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.user-email {
  font-size: 11px;
}

.logout-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 32px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: transparent;
  color: #ffffff;
  font-size: 10px;
  line-height: 1.3;
  cursor: pointer;
}

.content {
  max-width: 1300px;
  margin: 24px auto 40px;
  padding: 0 24px 40px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 24px;
  margin-bottom: 18px;
  border-radius: 999px;
  border: none;
  background: #e5ecff;
  color: #012169;
  font-weight: 500;
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
}

.course-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-end;
  margin-bottom: 4px;
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

.queue-position-panel {
  margin-top: 4px;
}

.queue-position-card {
  padding: 10px 14px;
  border-radius: 10px;
  background: #eff6ff;
  color: #111827;
  font-weight: 600;
  font-size: 16px;
  text-align: center;
}

.position-note {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #4b5563;
}

.position-note.helping {
  color: #15803d;
}

.enroll-hint {
  margin: 0;
  font-size: 13px;
  color: #4b5563;
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

.primary-btn,
.outline-btn,
.danger-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.35;
  cursor: pointer;
  transition: all 0.15s ease;
}

.primary-btn {
  background: #17408b;
  color: #ffffff;
  border: 1px solid transparent;
}

.primary-btn:hover {
  background: #012169;
  transform: translateY(-1px);
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
  border: 1px solid transparent;
}

.danger-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

.controls-body > .primary-btn,
.controls-body > .outline-btn,
.controls-body > .danger-btn {
  width: 100%;
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

.announcements-body {
  max-height: 180px;
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
  width: 180px;
}

.ann-col-by {
  width: 150px;
}

.ann-col-msg {
  width: auto;
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

.queue-panel {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.queue-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 14px;
}

.queue-table th,
.queue-table td {
  box-sizing: border-box;
  padding: 9px 14px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
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
  width: 1%;
  white-space: nowrap;
}

.col-location {
  width: 24%;
  overflow-wrap: anywhere;
}

.col-question {
  width: auto;
  overflow-wrap: anywhere;
}

.col-ta {
  width: 1%;
  white-space: nowrap;
  text-align: center;
}

.queue-row.is-self {
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.18);
}

.queue-row.is-paused {
  background: #fef9c3;
}

.queue-row.is-assigned-self {
  background: #bfdbfe;
  border-left: 3px solid #2563eb;
}

.empty-text {
  padding: 10px 14px;
  font-size: 13px;
  color: #536174;
  text-align: left;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}

.modal {
  width: 420px;
  max-width: calc(100% - 40px);
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 25px 80px rgba(15, 23, 42, 0.3);
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 14px 18px 8px;
}

.modal-title {
  font-weight: 600;
  font-size: 18px;
  color: #111827;
}

.modal-body {
  padding: 0 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field label {
  display: block;
  font-size: 12px;
  color: #536174;
  margin-bottom: 4px;
}

.checkbox-label {
  font-size: 12px;
  color: #4b5563;
  display: flex;
  align-items: center;
  gap: 8px;
}

.readonly-input {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f3f4f6;
  font-size: 14px;
  color: #111827;
}

.text-input,
.text-area {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
}

.modal-footer {
  padding: 10px 18px 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.modal-footer > button {
  flex: 0 1 auto;
  min-width: 88px;
}

@media (max-width: 900px) {
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

  .announcements-body {
    max-height: none;
  }

  .queue-table {
    font-size: 12px;
  }

  .panel-body {
    padding: 10px 12px 12px;
  }

  .panel-body.queue-panel,
  .panel-body.announcements-body {
    overflow-x: auto;
  }

  .modal {
    width: 100%;
    max-width: 420px;
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
