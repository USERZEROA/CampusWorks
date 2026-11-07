import { createHash } from 'node:crypto'
import type { ClientSession, Db, Document } from 'mongodb'
import { isGlobalAdmin } from './auth'
import { invalidateCandidateRefresh } from './ai-refresh'
import { releaseStaffClaims } from './queue'
import { lockStaffingResource } from './staffing-catalog'
import { actorId, applicationAccess, applicationDto, appointmentDto, assertOpportunityManager, assertVersion, commitmentUnavailable, eligibility, event, fail, findOpportunity, getAppointmentCourseRole, lockApplicantCommitments, number, object, publicRecord, text, uid, type StaffingActor } from './staffing'

const terminalAppointments = ['ended', 'cancelled', 'not_cleared', 'expired']
const safeAllocationId = (applicantId: string, termId: string) => createHash('sha256').update(`${termId}\0${applicantId}`).digest('hex')

async function releaseAppointmentAuthority(db: Db, session: ClientSession, appointment: Document) {
  if (appointment.type !== 'ta') return
  const manual = await db.collection('enrollments').findOne({ courseId: appointment.courseId, userEmail: appointment.applicantEmail, role: { $in: ['ta', 'instructor', 'admin'] } }, { session })
  const another = await getAppointmentCourseRole(db, appointment.courseId, appointment.applicantEmail, session)
  if (!manual && !another) {
    await db.collection('courses').updateOne({ id: appointment.courseId }, { $pull: { onDutyTAs: { email: appointment.applicantEmail } } as any }, { session })
    // Preserve the student's queue request while releasing staff authority.
    await releaseStaffClaims(db, appointment.courseId, appointment.applicantEmail, session)
  }
}

