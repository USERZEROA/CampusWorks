import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { lockCourse } from './courses'
import { actorId, appointmentDto, canManageOpportunity, date, event, fail, flag, number, object, options, pageLimit, publicRecord, slots, text, uid, type StaffingActor } from './staffing'

export async function lockStaffingResource(db: Db, resource: Document, session: ClientSession) {
  if (resource.type === 'ta') {
    const course = await lockCourse(db, resource.courseId, session)
    if (!course) fail(404, 'Course offering not found')
    return course
  }
  return await db.collection('researchProjects').findOneAndUpdate({ id: resource.projectId }, { $inc: { mutationVersion: 1 } }, { session, returnDocument: 'after' }) || fail(404, 'Research project not found')
}

export function opportunityInput(raw: unknown) {
  const body = object(raw, 'Opportunity')
  const type = text(body.type, 'Position type', 2, true)
  if (!['ta', 'ra'].includes(type)) fail(400, 'Position type must be ta or ra')
  const positions = number(body.positions, 'Positions', 1, 100, 1)
  if (!Number.isInteger(positions)) fail(400, 'Positions must be an integer')
  const weeklyHours = number(body.weeklyHours, 'Weekly hours', 0.25, 40, 10)
  const appointmentStart = date(body.appointmentStart, 'Appointment start')
  const appointmentEnd = date(body.appointmentEnd, 'Appointment end')
  const applicationDeadline = date(body.applicationDeadline, 'Application deadline')
  if (appointmentStart >= appointmentEnd || applicationDeadline >= appointmentEnd) fail(400, 'Appointment and application dates are inconsistent')
  const duties = body.duties === undefined ? [] : body.duties
  if (!Array.isArray(duties) || duties.length > 30) fail(400, 'Duties must contain at most 30 items')
  const normalizedDuties = duties.map((raw) => {
    const item = object(raw, 'Duty')
    const kind = text(item.kind, 'Duty kind', 30, true)
    if (!['attendance', 'lab', 'discussion', 'grading', 'office_hours', 'preparation', 'research', 'coordination'].includes(kind)) fail(400, 'Unknown duty kind')
    return { kind, sessionsPerWeek: number(item.sessionsPerWeek, 'Sessions per week', 0, 30), minutesPerSession: number(item.minutesPerSession, 'Minutes per session', 0, 600) }
  })
  if (normalizedDuties.reduce((sum, d) => sum + d.sessionsPerWeek * d.minutesPerSession / 60, 0) > weeklyHours + 0.001) fail(400, 'Scheduled duties exceed the weekly hours')
  const questions = body.questions === undefined ? [] : body.questions
  if (!Array.isArray(questions) || questions.length > 20) fail(400, 'Questions must contain at most 20 items')
  const normalizedQuestions = questions.map((raw, index) => {
    const item = object(raw, 'Question')
    return { id: text(item.id, 'Question ID', 64) || `q${index + 1}`, prompt: text(item.prompt, 'Question', 1000, true), required: flag(item.required, 'Question required', true) }
  })
  if (new Set(normalizedQuestions.map(q => q.id)).size !== normalizedQuestions.length || normalizedQuestions.some(q => !/^[a-zA-Z0-9_-]+$/.test(q.id) || ['__proto__', 'prototype', 'constructor'].includes(q.id))) fail(400, 'Question IDs must be unique safe identifiers')
  const hourlyRate = number(body.hourlyRate, 'Hourly rate', 0, 1000, 0)
  const budget = number(body.budget, 'Approved budget', 0, 10000000, 0)
  const weeks = Math.ceil((appointmentEnd.getTime() - appointmentStart.getTime()) / (7 * 86400000))
  const appointmentCost = Math.round(weeklyHours * weeks * hourlyRate * 100) / 100
  if (budget + 0.001 < appointmentCost * positions) fail(400, 'Budget does not cover the advertised positions and hours')
  const preferences = body.allowedPositionPreferences ?? ['full', 'half', 'either', 'other']
  if (!Array.isArray(preferences) || !preferences.length || preferences.some(p => !['full', 'half', 'either', 'other'].includes(p))) fail(400, 'Appointment preferences are invalid')
  return {
    type, title: text(body.title, 'Title', 160, true), termId: text(body.termId, 'Term', 64, true),
    courseId: type === 'ta' ? text(body.courseId, 'Course offering', 64, true) : '', projectId: type === 'ra' ? text(body.projectId, 'Research project', 64, true) : '',
    department: text(body.department, 'Department', 120, true), description: text(body.description, 'Description', 6000, true),
    positions, weeklyHours, appointmentStart, appointmentEnd, applicationDeadline,
    requiresAttendance: flag(body.requiresAttendance, 'Attendance required'), hasLab: flag(body.hasLab, 'Labs required'), hasDiscussion: flag(body.hasDiscussion, 'Discussions required'),
    requiresGrading: flag(body.requiresGrading, 'Grading required'), holdsOfficeHours: flag(body.holdsOfficeHours, 'Office hours required'),
    duties: normalizedDuties, requiredSkills: text(body.requiredSkills, 'Required skills', 3000), preferredSkills: text(body.preferredSkills, 'Preferred skills', 3000),
    questions: normalizedQuestions, requiredSlots: slots(body.requiredSlots, 'Required availability'), allowedPositionPreferences: preferences,
    cvRequired: flag(body.cvRequired, 'CV required', true), approvalRequired: flag(body.approvalRequired, 'Administrative approval required', true), hourlyRate, budget, weeks, appointmentCost
  }
}

