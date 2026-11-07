// server/utils/courses.ts
import type { H3Event } from 'h3'
import { createError, getRouterParam } from 'h3'
import type { Db, WithId, Document } from 'mongodb'
import { getDb } from './db'
import { isGlobalAdmin, requireUser, type SessionUser } from './auth'

export const COURSE_ROLES = ['student', 'ta', 'instructor', 'admin'] as const
export type CourseRole = (typeof COURSE_ROLES)[number]

export const STAFF_ROLES: readonly CourseRole[] = ['ta', 'instructor', 'admin']
export const MANAGER_ROLES: readonly CourseRole[] = ['instructor', 'admin']

const ROLE_RANK: Record<CourseRole, number> = {
  student: 1,
  ta: 2,
  instructor: 3,
  admin: 4
}

export const isCourseRole = (role: unknown): role is CourseRole =>
  typeof role === 'string' && (COURSE_ROLES as readonly string[]).includes(role)

export const roleRank = (role?: string | null) =>
  isCourseRole(role) ? ROLE_RANK[role] : 0

/** Stable key used by enrollments, queue entries, sessions and feedback. */
export const courseKeyOf = (course: Document) =>
  String(course.id || course.code || course._id)

/** Resolve a course by internal `id` or human `code`. */
export async function findCourse(db: Db, idOrCode: string) {
  const key = (idOrCode || '').trim()
  if (!key || key === 'undefined' || key === 'null') return null
  return db.collection('courses').findOne({
    $or: [{ id: key }, { code: key }, { code: key.toLowerCase() }]
  })
}

/**
 * The user's role in a course. Tolerates legacy duplicate enrollment rows
 * by returning the highest-privilege one.
 */
export async function getCourseRole(
  db: Db,
  courseKey: string,
  email: string
): Promise<CourseRole | null> {
  const rows = await db
    .collection('enrollments')
    .find({ courseId: courseKey, userEmail: email })
    .toArray()

  let best: CourseRole | null = null
  for (const row of rows) {
    if (isCourseRole(row.role) && roleRank(row.role) > roleRank(best)) {
      best = row.role
    }
  }
  return best
}

export type CourseAccess = {
  db: Db
  course: WithId<Document>
  courseKey: string
  user: SessionUser
  role: CourseRole | null
  globalAdmin: boolean
  /** TA / instructor / course admin, or global admin. */
  isStaff: boolean
  /** Instructor / course admin, or global admin. */
  isManager: boolean
}

/**
 * Authenticate the caller and resolve the course from the `[id]` route param
 * together with the caller's permissions in it.
 */
export async function getCourseAccess(event: H3Event): Promise<CourseAccess> {
  const user = await requireUser(event)
  const db = await getDb()

  const course = await findCourse(db, getRouterParam(event, 'id') || '')
  if (!course) {
    throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  }

  const courseKey = courseKeyOf(course)
  const role = await getCourseRole(db, courseKey, user.email)
  const globalAdmin = isGlobalAdmin(user)

  return {
    db,
    course,
    courseKey,
    user,
    role,
    globalAdmin,
    isStaff: globalAdmin || (!!role && STAFF_ROLES.includes(role)),
    isManager: globalAdmin || (!!role && MANAGER_ROLES.includes(role))
  }
}

export function assertStaff(access: CourseAccess) {
  if (!access.isStaff) {
    throw createError({ statusCode: 403, statusMessage: 'Course staff only' })
  }
}

export function assertManager(access: CourseAccess) {
  if (!access.isManager) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Course instructors / admins only'
    })
  }
}

export function assertEnrolled(access: CourseAccess) {
  if (!access.role && !access.globalAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Enroll in this course first'
    })
  }
}

/** Label shown to students for the TA helping them. */
export const staffLabel = (user: SessionUser) => user.name || user.email

/** On-duty staff are stored as { email, name }; older rows stored plain names. */
export function onDutyList(course: Document): Array<{ email: string; name: string }> {
  const raw = Array.isArray(course.onDutyTAs) ? course.onDutyTAs : []
  return raw.map((item: any) =>
    typeof item === 'string'
      ? { email: '', name: item }
      : { email: String(item?.email || ''), name: String(item?.name || item?.email || '') }
  )
}

/** Trim and bound free-text input. */
export function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength)
}
