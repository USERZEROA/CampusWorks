// server/api/courses/index.get.ts
import { defineEventHandler } from 'h3'
import { getDb } from '../../utils/db'
import { publicUser, requireUser } from '../../utils/auth'
import { courseKeyOf, roleRank } from '../../utils/courses'

/**
 * GET /api/courses
 *
 * Returns the current user and all courses with the user's role per course.
 * - 401 if not authenticated.
 * - `primaryRole` is the highest-privilege role across the user's enrollments
 *   for that course (null when not enrolled).
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = await getDb()

  const [courses, enrollments] = await Promise.all([
    db.collection('courses').find({}).sort({ code: 1 }).toArray(),
    db.collection('enrollments').find({ userEmail: user.email }).toArray()
  ])

  const roleByCourse: Record<string, string> = {}
  for (const e of enrollments) {
    const cid = String(e.courseId || '')
    if (cid && roleRank(e.role) > roleRank(roleByCourse[cid])) {
      roleByCourse[cid] = e.role
    }
  }

  return {
    user: publicUser(user),
    courses: courses.map((c) => {
      const id = courseKeyOf(c)
      const role = roleByCourse[id] || null
      return {
        id,
        code: c.code,
        title: c.title,
        state: c.state || 'closed',
        enrolled: !!role,
        primaryRole: role
      }
    })
  }
})
