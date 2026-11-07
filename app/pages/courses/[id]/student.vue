<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount
} from 'vue'
import {
  useRoute,
  useRouter,
  useAsyncData,
  useRequestFetch,
  navigateTo,
  refreshNuxtData
} from '#app'

type Announcement = {
  id: string
  at: string
  by: string
  message: string
}

type QueueEntry = {
  id: string
  email: string
  name: string
  location: string
  question: string
  paused: boolean
  ta: string
  otherTa?: boolean
  position?: number
  isMine?: boolean
}

type CourseApiResult = {
  id: string
  code: string
  title: string
  state: string
  role?: string | null
  enrolled: boolean
  isStaff: boolean
  user: { email: string; name?: string }
  announcements: Announcement[]
  queue: QueueEntry[]
  queueLength?: number
  onDutyTAs?: string[]
}

/**
 * Load course + queue state for this student-facing view.
 */
const route = useRoute()
const router = useRouter()
const courseId = route.params.id as string
const requestFetch = useRequestFetch()

const { data, error } = await useAsyncData<CourseApiResult>(
  `course-student-${courseId}`,
  () => requestFetch<CourseApiResult>(`/api/courses/${courseId}`)
)

if (error.value) {
  const status = (error.value as any).statusCode
  if (status === 401) {
    useAuthUser().value = null
    await navigateTo('/login')
  } else {
    await navigateTo('/courses')
  }
}

const course = computed(() => data.value)
const user = computed(() => course.value?.user || { email: '', name: '' })

/**
 * Staff use the TA view of the same course.
 */
const isStaff = computed(() => !!course.value?.isStaff)
const isEnrolled = computed(() => !!course.value?.enrolled)

if (isStaff.value) {
  await navigateTo(`/courses/${courseId}/ta`, { replace: true })
}

/**
 * Queue state normalization and derived flags.
 */
const normalizeState = (
  s?: string
): 'open' | 'closed' | 'paused' => {
  const v = (s || 'closed').toLowerCase()
  if (v === 'open') return 'open'
  if (v === 'paused') return 'paused'
  return 'closed'
}

const queueStatus = ref<'open' | 'closed' | 'paused'>(
  normalizeState(course.value?.state)
)

watch(
  () => course.value?.state,
  (v) => {
    queueStatus.value = normalizeState(v)
  }
)

const isOpen = computed(
  () => queueStatus.value === 'open'
)
const isPaused = computed(
  () => queueStatus.value === 'paused'
)
const isClosed = computed(
  () => queueStatus.value === 'closed'
)

const onDutyTAs = computed(
  () => course.value?.onDutyTAs || []
)

/**
 * Reactive queue and announcements.
 */
const queueEntries = ref<QueueEntry[]>(
  course.value?.queue || []
)
watch(
  () => course.value?.queue,
  (val) => {
    queueEntries.value = val || []
  }
)

const announcements = ref<Announcement[]>(
  course.value?.announcements || []
)
watch(
  () => course.value?.announcements,
  (val) => {
    announcements.value = val || []
  }
)

const queueLength = computed(
  () => course.value?.queueLength ?? queueEntries.value.length
)

const myEntry = computed<QueueEntry | null>(
  () => queueEntries.value.find((e) => e.isMine) || null
)

const myPosition = computed(() => {
  if (!myEntry.value) return null
  const idx = queueEntries.value.findIndex(
    (e) => e.id === myEntry.value!.id
  )
  return idx >= 0 ? idx + 1 : null
})

/** TA currently helping the student, if any. */
const myHelper = computed(() =>
  myEntry.value && !myEntry.value.otherTa && !myEntry.value.paused
    ? myEntry.value.ta
    : ''
)

const canStudentJoin = computed(
  () => isOpen.value && isEnrolled.value
)

/**
 * Enroll from the course page (joining the queue requires an enrollment).
 */
const enrolling = ref(false)

const enroll = async () => {
  enrolling.value = true
  try {
    await $fetch('/api/courses/enroll', {
      method: 'POST',
      body: { courseId, enroll: true }
    })
    await refreshNuxtData(`course-student-${courseId}`)
  } catch (e: any) {
    alert(apiErrorMessage(e, 'Enroll failed'))
  } finally {
    enrolling.value = false
  }
}

