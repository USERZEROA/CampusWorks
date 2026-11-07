import { defineEventHandler, readBody, createError } from 'h3'
import { assertOnDuty, withCourseTransaction } from '../../../../utils/courses'
import { archiveEntry, parseEntryId, assertQueueRevision } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertOnDuty(access)
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  if (body.action !== 'complete' && body.action !== 'remove') throw createError({ statusCode: 400, statusMessage: 'action must be complete or remove' })
  const filter = { _id, courseId: access.courseKey }
  const entry = await access.db.collection('queueEntries').findOne(filter, { session })
  if (!entry) return { ok: true, removed: false }
  if (body.action === 'complete') {
    assertQueueRevision(entry, body.expectedRevision)
    if (entry.paused || entry.otherTa || entry.taEmail !== access.user.email) throw createError({ statusCode: 409, statusMessage: 'Only the current helper can complete an active entry' })
  }
  const archived = await archiveEntry(access.db, filter, { reason: body.action === 'complete' ? 'completed' : 'removed', endedBy: access.user.email }, session)
  return { ok: true, removed: !!archived }
}))
