import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, withCourseTransaction, recordCourseAudit } from '../../../utils/courses'
import { archiveAllEntries } from '../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertStaff(access)
  const body = await readBody(event) || {}
  if (!['open', 'paused', 'closed'].includes(body.state)) throw createError({ statusCode: 400, statusMessage: 'Invalid state' })
  await access.db.collection('courses').updateOne({ _id: access.course._id }, { $set: { state: body.state, ...(body.state === 'closed' ? { onDutyTAs: [] } : {}) } }, { session })
  const archived = body.state === 'closed' ? await archiveAllEntries(access.db, access.courseKey, { reason: 'queue-closed', endedBy: access.user.email }, session) : 0
  await recordCourseAudit(access, 'QueueStateChanged', body.state, session)
  return { ok: true, archived }
}))
