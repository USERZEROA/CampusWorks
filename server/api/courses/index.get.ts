import { defineEventHandler } from 'h3'
import { getDb } from '../../utils/db'
import { publicUser, requireUser } from '../../utils/auth'
import { courseKeyOf, getCourseRole, pagination } from '../../utils/courses'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const db = await getDb()
  const { offset, limit } = pagination(event)
  const courses = await db.collection('courses').find({}).sort({ code: 1 }).skip(offset).limit(limit).toArray()
  const total = await db.collection('courses').countDocuments({})
  const result = await Promise.all(courses.map(async course => {
    const id = courseKeyOf(course)
    const role = await getCourseRole(db, id, user.email)
    const restricted = !!await db.collection('courseRestrictions').findOne({ courseId: id, userEmail: user.email }, { projection: { _id: 1 } })
    return { id, code: course.code, title: course.title, state: course.state || 'closed', enrolled: !!role, restricted, primaryRole: role }
  }))
  return { user: publicUser(user), courses: result, pagination: { offset, limit, total, hasMore: offset + courses.length < total } }
})
