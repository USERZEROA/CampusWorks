// server/api/courses/[id]/announcements.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, cleanText, getCourseAccess, staffLabel } from '../../../utils/courses'

/**
 * POST /api/courses/[id]/announcements
 * Create an announcement for a course. Course staff only.
 *
 * Body: { message: string }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ message?: string }>(event)) || {}
  const message = cleanText(body.message, 1000)

  if (!message) {
    throw createError({ statusCode: 400, statusMessage: 'message required' })
  }

  await access.db.collection('announcements').insertOne({
    courseId: access.courseKey,
    message,
    by: staffLabel(access.user),
    byEmail: access.user.email,
    createdAt: new Date()
  })

  return { ok: true }
})
