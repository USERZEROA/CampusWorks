import { defineEventHandler } from 'h3'
import { withCourseTransaction, onDutyList } from '../../utils/courses'
import { toQueueEntryDto } from '../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  const { db, course, courseKey, user, role, isStaff, isManager, globalAdmin } = access
  const announcements = await db.collection('announcements').find({ courseId: courseKey }, { session }).sort({ createdAt: -1 }).limit(200).toArray()
  const queueEntries = await db.collection('queueEntries').find({ courseId: courseKey }, { session }).sort({ position: 1, createdAt: 1 }).limit(500).toArray()
  const onDuty = onDutyList(course)
  return {
    id: courseKey, code: course.code, title: course.title, state: course.state || 'closed',
    onDutyTAs: onDuty.map(d => d.name), onDuty: onDuty.some(d => d.email === user.email),
    role, enrolled: !!role, isStaff, isManager, isGlobalAdmin: globalAdmin,
    user: { id: user.id, email: user.email, name: user.name },
    announcements: announcements.map(a => ({ id: a._id.toString(), at: a.createdAt, by: a.by, message: a.message })),
    queueLength: queueEntries.length, queue: role || globalAdmin ? queueEntries.map(q => toQueueEntryDto(q, { email: user.email, isStaff })) : [],
    limits: { queueCapacity: 500, announcementLimit: 200 }
  }
}))
