import { getDb } from '../utils/db'
import { runAiRefreshCycle } from '../utils/ai-refresh'

export default defineNitroPlugin((nitro) => {
  // A provider-disabled app performs no background AI scans or writes.
  if (!process.env.AI_BASE_URL?.trim() || !process.env.AI_API_KEY?.trim() || !process.env.AI_MODEL?.trim()) return
  const shutdown = new AbortController()
  let running: Promise<void> | null = null
  const tick = () => {
    if (shutdown.signal.aborted || running) return
    running = getDb().then(db => runAiRefreshCycle(db, shutdown.signal)).catch(() => {
      // Durable state is retained; provider/private payloads are never logged.
    }).finally(() => { running = null })
  }
  const timer = setInterval(tick, 500)
  timer.unref?.()
  tick()
  nitro.hooks.hook('close', async () => { clearInterval(timer); shutdown.abort(); await running })
})
