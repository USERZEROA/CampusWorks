import { defineEventHandler, setResponseStatus } from 'h3'
import { getDb, verifyDatabaseReadiness } from '../utils/db'
export default defineEventHandler(async event => {
  try {
    const db = await getDb()
    await verifyDatabaseReadiness(db)
    return { status: 'ok', db: 'up', transactions: 'ready', indexes: 'ready' }
  } catch {
    setResponseStatus(event, 503)
    return { status: 'degraded', db: 'unavailable', transactions: 'unavailable', indexes: 'unavailable' }
  }
})
