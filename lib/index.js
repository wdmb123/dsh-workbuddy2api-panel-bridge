/**
 * dsh-workbuddy2api-panel-bridge — host half.
 *
 * A bridge, not a second proxy: the plugin never talks to Tencent. It points an
 * ordinary OpenAI-compatible pi-ai adapter at *your* local WorkBuddy2API
 * gateway (`http://127.0.0.1:7863/v1` by default) and registers the result as
 * one more provider route in the Harness LLM seam.
 *
 * Two deliberate compatibility choices:
 *
 * 1. `inject` names only `llm`; `webServer` is claimed with `ctx.inject(...)`,
 *    so a host that mounts the web server late — or never — still gets the
 *    provider registered. A host without a web server loses the card, not the
 *    model route.
 *
 * 2. The pi-ai seam is imported dynamically. If a future host renames or drops
 *    `@deepseek-ai/dsh-llm-pi-ai`, the failure is caught and reported on the
 *    card as "provider 未加载" — instead of taking the plugin, and the card,
 *    down with it.
 *
 * Configuration is owned by this plugin alone (`~/.dsh/.workbuddy2api/config.json`,
 * atomic writes): no dependency on the host settings service, so the card keeps
 * working on every host line. The `config` handed in from `cordis.patch.yml`
 * acts as defaults the stored file overrides field by field.
 *
 * @module dsh-workbuddy2api-panel-bridge
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Stable host plugin name; also the client bundle id and the settings page id. */
export const name = 'dsh-workbuddy2api-panel-bridge'

/** Only the LLM seam is a hard dependency; `webServer` is claimed lazily. */
export const inject = ['llm']

/** Same-origin route prefix the card talks to. */
export const ROUTE_PREFIX = '/plugins/dsh-workbuddy2api-panel-bridge'

/** Every route the card uses. */
export const ROUTES = Object.freeze({
  status: `${ROUTE_PREFIX}/status`,
  config: `${ROUTE_PREFIX}/config`,
  test: `${ROUTE_PREFIX}/test`,
  models: `${ROUTE_PREFIX}/models`,
  reset: `${ROUTE_PREFIX}/reset`,
})

/** Provider route a fresh install registers under. */
export const DEFAULT_PROVIDER_ROUTE = 'workbuddy2api'

/** Gateway address a fresh install points at — the WorkBuddy2API default port. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:7863/v1'

/**
 * Models seeded when the gateway cannot be reached on first boot, so the model
 * picker is never empty and the user can see the bridge exists. Replaced by a
 * live probe the moment one succeeds.
 *
 * The spelling matches what the WorkBuddy2API panel itself advertises: routes
 * are region-prefixed (`cn:` / `global:`), and a colon in the id is fine — it
 * travels to the gateway verbatim.
 */
export const FALLBACK_MODELS = Object.freeze(['cn:demo-flash'])

/** Context capacity assumed for a model the gateway does not describe. */
const DEFAULT_CONTEXT_WINDOW = 262144

/** Output capability assumed for a model the gateway does not describe. */
const DEFAULT_MAX_TOKENS = 32768

/** pi-ai thinking levels, in escalation order, that a reasoning model advertises. */
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Request-image budgets, taken from the pi-ai adapter defaults. */
const REQUEST_IMAGE_BUDGETS = Object.freeze({
  maxRequestImageBytes: 20971520,
  requestImagePixelBudget: 4194304,
  requestImageMaxBytes: 1048576,
})

/** Route-key grammar: what the LLM seam and its settings dict both accept. */
const ROUTE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Defaults a fresh install starts from; the patch layer's `config` wins over these. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Off keeps the stored settings but registers no route. */
  enabled: true,
  /** OpenAI-compatible root, with or without the trailing `/v1`. */
  baseUrl: DEFAULT_BASE_URL,
  /** Bearer token the gateway expects; empty means "send no Authorization header". */
  apiKey: '',
  /** Provider label shown in the model picker. */
  displayName: 'WorkBuddy2API',
  /** Provider route key. Advanced: changing it orphans the picker selection. */
  route: DEFAULT_PROVIDER_ROUTE,
  /** Model entries: `{ id, name?, contextWindow?, maxTokens?, vision?, reasoning? }`. */
  models: [],
  /** Model ids kept in the catalog but hidden from the picker. */
  hiddenModels: [],
  /** Probe `/v1/models` on boot and whenever the card asks. */
  autoDiscoverModels: true,
  /** Provider idle ceiling while one stream read is outstanding. */
  streamIdleTimeoutMs: 300000,
})

