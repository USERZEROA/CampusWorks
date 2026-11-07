// server/api/courses/[id]/admin.get.ts
import { defineEventHandler } from 'h3'
import { assertManager, getCourseAccess } from '../../../utils/courses'

/**
 * GET /api/courses/[id]/admin
 *
 * Instructor / course-admin analytics for a single course: enrollments,
 * live queue snapshot, historical help sessions and feedback.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertManager(access)

  const { db, course, courseKey, user, role, globalAdmin } = access
  const byCourse = { courseId: courseKey }

  const [feedback, enrollments, queueEntries, helpSessions] = await Promise.all([
    db.collection('feedback').find(byCourse).sort({ createdAt: -1 }).project({ _id: 0 }).toArray(),
    db.collection('enrollments').find(byCourse).sort({ role: 1, userEmail: 1 }).project({ _id: 0 }).toArray(),
    db.collection('queueEntries').find(byCourse).sort({ position: 1 }).project({ _id: 0 }).toArray(),
    db.collection('helpSessions').find(byCourse).sort({ joinedAt: -1 }).project({ _id: 0 }).toArray()
  ])

  return {
    course: {
      id: courseKey,
      code: course.code,
      title: course.title,
      state: course.state || 'closed',
      activeEntries: queueEntries.filter((q) => !q.paused).length
    },
    viewer: {
      email: user.email,
      name: user.name,
      role,
      isGlobalAdmin: globalAdmin
    },
    enrollments,
    queueEntries,
    helpSessions,
    feedback
  }
})
