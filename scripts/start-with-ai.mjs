import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadAiProviderConfig, readLocalEnvironment } from './ai-provider-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

/** Prepare an in-memory child environment; never put a credential in arguments. */
export async function createAiLaunch({ dev = false, environment = process.env, envFile, load } = {}) {
  const runtime = readLocalEnvironment(environment, envFile === undefined ? {} : { envFile })
  let provider
  try { provider = await (load ? load() : loadAiProviderConfig(undefined, { environment: runtime, envFile: null })) } catch { throw new Error('The API key configuration could not be read.') }
  if (!provider?.AI_API_KEY) throw new Error('Save an API key in the local configuration window or set AI_API_KEY in your environment or private .env file.')
  return {
    command: process.execPath,
    args: dev ? [resolve(root, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev'] : [resolve(root, '.output/server/index.mjs')],
    options: { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...runtime, ...provider } },
  }
}

async function main() {
  const argumentsList = process.argv.slice(2)
  if (argumentsList.some(argument => !['--dev', '--check'].includes(argument))) throw new Error('Use --dev to start development or --check to check the saved key.')
  const launch = await createAiLaunch({ dev: argumentsList.includes('--dev') })
  if (argumentsList.includes('--check')) {
    process.stdout.write('{"status":"ready","configured":true}\n')
    return
  }
  if (!existsSync(launch.args[0])) throw new Error('Build the application or install its dependencies before starting it.')
  const child = spawn(launch.command, launch.args, launch.options)
  child.once('error', () => {
    process.stderr.write('The local application could not start.\n')
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { if (child.exitCode === null) child.kill(signal) })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Configuration errors are intentionally generic because a child may echo secrets.
    process.stderr.write('The API key configuration or local application is not ready.\n')
    process.exitCode = 1
  })
}
