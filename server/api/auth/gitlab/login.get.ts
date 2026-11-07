// server/api/auth/gitlab/login.get.ts
import { randomBytes } from 'node:crypto'
import {
  defineEventHandler,
  createError,
  getRequestProtocol,
  getRequestURL,
  sendRedirect,
  setCookie
} from 'h3'
import { getServerConfig, isGitlabConfigured } from '../../../utils/config'
import { OAUTH_STATE_COOKIE } from '../../../utils/auth'

/**
 * GET /api/auth/gitlab/login
 * Starts the GitLab OAuth flow (gitlab.com or a self-hosted instance).
 * A random `state` value is stored in a short-lived cookie to prevent CSRF.
 */
export default defineEventHandler((event) => {
  const config = getServerConfig()
  if (!isGitlabConfigured(config)) {
    throw createError({ statusCode: 404, statusMessage: 'GitLab login is not configured' })
  }

  const { origin } = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  const state = randomBytes(16).toString('hex')

  setCookie(event, OAUTH_STATE_COOKIE, state, {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol(event) === 'https',
    maxAge: 10 * 60
  })

  const params = new URLSearchParams({
    client_id: config.gitlab.clientId,
    redirect_uri: `${origin}/api/auth/gitlab`,
    response_type: 'code',
    scope: 'read_user',
    state
  })

  return sendRedirect(event, `${config.gitlab.baseUrl}/oauth/authorize?${params}`)
})
