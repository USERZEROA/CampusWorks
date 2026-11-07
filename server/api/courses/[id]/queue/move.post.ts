import { defineEventHandler, readBody, createError } from 'h3'
import { assertOnDuty, withCourseTransaction } from '../../../../utils/courses'
import { parseEntryId } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertOnDuty(access)
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  if (!['up', 'down'].includes(body.direction)) throw createError({ statusCode: 400, statusMessage: 'direction must be up or down' })
  const coll = access.db.collection('queueEntries')
  const rows = await coll.find({ courseId: access.courseKey }, { session }).sort({ position: 1, createdAt: 1, _id: 1 }).toArray()
  const index = rows.findIndex(row => row._id.equals(_id))
  const neighbor = index + (body.direction === 'up' ? -1 : 1)
  if (index < 0 || neighbor < 0 || neighbor >= rows.length) return { ok: true }
  ;[rows[index], rows[neighbor]] = [rows[neighbor]!, rows[index]!]
  await coll.bulkWrite(rows.map((row, position) => ({ updateOne: { filter: { _id: row._id }, update: { $set: { position: position + 1 } } } })), { session })
  return { ok: true }
}))
