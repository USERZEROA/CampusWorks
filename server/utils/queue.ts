// server/utils/queue.ts
import type { Db, Document, WithId } from 'mongodb'
import { ObjectId } from 'mongodb'
import { createError } from 'h3'

export type QueueEndReason =
  | 'completed' // staff finished helping the student
  | 'removed' // staff removed an entry nobody had picked up
  | 'left' // student left the queue (or the course)
  | 'queue-closed' // queue was closed with the entry still in it
  | 'kicked' // student was removed from the course

export function parseEntryId(value: unknown): ObjectId {
  const id = String(value ?? '').trim()
  if (!id || !ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid entryId' })
  }
  return new ObjectId(id)
}

/**
 * Atomically remove a queue entry and record it in `helpSessions`, so that
 * every entry that leaves the queue ends up in the course history exactly once.
 * Returns the archived entry, or null if it was already gone.
 */
export async function archiveEntry(
  db: Db,
  filter: Document,
  opts: { reason: QueueEndReason; endedBy: string; fallbackTa?: { email: string; name: string } }
): Promise<WithId<Document> | null> {
  const entry = await db.collection('queueEntries').findOneAndDelete(filter)
  if (!entry) return null

  await db.collection('helpSessions').insertOne(toHelpSession(entry, opts, new Date()))
  return entry
}

/** Archive every entry of a course (used when the queue closes). */
export async function archiveAllEntries(
  db: Db,
  courseKey: string,
  opts: { reason: QueueEndReason; endedBy: string }
) {
  const entries = await db
    .collection('queueEntries')
    .find({ courseId: courseKey }, { projection: { _id: 1 } })
    .toArray()

  let archived = 0
  for (const { _id } of entries) {
    if (await archiveEntry(db, { _id, courseId: courseKey }, opts)) archived++
  }
  return archived
}

function toHelpSession(
  entry: WithId<Document>,
  opts: { reason: QueueEndReason; endedBy: string; fallbackTa?: { email: string; name: string } },
  now: Date
) {
  const helpStartAt: Date | null = entry.helpStartAt || null
  const wasHelped = !!helpStartAt

  // Attribute the session to the TA who claimed the entry; older rows only
  // stored a display label, in which case the staff member closing it is used.
  const taEmail = entry.taEmail || (wasHelped ? opts.fallbackTa?.email : '') || null
  const taName =
    entry.ta || (wasHelped ? opts.fallbackTa?.name : '') || (taEmail ? taEmail : null)

  return {
    courseId: entry.courseId,
    studentEmail: entry.studentEmail || '',
    studentName: entry.studentName || entry.studentEmail || '',
    taEmail: wasHelped ? taEmail : null,
    taName: wasHelped ? taName : null,
    location: entry.location || '',
    question: entry.question || '',
    joinedAt: entry.joinedAt || entry.createdAt || now,
    helpStartAt,
    closedAt: wasHelped ? now : null,
    leftQueueAt: now,
    wasHelped,
    endReason: opts.reason === 'completed' && !wasHelped ? 'removed' : opts.reason,
    removedBy: opts.endedBy
  }
}

/**
 * Shape a queue entry for the API. Non-staff viewers only see the email
 * address on their own entry.
 */
export function toQueueEntryDto(
  entry: WithId<Document>,
  viewer: { email: string; isStaff: boolean }
) {
  const isMine = entry.studentEmail === viewer.email
  return {
    id: entry._id.toString(),
    email: viewer.isStaff || isMine ? entry.studentEmail : '',
    name: entry.studentName || '',
    location: entry.location || '',
    question: entry.question || '',
    paused: !!entry.paused,
    ta: entry.ta || '',
    otherTa: !!entry.otherTa,
    position: typeof entry.position === 'number' ? entry.position : 0,
    joinedAt: entry.createdAt || null,
    isMine,
    assignedToMe:
      viewer.isStaff && !entry.otherTa && !!entry.taEmail && entry.taEmail === viewer.email
  }
}
