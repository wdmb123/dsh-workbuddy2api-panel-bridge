# DSH WorkBuddy2API Panel Bridge

把你自己搭的 **WorkBuddy2API 反代网关**（OpenAI 兼容 `/v1`）接进 **DeepSeek Harness**，作为模型选择器里的一条供应商路由。

装完之后不用碰任何配置文件：地址、密钥、模型清单、开关，全在 **设置 → WorkBuddy2API** 那张卡片上。

```
WorkBuddy 桌面账号 ──▶ workbuddy2api-panel ──▶ 本插件 ──▶ DSH 模型选择器
                      (Go 网关, :7863)        (pi-ai 适配器)
```

> 让 AI agent 帮你装？把 [AIREADME.md](./AIREADME.md) 丢给它，那是写给 agent 的安装说明书。本文件是给人看的介绍与上手。

## 这是什么，不是什么

**是**：一层很薄的桥。插件自己**不碰任何上游接口**，只是把 `http://127.0.0.1:7863/v1` 这个已经存在的 OpenAI 兼容端点，注册成 DeepSeek Harness LLM 接缝里的一条 provider 路由。

**不是**：第二个反代。账号登录、多号轮转、熔断冷却、签到保活这些事全部留在 `workbuddy2api-panel` 里——那是它的强项，插件不去重复实现。

> 和 `dsh-workbuddy-xdpool` 的区别：xdpool 自己把 WorkBuddy 协议实现了一遍，直接读桌面 App 的登录快照；本插件不管账号，只管**连接你已经跑起来的那套网关**。两者可以同时装，互不干扰（路由名不同）。

## 特性

- **零构建**：`lib/` 里四个产物（宿主 ESM、浏览器 bundle、CLI、类型声明）都是源码直接提交。没有 `postinstall`、没有打包步骤，装的时候不会触发 pnpm 的构建脚本拦截。
- **卡片即配置**：「测试连接」当场探测网关，「保存并生效」立刻写盘并重建 provider——**不需要重启 DSH**，下一个请求就用新地址。
- **能力照网关的声明走**：上下文窗口、输出上限、是否收图、思考档位全部从 `/v1/models` 的字段映射过来，不猜、不硬编码。
- **模型目录可视化管理**：每个模型一行，右侧开关决定它是否出现在模型选择器里；隐藏的模型留在目录里，不丢配置。
- **密钥不出机器**：状态接口只回 `apiKeySet: true/false`，配置响应不回显密钥，落盘文件是 `0600`。
- **降级不崩**：宿主没有 `webServer`（比如 TUI profile）时模型路由照常注册，只是没有卡片；接缝加载失败会把原始错误直接显示在卡片上，而不是整体挂掉。
- **CLI 可脚本化**：`status` / `test` / `models` / `path` / `routes`，全部支持 `--json`。

## 前置条件

1. **DSH** `>=0.1.5-rc.1 <0.3.0`，**Node** `^22.19.0 || >=24.0.0`。
2. `workbuddy2api-panel` 网关已经在跑，默认监听 `7863`，`/v1/models` 能正常返回。
3. 面板 `config.json` 里的 `api_key`。面板默认开启鉴权（无密钥访问 `/v1/models` 返回 401），所以**这一项要填**——卡片里留空的话模型调用一定会失败。

自检：

```sh
curl -s http://127.0.0.1:7863/healthz
curl -s http://127.0.0.1:7863/v1/models -H "Authorization: Bearer <你的 api_key>" | head
```

## 安装

**方式一 · 图形界面（推荐，desktop profile 只能走这条）**

在 DSH 的插件 / 扩展面板里安装 bundle，填本仓库的地址（`github:<owner>/<repo>` 或 git URL），安装后重启 DSH。

> desktop profile 由 Electron 独占：`dsh plugin --profile desktop …` 会直接报 `profile "desktop" is managed exclusively by the Electron application`。所以桌面版请用界面装。

**方式二 · 命令行**

```sh
dsh plugin --profile <profile> add git+https://github.com/<owner>/dsh-workbuddy2api-panel-bridge.git

# 或者本地目录 / tarball
dsh plugin --profile <profile> add /path/to/dsh-workbuddy2api-panel-bridge
pnpm pack && dsh plugin --profile <profile> add ./dsh-workbuddy2api-panel-bridge-0.1.2.tgz
```

装完**重启 DSH**。

**方式三 · 手动挂载（离线可用）**

