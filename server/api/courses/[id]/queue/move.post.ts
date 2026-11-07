// server/api/courses/[id]/queue/move.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ObjectId } from 'mongodb'
import { assertStaff, getCourseAccess } from '../../../../utils/courses'
import { parseEntryId } from '../../../../utils/queue'

type Direction = 'up' | 'down'

/**
 * POST /api/courses/[id]/queue/move
 *
 * Reorders a queue entry up/down by swapping its position with the nearest
 * neighbor in the requested direction. Course staff only.
 *
 * Body: { entryId: string; direction: 'up' | 'down' }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ entryId?: string; direction?: Direction }>(event)) || {}
  const _id = parseEntryId(body.entryId)
  const { direction } = body

  if (direction !== 'up' && direction !== 'down') {
    throw createError({ statusCode: 400, statusMessage: 'direction must be "up" or "down"' })
  }

  const coll = access.db.collection('queueEntries')
  const courseId = access.courseKey

  const current = await coll.findOne({ _id, courseId })
  if (!current) {
    return { ok: true }
  }

  // Normalize legacy rows without a numeric position.
  const currentPos =
    typeof current.position === 'number'
      ? current.position
      : current.createdAt
        ? new Date(current.createdAt).getTime()
        : new ObjectId(current._id).getTimestamp().getTime()

  if (current.position !== currentPos) {
    await coll.updateOne({ _id: current._id }, { $set: { position: currentPos } })
  }

  const neighbor = await coll
    .find({
      courseId,
      _id: { $ne: current._id },
      position: direction === 'up' ? { $lt: currentPos } : { $gt: currentPos }
    })
    .sort({ position: direction === 'up' ? -1 : 1 })
    .limit(1)
    .next()

  if (!neighbor) {
    return { ok: true }
  }

  // Swap position values between current entry and neighbor.
  await coll.updateOne({ _id: current._id }, { $set: { position: neighbor.position } })
  await coll.updateOne({ _id: neighbor._id }, { $set: { position: currentPos } })

  return { ok: true }
})
