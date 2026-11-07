// server/api/courses/[id]/queue/join.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import type { Collection } from 'mongodb'
import { assertEnrolled, cleanText, getCourseAccess } from '../../../../utils/courses'

type JoinQueueBody = {
  location?: string
  question?: string
}

/**
 * POST /api/courses/[id]/queue/join
 *
 * Join the queue, or edit the caller's existing entry.
 * - Requires an enrollment in the course.
 * - New entries need an open queue; an existing entry may still be edited
 *   while the queue is paused.
 * - One entry per (courseId, studentEmail), backed by a unique index.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertEnrolled(access)

  const body = (await readBody<JoinQueueBody>(event)) || {}
  const location = cleanText(body.location, 200)
  const question = cleanText(body.question, 1000)

  if (!location) {
    throw createError({ statusCode: 400, statusMessage: 'location required' })
  }

  const { db, courseKey, user } = access
  const state = String(access.course.state || 'closed').toLowerCase()
  const coll = db.collection('queueEntries')
  const filter = { courseId: courseKey, studentEmail: user.email }
  const fields = { location, question, paused: false, studentName: user.name || user.email }

  const existing = await coll.findOne(filter)

  if (state === 'closed' || (!existing && state !== 'open')) {
    throw createError({
      statusCode: 409,
      statusMessage:
        state === 'paused'
          ? 'Queue is currently paused. Please wait for TAs to resume.'
          : 'Queue is currently closed for this course'
    })
  }

  if (existing) {
    const update: Record<string, unknown> = { ...fields }
    // Backfill position on legacy rows.
    if (typeof existing.position !== 'number') {
      update.position = await nextPosition(coll, courseKey)
    }
    await coll.updateOne({ _id: existing._id }, { $set: update })
    return { ok: true }
  }

  try {
    await coll.insertOne({
      ...filter,
      ...fields,
      createdAt: new Date(),
      position: await nextPosition(coll, courseKey)
    })
  } catch (err: any) {
    // Concurrent join by the same student: the unique index kept one entry.
    if (err?.code !== 11000) throw err
    await coll.updateOne(filter, { $set: fields })
  }

  return { ok: true }
})

async function nextPosition(coll: Collection, courseKey: string) {
  const last = await coll
    .find({ courseId: courseKey, position: { $type: 'number' } })
    .sort({ position: -1 })
    .limit(1)
    .next()
  return (last?.position ?? 0) + 1
}
