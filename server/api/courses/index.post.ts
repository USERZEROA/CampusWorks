// server/api/courses/index.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { getDb } from '../../utils/db'
import { isGlobalAdmin, requireUser } from '../../utils/auth'
import { cleanText } from '../../utils/courses'

/**
 * POST /api/courses
 *
 * Creates a course with a normalized (lowercase) code and a closed queue.
 * Global admins only. The creator is enrolled as the course admin.
 *
 * Body: { code: string; title: string }
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!isGlobalAdmin(user)) {
    throw createError({ statusCode: 403, statusMessage: 'Only admins can create courses' })
  }

  const body = (await readBody<{ code?: string; title?: string }>(event)) || {}
  const code = cleanText(body.code, 32).toLowerCase()
  const title = cleanText(body.title, 120)

  if (!code || !title) {
    throw createError({ statusCode: 400, statusMessage: 'code & title required' })
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(code)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Course code may only contain letters, digits, ".", "_" and "-"'
    })
  }

  const db = await getDb()
  const exists = await db.collection('courses').findOne({ $or: [{ id: code }, { code }] })
  if (exists) {
    throw createError({ statusCode: 409, statusMessage: 'Course already exists' })
  }

  await db.collection('courses').insertOne({
    id: code,
    code,
    title,
    state: 'closed',
    onDutyTAs: [],
    createdAt: new Date(),
    createdBy: user.email
  })

  await db.collection('enrollments').updateOne(
    { courseId: code, userEmail: user.email },
    { $set: { courseId: code, userEmail: user.email, role: 'admin' } },
    { upsert: true }
  )

  return { ok: true, id: code }
})