export async function createTerm(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  if (!isGlobalAdmin(user)) fail(403, 'Site administrators configure staffing terms')
  const body = object(raw, 'Term')
  const startDate = date(body.startDate, 'Term start')
  const endDate = date(body.endDate, 'Term end')
  if (startDate >= endDate) fail(400, 'Term end must follow its start')
  const term = { id: uid(), name: text(body.name, 'Term name', 120, true), startDate, endDate, exclusivePerTerm: true, requiresApproval: flag(body.requiresApproval, 'Term approval requirement', true), createdAt: new Date(), createdBy: user.email }
  await db.collection('staffingTerms').insertOne(term, { session })
  await event(db, session, user, 'TermCreated', term.id)
  return { term: publicRecord(term) }
}

export async function createProject(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  const instructionalRole = await db.collection('enrollments').findOne({ userEmail: user.email, role: { $in: ['instructor', 'admin'] } }, { session })
  if (!isGlobalAdmin(user) && !instructionalRole) fail(403, 'Authorized instructors or administrators create research projects')
  if (!isGlobalAdmin(user) && instructionalRole) {
    await lockCourse(db, instructionalRole.courseId, session)
    if (!await db.collection('enrollments').findOne({ courseId: instructionalRole.courseId, userEmail: user.email, role: { $in: ['instructor', 'admin'] } }, { session })) fail(403, 'Instructional authority changed')
  }
  const body = object(raw, 'Research project')
  const project = { id: uid(), title: text(body.title, 'Project title', 160, true), description: text(body.description, 'Project description', 6000, true), department: text(body.department, 'Department', 120, true), ownerEmail: user.email, reviewerEmails: [], createdAt: new Date(), mutationVersion: 0 }
  await db.collection('researchProjects').insertOne(project, { session })
  await event(db, session, user, 'ProjectCreated', project.id)
  return { project: publicRecord(project) }
}

export async function createOpportunity(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  const input = opportunityInput(raw)
  const resource = await lockStaffingResource(db, input, session)
  if (!await canManageOpportunity(db, input, user, session)) fail(403, 'Only the authorized course or project manager can publish positions')
  const term = await db.collection('staffingTerms').findOne({ id: input.termId }, { session }) || fail(400, 'Choose a configured term')
  if (input.appointmentStart < term.startDate || input.appointmentEnd > term.endDate) fail(400, 'Appointment dates must be within the selected term')
  if (input.type === 'ta') {
    if (resource.staffingTermId && resource.staffingTermId !== input.termId) fail(409, 'This course offering belongs to another term. Create a separate course offering for the new term.')
    await db.collection('courses').updateOne({ _id: resource._id }, { $set: { staffingTermId: input.termId } }, { session })
  }
  const approvalRequired = term.requiresApproval !== false || input.approvalRequired
  const opportunity = { ...input, approvalRequired, id: uid(), status: 'draft', version: 1, requirementsVersion: 1, ownerEmail: user.email, ownerId: actorId(user), approved: isGlobalAdmin(user) || !approvalRequired, committedPositions: 0, committedBudget: 0, createdAt: new Date(), updatedAt: new Date() }
  await db.collection('staffingOpportunities').insertOne(opportunity, { session })
  await event(db, session, user, 'OpportunityCreated', opportunity.id)
  return { opportunity: publicRecord(opportunity) }
}

