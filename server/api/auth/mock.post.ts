import { defineEventHandler, readBody, createError } from 'h3'
import { getServerConfig } from '../../utils/config'
import { normalizeEmail, publicUser, setSessionUser, validEmail, type PrimaryRole } from '../../utils/auth'
import { DEMO_USERS, findDemoAccount } from '../../utils/seed'
const ROLES: PrimaryRole[] = ['student', 'ta', 'instructor', 'admin']
export default defineEventHandler(async event => {
  if (!getServerConfig().mockLoginEnabled) throw createError({ statusCode: 404, statusMessage: 'Mock login is disabled' })
  const body = await readBody(event) || {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Expected an object' })
  const role = body.as === undefined ? 'student' : body.as
  if (!ROLES.includes(role)) throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
  const demo = DEMO_USERS[role as PrimaryRole]
  if (body.email !== undefined && typeof body.email !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  if (body.name !== undefined && typeof body.name !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid name' })
  const email = body.email?.trim() ? normalizeEmail(body.email) : demo.email
  if (!validEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  const name = (body.name?.trim() || findDemoAccount(email)?.name || email.split('@')[0] || email).slice(0, 80)
  const user = await setSessionUser(event, { email, name, primaryRole: role, provider: 'mock' })
  return { ok: true, user: publicUser(user) }
})
