import { createHash } from 'node:crypto'
import { defineEventHandler, createError, getHeader, readRawBody, setHeader } from 'h3'
import { getServerConfig, requestOrigin } from '../utils/config'
import { getDb } from '../utils/db'

/** Browser-origin checks and shared rate counters apply to direct API calls as well as pages. */
export default defineEventHandler(async event => {
  const path = (event.node.req.url || '').split('?')[0] || ''
  if (!path.startsWith('/api/')) return
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setHeader(event, 'X-Frame-Options', 'DENY')
  if (path === '/api/health') return
  const config = getServerConfig()
  const method = event.method.toUpperCase()
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (mutation) {
    const origin = getHeader(event, 'origin')
    if ((origin && origin !== requestOrigin(event)) || getHeader(event, 'sec-fetch-site') === 'cross-site') {
      throw createError({ statusCode: 403, statusMessage: 'Cross-origin mutation rejected' })
    }
    const transfer = getHeader(event, 'transfer-encoding')
    if (transfer && transfer.toLowerCase().includes('chunked')) throw createError({ statusCode: 411, statusMessage: 'A bounded Content-Length is required' })
    const rawLength = getHeader(event, 'content-length')
    if (rawLength !== undefined && (!/^\d+$/.test(rawLength) || Number(rawLength) > config.maxBodyBytes)) throw createError({ statusCode: 413, statusMessage: 'Request body exceeds the allowed size' })
    if (rawLength && Number(rawLength) > 0) {
      const body = await readRawBody(event, false)
      if (body && body.length > config.maxBodyBytes) throw createError({ statusCode: 413, statusMessage: 'Request body exceeds the allowed size' })
      const type = getHeader(event, 'content-type') || ''
      if (!type.startsWith('application/json') && !type.startsWith('multipart/form-data')) throw createError({ statusCode: 415, statusMessage: 'JSON or multipart content is required' })
    }
  }
  const minute = Math.floor(Date.now() / 60_000)
  const login = path === '/api/auth/mock' || path === '/api/auth/gitlab/login'
  const remote = event.node.req.socket.remoteAddress || 'internal'
  const key = createHash('sha256').update((login ? 'login:' : 'api:') + remote + ':' + minute).digest('hex')
  const counters = (await getDb()).collection<any>('requestLimits')
  let count: any
  try {
    count = await counters.findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((minute + 2) * 60_000) } }, { upsert: true, returnDocument: 'after' })
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    count = await counters.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { returnDocument: 'after' })
  }
  const limit = login ? config.loginRateLimit : config.apiRateLimit
  if (Number(count?.count) > limit) {
    setHeader(event, 'Retry-After', 60 - Math.floor(Date.now() / 1000) % 60)
    throw createError({ statusCode: 429, statusMessage: 'Too many requests; retry shortly' })
  }
})
