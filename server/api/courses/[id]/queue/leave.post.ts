// server/api/courses/[id]/queue/leave.post.ts
import { defineEventHandler } from 'h3'
import { getCourseAccess } from '../../../../utils/courses'
import { archiveEntry } from '../../../../utils/queue'

/**
 * POST /api/courses/[id]/queue/leave
 *
 * Removes the caller's queue entry and records it in help sessions.
 * Idempotent: returns { ok: true } even if there is no entry.
 */
export default defineEventHandler(async (event) => {
  const { db, courseKey, user } = await getCourseAccess(event)

  await archiveEntry(
    db,
    { courseId: courseKey, studentEmail: user.email },
    { reason: 'left', endedBy: user.email }
  )

  return { ok: true }
})
