import { createHash, randomUUID } from 'node:crypto'
import type { ClientSession, Db, Document } from 'mongodb'
import { getServerConfig } from './config'
import { actorId, assertOpportunityManager, fail, publicRecord, type StaffingActor } from './staffing'

const initialized = new WeakMap<Db, Promise<void>>()
const jobs = (db: Db) => db.collection<any>('staffingAiRefreshJobs')
const scopes = (db: Db) => db.collection<any>('staffingAiSubscriptions')
const configured = () => !!(process.env.AI_BASE_URL?.trim() && process.env.AI_API_KEY?.trim() && process.env.AI_MODEL?.trim())
const mutationKinds = ['ApplicationSubmitted', 'ApplicationRevised', 'ApplicationWithdrawn', 'ApplicationReviewed', 'CvUploaded', 'OfferIssued', 'OfferAccepted', 'OfferDeclined', 'OfferRescinded', 'AppointmentExpired', 'AppointmentEnded', 'AppointmentActivated', 'AppointmentClearance', 'AppointmentSuspend', 'AppointmentResume', 'OpportunityUpdated', 'RecruitmentCycleConfigured']

export function initializeAiRefresh(db: Db) {
  let promise = initialized.get(db)
  if (!promise) {
    promise = (async () => {
      await scopes(db).createIndexes([{ key: { id: 1 }, unique: true }, { key: { requesterId: 1, opportunityId: 1, page: 1, pageSize: 1 }, unique: true }, { key: { opportunityId: 1, active: 1 } }])
      await jobs(db).createIndexes([{ key: { status: 1, nextAttemptAt: 1 } }, { key: { opportunityId: 1 } }])
      await db.collection('staffingAiResultCache').createIndex({ opportunityId: 1 })
      await db.collection('staffingEvents').createIndex({ aiRefreshProcessedAt: 1, kind: 1, createdAt: 1 })
    })().catch(error => { initialized.delete(db); throw error })
    initialized.set(db, promise)
  }
  return promise
}

/** Rebuild minimum authority from the account and current scope, never a saved role label. */
async function refreshActor(db: Db, subscription: Document): Promise<StaffingActor | null> {
  const account = await db.collection('users').findOne({ id: subscription.requesterId, disabledAt: null })
  if (!account) return null
  const config = getServerConfig()
  let provider: 'gitlab' | 'mock' = account.identityKind === 'gitlab' ? 'gitlab' : 'mock'
  if (provider === 'gitlab') {
    if (!await db.collection('providerIdentities').findOne({ userId: account.id, email: account.email, provider: 'gitlab', revokedAt: null })) return null
  } else if (!config.mockLoginEnabled || await db.collection('providerIdentities').findOne({ $or: [{ userId: account.id }, { email: account.email }] })) return null
  let actor: StaffingActor = { id: account.id, email: account.email, name: account.name || account.email, provider, primaryRole: 'student' }
  const opportunity = await db.collection('staffingOpportunities').findOne({ id: subscription.opportunityId, status: { $in: ['published', 'applications_closed', 'filled'] } })
  if (!opportunity) return null
  if (new Date(opportunity.appointmentEnd).getTime() <= Date.now()) return null
  const { getRecruitmentCycle } = await import('./staffing-cycle')
  const cycle = await getRecruitmentCycle(db)
  if (cycle.termId !== opportunity.termId || !cycle.canReview) return null
  try { await assertOpportunityManager(db, opportunity, actor); return actor } catch (error: any) { if (error?.statusCode !== 403) throw error }
  if (provider === 'mock' && config.mockLoginEnabled) {
    const admin = await db.collection('authSessions').findOne({ userId: account.id, 'user.id': account.id, 'user.email': account.email, 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null })
    if (admin) { actor = { ...actor, primaryRole: 'admin' }; await assertOpportunityManager(db, opportunity, actor); return actor }
  }
  return null
}

async function affectedOpportunities(db: Db, change: { opportunityId?: string; applicantId?: string; allSubscriptions?: boolean }, session?: ClientSession) {
  const ids = new Set<string>(change.opportunityId ? [change.opportunityId] : [])
  if (change.allSubscriptions) for (const id of await scopes(db).distinct('opportunityId', { active: true }, session ? { session } : {})) ids.add(String(id))
  if (change.applicantId) for (const id of await db.collection('staffingApplications').distinct('opportunityId', { applicantId: change.applicantId }, session ? { session } : {})) ids.add(String(id))
  return [...ids]
}

