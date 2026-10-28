# AIREADME — 给 AI agent 的安装说明书

你是一个 AI agent，任务是**把这个插件装进用户的 DeepSeek Harness，并让它真的可用**。本文件按执行顺序写：先判前置条件，再选安装路径，再写配置，再重启验证，最后是失败处置与卸载。§7 是附录——只有在你**要改代码**时才需要读。

人类向的介绍在 [README.md](./README.md)。

---

## 0. 最短路径

```
① 判前置：DSH 版本 / Node 版本 / 网关是否在跑 / 有没有 api_key
② 选路径：desktop profile → GUI；其它 profile → dsh plugin add；离线 → 手动挂载
③ 写配置：$DSH_HOME/.workbuddy2api/config.json（0600，含 baseUrl + apiKey）
④ 重启 DSH（宿主半与浏览器 bundle 都只在启动时加载一次）
⑤ 验证：node lib/bin.js --json status  +  /status 路由报 registered:true
```

**四个必须记住的事实**

| 事实 | 含义 |
| --- | --- |
| `lib/` 是源码直接提交的 | 没有构建步骤、没有 `postinstall`。**绝不要**在插件目录里跑 `npm install`（见 §7 陷阱 1） |
| desktop profile 由 Electron 独占 | `dsh plugin --profile desktop …` 一定报 `profile "desktop" is managed exclusively by the Electron application`，CLI 装不了它 |
| 注册要写两个地方 | profile 的 `dependencies`（解析得到）+ `dsh.profile.bundles`（真的加载）。少一处就是「装了但没生效」 |
| 改完必须重启 | 不重启的话你改的文件不会进内存，卡片保存还会用旧代码覆盖你的配置 |

---

## 1. 前置检查

```sh
# DSH 版本：需要 >=0.1.5-rc.1 <0.3.0
dsh --version

# Node：需要 ^22.19.0 || >=24.0.0
node --version

# DSH 家目录（默认 ~/.dsh）；本插件的数据目录固定在 $DSH_HOME/.workbuddy2api
echo "${DSH_HOME:-$HOME/.dsh}"

# profile 列表：$DSH_HOME/profiles/<name>/package.json
ls "${DSH_HOME:-$HOME/.dsh}/profiles"

# 网关在不在（默认 127.0.0.1:7863）
curl -s --max-time 5 http://127.0.0.1:7863/healthz
curl -s --max-time 5 http://127.0.0.1:7863/v1/models -H "Authorization: Bearer $WB2API_KEY" | head -c 400
```

- 网关不在跑或 `/v1/models` 返回 401：**先解决这个**。插件只是桥，网关不通时它只能给你「模型列表只有 1 个种子」。
- `WB2API_KEY` 是用户面板 `config.json` 里的 `api_key`。**不要**把它写进任何会被提交的文件，也不要在回复里回显。

---

## 2. 安装

### 2.1 先确认目标是哪个 profile

```sh
PROFILE=desktop      # 换成用户实际的 profile
cat "${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/package.json"
```

看 `dependencies` 与 `dsh.profile.bundles` 两块——你最终要让包名同时出现在这两处。

### 2.2 路径 A —— 图形界面（**desktop profile 只能走这条**）

在 DSH 的插件 / 扩展面板里安装 bundle，填仓库地址 `github:wdmb123/dsh-workbuddy2api-panel-bridge`（等价 git URL：`https://github.com/wdmb123/dsh-workbuddy2api-panel-bridge.git`）。装完重启 DSH。

CLI 对 desktop 是硬拦截的，不要试图绕过：那不是权限提示，是 Electron 应用自己管着这个 profile。

### 2.3 路径 B —— 命令行（web / tui / 自定义 profile）

```sh
dsh plugin --profile "$PROFILE" add git+https://github.com/wdmb123/dsh-workbuddy2api-panel-bridge.git
```

其它等价形态：

```sh
dsh plugin --profile "$PROFILE" add /abs/path/to/dsh-workbuddy2api-panel-bridge    # 本地目录
pnpm pack && dsh plugin --profile "$PROFILE" add ./dsh-workbuddy2api-panel-bridge-0.1.2.tgz
```

