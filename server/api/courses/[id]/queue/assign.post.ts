import { defineEventHandler, readBody, createError } from 'h3'
import { assertOnDuty, withCourseTransaction, staffLabel } from '../../../../utils/courses'
import { parseEntryId, releaseEntry, releaseStaffClaims } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertOnDuty(access)
  const body = await readBody(event) || {}
  const _id = parseEntryId(body.entryId)
  if (body.assign !== true && body.assign !== false && body.assign !== 'other') throw createError({ statusCode: 400, statusMessage: 'assign must be true, false or other' })
  const { db, courseKey, user } = access
  const coll = db.collection('queueEntries')
  const entry = await coll.findOne({ _id, courseId: courseKey }, { session })
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  if (body.assign === true) {
    if (entry.studentEmail === user.email) throw createError({ statusCode: 400, statusMessage: 'A staff member cannot claim their own help request' })
    if (entry.paused) throw createError({ statusCode: 409, statusMessage: 'Entry is paused' })
    if (entry.taEmail === user.email && !entry.otherTa) return { ok: true }
    await releaseStaffClaims(db, courseKey, user.email, session)
    if (entry.taEmail) await releaseEntry(db, entry, session)
    const now = new Date()
    await coll.updateOne({ _id }, { $set: {
      ta: staffLabel(user), taEmail: user.email, otherTa: false, activeHelpStartAt: now,
      ...(!entry.helpStartAt ? { helpStartAt: now } : {})
    } }, { session })
  } else {
    if (entry.taEmail !== user.email) throw createError({ statusCode: 403, statusMessage: 'Only the current helper can release or hand off this entry' })
    await releaseEntry(db, entry, session, body.assign === 'other')
  }
  return { ok: true }
}))
