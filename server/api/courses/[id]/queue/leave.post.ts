import { defineEventHandler } from 'h3'
import { withCourseTransaction } from '../../../../utils/courses'
import { archiveEntry } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async ({ db, courseKey, user }, session) => {
  await archiveEntry(db, { courseId: courseKey, studentEmail: user.email }, { reason: 'left', endedBy: user.email }, session)
  return { ok: true }
}))
