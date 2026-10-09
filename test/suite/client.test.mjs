// The browser half cannot be rendered headlessly, so the toggles are verified by
// evaluating the shipped source: the model switch's hidden-list expression is
// lifted out of lib/client.js and run against sample catalogs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../plugin/lib/client.js', import.meta.url), 'utf8')

/** Evaluate one expression exactly as it appears in the bundle. */
function lift(regex, label) {
  const match = source.match(regex)
  assert.ok(match, `could not locate ${label} in lib/client.js`)
  return match[1].trim()
}

const hiddenExpression = lift(
  /const hidden = ([\s\S]*?)\n\s*return postJson\(ROUTES\.config, \{ hiddenModels: hidden \}\)/,
  'the model toggle hidden list',
)
const hiddenAfterToggle = new Function('status', 'id', 'enabled', `return ${hiddenExpression}`)

const status = {
  models: [
    { id: 'a', enabled: true },
    { id: 'b', enabled: true },
    { id: 'c', enabled: false, enabledReason: 'hidden earlier' },
  ],
}

test('turning a model off stores it as hidden', () => {
  assert.deepEqual(hiddenAfterToggle(status, 'a', false), ['a', 'c'])
})

test('turning a model on unhides exactly that model', () => {
  assert.deepEqual(hiddenAfterToggle(status, 'c', true), [])
})

test('an already hidden model stays hidden while another is hidden', () => {
  assert.deepEqual(hiddenAfterToggle(status, 'b', false), ['b', 'c'])
})

test('the switch hands the new visibility to the toggle', () => {
  assert.match(source, /onChange: \(next\) => onToggleModel\(model\.id, next\)/)
})

test('refreshing the catalog mirrors the gateway instead of keeping stale models', () => {
  const call = lift(/const onRefreshModels = ([\s\S]*?postJson\(ROUTES\.models, \{[^}]*\}\))/, 'the catalog refresh call')
  assert.match(call, /keepMissing: false/)
})

test('backend behaviour the toggles rely on', async () => {
  // The host half must read `hiddenModels` as an exact list, not a toggle.
  const host = await readFile(new URL('../plugin/lib/index.js', import.meta.url), 'utf8')
  assert.match(host, /if \(Array\.isArray\(body\.hiddenModels\)\) patch\.hiddenModels = body\.hiddenModels/)
})

const runBody = lift(/const run = useCallback\(([\s\S]*?)\n\s*\[seedDraft\],/, 'the shared action runner')

test('a write action never stores a probe report as the status', () => {
  // `/test` and `/models` answer with `{ ok, status, latencyMs, modelIds }`: no
  // `apiKeySet`, no `registered`. Storing that payload as the status is what made
  // a successful connection test also announce a missing key and an unregistered
  // route, so the runner must re-read `/status` instead of trusting the shape.
  assert.doesNotMatch(runBody, /setStatus\(result\.payload\)/)
  assert.match(runBody, /getJson\(ROUTES\.status\)/)
})

test('testing a connection keeps what the user typed', () => {
  assert.match(runBody, /if \(key === 'save' \|\| key === 'reset'\) seedDraft\(next\)/)
})