export async function overview(db: Db, user: StaffingActor, page = 1) {
  const global = isGlobalAdmin(user)
  const offset = (page - 1) * pageLimit
  const managerCourseIds = await db.collection('enrollments').distinct('courseId', { userEmail: user.email, role: { $in: ['instructor', 'admin'] } })
  const ownedProjectFilter = { $or: [{ ownerEmail: user.email }, { reviewerEmails: user.email }] }
  const ownedProjectIds = await db.collection('researchProjects').distinct('id', global ? {} : ownedProjectFilter)
  const assignedProjectIds = await db.collection('staffingAppointments').distinct('projectId', { applicantId: actorId(user), type: 'ra', status: { $in: ['active', 'pending_start'] }, clearance: 'cleared', startDate: { $lte: new Date() }, endDate: { $gt: new Date() } })
  const manageable = global ? {} : { $or: [{ courseId: { $in: managerCourseIds } }, { projectId: { $in: ownedProjectIds } }] }
  const queries: Record<string, { collection: string; filter: Document; sort: Record<string, 1 | -1> }> = {
    terms: { collection: 'staffingTerms', filter: {}, sort: { startDate: -1, id: 1 } },
    courses: { collection: 'courses', filter: global ? {} : { id: { $in: managerCourseIds } }, sort: { code: 1, id: 1 } },
    projects: { collection: 'researchProjects', filter: global ? {} : { id: { $in: [...new Set([...ownedProjectIds, ...assignedProjectIds])] } }, sort: { createdAt: -1, id: 1 } },
    opportunities: { collection: 'staffingOpportunities', filter: { status: { $in: ['published', 'applications_closed', 'filled'] } }, sort: { createdAt: -1, id: 1 } },
    myApplications: { collection: 'staffingApplications', filter: { applicantId: actorId(user) }, sort: { updatedAt: -1, id: 1 } },
    myAppointments: { collection: 'staffingAppointments', filter: { applicantId: actorId(user) }, sort: { createdAt: -1, id: 1 } },
    managedOpportunities: { collection: 'staffingOpportunities', filter: manageable, sort: { createdAt: -1, id: 1 } },
    adminAppointments: { collection: 'staffingAppointments', filter: global ? {} : { id: { $in: [] } }, sort: { createdAt: -1, id: 1 } },
    pendingOpportunities: { collection: 'staffingOpportunities', filter: global ? { status: 'pending_approval' } : { id: { $in: [] } }, sort: { createdAt: 1, id: 1 } }
  }
  const values: Record<string, Document[]> = {}
  const totals: Record<string, number> = {}
  await Promise.all(Object.entries(queries).map(async ([key, query]) => {
    const collection = db.collection(query.collection)
    const [rows, total] = await Promise.all([collection.find(query.filter).sort(query.sort).skip(offset).limit(pageLimit).toArray(), collection.countDocuments(query.filter)])
    values[key] = rows
    totals[key] = total
  }))
  return {
    viewer: { id: actorId(user), email: user.email, name: user.name, primaryRole: user.primaryRole, isGlobalAdmin: global, canManageStaffing: global || managerCourseIds.length > 0 || ownedProjectIds.length > 0 },
    terms: values.terms!.map(publicRecord), courses: values.courses!.map(c => ({ id: c.id, code: c.code, title: c.title, role: global ? 'admin' : 'instructor' })), projects: values.projects!.map(publicRecord),
    opportunities: values.opportunities!.map(publicRecord), myApplications: values.myApplications!.map(a => { const { administrative, revisions, ...dto } = publicRecord(a)!; return dto }),
    myAppointments: values.myAppointments!.map(a => appointmentDto(a, user)), managedOpportunities: values.managedOpportunities!.map(publicRecord),
    adminAppointments: values.adminAppointments!.map(a => appointmentDto(a, user)),
    admin: global ? { pendingOpportunities: values.pendingOpportunities!.map(publicRecord), appointments: values.adminAppointments!.map(a => appointmentDto(a, user)) } : null,
    policy: { exclusivePerTerm: true, exclusiveAcrossOverlappingDates: true, multipleHalfAppointments: false, manualDecision: true, clearanceRequired: true },
    pagination: { page, limit: pageLimit, totals, hasMore: Object.values(totals).some(total => total > offset + pageLimit) }
  }
}
