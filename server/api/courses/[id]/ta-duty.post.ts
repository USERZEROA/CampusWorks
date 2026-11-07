// server/api/courses/[id]/ta-duty.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, getCourseAccess, staffLabel } from '../../../utils/courses'

/**
 * POST /api/courses/[id]/ta-duty
 *
 * Mark the caller on / off duty for this course. Course staff only.
 * On-duty staff are stored as { email, name } so that two TAs with the same
 * display name do not collide.
 *
 * Body: { onDuty: boolean }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ onDuty?: boolean }>(event)) || {}
  if (typeof body.onDuty !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'onDuty must be a boolean' })
  }

  const courses = access.db.collection('courses')
  const { _id } = access.course
  const { email } = access.user
  const name = staffLabel(access.user)

  // Remove any existing record for this user (object rows and legacy name rows).
  await courses.updateOne({ _id }, { $pull: { onDutyTAs: { email } } as any })
  await courses.updateOne({ _id }, { $pull: { onDutyTAs: name } as any })

  if (body.onDuty) {
    await courses.updateOne({ _id }, { $push: { onDutyTAs: { email, name } } as any })
  }

  return { ok: true, onDuty: body.onDuty }
})