async function releaseCommitments(db: Db, session: ClientSession, appointment: Document, status: string, reason: string) {
  // Every caller holds the canonical resource and stable applicant locks.
  if (terminalAppointments.includes(appointment.status)) return
  const opportunity = await findOpportunity(db, appointment.opportunityId, session)
  const retainBudget = !!appointment.activatedAt || (!!appointment.acceptedAt && appointment.clearance === 'cleared' && appointment.startDate <= new Date())
  const releasedBudget = retainBudget ? 0 : appointment.committedCost
  await db.collection('staffingOpportunities').updateOne({ id: opportunity.id }, {
    $inc: { committedPositions: -1, committedBudget: -releasedBudget, version: 1 },
    $set: { status: opportunity.status === 'filled' ? (opportunity.applicationDeadline > new Date() ? 'published' : 'applications_closed') : opportunity.status, updatedAt: new Date() }
  }, { session })
  await db.collection('staffingAppointments').updateOne({ id: appointment.id }, { $set: { status, endReason: reason, endedAt: new Date(), budgetStatus: retainBudget ? 'awaiting_settlement' : 'released', releasedBudget }, $inc: { version: 1 } }, { session })
  await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: 'released', releasedAt: new Date() }, $inc: { version: 1 } }, { session })
  await db.collection('staffingOffers').updateOne({ id: appointment.offerId, status: { $in: ['issued', 'accepted'] } }, { $set: { status: status === 'expired' ? 'expired' : 'rescinded', resolvedAt: new Date() } }, { session })
  if (!appointment.acceptedAt) await db.collection('staffingApplications').updateOne({ id: appointment.applicationId, status: 'selected' }, { $set: { status: 'under_review', updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  await invalidateCandidateRefresh(db, session, { applicantId: appointment.applicantId })
  await releaseAppointmentAuthority(db, session, appointment)
}

export async function reconcileStaffing(db: Db, session: ClientSession, resource?: { courseId?: string; projectId?: string }, additionalApplicantIds: string[] = []) {
  const filter: Document = { status: { $nin: terminalAppointments }, $or: [{ endDate: { $lte: new Date() } }, { status: 'pending_start', startDate: { $lte: new Date() } }, { status: 'offered', offerExpiresAt: { $lte: new Date() } }] }
  if (resource?.courseId) filter.courseId = resource.courseId
  if (resource?.projectId) filter.projectId = resource.projectId
  const appointments = await db.collection('staffingAppointments').find(filter, { session }).limit(500).toArray()
  // A resource may contain several applicants; preserve one shared lock order.
  for (const applicantId of [...new Set([...additionalApplicantIds, ...appointments.map(appointment => appointment.applicantId as string)])].sort()) await lockApplicantCommitments(db, applicantId, session, true)
  for (const appointment of appointments) {
    const offer = await db.collection('staffingOffers').findOne({ id: appointment.offerId }, { session })
    if (appointment.status === 'offered' && offer?.status === 'issued' && offer.expiresAt <= new Date()) {
      await releaseCommitments(db, session, appointment, 'expired', 'Offer response deadline passed')
      await db.collection('staffingEvents').insertOne({ id: uid(), actorId: 'system', actorEmail: '', kind: 'AppointmentExpired', targetId: appointment.id, details: {}, createdAt: new Date(), delivery: 'pending' }, { session })
    } else if (appointment.endDate <= new Date()) {
      await releaseCommitments(db, session, appointment, 'ended', 'Appointment end date reached')
      await db.collection('staffingEvents').insertOne({ id: uid(), actorId: 'system', actorEmail: '', kind: 'AppointmentEnded', targetId: appointment.id, details: {}, createdAt: new Date(), delivery: 'pending' }, { session })
    } else if (appointment.status === 'pending_start' && appointment.startDate <= new Date() && appointment.clearance === 'cleared' && appointment.acceptedAt) {
      if (!await db.collection('users').findOne({ id: appointment.applicantId, disabledAt: null }, { session, projection: { _id: 1 } })) {
        await db.collection('staffingAppointments').updateOne({ id: appointment.id, status: 'pending_start' }, { $set: { status: 'suspended', suspensionReason: 'Candidate account disabled before the appointment started' }, $inc: { version: 1 } }, { session })
        await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: 'suspended' }, $inc: { version: 1 } }, { session })
        await releaseAppointmentAuthority(db, session, appointment)
        await invalidateCandidateRefresh(db, session, { applicantId: appointment.applicantId })
        await db.collection('staffingEvents').insertOne({ id: uid(), actorId: 'system', actorEmail: '', kind: 'AppointmentSuspend', targetId: appointment.id, details: { reason: 'Candidate account disabled before appointment start' }, createdAt: new Date(), delivery: 'pending' }, { session })
        continue
      }
      await db.collection('staffingAppointments').updateOne({ id: appointment.id, status: 'pending_start' }, { $set: { status: 'active', activatedAt: new Date() }, $inc: { version: 1 } }, { session })
      await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: 'active' }, $inc: { version: 1 } }, { session })
      await db.collection('staffingEvents').insertOne({ id: uid(), actorId: 'system', actorEmail: '', kind: 'AppointmentActivated', targetId: appointment.id, details: {}, createdAt: new Date(), delivery: 'pending' }, { session })
    }
  }
}

/** Each resource gets its own transaction; bounded maintenance is safe to retry. */
export async function reconcileDueStaffing(db: Db) {
  const due = await db.collection('staffingAppointments').find({ status: { $nin: terminalAppointments }, $or: [{ endDate: { $lte: new Date() } }, { status: 'pending_start', startDate: { $lte: new Date() } }, { status: 'offered', offerExpiresAt: { $lte: new Date() } }] }).limit(100).toArray()
  const { withTransaction } = await import('./db')
  const seen = new Set<string>()
  for (const appointment of due) {
    const key = `${appointment.type}:${appointment.courseId || appointment.projectId}`
    if (seen.has(key)) continue
    seen.add(key)
    await withTransaction(async (database, session) => {
      await lockStaffingResource(database, appointment, session)
      await reconcileStaffing(database, session, appointment.type === 'ta' ? { courseId: appointment.courseId } : { projectId: appointment.projectId })
    })
  }
  return { resourcesChecked: seen.size, hasMore: due.length === 100 }
}

