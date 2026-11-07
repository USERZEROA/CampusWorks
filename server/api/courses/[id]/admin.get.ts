import { defineEventHandler } from 'h3'
import { assertManager, withCourseTransaction, pagination } from '../../../utils/courses'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertManager(access)
  const { db, course, courseKey, user, role, globalAdmin } = access
  const { offset, limit } = pagination(event, 500)
  const byCourse = { courseId: courseKey }
  const feedback = await db.collection('feedback').find(byCourse, { session }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).project({ _id: 0 }).toArray()
  const enrollments = await db.collection('enrollments').find(byCourse, { session }).sort({ role: 1, userEmail: 1 }).skip(offset).limit(limit).project({ _id: 0 }).toArray()
  const queueEntries = await db.collection('queueEntries').find(byCourse, { session }).sort({ position: 1 }).limit(500).project({ _id: 0 }).toArray()
  const helpSessions = await db.collection('helpSessions').find(byCourse, { session }).sort({ joinedAt: -1, _id: -1 }).skip(offset).limit(limit).project({ _id: 0 }).toArray()
  const totals = {
    feedback: await db.collection('feedback').countDocuments(byCourse, { session }),
    enrollments: await db.collection('enrollments').countDocuments(byCourse, { session }),
    helpSessions: await db.collection('helpSessions').countDocuments(byCourse, { session })
  }
  return {
    course: { id: courseKey, code: course.code, title: course.title, state: course.state || 'closed', activeEntries: queueEntries.filter(q => !q.paused).length },
    viewer: { email: user.email, name: user.name, role, isGlobalAdmin: globalAdmin }, enrollments, queueEntries, helpSessions, feedback,
    pagination: { offset, limit, totals, hasMore: { feedback: offset + feedback.length < totals.feedback, enrollments: offset + enrollments.length < totals.enrollments, helpSessions: offset + helpSessions.length < totals.helpSessions } }
  }
}))
