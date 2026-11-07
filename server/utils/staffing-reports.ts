import type { ClientSession, Db } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { aiStatus } from './ai'
import { lockStaffingResource } from './staffing-catalog'
import { actorId, canManageOpportunity, event, fail, findOpportunity, manualCourseManager, number, object, publicRecord, staffingCourseAliases, text, uid, type StaffingActor } from './staffing'
import { getRecruitmentCycle } from './staffing-cycle'
import { withTransaction } from './db'

export async function recordWorkload(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  const body = object(raw, 'Workload observation')
  const appointmentId = text(body.appointmentId, 'Appointment', 64, true)
  const appointment = await db.collection('staffingAppointments').findOne({ id: appointmentId }, { session }) || fail(404, 'Appointment not found')
  await lockStaffingResource(db, appointment, session)
  const owns = appointment.applicantId === actorId(user)
  const manager = await canManageOpportunity(db, await findOpportunity(db, appointment.opportunityId, session), user, session)
  if (!owns && !manager && !isGlobalAdmin(user)) fail(403, 'Only the appointed worker or authorized manager may record workload')
  if (appointment.type !== 'ta') fail(409, 'Workload observations are available only for teaching appointments')
  if (appointment.status !== 'active' || appointment.startDate > new Date() || appointment.endDate <= new Date()) fail(409, 'Workload can be recorded only during an active appointment')
  const dateText = text(body.date, 'Work date', 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) fail(400, 'Work date must use YYYY-MM-DD')
  const observedDate = new Date(`${dateText}T12:00:00Z`)
  if (!Number.isFinite(observedDate.getTime()) || observedDate.toISOString().slice(0, 10) !== dateText || dateText > new Date().toISOString().slice(0, 10) || dateText < appointment.startDate.toISOString().slice(0, 10) || dateText > appointment.endDate.toISOString().slice(0, 10)) fail(400, 'Work date must be within the appointment and cannot be in the future (UTC dates)')
  const kind = text(body.kind, 'Work category', 30, true)
  if (!['attendance', 'lab', 'discussion', 'grading', 'office_hours', 'preparation', 'coordination'].includes(kind)) fail(400, 'Unknown teaching work category')
  const hours = number(body.hours, 'Hours', 0.05, 24)
  const notes = text(body.notes, 'Work notes', 2000)
  const idempotencyKey = text(body.idempotencyKey, 'Idempotency key', 128)
  if (idempotencyKey) {
    const existing = await db.collection('staffingWorkload').findOne({ appointmentId, idempotencyKey }, { session })
    if (existing) {
      if (existing.date !== dateText || existing.kind !== kind || existing.hours !== hours || existing.notes !== notes || existing.authorEmail !== user.email) fail(409, 'Idempotency key was already used for a different workload observation')
      return { record: publicRecord(existing), replayed: true }
    }
  }
  const daily = await db.collection('staffingWorkload').find({ appointmentId, date: dateText }, { session }).toArray()
  if (daily.reduce((sum, r) => sum + r.hours, 0) + hours > 24) fail(400, 'Recorded hours cannot exceed 24 in one day')
  const record = { id: uid(), appointmentId, ...(idempotencyKey ? { idempotencyKey } : {}), opportunityId: appointment.opportunityId, courseId: appointment.courseId, termId: appointment.termId, applicantId: appointment.applicantId, kind, hours, date: dateText, notes, authorEmail: user.email, source: 'self-reported', createdAt: new Date() }
  await db.collection('staffingWorkload').insertOne(record, { session })
  await event(db, session, user, 'WorkloadRecorded', appointmentId, { recordId: record.id })
  return { record: publicRecord(record) }
}

