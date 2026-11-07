// server/api/courses/[id]/announcements/[announcementId].delete.ts
import { defineEventHandler, createError, getRouterParam } from 'h3'
import { ObjectId } from 'mongodb'
import { assertStaff, getCourseAccess } from '../../../../utils/courses'

/**
 * DELETE /api/courses/[id]/announcements/[announcementId]
 * Delete a single announcement. Course staff only.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const id = getRouterParam(event, 'announcementId') || ''
  if (!ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid announcement id' })
  }

  const result = await access.db
    .collection('announcements')
    .deleteOne({ _id: new ObjectId(id), courseId: access.courseKey })

  if (result.deletedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Announcement not found' })
  }

  return { ok: true }
})
