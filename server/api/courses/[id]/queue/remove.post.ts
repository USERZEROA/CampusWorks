import { defineEventHandler, readBody } from 'h3'
import { assertOnDuty, withCourseTransaction } from '../../../../utils/courses'
import { archiveEntry, parseEntryId } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertOnDuty(access)
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  const archived = await archiveEntry(access.db, { _id, courseId: access.courseKey }, { reason: 'completed', endedBy: access.user.email }, session)
  return { ok: true, removed: !!archived }
}))
