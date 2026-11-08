import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Db, Document } from 'mongodb'
import { getServerConfig } from './config'
import { isGlobalAdmin } from './auth'
import { withTransaction } from './db'
import { findCourse } from './courses'
import { getRecruitmentCycle } from './staffing-cycle'
import { actorId, applicationAccess, assertOpportunityManager, fail, findOpportunity, manualCourseManager, staffingCourseAliases, type StaffingActor } from './staffing'
import { aiStatus, aiTaskFingerprint, candidateAnalysisEnded, createAiTask, type AiExecution, type AiKind } from './ai'
import { aiAutomationIndexes } from './ai-automation-indexes'
import { aiUsageCollection } from './ai-usage'
import { selectedAutomaticScopes } from './ai-scope-selection'
export { aiAutomationIndexes } from './ai-automation-indexes'

type Scope = { kind: AiKind; targetId: string; termId: string; page: number; pageSize: number }
const jobs = (db: Db) => db.collection<any>('staffingAiAutomationJobs')
const initialized = new WeakMap<Db, Promise<void>>()
const priorities: Record<AiKind, number> = { candidate_fit: 100, cv_summary: 80, opportunity_draft: 30, term_review: 10 }
const boundedSetting = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}
export const automaticDiscoveryEnabled = () => process.env.AI_AUTO_DISCOVERY_ENABLED !== 'false'
export const automaticCandidatePageSize = () => boundedSetting('AI_AUTO_CANDIDATE_PAGE_SIZE', 10, 1, 10)
export const automaticScopeId = (scope: Scope) => createHash('sha256').update(JSON.stringify([scope.kind, scope.targetId, scope.termId || '', scope.kind === 'candidate_fit' ? scope.page : 1, scope.kind === 'candidate_fit' ? scope.pageSize : 50])).digest('hex')

export function initializeAiAutomation(db: Db) {
  let pending = initialized.get(db)
  if (!pending) {
    pending = (async () => {
      for (const [collection, indexes] of aiAutomationIndexes) await db.collection(collection).createIndexes(indexes)
    })().catch(error => { initialized.delete(db); throw error })
    initialized.set(db, pending)
  }
  return pending
}

async function scopeResource(db: Db, scope: Scope) {
  if (scope.kind === 'candidate_fit' && scope.pageSize !== automaticCandidatePageSize()) fail(409, 'Automatic comparison batch size changed')
  if (scope.kind === 'term_review') {
    const course = await db.collection('courses').findOne({ id: scope.targetId })
    const term = await db.collection('staffingTerms').findOne({ id: scope.termId })
    if (!course || !term) fail(404, 'Automatic course review scope is unavailable')
    if (term.startDate > new Date() && (await getRecruitmentCycle(db)).termId !== term.id) fail(409, 'The course semester is not current')
    return { course, term, opportunity: null, application: null }
  }
  const application = scope.kind === 'cv_summary' ? await db.collection('staffingApplications').findOne({ id: scope.targetId }) : null
  if (scope.kind === 'cv_summary' && (!application?.submittedAt || !['submitted', 'under_review', 'shortlisted', 'selected'].includes(application.status))) fail(409, 'Automatic summaries require a current submitted application')
  const opportunity = await findOpportunity(db, application?.opportunityId || scope.targetId)
  const cycle = await getRecruitmentCycle(db)
  if (opportunity.termId !== cycle.termId) fail(409, 'Automatic recruitment follows the current semester')
  if (scope.kind === 'opportunity_draft') {
    if (!['draft', 'pending_approval', 'published', 'applications_closed', 'filled'].includes(opportunity.status)) fail(409, 'Position requirements are no longer active')
  } else {
    if (!cycle.canReview || candidateAnalysisEnded(opportunity) || !['published', 'applications_closed', 'filled'].includes(opportunity.status)) fail(409, 'Automatic candidate analysis is unavailable')
  }
  const course = opportunity.type === 'ta' ? await findCourse(db, opportunity.courseId) : null
  if (opportunity.type === 'ta' && !course) fail(404, 'Course offering is unavailable')
  return { course, term: null, opportunity, application }
}

