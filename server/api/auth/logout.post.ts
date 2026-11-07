import { defineEventHandler } from 'h3'
import { clearSessionUser } from '../../utils/auth'
export default defineEventHandler(async event => {
  await clearSessionUser(event)
  return { ok: true }
})