它内部就是 pnpm，会同时更新 `package.json` 与 `pnpm-lock.yaml`。装完重启 DSH。

### 2.4 路径 C —— 手动挂载（离线、无包管理器、或要固定到本地检出）

1. 把仓库克隆/复制到 `$DSH_HOME/plugins/dsh-workbuddy2api-panel-bridge`。
2. 编辑 `$DSH_HOME/profiles/<profile>/package.json`，**两处都要**：

```jsonc
{
  "dependencies": {
    "dsh-workbuddy2api-panel-bridge": "link:/abs/path/to/dsh-workbuddy2api-panel-bridge"
  },
  "dsh": {
    "profile": {
      "bundles": [ /* … 在数组里追加一行 */ "dsh-workbuddy2api-panel-bridge" ]
    }
  }
}
```

3. 让 workspace 里出现可解析的入口（pnpm 走 `link:` 时通常由安装步骤自己建；手动改完补一个符号链接最稳）：

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE"
ln -s ../../../plugins/dsh-workbuddy2api-panel-bridge node_modules/dsh-workbuddy2api-panel-bridge
```

4. 重启 DSH。

> 仓库根目录**就是**插件目录（`package.json` 在根，`lib/` 在根下），不要往上层找。

---

## 3. 非交互式写配置（推荐，能省掉一轮 GUI 操作）

卡片写的就是这个文件：`$DSH_HOME/.workbuddy2api/config.json`。你可以直接写它，**不需要**先让用户去点卡片：

```sh
DIR="${DSH_HOME:-$HOME/.dsh}/.workbuddy2api"
mkdir -p "$DIR"
umask 077
cat > "$DIR/config.json" <<JSON
{
  "baseUrl": "http://127.0.0.1:7863/v1",
  "apiKey": "$WB2API_KEY"
}
JSON
chmod 600 "$DIR/config.json"
```

要点：

- 只写与默认值不同的字段。`displayName` 默认 `WorkBuddy2API`，`route` 默认 `workbuddy2api`，`enabled` 默认 `true`——都不用写。
- **不要手写 `models`**。`autoDiscoverModels` 默认开启，DSH 启动时会自己探测网关并把结果落盘。手写的目录只会在探测失败时白白固化成一个假清单。
- 写文件要用「临时文件 + rename」或至少保证整份写完；卡片自己是原子落盘的，别让两者的写入打架。
- 权限必须是 `0600`：里面有明文密钥。
- 如果用户不给密钥，就跳过这一步，装完告诉他去「设置 → WorkBuddy2API → 网关连接」填。

---

## 4. 重启与验证

**重启 DSH**（宿主半与浏览器 bundle 都只在启动时加载一次）。然后按顺序验：

```sh
# ① 插件自身可跑（不需要 DSH 在运行，也不碰宿主接缝）
cd "${DSH_HOME:-$HOME/.dsh}/plugins/dsh-workbuddy2api-panel-bridge"
node --check lib/index.js && node --check lib/client.js && node --check lib/bin.js
node lib/bin.js --json status

