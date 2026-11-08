import { defineEventHandler, readBody, createError } from 'h3'
import { assertEnrolled, cleanText, withCourseTransaction } from '../../../utils/courses'
import { ObjectId } from 'mongodb'
import { requireFeedbackHelper } from '../../../utils/help-feedback'
const CATEGORIES = ['queue', 'ta', 'wait', 'other']
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertEnrolled(access)
  const body = await readBody(event) || {}
  const positive = cleanText(body.positive, 2000)
  const negative = cleanText(body.negative, 2000)
  if (!CATEGORIES.includes(body.category) || !positive || !negative || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || (body.allowContact !== undefined && typeof body.allowContact !== 'boolean')) throw createError({ statusCode: 400, statusMessage: 'Valid feedback fields required' })
  const helpSessionId = cleanText(body.helpSessionId, 48)
  const helperEmail = cleanText(body.taEmail, 254).toLowerCase()
  const targeted = !!helpSessionId || !!helperEmail || body.ratingScope === 'helper'
  if (body.ratingScope !== undefined && !['course', 'helper'].includes(body.ratingScope)) throw createError({ statusCode: 400, statusMessage: 'Invalid feedback scope' })
  let attribution: { ratingScope: 'helper'; helpSessionId: string; taEmail: string; taName: string } | { ratingScope: 'course' } = { ratingScope: 'course' }
  if (targeted) {
    if (body.category !== 'ta' || !/^[a-f0-9]{24}$/i.test(helpSessionId) || !helperEmail) throw createError({ statusCode: 400, statusMessage: 'A completed help session and its helper are required' })
    const record = await access.db.collection('helpSessions').findOne({ _id: new ObjectId(helpSessionId), courseId: access.courseKey }, { session })
    if (!record) throw createError({ statusCode: 404, statusMessage: 'Help session not found' })
    const helper = requireFeedbackHelper(record, access.user, helperEmail)
    attribution = { ratingScope: 'helper', helpSessionId: String(record._id), taEmail: helper.email, taName: helper.name }
    const existing = await access.db.collection('feedback').findOne({ courseId: access.courseKey, studentId: access.user.id, ratingScope: 'helper', helpSessionId: attribution.helpSessionId, taEmail: attribution.taEmail }, { session })
    if (existing) {
      if (existing.rating !== body.rating || existing.positive !== positive || existing.negative !== negative || existing.allowContact !== (body.allowContact === true)) throw createError({ statusCode: 409, statusMessage: 'Feedback has already been recorded for this helper and session' })
      return { ok: true, identified: true, ratingScope: 'helper', replayed: true }
    }
  }
  await access.db.collection('feedback').insertOne({
    courseId: access.courseKey, courseCode: access.course.code, studentId: access.user.id, studentEmail: access.user.email,
    studentName: access.user.name, category: body.category, rating: body.rating, positive, negative,
    allowContact: body.allowContact === true, identified: true, createdAt: new Date(), ...attribution
  }, { session })
  return { ok: true, identified: true, ratingScope: attribution.ratingScope }
}))
