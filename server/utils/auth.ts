// server/utils/auth.ts
import type { H3Event } from 'h3'
import {
  createError,
  deleteCookie,
  getCookie,
  getRequestProtocol,
  unsealSession,
  useSession
} from 'h3'
import type { SessionConfig } from 'h3'
import { getServerConfig } from './config'

export type PrimaryRole = 'student' | 'ta' | 'instructor' | 'admin'

export type SessionUser = {
  email: string
  name: string
  primaryRole: PrimaryRole
  provider: 'mock' | 'gitlab'
}

type SessionData = { user?: SessionUser }

const SESSION_COOKIE = 'campusworks_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

/** Short-lived cookie holding the OAuth `state` value (CSRF protection). */
export const OAUTH_STATE_COOKIE = 'campusworks_oauth_state'

// Cookies written by older versions (plain, unsigned JSON). Never trusted.
const LEGACY_COOKIES = ['campusworks_user']

const PRIMARY_ROLES: PrimaryRole[] = ['student', 'ta', 'instructor', 'admin']

function sessionConfig(event: H3Event): SessionConfig {
  return {
    name: SESSION_COOKIE,
    password: getServerConfig().sessionSecret,
    maxAge: SESSION_MAX_AGE,
    sessionHeader: false,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: getRequestProtocol(event) === 'https'
    }
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

const toSessionUser = (raw: any): SessionUser | null => {
  if (!raw || typeof raw.email !== 'string' || !raw.email.includes('@')) {
    return null
  }
  return {
    email: normalizeEmail(raw.email),
    name: String(raw.name || raw.email).trim(),
    primaryRole: PRIMARY_ROLES.includes(raw.primaryRole) ? raw.primaryRole : 'student',
    provider: raw.provider === 'gitlab' ? 'gitlab' : 'mock'
  }
}

/**
 * The signed-in user for this request, or null.
 * The session cookie is sealed (encrypted + signed), so it cannot be forged.
 */
export async function getSessionUser(event: H3Event): Promise<SessionUser | null> {
  if (event.context.campusworksUser !== undefined) return event.context.campusworksUser

  let user: SessionUser | null = null
  const sealed = getCookie(event, SESSION_COOKIE)
  if (sealed) {
    try {
      const session = await unsealSession(event, sessionConfig(event), sealed)
      user = toSessionUser((session.data as SessionData | undefined)?.user)
    } catch {
      user = null // tampered or expired
    }
  }

  event.context.campusworksUser = user
  return user
}

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  return user
}

export async function setSessionUser(event: H3Event, user: SessionUser) {
  const session = await useSession<SessionData>(event, sessionConfig(event))
  await session.update({ user })
  event.context.campusworksUser = user
}

export function clearSessionUser(event: H3Event) {
  for (const name of [SESSION_COOKIE, ...LEGACY_COOKIES]) {
    deleteCookie(event, name, { path: '/' })
  }
  event.context.campusworksUser = null
}

/**
 * Global (site-wide) admin: may create/delete courses and has staff rights
 * in every course. Granted by the mock "admin" role or by ADMIN_EMAILS.
 */
export function isGlobalAdmin(user: SessionUser | null | undefined) {
  if (!user) return false
  return (
    user.primaryRole === 'admin' ||
    getServerConfig().adminEmails.includes(user.email)
  )
}

export function publicUser(user: SessionUser) {
  return {
    email: user.email,
    name: user.name,
    primaryRole: user.primaryRole,
    provider: user.provider,
    isGlobalAdmin: isGlobalAdmin(user)
  }
}