# ② 重启后，宿主侧路由挂上了没（把端口换成用户实际的 DSH Web 端口）
curl -s http://127.0.0.1:<dsh-web-port>/plugins/dsh-workbuddy2api-panel-bridge/status
```

判据：

| 检查 | 期望 | 不满足时说明 |
| --- | --- | --- |
| `node lib/bin.js --json status` | 退出码 0，JSON 里有 `apiKeySet`、`route`、`models` | 文件坏了或缺依赖，看 §5 |
| `/status` 的 `registered` | `true` | 包名没进 `bundles`，或注册行 `name` 与实际包名不一致 |
| `/status` 的 `seamReady` | `true` | pi-ai / dsh-llm-pi-ai 没解析出来，`providerError` 里有原文 |
| `/status` 的 `apiKeySet` | `true` | 密钥没写进去——回到 §3 |
| `/status` 的 `models` 条数 | 与网关 `/v1/models` 一致，不是 1 | 只探测到种子：密钥空 / 地址错 / 网关没跑 |
| 设置页出现 **WorkBuddy2API** 标签 | 有 | 该 profile 没有 `webServer`（TUI 属正常），或客户端 bundle 没加载 |
| 模型选择器里能选到该供应商的模型 | 有 | 模型被 `hiddenModels` 关掉了 |

改完/装完**不要**跳过重启就下结论。用户报「卡片上的提示自相矛盾」这类怪象时，先确认跑的是不是最新代码。

---

## 5. 失败模式 → 处置

| 症状 | 真实原因 | 怎么办 |
| --- | --- | --- |
| 卡片显示「未注册」 | 包名只进了 `dependencies`，没进 `dsh.profile.bundles`；或 `cordis.patch.yml` 的 `name` 与包名不符 | 补齐两处，重启 |
| 卡片显示「宿主侧路由未挂载」 | 插件在跑但同源路由没注册上（多为 webServer 缺失） | 正常降级，模型仍可用；要卡片就换带 Web 的 profile |
| 请求报 `Provider is not configured: workbuddy2api`（`PI_AI_ERROR`） | **不是路由问题**，是这条 provider 没解析出凭据 → 就是密钥没保存（`apiKeySet: false`） | 写 `apiKey` 进配置文件（§3）或让用户去卡片填，**不用重启**，下个请求就生效 |
| 请求报 `MISSING_CREDENTIAL` | 插件自己的预检（比上面那句多了「该去哪填」） | 同上 |
| 重启后目录里某个模型不见了 | 上游 `/v1/models` 不再返回它，启动同步以网关答案为准把它删掉了（日志会记一行 dropped） | 正常行为；确实还要用它就换一个上游仍然返回的 id |
| 模型列表只有 1 个（种子） | 从没探测成功过 | 查网关连通性与密钥，然后「从网关刷新」或重启 |
| 卡片空白 / 报错 | 该 profile 缺 `settings.section` 这类客户端插槽 | 模型路由不受影响；告知用户该 profile 的 Web 端不完整 |
| 装完毫无变化 | 没重启；或装到了别的 profile | 重启，并核对 `$DSH_HOME/profiles/<name>` |

排错时优先看这两个地方：卡片「② 运行状态」（接缝失败的原始错误就在那里）、`node lib/bin.js --json status`（不依赖宿主）。

---

## 6. 卸载与回滚

```sh
# CLI profile
dsh plugin --profile "$PROFILE" remove dsh-workbuddy2api-panel-bridge

# 手动挂载：从 dsh.profile.bundles 和 dependencies 里各删一行，重启 DSH
```

`dsh plugin` 就是 pnpm，它只会动 `dependencies` / `pnpm-lock.yaml`。删完**再打开 profile 的 `package.json` 确认 `dsh.profile.bundles` 里那一行也没了**——留着的话插件已经不在，那一行会变成一条加载失败。

- 配置与模型快照**不会**被一起删掉，它们留在 `$DSH_HOME/.workbuddy2api/config.json`。想彻底清干净：

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/.workbuddy2api"
```

- 想临时停用又保留配置：把配置里的 `enabled` 设为 `false`（或关掉卡片顶部总开关），整条路由下线、配置原样保留。
- 回滚到旧版本：`dsh plugin --profile "$PROFILE" add <旧 spec>`，或把 `link:` 指向旧的检出目录，重启。

---

## 7. 附录 —— 改代码前必须知道的

### 7.1 契约速查（改名 / 迁移时的同步点）

