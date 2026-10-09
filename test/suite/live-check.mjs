// Live check: boot the shipped plugin half against a REAL gateway and assert the
// whole path (probe -> catalog -> pi model descriptor -> real streaming request).
//
// Nothing here is tied to one machine: the gateway, the token and the models are
// taken from the environment, and every assertion compares the plugin against
// whatever the gateway actually advertised.
//
//   WB2API_URL     gateway base URL   (default http://127.0.0.1:7863/v1)
//   WB2API_KEY     gateway token      (default: read from the stored DSH config)
//   WB2API_CONFIG  config file        (default $DSH_HOME/.workbuddy2api/config.json)
//   DSH_HOME       config directory   (default ~/.dsh)
//
// Run: node <scratch>/live-check.mjs
// The plugin itself runs against a temp DSH_HOME, so the real config is only read.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply, configFilePath } from './plugin/lib/index.js'
import { collect, makeCtx, serveRoutes, useTempHome, waitFor } from './test/harness.mjs'

const GATEWAY = process.env.WB2API_URL ?? 'http://127.0.0.1:7863/v1'
const CONFIG = process.env.WB2API_CONFIG
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.workbuddy2api', 'config.json')
const KEY = process.env.WB2API_KEY ?? JSON.parse(await readFile(CONFIG, 'utf8')).apiKey
const ROUTE = 'workbuddy2api'
const ok = []
const check = (label, fn) => {
  fn()
  ok.push(label)
}

await useTempHome()
const { ctx, routes, registrations } = makeCtx()
apply(ctx, { baseUrl: GATEWAY, apiKey: KEY })
await waitFor(() => registrations.length > 0)
const bridge = await serveRoutes(routes)
const adapter = () => registrations.at(-1).adapter
const descriptor = (id) => adapter().current().models.getModel(ROUTE, id)

const status = await (await bridge.get('/plugins/dsh-workbuddy2api-panel-bridge/status')).json()
console.log(`status: enabled=${status.enabled} probeOk=${status.lastProbe?.ok} models=${status.models?.length}`)
check('the real gateway answered the boot probe', () => assert.equal(status.lastProbe?.ok, true))

// Whatever the gateway serves, the catalog must mirror it exactly — no hardcoded
// model count or model name here.
const advertised = status.lastProbe?.modelIds ?? []
const listed = (status.models ?? []).map((model) => model.id)
check('the boot catalog holds every advertised model', () => {
  assert.ok(advertised.length > 0, 'the gateway must advertise at least one model')
  assert.deepEqual([...listed].sort(), [...advertised].sort())
})
check('every listed model got a descriptor', () => {
  for (const id of listed) assert.ok(descriptor(id), `no descriptor for ${id}`)
})

const sample = (status.models ?? []).find((model) => model.vision === true) ?? status.models?.[0]
console.log(`sample model: ${sample.id} ctx=${sample.contextWindow} max=${sample.maxTokens} efforts=${JSON.stringify(sample.efforts)}`)
check('a descriptor carries the context window the catalog stored', () =>
  assert.equal(descriptor(sample.id).contextWindow, sample.contextWindow))
check('a descriptor carries the output cap the catalog stored', () =>
  assert.equal(descriptor(sample.id).maxTokens, sample.maxTokens))
check('image capability reaches the descriptor', () =>
  assert.deepEqual(descriptor(sample.id).input, sample.vision ? ['text', 'image'] : ['text']))
check('the declared effort list reaches the thinking level map', () => {
  const offered = Object.entries(descriptor(sample.id).thinkingLevelMap).filter(([, v]) => v !== null).map(([k]) => k)
  // An omitted `efforts` means "every level the harness offers"; otherwise the
  // gateway's own list is what has to show up.
  if (Array.isArray(sample.efforts) && sample.efforts.length > 0) assert.deepEqual(offered, sample.efforts)
  else assert.ok(offered.length > 0)
})

const rich = await adapter().resolveModel(ROUTE, sample.id)
console.log(`${sample.id} -> context=${rich.context?.contextWindow} maxOut=${rich.defaultMaxTokens} efforts=${JSON.stringify(rich.reasoning?.efforts?.map((e) => e.id))}`)
check('resolveModel reports the gateway reasoning effort list', () => {
  const reported = rich.reasoning?.efforts?.map((effort) => effort.id) ?? []
  assert.ok(reported.length > 0)
  if (Array.isArray(sample.efforts) && sample.efforts.length > 0) assert.deepEqual(reported, sample.efforts)
})

// Real wire test: one tiny prompt through the real gateway.
const chunks = await collect(adapter().stream({
  provider: ROUTE,
  model: sample.id,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly one word: pong' }] }],
}))
const text = chunks.map((chunk) => JSON.stringify(chunk)).join('')
console.log(`streamed ${chunks.length} chunks: ${text.slice(0, 300)}`)
check('a real streamed completion comes back', () => assert.match(text, /pong/i))

// The catalog route against the real gateway must persist the refreshed entries.
const refreshed = await (await bridge.post('/plugins/dsh-workbuddy2api-panel-bridge/models', { keepMissing: false })).json()
check('the refresh route merged the live catalog', () =>
  assert.deepEqual((refreshed.models ?? []).map((model) => model.id).sort(), [...advertised].sort()))

const stored = JSON.parse(await readFile(configFilePath(), 'utf8'))
const storedSample = stored.models.find((model) => model.id === sample.id)
console.log(`stored: ${JSON.stringify(storedSample)}`)
check('the refreshed catalog was persisted with real capabilities', () => {
  assert.equal(storedSample.contextWindow, sample.contextWindow)
  assert.equal(storedSample.vision, sample.vision)
})
check('no apiKey leaked into the probe report', () =>
  assert.equal(JSON.stringify(refreshed).includes(KEY), false))

await bridge.close()
console.log(`\n${ok.length}/${ok.length} live checks passed:`)
for (const label of ok) console.log(`  ok - ${label}`)