/** Called inside domain transactions; it takes no course/project/applicant locks. */
export async function invalidateCandidateRefresh(db: Db, session: ClientSession, change: { opportunityId?: string; applicantId?: string }) {
  const targetIds = await affectedOpportunities(db, change, session)
  if (!targetIds.length) return
  await db.collection('staffingAiAutomationJobs').updateMany({ kind: 'candidate_fit', targetId: { $in: targetIds } }, { $set: { nextObserveAt: new Date(0) }, $inc: { observationVersion: 1 } }, { session })
  const subscriptions = await scopes(db).find({ opportunityId: { $in: targetIds }, active: true }, { session }).sort({ id: 1 }).toArray()
  for (const subscription of subscriptions) {
    const opportunity = await db.collection('staffingOpportunities').findOne({ id: subscription.opportunityId }, { session })
    if (opportunity && new Date(opportunity.appointmentEnd).getTime() <= Date.now()) {
      await scopes(db).updateOne({ id: subscription.id }, { $set: { active: false, status: 'ended' } }, { session })
      await jobs(db).updateOne({ _id: subscription.id }, { $set: { status: 'ended', dirty: false, updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
      continue
    }
    const job = await jobs(db).findOneAndUpdate({ _id: subscription.id }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
    if (!job) continue
    const running = job.status === 'running' && job.leaseUntil > new Date()
    await jobs(db).updateOne({ _id: subscription.id }, { $inc: { generation: 1 }, $set: { status: running ? 'running' : 'queued', dirty: true, reason: 'Candidate evidence or availability changed', updatedAt: new Date(), nextAttemptAt: new Date(Date.now() + 400) } }, { session })
    await db.collection('staffingAiTasks').updateMany({ refreshSubscriptionId: subscription.id, status: 'completed' }, { $set: { status: 'stale', result: null, message: 'Candidate evidence or availability changed. Automatic analysis is queued.' } }, { session })
  }
}

async function register(db: Db, user: StaffingActor, snapshot: any) {
  await initializeAiRefresh(db)
  const id = createHash('sha256').update(JSON.stringify([actorId(user), snapshot.targetId, snapshot.page, snapshot.pageSize])).digest('hex')
  const { withTransaction } = await import('./db')
  await withTransaction(async (database, session) => {
    await scopes(database).updateOne({ id }, { $set: { requesterId: actorId(user), requesterEmail: user.email, opportunityId: snapshot.targetId, kind: 'candidate_fit', page: snapshot.page, pageSize: snapshot.pageSize, active: true, status: 'active', approvedAt: new Date() }, $inc: { approvalVersion: 1 }, $setOnInsert: { id, createdAt: new Date() } }, { session, upsert: true })
    await jobs(database).updateOne({ _id: id }, { $inc: { fence: 1 }, $setOnInsert: { subscriptionId: id, opportunityId: snapshot.targetId, status: 'idle', generation: 0, createdAt: new Date(), nextAttemptAt: new Date() } }, { session, upsert: true })
  })
  return id
}

async function claim(db: Db, subscription: Document, snapshot: any, manual: boolean, expectedGeneration?: number) {
  const { withTransaction } = await import('./db')
  return withTransaction(async (database, session) => {
    const job = await jobs(database).findOneAndUpdate({ _id: subscription.id }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
    if (!job) return null
    if (!manual && job.generation !== expectedGeneration) return null
    if (job.status === 'running' && job.leaseUntil > new Date()) return null
    if (!manual && job.lastInputHash === snapshot.inputHash && job.lastTaskId) {
      const prior = await database.collection('staffingAiTasks').findOne({ id: job.lastTaskId }, { session })
      const cached = await database.collection<any>('staffingAiResultCache').findOne({ _id: `${subscription.id}:${snapshot.inputHash}` }, { session })
      if (prior && ['completed', 'stale'].includes(prior.status) && (prior.deterministic || prior.result || cached?.result)) {
        await database.collection('staffingAiTasks').updateOne({ id: prior.id }, { $set: { status: 'completed', result: prior.result || cached?.result || null, refreshGeneration: job.generation, message: prior.deterministic ? prior.message : 'Evidence remains current; no additional model call was needed.' } }, { session })
        await jobs(database).updateOne({ _id: subscription.id }, { $set: { status: 'idle', dirty: false, updatedAt: new Date() } }, { session })
        return null
      }
    }
    const generation = manual ? job.generation + 1 : job.generation
    const token = randomUUID()
    const taskId = randomUUID()
    await jobs(database).updateOne({ _id: subscription.id }, { $set: { status: 'running', generation, runningGeneration: generation, runningInputHash: snapshot.inputHash, lastAttemptedInputHash: snapshot.inputHash, taskId, leaseToken: token, leaseUntil: new Date(Date.now() + 90000), dirty: false, updatedAt: new Date() } }, { session })
    await database.collection('staffingAiTasks').updateMany({ refreshSubscriptionId: subscription.id, status: 'completed' }, { $set: { status: 'stale', result: null, message: 'A fresh comparison is running.' } }, { session })
    await database.collection('staffingAiTasks').insertOne({ id: taskId, kind: 'candidate_fit', targetId: subscription.opportunityId, targetType: 'opportunity', requestedBy: subscription.requesterId, requestedByEmail: subscription.requesterEmail, candidatePage: subscription.page, candidatePageSize: subscription.pageSize, requestedTermId: '', refreshSubscriptionId: subscription.id, refreshGeneration: generation, status: 'pending', message: 'An automatic candidate comparison is running.', createdAt: new Date() }, { session })
    return { token, taskId, generation }
  })
}

async function execute(db: Db, subscription: Document, actor: StaffingActor, snapshot: any, lease: { token: string; taskId: string; generation: number }, signal?: AbortSignal) {
  const { createAiTask, candidateRefreshFingerprint } = await import('./ai')
  let result: any
  try {
    result = await createAiTask(db, actor, { kind: 'candidate_fit', targetId: subscription.opportunityId, page: subscription.page, pageSize: subscription.pageSize }, { taskId: lease.taskId, subscriptionId: subscription.id, generation: lease.generation, leaseToken: lease.token, signal })
  } catch (error: any) {
    await db.collection('staffingAiTasks').updateOne({ id: lease.taskId }, { $set: { status: 'failed', result: null, message: [403, 404].includes(error?.statusCode) ? 'Reviewer authority changed; analysis is disabled.' : 'Automatic analysis failed. Manual staffing remains available.' } })
  }
  const currentActor = await refreshActor(db, subscription)
  let currentHash: string | undefined
  if (currentActor && !signal?.aborted) {
    try { currentHash = (await candidateRefreshFingerprint(db, currentActor, { targetId: subscription.opportunityId, page: subscription.page, pageSize: subscription.pageSize })).inputHash } catch {}
  }
  const { withTransaction } = await import('./db')
  await withTransaction(async (database, session) => {
    const job = await jobs(database).findOneAndUpdate({ _id: subscription.id, leaseToken: lease.token }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
    if (!job) return
    const task = await database.collection('staffingAiTasks').findOne({ id: lease.taskId }, { session })
    const currentScope = await scopes(database).findOne({ id: subscription.id }, { session })
    let status = 'failed'
    let nextAttemptAt = new Date(Date.now() + 86400000)
    if (!currentActor) {
      if (currentScope?.active && currentScope.approvalVersion !== subscription.approvalVersion) {
        status = 'queued'; nextAttemptAt = new Date(Date.now() + 400)
      } else {
        status = 'revoked'
        await scopes(database).updateOne({ id: subscription.id, approvalVersion: subscription.approvalVersion }, { $set: { active: false, status: 'revoked' } }, { session })
      }
    } else if (!currentScope?.active) {
      status = 'revoked'
    } else if (signal?.aborted || job.generation !== lease.generation || job.dirty || task?.status === 'stale' || (currentHash && currentHash !== task?.inputHash)) {
      status = 'queued'; nextAttemptAt = new Date(Date.now() + 400)
    } else if (task?.status === 'completed') status = 'idle'
    else if (task?.status === 'unconfigured') status = 'unconfigured'
    else if (task?.failureCode === 'quota_concurrency') {
      status = 'queued'; nextAttemptAt = new Date(Date.now() + Math.min(30000, 500 * 2 ** Math.min(job.capacityWaits || 0, 6)))
    } else if (task?.message?.includes('budget')) {
      status = 'blocked'; nextAttemptAt = new Date(new Date().toISOString().slice(0, 10) + 'T23:59:59.999Z')
    }
    if (status !== 'idle') await database.collection('staffingAiTasks').updateOne({ id: lease.taskId }, { $set: { status: ['queued', 'revoked'].includes(status) ? 'stale' : task?.status || 'failed', result: null, message: status === 'queued' ? 'Inputs changed; a fresh automatic comparison is queued.' : status === 'revoked' ? 'Reviewer authority changed; analysis is disabled.' : task?.message || 'Automatic analysis is unavailable.' } }, { session })
    if (status === 'idle' && task?.result) await database.collection<any>('staffingAiResultCache').updateOne({ _id: `${subscription.id}:${task.inputHash}` }, { $set: { opportunityId: subscription.opportunityId, requesterId: subscription.requesterId, result: task.result, createdAt: new Date() } }, { session, upsert: true })
    await jobs(database).updateOne({ _id: subscription.id, leaseToken: lease.token }, { $set: { status, lastTaskId: lease.taskId, capacityWaits: task?.failureCode === 'quota_concurrency' ? (job.capacityWaits || 0) + 1 : 0, ...(status === 'idle' ? { lastInputHash: task?.inputHash, dirty: false } : {}), nextAttemptAt, updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
  })
  const task = publicRecord(await db.collection('staffingAiTasks').findOne({ id: lease.taskId }))
  const finalJob = await jobs(db).findOne({ _id: subscription.id })
  return { task: task?.status === 'completed' && (finalJob?.status !== 'idle' || finalJob.lastTaskId !== task.id || finalJob.generation !== task.refreshGeneration) ? { ...task, status: 'stale', result: null, message: 'A newer automatic comparison is pending.' } : task }
}

export async function requestCandidateRefresh(db: Db, user: StaffingActor, raw: unknown) {
  const { candidateRefreshFingerprint, createAiTask } = await import('./ai')
  if (!configured()) return createAiTask(db, user, raw)
  const snapshot = await candidateRefreshFingerprint(db, user, raw)
  const id = await register(db, user, snapshot)
  const subscription = await scopes(db).findOne({ id })
  const lease = await claim(db, subscription, snapshot, true)
  if (!lease) {
    const running = await jobs(db).findOne({ _id: id })
    const task = publicRecord(await db.collection('staffingAiTasks').findOne({ id: running?.taskId || running?.lastTaskId }))
    return { task: task && running?.status === 'running' ? { ...task, status: 'pending', result: null, message: 'A comparison is already running for this approved scope.' } : task }
  }
  return execute(db, subscription, user, snapshot, lease)
}

async function eventChange(db: Db, item: Document) {
  if (item.kind === 'RecruitmentCycleConfigured') return { allSubscriptions: true }
  if (item.kind.startsWith('Application') || item.kind === 'CvUploaded') {
    const app = await db.collection('staffingApplications').findOne({ id: item.targetId })
    return app ? { opportunityId: app.opportunityId, applicantId: app.applicantId } : {}
  }
  if (item.kind.startsWith('Offer')) {
    const offer = await db.collection('staffingOffers').findOne({ id: item.targetId })
    return offer ? { opportunityId: offer.opportunityId, applicantId: offer.applicantId } : {}
  }
  if (item.kind.startsWith('Appointment')) {
    const appointment = await db.collection('staffingAppointments').findOne({ id: item.targetId })
    return appointment ? { opportunityId: appointment.opportunityId, applicantId: appointment.applicantId } : {}
  }
  return { opportunityId: item.targetId }
}

async function observeChanges(db: Db) {
  const pending = await db.collection('staffingEvents').find({ kind: { $in: mutationKinds }, aiRefreshProcessedAt: { $exists: false } }).sort({ createdAt: 1, id: 1 }).limit(100).toArray()
  const { candidateRefreshFingerprint } = await import('./ai')
  const affected = new Set<string>()
  const eventTargets = new Map<string, string[]>()
  for (const item of pending) {
    const ids = await affectedOpportunities(db, await eventChange(db, item))
    eventTargets.set(item.id, ids)
    for (const id of ids) affected.add(id)
  }
  const subscriptions = await scopes(db).find({ active: true, opportunityId: { $in: [...affected] } }).sort({ id: 1 }).toArray()
  const dirty: Array<{ id: string; generation: number }> = []
  for (const subscription of subscriptions) {
    const actor = await refreshActor(db, subscription)
    const job = await jobs(db).findOne({ _id: subscription.id })
    if (!actor) { dirty.push({ id: subscription.id, generation: job?.generation }); continue }
    try {
      const snapshot = await candidateRefreshFingerprint(db, actor, { targetId: subscription.opportunityId, page: subscription.page, pageSize: subscription.pageSize })
      if (snapshot.inputHash !== (job?.status === 'running' ? job.runningInputHash : job?.lastAttemptedInputHash || job?.lastInputHash)) dirty.push({ id: subscription.id, generation: job?.generation })
    } catch { dirty.push({ id: subscription.id, generation: job?.generation }) }
  }
  const { withTransaction } = await import('./db')
  await withTransaction(async (database, session) => {
    // An observer whose comparison became obsolete leaves events unclaimed so
    // the next cycle can evaluate them against the newer running generation.
    for (const observed of dirty) {
      const current = await jobs(database).findOne({ _id: observed.id }, { session })
      if (current?.generation !== observed.generation) return
    }
    const claimedTargets = new Set<string>()
    for (const item of pending) {
      const updated = await database.collection('staffingEvents').updateOne({ id: item.id, aiRefreshProcessedAt: { $exists: false } }, { $set: { aiRefreshProcessedAt: new Date() } }, { session })
      if (updated.modifiedCount) for (const target of eventTargets.get(item.id) || []) claimedTargets.add(target)
    }
    const queued = new Set<string>()
    for (const observed of dirty) {
      const subscription = await scopes(database).findOne({ id: observed.id, active: true }, { session })
      if (subscription && claimedTargets.has(subscription.opportunityId) && !queued.has(subscription.opportunityId)) {
        queued.add(subscription.opportunityId)
        await invalidateCandidateRefresh(database, session, { opportunityId: subscription.opportunityId })
      }
    }
  })
}

async function stopEndedCandidateRefresh(db: Db) {
  const ended = await db.collection('staffingOpportunities').distinct('id', { appointmentEnd: { $lte: new Date() } })
  if (!ended.length) return
  const subscriptions = await scopes(db).find({ opportunityId: { $in: ended }, active: true }).sort({ id: 1 }).toArray()
  if (!subscriptions.length) return
  const { withTransaction } = await import('./db')
  await withTransaction(async (database, session) => {
    for (const subscription of subscriptions) {
      await scopes(database).updateOne({ id: subscription.id, active: true }, { $set: { active: false, status: 'ended' } }, { session })
      await jobs(database).updateOne({ _id: subscription.id }, { $set: { status: 'ended', dirty: false, updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
      // Completed comparisons remain authorized history, while unfinished work
      // cannot later publish a recruiting recommendation for an ended position.
      await database.collection('staffingAiTasks').updateMany({ refreshSubscriptionId: subscription.id, status: 'pending' }, { $set: { status: 'stale', result: null, message: 'Candidate analysis has ended for this appointment.' } }, { session })
    }
  })
}

async function nextRefreshJob(db: Db) {
  const { withTransaction } = await import('./db')
  for (let inspected = 0; inspected < 10; inspected++) {
    const job = await jobs(db).findOne({ $or: [{ status: 'queued', nextAttemptAt: { $lte: new Date() } }, { status: 'running', leaseUntil: { $lte: new Date() } }, { status: 'blocked', nextAttemptAt: { $lte: new Date() } }, { status: 'unconfigured' }] }, { sort: { updatedAt: 1, _id: 1 } })
    if (!job) return null
    const subscription = await scopes(db).findOne({ id: job.subscriptionId, active: true })
    if (subscription) return { job, subscription }
    await withTransaction(async (database, session) => {
      // Use the same subscription-before-job fence order as approval/revocation.
      // A concurrent approval or execution must survive orphan cleanup.
      const currentScope = await scopes(database).findOneAndUpdate({ id: job.subscriptionId }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
      if (currentScope?.active) return
      const current = await jobs(database).findOneAndUpdate({ _id: job._id, status: job.status, generation: job.generation, fence: job.fence ?? { $exists: false } }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
      if (!current) return
      await jobs(database).updateOne({ _id: current._id, fence: current.fence }, { $set: { status: 'revoked', dirty: false, reason: 'The approved comparison scope is no longer active.', updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
      await database.collection('staffingAiTasks').updateMany({ refreshSubscriptionId: job.subscriptionId, status: { $in: ['completed', 'pending'] } }, { $set: { status: 'stale', result: null, message: 'The approved comparison scope is no longer active.' } }, { session })
    })
  }
  return null
}

export async function runAiRefreshCycle(db: Db, signal?: AbortSignal) {
  if (!configured() || signal?.aborted) return
  await initializeAiRefresh(db)
  if (!await scopes(db).findOne({ active: true })) return
  await stopEndedCandidateRefresh(db)
  const { reconcileDueStaffing } = await import('./staffing-appointments')
  await reconcileDueStaffing(db)
  await observeChanges(db)
  const concurrency = await db.collection<any>('staffingAiBudgets').findOne({ _id: 'concurrency' })
  const cap = Number(process.env.AI_MAX_CONCURRENT) || 2
  if ((concurrency?.leases || []).filter((lease: any) => lease.expiresAt > new Date()).length >= cap) return
  const pending = await nextRefreshJob(db)
  if (!pending) return
  const { job, subscription } = pending
  const actor = await refreshActor(db, subscription)
  if (!actor) {
    const { withTransaction } = await import('./db')
    await withTransaction(async (database, session) => {
      const scope = await scopes(database).findOneAndUpdate({ id: subscription.id, active: true, approvalVersion: subscription.approvalVersion }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
      if (!scope) return
      const current = await jobs(database).findOneAndUpdate({ _id: subscription.id, generation: job.generation, fence: job.fence }, { $inc: { fence: 1 } }, { session, returnDocument: 'after' })
      if (!current) return
      await scopes(database).updateOne({ id: subscription.id, approvalVersion: subscription.approvalVersion }, { $set: { active: false, status: 'revoked' } }, { session })
      await jobs(database).updateOne({ _id: subscription.id }, { $set: { status: 'revoked', updatedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '' } }, { session })
      await database.collection('staffingAiTasks').updateMany({ refreshSubscriptionId: subscription.id, status: { $in: ['completed', 'pending'] } }, { $set: { status: 'stale', result: null, message: 'Reviewer authority changed; automatic analysis is disabled.' } }, { session })
    })
    return
  }
  const { candidateRefreshFingerprint } = await import('./ai')
  const snapshot = await candidateRefreshFingerprint(db, actor, { targetId: subscription.opportunityId, page: subscription.page, pageSize: subscription.pageSize })
  const lease = await claim(db, subscription, snapshot, false, job.generation)
  if (lease) await execute(db, subscription, actor, snapshot, lease, signal)
}

export async function refreshMetadata(db: Db, user: StaffingActor, filter: { targetId?: string; kind?: string; page?: number; pageSize?: number } = {}) {
  const subscriptions = await scopes(db).find({
    requesterId: actorId(user), active: true,
    ...(filter.targetId ? { opportunityId: filter.targetId } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.kind === 'candidate_fit' && filter.page !== undefined ? { page: filter.page } : {}),
    ...(filter.kind === 'candidate_fit' && filter.pageSize !== undefined ? { pageSize: filter.pageSize } : {}),
  }).sort({ id: 1 }).limit(100).toArray()
  const records = await jobs(db).find({ _id: { $in: subscriptions.map(s => s.id) } }).toArray()
  return { subscriptions: subscriptions.map(s => ({ id: s.id, kind: s.kind, targetId: s.opportunityId, page: s.page, pageSize: s.pageSize, status: s.status || 'active' })), jobs: records.map(j => ({ subscriptionId: j.subscriptionId, status: configured() ? j.status : 'unconfigured', generation: j.generation, reason: j.reason || '', updatedAt: j.updatedAt })) }
}
