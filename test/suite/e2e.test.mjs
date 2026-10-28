// End-to-end: boot the real host half against a fake gateway and assert what the
// LLM seam actually receives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply, ROUTES, configFilePath } from '../plugin/lib/index.js'
import { makeCtx, sampleModels, serveRoutes, startGateway, useTempHome, waitFor } from './harness.mjs'

const ROUTE = 'workbuddy2api'

/** Boot the plugin against a fake gateway and hand back the live pieces. */
async function boot({ models, apiKey, config = {} } = {}) {
  await useTempHome()
  const gateway = await startGateway({ models, apiKey })
  const { ctx, routes, registrations } = makeCtx()
  apply(ctx, { baseUrl: gateway.url, apiKey: apiKey ?? 'sk-test', ...config })
  await waitFor(() => registrations.length > 0 && routes.size === 5)
  const bridge = await serveRoutes(routes)
  return {
    gateway,
    bridge,
    routes,
    registrations,
    adapter: () => registrations.at(-1).adapter,
    descriptor: (id) => registrations.at(-1).adapter.current().models.getModel(ROUTE, id),
    async close() {
      await bridge.close()
      await gateway.close()
    },
  }
}

test('gateway capability metadata reaches the pi-ai model descriptor', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  const rich = app.descriptor('cn:demo-reasoner')
  assert.equal(rich.contextWindow, 1000000, 'context_length must become contextWindow')
  assert.equal(rich.maxTokens, 64000, 'max_output_tokens must become maxTokens')
  assert.deepEqual(rich.input, ['text', 'image'], 'supports_images must enable image input')
  assert.equal(rich.reasoning, true)

  const plain = app.descriptor('cn:plain-text')
  assert.equal(plain.contextWindow, 192000)
  assert.equal(plain.maxTokens, 64000)
  assert.deepEqual(plain.input, ['text'], 'supports_images:false must stay text-only')
  assert.equal(plain.reasoning, false, 'supports_reasoning:false must disable reasoning')

  const bare = app.descriptor('global:bare')
  assert.equal(bare.contextWindow, 262144, 'missing context_length keeps the fallback')
  assert.equal(bare.maxTokens, 32768, 'missing max_output_tokens keeps the fallback')
})

test('declared thinking levels follow the gateway effort list', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  const hy = await app.adapter().resolveModel(ROUTE, 'cn:demo-reasoner')
  assert.deepEqual(
    hy.reasoning?.efforts?.map((effort) => effort.id),
    ['high'],
    'a model that only serves "high" must offer only "high"',
  )

  const bunny = await app.adapter().resolveModel(ROUTE, 'cn:demo-flagship')
  assert.deepEqual(
    bunny.reasoning?.efforts?.map((effort) => effort.id),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )

  // The gateway's declared default (`reasoning_default_effort`) is not
  // expressible per model — the seam carries `defaultEffort` at profile level
  // only, and this bridge shares one profile across every model. What must hold
  // instead is that choosing nothing sends no `reasoning_effort`, leaving the
  // gateway to apply its own default, while choosing a level sends exactly it.
  app.gateway.requests.length = 0
  const ask = (reasoningEffort) => ({
    provider: ROUTE,
    model: 'cn:demo-flagship',
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  })
  for await (const chunk of app.adapter().stream(ask(undefined))) void chunk
  for await (const chunk of app.adapter().stream(ask('xhigh'))) void chunk

  const posted = app.gateway.requests.filter((request) => request.url.endsWith('/chat/completions'))
  assert.equal(posted.length, 2, 'both requests must reach the gateway')
  assert.equal('reasoning_effort' in posted[0].body, false, 'no level chosen must send no reasoning_effort')
  assert.equal(posted[1].body.reasoning_effort, 'xhigh', 'a chosen level must be sent verbatim')
})

