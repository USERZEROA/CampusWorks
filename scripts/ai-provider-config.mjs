import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
export const providerConfigurationPath = resolve(root, '.cache/ai-provider.xml')
export const confirmedProviderDefaults = Object.freeze({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' })

/** Local settings stay private; explicit process settings take precedence. */
export function readLocalEnvironment(environment = process.env, { envFile = resolve(root, '.env') } = {}) {
  let local = {}
  if (envFile && existsSync(envFile)) {
    try { local = parseEnv(readFileSync(envFile, 'utf8')) } catch { throw new Error('Local environment configuration could not be read.') }
  }
  return { ...local, ...environment }
}

function configurationForKey(apiKey, provider) {
  if (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey)) throw new Error('AI configuration is invalid.')
  const key = apiKey.trim()
  if (key.length < 8 || key.length > 8192 || /[\x00-\x20\x7f]/.test(key)) throw new Error('AI configuration is invalid.')
  if (!provider.baseUrl && !provider.model) return { AI_API_KEY: key }
  let base
  try { base = new URL(provider.baseUrl) } catch { throw new Error('A confirmed provider base URL and model are required.') }
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || typeof provider.model !== 'string' || !provider.model.trim() || provider.model.length > 200 || /[\r\n]/.test(provider.model)) throw new Error('A confirmed provider base URL and model are required.')
  return { AI_BASE_URL: base.toString().replace(/\/$/, ''), AI_MODEL: provider.model.trim(), AI_API_KEY: key }
}

/** A Key alone selects OpenAI; an explicit provider argument stays authoritative. */
export function providerEnvironmentConfig(environment = {}, provider) {
  if (environment.AI_API_KEY === undefined || environment.AI_API_KEY === null || environment.AI_API_KEY === '') return null
  const settings = provider || {
    baseUrl: environment.AI_BASE_URL || confirmedProviderDefaults.baseUrl,
    model: environment.AI_MODEL || confirmedProviderDefaults.model,
  }
  return configurationForKey(environment.AI_API_KEY, settings)
}

/** Capture the decrypting child's pipe in memory; never forward either stream. */
export async function loadAiProviderConfig(provider, { environment = process.env, envFile = resolve(root, '.env'), platform = process.platform } = {}) {
  const runtime = readLocalEnvironment(environment, { envFile })
  const supplied = providerEnvironmentConfig(runtime, provider)
  if (supplied) return supplied
  if (platform !== 'win32') return null
  if (!existsSync(providerConfigurationPath)) return null
  const escapedPath = providerConfigurationPath.replaceAll("'", "''")
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $settings = Import-Clixml -LiteralPath '${escapedPath}'
  if ($settings.Version -ne 2 -or $settings.ApiKey -isnot [System.Security.SecureString]) { exit 3 }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($settings.ApiKey)
  try {
    $payload = @{ apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } | ConvertTo-Json -Compress
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::Write($payload)
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
} catch { exit 3 }
`
  const encoded = await new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let bytes = 0
    const timer = setTimeout(() => { child.kill(); reject(new Error('Encrypted AI configuration could not be read.')) }, 10000)
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 65536) { child.kill(); reject(new Error('Encrypted AI configuration is invalid.')); return }
      chunks.push(chunk)
    })
    // A child error can contain contextual text; it is intentionally discarded.
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); reject(new Error('Encrypted AI configuration could not be read.')) })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error('Encrypted AI configuration could not be read.')); return }
      resolvePromise(Buffer.concat(chunks).toString('utf8'))
    })
  })
  let settings
  try { settings = JSON.parse(encoded) } catch { throw new Error('Encrypted AI configuration is invalid.') }
  return configurationForKey(settings.apiKey, provider || {
    baseUrl: runtime.AI_BASE_URL || confirmedProviderDefaults.baseUrl,
    model: runtime.AI_MODEL || confirmedProviderDefaults.model,
  })
}

export function providerDialogStatus() {
  try {
    const value = JSON.parse(readFileSync(resolve(root, '.cache/ai-provider-dialog.status.json'), 'utf8'))
    return { status: ['open', 'saved', 'cancelled', 'error'].includes(value.status) ? value.status : 'unknown', encryptedFilePresent: existsSync(providerConfigurationPath) }
  } catch { return { status: 'not_opened', encryptedFilePresent: existsSync(providerConfigurationPath) } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // This command deliberately reports status only and never decrypts the key.
  process.stdout.write(JSON.stringify(providerDialogStatus()) + '\n')
}