async function accountActor(db: Db, account: Document): Promise<StaffingActor | null> {
  if (account.disabledAt) return null
  const config = getServerConfig()
  if (account.identityKind === 'gitlab') {
    if (!await db.collection('providerIdentities').findOne({ userId: account.id, email: account.email, provider: 'gitlab', revokedAt: null })) return null
    return { id: account.id, email: account.email, name: account.name || account.email, provider: 'gitlab', primaryRole: 'student' }
  }
  if (!config.mockLoginEnabled || await db.collection('providerIdentities').findOne({ $or: [{ userId: account.id }, { email: account.email }] })) return null
  const admin = await db.collection('authSessions').findOne({ userId: account.id, 'user.id': account.id, 'user.email': account.email, 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null }, { projection: { _id: 1 } })
  return { id: account.id, email: account.email, name: account.name || account.email, provider: 'mock', primaryRole: admin ? 'admin' : 'student' }
}

/** Select a currently authorized account; a saved primary role is never authority. */
async function scopeActor(db: Db, scope: Scope, preferredId?: string): Promise<StaffingActor | null> {
  const resource = await scopeResource(db, scope)
  const config = getServerConfig()
  const emails = new Set<string>(config.adminEmails)
  if (resource.course) for (const email of await db.collection('enrollments').distinct('userEmail', { courseId: resource.course.id, role: { $in: ['instructor', 'admin'] } })) emails.add(String(email))
  if (resource.opportunity?.type === 'ra') emails.add(resource.opportunity.ownerEmail)
  if (config.mockLoginEnabled) for (const email of await db.collection('authSessions').distinct('user.email', { 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null })) emails.add(String(email))
  const accounts = await db.collection('users').find({ email: { $in: [...emails] }, disabledAt: null }).sort({ id: 1 }).toArray()
  accounts.sort((left, right) => Number(right.id === preferredId) - Number(left.id === preferredId) || Number(right.id === resource.opportunity?.ownerId) - Number(left.id === resource.opportunity?.ownerId) || String(left.id).localeCompare(String(right.id)))
  for (const account of accounts) {
    const actor = await accountActor(db, account)
    if (!actor) continue
    try {
      if (resource.opportunity) await assertOpportunityManager(db, resource.opportunity, actor)
      else if (!await manualCourseManager(db, resource.course!.id, actor)) continue
      if (resource.application) await applicationAccess(db, resource.application.id, actor)
      return actor
    } catch (error: any) { if (![403, 404].includes(error?.statusCode)) throw error }
  }
  return null
}

export async function assertAutomaticExecution(db: Db, user: StaffingActor, execution: AiExecution, inputHash: string, minimumLeaseMs = 0) {
  const job = await jobs(db).findOne({ _id: execution.automationScopeId, status: 'running', leaseToken: execution.leaseToken, generation: execution.generation, runningGeneration: execution.generation, runningInputHash: inputHash, inputHash, leaseUntil: { $gt: new Date(Date.now() + minimumLeaseMs) } })
  if (!job) fail(409, 'Automatic evidence or execution authority changed')
  const selected = selectedAutomaticScopes(process.env.AI_AUTOMATION_SCOPES, automaticCandidatePageSize())
  if (selected && !selected.some(value => automaticScopeId(value) === job._id)) fail(409, 'Automatic AI scope is no longer enabled')
  const actor = await scopeActor(db, job, actorId(user))
  if (!actor || actorId(actor) !== actorId(user)) fail(403, 'Automatic reviewer authority changed')
}

