import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import type { ClientSession, Db, Document, IndexDescription } from 'mongodb'
import { isGlobalAdmin, type SessionUser } from './auth'

export type StaffingActor = SessionUser & { id?: string }
export const now = () => new Date()
export const uid = () => randomUUID()
export function fail(statusCode: number, statusMessage: string): never { throw createError({ statusCode, statusMessage }) }
export const options = (session?: ClientSession) => session ? { session } : {}
export const actorId = (user: StaffingActor) => user.id || user.email
export const pageLimit = 100
export const liveAllocationStates = ['offered', 'accepted_pending_clearance', 'active', 'suspended']

export function text(value: unknown, label: string, max = 2000, required = false) {
  if (value === undefined || value === null) { if (required) fail(400, `${label} is required`); return '' }
  if (typeof value !== 'string') fail(400, `${label} must be text`)
  const result = value.trim()
  if (result.length > max || (required && !result)) fail(400, `${label} must contain ${required ? '1' : '0'}-${max} characters`)
  return result
}
export function number(value: unknown, label: string, min = 0, max = 1000000, fallback?: number) {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, `${label} must be between ${min} and ${max}`)
  return value
}
export function flag(value: unknown, label: string, fallback = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(400, `${label} must be true or false`)
  return value
}
export function date(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) fail(400, `${label} is required`)
  const result = new Date(value)
  if (!Number.isFinite(result.getTime())) fail(400, `${label} must be a valid date`)
  return result
}
export function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${label} must be an object`)
  return value as Record<string, any>
}
export function assertVersion(record: Document, expected: unknown) {
  if (expected === undefined) return
  if (typeof expected !== 'number' || record.version !== expected) fail(409, 'This record changed. Refresh before saving.')
}
export function publicRecord(record: Document | null | undefined) {
  if (!record) return null
  const { _id, bytes, ...dto } = record
  return dto
}
export async function event(db: Db, session: ClientSession, user: StaffingActor, kind: string, targetId: string, details: Record<string, unknown> = {}) {
  await db.collection('staffingEvents').insertOne({ id: uid(), actorId: actorId(user), actorEmail: user.email, kind, targetId, details, createdAt: now(), delivery: 'pending' }, { session })
}

export async function initializeStaffingIndexes(db: Db) {
  const specs: Array<[string, IndexDescription[]]> = [
    ['staffingTerms', [{ key: { id: 1 }, unique: true }, { key: { startDate: -1 } }]],
    ['researchProjects', [{ key: { id: 1 }, unique: true }, { key: { ownerEmail: 1 } }]],
    ['staffingOpportunities', [{ key: { id: 1 }, unique: true }, { key: { termId: 1, status: 1 } }, { key: { courseId: 1 } }, { key: { projectId: 1 } }]],
    ['staffingApplications', [{ key: { id: 1 }, unique: true }, { key: { opportunityId: 1, applicantId: 1 }, unique: true }, { key: { applicantId: 1, updatedAt: -1 } }, { key: { opportunityId: 1, status: 1, submittedAt: 1, id: 1 } }]],
    ['staffingDocuments', [{ key: { id: 1 }, unique: true }, { key: { applicationId: 1 } }]],
    ['staffingAllocations', [{ key: { termId: 1, applicantId: 1 }, unique: true }]],
    ['staffingOffers', [{ key: { id: 1 }, unique: true }, { key: { applicationId: 1, createdAt: -1 } }]],
    ['staffingAppointments', [{ key: { id: 1 }, unique: true }, { key: { courseId: 1, applicantEmail: 1, status: 1 } }, { key: { projectId: 1, applicantId: 1 } }, { key: { applicantId: 1, endDate: 1 } }]],
    ['staffingEvents', [{ key: { id: 1 }, unique: true }, { key: { targetId: 1, createdAt: -1 } }, { key: { delivery: 1, createdAt: 1 } }]],
    ['staffingCommands', [{ key: { actorId: 1, key: 1 }, unique: true }]],
    ['staffingWorkload', [{ key: { id: 1 }, unique: true }, { key: { appointmentId: 1, date: -1 } }, { key: { appointmentId: 1, idempotencyKey: 1 }, unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }]],
    ['staffingAiTasks', [{ key: { id: 1 }, unique: true }, { key: { requestedBy: 1, createdAt: -1 } }, { key: { targetId: 1, status: 1 } }, { key: { termId: 1, kind: 1, status: 1 } }]],
    ['staffingAiBudgets', [{ key: { day: 1 } }]],
    ['staffingNotifications', [{ key: { id: 1 }, unique: true }, { key: { eventId: 1, recipientId: 1 }, unique: true }, { key: { recipientId: 1, createdAt: -1 } }]]
  ]
  for (const [collection, indexes] of specs) await db.collection(collection).createIndexes(indexes)
}

/** Date and clearance checks remain authoritative even before reconciliation runs. */
export async function getAppointmentCourseRole(db: Db, courseId: string, email: string, session?: ClientSession): Promise<'ta' | null> {
  const appointment = await db.collection('staffingAppointments').findOne({ courseId, applicantEmail: email, type: 'ta', status: { $in: ['active', 'pending_start'] }, clearance: 'cleared', acceptedAt: { $ne: null }, startDate: { $lte: now() }, endDate: { $gt: now() } }, options(session))
  return appointment ? 'ta' : null
}

export async function findOpportunity(db: Db, id: string, session?: ClientSession) {
  return await db.collection('staffingOpportunities').findOne({ id }, options(session)) || fail(404, 'Opportunity not found')
}
export async function manualCourseManager(db: Db, courseId: string, user: StaffingActor, session?: ClientSession) {
  if (isGlobalAdmin(user)) return true
  return !!await db.collection('enrollments').findOne({ courseId, userEmail: user.email, role: { $in: ['instructor', 'admin'] } }, options(session))
}
export async function canManageOpportunity(db: Db, opportunity: Document, user: StaffingActor, session?: ClientSession) {
  if (isGlobalAdmin(user)) return true
  if (opportunity.type === 'ta') return manualCourseManager(db, opportunity.courseId, user, session)
  const project = await db.collection('researchProjects').findOne({ id: opportunity.projectId }, options(session))
  return !!project && (project.ownerEmail === user.email || (project.reviewerEmails || []).includes(user.email))
}
export async function assertOpportunityManager(db: Db, opportunity: Document, user: StaffingActor, session?: ClientSession) {
  if (!await canManageOpportunity(db, opportunity, user, session)) fail(403, 'Only the authorized course or project reviewers may manage this opportunity')
}
export async function applicationAccess(db: Db, id: string, user: StaffingActor, session?: ClientSession) {
  const application = await db.collection('staffingApplications').findOne({ id }, options(session)) || fail(404, 'Application not found')
  const opportunity = await findOpportunity(db, application.opportunityId, session)
  const owner = application.applicantId === actorId(user)
  const canManage = await canManageOpportunity(db, opportunity, user, session)
  if (!owner && !canManage) fail(403, 'This application is private')
  if (!owner && (!application.submittedAt || application.status === 'draft')) fail(403, 'Draft applications are private to the applicant')
  return { application, opportunity, owner, canManage }
}
export function applicationDto(application: Document, sensitive: boolean) {
  const { administrative, revisions, ...dto } = publicRecord(application)!
  if (sensitive) return { ...dto, administrative: administrative || {}, revisions: revisions || [] }
  const snapshot = application.submittedSnapshot || {}
  return { ...dto, profile: snapshot.profile || application.profile, answers: snapshot.answers || application.answers, qualificationText: snapshot.qualificationText ?? application.qualificationText, cvDocumentId: snapshot.cvDocumentId ?? application.cvDocumentId }
}
export function appointmentDto(appointment: Document | null | undefined, user: StaffingActor) {
  if (!appointment) return null
  const dto = publicRecord(appointment)!
  if (!isGlobalAdmin(user) && appointment.applicantId !== actorId(user)) {
    delete dto.clearanceReason
    delete dto.clearedBy
    delete dto.administrative
    delete dto.clearanceNotes
  }
  return dto
}

export type Slot = { day: number; start: string; end: string }
export function slots(value: unknown, label: string): Slot[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) fail(400, `${label} must be an array with at most 50 slots`)
  return value.map((raw) => {
    const item = object(raw, label)
    const day = number(item.day, `${label} day`, 0, 6)
    if (!Number.isInteger(day)) fail(400, `${label} day must be an integer`)
    const start = text(item.start, `${label} start`, 5, true)
    const end = text(item.end, `${label} end`, 5, true)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) fail(400, `${label} needs increasing same-day HH:mm times`)
    return { day, start, end }
  })
}
export function eligibility(application: Document, opportunity: Document) {
  const profile = application.profile || {}
  const reasons: string[] = []
  if ((profile.availableHours || 0) < opportunity.weeklyHours) reasons.push('Available hours do not cover the published weekly workload')
  const preferences = opportunity.allowedPositionPreferences || ['full', 'half', 'either', 'other']
  const compatiblePreference = preferences.includes(profile.positionPreference) || (profile.positionPreference === 'either' && preferences.some((p: string) => ['full', 'half'].includes(p))) || (preferences.includes('either') && ['full', 'half'].includes(profile.positionPreference))
  if (!compatiblePreference) reasons.push('Appointment preference is incompatible')
  for (const required of opportunity.requiredSlots || []) {
    let coveredUntil = required.start
    const available = (profile.slots || []).filter((slot: Slot) => slot.day === required.day).sort((a: Slot, b: Slot) => a.start.localeCompare(b.start))
    for (const slot of available) {
      if (slot.start > coveredUntil) break
      if (slot.end > coveredUntil) coveredUntil = slot.end
      if (coveredUntil >= required.end) break
    }
    if (coveredUntil < required.end) reasons.push(`Required availability is missing for day ${required.day} ${required.start}-${required.end}`)
  }
  return { eligible: reasons.length === 0, reasons }
}

export async function allocationUnavailable(db: Db, applicantId: string, termId: string, session?: ClientSession, ignoreOfferId?: string) {
  const allocation = await db.collection('staffingAllocations').findOne({ applicantId, termId }, options(session))
  if (!allocation || allocation.offerId === ignoreOfferId || !liveAllocationStates.includes(allocation.status)) return false
  if (allocation.status === 'offered' && new Date(allocation.expiresAt).getTime() <= Date.now()) return false
  if (['active', 'accepted_pending_clearance'].includes(allocation.status) && new Date(allocation.endDate).getTime() <= Date.now()) return false
  return true
}
