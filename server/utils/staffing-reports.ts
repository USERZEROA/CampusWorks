import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { aiStatus } from './ai'
import { lockStaffingResource } from './staffing-catalog'
import { actorId, appointmentDto, event, fail, manualCourseManager, number, object, publicRecord, text, uid, type StaffingActor } from './staffing'

export async function recordWorkload(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  const body = object(raw, 'Workload observation')
  const appointmentId = text(body.appointmentId, 'Appointment', 64, true)
  const appointment = await db.collection('staffingAppointments').findOne({ id: appointmentId }, { session }) || fail(404, 'Appointment not found')
  await lockStaffingResource(db, appointment, session)
  const owns = appointment.applicantId === actorId(user)
  const manager = appointment.type === 'ta' ? await manualCourseManager(db, appointment.courseId, user, session) : !!await db.collection('researchProjects').findOne({ id: appointment.projectId, $or: [{ ownerEmail: user.email }, { reviewerEmails: user.email }] }, { session })
  if (!owns && !manager && !isGlobalAdmin(user)) fail(403, 'Only the appointed worker or authorized manager may record workload')
  if (appointment.status !== 'active' || appointment.startDate > new Date() || appointment.endDate <= new Date()) fail(409, 'Workload can be recorded only during an active appointment')
  const dateText = text(body.date, 'Work date', 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) fail(400, 'Work date must use YYYY-MM-DD')
  const observedDate = new Date(`${dateText}T12:00:00Z`)
  if (!Number.isFinite(observedDate.getTime()) || observedDate.toISOString().slice(0, 10) !== dateText || dateText > new Date().toISOString().slice(0, 10) || dateText < appointment.startDate.toISOString().slice(0, 10) || dateText > appointment.endDate.toISOString().slice(0, 10)) fail(400, 'Work date must be within the appointment and cannot be in the future (UTC dates)')
  const kind = text(body.kind, 'Work category', 30, true)
  if (!['attendance', 'lab', 'discussion', 'grading', 'office_hours', 'preparation', 'coordination', 'research'].includes(kind)) fail(400, 'Unknown work category')
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
  const record = { id: uid(), appointmentId, ...(idempotencyKey ? { idempotencyKey } : {}), opportunityId: appointment.opportunityId, courseId: appointment.courseId, projectId: appointment.projectId, termId: appointment.termId, applicantId: appointment.applicantId, kind, hours, date: dateText, notes, authorEmail: user.email, source: 'self-reported', createdAt: new Date() }
  await db.collection('staffingWorkload').insertOne(record, { session })
  await event(db, session, user, 'WorkloadRecorded', appointmentId, { recordId: record.id })
  return { record: publicRecord(record) }
}