export async function courseReview(db: Db, user: StaffingActor, courseId: string, termId: string, page = 1, session?: ClientSession): Promise<any> {
  if (!session) return withTransaction((database, snapshot) => courseReview(database, user, courseId, termId, page, snapshot))
  if (!await manualCourseManager(db, courseId, user, session)) fail(403, 'Course managers review term reports')
  const course = await db.collection('courses').findOne({ id: courseId }, { session }) || fail(404, 'Course not found')
  const currentCycle = await getRecruitmentCycle(db, session)
  if (!termId) termId = currentCycle.termId || fail(409, 'An administrator must select the current recruitment semester')
  const term = termId ? await db.collection('staffingTerms').findOne({ id: termId }, { session }) : null
  if (termId && !term) fail(404, 'Term not found')
  const dateFilter = term ? { $gte: term.startDate, $lt: term.endDate } : undefined
  const sessionFilter = { courseId, ...(dateFilter ? { joinedAt: dateFilter } : {}) }
  const linkedCourse = { $in: await staffingCourseAliases(db, courseId, session) }
  const opportunityFilter = { courseId: linkedCourse, type: 'ta', ...(termId ? { termId } : {}) }
  const teachingOpportunityIds = await db.collection('staffingOpportunities').distinct('id', opportunityFilter, { session })
  // Historical observations have no position type; use their linked posting.
  const workloadFilter = { courseId: linkedCourse, opportunityId: { $in: teachingOpportunityIds }, ...(termId ? { termId } : {}) }
  const waitFilter = { ...sessionFilter, wasHelped: true, waitMinutes: { $type: 'number', $gte: 0 } }
  const offset = (page - 1) * 100
  // Every aggregate and detail query observes the same database snapshot.
  const sessionStats = await db.collection('helpSessions').aggregate([{ $match: sessionFilter }, { $group: { _id: null, sessions: { $sum: 1 }, helped: { $sum: { $cond: ['$wasHelped', 1, 0] } }, recordedHelpMinutes: { $sum: { $ifNull: ['$helpMinutes', 0] } } } }], { session }).next()
  const feedbackStats = await db.collection('feedback').aggregate([{ $match: { courseId, ...(dateFilter ? { createdAt: dateFilter } : {}) } }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } }], { session }).next()
  const workloadGroups = await db.collection('staffingWorkload').aggregate([{ $match: workloadFilter }, { $group: { _id: '$kind', hours: { $sum: '$hours' } } }], { session }).toArray()
  const records = await db.collection('staffingWorkload').find(workloadFilter, { session }).sort({ date: -1, createdAt: -1, id: 1 }).skip(offset).limit(100).toArray()
  const recordCount = await db.collection('staffingWorkload').countDocuments(workloadFilter, { session })
  const approvedPlan = { $and: [{ $eq: ['$approved', true] }, { $in: ['$status', ['published', 'applications_closed', 'filled', 'archived']] }] }
  const requestedPlan = { $and: [{ $not: [approvedPlan] }, { $not: [{ $in: ['$status', ['cancelled', 'archived']] }] }] }
  const opportunityStats = await db.collection('staffingOpportunities').aggregate([{ $match: opportunityFilter }, { $group: { _id: null, count: { $sum: 1 }, requestedBudget: { $sum: { $cond: [requestedPlan, '$budget', 0] } }, approvedBudget: { $sum: { $cond: [approvedPlan, '$budget', 0] } } } }], { session }).next()
  const appointments = await db.collection('staffingAppointments').aggregate([{ $match: { courseId: linkedCourse, type: 'ta', termId } }, { $group: { _id: null, committedBudget: { $sum: { $cond: [{ $not: [{ $in: [{ $ifNull: ['$budgetStatus', 'reserved'] }, ['settled', 'released']] }] }, '$committedCost', 0] } }, settledBudget: { $sum: { $cond: [{ $eq: ['$budgetStatus', 'settled'] }, '$incurredCost', 0] } } } }], { session }).next()
  const opportunities = await db.collection('staffingOpportunities').find(opportunityFilter, { session }).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray()
  const waitStats = await db.collection('helpSessions').aggregate([{ $match: waitFilter }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$waitMinutes' } } }], { session }).next()
  const percentile = waitStats?.count ? await db.collection('helpSessions').find(waitFilter, { session }).sort({ waitMinutes: 1, _id: 1 }).skip(Math.ceil(waitStats.count * .9) - 1).limit(1).next() : null
  const byKind = Object.fromEntries(workloadGroups.map(row => [row._id, row.hours]))
  const scenarios = opportunities.flatMap(o => [o.positions - 1, o.positions, o.positions + 1].filter(n => n >= 0).map(positions => ({ opportunityId: o.id, positions, weeklyHours: o.weeklyHours, weeks: o.weeks, hourlyRate: o.hourlyRate, estimatedCost: Math.round(positions * o.appointmentCost * 100) / 100, budgetCovered: positions * o.appointmentCost <= o.budget, coverageValidated: false })))
  return {
    course: { id: course.id, code: course.code, title: course.title }, termId: termId || null, currentCycle,
    metrics: { sessions: sessionStats?.sessions || 0, helped: sessionStats?.helped || 0, avgWaitMinutes: waitStats?.average ?? null, p90WaitMinutes: percentile?.waitMinutes ?? null, recordedHelpMinutes: sessionStats?.recordedHelpMinutes || 0, feedbackCount: feedbackStats?.count || 0, feedbackAverage: feedbackStats?.average ?? null },
    workload: { totalHours: workloadGroups.reduce((sum, w) => sum + w.hours, 0), byKind, count: recordCount, records: records.map(publicRecord), source: 'self-reported; not payroll evidence' },
    budget: { requestedBudget: opportunityStats?.requestedBudget || 0, approvedBudget: opportunityStats?.approvedBudget || 0, committedBudget: appointments?.committedBudget || 0, settledBudget: appointments?.settledBudget || 0, opportunities: opportunities.map(o => ({ id: o.id, title: o.title, positions: o.positions, budget: o.budget, approved: o.approved, status: o.status, committedBudget: o.committedBudget })), scenarios },
    missingEvidence: ['Complete observation coverage is not established.', 'Self-reported workload does not prove paid hours.', 'Lab, grading, attendance and deadline coverage require instructor validation.', 'Cost scenarios do not establish that lower staffing will meet demand.'],
    pagination: { page, limit: 100, totals: { workload: recordCount, opportunities: opportunityStats?.count || 0 }, hasMore: recordCount > offset + 100 || (opportunityStats?.count || 0) > offset + 100 },
    aggregateCoverage: 'All matching database records; detail rows are independently paged.',
    ai: aiStatus()
  }
}

