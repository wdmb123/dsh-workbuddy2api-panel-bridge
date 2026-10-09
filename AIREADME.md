# AIREADME — dsh-workbuddy2api-panel-bridge

面向 AI / agent 读者的工程说明。人类向的介绍看 [README.md](./README.md)；本文件只讲**改代码前必须知道的东西**：契约、同步点、数据流、验证命令、以及踩过的坑。

## 0. 一句话与最小上下文

把本机自托管的 **WorkBuddy2API 反代网关**（OpenAI 兼容 `/v1`）接进 DeepSeek Harness，作为可选的模型供应商；配置走一张设置卡片，不用手改配置文件。

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-workbuddy2api-panel-bridge` |
| 版本 | `0.1.2` |
| 宿主入口 | `lib/index.js`（`export function apply(ctx, config)`） |
| 类型面 | `lib/index.d.ts` |
| 浏览器半 | `lib/client.js`（`window.__ModuleLoader__.load({...})`） |
| CLI | `lib/bin.js` → bin 名 `dsh-workbuddy2api-panel-bridge` |
| 安装形态 | DSH profile 以 `link:` 依赖安装（本机为 `~/.dsh/plugins/dsh-workbuddy2api-panel-bridge`） |
| 测试 | `test/bootstrap.sh` → 32 项；`live-check.mjs` → 12 项（需真实网关） |

三个产物、三种运行环境：`lib/index.js` 在**宿主进程**里跑（Cordis 插件），`lib/client.js` 在**浏览器**里跑（设置卡片），`lib/bin.js` **独立**跑（只 import host 半的纯函数，不需要 cordis、不需要启动 DSH）。

## 1. 契约速查 —— 改名 / 迁移时必须同步的点

| 名字 | 出现位置 | 改不改 |
| --- | --- | --- |
| 包名 `dsh-workbuddy2api-panel-bridge` | `package.json` `name`；`cordis.patch.yml` `insert[].name`；`lib/index.js` `export const name`；profile 的 `dependencies` 键与 `link:` 路径；profile 的 `dsh.profile.bundles`；`node_modules` 符号链接；`pnpm-lock.yaml` | 一起改，少一处就加载失败 |
| 入口 id `llm-workbuddy2api` | `cordis.patch.yml` `insert[].id` | **故意不改**：设置存储按 entry id 索引，改 id 会丢掉已保存的开关状态 |
| provider route `workbuddy2api` | `lib/index.js` `DEFAULT_PROVIDER_ROUTE`；用户 profile `cordis.patch.yml` 里 `agent-default-model.config.provider` | **不要改**：改了默认模型选择会指向一个不存在的 provider |
| 路由前缀 `/plugins/dsh-workbuddy2api-panel-bridge` | `lib/index.js` `ROUTE_PREFIX` + `lib/client.js` 的 `ROUTES` | 两端必须一致；由插件自己 `ctx.webServer.register()` 挂载，宿主不按包名约束路径 |
| 配置路径 `~/.dsh/.workbuddy2api/config.json` | `lib/index.js` `configFilePath()` | 与包名解耦，改名不迁移，`apiKey` / 模型目录原地保留 |
| 设置页 `PAGE_ID = 'workbuddy2api'`、locale ns、CSS 前缀 `dsm-wb2api-*`、`data-dsh-wb2api-*` | `lib/client.js` | 与 provider route 同族，跟着 route 走，不跟包名走 |

改名完整动作（已按此执行过一次）：

1. `mv ~/.dsh/plugins/<old> ~/.dsh/plugins/dsh-workbuddy2api-panel-bridge`
2. 插件内全量替换旧包名（`package.json`、`cordis.patch.yml`、`lib/*.js`、`lib/*.d.ts`、`README.md`、`test/suite/*.mjs`）
3. profile `package.json`：依赖键 + `link:` 路径 + `bundles` 数组
4. `rm node_modules/<old> && ln -s ../../../plugins/dsh-workbuddy2api-panel-bridge node_modules/dsh-workbuddy2api-panel-bridge`
5. `pnpm-lock.yaml` 与 `node_modules/.pnpm/lock.yaml` 同步替换
6. `grep -rl "<old>[^-]" ~/.dsh | grep -v <new>` 应为空
7. 重启 DSH（宿主与浏览器 bundle 都只在启动时加载）

## 2. 数据流

```
设置卡片 (client.js)  --同源 fetch-->  /plugins/<pkg>/status|config|test|models|reset
                                            |
                                     lib/index.js (host)
                                            |
                    ~/.dsh/.workbuddy2api/config.json   (0600, { apiKey, models[] })

对话请求 -> llm seam -> registerAdapter 的 pi-ai adapter -> 网关 http://127.0.0.1:7863/v1
```

- 写动作只接受 **POST + 回环/同源来源**（`guard()`）；其余方法或来源一律拒绝。
- 只有 `GET /status` 是**状态文档**（含 `apiKeySet` / `registered` / `seamReady` / `models`）。
- `GET /test`、`GET /models` 返回的是**探测报告**（`{ ok, status, latencyMs, modelIds, models? }`），不是状态文档。客户端任何动作结束后都重新拉 `GET /status`，绝不把动作返回值当状态用 —— 见 §6 陷阱 3。
- 配置只有一处真源：文件。`configSource` 为 `file` 表示文件里有值，`cordis` 表示只有 patch 默认值。

## 3. 网关能力 → 插件字段的映射

`modelFromGateway(entry)` 是唯一映射点（`lib/index.js`）：

| 网关 `/v1/models` 字段 | 插件字段 | 规则 |
| --- | --- | --- |
| `id` | `id` | 必需，空则整条丢弃 |
| `name` | `name` | 缺省回退到 `id` |
| `context_length` | `contextWindow` | 必须是有限正数，否则 `undefined`（不是 0） |
| `max_output_tokens` | `maxTokens` | 同上 |
| `supports_images` | `vision` | 仅 `=== true` 才为真；缺失/其他值为 `false` |
| `supports_reasoning` | `reasoning` | 仅 `=== false` 才为假（默认当作支持推理） |
| `reasoning_supported_efforts` | `efforts` | 字符串数组；声明了就必须原样进 `thinkingLevelMap` |

思考档位（`toPiModel`）：`off` 恒为 `null`。OpenAI 兼容线格式只能省略 `reasoning_effort`，表达不出「显式关闭」，所以不提供这个档；网关未声明的档位也映射为 `null`（pi-ai 会从选择器里丢掉，而不是发一个上游要自行 clamp 的值）。

## 4. 文件地图

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | host 半：配置归一化、探测、能力映射、pi-ai adapter 注册、5 条卡片路由 |
| `lib/client.js` | 浏览器半：一张设置页（连接 / 状态 / 模型目录 / 高级四张卡）、导航图标、locale |
| `lib/bin.js` | CLI：`status` / `test` / `models` / `path` / `routes`，`--json` 可脚本消费 |
| `lib/index.d.ts` | 类型面（`ModelEntry` / `ProbeReport` / `ResolvedConfig` 等） |
| `cordis.patch.yml` | 注册行：`id: llm-workbuddy2api`、`name: <包名>` |
| `preview/card-preview.html` | 卡片的离线视觉预览（示意数据，非运行时） |
| `test/bootstrap.sh` | 搭 scratch harness 并跑 32 项断言 |
| `test/suite/*.test.mjs` | `unit` / `e2e` / `client` / `cli` 四组；`live-check.mjs` 打真实网关 |

## 5. 验证（改完必跑）

```sh
cd ~/.dsh/plugins/dsh-workbuddy2api-panel-bridge

# 1. 语法
for f in lib/index.js lib/client.js lib/bin.js; do node --check "$f"; done

# 2. CLI 就地验证（读真实配置，只读动作）
node lib/bin.js --json status

# 3. 全套 32 项（scratch harness，不动真实 DSH）
sh test/bootstrap.sh /tmp/wb2api-harness-v2

# 4. 真实网关端到端 12 项（需 WorkBuddy2API 在 127.0.0.1:7863）
node /tmp/wb2api-harness-v2/live-check.mjs
```

改完 **必须重启 DSH** 才生效：host 半与浏览器 bundle 都只在启动时加载一次。重启前不要在卡片里保存或拨开关——旧代码会拿内存里的旧目录覆盖刚刷新的配置。

## 6. 已知陷阱（都真踩过）

1. **不要在插件目录里 `npm install` 接缝包。** host 半按自身位置解析 `@earendil-works/pi-ai` 与两个 DSH seam 包；本地 `node_modules` 会遮蔽宿主 app bundle 里的副本。测试一律走 `test/bootstrap.sh` 的 scratch 目录。
2. **`dsh --profile desktop --dump-config` 不可用**：desktop profile 由 Electron 独占，CLI 直接报 `profile "desktop" is managed exclusively by the Electron application`。要验证挂载就走 GUI 或 `node --test`，别指望 CLI。
3. **客户端不得把动作返回值当状态。** 历史 bug：`run()` 无条件 `setStatus(result.payload)`，而 `/test`、`/models` 返回的是探测报告 → 卡片同时冒出「还没配置网关密钥」「未注册：不可用」「连接正常」三条互相矛盾的提示。现在统一在动作后重新 `GET /status`，`test` 时不回填草稿。
4. **entry id 与 provider route 是与状态/配置绑定的标识，不是显示名。** 改 id 丢设置状态；改 route 断掉用户 profile 里 `provider: workbuddy2api` 的默认模型行。
5. **`node --test` 的 spec reporter 只在子进程结束时打印该文件结果。** 某个文件挂住时你什么输出都看不到——不要被「什么都没有」误导，先加 `--test-timeout`。
6. **`--legacy-peer-deps` 会漏装 peer。** `@deepseek-ai/dsh-llm` 的 peer（`dsh-timeout` / `dsh-settings` / `dsh-credentials`）必须显式列进安装清单，否则运行时报 `ERR_MODULE_NOT_FOUND`。`dsh-llm-pi-ai` 还 peer 一个未发布的 `@deepseek-ai/dsh-environment`，bootstrap 用「永远答 unknown」的桩满足它。
7. **发布前必须脱敏。** README、`FALLBACK_MODELS`、preview 与测试 fixture 里的真实网关模型 id 一律换成 `cn:demo-*` / `global:demo-*`；真实 id 会暴露网关路由表。`live-check.mjs` 走 `$DSH_HOME` / `WB2API_URL` / `WB2API_KEY`，不得出现本机绝对路径。

## 7. 常见改动配方

- **加一条卡片路由**：`lib/index.js` 的 `ROUTES` 加键 → 在 `registerRoutes()` 里 `on(ROUTES.x, ...)`（写动作套 `guard(req, res, 'POST')`）→ `lib/client.js` 的 `ROUTES` 同步加同一个前缀路径。两处前缀必须字面一致。
- **改能力映射**：只动 `modelFromGateway()`，并在 `test/suite/unit.test.mjs` 补一条断言（现有用例已覆盖「缺字段 → `undefined`」与「声明 efforts → 档位表」）。
- **改卡片 UI**：`lib/client.js`；class 一律带 `dsm-wb2api-` 前缀，颜色只用宿主的 `--dsw-alias-*` 主题变量并留亮/暗兜底。`test/suite/client.test.mjs` 是源码级断言（正则抠函数体），改结构时要同步。
- **升级版本**：`package.json` 的 `version`，并同步 README 里的 tarball 示例与测试项数说明。
