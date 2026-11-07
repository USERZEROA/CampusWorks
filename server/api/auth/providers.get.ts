// server/api/auth/providers.get.ts
import { defineEventHandler } from 'h3'
import { getServerConfig, isGitlabConfigured } from '../../utils/config'
import { DEMO_ACCOUNTS } from '../../utils/seed'

/**
 * GET /api/auth/providers
 * Which sign-in methods the login page should offer, plus the one-click
 * demo accounts when demo login is enabled.
 */
export default defineEventHandler(() => {
  const config = getServerConfig()
  return {
    mock: config.mockLoginEnabled,
    gitlab: isGitlabConfigured(config),
    allowedEmailDomains: config.allowedEmailDomains,
    demoAccounts: config.mockLoginEnabled ? DEMO_ACCOUNTS : []
  }
})
