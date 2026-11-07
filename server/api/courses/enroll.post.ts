import { defineEventHandler, readBody, createError } from 'h3'
import { withCourseTransaction, getCourseRole, STAFF_ROLES, cleanText } from '../../utils/courses'
import { requireUser } from '../../utils/auth'
import { archiveEntry } from '../../utils/queue'
export default defineEventHandler(async event => {
  await requireUser(event)
  const body = await readBody(event) || {}
  const requested = cleanText(body.courseId, 64)
  if (!requested || typeof body.enroll !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'courseId and boolean enroll required' })
  return withCourseTransaction(event, async (access, session) => {
    const { db, courseKey, user } = access
    const role = await getCourseRole(db, courseKey, user.email, session)
    if (role && STAFF_ROLES.includes(role)) return { ok: true, role }
    if (body.enroll) {
      await db.collection('enrollments').updateOne({ courseId: courseKey, userEmail: user.email }, { $set: { courseId: courseKey, userEmail: user.email, role: 'student' } }, { session, upsert: true })
      return { ok: true, role: 'student' }
    }
    await db.collection('enrollments').deleteMany({ courseId: courseKey, userEmail: user.email, role: 'student' }, { session })
    await archiveEntry(db, { courseId: courseKey, studentEmail: user.email }, { reason: 'left', endedBy: user.email }, session)
    return { ok: true, role: null }
  }, requested)
})
