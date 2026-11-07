// server/api/courses/[id]/queue/pause.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { getCourseAccess } from '../../../../utils/courses'
import { parseEntryId } from '../../../../utils/queue'

/**
 * POST /api/courses/[id]/queue/pause
 *
 * Pause / resume a queue entry.
 * - Staff may pause/resume any entry in the course.
 * - Students may only pause/resume their own entry.
 *
 * Body: { entryId: string; paused: boolean }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)

  const body = (await readBody<{ entryId?: string; paused?: boolean }>(event)) || {}
  const _id = parseEntryId(body.entryId)

  if (typeof body.paused !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'paused must be a boolean' })
  }

  const coll = access.db.collection('queueEntries')
  const entry = await coll.findOne({ _id, courseId: access.courseKey })

  // Entry already gone: treat as success (idempotent).
  if (!entry) {
    return { ok: true }
  }

  if (!access.isStaff && entry.studentEmail !== access.user.email) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // A paused student is not being helped, so any TA claim is released.
  const update = body.paused
    ? { $set: { paused: true, otherTa: false }, $unset: { ta: '', taEmail: '' } }
    : { $set: { paused: false } }

  await coll.updateOne({ _id: entry._id }, update)

  return { ok: true }
})
