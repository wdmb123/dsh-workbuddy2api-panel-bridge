// Shared test helpers: a fake WorkBuddy2API gateway, a fake cordis context, and
// the HTTP bridge that exposes the plugin's own route handlers to real fetches.
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Gateway `/v1/models` entries: two rich models plus two bare ones. */
export function sampleModels() {
  return [
    {
      id: 'cn:demo-reasoner',
      object: 'model',
      name: 'Demo Reasoner',
      description: '[x0.29 credit] 旗舰推理',
      vendor: 'j',
      context_length: 1000000,
      max_output_tokens: 64000,
      supports_images: true,
      supports_reasoning: true,
      supports_tool_call: true,
      only_reasoning: true,
      reasoning_default_effort: 'high',
      reasoning_supported_efforts: ['high'],
      credits: 'x0.29',
    },
    {
      id: 'cn:demo-flagship',
      object: 'model',
      name: 'Space Bunny',
      context_length: 1000000,
      max_output_tokens: 128000,
      supports_images: true,
      supports_reasoning: true,
      can_disable_thinking: true,
      reasoning_default_effort: 'max',
      reasoning_supported_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      id: 'cn:plain-text',
      object: 'model',
      name: 'Plain Text',
      context_length: 192000,
      max_output_tokens: 64000,
      supports_images: false,
      supports_reasoning: false,
    },
    { id: 'global:bare', object: 'model', name: 'Bare' },
  ]
}

/** One SSE body a chat-completions client can parse. */
function sseBody(model) {
  const chunk = (delta, finish, usage) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      ...(usage === undefined ? {} : { usage }),
    })}\n\n`
  return (
    chunk({ role: 'assistant', content: '' }) +
    chunk({ content: 'ok' }) +
    chunk({}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) +
    'data: [DONE]\n\n'
  )
}

/**
 * A stand-in for workbuddy2api-panel: `/v1/models` plus a streamed
 * `/v1/chat/completions`. Records every request so tests can assert on the wire.
 */
export async function startGateway({ models = sampleModels(), apiKey } = {}) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const entry = { method: req.method, url: req.url, headers: req.headers, raw }
    requests.push(entry)
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    if (apiKey !== undefined && apiKey !== '') {
      const expected = `Bearer ${apiKey}`
      if (req.headers.authorization !== expected) {
        const body = JSON.stringify({ error: { message: 'invalid api key' } })
        res.writeHead(401, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
        res.end(body)
        return
      }
    }
    if (path.endsWith('/models')) {
      const body = JSON.stringify({ object: 'list', data: models })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (path.endsWith('/chat/completions')) {
      const parsed = JSON.parse(raw)
      entry.body = parsed
      const body = sseBody(parsed.model ?? 'unknown')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `no route ${path}` } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** A cordis-shaped context: `llm`, `inject(['webServer'])`, `get(service)`. */
export function makeCtx({ attachments } = {}) {
  const routes = new Map()
  const registrations = []
  const services = {}
  if (attachments !== undefined) services.attachments = attachments
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => services[name],
    llm: {
      registerAdapter(keys, adapter) {
        const entry = { keys: [...keys], adapter, released: false }
        const handle = () => {
          entry.released = true
          const index = registrations.indexOf(entry)
          if (index >= 0) registrations.splice(index, 1)
        }
        handle.replace = (next) => {
          entry.keys = [...next]
        }
        registrations.push(entry)
        return handle
      },
    },
    inject(names, callback) {
      if (!names.includes('webServer')) return
      callback({
        effect: (fn) => fn(),
        webServer: {
          register({ path, handler }) {
            routes.set(path, handler)
            return () => routes.delete(path)
          },
        },
      })
    },
  }
  return { ctx, routes, registrations }
}

/** Serve the plugin's registered handlers over real HTTP, so fetch() can drive them. */
export async function serveRoutes(routes) {
  const server = createServer(async (req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    post: (path, body, headers = {}) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
      }),
    get: (path, headers = {}) => fetch(`${base}${path}`, { headers }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Fresh DSH_HOME per process so tests never touch the real ~/.dsh. */
export async function useTempHome() {
  const home = await mkdtemp(join(tmpdir(), 'wb2api-home-'))
  process.env.DSH_HOME = home
  return home
}

export async function waitFor(predicate, { timeoutMs = 8000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}

export async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}
