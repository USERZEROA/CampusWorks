import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MongoClient } from 'mongodb'
import { request } from '@playwright/test'
import { confirmedProviderDefaults, loadAiProviderConfig, providerDialogStatus } from './ai-provider-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const receiptPath = resolve(root, '.cache/ai-provider-proof.json')
const receipt = { status: 'not_started', synthetic: true, maxProviderCalls: 5, checks: [], providerCallsReserved: 0 }
const contexts = []
let child, databaseClient, proofDatabase
const pause = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
const save = () => {
  mkdirSync(resolve(root, '.cache'), { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
}
const call = async pending => {
  const response = await pending
  // Error bodies can contain request data; the proof receipt records status only.
  if (!response.ok()) throw new Error('synthetic_workflow_failed')
  return response.json()
}
async function port() {
  const socket = createServer()
  await new Promise((resolvePromise, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolvePromise) })
  const number = socket.address().port
  await new Promise(resolvePromise => socket.close(resolvePromise))
  return number
}
async function stop() {
  await Promise.allSettled(contexts.map(context => context.dispose()))
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolvePromise => {
      const timeout = setTimeout(() => { child.kill('SIGKILL') }, 5000)
      child.once('exit', () => { clearTimeout(timeout); resolvePromise() })
      child.kill('SIGTERM')
    })
  }
  if (databaseClient) {
    if (proofDatabase && /^campusworks_ai_proof_[a-f0-9]{16}$/.test(proofDatabase.databaseName)) await proofDatabase.dropDatabase()
    await databaseClient.close()
  }
}
async function proof() {
  const status = providerDialogStatus()
  if (status.status !== 'saved' || !status.encryptedFilePresent) { receipt.status = 'awaiting_key'; return }
  const baseUrl = process.env.AI_BASE_URL || confirmedProviderDefaults.baseUrl
  const model = process.env.AI_MODEL || confirmedProviderDefaults.model
  if (!baseUrl || !model) { receipt.status = 'awaiting_confirmed_provider'; return }
  const databaseUri = process.env.AI_PROOF_MONGODB_URI
  let parsedDatabase
  try { parsedDatabase = new URL(databaseUri) } catch { receipt.status = 'awaiting_isolated_database'; return }
  if (parsedDatabase.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedDatabase.hostname)) throw new Error('isolated_database_required')
  if (!existsSync(resolve(root, '.output/server/index.mjs'))) { receipt.status = 'awaiting_application_build'; return }
  const provider = await loadAiProviderConfig({ baseUrl, model })
  if (!provider) { receipt.status = 'awaiting_key'; return }
  databaseClient = new MongoClient(databaseUri, { serverSelectionTimeoutMS: 5000 })
  await databaseClient.connect()
  const topology = await databaseClient.db('admin').command({ hello: 1 })
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('replica_set_required')
  const suffix = randomBytes(8).toString('hex')
  proofDatabase = databaseClient.db(`campusworks_ai_proof_${suffix}`)
  if ((await proofDatabase.listCollections().toArray()).length) throw new Error('empty_isolated_database_required')
  const origin = `http://127.0.0.1:${await port()}`
  // The key reaches only this child environment. Neither child stream is persisted.
  child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, ...provider, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: new URL(origin).port,
    PUBLIC_ORIGIN: origin, TRUST_PROXY: 'false', MONGODB_URI: databaseUri, MONGODB_DB: proofDatabase.databaseName,
    SESSION_SECRET: randomBytes(32).toString('hex'), ENABLE_MOCK_LOGIN: 'true', SEED_DEMO_DATA: 'false',
    GITLAB_BASE_URL: '', GITLAB_CLIENT_ID: '', GITLAB_CLIENT_SECRET: '',
    API_RATE_LIMIT: '1000', LOGIN_RATE_LIMIT: '1000', AI_AUTO_REFRESH_ENABLED: 'false', AI_MAX_CONCURRENT: '1',
    AI_DAILY_REQUEST_LIMIT: '5', AI_GLOBAL_DAILY_REQUEST_LIMIT: '5', AI_DAILY_TOKEN_BUDGET: '100000', AI_GLOBAL_DAILY_TOKEN_BUDGET: '100000',
  } })
  child.on('error', () => {})
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
    await pause(100)
  }
  if (!ready) throw new Error('synthetic_application_unavailable')
  const actor = async (label, role) => {
    const api = await request.newContext({ baseURL: origin })
    contexts.push(api)
    const email = `synthetic-${label}-${suffix}@example.com`
    await call(api.post('/api/auth/mock', { data: { as: role, email, name: `Synthetic ${label}` } }))
    return { api, email }
  }
  const admin = await actor('admin', 'admin')
  const faculty = await actor('faculty', 'instructor')
  const candidateA = await actor('applicant-a', 'student')
  const candidateB = await actor('applicant-b', 'student')
  const courseId = `ai-proof-${suffix}`
  await call(admin.api.post('/api/courses', { data: { code: courseId, title: 'Synthetic Algorithms Course' } }))
  await call(admin.api.patch(`/api/courses/${courseId}/enrollments/role`, { data: { email: faculty.email, role: 'instructor' } }))
  const now = Date.now()
  const term = (await call(admin.api.post('/api/staffing/terms', { data: { name: 'Synthetic AI verification semester', requiresApproval: false, startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 30 * 86400000).toISOString() } }))).term
  const cycle = (await call(admin.api.get('/api/staffing/cycle'))).cycle
  await call(admin.api.put('/api/staffing/cycle', { data: { expectedVersion: cycle.version, termId: term.id, opensAt: new Date(now - 3600000).toISOString(), closesAt: new Date(now + 7 * 86400000).toISOString(), enabled: true } }))
  let opportunity = (await call(faculty.api.post('/api/staffing/opportunities', { data: {
    type: 'ta', courseId, title: 'Synthetic Algorithms Teaching Assistant', department: 'Computer Science',
    description: 'Synthetic TA position for algorithms coursework, clear explanations and office hours. No real course or student data.',
    positions: 2, weeklyHours: 10, appointmentStart: new Date(now).toISOString(), appointmentEnd: new Date(now + 14 * 86400000).toISOString(),
    requiresAttendance: false, hasLab: false, hasDiscussion: false, requiresGrading: true, holdsOfficeHours: true,
    duties: [{ kind: 'office_hours', sessionsPerWeek: 2, minutesPerSession: 60 }], requiredSkills: 'Algorithms and clear explanations', preferredSkills: 'Peer tutoring',
    questions: [{ id: 'experience', prompt: 'Describe relevant algorithms coursework or teaching practice.', required: true }],
    cvRequired: false, approvalRequired: false, hourlyRate: 20, budget: 1600,
  } }))).opportunity
  opportunity = (await call(faculty.api.post(`/api/staffing/opportunities/${opportunity.id}/publish`, { data: { expectedVersion: opportunity.version } }))).opportunity
  const apply = async (candidate, experience) => {
    let application = (await call(candidate.api.post(`/api/staffing/opportunities/${opportunity.id}/applications`, { data: {} }))).application
    application = (await call(candidate.api.patch(`/api/staffing/applications/${application.id}`, { data: {
      expectedVersion: application.version,
      profile: { firstName: 'Synthetic', lastName: 'Applicant', preferredEmail: candidate.email, undergraduateMajors: 'Computer Science', department: 'Computer Science', positionPreference: 'half', priorTaExperience: false, priorCourses: '', multipleCourses: false, graduationTerm: term.name, availability: 'Weekday afternoons', availableHours: 10, skills: 'Algorithms and communication', experience, slots: [] },
      answers: { experience }, qualificationText: `Synthetic qualification evidence: ${experience} No real individual is represented.`,
    } }))).application
    return (await call(candidate.api.post(`/api/staffing/applications/${application.id}/submit`, { data: { expectedVersion: application.version } }))).application
  }
  const first = await apply(candidateA, 'Algorithms coursework and peer tutoring practice.')
  await apply(candidateB, 'Algorithms coursework and collaborative problem-solving practice.')
  const analyze = async (kind, targetId, extra = {}) => {
    if (receipt.checks.length >= 5) throw new Error('five_call_boundary_reached')
    const response = await call(faculty.api.post('/api/ai/tasks', { data: { kind, targetId, ...extra }, timeout: 25000 }))
    const task = response.task
    receipt.checks.push({ kind, status: task?.status || 'unknown', validated: task?.status === 'completed' && !!task?.result, compared: task?.coverage?.compared ?? null })
    save()
    if (task?.status !== 'completed' || !task.result) throw new Error('provider_response_not_validated')
  }
  receipt.status = 'running'; save()
  await analyze('cv_summary', first.id)
  await analyze('opportunity_draft', opportunity.id)
  await analyze('term_review', courseId, { termId: term.id })
  await analyze('candidate_fit', opportunity.id)
  await call(candidateA.api.post(`/api/staffing/applications/${first.id}/withdraw`, { data: {} }))
  await analyze('candidate_fit', opportunity.id)
  const day = new Date().toISOString().slice(0, 10)
  const budget = await proofDatabase.collection('staffingAiBudgets').findOne({ _id: `global:${day}` })
  const leases = await proofDatabase.collection('staffingAiBudgets').findOne({ _id: 'concurrency' })
  receipt.providerCallsReserved = budget?.requests || 0
  if (receipt.providerCallsReserved !== 5 || leases?.leases?.length) throw new Error('provider_budget_invariant_failed')
  receipt.status = 'passed'
}

try { await proof() } catch {
  // Never print exceptions, provider bodies, configuration, or child output.
  receipt.status = 'failed'
  process.exitCode = 1
} finally {
  try { await stop() } catch { receipt.cleanup = 'incomplete'; process.exitCode = 1 }
  save()
  process.stdout.write(JSON.stringify(receipt) + '\n')
}