/** Drop a trailing slash so `${base}/models` never doubles up. */
function stripTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}

/** Normalize one address into the `/v1` root the OpenAI client expects. */
export function normalizeBaseUrl(raw) {
  const trimmed = stripTrailingSlash(String(raw ?? '').trim())
  if (trimmed === '') return DEFAULT_BASE_URL
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/**
 * Keep only the effort names pi-ai itself knows, lowercased and de-duplicated.
 * An empty result means "the gateway named no usable subset" and collapses to
 * undefined, which the descriptor reads as "advertise every level".
 */
function normalizeEfforts(raw) {
  if (!Array.isArray(raw)) return undefined
  const levels = []
  for (const value of raw) {
    const level = String(value ?? '').trim().toLowerCase()
    if (level !== '' && THINKING_LEVELS.includes(level) && !levels.includes(level)) levels.push(level)
  }
  return levels.length === 0 ? undefined : levels
}

/** Coerce one stored model entry into the shape the adapter and card both read. */
export function normalizeModel(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const id = String(entry.id ?? '').trim()
  if (id === '') return undefined
  const contextWindow = Number(entry.contextWindow)
  const maxTokens = Number(entry.maxTokens)
  const efforts = normalizeEfforts(entry.efforts)
  return {
    id,
    name: String(entry.name ?? id) || id,
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? Math.trunc(contextWindow) : DEFAULT_CONTEXT_WINDOW,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.trunc(maxTokens) : DEFAULT_MAX_TOKENS,
    vision: entry.vision === true,
    reasoning: entry.reasoning !== false,
    // Only present when the gateway named a usable subset of pi-ai's levels.
    ...(efforts === undefined ? {} : { efforts }),
  }
}

/** Merge stored values over defaults and drop everything that cannot be served. */
export function normalizeConfig(stored, fallback = {}) {
  const merged = { ...DEFAULT_CONFIG, ...fallback, ...(stored ?? {}) }
  const models = []
  const seen = new Set()
  for (const entry of Array.isArray(merged.models) ? merged.models : []) {
    const model = normalizeModel(entry)
    if (model === undefined || seen.has(model.id)) continue
    seen.add(model.id)
    models.push(model)
  }
  const hiddenModels = []
  for (const id of Array.isArray(merged.hiddenModels) ? merged.hiddenModels : []) {
    const value = String(id ?? '').trim()
    if (value !== '' && !hiddenModels.includes(value)) hiddenModels.push(value)
  }
  const route = String(merged.route ?? '').trim()
  const displayName = String(merged.displayName ?? '').trim()
  const idle = Number(merged.streamIdleTimeoutMs)
  return {
    enabled: merged.enabled !== false,
    baseUrl: normalizeBaseUrl(merged.baseUrl),
    apiKey: String(merged.apiKey ?? ''),
    displayName: displayName === '' ? DEFAULT_CONFIG.displayName : displayName,
    route: ROUTE_PATTERN.test(route) ? route : DEFAULT_PROVIDER_ROUTE,
    models,
    hiddenModels,
    autoDiscoverModels: merged.autoDiscoverModels !== false,
    streamIdleTimeoutMs: Number.isFinite(idle) && idle >= 1000 ? idle : DEFAULT_CONFIG.streamIdleTimeoutMs,
  }
}

/** Keep only what differs from the defaults, so the stored file stays readable. */
function diffFromDefaults(config) {
  const changed = {}
  for (const [key, value] of Object.entries(config)) {
    if (JSON.stringify(value) !== JSON.stringify(DEFAULT_CONFIG[key])) changed[key] = value
  }
  return changed
}

/** DSH home directory, honouring the override the host itself uses. */
export function dshHome(env = process.env) {
  const override = env.DSH_HOME
  return override !== undefined && override.trim() !== '' ? override.trim() : join(homedir(), '.dsh')
}

/** Directory this plugin keeps its own data in. */
export function pluginDataDir(env = process.env) {
  return join(dshHome(env), '.workbuddy2api')
}

/** Absolute path of the persisted configuration file. */
export function configFilePath(env = process.env) {
  return join(pluginDataDir(env), 'config.json')
}

/** Read the stored config; any read or parse failure degrades to `{}`. */
async function readStoredConfig(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Write-then-rename so a crash mid-write cannot truncate the file. */
async function writeStoredConfig(file, stored) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, file)
}

