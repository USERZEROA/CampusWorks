import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { aiStatus } from './ai'
import { lockStaffingResource } from './staffing-catalog'
import { actorId, event, fail, manualCourseManager, number, object, publicRecord, text, uid, type StaffingActor } from './staffing'

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
  const idempotencyKey = text(body.idempotencyKey, 'Idempotency key', 128)
  if (idempotencyKey) {
    const existing = await db.collection('staffingWorkload').findOne({ appointmentId, idempotencyKey }, { session })
    if (existing) return { record: publicRecord(existing), replayed: true }
  }
  const kind = text(body.kind, 'Work category', 30, true)
  if (!['attendance', 'lab', 'discussion', 'grading', 'office_hours', 'preparation', 'coordination', 'research'].includes(kind)) fail(400, 'Unknown work category')
  const hours = number(body.hours, 'Hours', 0.05, 24)
  const daily = await db.collection('staffingWorkload').find({ appointmentId, date: dateText }, { session }).toArray()
  if (daily.reduce((sum, r) => sum + r.hours, 0) + hours > 24) fail(400, 'Recorded hours cannot exceed 24 in one day')
  const record = { id: uid(), appointmentId, ...(idempotencyKey ? { idempotencyKey } : {}), opportunityId: appointment.opportunityId, courseId: appointment.courseId, projectId: appointment.projectId, termId: appointment.termId, applicantId: appointment.applicantId, kind, hours, date: dateText, notes: text(body.notes, 'Work notes', 2000), authorEmail: user.email, source: 'self-reported', createdAt: new Date() }
  await db.collection('staffingWorkload').insertOne(record, { session })
  await event(db, session, user, 'WorkloadRecorded', appointmentId, { recordId: record.id })
  return { record: publicRecord(record) }
}

export async function courseReview(db: Db, user: StaffingActor, courseId: string, termId: string) {
  if (!await manualCourseManager(db, courseId, user)) fail(403, 'Course managers review term reports')
  const course = await db.collection('courses').findOne({ id: courseId }) || fail(404, 'Course not found')
  const term = termId ? await db.collection('staffingTerms').findOne({ id: termId }) : null
  if (termId && !term) fail(404, 'Term not found')
  const dateFilter = term ? { $gte: term.startDate, $lt: term.endDate } : undefined
  const [sessions, feedback, workload, opportunities] = await Promise.all([
    db.collection('helpSessions').find({ courseId, ...(dateFilter ? { joinedAt: dateFilter } : {}) }).limit(10000).toArray(),
    db.collection('feedback').find({ courseId, ...(dateFilter ? { createdAt: dateFilter } : {}) }).limit(10000).toArray(),
    db.collection('staffingWorkload').find({ courseId, ...(termId ? { termId } : {}) }).limit(10000).toArray(),
    db.collection('staffingOpportunities').find({ courseId, ...(termId ? { termId } : {}) }).limit(1000).toArray()
  ])
  const waits = sessions.filter(s => typeof s.waitMinutes === 'number' && s.wasHelped).map(s => s.waitMinutes as number).sort((a, b) => a - b)
  const byKind: Record<string, number> = {}
  for (const row of workload) byKind[row.kind] = (byKind[row.kind] || 0) + row.hours
  const totalHours = workload.reduce((sum, w) => sum + w.hours, 0)
  const approvedBudget = opportunities.reduce((sum, o) => sum + o.budget, 0)
  const committedBudget = opportunities.reduce((sum, o) => sum + o.committedBudget, 0)
  const scenarios = opportunities.flatMap(o => [o.positions - 1, o.positions, o.positions + 1].filter(n => n >= 0).map(positions => ({ opportunityId: o.id, positions, weeklyHours: o.weeklyHours, weeks: o.weeks, hourlyRate: o.hourlyRate, estimatedCost: Math.round(positions * o.appointmentCost * 100) / 100, budgetCovered: positions * o.appointmentCost <= o.budget, coverageValidated: false })))
  return {
    course: { id: course.id, code: course.code, title: course.title }, termId: termId || null,
    metrics: { sessions: sessions.length, helped: sessions.filter(s => s.wasHelped).length, avgWaitMinutes: waits.length ? waits.reduce((a,b) => a+b, 0) / waits.length : null, p90WaitMinutes: waits.length ? waits[Math.ceil(waits.length * .9) - 1] : null, recordedHelpMinutes: sessions.reduce((sum,s) => sum + (Number(s.helpMinutes) || 0), 0), feedbackCount: feedback.length, feedbackAverage: feedback.length ? feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length : null },
    workload: { totalHours, byKind, records: workload.map(publicRecord), source: 'self-reported; not payroll evidence' },
    budget: { approvedBudget, committedBudget, opportunities: opportunities.map(o => ({ id: o.id, title: o.title, positions: o.positions, budget: o.budget, committedBudget: o.committedBudget })), scenarios },
    missingEvidence: ['Complete observation coverage is not established.', 'Self-reported workload does not prove paid hours.', 'Lab, grading, attendance and deadline coverage require instructor validation.', 'Cost scenarios do not establish that lower staffing will meet demand.'],
    bounded: sessions.length === 10000 || workload.length === 10000 || feedback.length === 10000,
    ai: aiStatus()
  }
}

export async function projectWorkspace(db: Db, user: StaffingActor, projectId: string) {
  const project = await db.collection('researchProjects').findOne({ id: projectId }) || fail(404, 'Project not found')
  const canManage = isGlobalAdmin(user) || project.ownerEmail === user.email || (project.reviewerEmails || []).includes(user.email)
  const appointments = await db.collection('staffingAppointments').find({ projectId, ...(canManage ? {} : { applicantId: actorId(user) }) }).limit(100).toArray()
  const canWork = appointments.some(a => a.status === 'active' && a.clearance === 'cleared' && a.startDate <= new Date() && a.endDate > new Date())
  if (!canManage && !canWork) fail(403, 'Only project managers and currently appointed researchers may use this workspace')
  const entries = await db.collection('staffingEvents').find({ kind: 'ResearchUpdate', 'details.projectId': projectId }).sort({ createdAt: -1 }).limit(100).toArray()
  return { project: publicRecord(project), appointments: appointments.map(publicRecord), entries: entries.map(publicRecord), canManage, canWork }
}

export async function addProjectUpdate(db: Db, session: ClientSession, user: StaffingActor, projectId: string, raw: unknown) {
  await lockStaffingResource(db, { type: 'ra', projectId }, session)
  const workspace = await projectWorkspace(db, user, projectId)
  const body = object(raw, 'Project update')
  const message = text(body.text, 'Project update', 5000, true)
  await event(db, session, user, 'ResearchUpdate', projectId, { projectId, text: message })
  return { ok: true, project: workspace.project }
}
