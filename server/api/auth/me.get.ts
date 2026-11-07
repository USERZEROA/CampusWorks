// server/api/auth/me.get.ts
import { defineEventHandler } from 'h3'
import { publicUser, requireUser } from '../../utils/auth'

/**
 * GET /api/auth/me
 * Returns the signed-in user, or 401 when there is no valid session.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { user: publicUser(user) }
})
