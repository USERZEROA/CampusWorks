// server/utils/db.ts
import { MongoClient, type Db } from 'mongodb'
import { createError } from 'h3'
import { getServerConfig } from './config'
import { seedDemoDataIfEmpty } from './seed'

let dbPromise: Promise<Db> | null = null

/**
 * Get a shared MongoDB database instance.
 * Connects lazily on first use, ensures indexes once, and optionally seeds
 * demo data. A failed connection is retried on the next call.
 */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = connect().catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

async function connect(): Promise<Db> {
  const { mongodbUri, mongodbDb, seedDemoData } = getServerConfig()

  if (!mongodbUri) {
    throw createError({
      statusCode: 500,
      statusMessage: 'MONGODB_URI is not configured'
    })
  }

  const client = new MongoClient(mongodbUri, {
    serverSelectionTimeoutMS: 5000
  })

  try {
    await client.connect()
  } catch (err) {
    await client.close().catch(() => {})
    console.error('[campusworks] MongoDB connection failed:', (err as Error).message)
    throw createError({
      statusCode: 503,
      statusMessage: 'Database unavailable'
    })
  }

  const db = client.db(mongodbDb)
  await ensureIndexes(db)

  if (seedDemoData) {
    await seedDemoDataIfEmpty(db)
  }

  return db
}

/**
 * Indexes back the "one entry per student" and "one enrollment per user"
 * invariants. Failures (e.g. legacy duplicate rows) are logged, not fatal.
 */
async function ensureIndexes(db: Db) {
  const specs: Array<[string, Record<string, 1 | -1>, { unique?: boolean }?]> = [
    ['courses', { id: 1 }, { unique: true }],
    ['enrollments', { courseId: 1, userEmail: 1 }, { unique: true }],
    ['enrollments', { userEmail: 1 }],
    ['queueEntries', { courseId: 1, studentEmail: 1 }, { unique: true }],
    ['queueEntries', { courseId: 1, position: 1 }],
    ['helpSessions', { courseId: 1, joinedAt: -1 }],
    ['announcements', { courseId: 1, createdAt: -1 }],
    ['feedback', { courseId: 1, createdAt: -1 }]
  ]

  for (const [collection, keys, options] of specs) {
    try {
      await db.collection(collection).createIndex(keys, options || {})
    } catch (err) {
      console.warn(
        `[campusworks] Could not create index on ${collection} ${JSON.stringify(keys)}:`,
        (err as Error).message
      )
    }
  }
}
