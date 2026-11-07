<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const goBack = () => {
  router.push('/courses')
}
</script>

<template>
  <div class="page-root">
    <header class="app-navbar">
      <div class="app-left" @click="goBack">
        <img
          src="/duke-cs-logo.png"
          alt="Duke CS"
          class="app-logo"
        />
      </div>
      <div class="app-center">
        <div class="brand-main">
          CampusWorks – Help &amp; Info
        </div>
      </div>
      <div class="app-right">
        <button class="back-btn" type="button" @click="goBack">
          Back to Courses
        </button>
      </div>
    </header>

    <main class="content">
      <section class="block">
        <h1>How to use CampusWorks</h1>
        <p>
          This page gives a quick overview of how students, TAs and course admins
          should use CampusWorks during office hours.
        </p>
      </section>

      <section class="block">
        <h2>For Students</h2>
        <ul>
          <li>From <strong>Courses</strong>, <strong>Enroll</strong> in your course, then click <strong>Go</strong> to open its queue.
            Only enrolled students can join a course's queue or leave feedback.</li>
          <li>Use <strong>Enter Queue</strong> to join. Please fill in:
            <ul>
              <li><strong>Location</strong>: Zoom link or room number.</li>
              <li><strong>Question</strong>: a short description of what you need help with.</li>
            </ul>
          </li>
          <li>While waiting you can:
            <ul>
              <li>See your <strong>position</strong> in the queue, and which TA is helping you once you are picked up.</li>
              <li><strong>Pause</strong> your entry if you step away, then <strong>Resume</strong> when back.</li>
              <li><strong>Leave Queue</strong> once you no longer need help.</li>
            </ul>
          </li>
          <li>
            If the queue is <strong>Paused</strong> or <strong>Closed</strong>, TAs are not currently
            accepting new questions – check announcements or try again later.
          </li>
        </ul>
      </section>

      <section class="block">
        <h2>For TAs / Staff</h2>
        <ul>
          <li>Open the course and go to the <strong>TA view</strong> (CampusWorks chooses this automatically if your role is TA / instructor / admin;
            instructors can also use <strong>Live Queue</strong> from the Course Admin page).</li>
          <li><strong>Open Queue</strong>, then click <strong>On Duty</strong> when you start helping; only “on duty” staff can operate the queue.</li>
          <li>In the live queue:
            <ul>
              <li><strong>Select</strong> to take a student (you can work on one student at a time).</li>
              <li><strong>Complete</strong> when you finish helping (this removes them from the queue and records the session).</li>
              <li><strong>Other TA</strong> marks the entry as “Needs another TA”.</li>
              <li>Use <strong>↑ / ↓</strong> to adjust ordering if needed.</li>
              <li><strong>Pause</strong> or <strong>Remove</strong> entries if a student is away or done.</li>
            </ul>
          </li>
          <li><strong>Close Queue</strong> at the end of office hours: on-duty staff are cleared and any remaining entries are saved to the course history.</li>
          <li>Use <strong>Announcements</strong> to broadcast updates to all students in the course.</li>
        </ul>
      </section>

      <section class="block">
        <h2>For Course Admins</h2>
        <ul>
          <li>Use the <strong>Course Admin</strong> view to:
            <ul>
              <li>See queue analytics (sessions, wait time, TA activity).</li>
              <li>Export a CSV of past help sessions for record-keeping.</li>
              <li>Manage <strong>enrollments &amp; roles</strong> (add TAs by email, promote/demote, remove users).
                Only course admins can grant the admin role.</li>
              <li>Read structured <strong>course feedback</strong> from students.</li>
            </ul>
          </li>
          <li>Site admins create and delete courses from the <strong>Admin Console</strong>.</li>
          <li>
            The queue <strong>state</strong> (Open / Paused / Closed) can be controlled from either the
            TA view or the course admin view.
          </li>
        </ul>
      </section>

      <section class="block">
        <h2>Need more help?</h2>
        <p>
          If you hit a bug or something doesn’t look right, please contact the course staff
          (or the CampusWorks maintainer) and include:
        </p>
        <ul>
          <li>Which page you were on (Student / TA / Admin + course code).</li>
          <li>What you tried to do.</li>
          <li>Any error message shown in the browser.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  min-height: 100vh;
  background: #f3f5fa;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #111827;
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
}

.app-center {
  flex: 1;
  display: flex;
  justify-content: center;
  text-align: center;
}

.brand-main {
  font-size: 20px;
  font-weight: 600;
}

.app-right {
  display: flex;
  align-items: center;
}

.back-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: none;
  background: #e5ecff;
  color: #012169;
  font-size: 12px;
  cursor: pointer;
}

.content {
  max-width: 900px;
  margin: 24px auto 40px;
  padding: 0 24px 40px;
}

.block {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
  padding: 14px 18px 16px;
  margin-bottom: 16px;
}

.block h1 {
  margin: 0 0 6px;
  font-size: 24px;
}

.block h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.block p {
  margin: 4px 0 8px;
  font-size: 14px;
}

.block ul {
  margin: 0 0 4px 18px;
  padding: 0;
  font-size: 14px;
}

.block li {
  margin-bottom: 4px;
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
    margin-top: 4px;
  }

  .content {
    max-width: 100%;
    margin: 16px auto 24px;
    padding: 0 14px 24px;
  }

  .block {
    padding-inline: 14px;
  }
}

@media (max-width: 600px) {
  .app-navbar {
    padding-inline: 10px;
  }

  .brand-main {
    font-size: 16px;
  }

  .back-btn {
    padding-inline: 10px;
    font-size: 11px;
  }

  .block h1 {
    font-size: 20px;
  }

  .block h2 {
    font-size: 18px;
  }

  .block p,
  .block ul {
    font-size: 13px;
  }
}
</style>

