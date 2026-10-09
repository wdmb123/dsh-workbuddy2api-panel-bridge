# DSH WorkBuddy2API Panel Bridge

> 要改代码、改包名或排查加载问题，先读 [AIREADME.md](./AIREADME.md) —— 面向 AI 的工程说明：契约同步点、数据流、验证命令、踩过的坑。

把你自己搭的 **WorkBuddy2API 反代网关**（OpenAI 兼容 `/v1`）接进 DeepSeek Harness，作为一个可选的模型供应商分组。装完不用改配置文件——所有开关都在 **设置 → WorkBuddy2API** 那张卡片上。

```
WorkBuddy 桌面账号 ──▶ workbuddy2api-panel ──▶ 本插件 ──▶ DSH 模型选择器
                      (Go 网关, :7863)        (pi-ai 适配器)
```

## 它是什么，不是什么

**是**：一层很薄的桥。插件自己**不碰腾讯的接口**，只是把 `http://127.0.0.1:7863/v1` 这个已经存在的 OpenAI 兼容端点，注册成 DSH LLM 接缝里的一条 provider 路由。

**不是**：第二个反代。账号登录、多号轮转、熔断冷却、签到保活这些事全部留在 `workbuddy2api-panel` 里——那是它的强项，插件不去重复实现。

> 和 `dsh-workbuddy-xdpool` 的区别：xdpool 自己把 WorkBuddy 协议实现了一遍，直接读桌面 App 的登录快照；本插件不管账号，只管**连接你已经跑起来的那套网关**。两者可以同时装，互不干扰（路由名不同）。

## 前置条件

1. `workbuddy2api-panel` 已经在跑，默认监听 `7863`，且 `/v1/models` 能正常返回。
2. 面板 `config.json` 里的 `api_key`。面板默认开启鉴权（无密钥访问 `/v1/models` 会返回 401），所以这一项**要填**，卡片里留空的话模型调用一定失败。

自检：

```sh
curl -s http://127.0.0.1:7863/healthz
curl -s http://127.0.0.1:7863/v1/models -H "Authorization: Bearer <你的 api_key>" | head
```

## 安装

```sh
# 从本地目录安装（本仓库根目录就是插件目录）
dsh plugin --profile desktop add ./dsh-workbuddy2api-panel-bridge

# 或者打成 tarball 再装
pnpm pack && dsh plugin --profile desktop add ./dsh-workbuddy2api-panel-bridge-0.1.2.tgz
```

> 插件**不含构建步骤**：`lib/` 里的四个产物（宿主 ESM、客户端 bundle、CLI、类型声明）都是源码直接提交，装的时候不会触发 pnpm 的构建脚本拦截，也不需要 Node 以外的工具链。

装完重启 DSH，然后：

- **卡片**：侧边栏左下角齿轮（或 `Ctrl+Alt+,`）→ 顶部标签里的 **WorkBuddy2API**
- **模型**：设置 → 模型 → 供应商选 `WorkBuddy2API`

## 卡片上有什么

四张卡，从上到下就是配置顺序：

| 卡片 | 干什么 |
| --- | --- |
| **① 网关连接** | 填地址（带不带 `/v1` 都行）和 API 密钥；「测试连接」当场探测，「保存并生效」立即写盘并重建 provider——**不需要重启 DSH** |
| **② 运行状态** | 路由名、注册状态、可用模型数、宿主接口状态、配置文件路径；接缝加载失败时把原始错误直接显示出来 |
| **③ 模型目录** | 「从网关刷新」拉取 `/v1/models`；每个模型一行，可看上下文窗口 / 是否收图 / 是否推理，右侧开关控制它是否出现在模型选择器里 |
| **④ 高级** | 显示名、路由名、流空闲超时、启动时自动探测模型；一键「恢复默认」 |

页面顶部还有一个总开关（状态胶囊右边），关掉就整条路由下线，配置保留。

## 配置

