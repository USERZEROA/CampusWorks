// server/api/courses/[id]/queue/remove.post.ts
import { defineEventHandler, readBody } from 'h3'
import { assertStaff, getCourseAccess, staffLabel } from '../../../../utils/courses'
import { archiveEntry, parseEntryId } from '../../../../utils/queue'

/**
 * POST /api/courses/[id]/queue/remove
 *
 * Staff-only: finish ("Complete") or remove a queue entry and record it in
 * `helpSessions`. Idempotent: an entry that is already gone is not an error,
 * so two TAs clicking at once cannot create duplicate sessions.
 *
 * Body: { entryId: string }
 */
export default defineEventHandler(async (event) => {
  const access = await getCourseAccess(event)
  assertStaff(access)

  const body = (await readBody<{ entryId?: string }>(event)) || {}
  const _id = parseEntryId(body.entryId)

  const archived = await archiveEntry(
    access.db,
    { _id, courseId: access.courseKey },
    {
      reason: 'completed',
      endedBy: access.user.email,
      fallbackTa: { email: access.user.email, name: staffLabel(access.user) }
    }
  )

  return { ok: true, removed: !!archived }
})
