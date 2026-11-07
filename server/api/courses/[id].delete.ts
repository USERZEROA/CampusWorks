import { defineEventHandler, createError } from 'h3'
import { withCourseTransaction, recordCourseAudit } from '../../utils/courses'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  const { db, course, courseKey, globalAdmin } = access
  if (!globalAdmin) throw createError({ statusCode: 403, statusMessage: 'Only admins can delete courses' })
  const opportunity = await db.collection('staffingOpportunities').findOne({ courseId: courseKey, status: { $nin: ['archived', 'cancelled'] } }, { session, projection: { _id: 1 } })
  const appointment = await db.collection('staffingAppointments').findOne({ courseId: courseKey, $or: [{ status: { $nin: ['ended', 'cancelled', 'not_cleared', 'expired'] } }, { budgetStatus: 'awaiting_settlement' }] }, { session, projection: { _id: 1 } })
  if (opportunity || appointment) throw createError({ statusCode: 409, statusMessage: 'Resolve linked staffing opportunities and appointments before deleting this course' })
  for (const name of ['enrollments', 'queueEntries', 'helpSessions', 'announcements', 'feedback']) await db.collection(name).deleteMany({ courseId: courseKey }, { session })
  await recordCourseAudit(access, 'CourseDeleted', courseKey, session)
  await db.collection('courses').deleteOne({ _id: course._id }, { session })
  return { ok: true }
}))
