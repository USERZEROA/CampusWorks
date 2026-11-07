import { defineEventHandler, readBody, createError } from 'h3'
import { assertEnrolled, assertCourseUnrestricted, cleanText, withCourseTransaction } from '../../../../utils/courses'
import { resumedPauseFields, parseEntryId } from '../../../../utils/queue'
export default defineEventHandler(event => withCourseTransaction(event, async (access, session) => {
  assertEnrolled(access)
  const body = await readBody(event) || {}
  if (body.action !== 'join' && body.action !== 'edit') throw createError({ statusCode: 400, statusMessage: 'action must be join or edit' })
  const expectedId = body.action === 'edit' ? parseEntryId(body.entryId) : null
  const location = cleanText(body.location, 200)
  const question = cleanText(body.question, 1000)
  if (!location) throw createError({ statusCode: 400, statusMessage: 'location required' })
  const { db, course, courseKey, user } = access
  await assertCourseUnrestricted(db, courseKey, user.email, session)
  const coll = db.collection('queueEntries')
  const filter = { courseId: courseKey, studentEmail: user.email }
  const existing = await coll.findOne(filter, { session })
  if (body.action === 'edit' && (!existing || !existing._id.equals(expectedId!))) throw createError({ statusCode: 409, statusMessage: 'Your queue entry changed; refresh before editing' })
  if (course.state === 'closed' || (!existing && course.state !== 'open')) throw createError({ statusCode: 409, statusMessage: 'Queue is not open for new entries' })
  if (existing) {
    if (body.action === 'join') return { ok: true }
    await coll.updateOne({ _id: existing._id }, {
      $set: { location, question, studentName: user.name, ...resumedPauseFields(existing) }, $unset: { pauseStartedAt: '' }, $inc: { revision: 1 }
    }, { session })
  } else {
    if (await coll.countDocuments({ courseId: courseKey }, { session, limit: 500 }) >= 500) throw createError({ statusCode: 409, statusMessage: 'Queue capacity reached' })
    const last = await coll.find({ courseId: courseKey }, { session }).sort({ position: -1 }).limit(1).next()
    const position = Math.max(Number(course.queueSequence) || 0, Number(last?.position) || 0) + 1
    await db.collection('courses').updateOne({ _id: course._id }, { $set: { queueSequence: position } }, { session })
    await coll.insertOne({ ...filter, location, question, studentName: user.name, paused: false, pausedBeforeHelpMs: 0, position, createdAt: new Date(), helpSegments: [], revision: 0 }, { session })
  }
  return { ok: true }
}))
