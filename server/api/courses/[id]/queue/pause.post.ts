import { defineEventHandler, readBody, createError } from 'h3'
import { assertOnDuty, withCourseTransaction } from '../../../../utils/courses'
import { parseEntryId, releaseEntry, resumedPauseFields } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  if (typeof body.paused !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'paused must be a boolean' })
  const coll = access.db.collection('queueEntries')
  const entry = await coll.findOne({ _id, courseId: access.courseKey }, { session })
  if (!entry) return { ok: true }
  if (entry.studentEmail !== access.user.email) assertOnDuty(access)
  const now = new Date()
  if (body.paused) {
    if (!entry.paused) {
      await releaseEntry(access.db, entry, session, false, now)
      await coll.updateOne({ _id }, { $set: { paused: true, pauseStartedAt: now } }, { session })
    }
  } else {
    await coll.updateOne({ _id }, { $set: resumedPauseFields(entry, now), $unset: { pauseStartedAt: '' } }, { session })
  }
  return { ok: true }
}))
