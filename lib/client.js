/**
 * dsh-workbuddy2api-panel-bridge — browser half.
 *
 * One settings page, four cards: connection, status, model catalog, advanced.
 * Every value is read from and written to the host half's own same-origin
 * routes, so the page needs no host settings service and degrades to a
 * read-only notice when those routes are not mounted.
 *
 * Styling rides the host's `--dsw-alias-*` theme variables with light/dark safe
 * fallbacks, and every class is namespaced `dsm-wb2api-*` so nothing leaks into
 * the shell's own cards.
 *
 * Wrapped by `window.__ModuleLoader__` because that is how the host's web
 * harness loads a client bundle: the factory receives a `require` bound to the
 * shell's shared module registry (react included), and the module's exports
 * become the client plugin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbuddy2api-panel-bridge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    //#region constants

    /** Stable browser plugin name. */
    const name = 'dsh-workbuddy2api-panel-bridge-client'

    /**
     * Client services the page needs.
     *
     * `slots` and `locale` exist on every web line we target; anything else the
     * card might want (a settings scope) is probed with `ctx.get()` instead of
     * injected, because a cordis inject entry the running line does not provide
     * keeps `apply` from ever running.
     */
    const inject = ['slots', 'locale']

    /** Settings page id, also the slot entry id and the nav icon marker key. */
    const PAGE_ID = 'workbuddy2api'

    /** Locale namespace the page's copy is registered under. */
    const LOCALE_NS = 'settings.workbuddy2api'

    /** Same-origin routes the host half mounts. */
    const ROUTES = {
      status: '/plugins/dsh-workbuddy2api-panel-bridge/status',
      config: '/plugins/dsh-workbuddy2api-panel-bridge/config',
      test: '/plugins/dsh-workbuddy2api-panel-bridge/test',
      models: '/plugins/dsh-workbuddy2api-panel-bridge/models',
      reset: '/plugins/dsh-workbuddy2api-panel-bridge/reset',
    }

    /** Attribute marking the settings nav row this page decorates. */
    const NAV_ICON_MARKER = 'data-dsh-wb2api-nav-icon'

    /** The settings shell's nav rows, scoped to the dialog on purpose. */
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

    /** Consecutive in-dialog passes that may miss the row before warning once. */
    const NAV_ICON_MISS_THRESHOLD = 3

    /** The page's nav glyph, masked so it follows the row's own colour. */
    const NAV_ICON_URL = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10 7h5a4 4 0 0 1 4 4v0"/><path d="M14 17H9a4 4 0 0 1-4-4v0"/></svg>',
    )}`

    //#endregion

    //#region styles

    /**
     * The page's whole stylesheet, injected once into `document.head`.
     *
     * Every surface colour is a `var(--dsw-alias-…)` with a fallback, so the
     * page follows the host theme when the variables exist and still renders
     * with sane contrast when they do not. No outer border or page margin: the
     * settings shell already renders this inside its own padded content column.
     */
    const PAGE_CSS = `
