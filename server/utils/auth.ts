import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { H3Event, SessionConfig } from 'h3'
import { createError, deleteCookie, getCookie, unsealSession, useSession } from 'h3'
import { getServerConfig, secureRequest } from './config'
import { getDb } from './db'

export type PrimaryRole = 'student' | 'ta' | 'instructor' | 'admin'
export type SessionUser = { id: string; email: string; name: string; primaryRole: PrimaryRole; provider: 'mock' | 'gitlab' }
type SessionData = { sid?: string }
const SESSION_COOKIE = 'campusworks_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7
export const OAUTH_STATE_COOKIE = 'campusworks_oauth_state'
const PRIMARY_ROLES: PrimaryRole[] = ['student', 'ta', 'instructor', 'admin']
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const validEmail = (email: unknown): email is string => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

function sessionConfig(event: H3Event): SessionConfig {
  return {
    name: SESSION_COOKIE, password: getServerConfig().sessionSecret, maxAge: SESSION_MAX_AGE, sessionHeader: false,
    cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: secureRequest(event) }
  }
}
async function sealedToken(event: H3Event): Promise<string | null> {
  const sealed = getCookie(event, SESSION_COOKIE)
  if (!sealed) return null
  try {
    const session = await unsealSession(event, sessionConfig(event), sealed)
    const sid = (session.data as SessionData | undefined)?.sid
    return typeof sid === 'string' && /^[a-f0-9]{64}$/.test(sid) ? sid : null
  } catch { return null }
}

/** The sealed cookie references a revocable server record; it carries no trusted role claim. */
export async function getSessionUser(event: H3Event): Promise<SessionUser | null> {
  if (event.context.campusworksUser !== undefined) return event.context.campusworksUser
  const token = await sealedToken(event)
  let user: SessionUser | null = null
  if (token) {
    const db = await getDb()
    const record = await db.collection<any>('authSessions').findOne({ _id: tokenHash(token), expiresAt: { $gt: new Date() }, revokedAt: null })
    const raw = record?.user
    if (raw && typeof raw.id === 'string' && validEmail(raw.email) && PRIMARY_ROLES.includes(raw.primaryRole)) user = raw
  }
  event.context.campusworksUser = user
  return user
}
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  return user
}

export async function setSessionUser(event: H3Event, input: Omit<SessionUser, 'id'> & { id?: string }): Promise<SessionUser> {
  const db = await getDb()
  const email = normalizeEmail(input.email)
  if (!validEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  const now = new Date()
  const users = db.collection<any>('users')
  let account: any
  try {
    account = await users.findOneAndUpdate({ email }, {
      $set: { email, name: input.name.slice(0, 80), updatedAt: now },
      $setOnInsert: { id: randomUUID(), createdAt: now }
    }, { upsert: true, returnDocument: 'after' })
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    account = await users.findOne({ email })
  }
  if (!account?.id) throw createError({ statusCode: 503, statusMessage: 'Unable to establish account identity' })
  const user: SessionUser = { ...input, id: account.id, email, name: input.name.slice(0, 80) }
  const previous = await sealedToken(event)
  if (previous) await db.collection<any>('authSessions').deleteOne({ _id: tokenHash(previous) })
  const token = randomBytes(32).toString('hex')
  await db.collection<any>('authSessions').insertOne({
    _id: tokenHash(token), userId: user.id, user, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000)
  })
  const session = await useSession<SessionData>(event, sessionConfig(event))
  await session.update({ sid: token })
  event.context.campusworksUser = user
  return user
}
export async function clearSessionUser(event: H3Event) {
  const token = await sealedToken(event)
  if (token) await (await getDb()).collection<any>('authSessions').deleteOne({ _id: tokenHash(token) })
  for (const name of [SESSION_COOKIE, 'campusworks_user']) deleteCookie(event, name, { path: '/' })
  event.context.campusworksUser = null
}
export function isGlobalAdmin(user: SessionUser | null | undefined) {
  return !!user && ((user.provider === 'mock' && getServerConfig().mockLoginEnabled && user.primaryRole === 'admin') || getServerConfig().adminEmails.includes(user.email))
}
export function publicUser(user: SessionUser) {
  return { id: user.id, email: user.email, name: user.name, primaryRole: user.primaryRole, provider: user.provider, isGlobalAdmin: isGlobalAdmin(user) }
}
