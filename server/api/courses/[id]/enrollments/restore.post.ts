import { defineEventHandler, readBody, createError } from 'h3'
import { normalizeEmail, validEmail } from '../../../../utils/auth'
import { assertManager, withCourseTransaction, recordCourseAudit } from '../../../../utils/courses'
import { invalidateCandidateRefresh } from '../../../../utils/ai-refresh'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertManager(access)
  const body = await readBody(event) || {}
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  if (!validEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
  const result = await access.db.collection('courseRestrictions').deleteOne({ courseId: access.courseKey, userEmail: email }, { session })
  if (result.deletedCount) {
    const applicant = await access.db.collection('users').findOne({ email }, { session, projection: { id: 1 } })
    if (applicant) await invalidateCandidateRefresh(access.db, session, { applicantId: applicant.id })
    await recordCourseAudit(access, 'CourseStudentRestrictionLifted', email, session)
  }
  return { ok: true }
}))