/**
 * Join/edit queue modal state.
 */
const showJoinModal = ref(false)
const joinLocation = ref('')
const joinQuestion = ref('')

/**
 * Feedback modal state.
 */
const showFeedbackModal = ref(false)

type FeedbackCategory = 'queue' | 'ta' | 'wait' | 'other'

const fbCategory = ref<FeedbackCategory>('queue')
const fbRating = ref(5)
const fbPositive = ref('')
const fbNegative = ref('')
const fbAllowContact = ref(true)
const fbSubmitting = ref(false)

const openFeedbackModal = () => {
  showFeedbackModal.value = true
}

const resetFeedback = () => {
  fbCategory.value = 'queue'
  fbRating.value = 5
  fbPositive.value = ''
  fbNegative.value = ''
  fbAllowContact.value = true
}

/**
 * Submit structured course feedback.
 */
const submitFeedback = async () => {
  if (!fbPositive.value.trim() || !fbNegative.value.trim()) {
    alert(
      'Please fill in both "What worked well" and "What can be improved".'
    )
    return
  }

  fbSubmitting.value = true
  try {
    await $fetch(
      `/api/courses/${courseId}/feedback`,
      {
        method: 'POST',
        body: {
          category: fbCategory.value,
          rating: fbRating.value,
          positive: fbPositive.value.trim(),
          negative: fbNegative.value.trim(),
          allowContact: fbAllowContact.value
        }
      }
    )

    alert('Thank you for your feedback!')
    showFeedbackModal.value = false
    resetFeedback()
  } catch (e: any) {
    alert(apiErrorMessage(e, 'Failed to submit feedback'))
  } finally {
    fbSubmitting.value = false
  }
}

/**
 * Format announcement timestamp.
 */
const formatAt = (at: string) => {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(
    d.getMonth() + 1
  )}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

/**
 * Open join/edit modal with state validation.
 */
const openJoinModal = () => {
  if (myEntry.value) {
    joinLocation.value = myEntry.value.location || ''
    joinQuestion.value = myEntry.value.question || ''
    showJoinModal.value = true
    return
  }

  if (!isEnrolled.value) {
    alert('Please enroll in this course before joining the queue.')
    return
  }

  if (isClosed.value) {
    alert(
      'The queue is currently CLOSED. Please check back later.'
    )
    return
  }

  if (isPaused.value) {
    alert(
      'The queue is currently PAUSED. TAs are temporarily not accepting new questions.'
    )
    return
  }

  joinLocation.value = ''
  joinQuestion.value = ''
  showJoinModal.value = true
}

/**
 * Create or update the student's queue entry.
 */
const submitJoin = async () => {
  const location = joinLocation.value.trim()
  const question = (joinQuestion.value || '').trim()
  if (!location) {
    alert('Please enter your location.')
    return
  }

  try {
    await $fetch(
      `/api/courses/${courseId}/queue/join`,
      {
        method: 'POST',
        body: { location, question }
      }
    )
    showJoinModal.value = false
    await refreshNuxtData(`course-student-${courseId}`)
  } catch (e: any) {
    alert(apiErrorMessage(e, 'Failed to join queue'))
  }
}

/**
 * Remove current user from queue.
 */
const leaveQueue = async () => {
  if (!myEntry.value) return
  try {
    await $fetch(
      `/api/courses/${courseId}/queue/leave`,
      {
        method: 'POST'
      }
    )
    await refreshNuxtData(`course-student-${courseId}`)
  } catch (e: any) {
    alert(apiErrorMessage(e, 'Failed to leave queue'))
  }
}

/**
 * Pause/resume this student's own queue entry.
 */
const togglePauseSelf = async () => {
  if (!myEntry.value) return
  try {
    await $fetch(
      `/api/courses/${courseId}/queue/pause`,
      {
        method: 'POST',
        body: {
          entryId: myEntry.value.id,
          paused: !myEntry.value.paused
        }
      }
    )
    await refreshNuxtData(`course-student-${courseId}`)
  } catch (e: any) {
    alert(apiErrorMessage(e, 'Failed to update status'))
  }
}

/**
 * Lightweight polling to keep queue state fresh (skipped in background tabs).
 */
