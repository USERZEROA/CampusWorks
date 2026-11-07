// server/middleware/logging.ts
import { defineEventHandler } from 'h3'

/**
 * Access log for API requests (method, path, status, duration).
 * Static assets and health probes are skipped to keep logs readable.
 */
export default defineEventHandler((event) => {
  const { req, res } = event.node
  const url = req.url || ''
  if (!url.startsWith('/api/') || url.startsWith('/api/health')) return

  const startedAt = Date.now()
  res.once('finish', () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${url.split('?')[0]} ` +
        `${res.statusCode} ${Date.now() - startedAt}ms ` +
        `(remote=${req.socket.remoteAddress ?? 'unknown'})`
    )
  })
})
