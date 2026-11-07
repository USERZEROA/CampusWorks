import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { findCourse, lockCourse } from './courses'
import { actorId, appointmentDto, date, event, fail, flag, number, object, pageLimit, publicRecord, slots, staffingCapabilities, text, uid, type StaffingActor } from './staffing'
import { getRecruitmentCycle, lockRecruitmentCycle } from './staffing-cycle'
import { qualificationQuestionPurpose } from './qualification-questions'

async function lockInstructionalAuthority(db: Db, user: StaffingActor, session: ClientSession, courseId?: string) {
  if (isGlobalAdmin(user)) return courseId ? await lockCourse(db, courseId, session) || fail(404, 'Course offering not found') : null
  const requested = courseId ? await lockCourse(db, courseId, session) : null
  const enrollment = await db.collection('enrollments').findOne({ userEmail: user.email, ...(requested ? { courseId: requested.id } : {}), role: { $in: ['instructor', 'admin'] } }, { session, sort: { courseId: 1 } })
  if (!enrollment) fail(403, 'Only authorized instructors or administrators publish positions')
  const course = await lockCourse(db, enrollment.courseId, session) || fail(404, 'Course offering not found')
  if (!await db.collection('enrollments').findOne({ courseId: course.id, userEmail: user.email, role: { $in: ['instructor', 'admin'] } }, { session })) fail(403, 'Instructional authority changed')
  return course
}

