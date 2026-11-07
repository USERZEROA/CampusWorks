<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    backTo?: string;
    backLabel?: string;
  }>(),
  {
    backTo: "/courses",
    backLabel: "Home",
  },
);
const user = useAuthUser();
</script>

<template>
  <div class="staffing-root">
    <header class="app-navbar">
      <NuxtLink to="/courses" aria-label="CampusWorks courses"
        ><img
          src="/duke-cs-logo.png"
          alt="Duke Department of Computer Science"
          class="app-logo"
          width="381"
          height="70"
          decoding="async"
      /></NuxtLink>
      <div class="brand-main">CampusWorks</div>
      <div class="staffing-user">
        <span>{{ user?.email }}</span
        ><button type="button" @click="signOut" data-testid="logout-btn">
          Logout
        </button>
      </div>
    </header>
    <main id="main-content" class="staffing-content" tabindex="-1">
      <NuxtLink :to="backTo" class="back-link">← {{ backLabel }}</NuxtLink>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="intro">{{ subtitle }}</p>
      <slot />
    </main>
  </div>
</template>

<style>
.staffing-root {
  min-height: 100vh;
  background: #f3f5fa;
  color: #172033;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}
.staffing-root .app-navbar {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  background: #012169;
  color: white;
  padding: 10px 32px;
}
.staffing-root .app-logo {
  height: 40px;
  max-width: 100%;
  object-fit: contain;
}
.staffing-root .brand-main {
  font-size: 20px;
  font-weight: 600;
}
.staffing-user {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
}
.staffing-user button {
  background: transparent !important;
  color: #fff !important;
  border-color: #fff !important;
  padding: 3px 10px !important;
  border-radius: 20px !important;
}
.staffing-content {
  max-width: 1200px;
  padding: 24px 20px 48px;
  margin: auto;
}
.staffing-root h1 {
  color: #012169;
  font-size: 30px;
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.staffing-root .back-link {
  display: inline-block;
  margin-bottom: 16px;
  font-size: 13px;
}
.staffing-root h2 {
  font-size: 19px;
  margin: 0;
}
.staffing-root h3 {
  font-size: 16px;
}
.staffing-root p {
  line-height: 1.6;
}
.staffing-root .intro,
.staffing-root .muted {
  color: #536174;
}
.staffing-root .panel {
  background: #fff;
  border-radius: 10px;
  margin: 20px 0;
  box-shadow: 0 10px 30px rgb(0 0 0 / 5%);
  overflow: hidden;
}
.staffing-root .panel-heading {
  padding: 12px 18px;
  background: #17408b;
  color: #fff;
}
.staffing-root .panel-body {
  padding: 18px;
}
.staffing-root .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 16px;
}
.staffing-root label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}
.staffing-root input:not([type="checkbox"]),
.staffing-root select,
.staffing-root textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #b7c4d6;
  border-radius: 6px;
  font: 14px system-ui;
  background: #fff;
  color: #172033;
}
.staffing-root textarea {
  min-height: 90px;
  resize: vertical;
}
.staffing-root input[type="checkbox"] {
  width: 17px;
  height: 17px;
}
.staffing-root label.check {
  flex-direction: row;
  align-items: center;
  font-weight: 400;
}
.staffing-root button,
.staffing-root .button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #17408b;
  border-radius: 6px;
  background: #17408b;
  color: #fff;
  padding: 8px 14px;
  font: 13px system-ui;
  cursor: pointer;
  text-decoration: none;
}
.staffing-root button.secondary,
.staffing-root .button.secondary {
  background: white;
  color: #17408b;
}
.staffing-root button.danger {
  background: #fff;
  color: #b91c1c;
  border-color: #b91c1c;
}
.staffing-root button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.staffing-root .actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.staffing-root .status {
  display: inline-flex;
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 16px;
  color: #012169;
  background: #e5ecff;
  text-transform: capitalize;
}
.staffing-root .notice {
  border-left: 4px solid #17408b;
  background: #eef4ff;
  padding: 12px 14px;
  margin: 14px 0;
  border-radius: 4px;
  line-height: 1.6;
}
.staffing-root .notice.error {
  border-color: #b91c1c;
  background: #fef2f2;
  color: #991b1b;
}
.staffing-root .notice.success {
  border-color: #047857;
  background: #ecfdf5;
  color: #065f46;
}
.staffing-root .table-scroll {
  overflow-x: auto;
}
.staffing-root table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.staffing-root th,
.staffing-root td {
  text-align: left;
  padding: 12px;
  border-bottom: 1px solid #e0e6ef;
  vertical-align: top;
}
.staffing-root th {
  background: #f8fafc;
}
.staffing-root .opportunity-card {
  padding: 18px;
  background: #fff;
  border: 1px solid #d9e2ef;
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.staffing-root .opportunity-card h2 {
  margin: 9px 0;
  color: #012169;
}
.staffing-root a {
  color: #17408b;
}
.staffing-root .button {
  color: white;
}
.staffing-root dl {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 2fr;
  gap: 10px;
  font-size: 14px;
}
.staffing-root dt {
  font-weight: 600;
}
.staffing-root dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.staffing-root fieldset {
  margin: 18px 0;
  padding: 16px;
  border: 1px solid #d9e2ef;
  border-radius: 8px;
  min-width: 0;
}
.staffing-root legend {
  color: #012169;
  font-weight: 600;
  padding: 0 6px;
}
.staffing-root .empty {
  padding: 14px 0;
  color: #536174;
}
.staffing-root .preserve-lines {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.staffing-root .record-title {
  display: block;
  color: #012169;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.5;
}
.staffing-root .record-meta {
  display: block;
  margin-top: 4px;
  color: #536174;
  font-size: 12px;
  line-height: 1.5;
}
.staffing-root .opportunity-card .record-title {
  font-size: 16px;
  margin: 8px 0;
}
.staffing-root .record-count {
  color: #536174;
  font-size: 12px;
  margin: 12px 0;
}
.staffing-root .list-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(150px, 1fr);
  gap: 14px;
  padding: 18px 18px 0;
}
.staffing-root .type-tag {
  display: inline-flex;
  border: 1px solid #c3d0e6;
  border-radius: 5px;
  padding: 3px 7px;
  color: #012169;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.staffing-root .card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.staffing-root .card-list {
  display: grid;
  gap: 14px;
}
.staffing-root .position-grid {
  align-items: stretch;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
}
.staffing-root .position-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 3px solid #17408b;
}
.staffing-root .position-card h2 {
  margin: 0;
  line-height: 1.4;
}
.staffing-root .position-card p {
  margin: 0;
}
.staffing-root .position-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  color: #536174;
  font-size: 13px;
}
.staffing-root .position-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 0;
  margin: 0;
  border-top: 1px solid #e0e6ef;
  border-bottom: 1px solid #e0e6ef;
}
.staffing-root .position-facts dt {
  color: #536174;
  font-size: 11px;
  font-weight: 500;
}
.staffing-root .position-facts dd {
  color: #012169;
  font-size: 17px;
  font-weight: 650;
  margin: 3px 0 0;
}
.staffing-root .position-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.staffing-root .position-tags span {
  background: #f3f5fa;
  border-radius: 4px;
  padding: 4px 7px;
  font-size: 11px;
  color: #475569;
}
.staffing-root .position-footer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: auto;
  font-size: 12px;
}
.staffing-root .notification-feed {
  max-height: 310px;
  overflow-y: auto;
}
.staffing-root .notification-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid #e0e6ef;
  overflow-wrap: anywhere;
}
.staffing-root .notification-row:first-child {
  padding-top: 0;
}
.staffing-root .notification-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.staffing-root .notification-row h3 {
  font-size: 14px;
  margin: 0 0 4px;
}
.staffing-root .notification-row p {
  font-size: 12px;
  margin: 0;
}
.staffing-root .notification-row.is-unread h3::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin: 0 7px 2px 0;
  border-radius: 50%;
  background: #17408b;
}
.staffing-root .semester-list {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
}
.staffing-root .semester-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid #e0e6ef;
  font-size: 13px;
}
@media (max-width: 700px) {
  .staffing-root .app-navbar {
    padding: 10px 12px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .staffing-root .app-logo {
    height: 34px;
  }
  .staffing-user {
    margin-left: auto;
  }
  .staffing-user span {
    display: none;
  }
  .staffing-content {
    padding: 18px 12px 32px;
  }
  .staffing-root h1 {
    font-size: 25px;
  }
  .staffing-root .panel-body {
    padding: 14px;
  }
  .staffing-root dl {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .staffing-root dd {
    margin-bottom: 8px;
  }
  .staffing-root .list-toolbar {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 14px 0;
  }
  .staffing-root .position-facts {
    grid-template-columns: 1fr 1fr;
  }
  .staffing-root .position-facts dd {
    margin-bottom: 0;
  }
  .staffing-root .notification-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .staffing-root .notification-row button {
    justify-self: start;
  }
}
</style>