export async function selectApplication(db: Db, session: ClientSession, user: StaffingActor, applicationId: string, raw: unknown) {
  const initial = await applicationAccess(db, applicationId, user, session)
  await lockStaffingResource(db, initial.opportunity, session)
  await assertOpportunityManager(db, initial.opportunity, user, session)
  await reconcileStaffing(db, session, initial.opportunity.type === 'ta' ? { courseId: initial.opportunity.courseId } : { projectId: initial.opportunity.projectId }, [initial.application.applicantId])
  const body = object(raw, 'Selection')
  const key = text(body.idempotencyKey, 'Idempotency key', 128, true)
  if (key.length < 8) fail(400, 'Idempotency key must contain at least eight characters')
  const prior = await db.collection('staffingCommands').findOne({ actorId: actorId(user), key }, { session })
  if (prior) {
    if (prior.applicationId !== applicationId || prior.kind !== 'select') fail(409, 'Idempotency key was already used for another command')
    const offer = await db.collection('staffingOffers').findOne({ id: prior.offerId }, { session })
    const appointment = await db.collection('staffingAppointments').findOne({ id: prior.appointmentId }, { session })
    return { offer: publicRecord(offer), appointment: appointmentDto(appointment, user), replayed: true }
  }
  const application = await db.collection('staffingApplications').findOne({ id: applicationId }, { session }) || fail(404, 'Application not found')
  const opportunity = await findOpportunity(db, application.opportunityId, session)
  await lockApplicantCommitments(db, application.applicantId, session)
  assertVersion(application, body.expectedVersion)
  if (!['submitted', 'under_review', 'shortlisted'].includes(application.status)) fail(409, 'Only current submitted applications may be selected')
  if (!['published', 'applications_closed', 'filled'].includes(opportunity.status) || !opportunity.approved || opportunity.appointmentEnd <= new Date()) fail(409, 'This opportunity is not available for selection')
  if (opportunity.committedPositions >= opportunity.positions || opportunity.committedBudget + opportunity.appointmentCost > opportunity.budget + 0.001) fail(409, 'No approved position or budget remains')
  const eligible = eligibility(application, opportunity)
  if (!eligible.eligible) fail(409, eligible.reasons.join('; '))
  if (application.applicantEmail === user.email) fail(403, 'Reviewers cannot select themselves')
  if (await commitmentUnavailable(db, application.applicantId, opportunity.termId, opportunity.appointmentStart, opportunity.appointmentEnd, session)) fail(409, 'Candidate already holds an appointment in this term or overlapping these dates. Refresh to see the next eligible applicant.')
  // An expired offer does not reserve the applicant. Its original resource keeps
  // its financial reservation until maintenance releases it with the old offer ID.
  const offerId = uid()
  const appointmentId = uid()
  const expiresAt = new Date(Math.min(Date.now() + 7 * 86400000, opportunity.appointmentEnd.getTime()))
  const offer = { id: offerId, applicationId, opportunityId: opportunity.id, appointmentId, applicantId: application.applicantId, applicantEmail: application.applicantEmail, instructorEmail: user.email, status: 'issued', version: 1, termId: opportunity.termId, title: opportunity.title, type: opportunity.type, courseId: opportunity.courseId, projectId: opportunity.projectId, startDate: opportunity.appointmentStart, endDate: opportunity.appointmentEnd, weeklyHours: opportunity.weeklyHours, duties: opportunity.duties, committedCost: opportunity.appointmentCost, expiresAt, createdAt: new Date() }
  const appointment = { id: appointmentId, offerId, applicationId, opportunityId: opportunity.id, applicantId: application.applicantId, applicantEmail: application.applicantEmail, applicantName: application.applicantName, instructorEmail: user.email, termId: opportunity.termId, title: opportunity.title, type: opportunity.type, courseId: opportunity.courseId, projectId: opportunity.projectId, startDate: opportunity.appointmentStart, endDate: opportunity.appointmentEnd, offerExpiresAt: expiresAt, weeklyHours: opportunity.weeklyHours, committedCost: opportunity.appointmentCost, status: 'offered', clearance: 'not_started', version: 1, acceptedAt: null, activatedAt: null, createdAt: new Date() }
  await db.collection('staffingAllocations').updateOne({ applicantId: application.applicantId, termId: opportunity.termId }, { $set: { offerId, appointmentId, opportunityId: opportunity.id, status: 'offered', expiresAt, endDate: opportunity.appointmentEnd, updatedAt: new Date() }, $setOnInsert: { _id: safeAllocationId(application.applicantId, opportunity.termId) } as any, $inc: { version: 1 } }, { session, upsert: true })
  await db.collection('staffingOffers').insertOne(offer, { session })
  await db.collection('staffingAppointments').insertOne(appointment, { session })
  await db.collection('staffingOpportunities').updateOne({ id: opportunity.id }, { $inc: { committedPositions: 1, committedBudget: opportunity.appointmentCost, version: 1 }, $set: { status: opportunity.committedPositions + 1 === opportunity.positions ? 'filled' : opportunity.status, updatedAt: new Date() } }, { session })
  await db.collection('staffingApplications').updateOne({ id: applicationId }, { $set: { status: 'selected', updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  await db.collection('staffingCommands').insertOne({ actorId: actorId(user), key, kind: 'select', applicationId, offerId, appointmentId, createdAt: new Date() }, { session })
  await invalidateCandidateRefresh(db, session, { applicantId: application.applicantId })
  await event(db, session, user, 'OfferIssued', offerId, { opportunityId: opportunity.id, applicationId, appointmentId })
  return { offer: publicRecord(offer), appointment: appointmentDto(appointment, user), replayed: false }
}

export async function offerAction(db: Db, session: ClientSession, user: StaffingActor, offerId: string, action: 'accept' | 'decline' | 'rescind', raw: unknown) {
  const offer = await db.collection('staffingOffers').findOne({ id: offerId }, { session }) || fail(404, 'Offer not found')
  const opportunity = await findOpportunity(db, offer.opportunityId, session)
  await lockStaffingResource(db, opportunity, session)
  const appointment = await db.collection('staffingAppointments').findOne({ id: offer.appointmentId }, { session }) || fail(404, 'Appointment not found')
  const owner = offer.applicantId === actorId(user)
  if (action === 'rescind') await assertOpportunityManager(db, opportunity, user, session)
  else if (!owner) fail(403, 'Only the candidate may answer this offer')
  await lockApplicantCommitments(db, appointment.applicantId, session, action !== 'accept')
  if (action === 'accept' && offer.status === 'accepted') return { offer: publicRecord(offer), appointment: appointmentDto(appointment, user) }
  if (action === 'decline' && offer.status === 'declined') return { offer: publicRecord(offer), appointment: appointmentDto(appointment, user) }
  if (action === 'rescind' && offer.status === 'rescinded') return { offer: publicRecord(offer), appointment: appointmentDto(appointment, user) }
  if (offer.status !== 'issued' || appointment.status !== 'offered' || offer.expiresAt <= new Date() || appointment.endDate <= new Date()) fail(409, 'This offer is no longer open')
  const allocation = await db.collection('staffingAllocations').findOne({ applicantId: offer.applicantId, termId: offer.termId, offerId, status: 'offered' }, { session })
  if (!allocation) fail(409, 'The candidate allocation changed')
  if (action === 'accept') {
    if (await commitmentUnavailable(db, appointment.applicantId, appointment.termId, appointment.startDate, appointment.endDate, session, appointment.id)) fail(409, 'Another appointment conflicts with this offer')
    await db.collection('staffingOffers').updateOne({ id: offerId }, { $set: { status: 'accepted', acceptedAt: new Date() }, $inc: { version: 1 } }, { session })
    await db.collection('staffingAppointments').updateOne({ id: appointment.id }, { $set: { status: 'pending_clearance', clearance: 'pending', acceptedAt: new Date() }, $inc: { version: 1 } }, { session })
    await db.collection('staffingAllocations').updateOne({ _id: allocation._id, offerId }, { $set: { status: 'accepted_pending_clearance', expiresAt: offer.endDate }, $inc: { version: 1 } }, { session })
  } else {
    const body = object(raw || {}, 'Offer response')
    await releaseCommitments(db, session, appointment, 'cancelled', text(body.reason, 'Reason', 2000) || (action === 'decline' ? 'Candidate declined' : 'Reviewer rescinded'))
    await db.collection('staffingOffers').updateOne({ id: offerId }, { $set: { status: action === 'decline' ? 'declined' : 'rescinded', resolvedAt: new Date() }, $inc: { version: 1 } }, { session })
    await db.collection('staffingApplications').updateOne({ id: offer.applicationId }, { $set: { status: 'under_review', updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  }
  if (action === 'accept') await invalidateCandidateRefresh(db, session, { applicantId: appointment.applicantId })
  await event(db, session, user, `Offer${action === 'accept' ? 'Accepted' : action === 'decline' ? 'Declined' : 'Rescinded'}`, offerId)
  return { offer: publicRecord(await db.collection('staffingOffers').findOne({ id: offerId }, { session })), appointment: appointmentDto(await db.collection('staffingAppointments').findOne({ id: appointment.id }, { session }), user) }
}

export async function appointmentAction(db: Db, session: ClientSession, user: StaffingActor, id: string, action: string, raw: unknown) {
  const appointment = await db.collection('staffingAppointments').findOne({ id }, { session }) || fail(404, 'Appointment not found')
  const opportunity = await findOpportunity(db, appointment.opportunityId, session)
  await lockStaffingResource(db, opportunity, session)
  const body = object(raw || {}, 'Appointment action')
  const grantsAuthority = action === 'resume' || (action === 'clearance' && body.status === 'cleared')
  await assertOpportunityManager(db, opportunity, user, session)
  await lockApplicantCommitments(db, appointment.applicantId, session, !grantsAuthority)
  const reason = text(body.reason, 'Reason', 2000)
  if (['clearance', 'settle'].includes(action) && !isGlobalAdmin(user)) fail(403, 'Only site administrators may process clearance or financial settlement')
  if (action === 'clearance') {
    const status = text(body.status, 'Clearance status', 32, true)
    if (!['cleared', 'needs_information', 'not_cleared'].includes(status)) fail(400, 'Invalid clearance status')
    if (!appointment.acceptedAt || !['pending_clearance', 'pending_start'].includes(appointment.status)) fail(409, 'A candidate must accept the offer before clearance')
    if (appointment.endDate <= new Date()) fail(409, 'The appointment dates have ended')
    if (status === 'cleared' && await commitmentUnavailable(db, appointment.applicantId, appointment.termId, appointment.startDate, appointment.endDate, session, appointment.id)) fail(409, 'Another appointment conflicts with these dates')
    if (status === 'not_cleared') {
      await releaseCommitments(db, session, appointment, 'not_cleared', 'Administrative clearance was not granted')
      await db.collection('staffingAppointments').updateOne({ id }, { $set: { clearance: 'not_cleared', clearanceReason: reason, clearedBy: user.email } }, { session })
    }
    else {
      const state = status === 'cleared' ? appointment.startDate <= new Date() ? 'active' : 'pending_start' : 'pending_clearance'
      await db.collection('staffingAppointments').updateOne({ id }, { $set: { clearance: status, clearanceReason: reason, clearedBy: user.email, status: state, ...(state === 'active' ? { activatedAt: new Date() } : {}) }, $inc: { version: 1 } }, { session })
      await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: state === 'active' ? 'active' : 'accepted_pending_clearance' }, $inc: { version: 1 } }, { session })
    }
  } else if (action === 'end') {
    await releaseCommitments(db, session, appointment, 'ended', reason || 'Appointment ended by an authorized manager')
  } else if (action === 'suspend') {
    if (appointment.status !== 'active') fail(409, 'Only an active appointment may be suspended')
    await db.collection('staffingAppointments').updateOne({ id }, { $set: { status: 'suspended', suspensionReason: reason }, $inc: { version: 1 } }, { session })
    await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: 'suspended' }, $inc: { version: 1 } }, { session })
    await releaseAppointmentAuthority(db, session, appointment)
  } else if (action === 'resume') {
    if (appointment.status !== 'suspended' || appointment.clearance !== 'cleared' || appointment.endDate <= new Date()) fail(409, 'This appointment cannot be resumed')
    if (await commitmentUnavailable(db, appointment.applicantId, appointment.termId, appointment.startDate, appointment.endDate, session, appointment.id)) fail(409, 'Another appointment conflicts with these dates')
    const state = appointment.startDate <= new Date() ? 'active' : 'pending_start'
    await db.collection('staffingAppointments').updateOne({ id }, { $set: { status: state }, $inc: { version: 1 } }, { session })
    await db.collection('staffingAllocations').updateOne({ applicantId: appointment.applicantId, termId: appointment.termId, offerId: appointment.offerId }, { $set: { status: state === 'active' ? 'active' : 'accepted_pending_clearance' }, $inc: { version: 1 } }, { session })
  } else if (action === 'settle') {
    if (appointment.budgetStatus !== 'awaiting_settlement') fail(409, 'No unsettled commitment remains')
    const incurredCost = number(body.incurredCost, 'Approved incurred cost', 0, appointment.committedCost)
    const unused = appointment.committedCost - incurredCost
    await db.collection('staffingOpportunities').updateOne({ id: opportunity.id }, { $inc: { committedBudget: -unused, version: 1 } }, { session })
    await db.collection('staffingAppointments').updateOne({ id }, { $set: { budgetStatus: 'settled', incurredCost, releasedBudget: unused, settledBy: user.email }, $inc: { version: 1 } }, { session })
  } else fail(404, 'Unknown appointment action')
  if (!['end', 'settle'].includes(action) && !(action === 'clearance' && body.status === 'not_cleared')) await invalidateCandidateRefresh(db, session, { applicantId: appointment.applicantId })
  await event(db, session, user, `Appointment${action[0]!.toUpperCase() + action.slice(1)}`, id)
  return { appointment: appointmentDto(await db.collection('staffingAppointments').findOne({ id }, { session }), user) }
}

export async function withdrawApplication(db: Db, session: ClientSession, user: StaffingActor, id: string) {
  const { application, opportunity, owner } = await applicationAccess(db, id, user, session)
  await lockStaffingResource(db, opportunity, session)
  await lockApplicantCommitments(db, application.applicantId, session, true)
  if (!owner) fail(403, 'Only the applicant may withdraw')
  if (application.status === 'withdrawn') return { application: applicationDto(application, true) }
  const appointment = await db.collection('staffingAppointments').findOne({ applicationId: id, status: { $nin: terminalAppointments } }, { session })
  if (appointment?.acceptedAt) fail(409, 'An accepted appointment must be ended through its appointment lifecycle')
  if (appointment) await releaseCommitments(db, session, appointment, 'cancelled', 'Applicant withdrew before accepting')
  else await invalidateCandidateRefresh(db, session, { opportunityId: opportunity.id })
  await db.collection('staffingApplications').updateOne({ id }, { $set: { status: 'withdrawn', updatedAt: new Date() }, $inc: { version: 1 } }, { session })
  await event(db, session, user, 'ApplicationWithdrawn', id)
  return { application: applicationDto((await db.collection('staffingApplications').findOne({ id }, { session }))!, true) }
}