export async function lockStaffingResource(db: Db, resource: Document, session: ClientSession) {
  await lockRecruitmentCycle(db, session)
  if (resource.type === 'ta') {
    const course = await lockCourse(db, resource.courseId, session) || fail(404, 'Course offering not found')
    const aliases = [...new Set([course.id, course.code].filter(Boolean))].map((value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
    for (const collection of ['staffingOpportunities', 'staffingAppointments', 'staffingOffers', 'staffingWorkload']) {
      await db.collection(collection).updateMany({ courseId: { $in: aliases, $ne: course.id } }, { $set: { courseId: course.id } }, { session })
    }
    resource.courseId = course.id
    return course
  }
  const opportunityId = resource.opportunityId || resource.id
  const opportunity = await db.collection('staffingOpportunities').findOne({ id: opportunityId }, { session }) || fail(404, 'Opportunity not found')
  // Instructional membership changes share this course fence; the RA record
  // itself is the canonical resource and needs no separate workspace.
  const authority = await db.collection('enrollments').findOne({ userEmail: opportunity.ownerEmail, role: { $in: ['instructor', 'admin'] } }, { session, sort: { courseId: 1 } })
  if (authority) await lockCourse(db, authority.courseId, session)
  return await db.collection('staffingOpportunities').findOneAndUpdate({ id: opportunityId }, { $inc: { mutationVersion: 1 } }, { session, returnDocument: 'after' }) || fail(404, 'Opportunity not found')
}

export function opportunityInput(raw: unknown) {
  const body = object(raw, 'Opportunity')
  const type = text(body.type, 'Position type', 2, true)
  if (!['ta', 'ra'].includes(type)) fail(400, 'Position type must be ta or ra')
  if (body.projectId) fail(400, 'Research assistant positions are managed directly by their instructor')
  const positions = number(body.positions, 'Positions', 1, 100, 1)
  if (!Number.isInteger(positions)) fail(400, 'Positions must be an integer')
  const weeklyHours = number(body.weeklyHours, 'Weekly hours', 0.25, 40, 10)
  const appointmentStart = date(body.appointmentStart, 'Appointment start')
  const appointmentEnd = date(body.appointmentEnd, 'Appointment end')
  const applicationDeadline = date(body.applicationDeadline, 'Application deadline')
  if (appointmentStart >= appointmentEnd || applicationDeadline >= appointmentEnd) fail(400, 'Appointment and recruitment dates are inconsistent')
  const duties = body.duties === undefined ? [] : body.duties
  if (!Array.isArray(duties) || duties.length > 30) fail(400, 'Duties must contain at most 30 items')
  const normalizedDuties = duties.map(raw => {
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
    const prompt = text(item.prompt, 'Question', 1000, true)
    return { id: text(item.id, 'Question ID', 64) || `q${index + 1}`, prompt, purpose: qualificationQuestionPurpose(prompt, item.purpose), required: flag(item.required, 'Question required', true) }
  })
  if (new Set(normalizedQuestions.map(q => q.id)).size !== normalizedQuestions.length || normalizedQuestions.some(q => !/^[a-zA-Z0-9_-]+$/.test(q.id) || ['__proto__', 'prototype', 'constructor'].includes(q.id))) fail(400, 'Question IDs must be unique safe identifiers')
  const hourlyRate = number(body.hourlyRate, 'Hourly rate', 0, 1000, 0)
  const budget = number(body.budget, 'Position budget', 0, 10000000, 0)
  const weeks = Math.ceil((appointmentEnd.getTime() - appointmentStart.getTime()) / (7 * 86400000))
  const appointmentCost = Math.round(weeklyHours * weeks * hourlyRate * 100) / 100
  if (budget + 0.001 < appointmentCost * positions) fail(400, 'Budget does not cover the advertised positions and hours')
  const preferences = body.allowedPositionPreferences ?? ['full', 'half', 'either', 'other']
  if (!Array.isArray(preferences) || !preferences.length || preferences.some(p => !['full', 'half', 'either', 'other'].includes(p))) fail(400, 'Appointment preferences are invalid')
  return {
    type, title: text(body.title, 'Title', 160, true), termId: text(body.termId, 'Semester', 64, true),
    courseId: text(body.courseId, 'Course offering', 64, type === 'ta'),
    department: text(body.department, 'Department', 120, true), description: text(body.description, 'Description', 6000, true),
    positions, weeklyHours, appointmentStart, appointmentEnd, applicationDeadline,
    requiresAttendance: flag(body.requiresAttendance, 'Attendance required'), hasLab: flag(body.hasLab, 'Labs required'), hasDiscussion: flag(body.hasDiscussion, 'Discussions required'),
    requiresGrading: flag(body.requiresGrading, 'Grading required'), holdsOfficeHours: flag(body.holdsOfficeHours, 'Office hours required'),
    duties: normalizedDuties, requiredSkills: text(body.requiredSkills, 'Required skills', 3000), preferredSkills: text(body.preferredSkills, 'Preferred skills', 3000),
    questions: normalizedQuestions, requiredSlots: slots(body.requiredSlots, 'Required availability'), allowedPositionPreferences: preferences,
    cvRequired: flag(body.cvRequired, 'CV required', true), approvalRequired: flag(body.approvalRequired, 'Administrative approval required', true), hourlyRate, budget, weeks, appointmentCost
  }
}

export async function currentOpportunityInput(db: Db, session: ClientSession, raw: unknown, previous?: Document) {
  const body = object(raw, 'Opportunity')
  const cycle = await getRecruitmentCycle(db, session)
  if (!cycle.termId) fail(409, 'An administrator must select the current recruitment semester')
  if ((body.termId !== undefined && body.termId !== cycle.termId) || (previous && previous.termId !== cycle.termId)) fail(409, 'The recruitment semester changed. Review the current semester before saving.')
  if (body.applicationDeadline !== undefined && date(body.applicationDeadline, 'Application deadline').getTime() !== cycle.closesAt!.getTime()) fail(409, 'The application deadline is controlled by the current recruitment cycle')
  const input = opportunityInput({ ...previous, ...body, projectId: body.projectId || '', termId: cycle.termId, appointmentStart: body.appointmentStart ?? previous?.appointmentStart?.toISOString() ?? cycle.startDate!.toISOString(), appointmentEnd: body.appointmentEnd ?? previous?.appointmentEnd?.toISOString() ?? cycle.endDate!.toISOString(), applicationDeadline: cycle.closesAt!.toISOString() })
  if (input.courseId) input.courseId = (await findCourse(db, input.courseId, session) || fail(404, 'Course offering not found')).id
  if (input.appointmentStart < cycle.startDate! || input.appointmentEnd > cycle.endDate!) fail(400, 'Appointment dates must be within the current semester')
  return input
}

export async function createTerm(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  if (!isGlobalAdmin(user)) fail(403, 'Site administrators configure staffing semesters')
  const body = object(raw, 'Semester')
  const startDate = date(body.startDate, 'Semester start')
  const endDate = date(body.endDate, 'Semester end')
  if (startDate >= endDate) fail(400, 'Semester end must follow its start')
  const term = { id: uid(), name: text(body.name, 'Semester name', 120, true), startDate, endDate, exclusivePerTerm: true, requiresApproval: flag(body.requiresApproval, 'Semester approval requirement', true), createdAt: new Date(), createdBy: user.email }
  await db.collection('staffingTerms').insertOne(term, { session })
  await event(db, session, user, 'TermCreated', term.id)
  return { term: publicRecord(term) }
}

export async function createOpportunity(db: Db, session: ClientSession, user: StaffingActor, raw: unknown) {
  if (!(await staffingCapabilities(db, user, session)).canManageStaffing) fail(403, 'Only authorized instructors or administrators publish positions')
  await lockRecruitmentCycle(db, session)
  const input = await currentOpportunityInput(db, session, raw)
  const course = await lockInstructionalAuthority(db, user, session, input.courseId || undefined)
  if (input.courseId && course) input.courseId = course.id
  const term = await db.collection('staffingTerms').findOne({ id: input.termId }, { session }) || fail(409, 'Recruitment semester is unavailable')
  const approvalRequired = term.requiresApproval !== false || input.approvalRequired
  const opportunity = { ...input, approvalRequired, id: uid(), status: 'draft', version: 1, mutationVersion: 0, requirementsVersion: 1, ownerEmail: user.email, ownerId: actorId(user), approved: isGlobalAdmin(user) || !approvalRequired, committedPositions: 0, committedBudget: 0, createdAt: new Date(), updatedAt: new Date() }
  await db.collection('staffingOpportunities').insertOne(opportunity, { session })
  await event(db, session, user, 'OpportunityCreated', opportunity.id)
  return { opportunity: publicRecord(opportunity) }
}

export async function overview(db: Db, user: StaffingActor, page = 1) {
  const viewer = await staffingCapabilities(db, user)
  const currentCycle = await getRecruitmentCycle(db)
  const offset = (page - 1) * pageLimit
  const managerCourseIds = viewer.canManageStaffing ? await db.collection('enrollments').distinct('courseId', { userEmail: user.email, role: { $in: ['instructor', 'admin'] } }) : []
  const managerCourses = managerCourseIds.length ? await db.collection('courses').find({ id: { $in: managerCourseIds } }, { projection: { id: 1, code: 1 } }).toArray() : []
  const managerAliases = [...new Set(managerCourses.flatMap(course => [course.id, course.code]).filter(Boolean))].map((value: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
  const manageable: Document = viewer.isGlobalAdmin ? {} : { $or: [{ type: 'ta', courseId: { $in: managerAliases } }, { type: 'ra', ownerId: actorId(user) }] }
  const current = { termId: currentCycle.termId || '' }
  const queries: Record<string, { collection: string; filter: Document; sort: Record<string, 1 | -1> }> = {
    myApplications: { collection: 'staffingApplications', filter: { applicantId: actorId(user) }, sort: { updatedAt: -1, id: 1 } },
    myAppointments: { collection: 'staffingAppointments', filter: { applicantId: actorId(user) }, sort: { createdAt: -1, id: 1 } }
  }
  if (viewer.canBrowseStaffing) queries.opportunities = { collection: 'staffingOpportunities', filter: { ...current, status: { $in: ['published', 'applications_closed', 'filled'] } }, sort: { createdAt: -1, id: 1 } }
  if (viewer.canManageStaffing) {
    queries.courses = { collection: 'courses', filter: viewer.isGlobalAdmin ? {} : { id: { $in: managerCourseIds } }, sort: { code: 1, id: 1 } }
    queries.managedOpportunities = { collection: 'staffingOpportunities', filter: { ...manageable, ...current }, sort: { createdAt: -1, id: 1 } }
  }
  if (viewer.isGlobalAdmin) {
    queries.terms = { collection: 'staffingTerms', filter: {}, sort: { startDate: -1, id: 1 } }
    queries.adminAppointments = { collection: 'staffingAppointments', filter: {}, sort: { createdAt: -1, id: 1 } }
    queries.pendingOpportunities = { collection: 'staffingOpportunities', filter: { ...current, status: 'pending_approval' }, sort: { createdAt: 1, id: 1 } }
  }
  const values: Record<string, Document[]> = {}
  const totals: Record<string, number> = {}
  await Promise.all(Object.entries(queries).map(async ([key, query]) => {
    const collection = db.collection(query.collection)
    const [rows, total] = await Promise.all([collection.find(query.filter).sort(query.sort).skip(offset).limit(pageLimit).toArray(), collection.countDocuments(query.filter)])
    values[key] = rows; totals[key] = total
  }))
  const posting = (record: Document) => ({ ...publicRecord(record), ...(record.termId === currentCycle.termId ? { applicationDeadline: currentCycle.closesAt } : {}) })
  const ownOpportunityIds = [...new Set([...(values.myApplications || []), ...(values.myAppointments || [])].map(record => record.opportunityId))]
  const ownTitles = new Map((await db.collection('staffingOpportunities').find({ id: { $in: ownOpportunityIds } }, { projection: { id: 1, title: 1 } }).toArray()).map(record => [record.id, record.title]))
  return {
    viewer, currentCycle, serverTime: new Date(), terms: (values.terms || []).map(publicRecord),
    courses: (values.courses || []).map(c => ({ id: c.id, code: c.code, title: c.title, role: viewer.isGlobalAdmin ? 'admin' : 'instructor' })),
    opportunities: (values.opportunities || []).map(posting), myApplications: values.myApplications!.map(a => { const { administrative, revisions, ...dto } = publicRecord(a)!; return { ...dto, opportunityTitle: ownTitles.get(a.opportunityId) || '' } }),
    myAppointments: values.myAppointments!.map(a => ({ ...appointmentDto(a, user), opportunityTitle: a.title || ownTitles.get(a.opportunityId) || '' })), managedOpportunities: (values.managedOpportunities || []).map(posting),
    adminAppointments: (values.adminAppointments || []).map(a => appointmentDto(a, user)),
    admin: viewer.isGlobalAdmin ? { pendingOpportunities: (values.pendingOpportunities || []).map(posting), appointments: (values.adminAppointments || []).map(a => appointmentDto(a, user)) } : null,
    policy: { exclusivePerTerm: true, exclusiveAcrossOverlappingDates: true, multipleHalfAppointments: false, manualDecision: true, clearanceRequired: true, administratorControlledCycle: true },
    pagination: { page, limit: pageLimit, totals, hasMore: Object.values(totals).some(total => total > offset + pageLimit) }
  }
}
