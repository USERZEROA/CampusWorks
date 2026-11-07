import { getDb } from '../utils/db'
import { runStaffingMaintenance, staffingMaintenanceEnabled, staffingMaintenanceInterval } from '../utils/staffing-maintenance'

export default defineNitroPlugin(nitro => {
  if (!staffingMaintenanceEnabled()) return
  const shutdown = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  const tick = () => {
    if (shutdown.signal.aborted || running) return
    let delay = staffingMaintenanceInterval()
    running = getDb()
      .then(db => runStaffingMaintenance(db, shutdown.signal))
      .then(result => { if (result.hasMore) delay = 250 })
      .catch(() => {
        // Durable retry state is retained. No private payload or external call is logged.
      })
      .finally(() => {
        running = undefined
        if (!shutdown.signal.aborted) {
          timer = setTimeout(tick, delay)
          timer.unref?.()
        }
      })
  }
  tick()
  nitro.hooks.hook('close', async () => {
    shutdown.abort()
    if (timer) clearTimeout(timer)
    await running
  })
})
