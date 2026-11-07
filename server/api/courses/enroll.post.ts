// server/api/courses/enroll.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { getDb } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { courseKeyOf, findCourse, getCourseRole, STAFF_ROLES } from '../../utils/courses'
import { archiveEntry } from '../../utils/queue'

/**
 * POST /api/courses/enroll
 *
 * Enroll in / leave a course as a student.
 * - Accepts either internal `id` or human `code` as `courseId`.
 * - Staff roles are managed by course admins and are never changed here.
 * - Leaving a course also takes the student out of its queue.
 *
 * Body: { courseId: string; enroll: boolean }
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = (await readBody<{ courseId?: string; enroll?: boolean }>(event)) || {}
  const requested = String(body.courseId || '').trim()

  if (!requested) {
    throw createError({ statusCode: 400, statusMessage: 'courseId required' })
  }

  const db = await getDb()
  const course = await findCourse(db, requested)
  if (!course) {
    throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  }

  const courseKey = courseKeyOf(course)
  const role = await getCourseRole(db, courseKey, user.email)

  if (role && STAFF_ROLES.includes(role)) {
    return { ok: true, role }
  }

  const enrollments = db.collection('enrollments')

  if (body.enroll) {
    await enrollments.updateOne(
      { courseId: courseKey, userEmail: user.email },
      { $set: { courseId: courseKey, userEmail: user.email, role: 'student' } },
      { upsert: true }
    )
    return { ok: true, role: 'student' }
  }

  await enrollments.deleteMany({ courseId: courseKey, userEmail: user.email, role: 'student' })
  await archiveEntry(
    db,
    { courseId: courseKey, studentEmail: user.email },
    { reason: 'left', endedBy: user.email }
  )

  return { ok: true, role: null }
})