| 名字 | 出现位置 | 改不改 |
| --- | --- | --- |
| 包名 `dsh-workbuddy2api-panel-bridge` | `package.json` `name`；`cordis.patch.yml` `insert[].name`；`lib/index.js` `export const name`；profile 的 `dependencies` 键与 `link:` 路径；`dsh.profile.bundles`；`node_modules` 符号链接；`pnpm-lock.yaml` | 一起改，少一处就加载失败 |
| 入口 id `llm-workbuddy2api` | `cordis.patch.yml` `insert[].id` | **故意不改**：设置存储按 entry id 索引，改 id 会丢掉已保存的开关状态 |
| provider route `workbuddy2api` | `lib/index.js` `DEFAULT_PROVIDER_ROUTE`；用户 profile 里 `agent-default-model.config.provider` | **不要改**：改了默认模型选择会指向一个不存在的 provider |
| 路由前缀 `/plugins/dsh-workbuddy2api-panel-bridge` | `lib/index.js` `ROUTE_PREFIX` + `lib/client.js` 的 `ROUTES` | 两端必须一致；由插件自己 `ctx.webServer.register()` 挂载，宿主不按包名约束路径 |
| 配置路径 `$DSH_HOME/.workbuddy2api/config.json` | `lib/index.js` `configFilePath()` | 与包名解耦，改名不迁移 |
| `PAGE_ID = 'workbuddy2api'`、locale ns、CSS 前缀 `dsm-wb2api-*` | `lib/client.js` | 跟 provider route 走，不跟包名走 |

### 7.2 数据流

```
设置卡片 (lib/client.js) --同源 fetch--> /plugins/<pkg>/status|config|test|models|reset
                                            |
                                     lib/index.js (宿主进程)
                                            |
                    $DSH_HOME/.workbuddy2api/config.json   (0600)

对话请求 -> llm 接缝 -> registerAdapter 的 pi-ai adapter -> 网关 http://127.0.0.1:7863/v1
```

- 写动作只接受 **POST + 回环/同源来源**（`guard()`），其余一律拒绝。
- **只有 `GET /status` 是状态文档**（含 `apiKeySet` / `registered` / `seamReady` / `models`）。
- `GET /test`、`GET /models` 返回的是**探测报告**（`{ ok, status, latencyMs, modelIds, models? }`）。客户端任何动作结束后都**重新拉 `GET /status`**，绝不把动作返回值当状态用——这条对应一个真实修过的 bug（见陷阱 3）。
- 配置只有一处真源：文件。`configSource: 'file'` 表示文件里有值，`'cordis'` 表示只用了 patch 默认值。

### 7.3 网关能力 → 插件字段（唯一映射点 `modelFromGateway()`）

| 网关 `/v1/models` 字段 | 插件字段 | 规则 |
| --- | --- | --- |
| `id` | `id` | 必需，空则整条丢弃 |
| `name` | `name` | 缺省回退到 `id` |
| `context_length` | `contextWindow` | 必须是有限正数，否则 `undefined`（不是 0） |
| `max_output_tokens` | `maxTokens` | 同上 |
| `supports_images` | `vision` | 仅 `=== true` 才为真 |
| `supports_reasoning` | `reasoning` | 仅 `=== false` 才为假（默认按支持推理处理） |
| `reasoning_supported_efforts` | `efforts` | 字符串数组；声明了就必须原样进 `thinkingLevelMap` |

思考档位（`toPiModel`）：`off` 恒为 `null`。OpenAI 兼容线格式只能省略 `reasoning_effort`，表达不出「显式关闭」；网关未声明的档位也映射为 `null`（pi-ai 会把它从选择器里丢掉，而不是发一个上游要自行 clamp 的值）。

### 7.4 文件地图

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | host 半：配置归一化、探测、能力映射、pi-ai adapter 注册、5 条卡片路由 |
| `lib/client.js` | 浏览器半：一张设置页（连接 / 状态 / 模型目录 / 高级）、导航图标、locale |
| `lib/bin.js` | CLI：`status` / `test` / `models` / `path` / `routes`，`--json` 可脚本消费 |
| `lib/index.d.ts` | 类型面（`ModelEntry` / `ProbeReport` / `ResolvedConfig` 等） |
| `cordis.patch.yml` | 注册行：`id: llm-workbuddy2api`、`name: <包名>`，可选 `config:` 默认值 |
| `preview/card-preview.html` | 卡片的离线视觉预览（示意数据，非运行时） |
| `test/bootstrap.sh` | 搭 scratch harness 并跑 32 项断言 |
| `test/suite/*.test.mjs` | `unit` / `e2e` / `client` / `cli` 四组；`live-check.mjs` 打真实网关 |
| `README.md` / `AIREADME.md` | 人向介绍 / 本文件 |

