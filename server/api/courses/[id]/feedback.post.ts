// server/api/courses/[id]/feedback.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { assertEnrolled, cleanText, getCourseAccess } from '../../../utils/courses'

const CATEGORIES = ['queue', 'ta', 'wait', 'other']

type FeedbackBody = {
  category?: string
  rating?: number | string
  positive?: string
  negative?: string
  allowContact?: boolean
}

/**
 * POST /api/courses/[id]/feedback
 * Submit structured course feedback. Requires an enrollment in the course.
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertEnrolled(access)

  const body = (await readBody<FeedbackBody>(event)) || {}
  const category = String(body.category || '')
  const positive = cleanText(body.positive, 2000)
  const negative = cleanText(body.negative, 2000)

  if (!CATEGORIES.includes(category) || !positive || !negative) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields' })
  }

  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid rating' })
  }

  await access.db.collection('feedback').insertOne({
    courseId: access.courseKey,
    courseCode: access.course.code,
    studentEmail: access.user.email,
    studentName: access.user.name,
    category,
    rating,
    positive,
    negative,
    allowContact: !!body.allowContact,
    createdAt: new Date()
  })

  return { ok: true }
})
