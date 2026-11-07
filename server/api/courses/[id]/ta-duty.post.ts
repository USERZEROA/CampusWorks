import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, withCourseTransaction, staffLabel, onDutyList } from '../../../utils/courses'
import { releaseStaffClaims } from '../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertStaff(access)
  const body = await readBody(event) || {}
  if (typeof body.onDuty !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'onDuty must be a boolean' })
  if (body.onDuty && access.course.state === 'closed') throw createError({ statusCode: 409, statusMessage: 'Open the queue before starting duty' })
  const duty = onDutyList(access.course).filter(item => item.email !== access.user.email)
  if (body.onDuty) duty.push({ email: access.user.email, name: staffLabel(access.user) })
  else await releaseStaffClaims(access.db, access.courseKey, access.user.email, session)
  await access.db.collection('courses').updateOne({ _id: access.course._id }, { $set: { onDutyTAs: duty } }, { session })
  return { ok: true, onDuty: body.onDuty }
}))
