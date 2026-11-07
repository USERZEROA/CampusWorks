// server/api/auth/mock.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { getServerConfig } from '../../utils/config'
import { normalizeEmail, publicUser, setSessionUser, type PrimaryRole } from '../../utils/auth'
import { DEMO_USERS, findDemoAccount } from '../../utils/seed'

const ROLES: PrimaryRole[] = ['student', 'ta', 'instructor', 'admin']

/**
 * POST /api/auth/mock
 *
 * Demo login: signs in as one of the demo accounts, or as any email with the
 * chosen role. Only available when ENABLE_MOCK_LOGIN is on (default in dev).
 *
 * Body: { as?: 'student' | 'ta' | 'instructor' | 'admin'; email?: string; name?: string }
 */
export default defineEventHandler(async (event) => {
  if (!getServerConfig().mockLoginEnabled) {
    throw createError({ statusCode: 404, statusMessage: 'Mock login is disabled' })
  }

  const body = (await readBody<{ as?: string; email?: string; name?: string }>(event)) || {}
  const role = (body.as || 'student') as PrimaryRole

  if (!ROLES.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
  }

  let email: string = DEMO_USERS[role].email
  let name: string = DEMO_USERS[role].name

  if (body.email?.trim()) {
    email = normalizeEmail(body.email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
    }
    // Known demo accounts keep their display name (e.g. "TA Two").
    name = (body.name || findDemoAccount(email)?.name || email.split('@')[0] || email)
      .trim()
      .slice(0, 80)
  }

  const user = { email, name, primaryRole: role, provider: 'mock' as const }
  await setSessionUser(event, user)

  return { ok: true, user: publicUser(user) }
})
