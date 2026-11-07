import { defineEventHandler, readBody, createError } from 'h3'
import { withCourseTransaction } from '../../../../utils/courses'
import { archiveEntry, parseEntryId } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async ({ db, courseKey, user }, session) => {
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  const current = await db.collection('queueEntries').findOne({ courseId: courseKey, studentEmail: user.email }, { session })
  if (current && !current._id.equals(_id)) throw createError({ statusCode: 409, statusMessage: 'Your queue entry changed; use its current controls' })
  await archiveEntry(db, { _id, courseId: courseKey, studentEmail: user.email }, { reason: 'left', endedBy: user.email }, session)
  return { ok: true }
}))
