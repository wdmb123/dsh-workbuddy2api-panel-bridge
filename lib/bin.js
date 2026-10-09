#!/usr/bin/env node
/**
 * dsh-workbuddy2api-panel-bridge CLI.
 *
 * A read-mostly companion to the settings card, for the moments a terminal is
 * closer than the browser: is the gateway up, which models does it serve, what
 * is stored right now.
 *
 * Runs standalone — it imports only the host module's pure helpers, so no
 * cordis context, no DSH boot, and no plugin installation is needed to use it.
 *
 *   dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge status
 *   dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge test
 *   dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge models
 *   dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge path
 */

import { readFile } from 'node:fs/promises'
import { configFilePath, DEFAULT_CONFIG, normalizeConfig, probeGateway, ROUTES } from './index.js'

const USAGE = `dsh-workbuddy2api-panel-bridge — WorkBuddy2API ↗ DSH bridge

用法：
  dsh-workbuddy2api-panel-bridge status          显示存储的配置与摘要
  dsh-workbuddy2api-panel-bridge test            探测网关 /v1/models 的连通性
  dsh-workbuddy2api-panel-bridge models          列出网关当前提供的模型
  dsh-workbuddy2api-panel-bridge path            打印配置文件路径
  dsh-workbuddy2api-panel-bridge routes          打印卡片使用的同源路由

选项：
  --json                            以 JSON 输出，便于脚本消费
  --base-url <url>                  覆盖配置文件里的地址
  --api-key <key>                   覆盖配置文件里的密钥
  --timeout <ms>                    探测超时，默认 15000
`

/** Flags that never take a value, so the token after them is never swallowed. */
const BOOLEAN_FLAGS = new Set(['json', 'help', 'h'])

/**
 * Split argv into flags and bare positionals.
 *
 * Which token is the subcommand has to be decided with the same rules that
 * consume flag values: a scan that only skips `--`-prefixed tokens reads
 * `--base-url http://… status` as the command `http://…`, and reads
 * `--json status` as the flag `json=status`, losing the subcommand. Boolean
 * flags are declared above so they never eat their neighbour.
 */
function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i += 1
    }
  }
  return { flags, positionals }
}

/** Read the stored config, falling back to the defaults. */
async function readStored() {
  const file = configFilePath()
  try {
    return normalizeConfig(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return normalizeConfig({})
  }
}

/** Render one probe report as a short human line. */
function formatProbe(report) {
  if (report.ok) {
    return `✅ 网关可达 · HTTP ${report.status} · ${report.latencyMs} ms · ${report.modelIds.length} 个模型`
  }
  return `❌ 网关不可达 · HTTP ${report.status} · ${report.latencyMs} ms · ${report.error ?? '未知错误'}`
}

/** Entry point. */
async function main() {
  const argv = process.argv.slice(2)
  const { flags, positionals } = parseArgs(argv)
  const command = positionals[0] ?? 'status'
  const asJson = flags.json === true

  if (command === 'help' || flags.help === true) {
    process.stdout.write(USAGE)
    return 0
  }

  if (command === 'path') {
    process.stdout.write(`${configFilePath()}\n`)
    return 0
  }

  if (command === 'routes') {
    const rows = [
      ['GET ', ROUTES.status, '配置 + 运行状态'],
      ['POST', ROUTES.config, '保存配置'],
      ['POST', ROUTES.test, '探测网关'],
      ['POST', ROUTES.models, '拉取并合并模型清单'],
      ['POST', ROUTES.reset, '恢复默认'],
    ]
    if (asJson) process.stdout.write(`${JSON.stringify(ROUTES, null, 2)}\n`)
    else for (const [method, path, note] of rows) process.stdout.write(`${method} ${path.padEnd(46)} ${note}\n`)
    return 0
  }

  const config = await readStored()
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : config.baseUrl
  const apiKey = typeof flags['api-key'] === 'string' ? flags['api-key'] : config.apiKey
  const timeoutMs = Number.isFinite(Number(flags.timeout)) ? Number(flags.timeout) : 15000

  if (command === 'status') {
    const summary = {
      enabled: config.enabled,
      baseUrl,
      displayName: config.displayName,
      route: config.route,
      apiKeySet: apiKey !== '',
      autoDiscoverModels: config.autoDiscoverModels,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
      models: config.models.map((model) => model.id),
      hiddenModels: config.hiddenModels,
      configFile: configFilePath(),
      defaults: DEFAULT_CONFIG,
    }
    if (asJson) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
      return 0
    }
    process.stdout.write([
      `桥接状态   ${config.enabled ? '已开启' : '已关闭'}`,
      `网关地址   ${baseUrl}`,
      `显示名     ${config.displayName}`,
      `路由名     ${config.route}`,
      `密钥       ${apiKey === '' ? '未设置' : `已设置（${apiKey.length} 字符）`}`,
      `自动探测   ${config.autoDiscoverModels ? '开' : '关'}`,
      `流空闲超时 ${config.streamIdleTimeoutMs} ms`,
      `模型清单   ${config.models.length === 0 ? '（空，将在启动时探测）' : config.models.map((model) => model.id).join(', ')}`,
      `隐藏模型   ${config.hiddenModels.length === 0 ? '（无）' : config.hiddenModels.join(', ')}`,
      `配置文件   ${configFilePath()}`,
      '',
      '在 DSH 里执行一次探测：',
      '  dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge test',
      '',
    ].join('\n'))
    return 0
  }

  if (command === 'test') {
    const report = await probeGateway({ baseUrl, apiKey, timeoutMs })
    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return report.ok ? 0 : 1
    }
    process.stdout.write(`${formatProbe(report)}\n`)
    if (!report.ok && report.error !== undefined) process.stdout.write(`  ${report.error}\n`)
    return report.ok ? 0 : 1
  }

  if (command === 'models') {
    const report = await probeGateway({ baseUrl, apiKey, timeoutMs })
    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return report.ok ? 0 : 1
    }
    if (!report.ok) {
      process.stdout.write(`${formatProbe(report)}\n`)
      return 1
    }
    process.stdout.write(`网关共提供 ${report.modelIds.length} 个模型（HTTP ${report.status} · ${report.latencyMs} ms）：\n`)
    for (const id of report.modelIds) {
      const stored = config.models.find((model) => model.id === id)
      const mark = config.hiddenModels.includes(id) ? '  [已隐藏]' : stored === undefined ? '  [未登记]' : ''
      process.stdout.write(`  · ${id}${mark}\n`)
    }
    return 0
  }

  process.stderr.write(`未知子命令：${command}\n\n${USAGE}`)
  return 2
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`dsh-workbuddy2api-panel-bridge: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  },
)
