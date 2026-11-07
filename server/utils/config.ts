import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'

export type ServerConfig = {
  mongodbUri: string; mongodbDb: string; sessionSecret: string
  mockLoginEnabled: boolean; seedDemoData: boolean; adminEmails: string[]; allowedEmailDomains: string[]
  publicOrigin: string; trustProxy: boolean; maxBodyBytes: number; apiRateLimit: number; loginRateLimit: number
  historyRetentionDays: number
  gitlab: { baseUrl: string; clientId: string; clientSecret: string }
}
const toList = (value = '') => value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const toFlag = (value: string | undefined, fallback: boolean) => value?.trim() ? ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) : fallback
const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('Invalid integer server setting')
  return parsed
}
let cached: ServerConfig | null = null
export function getServerConfig(): ServerConfig {
  if (cached) return cached
  const env = process.env
  const production = env.NODE_ENV === 'production'
  const sessionSecret = env.SESSION_SECRET || (production ? '' : 'campusworks-local-development-secret-change-for-production')
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
  let publicOrigin = ''
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without credentials or a path')
    publicOrigin = url.origin
  }
  const gitlab = {
    baseUrl: (env.GITLAB_BASE_URL || '').trim().replace(/\/+$/, ''),
    clientId: (env.GITLAB_CLIENT_ID || '').trim(), clientSecret: (env.GITLAB_CLIENT_SECRET || '').trim()
  }
  if (gitlab.baseUrl) {
    const url = new URL(gitlab.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (production && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('GITLAB_BASE_URL must use a trusted HTTPS provider in production')
  }
  if (production && gitlab.clientId && gitlab.clientSecret && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required for production OAuth')
  cached = {
    mongodbUri: env.MONGODB_URI || '', mongodbDb: env.MONGODB_DB || 'campusworks', sessionSecret,
    mockLoginEnabled: toFlag(env.ENABLE_MOCK_LOGIN, !production), seedDemoData: toFlag(env.SEED_DEMO_DATA, false),
    adminEmails: toList(env.ADMIN_EMAILS), allowedEmailDomains: toList(env.ALLOWED_EMAIL_DOMAINS).map(d => d.replace(/^@/, '')),
    publicOrigin, trustProxy: toFlag(env.TRUST_PROXY, false),
    maxBodyBytes: integer(env.MAX_BODY_BYTES, 12 * 1024 * 1024, 1024, 32 * 1024 * 1024),
    apiRateLimit: integer(env.API_RATE_LIMIT, 1800, 10, 100_000),
    loginRateLimit: integer(env.LOGIN_RATE_LIMIT, 300, 5, 10_000),
    historyRetentionDays: integer(env.HISTORY_RETENTION_DAYS, 0, 0, 3650), gitlab
  }
  return cached
}
export function requestOrigin(event: H3Event) {
  const config = getServerConfig()
  return config.publicOrigin || getRequestURL(event, { xForwardedHost: config.trustProxy, xForwardedProto: config.trustProxy }).origin
}
export function secureRequest(event: H3Event) { return requestOrigin(event).startsWith('https:') }
export const isGitlabConfigured = (config = getServerConfig()) => !!(config.gitlab.baseUrl && config.gitlab.clientId && config.gitlab.clientSecret)
export function isEmailDomainAllowed(email: string, config = getServerConfig()) {
  return !config.allowedEmailDomains.length || config.allowedEmailDomains.includes(email.split('@').pop()?.toLowerCase() || '')
}
