<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const busyActions = ref(false);

import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import {
  useAsyncData,
  useRequestFetch,
  useRouter,
  navigateTo,
  refreshNuxtData,
} from "#app";

type CourseRow = {
  id: string;
  code: string;
  title: string;
  state?: "open" | "paused" | "closed";
  enrolled: boolean;
  primaryRole?: string | null;
};

type CoursesApiResult = {
  user: AuthUser;
  courses: CourseRow[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
};

const router = useRouter();
const requestFetch = useRequestFetch();
const staffingAccess = useStaffingCapabilities();
async function refreshStaffingAccess() {
  try {
    staffingAccess.value = await requestFetch<StaffingCapabilities>(
      "/api/staffing/capabilities",
    );
  } catch (error: any) {
    staffingAccess.value = null;
    if ((error?.statusCode || error?.response?.status) === 401) {
      capturedUser.value = null;
      await navigateWithContext("/login", { replace: true });
    }
  }
}
const catalog = useCourseCatalogLoader<CourseRow>();

const { data, error } = await useAsyncData<CoursesApiResult>(
  "courses",
  catalog.load,
);

if (error.value) {
  const status = (error.value as any).statusCode;
  if (status === 401) {
    capturedUser.value = null;
    await navigateWithContext("/login");
  }
}

const user = computed(() => data.value?.user || null);

const stateLabel = (c: CourseRow) =>
  c.state === "open" ? "Open" : c.state === "paused" ? "Paused" : "Closed";

/**
 * Local mutable copy to support responsive UI updates
 * while the underlying async data is refreshed.
 */
const coursesState = ref<CourseRow[]>(data.value?.courses || []);

watch(
  () => data.value?.courses,
  (val) => {
    if (val) {
      coursesState.value = val.map((c) => ({ ...c }));
    }
  },
);

const courses = computed(() => coursesState.value);

const isInstructorOrAdmin = (c: CourseRow) =>
  c.primaryRole === "admin" || c.primaryRole === "instructor";

const isTA = (c: CourseRow) => c.primaryRole === "ta";

const isStudentEnrolled = (c: CourseRow) =>
  c.primaryRole === "student" ||
  (!!c.enrolled && !isInstructorOrAdmin(c) && !isTA(c));

const roleLabel = (c: CourseRow) => {
  if (isInstructorOrAdmin(c)) return "Instructor/Admin";
  if (isTA(c)) return "TA";
  if (isStudentEnrolled(c)) return "Student";
  if (c.enrolled) return "Enrolled";
  return "Not enrolled";
};

const myCourses = computed(() =>
  courses.value.filter(
    (c) => isInstructorOrAdmin(c) || isTA(c) || isStudentEnrolled(c),
  ),
);

const allCourses = computed(() => courses.value);

/** Only pure student membership is user-toggleable here. */
const isStudentToggleable = (c: CourseRow) =>
  !isInstructorOrAdmin(c) && !isTA(c);

const toggleEnroll = async (course: CourseRow) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    const idx = coursesState.value.findIndex((c) => c.id === course.id);
    if (idx === -1) return;

    const current = coursesState.value[idx];
    if (!current || !isStudentToggleable(current)) return;

    const willEnroll = !current.enrolled;

    try {
      await $fetch("/api/courses/enroll", {
        method: "POST",
        body: {
          courseId: current.id,
          enroll: willEnroll,
        },
      });
      await refreshNuxtData("courses");
    } catch (e: any) {
      alert(apiErrorMessage(e, "Enroll failed"));
    }
  } finally {
    busyActions.value = false;
  }
};

const goToCourse = (course: CourseRow) => {
  if (isInstructorOrAdmin(course)) {
    router.push(`/courses/${course.id}/admin`);
  } else if (isTA(course)) {
    router.push(`/courses/${course.id}/ta`);
  } else {
    router.push(`/courses/${course.id}/student`);
  }
};

/** Periodically refresh course + enrollment data. */
let timer: any = null;

onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden) {
      refreshNuxtData("courses");
      refreshStaffingAccess();
    }
  }, 5000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const logout = signOut;

const goHelp = () => {
  navigateWithContext("/help");
};

const goAdminConsole = () => {
  navigateWithContext("/admin/courses");
};
</script>

<template>
  <div class="page-root">
    <header class="app-navbar">
      <NuxtLink to="/courses" class="app-left" aria-label="CampusWorks courses">
        <img
          src="/duke-cs-logo.png"
          alt="Duke Department of Computer Science"
          class="app-logo"
          width="381"
          height="70"
          decoding="async"
        />
      </NuxtLink>
      <div class="app-center">
        <div class="brand-main">CampusWorks</div>
      </div>
      <div class="app-right">
        <button
          v-if="user?.isGlobalAdmin"
          class="help-link"
          type="button"
          @click="goAdminConsole"
          data-testid="admin-console-link"
        >
          Admin Console
        </button>
        <button class="help-link" type="button" @click="goHelp">
          Help &amp; Info
        </button>
        <div v-if="user" class="user-pill">
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
      <h1 class="sr-only">Courses</h1>
      <StaffingNavigation />
      <section v-if="myCourses.length" class="panel">
        <div class="panel-header">My Courses</div>
        <table class="course-table" tabindex="0" aria-label="My courses">
          <thead>
            <tr>
              <th class="col-course">Course</th>
              <th class="col-role">Role</th>
              <th class="col-queue">Queue</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in myCourses"
              :key="c.id"
              :data-testid="`my-course-${c.id}`"
            >
              <td class="col-course">
                <div class="course-code">
                  {{ c.code }}
                </div>
                <div class="course-title">
                  {{ c.title }}
                </div>
              </td>
              <td class="col-role">
                <span class="role-pill">
                  {{ roleLabel(c) }}
                </span>
              </td>
              <td class="col-queue">
                <div class="action-row">
                  <span class="state-tag" :class="c.state || 'closed'">
                    {{ stateLabel(c) }}
                  </span>
                  <button
                    class="btn-go"
                    @click="goToCourse(c)"
                    :data-testid="`my-course-go-${c.id}`"
                  >
                    Go
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-header">All Available Courses</div>
        <div class="panel-subtitle">Enroll / leave your courses here.</div>
        <table class="course-table" tabindex="0" aria-label="Available courses">
          <thead>
            <tr>
              <th class="col-course">Course</th>
              <th class="col-role">Role</th>
              <th class="col-queue">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in allCourses"
              :key="c.id"
              :data-testid="`course-row-${c.id}`"
            >
              <td class="col-course">
                <div class="course-code">
                  {{ c.code }}
                </div>
                <div class="course-title">
                  {{ c.title }}
                </div>
              </td>
              <td class="col-role">
                <span
                  class="role-pill"
                  :class="{
                    muted: !c.enrolled && !c.primaryRole,
                  }"
                >
                  {{ roleLabel(c) }}
                </span>
              </td>
              <td class="col-queue">
                <div class="action-row">
                  <button
                    class="btn-go"
                    @click="goToCourse(c)"
                    :data-testid="`course-go-${c.id}`"
                  >
                    Go
                  </button>
                  <button
                    :disabled="busyActions"
                    v-if="isStudentToggleable(c)"
                    class="btn-enroll"
                    :class="{
                      'btn-leave': c.enrolled,
                    }"
                    @click="toggleEnroll(c)"
                    :data-testid="`course-enroll-${c.id}`"
                  >
                    {{ c.enrolled ? "Leave" : "Enroll" }}
                  </button>
                  <span v-else class="no-action"> Managed via role </span>
                </div>
              </td>
            </tr>
            <tr v-if="!allCourses.length">
              <td colspan="3" class="empty-text">No courses configured yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p
        v-if="data?.pagination?.hasMore"
        class="catalog-pagination"
        role="status"
      >
        Showing {{ courses.length }} of {{ data.pagination.total }} courses.
        <button
          type="button"
          :disabled="catalog.loadingMore.value"
          @click="catalog.more(() => refreshNuxtData('courses'))"
          data-testid="catalog-load-more"
        >
          Load more courses
        </button>
      </p>
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
}