卡片写的是插件自己的文件：`~/.dsh/.workbuddy2api/config.json`（`0600`，写-改名原子落盘），只存与默认值不同的字段。

```json
{
  "baseUrl": "http://127.0.0.1:7863/v1",
  "apiKey": "你的面板密钥",
  "displayName": "WorkBuddy2API",
  "route": "workbuddy2api",
  "models": [{ "id": "cn:demo-reasoner", "name": "Demo Reasoner", "contextWindow": 1000000, "maxTokens": 64000, "vision": true, "reasoning": true, "efforts": ["high"] }],
  "hiddenModels": []
}
```

`models` 是首次启动（或 `/reset` 后）从网关探测到、并**只在探测成功时**落盘的一份快照；探测失败时内存里只有静态种子 `cn:demo-flash`，下次启动会重新探测。`efforts` 省略表示「每一档都提供」，写出来就是网关声明接受的那些档位。

`cordis.patch.yml` 里那一行也可以带 `config:`，作为**默认值**；卡片里保存过的字段优先。

> 密钥不出机器：`/status` 只回 `apiKeySet: true/false`，`/config` 的响应里也不回显密钥。

## 命令行

```sh
dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge status    # 当前配置摘要
dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge test      # 探测网关连通性
dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge models    # 列出网关提供的模型
dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge path      # 配置文件路径
dsh plugin --profile desktop exec dsh-workbuddy2api-panel-bridge routes    # 卡片用的同源路由
```

都支持 `--json`，另外 `--base-url` / `--api-key` / `--timeout` 可以临时覆盖配置文件，用来在填进卡片之前先验一下。选项放在子命令前面或后面都可以（`--json` 是布尔开关，不会吞掉紧跟其后的子命令）。

## 工作原理

**宿主侧**（`lib/index.js`）

- `export const inject = ['llm']` —— 只硬依赖 LLM 接缝。`webServer` 用 `ctx.inject(['webServer'], …)` 按需认领，所以 TUI 这类没有 Web 服务的 profile 仍然能拿到模型路由，只是没有卡片。
- 用 `@earendil-works/pi-ai` 的 `createProvider` + `openAICompletionsApi()` 造一个 pi-ai provider，再交给 `@deepseek-ai/dsh-llm-pi-ai` 的 `PiAiAdapter`，最后 `ctx.llm.registerAdapter([route], adapter)` 注册进接缝——和宿主自己「配置化 provider 路由」走的是同一条路。
- 适配器的 `profiles` 是个 thunk，读的是 `state.profiles`；保存配置时只替换这个 Map，所以新地址**下一个请求就生效**，不用重注册、不用重启。
- pi-ai 接缝是**动态 import** 的。万一将来宿主改名或去掉某个包，插件不会整体挂掉，而是把失败原因显示在卡片上（状态胶囊转红）。
- 五个同源路由（`/plugins/dsh-workbuddy2api-panel-bridge/*`）由 `ctx.webServer.register({kind:'exact'})` 挂载，写操作要求 `POST` + 回环/同源来源。

**客户端**（`lib/client.js`）

- 标准 `window.__ModuleLoader__.load({ id, factory })` 浏览器 bundle，`require('react')` 拿宿主的 React 实例。
- `exports.inject = ['slots', 'locale']` —— 只注入两条在所有 Web 行上都存在的服务；其它能力一律用 `ctx.get()` 探测后降级，避免某条宿主线上缺少某个服务导致 `apply` 根本不执行。
- 通过 `ctx.slots.inject('settings.section', …)` 注册一个平级设置页；再按标签匹配给导航行换上自己的图标（纯装饰，失败不影响页面）。
- 样式全部走宿主的 `--dsw-alias-*` 主题变量**并带明暗两套兜底色**，类名统一 `dsm-wb2api-*` 前缀，不污染宿主自己的卡片。

## 兼容性

