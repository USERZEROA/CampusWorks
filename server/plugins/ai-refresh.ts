import { getDb } from '../utils/db'
import { runAiRefreshCycle } from '../utils/ai-refresh'
import { automaticDiscoveryEnabled, runAiAutomationDiscovery, runAiAutomationExecution } from '../utils/ai-automation'

export default defineNitroPlugin((nitro) => {
  // A provider-disabled app performs no background AI scans or writes.
  if (process.env.AI_AUTO_REFRESH_ENABLED === 'false' || !process.env.AI_BASE_URL?.trim() || !process.env.AI_API_KEY?.trim() || !process.env.AI_MODEL?.trim()) return
  const shutdown = new AbortController()
  let running: Promise<void> | null = null
  let discovery: Promise<void> | null = null
  let execution: Promise<void> | null = null
  const tick = () => {
    if (shutdown.signal.aborted) return
    if (automaticDiscoveryEnabled()) {
      if (!discovery) discovery = getDb().then(db => runAiAutomationDiscovery(db, shutdown.signal)).catch(() => {}).finally(() => { discovery = null })
      if (!execution) execution = getDb().then(db => runAiAutomationExecution(db, shutdown.signal)).catch(() => {}).finally(() => { execution = null })
      return
    }
    if (running) return
    running = getDb().then(db => runAiRefreshCycle(db, shutdown.signal)).catch(() => {
      // Durable state is retained; provider/private payloads are never logged.
    }).finally(() => { running = null })
  }
  const timer = setInterval(tick, 500)
  timer.unref?.()
  tick()
  nitro.hooks.hook('close', async () => { clearInterval(timer); shutdown.abort(); await Promise.allSettled([running, discovery, execution]) })
})
