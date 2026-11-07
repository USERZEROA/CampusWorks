// server/api/courses/[id]/state.patch.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { assertStaff, getCourseAccess } from '../../../utils/courses'
import { archiveAllEntries } from '../../../utils/queue'

type QueueState = 'open' | 'paused' | 'closed'

/**
 * PATCH /api/courses/[id]/state
 *
 * Update queue state for a course (open / paused / closed). Course staff only.
 * Closing the queue ends the session: on-duty staff are cleared and every
 * remaining entry is archived to help sessions (nothing is silently dropped).
 *
 * Body: { state: 'open' | 'paused' | 'closed' }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ state?: QueueState }>(event)) || {}
  const { state } = body

  if (!state || !['open', 'paused', 'closed'].includes(state)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid state' })
  }

  const update: { state: QueueState; onDutyTAs?: [] } = { state }
  let archived = 0

  if (state === 'closed') {
    update.onDutyTAs = []
    archived = await archiveAllEntries(access.db, access.courseKey, {
      reason: 'queue-closed',
      endedBy: access.user.email
    })
  }

  await access.db.collection('courses').updateOne({ _id: access.course._id }, { $set: update })

  return { ok: true, archived }
})
