import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { lockStaffingResource } from './staffing-catalog'
import { assertRecruitmentGate } from './staffing-cycle'
import { actorId, applicationAccess, applicationDto, appointmentDto, assertVersion, eligibility, event, fail, findOpportunity, flag, number, object, options, publicRecord, slots, staffingCapabilities, text, uid, type StaffingActor } from './staffing'

export function applicantInput(raw: unknown) {
  const body = object(raw, 'Application')
  const profile = object(body.profile || {}, 'Applicant profile')
  const positionPreference = text(profile.positionPreference, 'Appointment preference', 20) || 'either'
  if (!['full', 'half', 'either', 'other'].includes(positionPreference)) fail(400, 'Appointment preference is invalid')
  const preferredEmail = text(profile.preferredEmail, 'Preferred email', 254)
  if (preferredEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(preferredEmail)) fail(400, 'Preferred email must be a valid address')
  const answersRaw = object(body.answers || {}, 'Answers')
  if (Object.keys(answersRaw).length > 20) fail(400, 'Too many answers')
  const answers: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(answersRaw)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail(400, 'Answer ID is invalid')
    answers[key] = text(value, 'Answer', 5000)
  }
  const normalized = {
    firstName: text(profile.firstName, 'First name', 100), lastName: text(profile.lastName, 'Last name', 100), preferredEmail,
    undergraduateMajors: text(profile.undergraduateMajors, 'Undergraduate majors', 500), department: text(profile.department, 'Department', 120),
    positionPreference, priorTaExperience: flag(profile.priorTaExperience, 'Previous TA experience'), priorCourses: text(profile.priorCourses, 'Previous courses', 2000),
    multipleCourses: flag(profile.multipleCourses, 'Multiple-course preference'), graduationTerm: text(profile.graduationTerm, 'Graduation term', 120),
    availability: text(profile.availability, 'Availability', 2000), availableHours: number(profile.availableHours, 'Available hours', 0, 40, 0), slots: slots(profile.slots, 'Available slots'),
    skills: text(profile.skills, 'Skills', 4000), experience: text(profile.experience, 'Teaching or research experience', 6000)
  }
  const administrative: Record<string, unknown> = {}
  if (body.administrative !== undefined) {
    const input = object(body.administrative, 'Administrative details')
    for (const key of Object.keys(input)) if (!['dukeUniqueId', 'payrollBefore', 'hasSsn', 'citizenship', 'authorizationExpiry'].includes(key)) fail(400, 'Unsupported administrative field; do not submit SSN numbers or identity documents')
    administrative.dukeUniqueId = text(input.dukeUniqueId, 'Institutional ID', 64)
    if (input.payrollBefore !== undefined) administrative.payrollBefore = flag(input.payrollBefore, 'Prior payroll status')
    if (input.hasSsn !== undefined) administrative.hasSsn = flag(input.hasSsn, 'SSN status')
    administrative.citizenship = text(input.citizenship, 'Citizenship category', 64)
    administrative.authorizationExpiry = text(input.authorizationExpiry, 'Authorization expiry', 64)
  }
  return { profile: normalized, answers, administrative, qualificationText: text(body.qualificationText, 'Qualification text', 20000) }
}

export async function createApplication(db: Db, session: ClientSession, user: StaffingActor, opportunityId: string) {
  const opportunity = await findOpportunity(db, opportunityId, session)
  await lockStaffingResource(db, opportunity, session)
  await assertRecruitmentGate(db, session, opportunity.termId)
  if (opportunity.status !== 'published') fail(409, 'Applications are not open')
  const existing = await db.collection('staffingApplications').findOne({ opportunityId, applicantId: actorId(user) }, { session })
  if (existing) return { application: applicationDto(existing, true) }
  if (!(await staffingCapabilities(db, user, session)).canApplyStaffing) fail(403, 'Only students and teaching assistants may submit new applications')
  const application = { id: uid(), opportunityId, termId: opportunity.termId, applicantId: actorId(user), applicantEmail: user.email, applicantName: user.name, status: 'draft', version: 1, opportunityVersion: opportunity.requirementsVersion || 1, profile: {}, answers: {}, qualificationText: '', administrative: {}, cvDocumentId: null, revisions: [], createdAt: new Date(), updatedAt: new Date() }
  await db.collection('staffingApplications').insertOne(application, { session })
  await event(db, session, user, 'ApplicationDraftCreated', application.id, { opportunityId })
  return { application: applicationDto(application, true) }
}

export async function assertApplicationEditable(db: Db, application: Document, opportunity: Document, session: ClientSession) {
  await assertRecruitmentGate(db, session, opportunity.termId)
  if (!['draft', 'submitted', 'under_review', 'shortlisted', 'withdrawn', 'not_selected'].includes(application.status)) fail(409, 'Application is not editable')
  if (opportunity.status !== 'published') fail(409, 'Applications are not open')
  if (await db.collection('staffingOffers').findOne({ applicationId: application.id, status: { $in: ['issued', 'accepted'] } }, { session })) fail(409, 'Resolve the current offer before editing this application')
  if ((application.revisions || []).length >= 50) fail(409, 'Application revision limit reached; contact the reviewer')
}