export async function courseReview(db: Db, user: StaffingActor, courseId: string, termId: string, page = 1) {
  if (!await manualCourseManager(db, courseId, user)) fail(403, 'Course managers review term reports')
  const course = await db.collection('courses').findOne({ id: courseId }) || fail(404, 'Course not found')
  const term = termId ? await db.collection('staffingTerms').findOne({ id: termId }) : null
  if (termId && !term) fail(404, 'Term not found')
  const dateFilter = term ? { $gte: term.startDate, $lt: term.endDate } : undefined
  const sessionFilter = { courseId, ...(dateFilter ? { joinedAt: dateFilter } : {}) }
  const workloadFilter = { courseId, ...(termId ? { termId } : {}) }
  const opportunityFilter = { courseId, ...(termId ? { termId } : {}) }
  const waitFilter = { ...sessionFilter, wasHelped: true, waitMinutes: { $type: 'number', $gte: 0 } }
  const offset = (page - 1) * 100
  const [sessionStats, feedbackStats, workloadGroups, records, recordCount, opportunityStats, opportunities, waitStats] = await Promise.all([
    db.collection('helpSessions').aggregate([{ $match: sessionFilter }, { $group: { _id: null, sessions: { $sum: 1 }, helped: { $sum: { $cond: ['$wasHelped', 1, 0] } }, recordedHelpMinutes: { $sum: { $ifNull: ['$helpMinutes', 0] } } } }]).next(),
    db.collection('feedback').aggregate([{ $match: { courseId, ...(dateFilter ? { createdAt: dateFilter } : {}) } }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } }]).next(),
    db.collection('staffingWorkload').aggregate([{ $match: workloadFilter }, { $group: { _id: '$kind', hours: { $sum: '$hours' } } }]).toArray(),
    db.collection('staffingWorkload').find(workloadFilter).sort({ date: -1, createdAt: -1, id: 1 }).skip(offset).limit(100).toArray(),
    db.collection('staffingWorkload').countDocuments(workloadFilter),
    db.collection('staffingOpportunities').aggregate([{ $match: opportunityFilter }, { $group: { _id: null, count: { $sum: 1 }, approvedBudget: { $sum: '$budget' }, committedBudget: { $sum: '$committedBudget' } } }]).next(),
    db.collection('staffingOpportunities').find(opportunityFilter).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray(),
    db.collection('helpSessions').aggregate([{ $match: waitFilter }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$waitMinutes' } } }]).next()
  ])
  const percentile = waitStats?.count ? await db.collection('helpSessions').find(waitFilter).sort({ waitMinutes: 1, _id: 1 }).skip(Math.ceil(waitStats.count * .9) - 1).limit(1).next() : null
  const byKind = Object.fromEntries(workloadGroups.map(row => [row._id, row.hours]))
  const scenarios = opportunities.flatMap(o => [o.positions - 1, o.positions, o.positions + 1].filter(n => n >= 0).map(positions => ({ opportunityId: o.id, positions, weeklyHours: o.weeklyHours, weeks: o.weeks, hourlyRate: o.hourlyRate, estimatedCost: Math.round(positions * o.appointmentCost * 100) / 100, budgetCovered: positions * o.appointmentCost <= o.budget, coverageValidated: false })))
  return {
    course: { id: course.id, code: course.code, title: course.title }, termId: termId || null,
    metrics: { sessions: sessionStats?.sessions || 0, helped: sessionStats?.helped || 0, avgWaitMinutes: waitStats?.average ?? null, p90WaitMinutes: percentile?.waitMinutes ?? null, recordedHelpMinutes: sessionStats?.recordedHelpMinutes || 0, feedbackCount: feedbackStats?.count || 0, feedbackAverage: feedbackStats?.average ?? null },
    workload: { totalHours: workloadGroups.reduce((sum, w) => sum + w.hours, 0), byKind, count: recordCount, records: records.map(publicRecord), source: 'self-reported; not payroll evidence' },
    budget: { approvedBudget: opportunityStats?.approvedBudget || 0, committedBudget: opportunityStats?.committedBudget || 0, opportunities: opportunities.map(o => ({ id: o.id, title: o.title, positions: o.positions, budget: o.budget, committedBudget: o.committedBudget })), scenarios },
    missingEvidence: ['Complete observation coverage is not established.', 'Self-reported workload does not prove paid hours.', 'Lab, grading, attendance and deadline coverage require instructor validation.', 'Cost scenarios do not establish that lower staffing will meet demand.'],
    pagination: { page, limit: 100, totals: { workload: recordCount, opportunities: opportunityStats?.count || 0 }, hasMore: recordCount > offset + 100 || (opportunityStats?.count || 0) > offset + 100 },
    aggregateCoverage: 'All matching database records; detail rows are independently paged.',
    ai: aiStatus()
  }
}

export async function projectWorkspace(db: Db, user: StaffingActor, projectId: string, page = 1, session?: ClientSession) {
  const readOptions = session ? { session } : {}
  const project = await db.collection('researchProjects').findOne({ id: projectId }, readOptions) || fail(404, 'Project not found')
  const canManage = isGlobalAdmin(user) || project.ownerEmail === user.email || (project.reviewerEmails || []).includes(user.email)
  const timestamp = new Date()
  const activeAppointment = await db.collection('staffingAppointments').findOne({ projectId, applicantId: actorId(user), type: 'ra', status: { $in: ['active', 'pending_start'] }, acceptedAt: { $ne: null }, clearance: 'cleared', startDate: { $lte: timestamp }, endDate: { $gt: timestamp } }, readOptions)
  const canWork = !!activeAppointment
  if (!canManage && !canWork) fail(403, 'Only project managers and currently appointed researchers may use this workspace')
  const offset = (page - 1) * 100
  const appointmentFilter = { projectId, ...(canManage ? {} : { applicantId: actorId(user) }) }
  const entryFilter = { kind: 'ResearchUpdate', 'details.projectId': projectId }
  const appointments = await db.collection('staffingAppointments').find(appointmentFilter, readOptions).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray()
  const appointmentCount = await db.collection('staffingAppointments').countDocuments(appointmentFilter, readOptions)
  const entries = await db.collection('staffingEvents').find(entryFilter, readOptions).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray()
  const entryCount = await db.collection('staffingEvents').countDocuments(entryFilter, readOptions)
  return {
    project: publicRecord(project), appointments: appointments.map(a => appointmentDto(a, user)), entries: entries.map(publicRecord), canManage, canWork,
    pagination: { page, limit: 100, totals: { appointments: appointmentCount, entries: entryCount }, hasMore: appointmentCount > offset + 100 || entryCount > offset + 100 }
  }
}

export async function addProjectUpdate(db: Db, session: ClientSession, user: StaffingActor, projectId: string, raw: unknown) {
  await lockStaffingResource(db, { type: 'ra', projectId }, session)
  const workspace = await projectWorkspace(db, user, projectId, 1, session)
  const body = object(raw, 'Project update')
  const message = text(body.text, 'Project update', 5000, true)
  await event(db, session, user, 'ResearchUpdate', projectId, { projectId, text: message })
  return { ok: true, project: workspace.project }
}
