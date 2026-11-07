import { defineEventHandler, readBody, createError } from 'h3'
import { withTransaction } from '../../utils/db'
import { isGlobalAdmin, requireUser } from '../../utils/auth'
import { cleanText } from '../../utils/courses'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  if (!isGlobalAdmin(user)) throw createError({ statusCode: 403, statusMessage: 'Only admins can create courses' })
  const body = await readBody(event) || {}
  const code = cleanText(body.code, 32).toLowerCase()
  const title = cleanText(body.title, 120)
  if (!code || !title || ['null', 'undefined'].includes(code) || !/^[a-z0-9][a-z0-9._-]*$/.test(code)) throw createError({ statusCode: 400, statusMessage: 'Valid code and title required' })
  return withTransaction(async (db, session) => {
    if (await db.collection('courses').findOne({ $or: [{ id: code }, { code }] }, { session })) throw createError({ statusCode: 409, statusMessage: 'Course already exists' })
    await db.collection('courses').insertOne({ id: code, code, title, state: 'closed', onDutyTAs: [], queueSequence: 0, mutationVersion: 0, createdAt: new Date(), createdBy: user.email }, { session })
    await db.collection('enrollments').insertOne({ courseId: code, userEmail: user.email, role: 'admin' }, { session })
    await db.collection('auditEvents').insertOne({ courseId: code, actorId: user.id, action: 'CourseCreated', target: code, createdAt: new Date() }, { session })
    return { ok: true, id: code }
  })
})