export async function updateApplication(db: Db, session: ClientSession, user: StaffingActor, applicationId: string, raw: unknown) {
  const access = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, access.opportunity, session)
  if (!access.owner) fail(403, 'Only the applicant may edit their answers')
  const body = object(raw, 'Application')
  if (body.expectedVersion === undefined) fail(400, 'The current application version is required')
  assertVersion(access.application, body.expectedVersion)
  await assertApplicationEditable(db, access.application, access.opportunity, session)
  const input = applicantInput(body)
  if (body.administrative && Object.keys(object(body.administrative, 'Administrative details')).length) fail(400, 'Administrative details are collected separately after an offer')
  const { administrative: ignoredAdministrative, ...qualification } = input
  const validQuestions = new Set((access.opportunity.questions || []).map((q: Document) => q.id))
  if (Object.keys(input.answers).some(id => !validQuestions.has(id))) fail(400, 'An answer refers to an unknown question')
  const revision = { version: access.application.version, profile: access.application.profile, answers: access.application.answers, qualificationText: access.application.qualificationText, cvDocumentId: access.application.cvDocumentId, status: access.application.status, updatedAt: access.application.updatedAt }
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { ...qualification, status: 'draft', opportunityVersion: access.opportunity.requirementsVersion || 1, updatedAt: new Date() }, $inc: { version: 1 }, $push: { revisions: revision } as any }, { session })
  await event(db, session, user, 'ApplicationRevised', applicationId)
  return { application: applicationDto((await db.collection('staffingApplications').findOne({ id: applicationId }, { session }))!, true) }
}

export async function submitApplication(db: Db, session: ClientSession, user: StaffingActor, applicationId: string) {
  const { application, opportunity, owner } = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, opportunity, session)
  if (!owner) fail(403, 'Only the applicant may submit')
  await assertApplicationEditable(db, application, opportunity, session)
  if (application.opportunityVersion !== (opportunity.requirementsVersion || 1)) fail(409, 'Requirements changed. Review and save the updated form before submitting.')
  const p = application.profile || {}
  if (!p.firstName || !p.lastName || !p.preferredEmail || !p.undergraduateMajors || !p.department || !p.graduationTerm || !p.availability) fail(400, 'Complete personal information, academic background, graduation term, and availability')
  if (p.priorTaExperience && !p.priorCourses) fail(400, 'List previous TA courses or departments')
  for (const question of opportunity.questions || []) if (question.required && !application.answers?.[question.id]?.trim()) fail(400, `Answer the required question: ${question.prompt}`)
  if (opportunity.cvRequired && !application.cvDocumentId) fail(400, 'Upload the required CV before submitting')
  const available = eligibility(application, opportunity)
  if (!available.eligible) fail(400, available.reasons.join('; '))
  const snapshot = { profile: application.profile, answers: application.answers, qualificationText: application.qualificationText, cvDocumentId: application.cvDocumentId, opportunityVersion: opportunity.requirementsVersion || 1, submittedAt: new Date() }
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { status: 'submitted', submittedAt: new Date(), updatedAt: new Date(), submittedSnapshot: snapshot }, $inc: { version: 1 } }, { session })
  await event(db, session, user, 'ApplicationSubmitted', applicationId, { opportunityId: opportunity.id })
  return { application: applicationDto((await db.collection('staffingApplications').findOne({ id: applicationId }, { session }))!, true) }
}

