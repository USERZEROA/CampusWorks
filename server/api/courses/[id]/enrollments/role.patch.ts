import { defineEventHandler, readBody, createError } from 'h3'
import { normalizeEmail, validEmail } from '../../../../utils/auth'
import { assertManager, withCourseTransaction, getCourseRole, getManualCourseRole, isCourseRole, STAFF_ROLES, recordCourseAudit, onDutyList } from '../../../../utils/courses'
import { releaseStaffClaims } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertManager(access)
  const body = await readBody(event) || {}
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  const role = body.role
  if (!validEmail(email) || !isCourseRole(role)) throw createError({ statusCode: 400, statusMessage: 'Valid email and role required' })
  if (email === access.user.email) throw createError({ statusCode: 400, statusMessage: 'You cannot change your own role' })
  const current = await getManualCourseRole(access.db, access.courseKey, email, session)
  if ((role === 'admin' || current === 'admin') && !(access.globalAdmin || access.role === 'admin')) throw createError({ statusCode: 403, statusMessage: 'Only course admins can grant or change the admin role' })
  await access.db.collection('enrollments').updateOne({ courseId: access.courseKey, userEmail: email }, { $set: { courseId: access.courseKey, userEmail: email, role } }, { session, upsert: true })
  const effective = await getCourseRole(access.db, access.courseKey, email, session)
  if (!effective || !STAFF_ROLES.includes(effective)) {
    await releaseStaffClaims(access.db, access.courseKey, email, session)
    await access.db.collection('courses').updateOne({ _id: access.course._id }, { $set: { onDutyTAs: onDutyList(access.course).filter(item => item.email !== email) } }, { session })
  }
  await recordCourseAudit(access, 'ManualRoleChanged', email, session)
  return { ok: true, role: effective, manualRole: role }
}))
