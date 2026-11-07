// server/api/auth/gitlab.get.ts
import {
  defineEventHandler,
  createError,
  deleteCookie,
  getCookie,
  getQuery,
  getRequestURL,
  sendRedirect
} from 'h3'
import { getServerConfig, isEmailDomainAllowed, isGitlabConfigured, requestOrigin } from '../../utils/config'
import { normalizeEmail, OAUTH_STATE_COOKIE, setSessionUser } from '../../utils/auth'

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
    throw createError({ statusCode: 401, statusMessage: `GitLab error: ${String(query.error)}` })
  }
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing code from GitLab' })
  }
  if (!state || !expectedState || state !== expectedState) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OAuth state, please sign in again' })
  }

  const origin = requestOrigin(event)

  // 1) Exchange authorization code for access token
  let accessToken: string | undefined
  try {
    const tokenRes = await $fetch<{ access_token?: string }>(
      `${config.gitlab.baseUrl}/oauth/token`,
      {
        method: 'POST',
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

  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: 'GitLab token exchange failed' })
  }

  // 2) Fetch user profile
  let gitlabUser: GitlabUser
  try {
    gitlabUser = await $fetch<GitlabUser>(`${config.gitlab.baseUrl}/api/v4/user`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch GitLab user profile' })
  }

  const email = normalizeEmail(gitlabUser.email || '')
  if (!email) {
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
    name: gitlabUser.name || gitlabUser.username || email,
    primaryRole: config.adminEmails.includes(email) ? 'admin' : 'student',
    provider: 'gitlab'
  })

  return sendRedirect(event, '/courses')
})