/** Read one response body as JSON, falling back to text for non-JSON errors. */
async function readJson(response) {
  const text = await response.text()
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 400) }
  }
}

/**
 * One gateway probe: what the WorkBuddy2API panel advertises on `/v1/models`.
 *
 * Hand-written rather than routed through the pi-ai seam so the card can test a
 * draft address the provider is not yet registered for — which is the entire
 * point of a "test connection" button.
 *
 * @param options - resolved base URL, bearer token, timeout.
 * @returns a token-free report the card renders as-is.
 */
export async function probeGateway(options) {
  const { baseUrl, apiKey, timeoutMs = 15000 } = options
  const started = Date.now()
  const headers = { accept: 'application/json' }
  if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  try {
    const response = await fetch(`${stripTrailingSlash(baseUrl)}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await readJson(response)
    const entries = Array.isArray(body?.data) ? body.data : []
    const modelIds = entries.map((entry) => String(entry?.id ?? '')).filter((id) => id !== '')
    const models = entries.map((entry) => modelFromGateway(entry)).filter((model) => model !== undefined)
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      modelIds,
      models,
      error: response.ok
        ? undefined
        : `${response.status} ${String(body?.error?.message ?? body?.raw ?? '')}`.trim(),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      modelIds: [],
      models: [],
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

/** Turn a discovered model id into a stored entry with conservative defaults. */
function modelFromId(id) {
  return normalizeModel({ id, name: id })
}

/**
 * Map one `/v1/models` entry onto a stored entry, capability fields included.
 *
 * WorkBuddy2API publishes real capabilities — `context_length`,
 * `max_output_tokens`, `supports_images`, `supports_reasoning` and the effort
 * list it accepts — so the bridge declares what the gateway declares instead of
 * flattening every model onto one conservative default. Absent capability
 * fields fall back conservatively: an undeclared modality stays text-only, an
 * undeclared reasoning flag stays reasoning-capable (the pre-existing default,
 * so a gateway that stops sending the flag does not silently lose thinking).
 */
export function modelFromGateway(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const id = String(entry.id ?? '').trim()
  if (id === '') return undefined
  const contextWindow = Number(entry.context_length)
  const maxTokens = Number(entry.max_output_tokens)
  return normalizeModel({
    id,
    name: String(entry.name ?? id) || id,
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
    vision: entry.supports_images === true,
    reasoning: entry.supports_reasoning !== false,
    efforts: entry.reasoning_supported_efforts,
  })
}

/** Map one stored entry onto the pi-ai descriptor the adapter streams with. */
function toPiModel(model, baseUrl, route) {
  // The gateway names the efforts it accepts; anything outside that list is
  // mapped to null so pi-ai drops it from the picker instead of sending a value
  // the upstream would have to clamp. "off" stays null unconditionally: with the
  // OpenAI-compatible wire format the seam can only omit `reasoning_effort`,
  // which the gateway reads as "use your own default" — offering it would be a
  // switch that cannot do what its label says.
  const offered = model.reasoning ? model.efforts ?? THINKING_LEVELS : undefined
  const thinkingLevelMap = offered === undefined
    ? undefined
    : Object.fromEntries([
        ['off', null],
        ...THINKING_LEVELS.map((level) => [level, offered.includes(level) ? level : null]),
      ])
  return {
    id: model.id,
    name: model.name,
    api: 'openai-completions',
    provider: route,
    baseUrl,
    input: model.vision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: thinkingLevelMap !== undefined,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    compat: { supportsReasoningEffort: thinkingLevelMap !== undefined },
  }
}

/**
 * Raised the instant a request reaches this route before a gateway token was
 * stored. pi-ai's own refusal names the symptom (`Provider is not configured`),
 * never the repair, so the runtime message has to carry the instructions.
 */
const MISSING_KEY_MESSAGE = 'dsh-workbuddy2api-panel-bridge: 未配置网关密钥，这条路由暂时无法发起请求。请在「设置 → WorkBuddy2API → 网关连接」填入 workbuddy2api-panel 的 api_key 并点「保存并生效」，然后重试。(Gateway token not configured — set it in Settings → WorkBuddy2API → Connection, then Save and apply.)'

/**
 * Inert pi-ai auth plane. The route's only credential is the token the card
 * stores, resolved per request, so pi-ai's own credential lifecycle must never
 * manufacture one for this route.
 */
const INERT_AUTH = {
  credentials: {
    async read() {},
    async list() {
      return []
    },
    async modify() {
      throw new Error('dsh-workbuddy2api-panel-bridge: this route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() {},
    async fileExists() {
      return false
    },
  },
}

/** Trust only same-origin and loopback callers for the read/write routes. */
function loopbackOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  let hostname
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
  const host = String(req.headers.host ?? '').split(':')[0]
  return host !== '' && hostname === host
}

/** Send one JSON reply with the no-store headers a live status poll needs. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Read a bounded JSON request body; `undefined` means "not valid JSON". */
async function readBody(req, limit = 262144) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Host half entry point. */
export function apply(ctx, config = {}) {
  const file = configFilePath()
  const logger = ctx.logger ?? console

  /** One mutable state object: everything below reads through it. */
  const state = {
    config: normalizeConfig({}, config),
    configSource: 'cordis',
    profiles: new Map(),
    adapter: undefined,
    releaseAdapter: undefined,
    registered: false,
    providerError: undefined,
    lastProbe: undefined,
    seeded: false,
    seam: undefined,
  }

  /**
   * Persist exactly what differs from the defaults.
   *
   * A catalog that is only the static seed is not knowledge, so it stays out of
   * the file: the next boot then probes again — now with the token the user just
   * saved — instead of treating one hard-coded id as the whole catalog forever.
   */
  const persist = () => {
    const doc = diffFromDefaults(state.config)
    if (state.seeded) delete doc.models
    // Once the file has been written it is what the next boot reads, so the
    // status card must stop reporting the cordis defaults as the source.
    state.configSource = 'file'
    return writeStoredConfig(file, doc)
  }

  /**
   * Rebuild the profile snapshot from the current config.
   *
   * The adapter's `profiles` thunk reads `state.profiles` on every operation, so
   * replacing the map is what makes a saved address reach the next request —
   * without re-registering the route, and without a restart.
   */
  const refreshProfiles = () => {
    if (state.seam === undefined) return
    const { createProvider, openAICompletionsApi, resolveRetryPolicy } = state.seam
    const buildModels = () => state.config.models
      .filter((model) => !state.config.hiddenModels.includes(model.id))
      .map((model) => toPiModel(model, state.config.baseUrl, state.config.route))
    const provider = {
      ...createProvider({
        id: state.config.route,
        name: state.config.displayName,
        auth: {
          apiKey: {
            name: 'WorkBuddy2API gateway token',
            async resolve({ credential }) {
              const key = credential?.key
              return key === undefined || key === '' ? undefined : { auth: { apiKey: key }, source: 'WorkBuddy2API' }
            },
          },
        },
        models: buildModels(),
        api: openAICompletionsApi(),
      }),
      getModels: () => buildModels(),
    }
    state.profiles = new Map([[state.config.route, {
      provider: state.config.route,
      displayName: state.config.displayName,
      streamIdleTimeoutMs: state.config.streamIdleTimeoutMs,
      retryPolicy: resolveRetryPolicy(undefined, 'dsh-workbuddy2api-panel-bridge retryPolicy'),
      configuredMaxTokens: new Map(),
      modelErrors: new Map(),
      ...REQUEST_IMAGE_BUDGETS,
      piProvider: provider,
    }]])
  }

  /**
   * The failure a request hits before a gateway token was stored. Uses the
   * host's own `LlmError` when the seam exports it, so the runtime reports a
   * real code (`MISSING_CREDENTIAL`) instead of a bare message; falls back to a
   * plain `Error` rather than requiring a newer host than the one we run on.
   */
  const missingKeyError = () => {
    const Ctor = state.seam?.LlmError
    return typeof Ctor === 'function'
      ? new Ctor(MISSING_KEY_MESSAGE, 'MISSING_CREDENTIAL')
      : new Error(MISSING_KEY_MESSAGE)
  }

  /** Build the one adapter this plugin ever registers; it reads live state. */
  const ensureAdapter = () => {
    if (state.adapter !== undefined || state.seam === undefined) return
    state.adapter = new state.seam.PiAiAdapter({
      profiles: () => state.profiles,
      auth: INERT_AUTH,
      // Without this the seam refuses every image block with "pi-ai image input
      // requires the durable attachment service", so a model descriptor that
      // advertises `image` would be a promise this bridge cannot keep.
      resolveAttachments: () => ctx.get('attachments'),
      resolveApiKey: async () => {
        const key = state.config.apiKey
        // pi-ai refuses an unresolvable credential with a bare "Provider is not
        // configured: <route>" — a symptom, with nothing pointing at the card
        // that can repair it. Fail first, and name the screen.
        if (key === '') throw missingKeyError()
        return key
      },
    })
  }

  /** Register the route, or re-register it when the route key moved. */
  const registerRoute = () => {
    if (state.seam === undefined) return
    ensureAdapter()
    refreshProfiles()
    if (!state.config.enabled) {
      state.releaseAdapter?.()
      state.releaseAdapter = undefined
      state.registered = false
      logRegistration('disabled')
      return
    }
    try {
      state.releaseAdapter?.()
      state.releaseAdapter = ctx.llm.registerAdapter([state.config.route], state.adapter)
      state.registered = true
      state.providerError = undefined
      logRegistration('registered')
    } catch (error) {
      state.registered = false
      state.providerError = error instanceof Error ? error.message : String(error)
      logger.error?.('dsh-workbuddy2api-panel-bridge: registerAdapter failed', error)
    }
  }

  /** One boot/rescan log line, kept quiet when nothing changed. */
  const logRegistration = (what) => {
    if (what === 'disabled') {
      logger.info?.('dsh-workbuddy2api-panel-bridge: provider disabled by configuration')
      return
    }
    logger.info?.(`dsh-workbuddy2api-panel-bridge: provider "${state.config.route}" -> ${state.config.baseUrl} (${state.config.models.length} model(s))`)
  }

  /**
   * Fold one fresh gateway answer into the stored catalog.
   *
   * Discovered entries carry the gateway's own capability fields, so a sync
   * rewrites context window, output cap, vision and the effort list instead of
   * re-freezing whatever was learned at first boot. A display name someone
   * edited by hand is the one thing the gateway cannot know about, so keep it.
   *
   * `keepMissing` is the whole difference between the two callers: a refresh
   * from the card may be asked to carry entries the gateway no longer lists,
   * while a boot-time sync treats the answer as the truth and drops them — an
   * upstream deletion must not leave a dead id in the catalog forever. The
   * deny-list follows whatever survives, so a dropped model cannot leave a
   * stale hidden id behind either.
   */
  const syncModels = (discovered, { keepMissing }) => {
    const known = new Map(state.config.models.map((model) => [model.id, model]))
    const models = discovered.map((model) => {
      const previous = known.get(model.id)
      return previous !== undefined && previous.name !== previous.id && previous.name !== model.name
        ? { ...model, name: previous.name }
        : model
    })
    const fresh = new Set(discovered.map((model) => model.id))
    const missing = state.config.models.filter((model) => !fresh.has(model.id))
    if (keepMissing) models.push(...missing)
    return {
      models,
      removed: keepMissing ? [] : missing,
      hiddenModels: state.config.hiddenModels.filter((id) => models.some((model) => model.id === id)),
    }
  }

  /**
   * Bring the catalog in line with the gateway on boot.
   *
   * Only a successful probe is knowledge: it is written to disk and the static
   * seed is then retired. A boot made while the gateway is down (or before the
   * token was stored) says nothing about the catalog, so whatever is stored is
   * kept — the seed included, marked as such, so `persist()` leaves it out of
   * the file and the next boot probes again.
   */
  const ensureModels = async () => {
    const seed = () => {
      state.seeded = true
      state.config = { ...state.config, models: FALLBACK_MODELS.map(modelFromId) }
    }
    if (!state.config.autoDiscoverModels) {
      if (state.config.models.length === 0) seed()
      return
    }
    const report = await probeGateway({
      baseUrl: state.config.baseUrl,
      apiKey: state.config.apiKey,
      timeoutMs: 8000,
    })
    state.lastProbe = report
    const discovered = report.ok ? report.models ?? [] : []
    if (discovered.length === 0) {
      if (state.config.models.length === 0) seed()
      return
    }
    const synced = syncModels(discovered, { keepMissing: false })
    const before = JSON.stringify([state.config.models, state.config.hiddenModels])
    state.seeded = false
    state.config = { ...state.config, models: synced.models, hiddenModels: synced.hiddenModels }
    if (synced.removed.length > 0) {
      logger.info?.(`dsh-workbuddy2api-panel-bridge: dropped ${synced.removed.length} model(s) the gateway no longer serves: ${synced.removed.map((model) => model.id).join(', ')}`)
    }
    // An unchanged catalog needs no write: the boot probe should not rewrite
    // the file (or its mtime) just because it ran.
    if (JSON.stringify([state.config.models, state.config.hiddenModels]) !== before) await persist()
  }

  /** Replace the stored config, persist it, then bring the seam in line. */
  const saveConfig = async (patch) => {
    state.config = normalizeConfig({ ...diffFromDefaults(state.config), ...patch }, config)
    state.configSource = 'file'
    await persist()
    registerRoute()
    return state.config
  }

  /** The status document the card renders; never contains the token itself. */
  const statusPayload = () => ({
    enabled: state.config.enabled,
    baseUrl: state.config.baseUrl,
    displayName: state.config.displayName,
    route: state.config.route,
    apiKeySet: state.config.apiKey !== '',
    autoDiscoverModels: state.config.autoDiscoverModels,
    streamIdleTimeoutMs: state.config.streamIdleTimeoutMs,
    models: state.config.models.map((model) => ({
      ...model,
      enabled: !state.config.hiddenModels.includes(model.id),
    })),
    registered: state.registered,
    providerError: state.providerError,
    seamReady: state.seam !== undefined,
    configFile: file,
    configSource: state.configSource,
    lastProbe: state.lastProbe,
    routePrefix: ROUTE_PREFIX,
  })

  /** Mount the card's routes on a context where `webServer` is available. */
  const registerRoutes = (webCtx) => {
    webCtx.effect(() => {
      const disposers = []
      const on = (path, handle) => {
        disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler: handle }))
      }
      /** Shared guard: right method, trusted caller, parsable body. */
      const guard = async (req, res, method) => {
        if (req.method !== method) {
          sendJson(res, 405, { error: 'method not allowed' })
          return undefined
        }
        if (!loopbackOrigin(req)) {
          sendJson(res, 403, { error: 'origin-not-trusted' })
          return undefined
        }
        if (method === 'GET') return {}
        const body = await readBody(req)
        if (body === undefined) {
          sendJson(res, 400, { error: 'invalid-json-body' })
          return undefined
        }
        return body
      }
      /**
       * An explicit value from the card wins, but an *empty* one means "use the
       * saved value" — the card never echoes a stored secret back into its input,
       * so a blank key field is the normal state after saving, not an instruction
       * to probe without credentials. (Saving already reads it the same way.)
       */
      const effective = (candidate, stored) =>
        typeof candidate === 'string' && candidate !== '' ? candidate : stored
      on(ROUTES.status, async (req, res) => {
        if (await guard(req, res, 'GET') === undefined) return
        sendJson(res, 200, statusPayload())
      })
      on(ROUTES.test, async (req, res) => {
        const body = await guard(req, res, 'POST')
        if (body === undefined) return
        const report = await probeGateway({
          baseUrl: normalizeBaseUrl(effective(body.baseUrl, state.config.baseUrl)),
          apiKey: effective(body.apiKey, state.config.apiKey),
          timeoutMs: 15000,
        })
        state.lastProbe = report
        sendJson(res, 200, report)
      })
      on(ROUTES.models, async (req, res) => {
        const body = await guard(req, res, 'POST')
        if (body === undefined) return
        const report = await probeGateway({
          baseUrl: normalizeBaseUrl(effective(body.baseUrl, state.config.baseUrl)),
          apiKey: effective(body.apiKey, state.config.apiKey),
          timeoutMs: 15000,
        })
        state.lastProbe = report
        if (!report.ok) return sendJson(res, 200, { ...report, models: statusPayload().models })
        const discovered = report.models ?? report.modelIds.map(modelFromId)
        // A plain refresh is the card saying "make this match the gateway", so
        // ids the upstream dropped are deleted here; `keepMissing` is only for
        // callers that ask to carry them over on purpose.
        const synced = syncModels(discovered, { keepMissing: body.keepMissing === true })
        state.config = { ...state.config, models: synced.models, hiddenModels: synced.hiddenModels }
        // The catalog now reflects a real answer from the gateway, so it is
        // durable even when some entries were only carried over.
        state.seeded = false
        await persist()
        registerRoute()
        sendJson(res, 200, {
          ...report,
          models: statusPayload().models,
          removed: synced.removed.map((model) => model.id),
        })
      })
      on(ROUTES.config, async (req, res) => {
        const body = await guard(req, res, 'POST')
        if (body === undefined) return
        const patch = {}
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
        if (typeof body.baseUrl === 'string') patch.baseUrl = body.baseUrl
        // Empty means "leave the stored token alone" on every route: the card
        // never echoes a secret, so a blank field is the normal resting state.
        if (typeof body.apiKey === 'string' && body.apiKey !== '') patch.apiKey = body.apiKey
        if (typeof body.displayName === 'string') patch.displayName = body.displayName
        if (typeof body.route === 'string') {
          const candidate = body.route.trim()
          // Refuse instead of quietly serving a different route key than the one
          // that was typed: a silent fallback leaves the card showing a name the
          // provider is not actually registered under.
          if (!ROUTE_PATTERN.test(candidate)) {
            return sendJson(res, 400, {
              error: `route 只能是小写字母、数字、点、下划线和短横线（不超过 64 字符）。/ route must match [a-z0-9][a-z0-9._-]{0,63}, got "${candidate}"`,
            })
          }
          patch.route = candidate
        }
        if (typeof body.autoDiscoverModels === 'boolean') patch.autoDiscoverModels = body.autoDiscoverModels
        if (Number.isFinite(Number(body.streamIdleTimeoutMs))) patch.streamIdleTimeoutMs = Number(body.streamIdleTimeoutMs)
        if (Array.isArray(body.models)) patch.models = body.models.map(normalizeModel).filter((model) => model !== undefined)
        if (Array.isArray(body.hiddenModels)) patch.hiddenModels = body.hiddenModels
        try {
          await saveConfig(patch)
        } catch (error) {
          return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
        sendJson(res, 200, statusPayload())
      })
      on(ROUTES.reset, async (req, res) => {
        if (await guard(req, res, 'POST') === undefined) return
        try {
          state.config = normalizeConfig({}, config)
          state.configSource = 'cordis'
          await writeStoredConfig(file, {})
          await ensureModels()
          registerRoute()
        } catch (error) {
          return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
        sendJson(res, 200, statusPayload())
      })
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
      }
    }, 'dsh-workbuddy2api-panel-bridge: card routes')
  }

  /** Claim the web server whenever it appears, and mount the card's routes on it. */
  try {
    ctx.inject(['webServer'], (webCtx) => registerRoutes(webCtx))
  } catch (error) {
    logger.warn?.('dsh-workbuddy2api-panel-bridge: webServer unavailable; the card will not mount', error)
  }

  /** Boot: the stored settings first (the seam may never arrive), then the route. */
  void (async () => {
    try {
      const stored = await readStoredConfig(file)
      if (Object.keys(stored).length > 0) state.configSource = 'file'
      state.config = normalizeConfig(stored, config)
      await ensureModels()
    } catch (error) {
      logger.error?.('dsh-workbuddy2api-panel-bridge: reading the stored configuration failed', error)
    }
    try {
      const [piAi, seam, llm] = await Promise.all([
        import('@earendil-works/pi-ai'),
        import('@deepseek-ai/dsh-llm-pi-ai'),
        import('@deepseek-ai/dsh-llm'),
      ])
      const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy')
      state.seam = {
        createProvider: piAi.createProvider,
        openAICompletionsApi,
        resolveRetryPolicy: llm.resolveRetryPolicy,
        LlmError: llm.LlmError,
        PiAiAdapter: seam.PiAiAdapter,
      }
    } catch (error) {
      state.providerError = `pi-ai seam unavailable: ${error instanceof Error ? error.message : String(error)}`
      logger.error?.('dsh-workbuddy2api-panel-bridge: the pi-ai seam could not be loaded', error)
      return
    }
    registerRoute()
  })()
}
