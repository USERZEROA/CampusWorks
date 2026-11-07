import { spawn, execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MongoClient } from 'mongodb'
import { chromium, expect, request } from '@playwright/test'
import { confirmedProviderDefaults, loadAiProviderConfig, providerDialogStatus } from './ai-provider-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const receiptPath = resolve(root, '.cache/ai-provider-browser-proof.json')
const maxProviderCalls = 14
const proofDeadline = Date.now() + 8 * 60 * 1000
const receipt = { status: 'not_started', startedAt: new Date().toISOString(), synthetic: true, headless: true, automatic: true, maxProviderCalls, providerCallsReserved: 0, checks: [], stage: 'configuration' }
const contexts = []
const examples = []
let child, browser, databaseClient, proofDatabase
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds))
const assert = (condition, code) => { if (!condition) throw new Error(code) }
const save = () => {
  mkdirSync(resolve(root, '.cache'), { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
  if (examples.length) writeFileSync(resolve(root, '.cache/ai-provider-browser-examples.json'), JSON.stringify({ synthetic: true, examples }, null, 2) + '\n')
}
const call = async pending => {
  const response = await pending
  assert(response.ok(), 'synthetic_workflow_failed')
  return response.json()
}
async function freePort() {
  const socket = createServer()
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done) })
  const port = socket.address().port
  await new Promise(done => socket.close(done))
  return port
}
function sourceReceipt() {
  const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'app', 'server', 'package.json', 'package-lock.json', 'nuxt.config.ts'], { cwd: root }).toString('utf8').split('\0').filter(Boolean))].sort()
  const hash = createHash('sha256')
  for (const path of paths) hash.update(path).update('\0').update(readFileSync(resolve(root, path))).update('\0')
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), applicationSha256: hash.digest('hex'), buildEntrySha256: createHash('sha256').update(readFileSync(resolve(root, '.output/server/index.mjs'))).digest('hex') }
}
async function stopApplication() {
  if (child && child.exitCode === null && child.signalCode === null) await new Promise(done => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timer); done() })
    child.kill('SIGTERM')
  })
  child = undefined
}
async function stop() {
  let incomplete = false
  // Stop paid work first. A browser failure cannot skip application cleanup.
  try { await stopApplication() } catch { incomplete = true }
  const closed = await Promise.allSettled([
    ...(browser ? [browser.close()] : []),
    ...contexts.map(context => context.dispose()),
  ])
  if (closed.some(result => result.status === 'rejected')) incomplete = true
  if (databaseClient) {
    try {
      if (proofDatabase && /^campusworks_ai_browser_[a-f0-9]{16}$/.test(proofDatabase.databaseName)) await proofDatabase.dropDatabase()
    } catch { incomplete = true }
    try { await databaseClient.close() } catch { incomplete = true }
  }
  if (incomplete) throw new Error('verification_cleanup_incomplete')
}