export async function uploadCv(db: Db, session: ClientSession, user: StaffingActor, applicationId: string, file: { filename?: string; type?: string; data: Buffer }, expectedVersion: number) {
  const { application, opportunity, owner } = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, opportunity, session)
  if (!owner) fail(403, 'Only the applicant may upload a CV')
  assertVersion(application, expectedVersion)
  await assertApplicationEditable(db, application, opportunity, session)
  if (await db.collection('staffingDocuments').countDocuments({ applicationId }, { session }) >= 10) fail(409, 'At most ten CV versions may be stored for one application')
  if (!file.data.length || file.data.length > 2 * 1024 * 1024) fail(413, 'CV size must be between one byte and 2 MiB')
  const filename = text(file.filename, 'CV filename', 120, true).replace(/[^a-zA-Z0-9._ -]/g, '_')
  const pdf = filename.toLowerCase().endsWith('.pdf') && file.data.subarray(0, 5).toString() === '%PDF-'
  const txt = filename.toLowerCase().endsWith('.txt') && (!file.type || ['text/plain', 'application/octet-stream'].includes(file.type))
  if (!pdf && !txt) fail(400, 'Upload a PDF or UTF-8 plain-text CV')
  if (pdf && /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b/i.test(file.data.toString('latin1'))) fail(400, 'Active PDF content is not accepted')
  if (txt) {
    try { const content = new TextDecoder('utf-8', { fatal: true }).decode(file.data); if (content.includes('\0')) fail(400, 'Plain-text CV contains unsupported binary content') } catch { fail(400, 'Plain-text CV must be valid UTF-8') }
  }
  const quota = await db.collection('users').updateOne({ id: actorId(user), $expr: { $lte: [{ $add: [{ $ifNull: ['$cvStoredBytes', 0] }, file.data.length] }, 50 * 1024 * 1024] } }, { $inc: { cvStoredBytes: file.data.length } }, { session })
  if (!quota.matchedCount) fail(413, 'The private CV storage limit has been reached')
  const document = { id: uid(), applicationId, applicantId: actorId(user), opportunityId: opportunity.id, filename, contentType: pdf ? 'application/pdf' : 'text/plain; charset=utf-8', size: file.data.length, bytes: file.data, createdAt: new Date(), validation: 'signature-and-size-checked; attachment-only' }
  await db.collection('staffingDocuments').insertOne(document, { session })
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { cvDocumentId: document.id, status: 'draft', updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  await event(db, session, user, 'CvUploaded', applicationId, { documentId: document.id })
  return { document: publicRecord(document), application: applicationDto((await db.collection('staffingApplications').findOne({ id: applicationId }, { session }))!, true) }
}

export async function applicationDetail(db: Db, user: StaffingActor, id: string) {
  const access = await applicationAccess(db, id, user)
  const [offer, appointment] = await Promise.all([
    db.collection('staffingOffers').find({ applicationId: id }).sort({ createdAt: -1 }).limit(1).next(),
    db.collection('staffingAppointments').find({ applicationId: id }).sort({ createdAt: -1 }).limit(1).next()
  ])
  return { application: applicationDto(access.application, access.owner || isGlobalAdmin(user)), opportunity: publicRecord(access.opportunity), offer: publicRecord(offer), appointment: appointmentDto(appointment, user), canManage: access.canManage, owner: access.owner }
}

export async function reviewApplication(db: Db, session: ClientSession, user: StaffingActor, applicationId: string, raw: unknown, reject = false) {
  const { application, opportunity, canManage } = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, opportunity, session)
  if (!canManage) fail(403, 'Only reviewers may change review status')
  await assertRecruitmentGate(db, session, opportunity.termId, 'review')
  if (!['submitted', 'under_review', 'shortlisted', 'not_selected'].includes(application.status)) fail(409, 'Only submitted applications may be reviewed')
  const body = object(raw || {}, 'Review')
  if (await db.collection('staffingOffers').findOne({ applicationId, status: { $in: ['issued', 'accepted'] } }, { session })) fail(409, 'Resolve the offer before changing review status')
  const status = reject ? 'not_selected' : flag(body.shortlisted, 'Shortlisted', true) ? 'shortlisted' : 'under_review'
  const reason = text(body.reason, 'Review reason', 2000, reject)
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { status, reviewReason: reason, reviewedBy: user.email, updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  await event(db, session, user, 'ApplicationReviewed', applicationId, { status })
  return { application: applicationDto((await db.collection('staffingApplications').findOne({ id: applicationId }, { session }))!, isGlobalAdmin(user)) }
}

export async function updateAdministrative(db: Db, session: ClientSession, user: StaffingActor, applicationId: string, raw: unknown) {
  const { application, opportunity, owner } = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, opportunity, session)
  if (!owner && !isGlobalAdmin(user)) fail(403, 'Administrative details are restricted to the applicant and site administrators')
  const appointment = await db.collection('staffingAppointments').findOne({ applicationId, status: { $in: ['offered', 'pending_clearance', 'pending_start', 'active', 'suspended'] } }, { session })
  if (!appointment) fail(409, 'Administrative details are collected after an offer is issued')
  if (appointment.clearance === 'cleared' || ['active', 'suspended'].includes(appointment.status)) fail(409, 'Cleared appointment details require an administrator-led amendment')
  const body = object(raw, 'Administrative details')
  const expected = number(body.expectedAdministrativeVersion, 'Administrative version', 0, 1000000)
  if (expected !== (application.administrativeVersion || 0)) fail(409, 'Administrative details changed. Refresh before saving.')
  const input = applicantInput({ profile: {}, administrative: body.administrative }).administrative
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { administrative: input, administrativeUpdatedAt: new Date() }, $inc: { administrativeVersion: 1 } }, { session })
  await event(db, session, user, 'AdministrativeDetailsUpdated', applicationId)
  return { application: applicationDto((await db.collection('staffingApplications').findOne({ id: applicationId }, { session }))!, true) }
}
