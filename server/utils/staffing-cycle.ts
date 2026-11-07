import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { date, event, fail, flag, number, object, options, text, type StaffingActor } from './staffing'

const cycleId = 'recruitment-cycle'

export async function lockRecruitmentCycle(db: Db, session: ClientSession) {
  return await db.collection('staffingSettings').findOneAndUpdate({ _id: cycleId as any }, { $inc: { mutationVersion: 1 } }, { session, returnDocument: 'after' }) || fail(503, 'Recruitment settings are unavailable')
}

export async function getRecruitmentCycle(db: Db, session?: ClientSession) {
  const settings = await db.collection('staffingSettings').findOne({ _id: cycleId as any }, options(session))
  const term = settings?.termId ? await db.collection('staffingTerms').findOne({ id: settings.termId }, options(session)) : null
  const timestamp = new Date()
  const canReview = !!(term && settings?.enabled && settings.opensAt <= timestamp && term.endDate > timestamp)
  return {
    termId: term?.id || null, termName: term?.name || '', startDate: term?.startDate || null, endDate: term?.endDate || null,
    opensAt: settings?.opensAt || null, closesAt: settings?.closesAt || null, enabled: !!settings?.enabled,
    version: settings?.version || 0, isOpen: canReview && settings!.closesAt > timestamp, canReview
  }
}

/** The settings write must precede every course or opportunity lock. */
export async function assertRecruitmentGate(db: Db, session: ClientSession, termId: string, mode: 'applications' | 'review' = 'applications') {
  const cycle = await getRecruitmentCycle(db, session)
  if (cycle.termId !== termId || !(mode === 'review' ? cycle.canReview : cycle.isOpen)) fail(409, mode === 'review' ? 'Review and selection are unavailable for this recruitment semester' : 'Applications are closed for this recruitment semester')
  return cycle
}

export async function configureRecruitmentCycle(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  if (!isGlobalAdmin(user)) fail(403, 'Only administrators configure recruitment semesters')
  const body = object(raw, 'Recruitment cycle')
  const settings = await lockRecruitmentCycle(db, session)
  const expectedVersion = number(body.expectedVersion, 'Recruitment settings version', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isInteger(expectedVersion) || settings.version !== expectedVersion) fail(409, 'Recruitment settings changed elsewhere. Your edits are kept.')
  const termId = text(body.termId, 'Current semester', 64, true)
  const term = await db.collection('staffingTerms').findOne({ id: termId }, { session }) || fail(400, 'Choose a configured semester')
  const opensAt = date(body.opensAt, 'Recruitment opening')
  const closesAt = date(body.closesAt, 'Recruitment closing')
  if (opensAt >= closesAt || closesAt >= term.endDate) fail(400, 'Recruitment must close after opening and before the semester end')
  await db.collection('staffingSettings').updateOne({ _id: cycleId as any }, { $set: { termId, opensAt, closesAt, enabled: flag(body.enabled, 'Recruitment enabled'), updatedAt: new Date(), updatedBy: user.email }, $inc: { version: 1 } }, { session })
  await event(db, session, user, 'RecruitmentCycleConfigured', cycleId, { termId })
  const cycle = await getRecruitmentCycle(db, session)
  return { cycle, currentCycle: cycle, serverTime: new Date() }
}

export async function initializeRecruitmentCycle(db: Db) {
  await db.collection<Document>('staffingSettings').updateOne({ _id: cycleId as any }, { $setOnInsert: { version: 0, mutationVersion: 0, termId: null, opensAt: null, closesAt: null, enabled: false, createdAt: new Date() } }, { upsert: true })
}