async function proof() {
  // One UTC-day quota bounds this whole short run, including retry headroom.
  const nextUtcDay = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() + 86400000
  assert(nextUtcDay - Date.now() > 10 * 60 * 1000, 'verification_window_crosses_quota_day')
  const settings = providerDialogStatus()
  assert(settings.status === 'saved' && settings.encryptedFilePresent, 'saved_key_required')
  assert(existsSync(resolve(root, '.output/server/index.mjs')), 'application_build_required')
  const databaseUri = process.env.AI_PROOF_MONGODB_URI
  let address
  try { address = new URL(databaseUri) } catch { throw new Error('isolated_database_required') }
  assert(address.protocol === 'mongodb:' && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'isolated_database_required')
  const provider = await loadAiProviderConfig(confirmedProviderDefaults)
  assert(provider?.AI_API_KEY && new URL(provider.AI_BASE_URL).hostname === 'api.openai.com', 'confirmed_openai_configuration_required')
  receipt.provider = { endpoint: provider.AI_BASE_URL, model: provider.AI_MODEL }
  receipt.source = sourceReceipt()
  databaseClient = new MongoClient(databaseUri, { serverSelectionTimeoutMS: 5000 })
  await databaseClient.connect()
  const topology = await databaseClient.db('admin').command({ hello: 1 })
  assert(topology.setName || topology.msg === 'isdbgrid', 'replica_set_required')
  const suffix = randomBytes(8).toString('hex')
  proofDatabase = databaseClient.db(`campusworks_ai_browser_${suffix}`)
  assert(!(await proofDatabase.listCollections().toArray()).length, 'empty_database_required')
  const origin = `http://127.0.0.1:${await freePort()}`
  const applicationSecret = randomBytes(32).toString('hex')
  // Credentials remain in memory and in this child environment, never browser storage or logs.
  const startApplication = async automatic => {
  assert(Date.now() < proofDeadline, 'verification_deadline_reached')
  child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, ...provider, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: new URL(origin).port,
    PUBLIC_ORIGIN: origin, TRUST_PROXY: 'false', MONGODB_URI: databaseUri, MONGODB_DB: proofDatabase.databaseName,
    SESSION_SECRET: applicationSecret, ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false',
    GITLAB_BASE_URL: '', GITLAB_CLIENT_ID: '', GITLAB_CLIENT_SECRET: '', API_RATE_LIMIT: '1000', LOGIN_RATE_LIMIT: '1000',
    AI_AUTO_REFRESH_ENABLED: automatic ? 'true' : 'false', AI_AUTO_DISCOVERY_ENABLED: 'true', AI_MAX_CONCURRENT: '1', AI_DAILY_REQUEST_LIMIT: String(maxProviderCalls), AI_GLOBAL_DAILY_REQUEST_LIMIT: String(maxProviderCalls),
    AI_AUTO_CANDIDATE_PAGE_SIZE: '10', AI_TERM_REVIEW_COOLDOWN_MS: '900000',
    AI_AUTO_DISCOVERY_INTERVAL_MS: '2000', AI_AUTO_DISCOVERY_BATCH_SIZE: '12', AI_AUTO_DISCOVERY_WORK_MS: '350',
    AI_AUTO_SCOPE_SCAN_INTERVAL_MS: '30000', AI_TERM_REVIEW_SCAN_INTERVAL_MS: '60000', AI_AUTO_DEBOUNCE_MS: '750',
    STAFFING_MAINTENANCE_ENABLED: 'true', STAFFING_MAINTENANCE_INTERVAL_MS: '5000',
    AI_DAILY_TOKEN_BUDGET: '100000', AI_GLOBAL_DAILY_TOKEN_BUDGET: '100000',
  } })
  child.on('error', () => {})
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
    await pause(100)
  }
  assert(ready, 'synthetic_application_unavailable')
  }
  await startApplication(false)
  receipt.status = 'running'; receipt.stage = 'synthetic_setup'; save()
  const actor = async (label, role) => {
    const api = await request.newContext({ baseURL: origin })
    contexts.push(api)
    const email = `synthetic-${label}-${suffix}@example.com`
    await call(api.post('/api/auth/mock', { data: { as: role, email, name: `Synthetic ${label}` } }))
    return { api, email }
  }
  const admin = await actor('admin', 'admin')
  const faculty = [await actor('faculty-a', 'instructor'), await actor('faculty-b', 'instructor')]
  const candidates = [await actor('applicant-a', 'student'), await actor('applicant-b', 'student')]
  const now = Date.now()
  const term = (await call(admin.api.post('/api/staffing/terms', { data: { name: 'Synthetic real API semester', requiresApproval: false, startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 30 * 86400000).toISOString() } }))).term
  const cycle = (await call(admin.api.get('/api/staffing/cycle'))).cycle
  await call(admin.api.put('/api/staffing/cycle', { data: { expectedVersion: cycle.version, termId: term.id, opensAt: new Date(now - 3600000).toISOString(), closesAt: new Date(now + 7 * 86400000).toISOString(), enabled: true } }))
  const postings = []
  const applications = []
  const courseId = `ai-live-${suffix}`
  await call(admin.api.post('/api/courses', { data: { code: courseId, title: 'Synthetic Algorithms Course' } }))
  for (const instructor of faculty) await call(admin.api.patch(`/api/courses/${courseId}/enrollments/role`, { data: { email: instructor.email, role: 'instructor' } }))
  for (const [index, instructor] of faculty.entries()) {
    let posting = (await call(instructor.api.post('/api/staffing/opportunities', { data: {
      type: 'ta', courseId, title: `Synthetic Algorithms Assistant ${index + 1}`, department: 'Computer Science',
      description: 'Synthetic TA opening for algorithms and clear explanations. No real student or course is represented.',
      positions: 2, weeklyHours: 10, appointmentStart: new Date(now).toISOString(), appointmentEnd: new Date(now + 14 * 86400000).toISOString(),
      requiresAttendance: false, hasLab: false, hasDiscussion: false, requiresGrading: true, holdsOfficeHours: true,
      duties: [{ kind: 'office_hours', sessionsPerWeek: 2, minutesPerSession: 60 }], requiredSkills: 'Algorithms and clear explanations', preferredSkills: 'Peer tutoring',
      questions: [{ id: 'experience', prompt: 'Describe relevant algorithms coursework or teaching practice.', purpose: 'qualification', required: true }],
      cvRequired: false, approvalRequired: false, hourlyRate: 20, budget: 1600,
    } }))).opportunity
    posting = (await call(instructor.api.post(`/api/staffing/opportunities/${posting.id}/publish`, { data: { expectedVersion: posting.version } }))).opportunity
    postings.push(posting)
    const rows = []
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const experience = candidateIndex === 0 ? 'Algorithms coursework and peer tutoring practice.' : 'Algorithms coursework and collaborative problem-solving practice.'
      let application = (await call(candidate.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application
      application = (await call(candidate.api.patch(`/api/staffing/applications/${application.id}`, { data: {
        expectedVersion: application.version,
        profile: { firstName: 'Synthetic', lastName: `Applicant ${candidateIndex + 1}`, preferredEmail: candidate.email, undergraduateMajors: 'Computer Science', department: 'Computer Science', positionPreference: 'half', priorTaExperience: false, priorCourses: '', multipleCourses: false, graduationTerm: term.name, availability: 'Weekday afternoons', availableHours: 10, skills: 'Algorithms and communication', experience, slots: [] },
        answers: { experience }, qualificationText: `Synthetic qualification evidence: ${experience} No real individual is represented.`,
      } }))).application
      rows.push((await call(candidate.api.post(`/api/staffing/applications/${application.id}/submit`, { data: { expectedVersion: application.version } }))).application)
    }
    applications.push(rows)
  }
  const actors = [admin, ...faculty, ...candidates]
  const sessions = await Promise.all(actors.map(actor => actor.api.storageState()))
  await stopApplication()
  await startApplication(true)
  for (const [index, actor] of actors.entries()) {
    actor.api = await request.newContext({ baseURL: origin, storageState: sessions[index] })
    contexts.push(actor.api)
  }
  receipt.stage = 'automatic_generation_without_browser'; save()
  await expect.poll(async () => proofDatabase.collection('staffingAiTasks').countDocuments({ automatic: true, status: 'completed' }), { timeout: 120000 }).toBe(9)
  await expect.poll(async () => proofDatabase.collection('staffingAiAutomationJobs').countDocuments({ status: { $nin: ['idle', 'ended', 'revoked'] } }), { timeout: 30000 }).toBe(0)
  const initialTasks = await proofDatabase.collection('staffingAiTasks').find({ automatic: true, status: 'completed' }).toArray()
  assert(initialTasks.filter(task => task.kind === 'cv_summary').length === 4, 'automatic_summary_count_failed')
  assert(initialTasks.filter(task => task.kind === 'opportunity_draft').length === 2, 'automatic_requirements_count_failed')
  assert(initialTasks.filter(task => task.kind === 'candidate_fit').length === 2, 'automatic_comparison_count_failed')
  assert(initialTasks.filter(task => task.kind === 'term_review').length === 1, 'automatic_review_count_failed')
  for (const task of initialTasks) {
    assert(task.result, 'automatic_result_missing')
    if (task.kind === 'candidate_fit') {
      const index = postings.findIndex(posting => posting.id === task.targetId)
      assert(JSON.stringify(task.result.items.map(item => item.targetId).sort()) === JSON.stringify(applications[index].map(item => item.id).sort()), 'candidate_coverage_failed')
    }
    receipt.checks.push({ kind: task.kind, trigger: 'automatic_without_page', status: task.status, validated: true, compared: task.coverage?.compared ?? null })
    examples.push({ kind: task.kind, trigger: 'automatic_without_page', result: task.result })
  }
  for (const [index, posting] of postings.entries()) {
    const original = initialTasks.find(task => task.kind === 'candidate_fit' && task.targetId === posting.id)
    const peerRead = await call(faculty[1 - index].api.get('/api/ai/tasks', { params: { kind: 'candidate_fit', targetId: posting.id, page: 1 } }))
    assert(peerRead.tasks.some(task => task.id === original.id && task.automatic && task.status === 'completed'), 'authorized_peer_result_not_shared')
  }
  receipt.sharedResourceResults = true
  save()
  browser = await chromium.launch({ headless: true })
  const pages = []
  const posts = [0, 0]
  let pageErrors = 0
  for (const [index, instructor] of faculty.entries()) {
    const context = await browser.newContext({ baseURL: origin, storageState: await instructor.api.storageState() })
    const page = await context.newPage()
    page.on('pageerror', () => pageErrors++)
    page.on('request', value => { if (new URL(value.url()).pathname === '/api/ai/tasks' && value.method() === 'POST') posts[index]++ })
    pages.push(page)
  }
  const open = async (page, path) => {
    assert((await page.goto(path))?.ok(), 'browser_navigation_failed')
    await page.waitForFunction(() => !!document.querySelector('#__nuxt')?.__vue_app__)
  }
  const panel = (page, title) => page.locator('section.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  const display = async (page, title) => {
    const section = panel(page, title)
    await expect(section.getByTestId('ai-request')).toHaveCount(0)
    await expect(section.getByTestId('ai-result')).toBeVisible({ timeout: 10000 })
  }
  receipt.stage = 'automatic_browser_display'; save()
  await open(pages[0], `/applications/${applications[0][0].id}`)
  await display(pages[0], 'Qualification Summary Assistance')
  await open(pages[0], `/staffing/${postings[0].id}`)
  await display(pages[0], 'Requirement Draft Assistance')
  await open(pages[0], `/courses/${postings[0].courseId}/review`)
  await display(pages[0], 'Course Suggestions')
  for (const index of [0, 1]) {
    await open(pages[index], `/staffing/${postings[index].id}`)
    await display(pages[index], 'Candidate Review Assistance')
  }
  assert(await proofDatabase.collection('staffingOffers').countDocuments({}) === 0, 'analysis_changed_hiring_state')
  receipt.stage = 'selection_and_automatic_updates'; save()
  const selection = pages[0].waitForResponse(value => value.url().endsWith(`/api/staffing/applications/${applications[0][0].id}/select`) && value.request().method() === 'POST', { timeout: 15000 })
  await pages[0].getByTestId(`select-candidate-${applications[0][0].id}`).click()
  await call(selection)
  assert((await call(candidates[0].api.get(`/api/courses/${postings[0].courseId}`))).isStaff === false, 'offer_granted_early_authority')
  const conflict = await faculty[1].api.post(`/api/staffing/applications/${applications[1][0].id}/select`, { data: { expectedVersion: applications[1][0].version, idempotencyKey: `synthetic-conflict-${suffix}` } })
  assert(conflict.status() === 409, 'candidate_reserved_twice')
  receipt.competingSelectionStatus = conflict.status()
  for (const index of [0, 1]) {
    const section = panel(pages[index], 'Candidate Review Assistance')
    await expect(section.getByTestId('ai-result')).toBeVisible({ timeout: 60000 })
    await expect(section.locator(`a[href="/applications/${applications[index][0].id}"]`)).toHaveCount(0, { timeout: 60000 })
    await expect(section.locator(`a[href="/applications/${applications[index][1].id}"]`)).toBeVisible({ timeout: 60000 })
    const latest = await proofDatabase.collection('staffingAiTasks').find({ targetId: postings[index].id, kind: 'candidate_fit', status: 'completed' }).sort({ createdAt: -1 }).limit(1).next()
    assert(latest?.result?.items?.length === 1 && latest.result.items[0].targetId === applications[index][1].id, 'automatic_candidate_coverage_failed')
    receipt.checks.push({ kind: 'candidate_fit', trigger: 'automatic_after_selection', reviewer: index === 0 ? 'faculty_a' : 'faculty_b', status: latest.status, validated: true, compared: latest.coverage.compared })
    examples.push({ kind: 'candidate_fit', trigger: 'automatic_after_selection', reviewer: index === 0 ? 'faculty_a' : 'faculty_b', result: latest.result })
    save()
  }
  assert(posts[0] === 0 && posts[1] === 0, 'browser_requested_analysis')
  receipt.browserAnalysisPosts = posts
  receipt.pageErrors = pageErrors
  assert(!pageErrors, 'browser_runtime_error')
  receipt.stage = 'expiry_and_budget_checks'; save()
  const endedAt = new Date(Date.now() - 1000)
  await databaseClient.withSession(async session => session.withTransaction(async () => {
    await proofDatabase.collection('staffingTerms').updateOne({ id: term.id }, { $set: { endDate: endedAt } }, { session })
    await proofDatabase.collection('staffingOpportunities').updateMany({ id: { $in: postings.map(item => item.id) } }, { $set: { appointmentEnd: endedAt } }, { session })
    await proofDatabase.collection('staffingAppointments').updateMany({}, { $set: { endDate: endedAt, offerExpiresAt: endedAt } }, { session })
    await proofDatabase.collection('staffingOffers').updateMany({}, { $set: { endDate: endedAt, expiresAt: endedAt } }, { session })
  }))
  await expect.poll(async () => (await proofDatabase.collection('staffingAiAutomationJobs').findOne({ kind: 'term_review', targetId: courseId, termId: term.id, phase: 'final' }))?.status, { timeout: 90000 }).toBe('idle')
  const finalReview = await proofDatabase.collection('staffingAiTasks').find({ automatic: true, kind: 'term_review', targetId: courseId, status: 'completed' }).sort({ createdAt: -1 }).limit(1).next()
  assert(finalReview?.result, 'automatic_final_review_missing')
  receipt.checks.push({ kind: 'term_review', trigger: 'automatic_semester_end', status: finalReview.status, validated: true, compared: null })
  examples.push({ kind: 'term_review', trigger: 'automatic_semester_end', result: finalReview.result })
  receipt.automaticFinalReview = true
  const endedComparison = await faculty[0].api.post('/api/ai/tasks', { data: { kind: 'candidate_fit', targetId: postings[0].id } })
  const endedSummary = await faculty[0].api.post('/api/ai/tasks', { data: { kind: 'cv_summary', targetId: applications[0][0].id } })
  assert(endedComparison.status() === 409 && endedSummary.status() === 409, 'ended_analysis_not_blocked')
  const history = await call(faculty[0].api.get('/api/ai/tasks', { params: { kind: 'candidate_fit', targetId: postings[0].id } }))
  assert(history.canAnalyze === false && history.tasks.some(item => item.historical && item.result), 'authorized_history_missing')
  receipt.endedAnalysisStatus = { candidate_fit: endedComparison.status(), cv_summary: endedSummary.status(), historicalResultAvailable: true }
  await pause(2000)
  const budget = await proofDatabase.collection('staffingAiBudgets').findOne({ _id: `global:${new Date().toISOString().slice(0, 10)}` })
  const leases = await proofDatabase.collection('staffingAiBudgets').findOne({ _id: 'concurrency' })
  receipt.providerCallsReserved = budget?.requests || 0
  receipt.remainingLeases = leases?.leases?.length || 0
  assert(receipt.providerCallsReserved >= 12 && receipt.providerCallsReserved <= maxProviderCalls && receipt.checks.length === 12 && !receipt.remainingLeases, 'provider_budget_invariant_failed')
  assert(await proofDatabase.collection('staffingOffers').countDocuments({}) === 1, 'unexpected_offer_count')
  assert((await call(candidates[0].api.get(`/api/courses/${postings[0].courseId}`))).isStaff === false, 'offer_granted_early_authority')
  receipt.offerRequiresAcceptanceAndClearance = true
  receipt.status = 'passed'
}

const deadlineTimer = setTimeout(() => { void stopApplication() }, Math.max(1, proofDeadline - Date.now()))
try { await proof() } catch (error) {
  receipt.status = 'failed'
  receipt.failureCode = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'verification_failed'
  process.exitCode = 1
} finally {
  clearTimeout(deadlineTimer)
  if (proofDatabase) {
    try {
      receipt.providerCallsReserved = (await proofDatabase.collection('staffingAiBudgets').findOne({ _id: `global:${new Date().toISOString().slice(0, 10)}` }))?.requests || 0
    } catch {}
  }
  try { await stop(); receipt.cleanup = 'complete' } catch { receipt.cleanup = 'incomplete'; receipt.status = 'failed'; process.exitCode = 1 }
  receipt.completedAt = new Date().toISOString()
  save()
  process.stdout.write(JSON.stringify(receipt) + '\n')
}