test('catalog listing reports image modality and hides toggled models', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  const listed = await app.adapter().listModels(ROUTE)
  assert.deepEqual(listed.map((model) => model.id).sort(), sampleModels().map((model) => model.id).sort())
  assert.deepEqual(listed.find((model) => model.id === 'cn:demo-flagship').inputModalities, ['text', 'image'])

  const saved = await app.bridge.post(ROUTES.config, { hiddenModels: ['cn:demo-flagship'] })
  assert.equal(saved.status, 200)
  const after = await app.adapter().listModels(ROUTE)
  assert.ok(!after.some((model) => model.id === 'cn:demo-flagship'), 'hidden model must leave the catalog')
  const status = await (await app.bridge.get(ROUTES.status)).json()
  assert.equal(status.models.find((model) => model.id === 'cn:demo-flagship').enabled, false)
})

test('attachments service is wired into the adapter', async (t) => {
  await useTempHome()
  const gateway = await startGateway({ models: sampleModels() })
  const store = { readImage: async () => ({ data: new Uint8Array([1, 2, 3]), ref: { mediaType: 'image/png' } }) }
  const { ctx, routes, registrations } = makeCtx({ attachments: store })
  apply(ctx, { baseUrl: gateway.url, apiKey: 'sk-test' })
  await waitFor(() => registrations.length > 0 && routes.size === 5)
  t.after(() => gateway.close())

  const adapter = registrations.at(-1).adapter
  assert.equal(typeof adapter.config.resolveAttachments, 'function', 'PiAiAdapter must receive resolveAttachments')
  assert.equal(adapter.config.resolveAttachments(), store, 'resolveAttachments must read ctx.get("attachments")')
})

test('an image message streams instead of failing with UNSUPPORTED_CONTENT', async (t) => {
  await useTempHome()
  const gateway = await startGateway({ models: sampleModels() })
  const calls = []
  const store = {
    async readImage(ref) {
      calls.push(ref)
      return { data: new Uint8Array([137, 80, 78, 71]), ref: { mediaType: 'image/png' } }
    },
  }
  const { ctx, routes, registrations } = makeCtx({ attachments: store })
  apply(ctx, { baseUrl: gateway.url, apiKey: 'sk-test' })
  await waitFor(() => registrations.length > 0 && routes.size === 5)
  t.after(() => gateway.close())

  const adapter = registrations.at(-1).adapter
  const chunks = []
  try {
    for await (const chunk of adapter.stream({
      provider: ROUTE,
      model: 'cn:demo-flagship',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image', attachment: 'att-1' },
          ],
        },
      ],
    })) {
      chunks.push(chunk)
    }
  } catch (error) {
    assert.notEqual(error?.code, 'UNSUPPORTED_CONTENT', `image request failed early: ${error?.message}`)
  }

  assert.deepEqual(calls, ['att-1'], 'the attachment store must be consulted for the image block')
  const posted = gateway.requests.filter((request) => request.url.endsWith('/chat/completions'))
  assert.equal(posted.length, 1, 'the request must reach the gateway')
  assert.equal(posted[0].body.messages.at(-1).content.at(-1).type, 'image_url')
  assert.match(posted[0].body.messages.at(-1).content.at(-1).image_url.url, /^data:image\/png;base64,/)
})

test('models route merges a changed gateway list and keeps hidden ids honest', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  app.gateway.requests.length = 0
  const response = await app.bridge.post(ROUTES.models, {})
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.models.length, sampleModels().length)

  const status = await (await app.bridge.get(ROUTES.status)).json()
  assert.equal(status.configSource, 'file')
  const stored = JSON.parse(await readFile(configFilePath(), 'utf8'))
  assert.equal(stored.models.length, sampleModels().length)
  assert.equal(stored.models[0].contextWindow, 1000000, 'discovered metadata must survive persistence')
})

test('reset clears the file and re-discovers with metadata', async (t) => {
  const app = await boot()
  t.after(() => app.close())
  await app.bridge.post(ROUTES.config, { hiddenModels: ['cn:plain-text'] })

  const response = await app.bridge.post(ROUTES.reset, {})
  assert.equal(response.status, 200)
  const status = await response.json()
  assert.equal(status.models.length, sampleModels().length)
  assert.equal(status.models[0].contextWindow, 1000000)
  const stored = JSON.parse(await readFile(configFilePath(), 'utf8'))
  assert.ok(Array.isArray(stored.models), 'reset must persist the re-discovered catalog too')
})