async function observeScope(db: Db, scope: Scope, preferredId?: string) {
  // Callers may supply a persisted job or hint. Only scope coordinates belong
  // in an observation update; lifecycle fields must remain fenced below.
  const coordinates: Scope = { kind: scope.kind, targetId: scope.targetId, termId: scope.termId || '', page: scope.kind === 'candidate_fit' ? scope.page : 1, pageSize: scope.kind === 'candidate_fit' ? scope.pageSize : 50 }
  const id = automaticScopeId(scope)
  const observedVersion = (await jobs(db).findOne({ _id: id }, { projection: { observationVersion: 1 } }))?.observationVersion || 0
  const actor = await scopeActor(db, scope, preferredId)
  if (!actor) return null
  const snapshot = await aiTaskFingerprint(db, actor, scope, { automatic: true })
  const context = snapshot.input.evidence.find(entry => entry.reference === 'course:context')?.value as { phase?: string } | undefined
  const phase = scope.kind === 'term_review' ? context?.phase === 'final' ? 'final' : 'preview' : undefined
  await withTransaction(async (database, session) => {
    const prior = await jobs(database).findOne({ _id: id }, { session })
    if (prior && (prior.observationVersion || 0) !== observedVersion) {
      await jobs(database).updateOne({ _id: id }, { $set: { nextObserveAt: new Date(0) } }, { session })
      return
    }
    const now = new Date()
    const term = scope.kind === 'term_review' ? await database.collection('staffingTerms').findOne({ id: scope.termId }, { session }) : null
    const interval = scope.kind === 'term_review' ? boundedSetting('AI_TERM_REVIEW_SCAN_INTERVAL_MS', phase === 'final' ? 300000 : 60000, 50, 86400000) : boundedSetting('AI_AUTO_SCOPE_SCAN_INTERVAL_MS', 30000, 50, 3600000)
    const nextObserveAt = new Date(Math.min(now.getTime() + interval, term && term.endDate > now ? term.endDate.getTime() : Number.POSITIVE_INFINITY))
    const common = { ...coordinates, targetType: snapshot.input.targetType, opportunityId: snapshot.input.opportunityId, actualTermId: snapshot.input.termId, requestedBy: actorId(actor), requestedByEmail: actor.email, automatic: true, priority: priorities[scope.kind], phase: phase || null, lastObservedAt: now, nextObserveAt, coverageHasMore: 'hasMore' in snapshot.input.coverage && snapshot.input.coverage.hasMore }
    if (!prior) {
      await jobs(database).insertOne({ _id: id, ...common, inputHash: snapshot.inputHash, generation: 1, status: 'queued', attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: new Date(now.getTime() + boundedSetting('AI_AUTO_DEBOUNCE_MS', 750, 50, 30000)) }, { session })
      return
    }
    if (prior.inputHash === snapshot.inputHash) {
      if (['ended', 'revoked'].includes(prior.status) && prior.lastInputHash === snapshot.inputHash && prior.lastTaskId) {
        const completed = await database.collection('staffingAiTasks').findOne({ id: prior.lastTaskId }, { session })
        const cached = await database.collection<any>('staffingAiAutomationCache').findOne({ _id: `${id}:${snapshot.inputHash}`, sourceTaskId: prior.lastTaskId }, { session })
        if (completed && (completed.deterministic || completed.result || cached?.result)) await database.collection('staffingAiTasks').updateOne({ id: prior.lastTaskId }, { $set: { status: 'completed', result: completed.result || cached?.result || null, automationGeneration: prior.generation, message: 'Evidence remains current; automatic guidance is available.' } }, { session })
      }
      await jobs(database).updateOne({ _id: id }, { $set: { ...common, ...(['ended', 'revoked'].includes(prior.status) ? { status: prior.lastInputHash === snapshot.inputHash ? 'idle' : 'queued', nextAttemptAt: now, updatedAt: now } : {}) } }, { session })
      return
    }
    const finalDue = phase === 'final' && prior.lastCompletedPhase !== 'final'
    const cooldown = scope.kind === 'term_review' && !finalDue && prior.lastCompletedAt ? new Date(prior.lastCompletedAt).getTime() + boundedSetting('AI_TERM_REVIEW_COOLDOWN_MS', 900000, 50, 86400000) : 0
    const nextAttemptAt = new Date(Math.max(cooldown, now.getTime() + boundedSetting('AI_AUTO_DEBOUNCE_MS', 750, 50, 30000)))
    const running = prior.status === 'running' && prior.leaseUntil > now
    await jobs(database).updateOne({ _id: id }, { $set: { ...common, inputHash: snapshot.inputHash, status: running ? 'running' : 'queued', attempts: 0, nextAttemptAt, updatedAt: now }, $inc: { generation: 1 } }, { session })
    await database.collection('staffingAiTasks').updateMany({ automationScopeId: id, status: 'completed' }, { $set: { status: 'stale', result: null, message: 'Evidence changed; automatic guidance is updating.' } }, { session })
  })
  return snapshot
}

const hints = (db: Db) => db.collection<any>('staffingAiAutomationHints')
const scope = (kind: AiKind, targetId: string, termId = '', page = 1): Scope => ({ kind, targetId, termId, page, pageSize: kind === 'candidate_fit' ? automaticCandidatePageSize() : 50 })
async function hint(db: Db, value: Scope) {
  const id = automaticScopeId(value)
  // Existing resources already have a durable observation lane. Replaying
  // several events for that resource must not refill the new-resource queue.
  const observed = await jobs(db).updateOne({ _id: id }, { $set: { nextObserveAt: new Date(0) }, $inc: { observationVersion: 1 } })
  if (observed.matchedCount) return
  await hints(db).updateOne({ _id: id }, { $setOnInsert: { ...value, priority: priorities[value.kind], createdAt: new Date(), nextAttemptAt: new Date() }, $inc: { generation: 1 } }, { upsert: true })
}

