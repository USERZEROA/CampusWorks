<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
const busyActions = ref(false);

import { computed, ref } from "vue";
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
  state?: string;
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
const catalog = useCourseCatalogLoader<CourseRow>();

const { data, error } = await useAsyncData<CoursesApiResult>(
  "admin-courses",
  catalog.load,
);

if (error.value) {
  capturedUser.value = null;
  await navigateWithContext("/login");
}

const user = computed(() => data.value?.user || null);

// Site-wide admin console (mock "admin" role or ADMIN_EMAILS).
const isAdmin = computed(() => !!user.value?.isGlobalAdmin);

if (data.value && !isAdmin.value) {
  await navigateWithContext("/courses");
}

const courses = computed<CourseRow[]>(() => data.value?.courses || []);

const newCode = ref("");
const newTitle = ref("");

const canCreate = computed(
  () => !!newCode.value.trim() && !!newTitle.value.trim(),
);

// Create a new course (code+title); refresh listing on success.
const createCourse = async () => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isAdmin.value || !canCreate.value) return;
    try {
      await $fetch("/api/courses", {
        method: "POST",
        body: {
          code: newCode.value.trim(),
          title: newTitle.value.trim(),
        },
      });
      newCode.value = "";
      newTitle.value = "";
      await refreshNuxtData("admin-courses");
    } catch (e: any) {
      alert(apiErrorMessage(e, "Create failed"));
    }
  } finally {
    busyActions.value = false;
  }
};

const goCourse = (c: CourseRow) => {
  router.push(`/courses/${c.id}/admin`);
};

// Hard delete a course and all related data (enrollments, queue, sessions,
// announcements, feedback).
const deleteCourse = async (c: CourseRow) => {
  if (busyActions.value) return;
  busyActions.value = true;
  try {
    if (!isAdmin.value) return;
    const ok = window.confirm(
      `Delete course "${c.code}" and all of its enrollments, queue, sessions and feedback?`,
    );
    if (!ok) return;
    try {
      await $fetch(`/api/courses/${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      await refreshNuxtData("admin-courses");
    } catch (e: any) {
      alert(apiErrorMessage(e, "Delete failed"));
    }
  } finally {
    busyActions.value = false;
  }
};

const logout = signOut;

const goHelp = () => {
  navigateWithContext("/help");
};
</script>

<template>
  <div class="page-root">
    <header class="app-navbar">
      <button
        type="button"
        class="app-left"
        aria-label="Back to courses"
        @click="navigateTo('/courses')"
      >
        <img src="/duke-cs-logo.png" alt="Duke CS" class="app-logo" />
      </button>
      <div class="app-center">
        <div class="brand-main">CampusWorks – Admin Console</div>
      </div>
      <div class="app-right">
        <button class="help-link" type="button" @click="navigateTo('/courses')">
          My Courses
        </button>
        <button class="help-link" type="button" @click="goHelp">
          Help &amp; Info
        </button>

        <div v-if="user" class="user-pill">
          <span class="user-email">
            {{ user.email }}
          </span>
          <button class="logout-mini" @click.prevent="logout">Logout</button>
        </div>
      </div>
    </header>
    <StaffingNavigation />

    <main
      :aria-busy="busyActions"
      id="main-content"
      tabindex="-1"
      class="content"
    >
      <h1 class="sr-only">Course Administration</h1>
      <section class="panel">
        <div class="panel-header">Create Course</div>
        <div class="create-row">
          <input
            v-model="newCode"
            aria-label="Course code"
            class="create-input"
            placeholder="Course code (e.g. cs101)"
            data-testid="admin-new-code"
          />
          <input
            v-model="newTitle"
            aria-label="Course title"
            class="create-input"
            placeholder="Course title"
            data-testid="admin-new-title"
          />
          <button
            class="btn-create"
            :disabled="busyActions || !canCreate"
            @click="createCourse"
            data-testid="admin-create-btn"
          >
            Create
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">All Courses</div>
        <table class="course-table" tabindex="0" aria-label="Managed courses">
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th style="width: 220px; text-align: center">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in courses"
              :key="c.id"
              :data-testid="`admin-course-row-${c.id}`"
            >
              <td>{{ c.code }}</td>
              <td>{{ c.title }}</td>
              <td>
                <div class="actions">
                  <button
                    class="btn-go"
                    @click="goCourse(c)"
                    :data-testid="`admin-course-go-${c.id}`"
                  >
                    Go
                  </button>
                  <button
                    :disabled="busyActions"
                    class="btn-delete"
                    @click="deleteCourse(c)"
                    :data-testid="`admin-course-delete-${c.id}`"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!courses.length">
              <td colspan="3" class="empty-text">No courses yet.</td>
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
          @click="catalog.more(() => refreshNuxtData('admin-courses'))"
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
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.app-navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 32px;
  background: #012169;
  color: #ffffff;
}

.app-left,
.app-center {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.app-logo {
  height: 40px;
}

.app-center {
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
  max-width: 1000px;
  margin: 24px auto 40px;
  padding: 0 16px 32px;
}

.panel {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
  margin-bottom: 20px;
}

.panel-header {
  padding: 10px 20px;
  background: #17408b;
  color: #ffffff;
  font-weight: 600;
}

.create-row {
  display: flex;
  gap: 8px;
  padding: 12px 20px 14px;
}

.create-input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 13px;
}

.btn-create {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: #16a34a;
  color: #022c16;
  font-size: 13px;
  cursor: pointer;
}

.btn-create:disabled {
  opacity: 0.4;
  cursor: default;
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
  text-align: left;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.btn-go,
.btn-delete {
  min-width: 70px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
}

.btn-go {
  background: #17408b;
  color: #ffffff;
}

.btn-delete {
  background: #ffffff;
  color: #dc2626;
  border: 1px solid #dc2626;
}

.btn-delete:hover {
  background: #dc2626;
  color: #ffffff;
}

.empty-text {
  padding: 12px 20px;
  color: #536174;
  font-size: 13px;
}

@media (max-width: 768px) {
  .app-navbar {
    flex-wrap: wrap;
    padding: 8px 12px;
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
  }

  .brand-main {
    font-size: 18px;
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

  .create-row {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-create {
    width: 100%;
  }

  .course-table th,
  .course-table td {
    padding: 8px 12px;
    font-size: 13px;
  }

  .course-table {
    table-layout: fixed;
  }

  .course-table th:last-child {
    width: 94px !important;
  }

  .course-table td {
    overflow-wrap: anywhere;
  }

  .actions {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  .btn-go,
  .btn-delete {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .brand-main {
    font-size: 16px;
  }

  .user-email {
    display: none;
  }
}
</style>
