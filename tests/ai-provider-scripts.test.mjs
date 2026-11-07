import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiLaunch } from '../scripts/start-with-ai.mjs'
import { confirmedProviderDefaults } from '../scripts/ai-provider-config.mjs'

test('AI launch keeps the synthetic credential in the child environment and out of arguments', async () => {
  const syntheticKey = 'synthetic-unit-test-key'
  const launch = await createAiLaunch({ environment: { PORT: '3456', AI_API_KEY: 'obsolete', AI_BASE_URL: 'https://unapproved.example' }, load: async () => ({ AI_API_KEY: syntheticKey, AI_BASE_URL: confirmedProviderDefaults.baseUrl, AI_MODEL: confirmedProviderDefaults.model }) })
  assert.equal(launch.options.env.AI_API_KEY, syntheticKey)
  assert.equal(launch.options.env.AI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(launch.options.env.AI_MODEL, 'gpt-5.4-mini')
  assert.equal(launch.options.env.PORT, '3456')
  assert.equal(launch.options.stdio, 'inherit')
  assert.equal(JSON.stringify([launch.command, launch.args]).includes(syntheticKey), false)
  assert.match(launch.args[0], /[\\/]\.output[\\/]server[\\/]index\.mjs$/)
})

test('development AI launch uses the same isolated environment without an argument secret', async () => {
  const launch = await createAiLaunch({ dev: true, environment: {}, load: async () => ({ AI_API_KEY: 'synthetic-dev-key', AI_BASE_URL: confirmedProviderDefaults.baseUrl, AI_MODEL: confirmedProviderDefaults.model }) })
  assert.equal(launch.args[1], 'dev')
  assert.match(launch.args[0], /[\\/]nuxt[\\/]bin[\\/]nuxt\.mjs$/)
  assert.equal(launch.args.join(' ').includes('synthetic-dev-key'), false)
})

test('missing credentials and decrypt failures fail closed without echoing child error contents', async () => {
  await assert.rejects(createAiLaunch({ load: async () => null }), /Save an API key/)
  await assert.rejects(createAiLaunch({ load: async () => { throw new Error('synthetic-secret-in-provider-error') } }), error => {
    assert.equal(error.message.includes('synthetic-secret-in-provider-error'), false)
    assert.match(error.message, /could not be read/)
    return true
  })
})
