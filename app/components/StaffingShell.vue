<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
const user = useAuthUser()
</script>

<template>
  <div class="staffing-root">
    <header class="app-navbar">
      <NuxtLink to="/courses" aria-label="CampusWorks courses"><img src="/duke-cs-logo.png" alt="Duke Computer Science" class="app-logo" /></NuxtLink>
      <div class="brand-main">CampusWorks</div>
      <div class="staffing-user"><span>{{ user?.email }}</span><button type="button" @click="signOut" data-testid="logout-btn">Logout</button></div>
    </header>
    <StaffingNavigation />
    <main id="staffing-main" class="staffing-content" tabindex="-1">
      <h1>{{ title }}</h1><p v-if="subtitle" class="intro">{{ subtitle }}</p>
      <slot />
    </main>
  </div>
</template>

<style>
.staffing-root { min-height:100vh; background:#f3f5fa; color:#172033; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.staffing-root .app-navbar { display:flex; gap:20px; align-items:center; justify-content:space-between; background:#012169; color:white; padding:10px 32px; }
.staffing-root .app-logo { height:40px; max-width:100%; object-fit:contain; }
.staffing-root .brand-main { font-size:20px; font-weight:600; }
.staffing-user { display:flex; gap:12px; align-items:center; font-size:12px; }
.staffing-user button { background:transparent!important; color:#fff!important; border-color:#fff!important; padding:3px 10px!important; border-radius:20px!important; }
.staffing-content { max-width:1200px; padding:24px 20px 48px; margin:auto; }
.staffing-root h1 { color:#012169; font-size:30px; margin:0 0 10px; overflow-wrap:anywhere; }
.staffing-root h2 { font-size:19px; margin:0; }
.staffing-root h3 { font-size:16px; }
.staffing-root p { line-height:1.6; }
.staffing-root .intro,.staffing-root .muted { color:#536174; }
.staffing-root .panel { background:#fff; border-radius:10px; margin:20px 0; box-shadow:0 10px 30px rgb(0 0 0 / 5%); overflow:hidden; }
.staffing-root .panel-heading { padding:12px 18px; background:#17408b; color:#fff; }
.staffing-root .panel-body { padding:18px; }
.staffing-root .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:16px; }
.staffing-root label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; margin-bottom:14px; }
.staffing-root input:not([type=checkbox]),.staffing-root select,.staffing-root textarea { box-sizing:border-box; width:100%; padding:9px 10px; border:1px solid #b7c4d6; border-radius:6px; font:14px system-ui; background:#fff; color:#172033; }
.staffing-root textarea { min-height:90px; resize:vertical; }
.staffing-root input[type=checkbox] { width:17px; height:17px; }
.staffing-root label.check { flex-direction:row; align-items:center; font-weight:400; }
.staffing-root button,.staffing-root .button { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid #17408b; border-radius:6px; background:#17408b; color:#fff; padding:8px 14px; font:13px system-ui; cursor:pointer; text-decoration:none; }
.staffing-root button.secondary,.staffing-root .button.secondary { background:white; color:#17408b; }
.staffing-root button.danger { background:#fff; color:#b91c1c; border-color:#b91c1c; }
.staffing-root button:disabled { cursor:not-allowed; opacity:.55; }
.staffing-root .actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.staffing-root .status { display:inline-flex; font-size:12px; padding:4px 9px; border-radius:16px; color:#012169; background:#e5ecff; text-transform:capitalize; }
.staffing-root .notice { border-left:4px solid #17408b; background:#eef4ff; padding:12px 14px; margin:14px 0; border-radius:4px; line-height:1.6; }
.staffing-root .notice.error { border-color:#b91c1c; background:#fef2f2; color:#991b1b; }
.staffing-root .notice.success { border-color:#047857; background:#ecfdf5; color:#065f46; }
.staffing-root .table-scroll { overflow-x:auto; }
.staffing-root table { width:100%; border-collapse:collapse; font-size:13px; }
.staffing-root th,.staffing-root td { text-align:left; padding:12px; border-bottom:1px solid #e0e6ef; vertical-align:top; }
.staffing-root th { background:#f8fafc; }
.staffing-root .opportunity-card { padding:18px; background:#fff; border:1px solid #d9e2ef; border-radius:10px; }
.staffing-root .opportunity-card h2 { margin:9px 0; color:#012169; }
.staffing-root a { color:#17408b; }
.staffing-root .button { color:white; }
.staffing-root dl { display:grid; grid-template-columns:minmax(120px,1fr) 2fr; gap:10px; font-size:14px; }
.staffing-root dt { font-weight:600; }.staffing-root dd { margin:0; overflow-wrap:anywhere; }
.staffing-root fieldset { margin:18px 0; padding:16px; border:1px solid #d9e2ef; border-radius:8px; min-width:0; }
.staffing-root legend { color:#012169; font-weight:600; padding:0 6px; }
.staffing-root .empty { padding:14px 0; color:#536174; }
.staffing-root .preserve-lines { white-space:pre-wrap; overflow-wrap:anywhere; }
@media(max-width:700px) { .staffing-root .app-navbar { padding:10px 12px; flex-wrap:wrap; gap:10px; }.staffing-root .app-logo { height:34px; }.staffing-user { margin-left:auto; }.staffing-user span { display:none; }.staffing-content { padding:18px 12px 32px; }.staffing-root h1 { font-size:25px; }.staffing-root .panel-body { padding:14px; }.staffing-root dl { grid-template-columns:1fr; gap:5px; }.staffing-root dd { margin-bottom:8px; } }
</style>
