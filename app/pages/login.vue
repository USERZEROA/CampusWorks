<script setup lang="ts">
const navigationApp = useNuxtApp();
const capturedUser = useAuthUser();
const navigateWithContext = (target: string, options?: any) =>
  navigationApp.runWithContext(() => navigateTo(target, options));
import { ref, computed, onMounted } from "vue";
import { navigateTo, useFetch } from "#app";

type MockRole = "student" | "ta" | "instructor" | "admin";

type DemoAccount = { email: string; name: string; role: MockRole };

type Providers = {
  mock: boolean;
  gitlab: boolean;
  allowedEmailDomains: string[];
  demoAccounts: DemoAccount[];
};

const { data: providers } = await useFetch<Providers>("/api/auth/providers");

const mockEnabled = computed(() => !!providers.value?.mock);
const gitlabEnabled = computed(() => !!providers.value?.gitlab);
const demoAccounts = computed(() => providers.value?.demoAccounts || []);

const roleLabels: Record<MockRole, string> = {
  student: "Student",
  ta: "TA",
  instructor: "Instructor",
  admin: "Site admin",
};

// Role or demo-account email currently signing in, or 'gitlab'.
const loading = ref<string | null>(null);
const error = ref("");
const email = ref("");

// Buttons stay disabled until the page is interactive, so an early click on
// the server-rendered HTML is never silently lost.
const ready = ref(false);
onMounted(() => {
  ready.value = true;
});

const busy = computed(() => !ready.value || !!loading.value);

const loginAs = async (as: MockRole, accountEmail?: string) => {
  try {
    error.value = "";
    loading.value = accountEmail || as;

    const body: { as: MockRole; email?: string } = { as };

    const e = (accountEmail || email.value).trim();
    if (e) {
      body.email = e;
    }

    const res = await $fetch<{ user: AuthUser }>("/api/auth/mock", {
      method: "POST",
      body,
    });
    capturedUser.value = res.user;

    await navigateWithContext("/courses");
  } catch (e: any) {
    error.value = apiErrorMessage(e, "Login failed");
  } finally {
    loading.value = null;
  }
};

const loginWithGitlab = async () => {
  try {
    error.value = "";
    loading.value = "gitlab";

    await navigateWithContext("/api/auth/gitlab/login", {
      external: true,
    });
  } catch (e: any) {
    loading.value = null;
    error.value = apiErrorMessage(e, "GitLab login redirect failed");
  }
};
</script>

<template>
  <div class="page-root">
    <header class="app-banner">
      <div class="banner-inner">
        <img
          src="/duke-cs-logo.png"
          alt="Duke Department of Computer Science"
          class="app-logo"
          width="381"
          height="70"
          decoding="async"
        />
        <div class="banner-text">
          <div class="banner-title">CampusWorks</div>
          <div class="banner-subtitle">Office Hours &amp; Help Queue</div>
        </div>
      </div>
    </header>

    <main id="main-content" tabindex="-1" class="content">
      <section class="login-card">
        <h1 class="login-title">Sign in to CampusWorks</h1>

        <p class="login-desc">
          CampusWorks is a live help queue for office hours: students join the
          queue, TAs pick them up, and instructors see what happened.
        </p>

        <div v-if="gitlabEnabled" class="btn-row">
          <button
            class="role-btn gitlab"
            :disabled="busy"
            @click="loginWithGitlab"
            data-testid="login-gitlab-btn"
          >
            {{
              loading === "gitlab"
                ? "Redirecting to GitLab…"
                : "Sign in with GitLab"
            }}
          </button>
          <p v-if="providers?.allowedEmailDomains?.length" class="field-hint">
            Allowed accounts:
            {{ providers.allowedEmailDomains.map((d) => "@" + d).join(", ") }}
          </p>
        </div>

        <template v-if="mockEnabled">
          <div v-if="gitlabEnabled" class="divider">or use a demo account</div>

          <div v-if="demoAccounts.length" class="field">
            <div class="field-label">Demo accounts (one click)</div>
            <div class="demo-grid">
              <button
                v-for="a in demoAccounts"
                :key="a.email"
                type="button"
                class="demo-btn"
                :class="`demo-${a.role}`"
                :disabled="busy"
                @click="loginAs(a.role, a.email)"
                :data-testid="`demo-account-${a.email}`"
              >
                <span class="demo-name">
                  {{ loading === a.email ? "Signing in…" : a.name }}
                </span>
                <span class="demo-meta">
                  {{ roleLabels[a.role] }} · {{ a.email }}
                </span>
              </button>
            </div>
          </div>

          <div class="divider">or any email with a role</div>

          <div class="field">
            <label class="field-label" for="mock-email"
              >Demo email (optional)</label
            >
            <input
              id="mock-email"
              v-model="email"
              class="field-input"
              placeholder="e.g. alice@example.com"
              data-testid="mock-email"
            />
            <p class="field-hint">
              Signs in as this email with the role you pick below. Leave it
              empty to use that role's default demo account.
            </p>
          </div>

          <div class="btn-row">
            <button
              class="role-btn student"
              :disabled="busy"
              @click="loginAs('student')"
              data-testid="login-student"
            >
              {{ loading === "student" ? "Signing in…" : "Demo: Student" }}
            </button>

            <button
              class="role-btn ta"
              :disabled="busy"
              @click="loginAs('ta')"
              data-testid="login-ta"
            >
              {{ loading === "ta" ? "Signing in…" : "Demo: TA" }}
            </button>

            <button
              class="role-btn ta"
              :disabled="busy"
              @click="loginAs('instructor')"
              data-testid="login-instructor"
            >
              {{
                loading === "instructor" ? "Signing in…" : "Demo: Instructor"
              }}
            </button>

            <button
              class="role-btn admin"
              :disabled="busy"
              @click="loginAs('admin')"
              data-testid="login-admin"
            >
              {{ loading === "admin" ? "Signing in…" : "Demo: Site Admin" }}
            </button>
          </div>

          <p class="hint">
            Demo accounts are for local development and demos. Disable them in
            production with ENABLE_MOCK_LOGIN=false.
          </p>
        </template>

        <p v-if="!mockEnabled && !gitlabEnabled" class="error-text">
          No sign-in method is configured. Set ENABLE_MOCK_LOGIN=true or the
          GITLAB_* variables (see .env.example).
        </p>

        <p v-if="error" class="error-text">{{ error }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f3f5fa;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.app-banner {
  background: #012169;
  color: #ffffff;
  padding: 18px 32px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.banner-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 18px;
}

.app-logo {
  height: 40px;
  object-fit: contain;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.banner-title {
  font-size: 24px;
  font-weight: 600;
}

.banner-subtitle {
  font-size: 12px;
  opacity: 0.85;
}

.content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
}

.login-card {
  width: 100%;
  max-width: 520px;
  background: #ffffff;
  border-radius: 14px;
  padding: 26px 24px 20px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
  border-top: 4px solid #012169;
}

.login-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
  color: #012169;
}

