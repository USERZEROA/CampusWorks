import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, cleanText, withCourseTransaction, staffLabel } from '../../../utils/courses'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertStaff(access)
  const body = await readBody(event) || {}
  const message = cleanText(body.message, 1000)
  if (!message) throw createError({ statusCode: 400, statusMessage: 'message required' })
  await access.db.collection('announcements').insertOne({ courseId: access.courseKey, message, by: staffLabel(access.user), byEmail: access.user.email, createdAt: new Date() }, { session })
  return { ok: true }
}))
