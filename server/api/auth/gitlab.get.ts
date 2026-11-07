// server/api/auth/gitlab.get.ts
import { timingSafeEqual } from 'node:crypto'
import {
  defineEventHandler,
  createError,
  deleteCookie,
  getCookie,
  getQuery,
  sendRedirect
} from 'h3'
import { getServerConfig, isEmailDomainAllowed, isGitlabConfigured, requestOrigin } from '../../utils/config'
import { normalizeEmail, OAUTH_STATE_COOKIE, setSessionUser, validEmail } from '../../utils/auth'

type GitlabUser = {
  id: number
  username: string
  name: string
  email: string
}

/**
 * GET /api/auth/gitlab
 * GitLab OAuth callback:
 * - verifies the `state` value set by /api/auth/gitlab/login,
 * - exchanges the authorization code for an access token,
 * - fetches the GitLab profile and applies ALLOWED_EMAIL_DOMAINS,
 * - starts a signed session and redirects to /courses.
 */
export default defineEventHandler(async (event) => {
  const config = getServerConfig()
  if (!isGitlabConfigured(config)) {
    throw createError({ statusCode: 404, statusMessage: 'GitLab login is not configured' })
  }

  const query = getQuery(event)
  const code = typeof query.code === 'string' ? query.code : ''
  const state = typeof query.state === 'string' ? query.state : ''
  const expectedState = getCookie(event, OAUTH_STATE_COOKIE)
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/api/auth' })

  if (query.error) {
    throw createError({ statusCode: 401, statusMessage: 'The identity provider declined sign-in' })
  }
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing code from GitLab' })
  }
  if (!/^[a-f0-9]{32}$/.test(state) || !expectedState || !/^[a-f0-9]{32}$/.test(expectedState) || !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OAuth state, please sign in again' })
  }

  const origin = requestOrigin(event)

  // 1) Exchange authorization code for access token
  let accessToken: string | undefined
  try {
    const tokenRes = await $fetch<{ access_token?: string }>(
      `${config.gitlab.baseUrl}/oauth/token`,
      {
        method: 'POST', timeout: 10000, retry: 0,
        body: new URLSearchParams({
          client_id: config.gitlab.clientId,
          client_secret: config.gitlab.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${origin}/api/auth/gitlab`
        })
      }
    )
    accessToken = tokenRes?.access_token
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'GitLab token request failed' })
  }

  if (typeof accessToken !== 'string' || !accessToken) {
    throw createError({ statusCode: 401, statusMessage: 'GitLab token exchange failed' })
  }

  // 2) Fetch user profile
  let gitlabUser: GitlabUser
  try {
    gitlabUser = await $fetch<GitlabUser>(`${config.gitlab.baseUrl}/api/v4/user`, {
      headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000, retry: 0
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch GitLab user profile' })
  }

  if (!gitlabUser || typeof gitlabUser.email !== 'string' || (!Number.isSafeInteger(gitlabUser.id) || gitlabUser.id <= 0)) throw createError({ statusCode: 502, statusMessage: 'Invalid identity-provider profile' })
  if ((gitlabUser.name !== undefined && (typeof gitlabUser.name !== 'string' || gitlabUser.name.length > 80)) || (gitlabUser.username !== undefined && (typeof gitlabUser.username !== 'string' || gitlabUser.username.length > 80))) throw createError({ statusCode: 502, statusMessage: 'Invalid identity-provider display name' })
  const email = normalizeEmail(gitlabUser.email)
  if (!validEmail(email)) {
    throw createError({ statusCode: 403, statusMessage: 'Your GitLab account has no email address' })
  }

  // 3) Optional domain allow-list (e.g. a school or company domain)
  if (!isEmailDomainAllowed(email, config)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Only ${config.allowedEmailDomains.map((d) => '@' + d).join(', ')} accounts may sign in`
    })
  }

  // 4) Course roles come from enrollments; ADMIN_EMAILS grants global admin.
  await setSessionUser(event, {
    email,
    name: (gitlabUser.name || gitlabUser.username || email).slice(0, 80),
    issuer: new URL(config.gitlab.baseUrl).toString().replace(/\/$/, ''),
    subject: String(gitlabUser.id),
    primaryRole: config.adminEmails.includes(email) ? 'admin' : 'student',
    provider: 'gitlab'
  })

  return sendRedirect(event, '/courses')
})
