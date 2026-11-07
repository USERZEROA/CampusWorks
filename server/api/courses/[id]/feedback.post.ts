import { defineEventHandler, readBody, createError } from 'h3'
import { assertEnrolled, cleanText, withCourseTransaction } from '../../../utils/courses'
const CATEGORIES = ['queue', 'ta', 'wait', 'other']
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertEnrolled(access)
  const body = await readBody(event) || {}
  const positive = cleanText(body.positive, 2000)
  const negative = cleanText(body.negative, 2000)
  if (!CATEGORIES.includes(body.category) || !positive || !negative || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || (body.allowContact !== undefined && typeof body.allowContact !== 'boolean')) throw createError({ statusCode: 400, statusMessage: 'Valid feedback fields required' })
  await access.db.collection('feedback').insertOne({
    courseId: access.courseKey, courseCode: access.course.code, studentId: access.user.id, studentEmail: access.user.email,
    studentName: access.user.name, category: body.category, rating: body.rating, positive, negative,
    allowContact: body.allowContact === true, identified: true, createdAt: new Date()
  }, { session })
  return { ok: true, identified: true }
}))
