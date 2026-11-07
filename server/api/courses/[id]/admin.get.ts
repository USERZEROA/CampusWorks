import { createHash } from 'node:crypto'
import { defineEventHandler, getQuery, createError } from 'h3'
import { assertManager, withCourseTransaction, pagination } from '../../../utils/courses'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertManager(access)
  const { db, course, courseKey, user, role, globalAdmin } = access
  const { offset, limit } = pagination(event, 500)
  const byCourse = { courseId: courseKey }
  // History and feedback are append-only; membership and restrictions are mutable.
  // Fence every page against the same dataset before returning any rows.
  const membership = await db.collection('enrollments').find(byCourse, { session }).sort({ role: 1, userEmail: 1 }).project({ _id: 0 }).toArray()
  const restrictions = await db.collection('courseRestrictions').find(byCourse, { session }).sort({ userEmail: 1 }).project({ _id: 0 }).toArray()
  const queueEntries = await db.collection('queueEntries').find(byCourse, { session }).sort({ position: 1, _id: 1 }).limit(500).project({ _id: 0 }).toArray()
  const totals = {
    feedback: await db.collection('feedback').countDocuments(byCourse, { session }),
    enrollments: membership.length,
    helpSessions: await db.collection('helpSessions').countDocuments(byCourse, { session })
  }
  const courseState = { id: courseKey, code: course.code, title: course.title, state: course.state || 'closed', activeEntries: queueEntries.filter(q => !q.paused).length }
  const snapshot = createHash('sha256').update(JSON.stringify({ courseIdentity: course._id, totals, membership, restrictions, queueEntries, course: courseState })).digest('hex')
  const expectedSnapshot = getQuery(event).snapshot
  if ((offset > 0 || expectedSnapshot !== undefined) && expectedSnapshot !== snapshot) throw createError({ statusCode: 409, statusMessage: 'Course records changed; restart pagination' })
  const feedback = await db.collection('feedback').find(byCourse, { session }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).project({ _id: 0 }).toArray()
  const enrollments = membership.slice(offset, offset + limit)
  const helpSessions = await db.collection('helpSessions').find(byCourse, { session }).sort({ joinedAt: -1, _id: -1 }).skip(offset).limit(limit).project({ _id: 0 }).toArray()
  return {
    course: courseState,
    viewer: { email: user.email, name: user.name, role, isGlobalAdmin: globalAdmin }, enrollments, restrictions, queueEntries, helpSessions, feedback,
    pagination: { offset, limit, snapshot, totals, hasMore: { feedback: offset + feedback.length < totals.feedback, enrollments: offset + enrollments.length < totals.enrollments, helpSessions: offset + helpSessions.length < totals.helpSessions } }
  }
}))
