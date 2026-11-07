// server/utils/config.ts
import { createHash, randomBytes } from 'node:crypto'

/**
 * Server configuration, read from environment variables at runtime
 * (not baked in at build time), so one Docker image can be configured
 * per environment. See `.env.example` for every supported variable.
 */
export type ServerConfig = {
  mongodbUri: string
  mongodbDb: string
  sessionSecret: string
  mockLoginEnabled: boolean
  seedDemoData: boolean
  adminEmails: string[]
  allowedEmailDomains: string[]
  gitlab: {
    baseUrl: string
    clientId: string
    clientSecret: string
  }
}

// Only used outside production so that dev restarts keep sessions valid.
const DEV_SESSION_SECRET = 'campusworks-dev-only-session-secret-do-not-use-in-prod'

const toList = (value?: string) =>
  (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

const toFlag = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Sealed sessions need a password of at least 32 characters.
 * Shorter secrets are stretched with SHA-256 instead of being rejected.
 */
const resolveSessionSecret = (raw: string | undefined, isProd: boolean) => {
  if (raw && raw.length >= 32) return raw
  if (raw) {
    console.warn('[campusworks] SESSION_SECRET is shorter than 32 characters; consider a longer value.')
    return createHash('sha256').update(raw).digest('hex')
  }
  if (isProd) {
    // Secure by default: a random secret means sessions do not survive restarts
    // and are not shared between replicas, so production must set SESSION_SECRET.
    console.warn('[campusworks] SESSION_SECRET is not set; generated a random one for this process.')
    return randomBytes(32).toString('hex')
  }
  return DEV_SESSION_SECRET
}

let cached: ServerConfig | null = null

export function getServerConfig(): ServerConfig {
  if (cached) return cached

  const env = process.env
  const isProd = env.NODE_ENV === 'production'

  cached = {
    mongodbUri: env.MONGODB_URI || '',
    mongodbDb: env.MONGODB_DB || 'campusworks',
    sessionSecret: resolveSessionSecret(env.SESSION_SECRET, isProd),
    // Mock (demo) login is on by default in development only.
    mockLoginEnabled: toFlag(env.ENABLE_MOCK_LOGIN, !isProd),
    seedDemoData: toFlag(env.SEED_DEMO_DATA, false),
    adminEmails: toList(env.ADMIN_EMAILS),
    allowedEmailDomains: toList(env.ALLOWED_EMAIL_DOMAINS).map((d) =>
      d.replace(/^@/, '')
    ),
    gitlab: {
      baseUrl: (env.GITLAB_BASE_URL || '').trim().replace(/\/+$/, ''),
      clientId: (env.GITLAB_CLIENT_ID || '').trim(),
      clientSecret: (env.GITLAB_CLIENT_SECRET || '').trim()
    }
  }

  return cached
}

export function isGitlabConfigured(config = getServerConfig()) {
  const { baseUrl, clientId, clientSecret } = config.gitlab
  return !!(baseUrl && clientId && clientSecret)
}

/**
 * Whether an email may sign in via OAuth.
 * An empty ALLOWED_EMAIL_DOMAINS list allows every domain.
 */
export function isEmailDomainAllowed(email: string, config = getServerConfig()) {
  if (!config.allowedEmailDomains.length) return true
  const domain = email.split('@').pop()?.toLowerCase() || ''
  return config.allowedEmailDomains.includes(domain)
}
