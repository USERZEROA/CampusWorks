import type { ClientSession, Db, Document, WithId } from 'mongodb'
import { ObjectId } from 'mongodb'
import { createError } from 'h3'

export type QueueEndReason = 'completed' | 'removed' | 'left' | 'queue-closed' | 'kicked'
export function parseEntryId(value: unknown): ObjectId {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) throw createError({ statusCode: 400, statusMessage: 'Invalid entryId' })
  return new ObjectId(value)
}
export type HelpSegment = { taEmail: string; taName: string; startAt: Date; endAt: Date; durationMs: number }
const dateValue = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date : null
}
export function completedSegments(entry: Document, now: Date): HelpSegment[] {
  const segments: HelpSegment[] = Array.isArray(entry.helpSegments) ? [...entry.helpSegments] : []
  const start = dateValue(entry.activeHelpStartAt) || (entry.taEmail ? dateValue(entry.helpStartAt) : null)
  if (entry.taEmail && start) {
    const endAt = new Date(Math.max(now.getTime(), start.getTime()))
    segments.push({ taEmail: entry.taEmail, taName: entry.ta || entry.taEmail, startAt: start, endAt, durationMs: endAt.getTime() - start.getTime() })
  }
  return segments
}
export async function releaseEntry(db: Db, entry: WithId<Document>, session: ClientSession, otherTa = false, now = new Date()) {
  if (!session?.inTransaction()) throw new Error('Queue changes require an active transaction')
  await db.collection('queueEntries').updateOne({ _id: entry._id }, {
    $set: { helpSegments: completedSegments(entry, now), otherTa },
    $unset: { ta: '', taEmail: '', activeHelpStartAt: '' }
  }, { session })
}
export async function releaseStaffClaims(db: Db, courseId: string, email: string, session: ClientSession) {
  const entries = await db.collection('queueEntries').find({ courseId, taEmail: email }, { session }).toArray()
  for (const entry of entries) await releaseEntry(db, entry, session)
}
export function resumedPauseFields(entry: Document, now = new Date()) {
  const started = dateValue(entry.pauseStartedAt)
  return {
    paused: false,
    pausedBeforeHelpMs: Number(entry.pausedBeforeHelpMs || 0) + (!entry.helpStartAt && started ? Math.max(0, now.getTime() - started.getTime()) : 0)
  }
}

/** History insertion and active-entry removal always share the caller's course transaction. */
export async function archiveEntry(db: Db, filter: Document, opts: { reason: QueueEndReason; endedBy: string; fallbackTa?: { email: string; name: string } }, session: ClientSession): Promise<WithId<Document> | null> {
  if (!session?.inTransaction()) throw new Error('Queue archival requires an active transaction')
  const entry = await db.collection('queueEntries').findOne(filter, { session })
  if (!entry) return null
  const now = new Date()
  const segments = completedSegments(entry, now)
  const firstStart = dateValue(entry.helpStartAt)
  const lastSegment = segments.at(-1)
  const joined = dateValue(entry.createdAt) || now
  const totalHelpMs = segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.durationMs) || 0), 0)
  const wasHelped = segments.length > 0
  await db.collection('helpSessions').insertOne({
    _id: entry._id, entryId: entry._id.toString(), courseId: entry.courseId,
    studentEmail: entry.studentEmail || '', studentName: entry.studentName || entry.studentEmail || '',
    taEmail: lastSegment?.taEmail || null, taName: lastSegment?.taName || null,
    location: entry.location || '', question: entry.question || '', joinedAt: joined,
    helpStartAt: firstStart, helpEndAt: lastSegment?.endAt || null, closedAt: wasHelped ? lastSegment?.endAt || now : null,
    leftQueueAt: now, wasHelped, helpSegments: segments, helpMinutes: totalHelpMs / 60000,
    waitMinutes: firstStart ? Math.max(0, firstStart.getTime() - joined.getTime() - Number(entry.pausedBeforeHelpMs || 0)) / 60000 : null,
    endReason: opts.reason === 'completed' && !wasHelped ? 'removed' : opts.reason, removedBy: opts.endedBy
  }, { session })
  await db.collection('queueEntries').deleteOne({ _id: entry._id }, { session })
  return entry
}
export async function archiveAllEntries(db: Db, courseId: string, opts: { reason: QueueEndReason; endedBy: string }, session: ClientSession) {
  const entries = await db.collection('queueEntries').find({ courseId }, { session, projection: { _id: 1 } }).toArray()
  for (const { _id } of entries) await archiveEntry(db, { _id, courseId }, opts, session)
  return entries.length
}
export function toQueueEntryDto(entry: WithId<Document>, viewer: { email: string; isStaff: boolean }) {
  const isMine = entry.studentEmail === viewer.email
  return {
    id: entry._id.toString(), email: viewer.isStaff || isMine ? entry.studentEmail : '',
    name: entry.studentName || '', location: entry.location || '', question: entry.question || '',
    paused: !!entry.paused, ta: entry.ta || '', otherTa: !!entry.otherTa,
    position: typeof entry.position === 'number' ? entry.position : 0, joinedAt: entry.createdAt || null,
    isMine, assignedToMe: viewer.isStaff && !entry.otherTa && !!entry.taEmail && entry.taEmail === viewer.email
  }
}
