import { defineEventHandler, getQuery, getRouterParam, readBody, readMultipartFormData, setHeader } from 'h3'
import { isGlobalAdmin, requireUser } from '../../utils/auth'
import { getDb, withTransaction } from '../../utils/db'
import { aiStatus } from '../../utils/ai'
import { actorId, commitmentUnavailable, applicationAccess, applicationDto, appointmentDto, assertOpportunityManager, assertVersion, canManageOpportunity, eligibility, event as recordEvent, fail, findOpportunity, object, publicRecord, staffingCapabilities, text } from '../../utils/staffing'
import { createOpportunity, createTerm, currentOpportunityInput, lockStaffingResource, overview } from '../../utils/staffing-catalog'
import { assertRecruitmentGate, configureRecruitmentCycle, getRecruitmentCycle } from '../../utils/staffing-cycle'
import { applicationDetail, createApplication, reviewApplication, submitApplication, updateApplication, updateAdministrative, uploadCv } from '../../utils/staffing-applications'
import { appointmentAction, offerAction, reconcileDueStaffing, selectApplication, withdrawApplication } from '../../utils/staffing-appointments'
import { courseReview, recordWorkload } from '../../utils/staffing-reports'
import { processStaffingOutbox } from '../../utils/staffing-outbox'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = await getDb()
  const parts = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const [resource, id, action] = parts
  if (parts.length > 3) fail(404, 'Staffing endpoint not found')
  const method = event.method
  if (resource === 'appointments' && id && method === 'POST' && action === 'settle') fail(410, 'This appointment action is no longer available')
  if (!id && resource === 'cycle') {
    if (method === 'GET') { const cycle = await getRecruitmentCycle(db); return { cycle, currentCycle: cycle, serverTime: new Date() } }
    if (method === 'PUT') { const input = await readBody(event); return withTransaction((database, session) => configureRecruitmentCycle(database, session, user, input)) }
  }
  if (!id && resource === 'capabilities' && method === 'GET') return { viewer: await staffingCapabilities(db, user), currentCycle: await getRecruitmentCycle(db), serverTime: new Date() }
  const pageValue = getQuery(event).page
  const page = pageValue === undefined ? 1 : Number(pageValue)
  if (!Number.isInteger(page) || page < 1 || page > 100000) fail(400, 'Page must be a positive integer')
  const offset = (page - 1) * 100
  // Maintenance applies only due canonical transitions and never depends on AI.
  await reconcileDueStaffing(db)
  await processStaffingOutbox(db)
  if (method === 'GET' && resource === 'overview' && !id) {
    const result = await overview(db, user, page)
    const notificationFilter = { recipientId: actorId(user) }
    const [notifications, notificationCount] = await Promise.all([db.collection('staffingNotifications').find(notificationFilter).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray(), db.collection('staffingNotifications').countDocuments(notificationFilter)])
    return { ...result, ai: aiStatus(), notifications: notifications.map(publicRecord), pagination: { ...result.pagination, totals: { ...result.pagination.totals, notifications: notificationCount }, hasMore: result.pagination.hasMore || notificationCount > offset + 100 } }
  }
  if (method === 'GET' && resource === 'opportunities' && id && !action) {
    const opportunity = await findOpportunity(db, id)
    const canManage = await canManageOpportunity(db, opportunity, user)
    const application = await db.collection('staffingApplications').findOne({ opportunityId: id, applicantId: actorId(user) })
    const currentCycle = await getRecruitmentCycle(db)
    const viewer = await staffingCapabilities(db, user)
    if (!canManage && !application && (!viewer.canBrowseStaffing || opportunity.termId !== currentCycle.termId || !['published', 'applications_closed', 'filled'].includes(opportunity.status))) fail(404, 'Opportunity not found')
    const [applications, appointments, offers] = canManage ? await Promise.all([
      db.collection('staffingApplications').find({ opportunityId: id, submittedAt: { $exists: true }, status: { $ne: 'draft' } }).sort({ submittedAt: 1, id: 1 }).skip(offset).limit(100).toArray(),
      db.collection('staffingAppointments').find({ opportunityId: id }).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray(),
      db.collection('staffingOffers').find({ opportunityId: id }).sort({ createdAt: -1, id: 1 }).skip(offset).limit(100).toArray()
    ]) : [[], [], []]
    const totals = canManage ? {
      applications: await db.collection('staffingApplications').countDocuments({ opportunityId: id, submittedAt: { $exists: true }, status: { $ne: 'draft' } }),
      appointments: await db.collection('staffingAppointments').countDocuments({ opportunityId: id }),
      offers: await db.collection('staffingOffers').countDocuments({ opportunityId: id })
    } : { applications: 0, appointments: 0, offers: 0 }
    const reviewed = []
    for (const app of applications) reviewed.push({ ...applicationDto(app, isGlobalAdmin(user)), availability: { unavailable: await commitmentUnavailable(db, app.applicantId, opportunity.termId, opportunity.appointmentStart, opportunity.appointmentEnd), ...eligibility(app, opportunity) } })
    const course = opportunity.courseId ? await db.collection('courses').findOne({ id: opportunity.courseId }, { projection: { id: 1, code: 1, title: 1 } }) : null
    const canAnalyzeCandidates = canManage && currentCycle.canReview && opportunity.termId === currentCycle.termId && opportunity.appointmentEnd > new Date() && ['published', 'applications_closed', 'filled'].includes(opportunity.status)
    const canCloseout = canManage && !['cancelled', 'archived'].includes(opportunity.status) && !await db.collection('staffingAppointments').findOne({ opportunityId: id, status: { $nin: ['ended', 'cancelled', 'not_cleared', 'expired'] } }, { projection: { _id: 1 } })
    return { opportunity: { ...publicRecord(opportunity), canAnalyzeCandidates, ...(opportunity.termId === currentCycle.termId ? { applicationDeadline: currentCycle.closesAt } : {}) }, course: publicRecord(course), currentCycle, viewer, application: application ? applicationDto(application, true) : null, applications: reviewed, appointments: appointments.map(a => appointmentDto(a, user)), offers: offers.map(publicRecord), canManage, canCloseout, ai: aiStatus(), pagination: { page, limit: 100, totals, hasMore: Object.values(totals).some(total => total > offset + 100) } }
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
  if (method === 'GET' && resource === 'reviews' && id && !action) return courseReview(db, user, id, text(getQuery(event).termId, 'Term', 64), page)
  if (method === 'POST' && resource === 'applications' && id && action === 'cv') {
    const form = await readMultipartFormData(event)
    const files = form?.filter(part => part.name === 'file') || []
    const versions = form?.filter(part => part.name === 'expectedVersion') || []
    if (files.length !== 1 || versions.length !== 1 || form!.length !== 2) fail(400, 'Upload one CV file with the current application version')
    const expectedVersion = Number(versions[0]!.data.toString('utf8'))
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) fail(400, 'The current application version is required')
    return withTransaction((database, session) => uploadCv(database, session, user, id, files[0]!, expectedVersion))
  }
  const body = method === 'GET' ? {} : await readBody(event) || {}
  if (method === 'POST' && resource === 'reconcile' && !id) {
    if (!isGlobalAdmin(user)) fail(403, 'Only administrators may request maintenance details')
    return { ...await reconcileDueStaffing(db), outbox: await processStaffingOutbox(db) }
  }
  if (method === 'POST' && resource === 'notifications' && id && action === 'read') {
    const updated = await db.collection('staffingNotifications').updateOne({ id, recipientId: actorId(user) }, { $set: { read: true, readAt: new Date() } })
    if (!updated.matchedCount) fail(404, 'Notification not found')
    return { ok: true }
  }
  if (method === 'POST' && resource === 'terms' && !id) return withTransaction((database, session) => createTerm(database, session, user, body))
  if (method === 'POST' && resource === 'opportunities' && !id) return withTransaction((database, session) => createOpportunity(database, session, user, body))
  if (resource === 'opportunities' && id && method === 'POST' && action === 'applications') return withTransaction((database, session) => createApplication(database, session, user, id))
  if (resource === 'applications' && id && method === 'PATCH' && !action) return withTransaction((database, session) => updateApplication(database, session, user, id, body))
  if (resource === 'applications' && id && method === 'POST') {
    if (action === 'submit') return withTransaction((database, session) => submitApplication(database, session, user, id, body))
    if (action === 'withdraw') return withTransaction((database, session) => withdrawApplication(database, session, user, id))
    if (action === 'shortlist') return withTransaction((database, session) => reviewApplication(database, session, user, id, body))
    if (action === 'reject') return withTransaction((database, session) => reviewApplication(database, session, user, id, body, true))
    if (action === 'select') return withTransaction((database, session) => selectApplication(database, session, user, id, body))
    if (action === 'administrative') return withTransaction((database, session) => updateAdministrative(database, session, user, id, body))
  }
  if (resource === 'offers' && id && method === 'POST' && ['accept', 'decline', 'rescind'].includes(action || '')) return withTransaction((database, session) => offerAction(database, session, user, id, action as 'accept' | 'decline' | 'rescind', body))
  if (resource === 'appointments' && id && method === 'POST' && ['clearance', 'end', 'suspend', 'resume'].includes(action || '')) return withTransaction((database, session) => appointmentAction(database, session, user, id, action!, body))
  if (resource === 'workload' && !id && method === 'POST') return withTransaction((database, session) => recordWorkload(database, session, user, body))
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
        const updated = await currentOpportunityInput(database, session, input, opportunity)
        if (updated.courseId !== opportunity.courseId || updated.termId !== opportunity.termId || updated.type !== opportunity.type) fail(400, 'Opportunity scope and semester cannot be changed')
        const term = await database.collection('staffingTerms').findOne({ id: updated.termId }, { session }) || fail(404, 'Term not found')
        if (updated.appointmentStart < term.startDate || updated.appointmentEnd > term.endDate) fail(400, 'Appointment dates must be within the term')
        const approvalRequired = term.requiresApproval !== false || updated.approvalRequired
        await database.collection('staffingOpportunities').updateOne({ id }, { $set: { ...updated, approvalRequired, approved: isGlobalAdmin(user) || !approvalRequired, updatedAt: new Date() }, $inc: { version: 1, requirementsVersion: 1 } }, { session })
      } else {
        let status = opportunity.status
        if (action === 'publish') {
          await assertRecruitmentGate(database, session, opportunity.termId)
          if (!['draft', 'pending_approval', 'applications_closed'].includes(status)) fail(409, 'This opportunity cannot be published from its current state')
          if (opportunity.appointmentEnd <= new Date()) fail(400, 'The appointment dates have ended')
          status = opportunity.approved || isGlobalAdmin(user) ? 'published' : 'pending_approval'
        } else if (action === 'approve') {
          if (!isGlobalAdmin(user)) fail(403, 'Only administrators approve staffing requests')
          if (status !== 'pending_approval') fail(409, 'This opportunity is not awaiting approval')
          if (typeof input.approved !== 'boolean') fail(400, 'Approval must be true or false')
          if (input.approved) await assertRecruitmentGate(database, session, opportunity.termId)
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
