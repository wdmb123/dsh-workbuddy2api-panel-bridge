# 测试套件（宿主半 / 客户端半 / CLI）

32 项断言，覆盖 0.1.0–0.1.2 修掉的每一个 bug。**不随插件发布**（`package.json` 的 `files` 里没有 `test`），只在本机跑。

```sh
sh test/bootstrap.sh              # 默认 scratch 目录 /tmp/wb2api-harness
sh test/bootstrap.sh /tmp/xxx     # 换目录
```

脚本做四件事：把 `lib/` 复制到 scratch 目录、装好接缝包（`@earendil-works/pi-ai`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-llm-pi-ai`）、补一个 `@deepseek-ai/dsh-environment` 桩（该包未发布）、然后跑 `node --test`。

**为什么要 scratch 目录**：宿主半用裸说明符 import 接缝包，Node 按「import 它的那个文件所在位置」向上找 `node_modules`。所以测试必须在一个「`lib/` 的副本 + 旁边有 `node_modules`」的树里跑。**不要**把接缝包装进插件目录——本机 `node_modules` 会遮蔽 DSH 宿主自带的那些副本。

## 文件

| 文件 | 覆盖 |
| --- | --- |
| `suite/unit.test.mjs` | 纯函数：`normalizeBaseUrl`、`normalizeModel`（含 `efforts`）、`normalizeConfig`、`probeGateway`（能力字段映射、bearer、401、超时） |
| `suite/e2e.test.mjs` | 真起一个假网关 + 假 cordis ctx，驱动插件注册的 5 条路由：能力→模型描述符、思考档位、图片模态、`resolveAttachments` 接线、带图流式、`/models` 合并、`/reset`、guard（方法/Origin/体积）、探针失败不漏 token、探针路由返回报告而非状态文档 |
| `suite/client.test.mjs` | 以源码断言方式测客户端 bundle：模型开关方向、刷新带 `keepMissing: false`、动作完成后统一重读 `/status`（不再把探测报告当状态） |
| `suite/cli.test.mjs` | `lib/bin.js` 参数解析：旗标在子命令前后都要work、`--json` 不吞子命令、未知子命令退出码 |
| `suite/live-check.mjs` | 对**真实**网关（127.0.0.1:7863）跑 12 项：探测→目录→模型描述符→真实流式返回→刷新落盘。密钥从 `~/.dsh/.workbuddy2api/config.json` 读，用临时 `DSH_HOME`，不会动真实配置 |

## 改动插件源码后必须重建

`bootstrap.sh` 每次都会 `rsync` 刷新 `lib/` 副本；若手动跑测试，记得同步：

```sh
rsync -a --delete lib/ /tmp/wb2api-harness/plugin/lib/
```

## 跑测试的注意点

- `node --test test/`（目录形式）会 MODULE_NOT_FOUND，必须列文件。
- macOS 没有 `timeout` 命令。
- 别把输出管给 `tail`：会缓冲到进程结束，看不到进度。重定向到文件再看。