### 7.5 验证（改完必跑）

```sh
cd "$DSH_HOME/plugins/dsh-workbuddy2api-panel-bridge"

for f in lib/index.js lib/client.js lib/bin.js; do node --check "$f"; done   # 语法
node lib/bin.js --json status                                              # CLI 就地（只读）
sh test/bootstrap.sh /tmp/wb2api-harness-v2                                # 32 项断言
node /tmp/wb2api-harness-v2/live-check.mjs                                 # 真实网关 12 项
```

`test/bootstrap.sh` 的 scratch 目录默认 `/tmp/wb2api-harness`；`live-check.mjs` 走 `WB2API_URL` / `WB2API_CONFIG` / `WB2API_KEY` 环境变量，默认读 `$DSH_HOME/.workbuddy2api/config.json`。

### 7.6 已知陷阱（都真踩过）

1. **不要在插件目录里 `npm install` 接缝包。** host 半按自身位置解析 `@earendil-works/pi-ai` 与两个 DSH seam 包；本地 `node_modules` 会遮蔽宿主 app bundle 里的副本。测试一律走 `test/bootstrap.sh` 的 scratch 目录。
2. **`dsh --profile desktop --dump-config` 不可用**：desktop 由 Electron 独占，CLI 报 `managed exclusively by the Electron application`。要验证挂载就走 GUI 或 `node --test`。
3. **客户端不得把动作返回值当状态。** 历史 bug：`run()` 无条件 `setStatus(result.payload)`，而 `/test`、`/models` 返回的是探测报告 → 卡片同时冒出「还没配置网关密钥」「未注册：不可用」「连接正常」三条互相矛盾的提示。现在统一在动作后重新 `GET /status`，且 `test` 时不回填草稿。
4. **entry id 与 provider route 是与状态/配置绑定的标识，不是显示名。** 改 id 丢设置状态；改 route 断掉用户 profile 里 `provider: workbuddy2api` 的默认模型行。
5. **`node --test` 的 spec reporter 只在子进程结束时打印该文件结果。** 某个文件挂住时你什么输出都看不到——先加 `--test-timeout`。
6. **`--legacy-peer-deps` 会漏装 peer。** `@deepseek-ai/dsh-llm` 的 peer（`dsh-timeout` / `dsh-settings` / `dsh-credentials`）必须显式列进安装清单，否则运行时报 `ERR_MODULE_NOT_FOUND`；`dsh-llm-pi-ai` 还 peer 一个未发布的 `@deepseek-ai/dsh-environment`，bootstrap 用「永远答 unknown」的桩满足它。
7. **发布前必须脱敏。** README、`FALLBACK_MODELS`、preview 与测试 fixture 里的真实网关模型 id 一律换成 `cn:demo-*` / `global:demo-*`——真实 id 会暴露网关路由表。`live-check.mjs` 走 `$DSH_HOME` / `WB2API_URL` / `WB2API_KEY`，不得出现本机绝对路径。

### 7.7 常见改动配方

- **加一条卡片路由**：`lib/index.js` 的 `ROUTES` 加键 → `registerRoutes()` 里 `on(ROUTES.x, …)`（写动作套 `guard(req, res, 'POST')`）→ `lib/client.js` 的 `ROUTES` 同步加同一前缀路径。两处前缀必须字面一致。
- **改能力映射**：只动 `modelFromGateway()`，并在 `test/suite/unit.test.mjs` 补一条断言。
- **改卡片 UI**：`lib/client.js`；class 一律带 `dsm-wb2api-` 前缀，颜色只用宿主的 `--dsw-alias-*` 主题变量并留亮/暗兜底。`test/suite/client.test.mjs` 是源码级断言（正则抠函数体），改结构时要同步。
- **升级版本**：`package.json` 的 `version`，并同步 README 里的 tarball 示例与测试项数说明。
