// server/api/auth/logout.post.ts
import { defineEventHandler } from 'h3'
import { clearSessionUser } from '../../utils/auth'

/**
 * POST /api/auth/logout
 * Clears the session cookie (and any legacy cookie from older versions).
 */
export default defineEventHandler((event) => {
  clearSessionUser(event)
  return { ok: true }
})