let timer: any = null

onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden) refreshNuxtData(`course-student-${courseId}`)
  }, 2000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

/**
 * Navigation + auth actions.
 */
const logout = signOut

const goBack = () => {
  router.push('/courses')
}

const goHelp = () => {
  navigateTo('/help')
}
</script>

<template>
  <div v-if="course" class="page-root">
    <header class="app-navbar">
      <div class="app-left" @click="goBack">
        <img
          src="/duke-cs-logo.png"
          alt="Duke CS"
          class="app-logo"
        />
      </div>
      <div class="app-center" @click="goBack">
        <div class="brand-main">
          CampusWorks
        </div>
      </div>
      <div class="app-right">
        <button
          class="help-link"
          type="button"
          @click="goHelp"
        >
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

    <main class="content">
      <button
        class="back-btn"
        type="button"
        @click="goBack"
      >
        ← Back to Courses
      </button>

      <section class="course-header">
        <div class="course-title-block">
          <h1 class="course-code">
            {{ course.code || courseId }}
          </h1>
          <div class="course-subtitle">
            {{ course.title || 'CampusWorks Course' }}
          </div>
        </div>
        <div class="course-state">
          <div class="meta-label">
            State:
            <span
              class="state-pill"
              :class="{
                closed: isClosed,
                paused: isPaused
              }"
              data-testid="queue-state"
            >
              {{
                isOpen
                  ? 'Open'
                  : isPaused
                  ? 'Paused'
                  : 'Closed'
              }}
            </span>
          </div>
          <div class="meta-label">
            Length: {{ queueLength }}
          </div>
        </div>
      </section>

      <section class="layout">
        <div class="left-column">
          <section class="panel">
            <div class="panel-header">
              TA on Duty
            </div>
            <div class="panel-body ta-body">
              <template v-if="onDutyTAs.length">
                <div
                  v-for="ta in onDutyTAs"
                  :key="ta"
                  class="ta-name"
                >
                  {{ ta }}
                </div>
              </template>
              <span v-else>
                No TA currently marked on duty.
              </span>
            </div>
          </section>

          <section
            v-if="myPosition"
            class="panel queue-position-panel"
          >
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
            <div class="panel-header">
              Queue Controls
            </div>
            <div class="panel-body controls-body">
              <template v-if="!isEnrolled">
                <p class="enroll-hint">
                  You are not enrolled in this course yet. Enroll to join
                  the queue and leave feedback.
                </p>
                <button
                  class="primary-btn"
                  :disabled="enrolling"
                  @click="enroll"
                  data-testid="course-enroll-btn"
                >
                  {{ enrolling ? 'Enrolling…' : 'Enroll in this course' }}
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
                      ? 'Enter Queue'
                      : isPaused
                      ? 'Queue Paused'
                      : 'Queue Closed'
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
                  class="outline-btn"
                  @click="togglePauseSelf"
                  data-testid="pause-self-btn"
                >
                  {{
                    myEntry.paused
                      ? 'Resume'
                      : 'Pause'
                  }}
                </button>
                <button
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
            <div class="panel-header">
              Announcements
            </div>
            <div class="panel-body announcements-body">
              <table
                v-if="announcements.length"
                class="ann-table"
              >
                <thead>
                  <tr>
                    <th class="ann-col-datetime">
                      Date / Time
                    </th>
                    <th class="ann-col-by">
                      Posted By
                    </th>
                    <th class="ann-col-msg">
                      Announcement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="a in announcements"
                    :key="a.id"
                  >
                    <td class="ann-datetime">
                      {{ formatAt(a.at) }}
                    </td>
                    <td class="ann-poster">
                      {{ a.by }}
                    </td>
                    <td class="ann-message">
                      {{ a.message }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div
                v-else
                class="empty-text"
              >
                No announcements yet.
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              Live Queue
            </div>
            <div class="panel-body">
              <table class="queue-table">
                <thead>
                  <tr>
                    <th class="col-num">#</th>
                    <th class="col-student">
                      Student
                    </th>
                    <th class="col-location">
                      Location
                    </th>
                    <th class="col-question">
                      Question
                    </th>
                    <th class="col-ta">TA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(
                      entry, idx
                    ) in queueEntries"
                    :key="entry.id"
                    :class="[
                      'queue-row',
                      {
                        'is-self': entry.isMine,
                        'is-paused':
                          entry.paused,
                        'is-assigned-self':
                          !entry.paused &&
                          !!entry.ta &&
                          !entry.otherTa
                      }
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
                      {{
                        entry.question ||
                        '—'
                      }}
                    </td>
                    <td class="col-ta">
                      {{
                        entry.otherTa
                          ? 'Needs another TA'
                          : entry.ta || '—'
                      }}
                    </td>
                  </tr>

                  <tr v-if="!queueEntries.length">
                    <td
                      colspan="5"
                      class="empty-text"
                    >
                      {{
                        isEnrolled
                          ? 'No one is currently in the queue.'
                          : 'Enroll in this course to see the live queue.'
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
      <div
        v-if="showJoinModal"
        class="modal-backdrop"
      >
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">
              {{
                myEntry
                  ? 'Edit Queue Entry'
                  : 'Join Queue'
              }}
            </div>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Name</label>
              <div class="readonly-input">
                {{
                  user.name ||
                  user.email
                }}
              </div>
            </div>
            <div class="field">
              <label>Location</label>
              <input
                v-model="joinLocation"
                class="text-input"
                placeholder="e.g. Zoom link / Room number"
                data-testid="join-location"
              />
            </div>
            <div class="field">
              <label>Question</label>
              <textarea
                v-model="joinQuestion"
                class="text-area"
                rows="3"
                placeholder="Briefly describe what you need help with"
                data-testid="join-question"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button
              class="outline-btn"
              @click="showJoinModal = false"
            >
              Cancel
            </button>
            <button
              class="primary-btn"
              @click="submitJoin"
              data-testid="join-confirm"
            >
              {{
                myEntry
                  ? 'Save'
                  : 'Join Queue'
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- Course feedback modal -->
      <div
        v-if="showFeedbackModal"
        class="modal-backdrop"
      >
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">
              Course Feedback
            </div>
          </div>

          <div class="modal-body">
            <div class="field">
              <label>Course</label>
              <div class="readonly-input">
                {{ course.code || courseId }}
                –
                {{
                  course.title ||
                  'CampusWorks Course'
                }}
              </div>
            </div>

            <div class="field">
              <label>Topic</label>
              <select
                v-model="fbCategory"
                class="text-input"
                data-testid="fb-category"
              >
                <option value="queue">
                  Queue / system
                </option>
                <option value="ta">
                  TA support
                </option>
                <option value="wait">
                  Wait time
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </div>

            <div class="field">
              <label>Overall rating (1–5)</label>
              <select
                v-model.number="fbRating"
                class="text-input"
                data-testid="fb-rating"
              >
                <option :value="5">
                  5 - Excellent
                </option>
                <option :value="4">
                  4 - Good
                </option>
                <option :value="3">
                  3 - Okay / Neutral
                </option>
                <option :value="2">
                  2 - Needs improvement
                </option>
                <option :value="1">
                  1 - Poor
                </option>
              </select>
            </div>

            <div class="field">
              <label>
                What worked well?
              </label>
              <textarea
                v-model="fbPositive"
                class="text-area"
                rows="3"
                data-testid="fb-positive"
              />
            </div>

            <div class="field">
              <label>
                What can be improved?
              </label>
              <textarea
                v-model="fbNegative"
                class="text-area"
                rows="3"
                data-testid="fb-negative"
              />
            </div>

            <div class="field">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  v-model="fbAllowContact"
                />
                Allow course staff to
                contact me by email
                if needed.
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
              :disabled="fbSubmitting"
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
.page-root {
  min-height: 100vh;
  background: #f3f5fa;
  color: #111827;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
  color: #ffffff;
}

.state-pill.closed {
  background: #ef4444;
}

.state-pill.paused {
  background: #f59e0b;
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
  color: #6b7280;
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
  width: 100%;
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
  color: #6b7280;
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
  width: 60px;
}

.col-location {
  width: 260px;
}

.col-question {
  width: 360px;
}

.col-ta {
  width: 120px;
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
  color: #6b7280;
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
  color: #6b7280;
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
  justify-content: flex-end;
  gap: 8px;
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

