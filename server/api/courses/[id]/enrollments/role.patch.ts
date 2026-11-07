// server/api/courses/[id]/enrollments/role.patch.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { normalizeEmail } from '../../../../utils/auth'
import { assertManager, getCourseAccess, getCourseRole, isCourseRole } from '../../../../utils/courses'

/**
 * PATCH /api/courses/[id]/enrollments/role
 *
 * Add a user to the course, or change their role.
 * - Instructors / course admins / global admins may call this.
 * - Only course admins and global admins may grant or change the `admin` role.
 * - Users cannot change their own role (prevents accidental lock-out).
 *
 * Body: { email: string; role: 'student' | 'ta' | 'instructor' | 'admin' }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertManager(access)

  const body = (await readBody<{ email?: string; role?: string }>(event)) || {}
  const email = normalizeEmail(String(body.email || ''))
  const role = body.role

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email is required' })
  }
  if (!isCourseRole(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
  }
  if (email === access.user.email && !access.globalAdmin) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot change your own role' })
  }

  const canManageAdmins = access.globalAdmin || access.role === 'admin'
  const currentRole = await getCourseRole(access.db, access.courseKey, email)
  if ((role === 'admin' || currentRole === 'admin') && !canManageAdmins) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only course admins can grant or change the admin role'
    })
  }

  const enrollments = access.db.collection('enrollments')
  // Collapse legacy duplicate rows into a single enrollment.
  await enrollments.deleteMany({ courseId: access.courseKey, userEmail: email, role: { $ne: role } })
  await enrollments.updateOne(
    { courseId: access.courseKey, userEmail: email },
    { $set: { courseId: access.courseKey, userEmail: email, role } },
    { upsert: true }
  )

  // A user who is no longer staff cannot stay on duty.
  if (role === 'student') {
    await access.db
      .collection('courses')
      .updateOne({ _id: access.course._id }, { $pull: { onDutyTAs: { email } } as any })
  }

  return { ok: true }
})
