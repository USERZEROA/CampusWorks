import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { H3Event, SessionConfig } from 'h3'
import { createError, deleteCookie, getCookie, unsealSession, useSession } from 'h3'
import { getServerConfig, secureRequest } from './config'
import { getDb, withTransaction } from './db'

export type PrimaryRole = 'student' | 'ta' | 'instructor' | 'admin'
export type SessionUser = { id: string; email: string; name: string; primaryRole: PrimaryRole; provider: 'mock' | 'gitlab' }
type SignInUser = Omit<SessionUser, 'id'> & { issuer?: string; subject?: string }
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

/** A cookie references a revocable record and its still-valid account/provider binding. */
export async function getSessionUser(event: H3Event): Promise<SessionUser | null> {
  if (event.context.campusworksUser !== undefined) return event.context.campusworksUser
  const token = await sealedToken(event)
  let user: SessionUser | null = null
  if (token) {
    const db = await getDb()
    const record = await db.collection<any>('authSessions').findOne({ _id: tokenHash(token), expiresAt: { $gt: new Date() }, revokedAt: null })
    const raw = record?.user
    if (raw && typeof raw.id === 'string' && validEmail(raw.email) && typeof raw.name === 'string' && PRIMARY_ROLES.includes(raw.primaryRole)) {
      const account = await db.collection<any>('users').findOne({ id: raw.id, email: raw.email, disabledAt: null })
      if (account && raw.provider === 'gitlab' && record.providerIdentityId) {
        const binding = await db.collection<any>('providerIdentities').findOne({ id: record.providerIdentityId, provider: 'gitlab', userId: raw.id, email: raw.email, revokedAt: null })
        if (binding && account.identityKind === 'gitlab') user = raw
      } else if (account && raw.provider === 'mock' && getServerConfig().mockLoginEnabled) {
        const binding = await db.collection<any>('providerIdentities').findOne({ $or: [{ userId: raw.id }, { email: raw.email }] })
        if (!binding && account.identityKind !== 'gitlab') user = raw
      }
    }
  }
  event.context.campusworksUser = user
  return user
}
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  return user
}