把仓库放到 `$DSH_HOME/plugins/dsh-workbuddy2api-panel-bridge`，然后在该 profile 的 `package.json` 里做两件事——只做一件不会生效：

```jsonc
{
  "dependencies": { "dsh-workbuddy2api-panel-bridge": "link:/绝对路径" },
  "dsh": { "profile": { "bundles": [ /* … 加一行 */ "dsh-workbuddy2api-panel-bridge" ] } }
}
```

`dependencies` 让它被解析到，`dsh.profile.bundles` 让它被真的加载。改完重启 DSH。

## 快速开始

1. 确认网关在跑（见上面的自检）。
2. DSH 里打开 **设置 → WorkBuddy2API**（侧边栏左下角齿轮，或 `Ctrl+Alt+,`）。
3. 在「网关连接」里填地址和面板 `api_key`，点 **测试连接** → **保存并生效**。
4. 去 **设置 → 模型**，供应商选 **WorkBuddy2API**，挑一个模型开聊。

## 设置卡片

四张卡，从上到下就是配置顺序：

| 卡片 | 干什么 |
| --- | --- |
| **① 网关连接** | 填地址（带不带 `/v1` 都行）和 API 密钥；「测试连接」当场探测，「保存并生效」立即写盘并重建 provider——不需要重启 |
| **② 运行状态** | 路由名、注册状态、可用模型数、宿主接口状态、配置文件路径；接缝加载失败时把原始错误直接显示出来 |
| **③ 模型目录** | 「从网关刷新」拉取 `/v1/models`；每个模型一行，可看上下文窗口 / 是否收图 / 是否推理，右侧开关控制它是否出现在模型选择器里 |
| **④ 高级** | 显示名、路由名、流空闲超时、启动时自动探测模型；一键「恢复默认」 |

页面顶部还有一个总开关（状态胶囊右边）：关掉就整条路由下线，配置保留。

## 配置

卡片写的是插件自己的文件：`$DSH_HOME/.workbuddy2api/config.json`（默认 `~/.dsh/…`），权限 `0600`，写-改名原子落盘，**只存与默认值不同的字段**。

```json
{
  "baseUrl": "http://127.0.0.1:7863/v1",
  "apiKey": "你的面板密钥",
  "displayName": "WorkBuddy2API",
  "route": "workbuddy2api",
  "models": [
    { "id": "cn:demo-reasoner", "name": "Demo Reasoner", "contextWindow": 1000000, "maxTokens": 64000, "vision": true, "reasoning": true, "efforts": ["high"] }
  ],
  "hiddenModels": []
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉就整条路由下线，配置保留 |
| `baseUrl` | `http://127.0.0.1:7863/v1` | 带不带尾部 `/v1` 都接受 |
| `apiKey` | 空 | 空字符串表示不发 `Authorization` 头 |
| `displayName` | `WorkBuddy2API` | 模型选择器里的分组名 |
| `route` | `workbuddy2api` | 高级项：改了会让已有选择器条目失联 |
| `models` | `[]` | 探测成功时落盘的一份快照 |
| `hiddenModels` | `[]` | 留在目录里但不出现在选择器里 |
| `autoDiscoverModels` | `true` | 启动时自动探测 |
| `streamIdleTimeoutMs` | 见源码 | 流式空闲超时 |

`models` 只在**探测成功**时落盘；探测失败时内存里只有静态种子，下次启动会重新探测。`efforts` 省略表示「每一档都提供」，写出来就是网关声明接受的那些档位。

`cordis.patch.yml` 里那一行也可以带 `config:` 作为**默认值**；卡片里保存过的字段优先。

## 命令行

```sh
dsh plugin --profile <profile> exec dsh-workbuddy2api-panel-bridge status   # 当前配置摘要
dsh plugin --profile <profile> exec dsh-workbuddy2api-panel-bridge test     # 探测网关连通性
dsh plugin --profile <profile> exec dsh-workbuddy2api-panel-bridge models   # 列出网关提供的模型
dsh plugin --profile <profile> exec dsh-workbuddy2api-panel-bridge path     # 配置文件路径
dsh plugin --profile <profile> exec dsh-workbuddy2api-panel-bridge routes   # 卡片用的同源路由
```

都支持 `--json`；`--base-url` / `--api-key` / `--timeout` 可以临时覆盖配置文件，用来在填进卡片之前先验一下。选项放子命令前后都行（`--json` 是布尔开关，不会吞掉紧跟其后的子命令）。

在插件目录里可以直接跑，不需要 DSH：

