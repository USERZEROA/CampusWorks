import { defineEventHandler, getQuery, getRouterParam, readBody, readMultipartFormData, setHeader } from 'h3'
import { isGlobalAdmin, requireUser } from '../../utils/auth'
import { getDb, withTransaction } from '../../utils/db'
import { aiStatus } from '../../utils/ai'
import { actorId, allocationUnavailable, applicationAccess, applicationDto, assertOpportunityManager, assertVersion, canManageOpportunity, eligibility, event as recordEvent, fail, findOpportunity, object, options, publicRecord, text } from '../../utils/staffing'
import { createOpportunity, createProject, createTerm, lockStaffingResource, opportunityInput, overview } from '../../utils/staffing-catalog'
import { applicationDetail, createApplication, reviewApplication, submitApplication, updateApplication, updateAdministrative, uploadCv } from '../../utils/staffing-applications'
import { appointmentAction, offerAction, reconcileDueStaffing, selectApplication, withdrawApplication } from '../../utils/staffing-appointments'
import { addProjectUpdate, courseReview, projectWorkspace, recordWorkload } from '../../utils/staffing-reports'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = await getDb()
  const parts = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const [resource, id, action] = parts
  if (parts.length > 3) fail(404, 'Staffing endpoint not found')
  const method = event.method
  // Maintenance applies only due canonical transitions and never depends on AI.
  await reconcileDueStaffing(db)
  if (method === 'GET' && resource === 'overview' && !id) {
    const result = await overview(db, user)
    const adminAppointments = isGlobalAdmin(user) ? await db.collection('staffingAppointments').find({}).sort({ createdAt: -1 }).limit(100).toArray() : []
    return { ...result, ai: aiStatus(), adminAppointments: adminAppointments.map(publicRecord), admin: isGlobalAdmin(user) ? { pendingOpportunities: result.managedOpportunities.filter(o => o?.status === 'pending_approval'), appointments: adminAppointments.map(publicRecord) } : null }
  }
  if (method === 'GET' && resource === 'opportunities' && id && !action) {
    const opportunity = await findOpportunity(db, id)
    const canManage = await canManageOpportunity(db, opportunity, user)
    if (!canManage && !['published', 'applications_closed', 'filled'].includes(opportunity.status)) fail(404, 'Opportunity not found')
    const application = await db.collection('staffingApplications').findOne({ opportunityId: id, applicantId: actorId(user) })
    const [applications, appointments, offers] = canManage ? await Promise.all([
      db.collection('staffingApplications').find({ opportunityId: id, submittedAt: { $exists: true }, status: { $ne: 'draft' } }).sort({ submittedAt: 1 }).limit(100).toArray(),
      db.collection('staffingAppointments').find({ opportunityId: id }).sort({ createdAt: -1 }).limit(100).toArray(),
      db.collection('staffingOffers').find({ opportunityId: id }).sort({ createdAt: -1 }).limit(100).toArray()
    ]) : [[], [], []]
    const reviewed = []
    for (const app of applications) reviewed.push({ ...applicationDto(app, isGlobalAdmin(user)), availability: { unavailable: await allocationUnavailable(db, app.applicantId, opportunity.termId), ...eligibility(app, opportunity) } })
    return { opportunity: publicRecord(opportunity), application: application ? applicationDto(application, true) : null, applications: reviewed, appointments: appointments.map(publicRecord), offers: offers.map(publicRecord), canManage, ai: aiStatus() }
  }
  if (method === 'GET' && resource === 'applications' && id && !action) return applicationDetail(db, user, id)
  if (method === 'GET' && resource === 'documents' && id && !action) {
    const document = await db.collection('staffingDocuments').findOne({ id }) || fail(404, 'Document not found')
    const access = await applicationAccess(db, document.applicationId, user)
    if (!access.owner && document.id !== access.application.submittedSnapshot?.cvDocumentId) fail(403, 'Only the submitted CV is visible to reviewers')
    setHeader(event, 'Content-Type', document.contentType)
    setHeader(event, 'Content-Disposition', `attachment; filename="${document.filename}"`)
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
    setHeader(event, 'Cache-Control', 'private, no-store')
    await db.collection('staffingEvents').insertOne({ id: crypto.randomUUID(), actorId: actorId(user), actorEmail: user.email, kind: 'CvDownloaded', targetId: id, createdAt: new Date(), delivery: 'pending' })
    return Buffer.from(document.bytes.buffer || document.bytes)
  }
  if (method === 'GET' && resource === 'projects' && id && action === 'workspace') return projectWorkspace(db, user, id)
  if (method === 'GET' && resource === 'reviews' && id && !action) return courseReview(db, user, id, text(getQuery(event).termId, 'Term', 64))
  if (method === 'POST' && resource === 'applications' && id && action === 'cv') {
    const form = await readMultipartFormData(event)
    const files = form?.filter(part => part.name === 'file') || []
    if (files.length !== 1 || form!.length !== 1) fail(400, 'Upload exactly one CV file')
    return withTransaction((database, session) => uploadCv(database, session, user, id, files[0]!))
  }
  const body = method === 'GET' ? {} : await readBody(event) || {}
  if (method === 'POST' && resource === 'reconcile' && !id) {
    if (!isGlobalAdmin(user)) fail(403, 'Only administrators may request maintenance details')
    return reconcileDueStaffing(db)
  }
  if (method === 'POST' && resource === 'terms' && !id) return withTransaction((database, session) => createTerm(database, session, user, body))
  if (method === 'POST' && resource === 'projects' && !id) return withTransaction((database, session) => createProject(database, session, user, body))
  if (method === 'POST' && resource === 'opportunities' && !id) return withTransaction((database, session) => createOpportunity(database, session, user, body))
  if (resource === 'opportunities' && id && method === 'POST' && action === 'applications') return withTransaction((database, session) => createApplication(database, session, user, id))
  if (resource === 'applications' && id && method === 'PATCH' && !action) return withTransaction((database, session) => updateApplication(database, session, user, id, body))
  if (resource === 'applications' && id && method === 'POST') {
    if (action === 'submit') return withTransaction((database, session) => submitApplication(database, session, user, id))
    if (action === 'withdraw') return withTransaction((database, session) => withdrawApplication(database, session, user, id))
    if (action === 'shortlist') return withTransaction((database, session) => reviewApplication(database, session, user, id, body))
    if (action === 'reject') return withTransaction((database, session) => reviewApplication(database, session, user, id, body, true))
    if (action === 'select') return withTransaction((database, session) => selectApplication(database, session, user, id, body))
    if (action === 'administrative') return withTransaction((database, session) => updateAdministrative(database, session, user, id, body))
  }
  if (resource === 'offers' && id && method === 'POST' && ['accept', 'decline', 'rescind'].includes(action || '')) return withTransaction((database, session) => offerAction(database, session, user, id, action as 'accept' | 'decline' | 'rescind', body))
  if (resource === 'appointments' && id && method === 'POST' && ['clearance', 'end', 'suspend', 'resume', 'settle'].includes(action || '')) return withTransaction((database, session) => appointmentAction(database, session, user, id, action!, body))
  if (resource === 'workload' && !id && method === 'POST') return withTransaction((database, session) => recordWorkload(database, session, user, body))
  if (resource === 'projects' && id && method === 'POST' && action === 'workspace') return withTransaction((database, session) => addProjectUpdate(database, session, user, id, body))
  if (resource === 'opportunities' && id && ((method === 'PATCH' && !action) || (method === 'POST' && ['publish', 'approve', 'close', 'cancel', 'archive'].includes(action || '')))) {
    return withTransaction(async (database, session) => {
      const opportunity = await findOpportunity(database, id, session)
      await lockStaffingResource(database, opportunity, session)
      await assertOpportunityManager(database, opportunity, user, session)
      const input = object(body, 'Opportunity action')
      assertVersion(opportunity, input.expectedVersion)
      if (method === 'PATCH') {
        const count = await database.collection('staffingApplications').countDocuments({ opportunityId: id }, { session })
        if (opportunity.status !== 'draft' || count) fail(409, 'Requirements are frozen once published or applications exist. Create a separate opportunity for materially different requirements.')
        const updated = opportunityInput({ ...opportunity, ...input })
        if (updated.courseId !== opportunity.courseId || updated.projectId !== opportunity.projectId || updated.termId !== opportunity.termId || updated.type !== opportunity.type) fail(400, 'Opportunity scope and term cannot be changed')
        const term = await database.collection('staffingTerms').findOne({ id: updated.termId }, { session }) || fail(404, 'Term not found')
        if (updated.appointmentStart < term.startDate || updated.appointmentEnd > term.endDate) fail(400, 'Appointment dates must be within the term')
        await database.collection('staffingOpportunities').updateOne({ id }, { $set: { ...updated, approved: isGlobalAdmin(user) || !updated.approvalRequired, updatedAt: new Date() }, $inc: { version: 1, requirementsVersion: 1 } }, { session })
      } else {
        let status = opportunity.status
        if (action === 'publish') {
          if (!['draft', 'pending_approval', 'applications_closed'].includes(status)) fail(409, 'This opportunity cannot be published from its current state')
          if (opportunity.applicationDeadline <= new Date() || opportunity.appointmentEnd <= new Date()) fail(400, 'Choose future application and appointment deadlines')
          status = opportunity.approved || isGlobalAdmin(user) ? 'published' : 'pending_approval'
        } else if (action === 'approve') {
          if (!isGlobalAdmin(user)) fail(403, 'Only administrators approve staffing requests')
          if (status !== 'pending_approval') fail(409, 'This opportunity is not awaiting approval')
          if (typeof input.approved !== 'boolean') fail(400, 'Approval must be true or false')
          if (input.approved && opportunity.applicationDeadline <= new Date()) fail(409, 'The application deadline has passed')
          status = input.approved ? 'published' : 'draft'
          await database.collection('staffingOpportunities').updateOne({ id }, { $set: { approved: input.approved } }, { session })
        } else if (action === 'close') {
          if (!['published', 'filled'].includes(status)) fail(409, 'Only published opportunities can close applications')
          status = 'applications_closed'
        } else {
          const active = await database.collection('staffingAppointments').countDocuments({ opportunityId: id, status: { $nin: ['ended', 'cancelled', 'not_cleared', 'expired'] } }, { session })
          if (active) fail(409, 'Resolve outstanding offers and appointments before cancelling or archiving')
          status = action === 'cancel' ? 'cancelled' : 'archived'
        }
        await database.collection('staffingOpportunities').updateOne({ id }, { $set: { status, ...(isGlobalAdmin(user) && action === 'publish' ? { approved: true } : {}), updatedAt: new Date() }, $inc: { version: 1 } }, { session })
      }
      await recordEvent(database, session, user, 'OpportunityUpdated', id, { action: action || 'edit' })
      return { opportunity: publicRecord(await database.collection('staffingOpportunities').findOne({ id }, { session })) }
    })
  }
  return fail(404, 'Staffing endpoint not found')
})
