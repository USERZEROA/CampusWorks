import { defineEventHandler, readBody, createError } from 'h3'
import { normalizeEmail, validEmail } from '../../../../utils/auth'
import { assertManager, withCourseTransaction, getManualCourseRole, onDutyList, recordCourseAudit } from '../../../../utils/courses'
import { archiveEntry, releaseStaffClaims } from '../../../../utils/queue'
import { invalidateCandidateRefresh } from '../../../../utils/ai-refresh'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertManager(access)
  const body = await readBody(event) || {}
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  if (!validEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
  if (email === access.user.email) throw createError({ statusCode: 400, statusMessage: 'You cannot remove yourself' })
  const target = await getManualCourseRole(access.db, access.courseKey, email, session)
  if (target === 'admin' && !(access.globalAdmin || access.role === 'admin')) throw createError({ statusCode: 403, statusMessage: 'Only course admins can remove an admin' })
  const { getAppointmentCourseRole } = await import('../../../../utils/staffing')
  if (await getAppointmentCourseRole(access.db, access.courseKey, email, session)) throw createError({ statusCode: 409, statusMessage: 'End the active appointment before removing this course member' })
  if (target === 'student') {
    const restriction = await access.db.collection('courseRestrictions').updateOne({ courseId: access.courseKey, userEmail: email }, { $setOnInsert: { courseId: access.courseKey, userEmail: email, restrictedAt: new Date(), restrictedBy: access.user.email } }, { session, upsert: true })
    const applicant = restriction.upsertedCount ? await access.db.collection('users').findOne({ email }, { session, projection: { id: 1 } }) : null
    if (applicant) await invalidateCandidateRefresh(access.db, session, { applicantId: applicant.id })
    await recordCourseAudit(access, 'CourseStudentRestricted', email, session)
  }
  await releaseStaffClaims(access.db, access.courseKey, email, session)
  await access.db.collection('enrollments').deleteMany({ courseId: access.courseKey, userEmail: email }, { session })
  await access.db.collection('courses').updateOne({ _id: access.course._id }, { $set: { onDutyTAs: onDutyList(access.course).filter(item => item.email !== email) } }, { session })
  await archiveEntry(access.db, { courseId: access.courseKey, studentEmail: email }, { reason: 'kicked', endedBy: access.user.email }, session)
  await recordCourseAudit(access, 'CourseMemberRemoved', email, session)
  return { ok: true }
}))
