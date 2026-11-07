// server/api/courses/[id].get.ts
import { defineEventHandler } from 'h3'
import { getCourseAccess, onDutyList } from '../../utils/courses'
import { toQueueEntryDto } from '../../utils/queue'

/**
 * GET /api/courses/[id]
 * Returns course metadata, the caller's role/permissions, announcements and
 * the live queue. Accepts either internal course `id` or human `code`.
 * Requires authentication. Students only see email addresses on their own
 * entry; users who are not enrolled only see the queue length.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  const { db, course, courseKey, user, role, isStaff, isManager, globalAdmin } = access

  const [announcements, queueEntries] = await Promise.all([
    db.collection('announcements').find({ courseId: courseKey }).sort({ createdAt: -1 }).toArray(),
    db
      .collection('queueEntries')
      .find({ courseId: courseKey })
      .sort({ position: 1, createdAt: 1 })
      .toArray()
  ])

  const onDuty = onDutyList(course)
  const canSeeQueue = !!role || globalAdmin

  return {
    id: courseKey,
    code: course.code,
    title: course.title,
    state: course.state || 'closed',
    onDutyTAs: onDuty.map((d) => d.name),
    onDuty: onDuty.some((d) => d.email === user.email),
    role,
    enrolled: !!role,
    isStaff,
    isManager,
    isGlobalAdmin: globalAdmin,
    user: { email: user.email, name: user.name },
    announcements: announcements.map((a) => ({
      id: a._id.toString(),
      at: a.createdAt,
      by: a.by,
      message: a.message
    })),
    queueLength: queueEntries.length,
    queue: canSeeQueue
      ? queueEntries.map((q) => toQueueEntryDto(q, { email: user.email, isStaff }))
      : []
  }
})