| 场景 | 行为 |
| --- | --- |
| 宿主没有 `webServer` | 模型路由照常注册，卡片不显示 |
| 宿主缺 `settings` / `configForms` | 不受影响——本插件不用宿主的设置服务 |
| pi-ai / dsh-llm-pi-ai 加载失败 | 卡片仍可用，状态卡显示原始错误，可继续改配置 |
| `/status` 取不到（路由未挂载） | 卡片显示「宿主侧路由未挂载」提示，不白屏、不报错 |
| 宿主设置页导航选择器变了 | 只是图标不出现，页面本身照常 |
| 旧版 host（0.1.x） | 未验证；`inject` 只要求 `llm`，理论上可挂，但卡片依赖 `settings.section` 插槽契约 |

## 已知限制

- **模型 id 里的冒号照原样透传**。面板的模型名形如 `cn:demo-flash` / `global:demo-sol`，插件不做任何改写——改了就对不上网关的路由。
- **面板不在跑就只是不可达**，插件不会替你把面板拉起来，也不会自己去登录账号。
- 模型能力（上下文窗口 / 输出上限 / 是否收图 / 思考档位）**按网关的声明走**：面板 `/v1/models` 每一条都会给 `context_length`、`max_output_tokens`、`supports_images`、`supports_reasoning`、`reasoning_supported_efforts`，插件在首次发现和每次「刷新模型清单」时把这些字段映射到模型描述符上。字段缺失时才退回保守默认（`262144 / 32768 / 纯文本`，`supports_reasoning` 缺失时按「支持思考」处理）。
- **「关闭思考」这一档不下发**。网关只在 deepseek 系的 `thinking:{type:'disabled'}` 格式下才认「关掉思考」，而本插件走的是 OpenAI 兼容格式，那一档表达不出来——放了会变成一个说到做不到的开关，所以直接不提供；模型的 `only_reasoning` 也正好说明多数模型本来就不允许关。
- **思考档位只列出网关声明支持的那些**。网关不支持某档时该档映射为 `null`，pi-ai 会把它从选择器里摘掉，不会发一个上游要自己夹的值。
- 面板换端口、换密钥后，记得回卡片改一次——插件不会自动发现。

## 常见报错

**`Provider is not configured: workbuddy2api`（`PI_AI_ERROR`）**

这是 pi-ai 的措辞，**不是说路由没注册**（路由注册失败会在卡片上显示成「未注册」），而是说这条 provider **没解析出任何凭据**。pi-ai 的 `resolveProviderAuth` 只有三条命中路径——请求携带的 `apiKey` 覆盖值、凭据存储、环境发现——三条都没命中就抛这句。

本插件里它只有一个含义：**卡片里还没保存网关密钥**（`/status` 的 `apiKeySet` 是 `false`）。打开「设置 → WorkBuddy2API → 网关连接」，把面板 `config.json` 的 `api_key` 填进去，点「保存并生效」，再重试即可 —— 不用重启 DSH，配置下一个请求就生效。

新版插件在这种情况下会**提前抛错并写明该去哪填**（错误码 `MISSING_CREDENTIAL`），不再复用 pi-ai 那句无信息量的文案。

**模型列表只有 1 个（种子）**

说明还没连上网关：密钥没填、地址不对、或面板没在跑。点「测试连接」看探测结果，再去「模型目录」点「从网关刷新」。

## 测试

```sh
sh test/bootstrap.sh          # 装接缝包 + 跑 32 项断言（宿主半 / 客户端半 / CLI）
node /tmp/wb2api-harness/live-check.mjs   # 对真实网关的 12 项端到端检查
```

`test/` 不随插件发布，细节见 [test/README.md](./test/README.md)。

## 免责声明

本项目仅供个人学习与研究使用，仅驱动使用者自己已经搭好的本机网关。上游账号与接口的使用需遵守相应服务条款，由此产生的一切后果由使用者自行承担。本项目与腾讯、WorkBuddy、DeepSeek 均无关联。

## 许可证

[MIT](./LICENSE)