async function discover(db: Db, signal?: AbortSignal) {
  const controls = db.collection<any>('staffingAiAutomationControl')
  await controls.updateOne({ _id: 'discovery' }, { $setOnInsert: { nextAttemptAt: new Date(0), leaseUntil: new Date(0) } }, { upsert: true })
  const token = randomUUID()
  const lease = await controls.findOneAndUpdate({ _id: 'discovery', nextAttemptAt: { $lte: new Date() }, leaseUntil: { $lte: new Date() } }, { $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) } }, { returnDocument: 'after' })
  if (!lease) return
  const state: any = lease.state || { phase: 0, cursors: {}, eventTime: new Date(Date.now() - 30000), eventId: '', reportTerm: '', reportCourse: '' }
  const cycle = await getRecruitmentCycle(db)
  if (state.cycleTermId !== cycle.termId) { state.cycleTermId = cycle.termId; state.cursors.candidates = ''; state.cursors.summaries = ''; state.cursors.requirements = '' }
  const safelyObserve = async (value: Scope, preferredId?: string) => {
    try {
      const observed = await observeScope(db, value, preferredId)
      if (observed) return
    } catch (error: any) { if (![403, 404, 409].includes(error?.statusCode)) throw error }
    await jobs(db).updateOne({ _id: automaticScopeId(value) }, { $set: { status: 'ended', reason: 'Automatic guidance is unavailable for this scope.', nextObserveAt: new Date(Date.now() + 60000), updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } })
  }
  // Each baseline lane creates its own missing scopes. Initial discovery is
  // independent of mutation-event backlog and of the other task kinds.
  const observeNew = async (value: Scope) => {
    const id = automaticScopeId(value)
    if (!await jobs(db).findOne({ _id: id }, { projection: { _id: 1 } })) await safelyObserve(value)
  }
  const nextById = async (collection: string, filter: Document, cursor: string) => db.collection(collection).findOne({ ...filter, ...(cursor ? { id: { $gt: cursor } } : {}) }, { sort: { id: 1 } })
  const step = async (phase: number) => {
    if (phase === 0) {
      const item = await db.collection('staffingEvents').findOne({ $or: [{ createdAt: { $gt: new Date(state.eventTime) } }, { createdAt: new Date(state.eventTime), id: { $gt: state.eventId } }] }, { sort: { createdAt: 1, id: 1 } })
      if (!item) return
      let opportunityId = ''
      let applicantId = ''
      if (item.kind.startsWith('Application') || item.kind === 'CvUploaded') {
        const application = await db.collection('staffingApplications').findOne({ id: item.targetId })
        if (application) { opportunityId = application.opportunityId; applicantId = application.applicantId; await hint(db, scope('cv_summary', application.id)) }
      } else if (item.kind.startsWith('Offer') || item.kind.startsWith('Appointment') || item.kind === 'WorkloadRecorded') {
        const collection = item.kind.startsWith('Offer') ? 'staffingOffers' : 'staffingAppointments'
        const record = await db.collection(collection).findOne({ id: item.targetId })
        if (record) { opportunityId = record.opportunityId; applicantId = record.applicantId }
      } else if (item.kind.startsWith('Opportunity')) opportunityId = item.targetId
      if (opportunityId) {
        await hint(db, scope('candidate_fit', opportunityId))
        await jobs(db).updateMany({ opportunityId }, { $set: { nextObserveAt: new Date(0) }, $inc: { observationVersion: 1 } })
        if (item.kind.startsWith('Opportunity')) await hint(db, scope('opportunity_draft', opportunityId))
        const posting = await findOpportunity(db, opportunityId).catch(() => null)
        if (posting?.type === 'ta') await hint(db, scope('term_review', posting.courseId, posting.termId))
      }
      if (applicantId) {
        const affected = await db.collection('staffingApplications').distinct('opportunityId', { applicantId })
        await jobs(db).updateMany({ kind: 'candidate_fit', targetId: { $in: affected } }, { $set: { nextObserveAt: new Date(0) }, $inc: { observationVersion: 1 } })
      }
      if (item.kind === 'RecruitmentCycleConfigured') await jobs(db).updateMany({ kind: { $ne: 'term_review' } }, { $set: { nextObserveAt: new Date(0) }, $inc: { observationVersion: 1 } })
      state.eventTime = item.createdAt; state.eventId = item.id
      return
    }
    if (phase === 1 || phase === 2 || phase === 3) {
      const key = phase === 1 ? 'candidates' : phase === 2 ? 'summaries' : 'requirements'
      const filter = phase === 2 ? { termId: cycle.termId || '', submittedAt: { $exists: true }, status: { $in: ['submitted', 'under_review', 'shortlisted', 'selected'] } } : { termId: cycle.termId || '', status: { $in: phase === 1 ? ['published', 'applications_closed', 'filled'] : ['draft', 'pending_approval', 'published', 'applications_closed', 'filled'] } }
      const row = await nextById(phase === 2 ? 'staffingApplications' : 'staffingOpportunities', filter, state.cursors[key] || '')
      if (row) {
        const value = scope(phase === 1 ? 'candidate_fit' : phase === 2 ? 'cv_summary' : 'opportunity_draft', row.id)
        await observeNew(value)
      }
      state.cursors[key] = row?.id || ''
      return
    }
    if (phase === 4) {
      const reportTerms = { $or: [{ startDate: { $lte: new Date() } }, { id: cycle.termId || '' }] }
      let term = state.reportTerm ? await db.collection('staffingTerms').findOne({ $and: [{ id: state.reportTerm }, reportTerms] }) : null
      if (!term) {
        term = await nextById('staffingTerms', reportTerms, state.cursors.terms || '')
        if (!term) { state.cursors.terms = ''; return }
        state.reportTerm = term.id; state.reportCourse = ''
      }
      const course = await nextById('courses', {}, state.reportCourse || '')
      if (!course) { state.cursors.terms = term.id; state.reportTerm = ''; state.reportCourse = ''; return }
      const value = scope('term_review', course.id, term.id)
      if (!await jobs(db).findOne({ _id: automaticScopeId(value) }, { projection: { _id: 1 } })) {
        const dates = { $gte: term.startDate, $lt: term.endDate }
        const relevant = await db.collection('staffingOpportunities').findOne({ type: 'ta', termId: term.id, courseId: { $in: await staffingCourseAliases(db, course.id) } }, { projection: { _id: 1 } }) || await db.collection('helpSessions').findOne({ courseId: course.id, joinedAt: dates }, { projection: { _id: 1 } }) || await db.collection('feedback').findOne({ courseId: course.id, createdAt: dates }, { projection: { _id: 1 } })
        if (relevant) await observeNew(value)
      }
      state.reportCourse = course.id
      return
    }
    if (phase === 5) {
      const kinds: AiKind[] = ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review']
      const preferHint = state.hintNext !== false
      // Persist the opposite turn even if an observation fails, so one noisy
      // backlog cannot indefinitely postpone existing candidate/final scopes.
      state.hintNext = !preferHint
      const observeHint = async () => {
        const first = Number.isInteger(state.hintKind) && state.hintKind >= 0 && state.hintKind < kinds.length ? state.hintKind : 0
        for (let offset = 0; offset < kinds.length; offset++) {
          const index = (first + offset) % kinds.length
          const pending = await hints(db).findOne({ kind: kinds[index], nextAttemptAt: { $lte: new Date() } }, { sort: { nextAttemptAt: 1, createdAt: 1, _id: 1 } })
          if (!pending) continue
          // Advance before observation, including failure/restart paths.
          state.hintKind = (index + 1) % kinds.length
          await safelyObserve(pending)
          await hints(db).deleteOne({ _id: pending._id, generation: pending.generation })
          return true
        }
        return false
      }
      const observeDue = async () => {
        const first = Number.isInteger(state.dueKind) && state.dueKind >= 0 && state.dueKind < kinds.length ? state.dueKind : 0
        for (let offset = 0; offset < kinds.length; offset++) {
          const index = (first + offset) % kinds.length
          const due = await jobs(db).findOne({ kind: kinds[index], nextObserveAt: { $lte: new Date() } }, { sort: { nextObserveAt: 1, _id: 1 } })
          if (!due) continue
          // Existing scopes need their own persistent turn: repeated candidate
          // changes must not postpone already discovered summaries or reviews.
          state.dueKind = (index + 1) % kinds.length
          await safelyObserve(due, due.requestedBy)
          return true
        }
        return false
      }
      if (preferHint) { if (!await observeHint()) await observeDue() }
      else if (!await observeDue()) await observeHint()
      return
    }
    const parent = await jobs(db).findOne({ kind: 'candidate_fit', pageSize: automaticCandidatePageSize(), status: { $nin: ['ended', 'revoked'] }, coverageHasMore: true, page: { $lt: 10000 }, ...(state.cursors.pages ? { _id: { $gt: state.cursors.pages } } : {}) }, { sort: { _id: 1 } })
    if (parent) {
      const value = scope('candidate_fit', parent.targetId, '', parent.page + 1)
      await observeNew(value)
    }
    state.cursors.pages = parent?._id || ''
  }
  const started = performance.now()
  try {
    for (let count = 0; count < boundedSetting('AI_AUTO_DISCOVERY_BATCH_SIZE', 12, 1, 100) && performance.now() - started < boundedSetting('AI_AUTO_DISCOVERY_WORK_MS', 350, 50, 5000) && !signal?.aborted; count++) {
      await step(state.phase || 0)
      state.phase = ((state.phase || 0) + 1) % 7
      const saved = await controls.updateOne({ _id: 'discovery', leaseToken: token, leaseUntil: { $gt: new Date() } }, { $set: { state, leaseUntil: new Date(Date.now() + 60000) } })
      if (!saved.matchedCount) return
    }
  } finally {
    await controls.updateOne({ _id: 'discovery', leaseToken: token }, { $set: { state, leaseUntil: new Date(0), nextAttemptAt: new Date(Date.now() + boundedSetting('AI_AUTO_DISCOVERY_INTERVAL_MS', 2000, 50, 60000)) }, $unset: { leaseToken: '' } })
  }
}

