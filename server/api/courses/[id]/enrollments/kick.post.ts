// server/api/courses/[id]/enrollments/kick.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { normalizeEmail } from '../../../../utils/auth'
import { assertManager, getCourseAccess, getCourseRole } from '../../../../utils/courses'
import { archiveEntry } from '../../../../utils/queue'

/**
 * POST /api/courses/[id]/enrollments/kick
 *
 * Removes a user from the course and takes them out of its queue
 * (the queue entry is archived to help sessions).
 * - Instructors / course admins / global admins may call this.
 * - Only course admins and global admins may remove a course admin.
 * - Users cannot remove themselves.
 *
 * Body: { email: string }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertManager(access)

  const body = (await readBody<{ email?: string }>(event)) || {}
  const email = normalizeEmail(String(body.email || ''))

  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'email required' })
  }
  if (email === access.user.email) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot remove yourself' })
  }

  const targetRole = await getCourseRole(access.db, access.courseKey, email)
  if (targetRole === 'admin' && !(access.globalAdmin || access.role === 'admin')) {
    throw createError({ statusCode: 403, statusMessage: 'Only course admins can remove an admin' })
  }

  await access.db.collection('enrollments').deleteMany({ courseId: access.courseKey, userEmail: email })
  await access.db
    .collection('courses')
    .updateOne({ _id: access.course._id }, { $pull: { onDutyTAs: { email } } as any })
  await archiveEntry(
    access.db,
    { courseId: access.courseKey, studentEmail: email },
    { reason: 'kicked', endedBy: access.user.email }
  )

  return { ok: true }
})
