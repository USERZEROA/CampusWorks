import { MongoClient, type ClientSession, type Db, type IndexDescription } from 'mongodb'
import { createError } from 'h3'
import { getServerConfig } from './config'
import { seedDemoDataIfEmpty } from './seed'

let dbPromise: Promise<Db> | null = null
let connectedClient: MongoClient | null = null

/** Transactions and mandatory indexes are prerequisites for serving application data. */
export function getDb(): Promise<Db> {
  dbPromise ||= connect().catch((error) => { dbPromise = null; throw error })
  return dbPromise
}

async function connect(): Promise<Db> {
  const config = getServerConfig()
  if (!config.mongodbUri) throw createError({ statusCode: 503, statusMessage: 'MONGODB_URI is not configured' })
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 5000 })
  try {
    await client.connect()
    const db = client.db(config.mongodbDb)
    const topology = await db.admin().command({ hello: 1 })
    if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('A MongoDB replica set or sharded cluster is required for transactions')
    await ensureIndexes(db)
    const { initializeStaffingIndexes } = await import('./staffing')
    await initializeStaffingIndexes(db)
    if (config.seedDemoData) {
      await client.withSession(async session => {
        await session.withTransaction(() => seedDemoDataIfEmpty(db, session), {
          readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary'
        })
      })
    }
    connectedClient = client
    return db
  } catch (error) {
    await client.close().catch(() => {})
    console.error('[campusworks] Database initialization failed:', (error as Error).message)
    throw createError({ statusCode: 503, statusMessage: 'Database initialization failed; verify replica set and required indexes' })
  }
}

/** The driver retries transient conflicts; no external side effect belongs in this callback. */
export async function withTransaction<T>(work: (db: Db, session: ClientSession) => Promise<T>): Promise<T> {
  const db = await getDb()
  const session = connectedClient!.startSession()
  try {
    return await session.withTransaction(() => work(db, session), {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
      maxCommitTimeMS: 10_000, timeoutMS: 30_000
    }) as T
  } catch (error: any) {
    if (error?.code === 11000) throw createError({ statusCode: 409, statusMessage: 'A conflicting record already exists' })
    if (error?.hasErrorLabel?.('TransientTransactionError') || error?.code === 50) {
      throw createError({ statusCode: 409, statusMessage: 'The record changed; refresh and try again' })
    }
    throw error
  } finally { await session.endSession() }
}

const mandatoryIndexes: Record<string, IndexDescription[]> = {
    courses: [{ key: { id: 1 }, unique: true }],
    enrollments: [{ key: { courseId: 1, userEmail: 1 }, unique: true }, { key: { userEmail: 1 } }],
    queueEntries: [
      { key: { courseId: 1, studentEmail: 1 }, unique: true }, { key: { courseId: 1, position: 1 } },
      { key: { courseId: 1, taEmail: 1 }, unique: true, partialFilterExpression: { taEmail: { $type: 'string' } } }
    ],
    helpSessions: [
      { key: { courseId: 1, joinedAt: -1 } },
      { key: { entryId: 1 }, unique: true, partialFilterExpression: { entryId: { $type: 'string' } } }
    ],
    announcements: [{ key: { courseId: 1, createdAt: -1 } }],
    feedback: [{ key: { courseId: 1, createdAt: -1 } }],
    users: [{ key: { id: 1 }, unique: true }, { key: { email: 1 }, unique: true }],
    authSessions: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }, { key: { userId: 1 } }],
    requestLimits: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
    auditEvents: [{ key: { courseId: 1, createdAt: -1 } }]
  }
async function ensureIndexes(db: Db) {
  for (const [name, specs] of Object.entries(mandatoryIndexes)) await db.collection(name).createIndexes(specs)
}

/** Readiness checks verify the live constraints rather than reporting only a ping. */
export async function verifyDatabaseReadiness(db: Db) {
  const topology = await db.admin().command({ hello: 1 })
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('Transaction-capable topology is unavailable')
  const required: Record<string, IndexDescription[]> = { ...mandatoryIndexes, staffingAllocations: [{ key: { termId: 1, applicantId: 1 }, unique: true }] }
  for (const [name, specs] of Object.entries(required)) {
    const actual = await db.collection(name).listIndexes().toArray()
    for (const spec of specs) {
      const index = actual.find(index => JSON.stringify(index.key) === JSON.stringify(spec.key))
      if (!index || (!!spec.unique && !index.unique) || JSON.stringify(spec.partialFilterExpression || null) !== JSON.stringify(index.partialFilterExpression || null) || (spec.expireAfterSeconds !== undefined && spec.expireAfterSeconds !== index.expireAfterSeconds)) throw new Error('A required database index is unavailable')
    }
  }
}