async function claimAutomaticJob(db: Db, allowedIds?: string[]) {
  const controls = db.collection<any>('staffingAiAutomationControl')
  // Initialize outside the claim transaction: concurrent first-time upserts
  // may collide on _id, while later cursor writes remain transactionally fenced.
  try {
    await controls.updateOne({ _id: 'execution' }, { $setOnInsert: { nextKind: 0 } }, { upsert: true })
  } catch (error: any) {
    if (error?.code !== 11000 || !await controls.findOne({ _id: 'execution' }, { projection: { _id: 1 } })) throw error
  }
  return withTransaction(async (database, session) => {
    const control = await database.collection<any>('staffingAiAutomationControl').findOne({ _id: 'execution' }, { session })
    const kinds: AiKind[] = ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review']
    const first = Number.isInteger(control?.nextKind) && control.nextKind >= 0 && control.nextKind < kinds.length ? control.nextKind : 0
    const now = new Date()
    const due = { $or: [{ status: { $in: ['queued', 'failed', 'blocked', 'unconfigured'] }, nextAttemptAt: { $lte: now } }, { status: 'running', leaseUntil: { $lte: now } }] }
    for (let offset = 0; offset < kinds.length; offset++) {
      const index = (first + offset) % kinds.length
      const pending = await jobs(database).findOne({ kind: kinds[index], ...due, ...(allowedIds ? { _id: { $in: allowedIds } } : {}) }, { session, sort: { nextAttemptAt: 1, _id: 1 } })
      if (!pending) continue
      const claimed = await jobs(database).findOneAndUpdate({ _id: pending._id, kind: kinds[index], generation: pending.generation, ...due }, { $set: { status: 'running', runningGeneration: pending.generation, runningInputHash: pending.inputHash, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 90000), taskId: randomUUID(), updatedAt: new Date() }, $inc: { fence: 1 } }, { session, returnDocument: 'after' })
      if (!claimed) continue
      // A shared short transaction serializes only the claim and its turn.
      // Fingerprinting, authority checks and provider work happen after commit.
      await database.collection<any>('staffingAiAutomationControl').updateOne({ _id: 'execution' }, { $set: { nextKind: (index + 1) % kinds.length, updatedAt: new Date() } }, { session })
      return claimed
    }
    return null
  })
}