.login-desc {
  margin: 0 0 18px;
  font-size: 13px;
  color: #536174;
  line-height: 1.6;
}

.field {
  margin-bottom: 14px;
}

.field-label {
  font-size: 11px;
  color: #536174;
  margin-bottom: 4px;
  display: block;
}

.field-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
}

.field-hint {
  margin: 4px 0 0;
  font-size: 10px;
  color: #596579;
}

.btn-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
}

.role-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  width: 100%;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 14px;
  line-height: 1.4;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.16s ease;
}

.role-btn.gitlab {
  background: #fc6d26;
  color: #1f0a00;
}

.role-btn.gitlab:hover:not(:disabled) {
  background: #e24329;
  transform: translateY(-1px);
}

.role-btn.student {
  background: #17408b;
  color: #ffffff;
}

.role-btn.student:hover:not(:disabled) {
  background: #012169;
  transform: translateY(-1px);
}

.role-btn.ta {
  background: #ffffff;
  color: #17408b;
  border: 1px solid #17408b;
}

.role-btn.ta:hover:not(:disabled) {
  background: #17408b;
  color: #ffffff;
  transform: translateY(-1px);
}

.role-btn.admin {
  background: #0f4c81;
  color: #ffffff;
}

.role-btn.admin:hover:not(:disabled) {
  background: #012169;
  transform: translateY(-1px);
}

.role-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.error-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b91c1c;
}

.divider {
  margin: 14px 0 12px;
  font-size: 11px;
  color: #596579;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.demo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.demo-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  box-sizing: border-box;
  min-height: 64px;
  gap: 2px;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #c5d3ea;
  border-left-width: 4px;
  background: #ffffff;
  text-align: left;
  line-height: 1.4;
  cursor: pointer;
  transition: transform 0.16s ease;
}

.demo-btn:hover:not(:disabled) {
  background: #e5ecff;
  transform: translateY(-1px);
}

.demo-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.demo-btn.demo-student {
  border-left-color: #17408b;
}

.demo-btn.demo-ta {
  border-left-color: #10b981;
}

.demo-btn.demo-instructor {
  border-left-color: #f59e0b;
}

.demo-btn.demo-admin {
  border-left-color: #012169;
}

.demo-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
}

.demo-meta {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #536174;
}

.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: #596579;
}

/* Responsive: tighter banner and card on small screens */
@media (max-width: 900px) {
  .app-banner {
    padding: 14px 18px;
  }

  .banner-inner {
    gap: 12px;
  }

  .banner-title {
    font-size: 20px;
  }

  .content {
    padding: 24px 12px 28px;
  }

  .login-card {
    padding: 22px 18px 18px;
    max-width: 100%;
  }
}

@media (max-width: 600px) {
  .app-banner {
    padding: 12px 12px;
  }

  .banner-inner {
    flex-wrap: wrap;
    justify-content: center;
    text-align: center;
  }

  .banner-title {
    font-size: 18px;
  }

  .banner-subtitle {
    font-size: 11px;
  }

  .content {
    padding-top: 18px;
  }

  .login-title {
    font-size: 20px;
  }

  .login-desc {
    font-size: 12px;
  }

  .field-input {
    font-size: 12px;
  }

  .role-btn {
    font-size: 13px;
  }
}
</style>
