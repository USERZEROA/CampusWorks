import type { ClientSession, Db, Document } from 'mongodb'
import { uid } from './staffing'
import { getServerConfig } from './config'

async function activeMockAdministrators(db: Db, session: ClientSession) {
  const sessions = await db.collection('authSessions').find({ 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null }, { session, projection: { userId: 1, 'user.id': 1, 'user.email': 1 } }).toArray()
  const pairs = new Map<string, Set<string>>()
  for (const active of sessions) {
    const id = active.user?.id
    const email = active.user?.email
    if (typeof id !== 'string' || typeof email !== 'string' || active.userId !== id) continue
    const emails = pairs.get(id) || new Set<string>()
    emails.add(email); pairs.set(id, emails)
  }
  if (!pairs.size) return []
  const accounts = (await db.collection('users').find({ id: { $in: [...pairs.keys()] }, disabledAt: null, identityKind: { $ne: 'gitlab' } }, { session, projection: { id: 1, email: 1 } }).toArray()).filter(account => pairs.get(account.id)?.has(account.email))
  if (!accounts.length) return []
  const bindings = await db.collection('providerIdentities').find({ $or: [{ userId: { $in: accounts.map(account => account.id) } }, { email: { $in: accounts.map(account => account.email) } }] }, { session, projection: { userId: 1, email: 1 } }).toArray()
  const boundIds = new Set(bindings.map(binding => binding.userId))
  const boundEmails = new Set(bindings.map(binding => binding.email))
  return accounts.filter(account => !boundIds.has(account.id) && !boundEmails.has(account.email)).map(account => account.id as string)
}

/** Durable, retry-safe in-app delivery. No external mail or model call occurs. */
export async function processStaffingOutbox(db: Db) {
  const pending = await db.collection('staffingEvents').find({ delivery: 'pending' }).sort({ createdAt: 1, id: 1 }).limit(100).toArray()
  const { withTransaction } = await import('./db')
  for (const item of pending) await withTransaction(async (database, session) => {
    const event = await database.collection('staffingEvents').findOneAndUpdate({ id: item.id, delivery: 'pending' }, { $set: { delivery: 'processing' } }, { session, returnDocument: 'after' })
    if (!event) return
    const recipients = new Set<string>()
    let path = '/applications'
    let title = 'A staffing record was updated'
    let opportunity: Document | null = null
    if (event.kind === 'OfferIssued' || event.kind.startsWith('Offer')) {
      const offer = await database.collection('staffingOffers').findOne({ id: event.targetId }, { session })
      if (offer) {
        if (event.kind === 'OfferIssued' || event.kind === 'OfferRescinded') { recipients.add(offer.applicantId); path = `/applications/${offer.applicationId}`; title = event.kind === 'OfferIssued' ? 'An appointment offer is ready for your response' : 'Your appointment offer was rescinded' }
        else {
          const manager = await database.collection('users').findOne({ email: offer.instructorEmail }, { session })
          if (manager) recipients.add(manager.id)
          path = `/staffing/${offer.opportunityId}`; title = 'An appointment offer response changed'
        }
      }
    } else if (event.kind.startsWith('Appointment')) {
      const appointment = await database.collection('staffingAppointments').findOne({ id: event.targetId }, { session })
      if (appointment) { recipients.add(appointment.applicantId); path = `/applications/${appointment.applicationId}`; title = 'Your appointment status changed' }
    } else if (event.kind === 'ApplicationSubmitted') {
      const application = await database.collection('staffingApplications').findOne({ id: event.targetId }, { session })
      if (application) opportunity = await database.collection('staffingOpportunities').findOne({ id: application.opportunityId }, { session })
      title = 'A submitted application is ready for review'
    } else if (event.kind === 'OpportunityUpdated') {
      opportunity = await database.collection('staffingOpportunities').findOne({ id: event.targetId, status: 'pending_approval' }, { session })
      if (opportunity) {
        const config = getServerConfig()
        const admins = await database.collection('users').find({ email: { $in: config.adminEmails }, disabledAt: null }, { session }).toArray()
        for (const admin of admins) recipients.add(admin.id)
        if (config.mockLoginEnabled) {
          for (const id of await activeMockAdministrators(database, session)) recipients.add(id)
        }
        path = '/admin/staffing'; title = 'A staffing request is awaiting approval'; opportunity = null
      }
    }
    if (opportunity) {
      const emails = opportunity.type === 'ta'
        ? (await database.collection('enrollments').find({ courseId: opportunity.courseId, role: { $in: ['instructor', 'admin'] } }, { session }).toArray()).map(r => r.userEmail)
        : [opportunity.ownerEmail]
      const users = await database.collection('users').find({ email: { $in: emails } }, { session }).toArray()
      for (const user of users) recipients.add(user.id)
      path = `/staffing/${opportunity.id}`
    }
    for (const recipientId of recipients) await database.collection('staffingNotifications').updateOne({ eventId: event.id, recipientId }, { $setOnInsert: { id: uid(), eventId: event.id, recipientId, title, path, createdAt: new Date(), read: false } }, { session, upsert: true })
    await database.collection('staffingEvents').updateOne({ id: event.id, delivery: 'processing' }, { $set: { delivery: 'delivered', deliveredAt: new Date(), recipientCount: recipients.size, channel: 'in-app' } }, { session })
  })
  return { processed: pending.length, hasMore: pending.length === 100 }
}
