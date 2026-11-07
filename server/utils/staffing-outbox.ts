import type { Db, Document } from 'mongodb'
import { uid } from './staffing'
import { getServerConfig } from './config'

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
        if (event.kind === 'OfferIssued') { recipients.add(offer.applicantId); path = `/applications/${offer.applicationId}`; title = 'An appointment offer is ready for your response' }
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
        const admins = await database.collection('users').find({ email: { $in: config.adminEmails } }, { session }).toArray()
        for (const admin of admins) recipients.add(admin.id)
        if (config.mockLoginEnabled) {
          const activeSessions = await database.collection('authSessions').find({ 'user.provider': 'mock', 'user.primaryRole': 'admin', expiresAt: { $gt: new Date() }, revokedAt: null }, { session, projection: { 'user.id': 1, 'user.email': 1 } }).toArray()
          for (const active of activeSessions) {
            const account = await database.collection('users').findOne({ id: active.user?.id, email: active.user?.email }, { session })
            if (account) recipients.add(account.id)
          }
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
