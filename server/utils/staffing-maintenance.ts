import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Db } from 'mongodb'
import { reconcileDueStaffing } from './staffing-appointments'
import { processStaffingOutbox } from './staffing-outbox'

const controlId = 'staffing-maintenance'
const setting = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}
export const staffingMaintenanceEnabled = () => process.env.STAFFING_MAINTENANCE_ENABLED !== 'false'
export const staffingMaintenanceInterval = () => setting('STAFFING_MAINTENANCE_INTERVAL_MS', 5000, 100, 60000)
export type MaintenanceResult = { acquired: boolean; batches: number; hasMore: boolean }

/** Existing domain transactions remain the authority for every transition and delivery. */
export async function runStaffingMaintenance(db: Db, signal?: AbortSignal): Promise<MaintenanceResult> {
  const empty = { acquired: false, batches: 0, hasMore: false }
  if (!staffingMaintenanceEnabled() || signal?.aborted) return empty
  const controls = db.collection<any>('staffingMaintenanceControl')
  try {
    await controls.updateOne({ _id: controlId }, { $setOnInsert: { leaseUntil: new Date(0), nextAttemptAt: new Date(0), nextPhase: 'appointments', failures: 0 } }, { upsert: true })
  } catch (error: any) {
    // Two processes may initialize the same uniquely identified control record.
    if (error?.code !== 11000) throw error
  }
  if (signal?.aborted) return empty
  const token = randomUUID()
  const leaseMs = setting('STAFFING_MAINTENANCE_LEASE_MS', 90000, 5000, 180000)
  const control = await controls.findOneAndUpdate({ _id: controlId, leaseUntil: { $lte: new Date() }, nextAttemptAt: { $lte: new Date() } }, {
    $set: { leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs), startedAt: new Date() }, $inc: { runs: 1 },
  }, { returnDocument: 'after' })
  if (!control) return empty
  let lost = false
  let renewing: Promise<void> | undefined
  const renew = async () => {
    if (lost || signal?.aborted) return false
    const result = await controls.updateOne({ _id: controlId, leaseToken: token, leaseUntil: { $gt: new Date() } }, { $set: { leaseUntil: new Date(Date.now() + leaseMs) } })
    if (!result.matchedCount) lost = true
    return !lost && !signal?.aborted
  }
  // A bounded domain batch may legitimately outlast the scheduling budget.
  const heartbeat = setInterval(() => {
    if (renewing || lost || signal?.aborted) return
    renewing = renew().then(() => undefined).catch(() => { lost = true }).finally(() => { renewing = undefined })
  }, Math.max(250, Math.floor(leaseMs / 3)))
  heartbeat.unref?.()
  const start = performance.now()
  const budget = setting('STAFFING_MAINTENANCE_WORK_MS', 2000, 100, 15000)
  const batchLimit = setting('STAFFING_MAINTENANCE_MAX_BATCHES', 4, 1, 20)
  let phase: 'appointments' | 'outbox' = control.nextPhase === 'outbox' ? 'outbox' : 'appointments'
  const pending: { appointments: boolean | null; outbox: boolean | null } = control.hasMore && control.pending
    ? { appointments: control.pending.appointments ?? null, outbox: control.pending.outbox ?? null }
    : { appointments: null, outbox: null }
  let hasMore = true
  let batches = 0
  let failure = false
  try {
    while (batches < batchLimit && performance.now() - start < budget && hasMore) {
      if (!await renew() || lost || signal?.aborted) break
      if (phase === 'appointments') pending.appointments = (await reconcileDueStaffing(db)).hasMore
      else pending.outbox = (await processStaffingOutbox(db)).hasMore
      batches++
      phase = phase === 'appointments' ? 'outbox' : 'appointments'
      if (pending.appointments !== null && pending.outbox !== null) {
        hasMore = pending.appointments || pending.outbox
        // Revisit both lanes on each continuation round so new work cannot starve.
        if (hasMore) { pending.appointments = null; pending.outbox = null }
      }
      // Persist fairness even if the current process exits before the next batch.
      const updated = await controls.updateOne({ _id: controlId, leaseToken: token }, { $set: { nextPhase: phase, pending, hasMore, lastBatchAt: new Date() } })
      if (!updated.matchedCount) { lost = true; break }
    }
  } catch {
    failure = true
    // A failing resource must not prevent the other maintenance lane from progressing.
    phase = phase === 'appointments' ? 'outbox' : 'appointments'
  } finally {
    clearInterval(heartbeat)
    await renewing
    if (!lost) {
      const failures = failure ? Math.min(Number(control.failures || 0) + 1, 16) : hasMore ? Number(control.failures || 0) : 0
      const delay = failure
        ? Math.min(60000, staffingMaintenanceInterval() * 2 ** Math.min(failures - 1, 5))
        : hasMore && !signal?.aborted ? 250 : staffingMaintenanceInterval()
      await controls.updateOne({ _id: controlId, leaseToken: token }, {
        $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(Date.now() + delay), nextPhase: phase, pending, failures, hasMore, status: failure ? 'retrying' : signal?.aborted ? 'stopped' : 'idle', completedAt: new Date(), batches },
        $unset: { leaseToken: '' },
      })
    }
  }
  return { acquired: true, batches, hasMore: !failure && hasMore }
}
