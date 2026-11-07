// server/api/courses/[id]/queue/assign.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, getCourseAccess, staffLabel } from '../../../../utils/courses'
import { parseEntryId } from '../../../../utils/queue'

type AssignFlag = boolean | 'other'

/**
 * POST /api/courses/[id]/queue/assign
 *
 * Manage assignment of a queue entry to a TA:
 * - assign === true: claim this entry for the caller (releasing any other
 *   entry the caller had claimed in this course: one active entry per TA).
 *   Re-selecting an entry claimed by another TA takes it over.
 * - assign === 'other': mark the entry as "needs another TA".
 * - assign === false: clear the assignment.
 *
 * Auth: course staff (ta / instructor / admin) or global admin.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ entryId?: string; assign?: AssignFlag }>(event)) || {}
  const _id = parseEntryId(body.entryId)
  const { assign } = body

  if (assign !== true && assign !== false && assign !== 'other') {
    throw createError({ statusCode: 400, statusMessage: 'assign must be true, false or "other"' })
  }

  const { db, courseKey, user } = access
  const coll = db.collection('queueEntries')
  const filter = { _id, courseId: courseKey }

  const entry = await coll.findOne(filter)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  }

  const release = { $set: { otherTa: false }, $unset: { ta: '', taEmail: '' } }

  if (assign === true) {
    if (entry.paused) {
      throw createError({ statusCode: 409, statusMessage: 'Entry is paused' })
    }

    const label = staffLabel(user)
    await coll.updateMany({ courseId: courseKey, taEmail: user.email, _id: { $ne: _id } }, release)
    // Claims written by older versions only stored the label.
    await coll.updateMany(
      { courseId: courseKey, ta: label, taEmail: { $exists: false }, _id: { $ne: _id } },
      release
    )

    const update: Record<string, unknown> = { ta: label, taEmail: user.email, otherTa: false }
    if (!entry.helpStartAt) update.helpStartAt = new Date()

    const res = await coll.updateOne({ ...filter, paused: { $ne: true } }, { $set: update })
    if (res.matchedCount === 0) {
      throw createError({ statusCode: 409, statusMessage: 'Entry not available' })
    }
  } else if (assign === 'other') {
    await coll.updateOne(filter, { $set: { otherTa: true }, $unset: { ta: '', taEmail: '' } })
  } else {
    await coll.updateOne(filter, release)
  }

  return { ok: true }
})
