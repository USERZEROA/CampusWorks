// server/api/health.get.ts
import { defineEventHandler, setResponseStatus } from 'h3'
import { getDb } from '../utils/db'

/**
 * GET /api/health
 * Readiness check for Docker / Kubernetes: 200 when MongoDB answers a ping,
 * 503 otherwise.
 */
export default defineEventHandler(async (event) => {
  try {
    const db = await getDb()
    await db.command({ ping: 1 })
    return { status: 'ok', db: 'up' }
  } catch {
    setResponseStatus(event, 503)
    return { status: 'degraded', db: 'down' }
  }
})