```sh
node lib/bin.js --json status
```

## 工作原理

**宿主侧**（`lib/index.js`）用 `@earendil-works/pi-ai` 造一个 provider，交给 `@deepseek-ai/dsh-llm-pi-ai` 的 `PiAiAdapter`，再 `ctx.llm.registerAdapter()` 注册进接缝——和宿主自己「配置化 provider 路由」走的是同一条路。适配器的 `profiles` 是个读 `state` 的 thunk，所以保存配置只需要换掉一个 Map，新地址**下一个请求就生效**。pi-ai 接缝是动态 import 的：将来宿主改名或去掉某个包，插件不会整体挂掉，而是把失败原因显示在卡片上。

**客户端**（`lib/client.js`）是标准 `window.__ModuleLoader__.load({...})` 浏览器 bundle，通过 `ctx.slots.inject('settings.section', …)` 注册一个平级设置页。样式只用宿主的 `--dsw-alias-*` 主题变量并带明暗两套兜底色，类名统一 `dsm-wb2api-*` 前缀，不污染别的卡片。

要改代码、改包名、排查加载问题，看 [AIREADME.md](./AIREADME.md)：契约同步点、数据流、验证命令、踩过的坑都在那里。

## 兼容性

| 场景 | 行为 |
| --- | --- |
| 宿主没有 `webServer` | 模型路由照常注册，卡片不显示 |
| 宿主缺 `settings` / `configForms` | 不受影响——本插件不用宿主的设置服务 |
| pi-ai / dsh-llm-pi-ai 加载失败 | 卡片仍可用，状态卡显示原始错误，可继续改配置 |
| `/status` 取不到（路由未挂载） | 卡片显示「宿主侧路由未挂载」提示，不白屏、不报错 |
| 宿主设置页导航选择器变了 | 只是图标不出现，页面本身照常 |

## 已知限制

- **模型 id 里的冒号照原样透传**。面板的模型名形如 `cn:demo-flash` / `global:demo-sol`，插件不做任何改写——改了就对不上网关的路由。
- **面板不在跑就只是不可达**：插件不会替你把面板拉起来，也不会自己去登录账号。
- **能力按网关声明走**：字段缺失时才退回保守默认（`262144 / 32768 / 纯文本`；`supports_reasoning` 缺失时按「支持思考」处理）。
- **「关闭思考」这一档不下发**。网关只在 deepseek 系的 `thinking:{type:'disabled'}` 格式下认「关掉思考」，本插件走的是 OpenAI 兼容格式，那一档表达不出来——放了就是一个说到做不到的开关，所以不提供；模型的 `only_reasoning` 也正好说明多数模型本来就不允许关。
- 面板换端口、换密钥后，记得回卡片改一次——插件不会自动发现。

## 常见问题

**`Provider is not configured: workbuddy2api`（`PI_AI_ERROR`）**

这是 pi-ai 的措辞，**不是说路由没注册**（路由注册失败会在卡片上显示成「未注册」），而是说这条 provider **没解析出任何凭据**。在本插件里它只有一个含义：**卡片里还没保存网关密钥**（`/status` 的 `apiKeySet` 是 `false`）。

打开「设置 → WorkBuddy2API → 网关连接」，把面板 `config.json` 的 `api_key` 填进去，点「保存并生效」，再重试即可——不用重启 DSH。新版插件在这种情况下会**提前抛错并写明该去哪填**（错误码 `MISSING_CREDENTIAL`），不再复用 pi-ai 那句没有信息量的文案。

**模型列表只有 1 个（种子）**

说明还没连上网关：密钥没填、地址不对、或面板没在跑。点「测试连接」看探测结果，再去「模型目录」点「从网关刷新」。

## 开发与测试

```sh
sh test/bootstrap.sh                      # 搭 scratch 环境 + 跑 32 项断言（宿主半 / 客户端半 / CLI）
node /tmp/wb2api-harness/live-check.mjs   # 对真实网关的 12 项端到端检查
node --check lib/index.js lib/client.js lib/bin.js
```

`test/` 不随包发布（`files` 里没有它，但 git 检出里有），细节见 [test/README.md](./test/README.md)。

## 免责声明

本项目仅供个人学习与研究使用，只驱动使用者自己已经搭好的本机网关。上游账号与接口的使用需遵守相应服务条款，由此产生的一切后果由使用者自行承担。本项目与腾讯、WorkBuddy、DeepSeek 均无关联。

## 许可证

[MIT](./LICENSE)