async function executeOne(db: Db, signal?: AbortSignal, allowedIds?: string[]) {
  const capacity = await aiUsageCollection(db).findOne({ _id: 'concurrency' })
  if ((capacity?.leases || []).filter((lease: any) => lease.expiresAt > new Date()).length >= boundedSetting('AI_MAX_CONCURRENT', 2, 1, 20)) return
  const job = await claimAutomaticJob(db, allowedIds)
  if (!job) return
  const leaseToken = job.leaseToken
  let actor: StaffingActor | null = null
  let evidenceChanged = false
  try {
    actor = await scopeActor(db, job, job.requestedBy)
    if (!actor) fail(403, 'Automatic reviewer authority changed')
    const snapshot = await aiTaskFingerprint(db, actor, job, { automatic: true })
    if (snapshot.inputHash !== job.inputHash) { evidenceChanged = true; await observeScope(db, job, actorId(actor)); fail(409, 'Automatic evidence changed') }
    await createAiTask(db, actor, job, { taskId: job.taskId, automationScopeId: job._id, generation: job.runningGeneration, leaseToken, signal })
  } catch (error: any) {
    const completed = await db.collection('staffingAiTasks').findOne({ id: job.taskId, status: 'completed' })
    if (!completed) await db.collection('staffingAiTasks').updateOne({ id: job.taskId }, { $set: { kind: job.kind, targetId: job.targetId, targetType: job.targetType, requestedTermId: job.termId, opportunityId: job.opportunityId, termId: job.actualTermId, candidatePage: job.page, candidatePageSize: job.pageSize, requestedBy: actor ? actorId(actor) : job.requestedBy, automatic: true, automationScopeId: job._id, automationGeneration: job.runningGeneration, inputHash: job.runningInputHash, failureCode: evidenceChanged ? 'evidence_changed' : [403, 404, 409].includes(error?.statusCode) ? 'scope_unavailable' : 'automation_unavailable', status: 'failed', result: null, createdAt: new Date(), completedAt: new Date(), message: 'Automatic guidance is waiting for current evidence and authority.' } }, { upsert: true })
  }
  await withTransaction(async (database, session) => {
    const current = await jobs(database).findOneAndUpdate({ _id: job._id, leaseToken }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
    if (!current) return
    const task = await database.collection('staffingAiTasks').findOne({ id: job.taskId }, { session })
    let status = 'failed'
    let attempts = (current.attempts || 0) + 1
    let nextAttemptAt = new Date(Date.now() + Math.min(21600000, boundedSetting('AI_AUTO_RETRY_BASE_MS', 30000, 100, 3600000) * 2 ** Math.min(attempts - 1, 10)))
    const changed = current.generation !== job.runningGeneration || current.inputHash !== task?.inputHash || task?.status === 'stale' || task?.failureCode === 'evidence_changed'
    if (task?.failureCode === 'scope_unavailable') { status = 'ended'; attempts = 0 }
    else if (task?.failureCode === 'input_budget') { status = 'blocked'; nextAttemptAt = new Date('9999-12-31T23:59:59.000Z') }
    else if (changed) { status = 'queued'; attempts = 0; nextAttemptAt = current.nextAttemptAt > new Date() ? current.nextAttemptAt : new Date(Date.now() + 400) }
    else if (task?.status === 'completed') { status = 'idle'; attempts = 0 }
    else if (task?.status === 'unconfigured') status = 'unconfigured'
    else if (task?.failureCode === 'quota_daily') { status = 'blocked'; nextAttemptAt = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.250Z'); nextAttemptAt.setUTCDate(nextAttemptAt.getUTCDate() + 1) }
    else if (task?.failureCode === 'quota_concurrency') { status = 'queued'; nextAttemptAt = new Date(Date.now() + Math.min(30000, 500 * 2 ** Math.min(attempts, 6))) }
    if (status === 'idle' && task?.result) await database.collection<any>('staffingAiAutomationCache').updateOne({ _id: `${job._id}:${task.inputHash}` }, { $set: { scopeId: job._id, inputHash: task.inputHash, result: task.result, coverage: task.coverage, sourceTaskId: task.id, createdAt: task.completedAt } }, { session, upsert: true })
    if (status !== 'idle') await database.collection('staffingAiTasks').updateOne({ id: job.taskId }, { $set: { result: null, ...(status === 'queued' ? { status: 'stale' } : {}) } }, { session })
    await jobs(database).updateOne({ _id: job._id, leaseToken }, { $set: { status, attempts, nextAttemptAt, reason: task?.failureCode === 'input_budget' ? 'Evidence exceeds the automatic input budget; processing resumes when the evidence changes.' : '', updatedAt: new Date(), ...(status === 'idle' ? { lastTaskId: job.taskId, lastInputHash: task?.inputHash, lastCompletedAt: new Date(), lastCompletedPhase: current.phase } : {}) }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
  })
}

export async function runAiAutomationDiscovery(db: Db, signal?: AbortSignal) {
  if (!automaticDiscoveryEnabled() || !aiStatus().configured || signal?.aborted) return
  await initializeAiAutomation(db)
  const selected = selectedAutomaticScopes(process.env.AI_AUTOMATION_SCOPES, automaticCandidatePageSize())
  if (selected) {
    const endScope = async (value: Scope) => jobs(db).updateOne({ _id: automaticScopeId(value) }, { $set: { status: 'ended', reason: 'Automatic guidance is unavailable for this scope.', nextObserveAt: new Date(Date.now() + 30000), updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } })
    for (const value of selected) {
      if (signal?.aborted) break
      const prior = await jobs(db).findOne({ _id: automaticScopeId(value) }, { projection: { nextObserveAt: 1 } })
      if (prior?.nextObserveAt > new Date()) continue
      try { if (!await observeScope(db, value)) await endScope(value) }
      catch (error: any) {
        if (![403, 404, 409].includes(error?.statusCode)) throw error
        await endScope(value)
      }
    }
    return
  }
  await discover(db, signal)
}

export async function runAiAutomationExecution(db: Db, signal?: AbortSignal) {
  if (!automaticDiscoveryEnabled() || !aiStatus().configured || signal?.aborted) return
  await initializeAiAutomation(db)
  const { reconcileDueStaffing } = await import('./staffing-appointments')
  await reconcileDueStaffing(db)
  if (signal?.aborted) return
  const selected = selectedAutomaticScopes(process.env.AI_AUTOMATION_SCOPES, automaticCandidatePageSize())
  await executeOne(db, signal, selected?.map(automaticScopeId))
}

export async function runAiAutomationCycle(db: Db, signal?: AbortSignal) {
  await Promise.all([runAiAutomationDiscovery(db, signal), runAiAutomationExecution(db, signal)])
}

export async function automaticReadFilter(db: Db, user: StaffingActor): Promise<Document> {
  if (isGlobalAdmin(user)) return {}
  const courseIds = await db.collection('enrollments').distinct('courseId', { userEmail: user.email, role: { $in: ['instructor', 'admin'] } })
  const courses = await db.collection('courses').find({ id: { $in: courseIds } }, { projection: { id: 1, code: 1 } }).toArray()
  const aliases = [...new Set(courses.flatMap(course => [course.id, course.code]).filter(Boolean))].map((value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
  const opportunityIds = await db.collection('staffingOpportunities').distinct('id', { $or: [{ type: 'ta', courseId: { $in: aliases } }, ...(courseIds.length ? [{ type: 'ra', ownerId: actorId(user) }] : [])] })
  const applicationIds = await db.collection('staffingApplications').distinct('id', { $or: [{ opportunityId: { $in: opportunityIds } }, { applicantId: actorId(user) }] })
  return { $or: [{ kind: 'term_review', targetId: { $in: courseIds } }, { kind: { $in: ['candidate_fit', 'opportunity_draft'] }, targetId: { $in: opportunityIds } }, { kind: 'cv_summary', targetId: { $in: applicationIds } }] }
}

export async function automaticMetadata(db: Db, user: StaffingActor, filter: { targetId?: string; kind?: string; termId?: string; page?: number; pageSize?: number }) {
  const scopes = jobs(db).find({ $and: [filter.targetId ? {} : await automaticReadFilter(db, user), { ...(filter.targetId ? { targetId: filter.targetId } : {}), ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.kind === 'term_review' ? { termId: filter.termId || '' } : {}), ...(filter.kind === 'candidate_fit' && filter.page !== undefined ? { page: filter.page } : {}), ...(filter.kind === 'candidate_fit' && filter.pageSize !== undefined ? { pageSize: filter.pageSize } : {}) }] }).sort({ _id: 1 }).batchSize(100)
  const permitted: Document[] = []
  try { for await (const scope of scopes) {
    if (permitted.length >= 100) break
    if (scope.kind === 'candidate_fit' && scope.pageSize !== automaticCandidatePageSize()) continue
    try {
      if (scope.kind === 'cv_summary') await applicationAccess(db, scope.targetId, user)
      else if (scope.kind === 'term_review') { if (!await manualCourseManager(db, scope.targetId, user) || !await db.collection('courses').findOne({ id: scope.targetId }, { projection: { _id: 1 } })) continue }
      else await assertOpportunityManager(db, await findOpportunity(db, scope.targetId), user)
      permitted.push(scope)
    } catch (error: any) { if (![403, 404].includes(error?.statusCode)) throw error }
  } } finally { await scopes.close() }
  return {
    subscriptions: permitted.map(scope => ({ id: scope._id, kind: scope.kind, targetId: scope.targetId, termId: scope.termId, page: scope.page, pageSize: scope.pageSize, status: ['ended', 'revoked'].includes(scope.status) ? scope.status : 'active', automatic: true })),
    jobs: permitted.map(scope => ({ subscriptionId: scope._id, kind: scope.kind, targetId: scope.targetId, termId: scope.termId, page: scope.page, pageSize: scope.pageSize, status: aiStatus().configured ? scope.status : 'unconfigured', generation: scope.generation, reason: scope.reason || '', updatedAt: scope.updatedAt, nextAttemptAt: scope.nextAttemptAt, phase: scope.phase, lastTaskId: scope.lastTaskId })),
  }
}
