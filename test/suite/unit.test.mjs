// Pure helpers and the gateway probe, exercised directly.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BASE_URL,
  FALLBACK_MODELS,
  configFilePath,
  dshHome,
  inject,
  name,
  normalizeBaseUrl,
  normalizeConfig,
  normalizeModel,
  probeGateway,
} from '../plugin/lib/index.js'
import { sampleModels, startGateway, useTempHome } from './harness.mjs'

test('normalizeBaseUrl accepts every address shape the card sends', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:7863'), 'http://127.0.0.1:7863/v1')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:7863/'), 'http://127.0.0.1:7863/v1')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:7863/v1'), 'http://127.0.0.1:7863/v1')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:7863/v2/'), 'http://127.0.0.1:7863/v2')
  assert.equal(normalizeBaseUrl('  http://host:9/v1  '), 'http://host:9/v1')
  assert.equal(normalizeBaseUrl(''), DEFAULT_BASE_URL)
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_BASE_URL)
})

test('normalizeModel keeps only servable entries', () => {
  assert.equal(normalizeModel(null), undefined)
  assert.equal(normalizeModel('cn:x'), undefined)
  assert.equal(normalizeModel({ id: '   ' }), undefined)

  const bare = normalizeModel({ id: ' cn:a ' })
  assert.equal(bare.id, 'cn:a')
  assert.equal(bare.name, 'cn:a')
  assert.equal(bare.contextWindow, 262144)
  assert.equal(bare.maxTokens, 32768)
  assert.equal(bare.vision, false)
  assert.equal(bare.reasoning, true)

  const rich = normalizeModel({
    id: 'cn:b',
    name: 'B',
    contextWindow: '1000000',
    maxTokens: 64000.7,
    vision: true,
    reasoning: false,
    efforts: ['high', 'high', 'nonsense', 7],
  })
  assert.equal(rich.contextWindow, 1000000)
  assert.equal(rich.maxTokens, 64000)
  assert.equal(rich.vision, true)
  assert.equal(rich.reasoning, false)

  assert.equal(normalizeModel({ id: 'cn:c', contextWindow: -1 }).contextWindow, 262144)
  assert.equal(normalizeModel({ id: 'cn:c', maxTokens: 0 }).maxTokens, 32768)
  assert.equal(normalizeModel({ id: 'cn:c', vision: 'yes' }).vision, false)
})

test('normalizeConfig sanitises every stored field', () => {
  const config = normalizeConfig({
    enabled: false,
    baseUrl: 'http://host:1/',
    apiKey: 42,
    displayName: '  ',
    route: 'Bad Route',
    models: [{ id: 'a' }, { id: 'a' }, { id: '' }, null, { id: 'b', vision: true }],
    hiddenModels: ['a', 'a', '  ', 5],
    autoDiscoverModels: false,
    streamIdleTimeoutMs: 10,
  })
  assert.equal(config.enabled, false)
  assert.equal(config.baseUrl, 'http://host:1/v1')
  assert.equal(config.apiKey, '42')
  assert.equal(config.displayName, 'WorkBuddy2API')
  assert.equal(config.route, 'workbuddy2api', 'an invalid route falls back to the default')
  assert.deepEqual(config.models.map((model) => model.id), ['a', 'b'])
  assert.deepEqual(config.hiddenModels, ['a', '5'])
  assert.equal(config.autoDiscoverModels, false)
  assert.equal(config.streamIdleTimeoutMs, 300000, 'a sub-second idle timeout is unservable')
})

test('host identity stays stable', () => {
  assert.equal(name, 'dsh-workbuddy2api-panel-bridge')
  assert.deepEqual(inject, ['llm'])
  assert.deepEqual(FALLBACK_MODELS, ['cn:demo-flash'])
})

test('path helpers honour DSH_HOME', async () => {
  const home = await useTempHome()
  assert.equal(dshHome(), home)
  assert.equal(configFilePath(), `${home}/.workbuddy2api/config.json`)
})

test('probeGateway reports ids plus per-model capabilities', async (t) => {
  const gateway = await startGateway()
  t.after(() => gateway.close())
  const report = await probeGateway({ baseUrl: gateway.url, apiKey: '' })

  assert.equal(report.ok, true)
  assert.equal(report.status, 200)
  assert.deepEqual(report.modelIds, sampleModels().map((model) => model.id))

  const models = report.models ?? []
  assert.equal(models.length, sampleModels().length, 'the probe must carry mapped models, not just ids')

  const hy = models.find((model) => model.id === 'cn:demo-reasoner')
  assert.equal(hy.contextWindow, 1000000)
  assert.equal(hy.maxTokens, 64000)
  assert.equal(hy.vision, true)
  assert.equal(hy.reasoning, true)
  assert.deepEqual(hy.efforts, ['high'])

  const plain = models.find((model) => model.id === 'cn:plain-text')
  assert.equal(plain.contextWindow, 192000)
  assert.equal(plain.maxTokens, 64000)
  assert.equal(plain.vision, false)
  assert.equal(plain.reasoning, false)
  assert.equal(plain.efforts, undefined)

  const bare = models.find((model) => model.id === 'global:bare')
  assert.equal(bare.contextWindow, 262144)
  assert.equal(bare.maxTokens, 32768)
  assert.equal(bare.reasoning, true)
  assert.equal(bare.efforts, undefined)
})

test('probeGateway sends the bearer token and reports rejections', async (t) => {
  const gateway = await startGateway({ apiKey: 'sk-good' })
  t.after(() => gateway.close())

  const good = await probeGateway({ baseUrl: gateway.url, apiKey: 'sk-good' })
  assert.equal(good.ok, true)
  assert.equal(gateway.requests[0].headers.authorization, 'Bearer sk-good')

  const bad = await probeGateway({ baseUrl: gateway.url, apiKey: 'sk-bad' })
  assert.equal(bad.ok, false)
  assert.equal(bad.status, 401)
  assert.deepEqual(bad.modelIds, [])
  assert.match(bad.error, /401/)
  assert.ok(!String(bad.error).includes('sk-bad'))
})

test('probeGateway degrades cleanly when nothing answers', async () => {
  const report = await probeGateway({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', timeoutMs: 2000 })
  assert.equal(report.ok, false)
  assert.equal(report.status, 0)
  assert.deepEqual(report.modelIds, [])
  assert.ok(typeof report.error === 'string' && report.error.length > 0)
})
