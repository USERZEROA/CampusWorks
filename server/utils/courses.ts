import type { H3Event } from 'h3'
import { createError, getRouterParam, getQuery } from 'h3'
import type { ClientSession, Db, WithId, Document } from 'mongodb'
import { getDb, withTransaction } from './db'
import { getServerConfig } from './config'
import { isGlobalAdmin, requireUser, type SessionUser } from './auth'
import { releaseStaffClaims } from './queue'

export const COURSE_ROLES = ['student', 'ta', 'instructor', 'admin'] as const
export type CourseRole = (typeof COURSE_ROLES)[number]
export const STAFF_ROLES: readonly CourseRole[] = ['ta', 'instructor', 'admin']
export const MANAGER_ROLES: readonly CourseRole[] = ['instructor', 'admin']
const ROLE_RANK: Record<CourseRole, number> = { student: 1, ta: 2, instructor: 3, admin: 4 }
export const isCourseRole = (role: unknown): role is CourseRole => typeof role === 'string' && (COURSE_ROLES as readonly string[]).includes(role)
export const roleRank = (role?: string | null) => isCourseRole(role) ? ROLE_RANK[role] : 0
export const courseKeyOf = (course: Document) => String(course.id || course.code || course._id)
function courseFilter(idOrCode: string) {
  const key = idOrCode.trim()
  if (!key || key.length > 64 || ['undefined', 'null'].includes(key)) throw createError({ statusCode: 400, statusMessage: 'Invalid course identifier' })
  return { $or: [{ id: key }, { code: key }, { code: key.toLowerCase() }] }
}
export function findCourse(db: Db, idOrCode: string, session?: ClientSession) {
  return db.collection('courses').findOne(courseFilter(idOrCode), { session })
}

/** This write is the common serialization point for every course-scoped transition. */
export async function lockCourse(db: Db, idOrCode: string, session: ClientSession) {
  if (!session?.inTransaction()) throw new Error('Course locking requires an active transaction')
  const course = await db.collection('courses').findOneAndUpdate(courseFilter(idOrCode), { $inc: { mutationVersion: 1 } }, { session, returnDocument: 'after' })
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  return course
}
export async function getManualCourseRole(db: Db, key: string, email: string, session?: ClientSession): Promise<CourseRole | null> {
  const row = await db.collection('enrollments').findOne({ courseId: key, userEmail: email }, { session })
  return isCourseRole(row?.role) ? row.role : null
}
export async function getCourseRole(db: Db, key: string, email: string, session?: ClientSession): Promise<CourseRole | null> {
  const manual = await getManualCourseRole(db, key, email, session)
  const { getAppointmentCourseRole } = await import('./staffing')
  const appointment = await getAppointmentCourseRole(db, key, email, session)
  return roleRank(appointment) > roleRank(manual) ? appointment : manual
}
export type CourseAccess = {
  db: Db; course: WithId<Document>; courseKey: string; user: SessionUser; role: CourseRole | null
  globalAdmin: boolean; isStaff: boolean; isManager: boolean
}
async function accessFor(db: Db, course: WithId<Document>, user: SessionUser, session?: ClientSession): Promise<CourseAccess> {
  const courseKey = courseKeyOf(course)
  const role = await getCourseRole(db, courseKey, user.email, session)
  const globalAdmin = isGlobalAdmin(user)
  return { db, course, courseKey, user, role, globalAdmin, isStaff: globalAdmin || (!!role && STAFF_ROLES.includes(role)), isManager: globalAdmin || (!!role && MANAGER_ROLES.includes(role)) }
}
export async function getCourseAccess(event: H3Event): Promise<CourseAccess> {
  const user = await requireUser(event)
  const db = await getDb()
  const course = await findCourse(db, getRouterParam(event, 'id') || '')
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  return accessFor(db, course, user)
}
export async function withCourseTransaction<T>(event: H3Event, work: (access: CourseAccess, session: ClientSession) => Promise<T>, requestedId?: string): Promise<T> {
  const user = await requireUser(event)
  const key = requestedId || getRouterParam(event, 'id') || ''
  return withTransaction(async (db, session) => {
    const course = await lockCourse(db, key, session)
    const { reconcileStaffing } = await import('./staffing-appointments')
    await reconcileStaffing(db, session, { courseId: courseKeyOf(course) })
    const access = await accessFor(db, course, user, session)
    await cleanExpiredStaff(access, session)
    const result = await work(access, session)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) await recordCourseAudit(access, 'CourseMutation', event.method + ' ' + event.path.split('?')[0], session)
    return result
  })
}
async function cleanExpiredStaff(access: CourseAccess, session: ClientSession) {
  const { db, courseKey, course } = access
  const assigned = await db.collection('queueEntries').distinct('taEmail', { courseId: courseKey }, { session })
  const duty = onDutyList(course)
  const emails = [...new Set([...duty.map(d => d.email), ...assigned].filter(e => typeof e === 'string' && e))]
  const retained: Array<{email: string; name: string}> = []
  for (const email of emails) {
    const role = await getCourseRole(db, courseKey, email, session)
    const configuredAdmin = getServerConfig().adminEmails.includes(email)
    // Global demo administrators may be on duty without a course enrollment.
    const isDemoAdmin = getServerConfig().mockLoginEnabled && await db.collection<any>('authSessions').findOne({ 'user.email': email, 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null }, { session, projection: { _id: 1 } })
    if ((role && STAFF_ROLES.includes(role)) || configuredAdmin || isDemoAdmin) {
      const item = duty.find(d => d.email === email)
      if (item) retained.push(item)
    } else await releaseStaffClaims(db, courseKey, email, session)
  }
  if (retained.length !== duty.length) {
    await db.collection('courses').updateOne({ _id: course._id }, { $set: { onDutyTAs: retained } }, { session })
    course.onDutyTAs = retained
  }
}
export function assertStaff(access: CourseAccess) {
  if (!access.isStaff) throw createError({ statusCode: 403, statusMessage: 'Course staff only' })
}
export function assertOnDuty(access: CourseAccess) {
  assertStaff(access)
  if (access.course.state === 'closed') throw createError({ statusCode: 409, statusMessage: 'Queue is closed' })
  if (!onDutyList(access.course).some(d => d.email === access.user.email)) throw createError({ statusCode: 403, statusMessage: 'Start duty before operating the queue' })
}
export function assertManager(access: CourseAccess) {
  if (!access.isManager) throw createError({ statusCode: 403, statusMessage: 'Course instructors / admins only' })
}
export function assertEnrolled(access: CourseAccess) {
  if (!access.role && !access.globalAdmin) throw createError({ statusCode: 403, statusMessage: 'Enroll in this course first' })
}
export const staffLabel = (user: SessionUser) => user.name || user.email
export function onDutyList(course: Document): Array<{ email: string; name: string }> {
  return (Array.isArray(course.onDutyTAs) ? course.onDutyTAs : []).filter(item => item && typeof item.email === 'string').map(item => ({ email: item.email, name: String(item.name || item.email) }))
}
export function cleanText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.trim().length > maxLength) throw createError({ statusCode: 400, statusMessage: 'Invalid text field or maximum length exceeded' })
  return value.trim()
}
export function pagination(event: H3Event, defaultLimit = 200) {
  const query = getQuery(event)
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw createError({ statusCode: 400, statusMessage: 'Invalid pagination' })
  return { limit, offset }
}
export async function recordCourseAudit(access: CourseAccess, action: string, target: string, session: ClientSession) {
  await access.db.collection('auditEvents').insertOne({ courseId: access.courseKey, actorId: access.user.id, action, target, createdAt: new Date() }, { session })
}
