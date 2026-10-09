/**
 * Type surface for `dsh-workbuddy2api-panel-bridge`.
 *
 * The host half is plain ESM (no build step), so this file exists for editors
 * and for anyone importing the plugin from TypeScript — not as a compiled
 * artifact.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable host plugin name; also the client bundle id and the settings page id. */
export declare const name = 'dsh-workbuddy2api-panel-bridge'

/** Only the LLM seam is a hard dependency; `webServer` is claimed lazily. */
export declare const inject: readonly ['llm']

/** Same-origin route prefix the settings card talks to. */
export declare const ROUTE_PREFIX = '/plugins/dsh-workbuddy2api-panel-bridge'

/** Every route the card uses. */
export declare const ROUTES: {
  readonly status: string
  readonly config: string
  readonly test: string
  readonly models: string
  readonly reset: string
}

/** Provider route a fresh install registers under. */
export declare const DEFAULT_PROVIDER_ROUTE = 'workbuddy2api'

/** Gateway address a fresh install points at. */
export declare const DEFAULT_BASE_URL = 'http://127.0.0.1:7863/v1'

/** Models seeded when the gateway cannot be reached on first boot. */
export declare const FALLBACK_MODELS: readonly string[]

/** One model in the stored catalog. */
export interface ModelEntry {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  /** Advertise the `image` modality for this model. */
  vision: boolean
  /** Advertise thinking levels for this model. */
  reasoning: boolean
  /**
   * Thinking levels the gateway says it accepts for this model, in the
   * provider-neutral vocabulary (`minimal|low|medium|high|xhigh|max`).
   * Absent means "every level" — the gateway declared no effort list.
   */
  efforts?: readonly string[]
}

/** The plugin's own persisted configuration. */
export interface BridgeConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  displayName: string
  route: string
  models: ModelEntry[]
  hiddenModels: string[]
  autoDiscoverModels: boolean
  streamIdleTimeoutMs: number
}

/** Defaults a fresh install starts from. */
export declare const DEFAULT_CONFIG: Readonly<BridgeConfig>

/** Normalize one address into the `/v1` root the OpenAI client expects. */
export declare function normalizeBaseUrl(raw: unknown): string

/** Coerce one stored model entry; `undefined` when it has no usable id. */
export declare function normalizeModel(entry: unknown): ModelEntry | undefined

/**
 * Map one `/v1/models` record into a catalog entry, honouring the gateway's
 * `context_length` / `max_output_tokens` / `supports_images` /
 * `supports_reasoning` / `reasoning_supported_efforts` fields. Missing fields
 * fall back to the conservative plugin defaults.
 */
export declare function modelFromGateway(entry: unknown): ModelEntry | undefined

/** Merge stored values over the defaults and drop unserviceable entries. */
export declare function normalizeConfig(stored?: unknown, fallback?: Partial<BridgeConfig>): BridgeConfig

/** DSH home directory, honouring the `DSH_HOME` override. */
export declare function dshHome(env?: NodeJS.ProcessEnv): string

/** Directory this plugin keeps its own data in. */
export declare function pluginDataDir(env?: NodeJS.ProcessEnv): string

/** Absolute path of the persisted configuration file. */
export declare function configFilePath(env?: NodeJS.ProcessEnv): string

/** One gateway probe result; never carries the token. */
export interface ProbeReport {
  ok: boolean
  status: number
  latencyMs: number
  modelIds: string[]
  /** Catalog entries built from the gateway's own capability fields. */
  models: ModelEntry[]
  error?: string
}

/** Probe the gateway's `/v1/models`. */
export declare function probeGateway(options: {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
}): Promise<ProbeReport>

/** Host half entry point. */
export declare function apply(ctx: Context, config?: Partial<BridgeConfig>): void