test('a model the gateway stopped serving is dropped on the next boot', async (t) => {
  // The catalog must not outlive the gateway's own list: an id the upstream
  // deleted has to disappear from the file, and its deny-list entry with it.
  // One gateway for both boots: the stored baseUrl points at it, and mutating
  // the array it serves is how "the upstream deleted a model" is simulated.
  const served = [...sampleModels()]
  await useTempHome()
  const gateway = await startGateway({ models: served, apiKey: 'sk-test' })
  t.after(() => gateway.close())

  /** Every apply() is a fresh boot reading the same file. */
  const bootHere = async () => {
    const { ctx, routes } = makeCtx()
    apply(ctx, { baseUrl: gateway.url, apiKey: 'sk-test' })
    await waitFor(() => routes.size === 5)
    const bridge = await serveRoutes(routes)
    t.after(() => bridge.close())
    await waitFor(async () => (await (await bridge.get(ROUTES.status)).json()).models.length > 0)
    return bridge
  }

  const first = await bootHere()
  await first.post(ROUTES.config, { hiddenModels: ['cn:plain-text'] })
  await first.close()

  served.splice(
    served.findIndex((model) => model.id === 'cn:plain-text'),
    1,
  )
  const bridge = await bootHere()
  const status = await (await bridge.get(ROUTES.status)).json()
  const ids = status.models.map((model) => model.id)
  assert.ok(!ids.includes('cn:plain-text'), 'a boot must drop an id the gateway no longer serves')
  assert.equal(ids.length, sampleModels().length - 1)

  const stored = JSON.parse(await readFile(configFilePath(), 'utf8'))
  assert.ok(!stored.models.some((model) => model.id === 'cn:plain-text'), 'the drop must be persisted')
  assert.ok(
    !(stored.hiddenModels ?? []).includes('cn:plain-text'),
    'the deny-list must not keep an id that is no longer in the catalog',
  )
})

test('guards: method, origin and body validity', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  assert.equal((await app.bridge.get(ROUTES.config)).status, 405)
  assert.equal((await app.bridge.post(ROUTES.status, {})).status, 405)
  assert.equal((await app.bridge.post(ROUTES.config, {}, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await app.bridge.get(ROUTES.status, { origin: 'http://127.0.0.1' })).status, 200)
  const bad = await fetch(`${app.bridge.base}${ROUTES.config}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  })
  assert.equal(bad.status, 400)
})

test('probe failures are reported without leaking the token', async (t) => {
  const app = await boot({ apiKey: 'sk-wrong' })
  t.after(() => app.close())
  // The gateway requires no key here, so point the probe at a dead port instead.
  const response = await app.bridge.post(ROUTES.test, { baseUrl: 'http://127.0.0.1:1/v1' })
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.status, 0)
  assert.ok(!JSON.stringify(payload).includes('sk-wrong'))
})

test('the probe routes answer with a report, not a status document', async (t) => {
  const app = await boot()
  t.after(() => app.close())

  const tested = await (await app.bridge.post(ROUTES.test, {})).json()
  const refreshed = await (await app.bridge.post(ROUTES.models, {})).json()

  for (const [label, payload] of [['test', tested], ['models', refreshed]]) {
    assert.equal(payload.ok, true, `the ${label} report must carry the probe outcome`)
    // The card once stored this payload as the plugin status. Keeping the probe
    // routes free of status-only fields is what stops a successful connection
    // test from also rendering "key missing" and "route unregistered".
    assert.equal('apiKeySet' in payload, false, `the ${label} report must not mimic a status document`)
    assert.equal('registered' in payload, false, `the ${label} report must not mimic a status document`)
  }
  assert.ok(Array.isArray(refreshed.models), 'the models route still returns the catalog')
  assert.ok(refreshed.models.every((entry) => typeof entry.enabled === 'boolean'), 'the catalog still carries the hidden flags')
})