/** Institutional identities never attach to an existing account through email alone. */
export async function setSessionUser(event: H3Event, input: SignInUser): Promise<SessionUser> {
  if (typeof input.email !== 'string' || typeof input.name !== 'string' || input.name.length > 80 || !PRIMARY_ROLES.includes(input.primaryRole) || !['mock', 'gitlab'].includes(input.provider)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid sign-in profile' })
  }
  const email = normalizeEmail(input.email)
  if (!validEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  const config = getServerConfig()
  if (input.provider === 'mock' && !config.mockLoginEnabled) throw createError({ statusCode: 403, statusMessage: 'Demo sign-in is disabled' })
  const issuer = config.gitlab.baseUrl ? new URL(config.gitlab.baseUrl).toString().replace(/\/$/, '') : ''
  if (input.provider === 'gitlab' && (!issuer || input.issuer !== issuer || typeof input.subject !== 'string' || !/^[1-9][0-9]{0,15}$/.test(input.subject))) {
    throw createError({ statusCode: 502, statusMessage: 'Invalid institutional identity' })
  }
  const previous = await sealedToken(event)
  const token = randomBytes(32).toString('hex')
  const timestamp = new Date()
  let user: SessionUser | undefined
  // Concurrent first sign-ins for one identity converge on its unique binding.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      user = await withTransaction(async (db, session) => {
        const users = db.collection<any>('users')
        const identities = db.collection<any>('providerIdentities')
        let account: any
        let providerIdentityId: string | undefined
        if (input.provider === 'gitlab') {
          const key = { provider: 'gitlab', issuer, subject: input.subject! }
          const identity = await identities.findOne(key, { session })
          if (identity) {
            if (identity.revokedAt || identity.email !== email) throw createError({ statusCode: 403, statusMessage: 'Institutional identity changed; an administrator must review the account' })
            account = await users.findOne({ id: identity.userId, email, identityKind: 'gitlab', disabledAt: null }, { session })
            if (!account) throw createError({ statusCode: 403, statusMessage: 'Institutional account requires administrator review' })
            providerIdentityId = identity.id
          } else {
            if (await users.findOne({ email }, { session }) || await identities.findOne({ email }, { session })) {
              throw createError({ statusCode: 403, statusMessage: 'This email is already associated with an account; automatic account linking is disabled' })
            }
            account = { id: randomUUID(), email, name: input.name, identityKind: 'gitlab', createdAt: timestamp, updatedAt: timestamp }
            providerIdentityId = randomUUID()
            await users.insertOne(account, { session })
            await identities.insertOne({ ...key, id: providerIdentityId, userId: account.id, email, createdAt: timestamp, revokedAt: null }, { session })
          }
        } else {
          account = await users.findOne({ email }, { session })
          if (await identities.findOne(account ? { $or: [{ userId: account.id }, { email }] } : { email }, { session }) || account?.identityKind === 'gitlab') {
            throw createError({ statusCode: 403, statusMessage: 'Use institutional sign-in for this account' })
          }
          if (account?.disabledAt) throw createError({ statusCode: 403, statusMessage: 'This account requires administrator review' })
          if (account && !account.identityKind) {
            const institutionalHistory = await db.collection<any>('authSessions').findOne({ userId: account.id, 'user.provider': 'gitlab' }, { session, projection: { _id: 1 } })
            const demoHistory = await db.collection<any>('authSessions').findOne({ userId: account.id, 'user.provider': 'mock', expiresAt: { $gt: timestamp }, revokedAt: null }, { session, projection: { _id: 1 } })
            if (institutionalHistory || !demoHistory) throw createError({ statusCode: 403, statusMessage: 'Existing account identity requires administrator review' })
          }
          if (!account) {
            account = { id: randomUUID(), email, name: input.name, identityKind: 'mock', createdAt: timestamp, updatedAt: timestamp }
            await users.insertOne(account, { session })
          }
        }
        await users.updateOne({ id: account.id }, { $set: { name: input.name, updatedAt: timestamp, identityKind: input.provider } }, { session })
        const result: SessionUser = { id: account.id, email, name: input.name, provider: input.provider, primaryRole: input.primaryRole }
        if (previous) await db.collection<any>('authSessions').deleteOne({ _id: tokenHash(previous) }, { session })
        await db.collection<any>('authSessions').insertOne({
          _id: tokenHash(token), userId: result.id, user: result, ...(providerIdentityId ? { providerIdentityId } : {}),
          createdAt: timestamp, expiresAt: new Date(timestamp.getTime() + SESSION_MAX_AGE * 1000), revokedAt: null
        }, { session })
        await db.collection('auditEvents').insertOne({ actorId: result.id, action: 'SessionCreated', provider: input.provider, createdAt: timestamp }, { session })
        return result
      })
      break
    } catch (error: any) {
      if (error?.statusCode !== 409 || attempt === 2) throw error
    }
  }
  if (!user) throw createError({ statusCode: 503, statusMessage: 'Unable to establish a session' })
  const session = await useSession<SessionData>(event, sessionConfig(event))
  await session.update({ sid: token })
  event.context.campusworksUser = user
  return user
}
export async function clearSessionUser(event: H3Event) {
  const token = await sealedToken(event)
  if (token) {
    await withTransaction(async (db, session) => {
      const revoked = await db.collection<any>('authSessions').findOneAndDelete({ _id: tokenHash(token) }, { session })
      if (revoked) await db.collection('auditEvents').insertOne({ actorId: revoked.userId, action: 'SessionRevoked', createdAt: new Date() }, { session })
    })
  }
  for (const name of [SESSION_COOKIE, 'campusworks_user']) deleteCookie(event, name, { path: '/' })
  event.context.campusworksUser = null
}
export function isGlobalAdmin(user: SessionUser | null | undefined) {
  return !!user && ((user.provider === 'mock' && getServerConfig().mockLoginEnabled && user.primaryRole === 'admin') || getServerConfig().adminEmails.includes(user.email))
}
export function publicUser(user: SessionUser) {
  return { id: user.id, email: user.email, name: user.name, primaryRole: user.primaryRole, provider: user.provider, isGlobalAdmin: isGlobalAdmin(user) }
}
