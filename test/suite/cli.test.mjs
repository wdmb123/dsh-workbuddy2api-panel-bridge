// The CLI runs as a real subprocess, so its argument handling is verified the
// way a user hits it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { startGateway, useTempHome } from './harness.mjs'

const run = promisify(execFile)
const BIN = new URL('../plugin/lib/bin.js', import.meta.url).pathname

/** Run the CLI; returns `{ code, stdout, stderr }` for any exit status. */
async function cli(args, env = process.env) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

async function seedConfig(home, config) {
  const file = join(home, '.workbuddy2api', 'config.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(config)}\n`, { mode: 0o600 })
  return file
}

test('status --json prints the stored configuration', async () => {
  const home = await useTempHome()
  await seedConfig(home, { baseUrl: 'http://127.0.0.1:7863/v1', apiKey: 'sk-stored', models: [{ id: 'cn:a' }] })
  const result = await cli(['status', '--json'])
  assert.equal(result.code, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.baseUrl, 'http://127.0.0.1:7863/v1')
  assert.equal(payload.apiKeySet, true)
  assert.deepEqual(payload.models, ['cn:a'])
  assert.ok(!result.stdout.includes('sk-stored'), 'the token must never be printed')
})

test('a value-taking flag may precede the subcommand', async () => {
  await useTempHome()
  const result = await cli(['--timeout', '5000', 'status', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.ok(!result.stderr.includes('未知子命令'), `subcommand mis-detected: ${result.stderr}`)
  assert.equal(JSON.parse(result.stdout).route, 'workbuddy2api')
})

test('a boolean flag may precede the subcommand', async () => {
  await useTempHome()
  const result = await cli(['--json', 'status'])
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotThrow(() => JSON.parse(result.stdout), `expected JSON, got: ${result.stdout}`)
})

test('models lists what the gateway serves and marks unregistered ids', async (t) => {
  const home = await useTempHome()
  await seedConfig(home, { models: [{ id: 'cn:demo-reasoner' }], hiddenModels: ['cn:plain-text'] })
  const gateway = await startGateway()
  t.after(() => gateway.close())

  const result = await cli(['models', '--base-url', gateway.url])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /cn:demo-reasoner/)
  assert.match(result.stdout, /\[已隐藏\]/)
  assert.match(result.stdout, /\[未登记\]/)
})

test('a rejected gateway exits non-zero and keeps the token out of the output', async (t) => {
  await useTempHome()
  const gateway = await startGateway({ apiKey: 'sk-good' })
  t.after(() => gateway.close())
  const result = await cli(['test', '--base-url', gateway.url, '--api-key', 'sk-bad'])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /HTTP 401/)
  assert.ok(!`${result.stdout}${result.stderr}`.includes('sk-bad'))
})

test('help, path and unknown commands', async () => {
  const home = await useTempHome()
  const help = await cli(['help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /dsh-workbuddy2api-panel-bridge/)

  const bare = await cli(['--help'])
  assert.equal(bare.code, 0)
  assert.match(bare.stdout, /用法/)

  const path = await cli(['path'])
  assert.equal(path.code, 0)
  assert.equal(path.stdout.trim(), join(home, '.workbuddy2api', 'config.json'))

  const unknown = await cli(['definitely-not-a-command'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /未知子命令：definitely-not-a-command/)
})
