// server/api/[...slug].ts
import { defineEventHandler, createError } from 'h3'

/**
 * Unknown /api/* routes return a JSON 404 instead of falling through to the
 * page renderer (which would redirect API clients to the login page).
 */
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'API route not found' })
})
