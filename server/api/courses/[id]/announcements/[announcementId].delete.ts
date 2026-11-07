import { defineEventHandler, createError, getRouterParam } from 'h3'
import { assertStaff, withCourseTransaction } from '../../../../utils/courses'
import { parseEntryId } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertStaff(access)
  const _id = parseEntryId(getRouterParam(event, 'announcementId'))
  const result = await access.db.collection('announcements').deleteOne({ _id, courseId: access.courseKey }, { session })
  if (!result.deletedCount) throw createError({ statusCode: 404, statusMessage: 'Announcement not found' })
  return { ok: true }
}))
