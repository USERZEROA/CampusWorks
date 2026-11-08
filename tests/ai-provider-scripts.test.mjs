import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiLaunch } from '../scripts/start-with-ai.mjs'
import { confirmedProviderDefaults, loadAiProviderConfig, providerEnvironmentConfig, readLocalEnvironment } from '../scripts/ai-provider-config.mjs'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('AI launch keeps the synthetic credential in the child environment and out of arguments', async () => {
  const syntheticKey = 'synthetic-unit-test-key'
  const launch = await createAiLaunch({ envFile: null, environment: { PORT: '3456', AI_API_KEY: 'obsolete', AI_BASE_URL: 'https://unapproved.example' }, load: async () => ({ AI_API_KEY: syntheticKey, AI_BASE_URL: confirmedProviderDefaults.baseUrl, AI_MODEL: confirmedProviderDefaults.model }) })
  assert.equal(launch.options.env.AI_API_KEY, syntheticKey)
  assert.equal(launch.options.env.AI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(launch.options.env.AI_MODEL, 'gpt-5.4-mini')
  assert.equal(launch.options.env.PORT, '3456')
  assert.equal(launch.options.stdio, 'inherit')
  assert.equal(JSON.stringify([launch.command, launch.args]).includes(syntheticKey), false)
  assert.match(launch.args[0], /[\\/]\.output[\\/]server[\\/]index\.mjs$/)
})

test('development AI launch uses the same isolated environment without an argument secret', async () => {
  const launch = await createAiLaunch({ envFile: null, dev: true, environment: {}, load: async () => ({ AI_API_KEY: 'synthetic-dev-key', AI_BASE_URL: confirmedProviderDefaults.baseUrl, AI_MODEL: confirmedProviderDefaults.model }) })
  assert.equal(launch.args[1], 'dev')
  assert.match(launch.args[0], /[\\/]nuxt[\\/]bin[\\/]nuxt\.mjs$/)
  assert.equal(launch.args.join(' ').includes('synthetic-dev-key'), false)
})

test('missing credentials and decrypt failures fail closed without echoing child error contents', async () => {
  await assert.rejects(createAiLaunch({ envFile: null, environment: {}, load: async () => null }), /Save an API key/)
  await assert.rejects(createAiLaunch({ envFile: null, environment: {}, load: async () => { throw new Error('synthetic-secret-in-provider-error') } }), error => {
    assert.equal(error.message.includes('synthetic-secret-in-provider-error'), false)
    assert.match(error.message, /could not be read/)
    return true
  })
})

test('a new computer can supply only its environment key without decrypting a Windows file', async () => {
  const syntheticKey = 'synthetic-environment-key'
  for (const platform of ['linux', 'darwin', 'win32']) {
    const provider = await loadAiProviderConfig(undefined, { platform, environment: { AI_API_KEY: syntheticKey }, envFile: null })
    assert.deepEqual(provider, { AI_API_KEY: syntheticKey, AI_BASE_URL: confirmedProviderDefaults.baseUrl, AI_MODEL: confirmedProviderDefaults.model })
  }
  assert.equal(await loadAiProviderConfig(undefined, { platform: 'linux', environment: {}, envFile: null }), null)
})

test('an explicitly confirmed provider cannot be redirected by environment metadata', () => {
  const provider = providerEnvironmentConfig({ AI_API_KEY: 'synthetic-confirmed-key', AI_BASE_URL: 'https://different.example/v1', AI_MODEL: 'different-model' }, confirmedProviderDefaults)
  assert.equal(provider.AI_BASE_URL, confirmedProviderDefaults.baseUrl)
  assert.equal(provider.AI_MODEL, confirmedProviderDefaults.model)
  const configured = providerEnvironmentConfig({ AI_API_KEY: 'synthetic-explicit-key', AI_BASE_URL: 'https://provider.example/v1/', AI_MODEL: 'explicit-model' })
  assert.equal(configured.AI_BASE_URL, 'https://provider.example/v1')
  assert.equal(configured.AI_MODEL, 'explicit-model')
})

test('invalid supplied credentials or provider metadata fail closed without exposing either value', () => {
  for (const environment of [
    { AI_API_KEY: 'synthetic-key\nsecret' },
    { AI_API_KEY: 'synthetic key with spaces' },
    { AI_API_KEY: 'synthetic-valid-key', AI_BASE_URL: 'https://user:secret@example.com/v1' },
    { AI_API_KEY: 'synthetic-valid-key', AI_BASE_URL: 'http://external.example/v1' },
    { AI_API_KEY: 'synthetic-valid-key', AI_MODEL: 'synthetic-model\nsecret' },
  ]) assert.throws(() => providerEnvironmentConfig(environment), error => !error.message.includes('synthetic') && !error.message.includes('secret'))
})

test('production AI launch loads private local runtime settings with process values taking precedence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusworks-provider-'))
  const envFile = join(directory, '.env')
  writeFileSync(envFile, 'AI_API_KEY=synthetic-private-file-key\nMONGODB_URI=mongodb://127.0.0.1:27017/synthetic\nSESSION_SECRET=synthetic-session-secret\nPORT=4567\n', { mode: 0o600 })
  try {
    const settings = readLocalEnvironment({ PORT: '5678' }, { envFile })
    assert.equal(settings.PORT, '5678')
    const launch = await createAiLaunch({ environment: { PORT: '5678' }, envFile })
    assert.equal(launch.options.env.MONGODB_URI, 'mongodb://127.0.0.1:27017/synthetic')
    assert.equal(launch.options.env.SESSION_SECRET, 'synthetic-session-secret')
    assert.equal(launch.options.env.PORT, '5678')
    assert.equal(launch.options.env.AI_API_KEY, 'synthetic-private-file-key')
    assert.equal(launch.options.env.AI_BASE_URL, confirmedProviderDefaults.baseUrl)
    assert.equal(JSON.stringify([launch.command, launch.args]).includes('synthetic-private-file-key'), false)
  } finally {
    unlinkSync(envFile)
    rmdirSync(directory)
  }
})
