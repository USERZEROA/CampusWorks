// server/api/courses/[id].delete.ts
import { defineEventHandler, createError } from 'h3'
import { getCourseAccess } from '../../utils/courses'

/**
 * DELETE /api/courses/[id]
 * Hard-deletes a course and everything that belongs to it
 * (enrollments, queue, help sessions, announcements, feedback).
 * Global admins only.
 */
export default defineEventHandler(async (event) => {
  const { db, course, courseKey, globalAdmin } = await getCourseAccess(event)

  if (!globalAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Only admins can delete courses' })
  }

  await db.collection('courses').deleteOne({ _id: course._id })
  await Promise.all(
    ['enrollments', 'queueEntries', 'helpSessions', 'announcements', 'feedback'].map((name) =>
      db.collection(name).deleteMany({ courseId: courseKey })
    )
  )

  return { ok: true }
})