.app-logo {
  height: 40px;
  object-fit: contain;
}

.app-center {
  display: flex;
  flex: 1;
  justify-content: center;
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
  max-width: 1100px;
  margin: 24px auto 40px;
  padding: 0 16px 32px;
}

.panel {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.06);
  margin-bottom: 24px;
  overflow: hidden;
}

.panel-header {
  background: #17408b;
  color: #ffffff;
  padding: 10px 20px;
  font-weight: 600;
  font-size: 18px;
}

.panel-subtitle {
  padding: 6px 20px 10px;
  font-size: 12px;
  color: #536174;
}

.course-table {
  width: 100%;
  border-collapse: collapse;
}

.course-table th,
.course-table td {
  padding: 8px 20px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
}

.course-table thead {
  background: #f9fafb;
}

.col-course {
  text-align: left;
}

.col-role,
.col-queue {
  width: 220px;
  text-align: center;
}

.course-code {
  font-weight: 600;
  color: #111827;
}

.course-title {
  font-size: 12px;
  color: #536174;
}

.role-pill {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: #012169;
  color: #ffffff;
  font-size: 11px;
  font-weight: 500;
}

.role-pill.muted {
  background: #e5e7eb;
  color: #4b5563;
}

.state-tag {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: #dc2626;
}

.state-tag.open {
  background: #10b981;

  color: #022c16;
}

.state-tag.paused {
  background: #f59e0b;

  color: #422006;
}

.btn-go,
.btn-enroll {
  min-width: 70px;
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-go {
  background: #17408b;
  color: #ffffff;
}

.btn-go:hover {
  background: #012169;
  transform: translateY(-1px);
}

.btn-enroll {
  background: #ffffff;
  border: 1px solid #17408b;
  color: #17408b;
}

.btn-enroll:hover {
  background: #17408b;
  color: #ffffff;
  transform: translateY(-1px);
}

.btn-enroll.btn-leave {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}

.btn-enroll.btn-leave:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}

.no-action {
  font-size: 11px;
  color: #596579;
}

.empty-text {
  padding: 14px 20px;
  font-size: 13px;
  color: #536174;
  text-align: left;
}

.action-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

@media (max-width: 900px) {
  .app-navbar {
    padding: 8px 16px;
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .app-left {
    order: 1;
  }

  .app-center {
    order: 2;
    width: 100%;
    justify-content: center;
    margin-top: 4px;
  }

  .app-right {
    order: 3;
    width: 100%;
    justify-content: flex-end;
  }

  .content {
    max-width: 100%;
    margin: 16px auto 24px;
    padding: 0 12px 24px;
  }

  .panel-header {
    padding-inline: 14px;
  }

  .panel-subtitle {
    padding-inline: 14px;
  }

  .course-table th,
  .course-table td {
    padding-inline: 14px;
    font-size: 13px;
  }

  .col-role,
  .col-queue {
    width: 180px;
  }

  .action-row {
    flex-wrap: wrap;
  }

  .panel .course-table {
    display: block;
    overflow-x: auto;
  }
}

@media (max-width: 600px) {
  .brand-main {
    font-size: 16px;
  }

  .user-email {
    display: none;
  }

  .app-navbar {
    padding-inline: 10px;
  }

  .course-table th,
  .course-table td {
    padding-inline: 10px;
  }

  .btn-go,
  .btn-enroll {
    min-width: 64px;
    padding-inline: 10px;
    font-size: 12px;
  }

  .course-title {
    font-size: 11px;
  }

  .role-pill {
    font-size: 10px;
    padding-inline: 8px;
  }
}
</style>