.dsm-wb2api-page{max-width:860px;width:100%;display:flex;flex-direction:column;gap:16px;font:inherit}
.dsm-wb2api-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dsm-wb2api-head-icon{width:34px;height:34px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;background:color-mix(in oklab, var(--dsw-alias-brand-primary,#5686fe) 16%, transparent);color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-wb2api-head-icon svg{width:19px;height:19px}
.dsm-wb2api-head-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 220px}
.dsm-wb2api-title{margin:0;font-size:16px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-wb2api-sub{margin:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-head-actions{display:flex;align-items:center;gap:8px;flex:none}

.dsm-wb2api-pill{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;border:1px solid transparent}
.dsm-wb2api-pill i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.dsm-wb2api-pill-ok{color:var(--dsw-alias-state-success-primary,#22a06b);background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.14));border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 34%, transparent)}
.dsm-wb2api-pill-warn{color:var(--dsw-alias-state-warning-primary,#d98b0d);background:var(--dsw-alias-state-warning-subtle,rgba(217,139,13,.14));border-color:color-mix(in oklab, var(--dsw-alias-state-warning-primary,#d98b0d) 34%, transparent)}
.dsm-wb2api-pill-err{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.14));border-color:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 34%, transparent)}
.dsm-wb2api-pill-idle{color:var(--dsw-alias-label-tertiary,#9aa0a8);background:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 14%, transparent);border-color:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 28%, transparent)}

.dsm-wb2api-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-wb2api-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsm-wb2api-card-title{margin:0;font-size:13.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#e8e8ea);display:flex;align-items:center;gap:8px}
.dsm-wb2api-step{flex:none;width:18px;height:18px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea);background:color-mix(in oklab, var(--dsw-alias-label-primary,#e8e8ea) 12%, transparent)}
.dsm-wb2api-card-desc{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-card-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-wb2api-body{display:flex;flex-direction:column;gap:12px}

.dsm-wb2api-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsm-wb2api-label{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-hint{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-dimmed,#8b8f97)}
.dsm-wb2api-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.dsm-wb2api-input-wrap{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-wb2api-input{flex:1;min-width:0;box-sizing:border-box;font:inherit;font-size:13px;line-height:20px;padding:7px 11px;border-radius:9px;color:var(--dsw-alias-label-primary,#e8e8ea);background:var(--dsw-alias-bg-layer-3,#1c1e22);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));outline:none;transition:border-color .16s,box-shadow .16s}
.dsm-wb2api-input::placeholder{color:var(--dsw-alias-label-dimmed,#7d828a)}
.dsm-wb2api-input:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#6b7078)}
.dsm-wb2api-input:focus{border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in oklab, var(--dsw-alias-brand-primary,#5686fe) 22%, transparent)}
.dsm-wb2api-input:disabled{opacity:.6;cursor:not-allowed}
.dsm-wb2api-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px}

.dsm-wb2api-btn{appearance:none;font:inherit;font-size:13px;line-height:1.5;font-weight:500;cursor:pointer;padding:5px 14px;border-radius:8px;border:1px solid transparent;transition:opacity .16s,background .16s,border-color .16s,color .16s;white-space:nowrap}
.dsm-wb2api-btn:disabled{opacity:.45;cursor:default}
.dsm-wb2api-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-wb2api-btn-primary{background:var(--dsw-alias-label-primary,#e8e8ea);color:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-wb2api-btn-primary:hover:not(:disabled){opacity:.88}
.dsm-wb2api-btn-outline{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.14));color:var(--dsw-alias-label-secondary,#c6c9d0);background:transparent}
.dsm-wb2api-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e8e8ea);border-color:var(--dsw-alias-label-dimmed,#6b7078);background:rgba(255,255,255,.04)}
.dsm-wb2api-btn-ghost{padding:5px 9px;color:var(--dsw-alias-label-tertiary,#9aa0a8);background:transparent}
.dsm-wb2api-btn-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e8e8ea);background:rgba(255,255,255,.05)}

.dsm-wb2api-note{display:flex;gap:9px;align-items:flex-start;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#c6c9d0);background:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 10%, transparent)}
.dsm-wb2api-note-err{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12))}
.dsm-wb2api-note-warn{color:var(--dsw-alias-state-warning-primary,#d98a1f);background:var(--dsw-alias-state-warning-subtle,rgba(217,138,31,.14))}
.dsm-wb2api-note-ok{color:var(--dsw-alias-state-success-primary,#22a06b);background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.12))}
.dsm-wb2api-note-icon{flex:none;font-weight:600}
.dsm-wb2api-note-text{margin:0;min-width:0;word-break:break-word}

.dsm-wb2api-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.dsm-wb2api-stat{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:11px;background:var(--dsw-alias-bg-layer-3,#1c1e22);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.07));min-width:0}
.dsm-wb2api-stat-key{font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-stat-val{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-wb2api-stat-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.dsm-wb2api-models{display:flex;flex-direction:column;gap:7px}
.dsm-wb2api-model{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-3,#1c1e22);transition:border-color .16s,background .16s;min-width:0}
.dsm-wb2api-model:hover{border-color:var(--dsw-alias-label-dimmed,#6b7078)}
.dsm-wb2api-model-off{opacity:.5}
.dsm-wb2api-model-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dsm-wb2api-model-id{font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-wb2api-model-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-tags{display:flex;gap:5px;flex-wrap:wrap;flex:none}
.dsm-wb2api-tag{padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#c6c9d0);background:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 16%, transparent)}
.dsm-wb2api-tag-on{color:var(--dsw-alias-state-success-primary,#22a06b);background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.16))}
.dsm-wb2api-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 22%, transparent);cursor:pointer;padding:0;transition:background .16s,border-color .16s}
.dsm-wb2api-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary,#e8e8ea);transition:transform .16s}
.dsm-wb2api-switch[data-on="true"]{background:var(--dsw-alias-state-success-primary,#22a06b);border-color:transparent}
.dsm-wb2api-switch[data-on="true"]::after{transform:translateX(14px)}
.dsm-wb2api-switch:disabled{cursor:not-allowed;opacity:.5}
.dsm-wb2api-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-wb2api-empty{padding:16px;border-radius:11px;text-align:center;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#9aa0a8);background:color-mix(in oklab, var(--dsw-alias-label-tertiary,#9aa0a8) 8%, transparent)}
.dsm-wb2api-steps{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-wb2api-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-dimmed,#8b8f97)}
`

    //#endregion

    //#region copy

    const zh = {
      'row.navLabel': 'WorkBuddy2API',
      'page.title': 'WorkBuddy2API 桥接',
      'page.sub': '把本机自建的 WorkBuddy2API 反代网关（OpenAI 兼容 /v1）接进 DSH，作为一组可选模型。',
      'page.enabled': '桥接已开启',
      'page.disabled': '桥接已关闭',
      'page.loading': '读取中…',
      'state.ok': '已连接',
      'state.warn': '未注册',
      'state.err': '异常',
      'state.off': '已停用',

      'conn.title': '网关连接',
      'conn.desc': '填写 WorkBuddy2API 面板里监听的那个地址与 API 密钥。地址带不带 /v1 都可以。',
      'conn.baseUrl': '网关地址',
      'conn.baseUrlHint': '默认 http://127.0.0.1:7863/v1，即面板的默认监听端口。',
      'conn.apiKey': 'API 密钥',
      'conn.apiKeyHint': '对应面板 config.json 里的 api_key。面板默认开启鉴权，必须填写，否则模型调用会失败；已保存过之后留空即沿用已存的密钥。',
      'conn.show': '显示',
      'conn.hide': '隐藏',
      'conn.test': '测试连接',
      'conn.testing': '测试中…',
      'conn.save': '保存并生效',
      'conn.saving': '保存中…',
      'conn.saved': '已保存，新配置立即生效（无需重启 DSH）。',
      'conn.testOk': '连接正常：HTTP {status}，{latency} ms，{count} 个模型。',
      'conn.testFail': '连接失败：{error}',
      'conn.probeAt': '最近一次探测：HTTP {status} · {latency} ms · {count} 个模型',

      'status.title': '运行状态',
      'status.desc': '宿主侧看到的真实状态。模型路由未注册时，模型选择器里不会出现本分组。',
      'status.route': '供应商路由',
      'status.registered': '路由注册',
      'status.registeredYes': '已注册',
      'status.registeredNo': '未注册',
      'status.models': '可用模型',
      'status.modelsUnit': '{count} 个',
      'status.seam': '宿主接口',
      'status.seamYes': '已就绪',
      'status.seamNo': '不可用',
      'status.configFile': '配置文件',
      'status.seamError': '宿主接口加载失败',

      'models.title': '模型目录',
      'models.desc': '从网关 /v1/models 拉取的模型清单。关掉的模型仍保留在配置里，只是不出现在模型选择器中。',
      'models.refresh': '从网关刷新',
      'models.refreshing': '刷新中…',
      'models.refreshOk': '已拉取 {count} 个模型。',
      'models.refreshOkRemoved': '已拉取 {count} 个模型，并删掉 {removed} 个上游已下线的模型：{ids}',
      'models.count': '当前模型数',
      'models.countUnit': '{count} 个',
      'models.countSub': '网关 /v1/models 返回的全部条目',
      'models.enabled': '启用模型数',
      'models.enabledSub': '在模型选择器中可见',
      'models.disabledSub': '{count} 个已关闭',
      'models.empty': '还没有模型。点「从网关刷新」拉取，或先确认网关地址填对了。',
      'models.ctx': '上下文 {count}',
      'models.vision': '可收图',
      'models.reasoning': '推理',
      'models.noVision': '纯文本',
      'models.toggle': '在模型选择器中显示 / 隐藏',

      'adv.title': '高级',
      'adv.desc': '一般不用改。路由名改动会让模型选择器里已保存的选择失效。',
      'adv.displayName': '显示名',
      'adv.route': '路由名',
      'adv.routeHint': '小写字母、数字、点、下划线、连字符。',
      'adv.idle': '流空闲超时 (ms)',
      'adv.idleHint': '单次流式读取之间允许的最长等待，默认 300000。',
      'adv.autoDiscover': '启动时自动探测模型',
      'adv.autoDiscoverHint': '关闭后只使用下面已保存的模型清单。',
      'adv.reset': '恢复默认',
      'adv.resetDone': '已恢复默认设置。',

      'help.title': '怎么用',
      'help.one': '确认 WorkBuddy2API 面板已启动（默认监听 7863）。',
      'help.two': '在这里填好地址与密钥，点「测试连接」，再点「保存并生效」。',
      'help.three': '打开「设置 → 模型」，在供应商列表里选择 WorkBuddy2API，挑一个模型即可。',

      'err.route404': '宿主侧路由未挂载（可能是这个 profile 没有 Web 服务）。配置卡片将无法保存。',
      'err.noKey': '还没配置网关密钥 —— 现在选择这条路由的模型会直接失败（宿主只会报 Provider is not configured）。请在下面「网关连接」里填入密钥，点「保存并生效」。',
      'err.generic': '操作失败：{error}',
      'common.on': '开',
      'common.off': '关',
      'common.yes': '是',
      'common.no': '否',
      'common.unknown': '未知',
    }

    const en = {
      'row.navLabel': 'WorkBuddy2API',
      'page.title': 'WorkBuddy2API bridge',
      'page.sub': 'Points DSH at your self-hosted WorkBuddy2API gateway (OpenAI-compatible /v1) and exposes it as one selectable model group.',
      'page.enabled': 'Bridge enabled',
      'page.disabled': 'Bridge disabled',
      'page.loading': 'Loading…',
      'state.ok': 'Connected',
      'state.warn': 'Not registered',
      'state.err': 'Error',
      'state.off': 'Disabled',

      'conn.title': 'Gateway connection',
      'conn.desc': 'Address and API key of the WorkBuddy2API panel. The URL works with or without the trailing /v1.',
      'conn.baseUrl': 'Gateway URL',
      'conn.baseUrlHint': 'Defaults to http://127.0.0.1:7863/v1, the panel\'s default port.',
      'conn.apiKey': 'API key',
      'conn.apiKeyHint': 'The api_key from the panel\'s config.json. The panel authenticates by default, so this is required — an empty key makes every call fail. Once saved, leaving it blank reuses the stored token.',
      'conn.show': 'Show',
      'conn.hide': 'Hide',
      'conn.test': 'Test connection',
      'conn.testing': 'Testing…',
      'conn.save': 'Save and apply',
      'conn.saving': 'Saving…',
      'conn.saved': 'Saved. The new settings are live — no DSH restart needed.',
      'conn.testOk': 'Reachable: HTTP {status}, {latency} ms, {count} models.',
      'conn.testFail': 'Unreachable: {error}',
      'conn.probeAt': 'Last probe: HTTP {status} · {latency} ms · {count} models',

      'status.title': 'Runtime status',
      'status.desc': 'What the host actually sees. Until the route is registered the group will not show up in the model picker.',
      'status.route': 'Provider route',
      'status.registered': 'Route',
      'status.registeredYes': 'Registered',
      'status.registeredNo': 'Not registered',
      'status.models': 'Usable models',
      'status.modelsUnit': '{count}',
      'status.seam': 'Host seam',
      'status.seamYes': 'Ready',
      'status.seamNo': 'Unavailable',
      'status.configFile': 'Config file',
      'status.seamError': 'Host seam failed to load',

      'models.title': 'Model catalog',
      'models.desc': 'Models read from the gateway\'s /v1/models. Switching one off keeps it configured but hides it from the picker.',
      'models.refresh': 'Refresh from gateway',
      'models.refreshing': 'Refreshing…',
      'models.refreshOk': 'Fetched {count} models.',
      'models.refreshOkRemoved': 'Fetched {count} models and removed {removed} the gateway no longer serves: {ids}',
      'models.count': 'In catalog',
      'models.countUnit': '{count}',
      'models.countSub': 'Every entry /v1/models returns',
      'models.enabled': 'Enabled',
      'models.enabledSub': 'Visible in the model picker',
      'models.disabledSub': '{count} switched off',
      'models.empty': 'No models yet. Refresh from the gateway, or check the address above.',
      'models.ctx': 'Context {count}',
      'models.vision': 'Vision',
      'models.reasoning': 'Reasoning',
      'models.noVision': 'Text only',
      'models.toggle': 'Show or hide in the model picker',

      'adv.title': 'Advanced',
      'adv.desc': 'Rarely needed. Changing the route key orphans a saved picker selection.',
      'adv.displayName': 'Display name',
      'adv.route': 'Route key',
      'adv.routeHint': 'Lowercase letters, digits, dot, underscore, hyphen.',
      'adv.idle': 'Stream idle timeout (ms)',
      'adv.idleHint': 'Longest wait between two reads of one stream. Default 300000.',
      'adv.autoDiscover': 'Discover models on boot',
      'adv.autoDiscoverHint': 'When off, only the stored catalog below is used.',
      'adv.reset': 'Restore defaults',
      'adv.resetDone': 'Defaults restored.',

      'help.title': 'How to use',
      'help.one': 'Make sure the WorkBuddy2API panel is running (port 7863 by default).',
      'help.two': 'Fill in the address and key here, press “Test connection”, then “Save and apply”.',
      'help.three': 'Open Settings → Models, pick WorkBuddy2API as the provider, then choose a model.',

      'err.route404': 'The host routes are not mounted (this profile may have no web server), so the card cannot save.',
      'err.noKey': 'No gateway token is stored yet — choosing a model on this route fails immediately (the host only reports “Provider is not configured”). Fill it in under Gateway connection and press “Save and apply”.',
      'err.generic': 'Failed: {error}',
      'common.on': 'on',
      'common.off': 'off',
      'common.yes': 'yes',
      'common.no': 'no',
      'common.unknown': 'unknown',
    }

    //#endregion

    //#region helpers

    /** Fill `{name}` placeholders in one copy string. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        values[key] === undefined || values[key] === null ? match : String(values[key]),
      )
    }

    /** Compact a token count for the model row meta line. */
    function formatTokens(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return '–'
      if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
      if (n >= 1000) return `${Math.round(n / 1000)}K`
      return String(n)
    }

    /** POST JSON and read the JSON reply, mapping every failure to one shape. */
    async function postJson(url, body) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        const payload = await response.json().catch(() => undefined)
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}${payload?.error === undefined ? '' : ` ${payload.error}`}` }
        }
        return { ok: true, payload }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /** GET JSON, mapping a missing route to a distinguishable failure. */
    async function getJson(url) {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } })
        if (response.status === 404) return { ok: false, missing: true, error: 'HTTP 404' }
        const payload = await response.json().catch(() => undefined)
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
        return { ok: true, payload }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /** Inject the page stylesheet once per document. */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector('style[data-dsh-wb2api-css="page"]')
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workbuddy2api-panel-bridge'
      tag.dataset.dshWb2apiCss = 'page'
      tag.textContent = PAGE_CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    //#endregion

    //#region icons

    /** One inline glyph; `name` picks the path set. */
    function Glyph({ name: glyph, size = 16 }) {
      const paths = {
        bridge: [
          h('circle', { key: 'a', cx: 7, cy: 7, r: 3 }),
          h('circle', { key: 'b', cx: 17, cy: 17, r: 3 }),
          h('path', { key: 'c', d: 'M10 7h5a4 4 0 0 1 4 4' }),
          h('path', { key: 'd', d: 'M14 17H9a4 4 0 0 1-4-4' }),
        ],
        plug: [h('path', { key: 'a', d: 'M12 3v6' }), h('path', { key: 'b', d: 'M8 9h8v4a4 4 0 0 1-8 0z' }), h('path', { key: 'c', d: 'M12 17v4' })],
        layers: [h('path', { key: 'a', d: 'M12 3l8 4.5-8 4.5-8-4.5z' }), h('path', { key: 'b', d: 'M4 12.5L12 17l8-4.5' }), h('path', { key: 'c', d: 'M4 16.5L12 21l8-4.5' })],
        sliders: [h('path', { key: 'a', d: 'M4 7h10' }), h('path', { key: 'b', d: 'M18 7h2' }), h('circle', { key: 'c', cx: 16, cy: 7, r: 2 }), h('path', { key: 'd', d: 'M4 17h4' }), h('path', { key: 'e', d: 'M12 17h8' }), h('circle', { key: 'f', cx: 10, cy: 17, r: 2 })],
        check: [h('path', { key: 'a', d: 'M20 6L9 17l-5-5' })],
        alert: [h('path', { key: 'a', d: 'M12 8v5' }), h('path', { key: 'b', d: 'M12 16.5h.01' }), h('path', { key: 'c', d: 'M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' })],
      }
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        paths[glyph] ?? [],
      )
    }

    //#endregion

    //#region primitives

    /** The page's card shell: title row, optional actions, body. */
    function Card({ step, title, desc, actions, children }) {
      return h(
        'section',
        { className: 'dsm-wb2api-card' },
        h(
          'header',
          { className: 'dsm-wb2api-card-head' },
          h(
            'h3',
            { className: 'dsm-wb2api-card-title' },
            step === undefined ? null : h('span', { className: 'dsm-wb2api-step' }, step),
            title,
          ),
          actions === undefined ? null : h('div', { className: 'dsm-wb2api-card-actions' }, actions),
        ),
        desc === undefined ? null : h('p', { className: 'dsm-wb2api-card-desc' }, desc),
        children === undefined ? null : h('div', { className: 'dsm-wb2api-body' }, children),
      )
    }

    /** One labelled control with an optional hint. */
    function Field({ label, hint, children }) {
      return h(
        'div',
        { className: 'dsm-wb2api-field' },
        h('span', { className: 'dsm-wb2api-label' }, label),
        children,
        hint === undefined ? null : h('p', { className: 'dsm-wb2api-hint' }, hint),
      )
    }

    /** Text input with the page's own look, forwarded to a native input. */
    function Input(props) {
      const { className, ...rest } = props
      return h('input', { ...rest, className: `dsm-wb2api-input${className === undefined ? '' : ` ${className}`}` })
    }

    /** One button; `variant` is `primary` | `outline` | `ghost`. */
    function Button({ variant = 'outline', children, ...rest }) {
      return h('button', { type: 'button', ...rest, className: `dsm-wb2api-btn dsm-wb2api-btn-${variant}` }, children)
    }

    /** A status chip: dot plus label, coloured by `tone`. */
    function Pill({ tone, label }) {
      return h('span', { className: `dsm-wb2api-pill dsm-wb2api-pill-${tone}` }, h('i', null), label)
    }

    /** One note strip; `tone` is `info` | `ok` | `warn` | `err`. */
    function Note({ tone = 'info', children }) {
      const glyph = tone === 'ok' ? 'check' : tone === 'err' ? 'alert' : 'alert'
      return h(
        'div',
        { className: `dsm-wb2api-note${tone === 'info' ? '' : ` dsm-wb2api-note-${tone}`}` },
        h('span', { className: 'dsm-wb2api-note-icon' }, h(Glyph, { name: glyph, size: 14 })),
        h('p', { className: 'dsm-wb2api-note-text' }, children),
      )
    }

    /** One tile in the status grid. */
    function Stat({ label, value, sub }) {
      return h(
        'div',
        { className: 'dsm-wb2api-stat' },
        h('span', { className: 'dsm-wb2api-stat-key' }, label),
        h('span', { className: 'dsm-wb2api-stat-val' }, value),
        sub === undefined ? null : h('span', { className: 'dsm-wb2api-stat-sub' }, sub),
      )
    }

    /** The page's toggle switch. */
    function Switch({ checked, onChange, disabled, title }) {
      return h('button', {
        type: 'button',
        className: 'dsm-wb2api-switch',
        'data-on': checked ? 'true' : 'false',
        'aria-pressed': checked ? 'true' : 'false',
        title,
        disabled: disabled === true,
        onClick: () => onChange(!checked),
      })
    }

    //#endregion

    //#region page

    /**
     * The settings page.
     *
     * All persistence goes through the host routes; the component keeps a draft
     * for the text fields so typing never races a status poll, and re-seeds that
     * draft whenever the host reports a different stored value.
     */
    function BridgeCard({ t }) {
      const [status, setStatus] = useState(undefined)
      const [loading, setLoading] = useState(true)
      const [routesMissing, setRoutesMissing] = useState(false)
      const [error, setError] = useState(undefined)
      const [flash, setFlash] = useState(undefined)
      const [busy, setBusy] = useState(undefined)
      const [probe, setProbe] = useState(undefined)
      const [showKey, setShowKey] = useState(false)
      const [draft, setDraft] = useState({ baseUrl: '', apiKey: '', displayName: '', route: '', streamIdleTimeoutMs: '' })
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        const dispose = installStyles()
        return () => {
          mounted.current = false
          dispose()
        }
      }, [])

      /** Re-seed the text draft from a freshly reported status. */
      const seedDraft = useCallback((next) => {
        if (next === undefined) return
        setDraft({
          baseUrl: next.baseUrl,
          apiKey: '',
          displayName: next.displayName,
          route: next.route,
          streamIdleTimeoutMs: String(next.streamIdleTimeoutMs),
        })
      }, [])

      const refresh = useCallback(async () => {
        const result = await getJson(ROUTES.status)
        if (!mounted.current) return undefined
        setLoading(false)
        if (!result.ok) {
          setRoutesMissing(result.missing === true)
          setError(result.error)
          return undefined
        }
        setRoutesMissing(false)
        setError(undefined)
        setStatus(result.payload)
        setProbe(result.payload?.lastProbe)
        seedDraft(result.payload)
        return result.payload
      }, [seedDraft])

      useEffect(() => {
        void refresh()
      }, [refresh])

      /** Run one write action with a busy key, then re-read the status. */
      const run = useCallback(
        async (key, action) => {
          setBusy(key)
          setError(undefined)
          setFlash(undefined)
          const result = await action()
          if (!mounted.current) return
          setBusy(undefined)
          if (result?.ok !== true) {
            setError(result?.error ?? 'unknown')
            return
          }
          // Only `/status` describes this plugin's own state. `/test` and
          // `/models` answer with a probe report, whose payload carries no
          // `apiKeySet` / `registered` — storing one as the status made the card
          // announce a missing key and an unregistered route right after a
          // successful connection test. Re-read the status instead of trusting
          // each action's payload shape, and leave the draft alone: testing a
          // connection must not wipe what the user just typed.
          const statusResult = await getJson(ROUTES.status)
          if (!mounted.current) return
          if (statusResult.ok !== true) return
          const next = statusResult.payload
          setStatus(next)
          if (key !== 'test') setProbe(next?.lastProbe)
          if (key === 'save' || key === 'reset') seedDraft(next)
        },
        [seedDraft],
      )

      const onTest = () => run('test', async () => {
        const result = await postJson(ROUTES.test, { baseUrl: draft.baseUrl, apiKey: draft.apiKey })
        if (result.ok === true) {
          setProbe(result.payload)
          if (result.payload?.ok === true) {
            setFlash({ tone: 'ok', text: fill(t('conn.testOk'), { status: result.payload.status, latency: result.payload.latencyMs, count: result.payload.modelIds?.length ?? 0 }) })
          } else {
            setFlash({ tone: 'err', text: fill(t('conn.testFail'), { error: result.payload?.error ?? t('common.unknown') }) })
          }
        }
        return result
      })

      const onSave = () => run('save', async () => {
        const idle = Number(draft.streamIdleTimeoutMs)
        const patch = {
          baseUrl: draft.baseUrl,
          displayName: draft.displayName,
          route: draft.route,
        }
        if (draft.apiKey !== '') patch.apiKey = draft.apiKey
        if (Number.isFinite(idle) && idle >= 1000) patch.streamIdleTimeoutMs = idle
        const result = await postJson(ROUTES.config, patch)
        if (result.ok === true) setFlash({ tone: 'ok', text: t('conn.saved') })
        return result
      })

      const onRefreshModels = () => run('models', async () => {
        // A refresh is a re-read of the gateway, so models it no longer serves
        // must actually disappear — otherwise a retired id stays selectable
        // forever behind a silently-kept flag. The host reports what it dropped
        // so the notice can name it instead of the catalog shrinking silently.
        const result = await postJson(ROUTES.models, { baseUrl: draft.baseUrl, apiKey: draft.apiKey, keepMissing: false })
        if (result.ok === true) {
          const count = result.payload?.models?.length ?? 0
          const removed = result.payload?.removed ?? []
          setFlash({
            tone: 'ok',
            text: removed.length === 0
              ? fill(t('models.refreshOk'), { count })
              : fill(t('models.refreshOkRemoved'), { count, removed: removed.length, ids: removed.join(', ') }),
          })
        }
        return result
      })

      const onToggleModel = (id, enabled) => run(`model:${id}`, async () => {
        // `hiddenModels` is a deny-list, so the model being switched *on* must be
        // removed from it; every other model keeps whatever state it already had.
        const hidden = (status?.models ?? []).filter((model) => (model.id === id ? !enabled : model.enabled === false)).map((model) => model.id)
        return postJson(ROUTES.config, { hiddenModels: hidden })
      })

      const onToggleAutoDiscover = (next) => run('autodiscover', () => postJson(ROUTES.config, { autoDiscoverModels: next }))

      const onToggleEnabled = (next) => run('enabled', () => postJson(ROUTES.config, { enabled: next }))

      const onReset = () => run('reset', async () => {
        const result = await postJson(ROUTES.reset, {})
        if (result.ok === true) {
          setFlash({ tone: 'ok', text: t('adv.resetDone') })
          setProbe(undefined)
        }
        return result
      })

      const enabled = status?.enabled !== false
      const registered = status?.registered === true
      const seamReady = status?.seamReady !== false
      const tone = enabled !== true ? 'idle' : registered === true && seamReady === true ? 'ok' : registered !== true ? 'warn' : 'err'
      const toneLabel = enabled !== true ? t('state.off') : registered === true && seamReady === true ? t('state.ok') : registered !== true ? t('state.warn') : t('state.err')

      const head = h(
        'header',
        { className: 'dsm-wb2api-head' },
        h('div', { className: 'dsm-wb2api-head-icon' }, h(Glyph, { name: 'bridge', size: 19 })),
        h(
          'div',
          { className: 'dsm-wb2api-head-copy' },
          h('h2', { className: 'dsm-wb2api-title' }, t('page.title')),
          h('p', { className: 'dsm-wb2api-sub' }, t('page.sub')),
        ),
        h(
          'div',
          { className: 'dsm-wb2api-head-actions' },
          h(Pill, { tone, label: loading ? t('page.loading') : toneLabel }),
          h(Switch, { checked: enabled === true, disabled: busy !== undefined || status === undefined, title: t('page.enabled'), onChange: onToggleEnabled }),
        ),
      )

      const notices = []
      if (routesMissing === true) notices.push(h(Note, { key: 'routes', tone: 'err' }, t('err.route404')))
      if (error !== undefined && routesMissing !== true) notices.push(h(Note, { key: 'err', tone: 'err' }, fill(t('err.generic'), { error })))
      if (status !== undefined && enabled === true && status.apiKeySet !== true) {
        notices.push(h(Note, { key: 'nokey', tone: 'warn' }, t('err.noKey')))
      }
      if (seamReady === false) {
        notices.push(h(Note, { key: 'seam', tone: 'err' }, `${t('status.seamError')}：${status?.providerError ?? t('common.unknown')}`))
      } else if (registered !== true && enabled === true) {
        notices.push(h(Note, { key: 'reg', tone: 'info' }, `${t('status.registeredNo')}：${status?.providerError ?? t('status.seamNo')}`))
      }
      if (flash !== undefined) notices.push(h(Note, { key: 'flash', tone: flash.tone }, flash.text))

      const connection = h(
        Card,
        {
          key: 'conn',
          step: '1',
          title: t('conn.title'),
          desc: t('conn.desc'),
          actions: [
            h(Button, { key: 'test', variant: 'outline', disabled: busy !== undefined, onClick: onTest }, busy === 'test' ? t('conn.testing') : t('conn.test')),
            h(Button, { key: 'save', variant: 'primary', disabled: busy !== undefined, onClick: onSave }, busy === 'save' ? t('conn.saving') : t('conn.save')),
          ],
        },
        h(
          'div',
          { className: 'dsm-wb2api-row' },
          h(
            Field,
            { label: t('conn.baseUrl'), hint: t('conn.baseUrlHint') },
            h(Input, {
              className: 'dsm-wb2api-mono',
              spellCheck: false,
              autoComplete: 'off',
              value: draft.baseUrl,
              placeholder: 'http://127.0.0.1:7863/v1',
              onChange: (event) => setDraft({ ...draft, baseUrl: event.target.value }),
            }),
          ),
          h(
            Field,
            { label: t('conn.apiKey'), hint: t('conn.apiKeyHint') },
            h(
              'div',
              { className: 'dsm-wb2api-input-wrap' },
              h(Input, {
                className: 'dsm-wb2api-mono',
                type: showKey ? 'text' : 'password',
                spellCheck: false,
                autoComplete: 'off',
                value: draft.apiKey,
                placeholder: status?.apiKeySet === true ? '••••••••（已保存，留空表示不修改）' : '',
                onChange: (event) => setDraft({ ...draft, apiKey: event.target.value }),
              }),
              h(Button, { variant: 'ghost', onClick: () => setShowKey(!showKey) }, showKey ? t('conn.hide') : t('conn.show')),
            ),
          ),
        ),
        probe === undefined
          ? null
          : h(
              'p',
              { className: 'dsm-wb2api-hint' },
              fill(t('conn.probeAt'), { status: probe.status, latency: probe.latencyMs, count: probe.modelIds?.length ?? 0 }),
            ),
      )

      const runtime = h(
        Card,
        { key: 'status', step: '2', title: t('status.title'), desc: t('status.desc') },
        h(
          'div',
          { className: 'dsm-wb2api-stats' },
          h(Stat, { label: t('status.route'), value: status?.route ?? '–' }),
          h(Stat, {
            label: t('status.registered'),
            value: registered === true ? t('status.registeredYes') : t('status.registeredNo'),
            sub: registered === true ? status?.baseUrl : undefined,
          }),
          h(Stat, {
            label: t('status.models'),
            value: fill(t('status.modelsUnit'), { count: (status?.models ?? []).filter((model) => model.enabled !== false).length }),
          }),
          h(Stat, {
            label: t('status.seam'),
            value: seamReady === true ? t('status.seamYes') : t('status.seamNo'),
            sub: status?.configFile,
          }),
        ),
      )

      const models = status?.models ?? []
      // Two numbers answer the question this card exists for: how many ids the
      // gateway serves, and how many of them the picker actually offers.
      const enabledCount = models.filter((model) => model.enabled !== false).length
      const disabledCount = models.length - enabledCount
      const catalog = h(
        Card,
        {
          key: 'models',
          step: '3',
          title: t('models.title'),
          desc: t('models.desc'),
          actions: h(Button, { variant: 'outline', disabled: busy !== undefined, onClick: onRefreshModels }, busy === 'models' ? t('models.refreshing') : t('models.refresh')),
        },
        [
          h(
            'div',
            { key: 'counts', className: 'dsm-wb2api-stats' },
            h(Stat, {
              label: t('models.count'),
              value: fill(t('models.countUnit'), { count: models.length }),
              sub: t('models.countSub'),
            }),
            h(Stat, {
              label: t('models.enabled'),
              value: fill(t('models.countUnit'), { count: enabledCount }),
              sub: disabledCount === 0 ? t('models.enabledSub') : fill(t('models.disabledSub'), { count: disabledCount }),
            }),
          ),
          models.length === 0
            ? h('div', { key: 'list', className: 'dsm-wb2api-empty' }, t('models.empty'))
            : h(
              'div',
              { key: 'list', className: 'dsm-wb2api-models' },
              models.map((model) =>
                h(
                  'div',
                  { key: model.id, className: `dsm-wb2api-model${model.enabled === false ? ' dsm-wb2api-model-off' : ''}` },
                  h(
                    'div',
                    { className: 'dsm-wb2api-model-main' },
                    h('span', { className: 'dsm-wb2api-model-id' }, model.id),
                    h(
                      'span',
                      { className: 'dsm-wb2api-model-meta' },
                      `${fill(t('models.ctx'), { count: formatTokens(model.contextWindow) })} · ${model.vision === true ? t('models.vision') : t('models.noVision')}`,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dsm-wb2api-tags' },
                    model.reasoning === true ? h('span', { className: 'dsm-wb2api-tag dsm-wb2api-tag-on' }, t('models.reasoning')) : null,
                  ),
                  h(Switch, {
                    checked: model.enabled !== false,
                    disabled: busy !== undefined,
                    title: t('models.toggle'),
                    onChange: (next) => onToggleModel(model.id, next),
                  }),
                ),
              ),
            ),
        ],
      )

      const advanced = h(
        Card,
        {
          key: 'adv',
          step: '4',
          title: t('adv.title'),
          desc: t('adv.desc'),
          actions: h(Button, { variant: 'ghost', disabled: busy !== undefined, onClick: onReset }, t('adv.reset')),
        },
        h(
          'div',
          { className: 'dsm-wb2api-row' },
          h(
            Field,
            { label: t('adv.displayName') },
            h(Input, { value: draft.displayName, onChange: (event) => setDraft({ ...draft, displayName: event.target.value }) }),
          ),
          h(
            Field,
            { label: t('adv.route'), hint: t('adv.routeHint') },
            h(Input, {
              className: 'dsm-wb2api-mono',
              spellCheck: false,
              autoComplete: 'off',
              value: draft.route,
              onChange: (event) => setDraft({ ...draft, route: event.target.value }),
            }),
          ),
          h(
            Field,
            { label: t('adv.idle'), hint: t('adv.idleHint') },
            h(Input, {
              type: 'number',
              min: 1000,
              step: 1000,
              className: 'dsm-wb2api-mono',
              value: draft.streamIdleTimeoutMs,
              onChange: (event) => setDraft({ ...draft, streamIdleTimeoutMs: event.target.value }),
            }),
          ),
        ),
        h(
          'div',
          { className: 'dsm-wb2api-model' },
          h(
            'div',
            { className: 'dsm-wb2api-model-main' },
            h('span', { className: 'dsm-wb2api-model-id' }, t('adv.autoDiscover')),
            h('span', { className: 'dsm-wb2api-model-meta' }, t('adv.autoDiscoverHint')),
          ),
          h(Switch, {
            checked: status?.autoDiscoverModels !== false,
            disabled: busy !== undefined || status === undefined,
            title: t('adv.autoDiscover'),
            onChange: onToggleAutoDiscover,
          }),
        ),
      )

      const help = h(
        Card,
        { key: 'help', title: t('help.title') },
        h(
          'ol',
          { className: 'dsm-wb2api-steps' },
          h('li', { key: 'a' }, t('help.one')),
          h('li', { key: 'b' }, t('help.two')),
          h('li', { key: 'c' }, t('help.three')),
        ),
        status?.configFile === undefined ? null : h('p', { className: 'dsm-wb2api-foot' }, `${t('status.configFile')}: ${status.configFile}`),
      )

      return h('div', { className: 'dsm-wb2api-page' }, head, ...notices, connection, runtime, catalog, advanced, help)
    }

    //#endregion

    //#region nav icon

    /**
     * Draw this page's own glyph in its Settings nav row.
     *
     * The `settings.section` contract carries no icon — the shell picks one from
     * the section id and falls back to a gear. So the row is matched by its
     * label, marked, and the shell's svg is swapped for this artwork by mask.
     * Cosmetic only: a miss costs an icon and never the page.
     */
    function installNavIcon(ctx, resolveLabel) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-workbuddy2api-panel-bridge'
        tag.dataset.dshWb2apiCss = 'nav-icon'
        tag.textContent = [
          `[${NAV_ICON_MARKER}] > svg{display:none}`,
          `[${NAV_ICON_MARKER}]::before{`,
          "content:'';flex:none;width:16px;height:16px;background-color:currentColor;",
          `-webkit-mask-image:url("${NAV_ICON_URL}");mask-image:url("${NAV_ICON_URL}");`,
          '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
          '-webkit-mask-position:center;mask-position:center;',
          '-webkit-mask-size:16px 16px;mask-size:16px 16px;',
          '}',
        ].join('\n')
        document.head.appendChild(tag)

        let disposed = false
        let scheduled = false
        let missStreak = 0
        let warned = false

        const sync = () => {
          scheduled = false
          if (disposed) return
          const wanted = String(resolveLabel() ?? '').trim()
          if (wanted === '') return
          let matched = 0
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            if (String(row.textContent ?? '').trim() === wanted) {
              row.setAttribute(NAV_ICON_MARKER, '')
              matched += 1
            } else {
              row.removeAttribute(NAV_ICON_MARKER)
            }
          }
          if (matched > 0) {
            missStreak = 0
            warned = false
            return
          }
          if (document.querySelector(NAV_ROW_SELECTOR) === null) {
            missStreak = 0
            return
          }
          missStreak += 1
          if (missStreak < NAV_ICON_MISS_THRESHOLD || warned) return
          warned = true
          console.warn('[dsh-workbuddy2api-panel-bridge] the settings nav row could not be found, so the icon was not applied. Cosmetic only — the page still works. Please report this line.')
        }

        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }

        sync()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        return () => {
          disposed = true
          observer.disconnect()
          for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
          tag.remove()
        }
      }, 'dsh-workbuddy2api-panel-bridge: settings nav icon')
    }

    //#endregion

    //#region entry

    /** Register the copy and the bridge page under Settings. */
    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-workbuddy2api-panel-bridge: page copy')
        const t = ctx.locale.bind(LOCALE_NS)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: PAGE_ID,
              order: 452,
              label: () => t('row.navLabel'),
              inject: () => ({ t }),
            },
            BridgeCard,
          ),
        )
        installNavIcon(ctx, () => t('row.navLabel'))
      } catch (error) {
        console.error('[dsh-workbuddy2api-panel-bridge] the settings page failed to load (the model route is unaffected):', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    exports.BridgeCard = BridgeCard
    /** Exposed for offline rendering and design review; not used at runtime. */
    exports.PAGE_CSS = PAGE_CSS
    return module.exports

    //#endregion
  },
})
