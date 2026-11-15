// 浏览器侧（dsh-context-preflight v3）。
//   main                     → 「注入上下文」面板本体（主入口）
//   sidebar.panellist        → 侧边栏入口图标
//   conversation.composer.dock → 输入框上方的细条（次要入口）
// 数据来自宿主 /summary，前端只排版不重算；文案来自 locale/*.json 的 client 段。
;(function () {
  const BOOT_ENDPOINT = '/plugins/dsh-context-preflight/boot'
  const BOOT_ID = 'dsh-context-preflight'

  /** 启动上报：beacon 优先（页面正在卸载也不丢），否则 keepalive fetch。 */
  function reportBoot(payload) {
    const body = JSON.stringify({ id: BOOT_ID, loaderOk: true, ...payload })
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && typeof Blob !== 'undefined') {
        if (navigator.sendBeacon(BOOT_ENDPOINT, new Blob([body], { type: 'application/json' }))) return
      }
    } catch {
      /* 落到 fetch */
    }
    try {
      fetch(BOOT_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      }).catch((error) => {
        console.error('[context-preflight] boot 上报失败（不影响界面）', error)
      })
    } catch (error) {
      console.error('[context-preflight] boot 上报失败（不影响界面）', error)
    }
  }

  // 第一件事：报「脚本开始执行了」——在任何 loader 判断之前。
  const initialLoader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined
  reportBoot({ stage: 'entered', hasLoader: typeof initialLoader?.load === 'function' })

  let registered = false
  let attempts = 0
  let timer = null
  const listeners = []

  function cleanupWaiters() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    for (const [type, listener] of listeners) {
      if (type === 'load') window.removeEventListener('load', listener)
      else document.removeEventListener(type, listener)
    }
    listeners.length = 0
  }

  /** 拿到 loader 就注册，且只注册一次。 */
  function start(loader, source) {
    if (registered) return
    registered = true
    cleanupWaiters()
    reportBoot({ stage: 'loader-ready', hasLoader: true, hasReact: false, source })
    try {
      loader.load({
      id: BOOT_ID,
      factory(require) {
        reportBoot({ stage: 'factory-entered', hasLoader: true, hasReact: false })
        console.info('[context-preflight] client module loaded')
        try {
          return buildModule(require)
        } catch (error) {
          reportBoot({ stage: 'factory-failed', hasLoader: true, hasReact: false, error: String(error?.message ?? error) })
          console.error('[context-preflight] factory 抛错', error)
          throw error
        }
      },
      })
    } catch (error) {
      console.error('[context-preflight] loader.load 抛错', error)
      reportBoot({ stage: 'loader-failed', hasLoader: true, error: String(error?.message ?? error) })
    }
  }

  /** 模块主体：单独成函数，便于整体兜错。 */
  function buildModule(require) {
        let React
        try {
          reportBoot({ stage: 'react-require', hasLoader: true, hasReact: false })
          React = require('react')
          reportBoot({ stage: 'react-ok', hasLoader: true, hasReact: true })
        } catch (error) {
          reportBoot({ stage: 'react-failed', hasLoader: true, hasReact: false, error: String(error?.message ?? error) })
          console.error('[context-preflight] react 依赖不可用，客户端模块放弃注册', error)
          throw error
        }

    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    const NAMESPACE = 'context-preflight'
    const PANEL_KEY = 'context-preflight'
    const ENDPOINT = '/plugins/dsh-context-preflight/summary'
    const LOCALE_ENDPOINT = '/plugins/dsh-context-preflight/locale'
    const POLICY_ENDPOINT = '/plugins/dsh-context-preflight/policy'
    const REGISTRATIONS_ENDPOINT = '/plugins/dsh-context-preflight/registrations'
    const ACTION_ENDPOINT = '/plugins/dsh-context-preflight/action'
    const DASH = '\u2014'
    const DOT = '\u00b7'

    // 内置兜底文案：locale 路由拿不到时也立刻渲染，绝不静默空白。
    const FALLBACK = {
      panelLabel: '注入',
      panelTitle: '注入上下文',
      heroTitle: '本轮注入',
      close: '关闭',
      policyTitle: '默认策略',
      policySub: '每个新会话生效',
      policyFixed: '固定加载，不可关',
      policyContext: '运行时上下文',
      policyContextLabel: '随会话注入',
      modeAll: '全部',
      modeOnly: '仅这些',
      modeExcept: '排除',
      addSkill: '技能名后回车',
      addTool: '工具名或前缀（如 mcp__rea__）',
      removeAria: '移除 {name}',
      policyEstimate: '按此默认，新会话首轮注入 ≈ {tokens}（−{saved}，−{percent}%）',
      saveFailed: '策略未保存：{reason}',
      mgTitle: '管理',
      mgSub: '开关立即生效 · 只改名或只改一行，正文不动',
      mgOn: '已开',
      mgOff: '已关',
      mgLoaded: '加载中',
      mgDisabled: '已停用',
      kpiInstructions: '画像',
      kpiSkills: '技能',
      kpiTools: '工具',
      kpiPrompts: '提示词',
      subFiles: '{n} 文件',
      subSkills: '{model} 可见',
      subTools: '{n} 个',
      subSections: '{n} 段',
      donutTitle: '构成占比',
      barsTitle: '最大的 8 个工具 schema',
      mismatch: '分项之和 {sum} 与合计 {total} 不一致',
      estimate: '估算',
      loadingPanel: '正在读取注入构成…',
      retry: '重试',
      readFailed: '读取失败',
      sessionUsage: '本会话已占用 {tokens}（含对话历史，与上方注入量不可直接比较）',
      inject: '注入',
      blocksInstructions: '画像/规则',
      blocksSkills: '技能',
      blocksTools: '工具',
      blocksPrompts: '系统提示词',
      aria: '注入上下文',
      missing: '缺失',
      notLoaded: '{bytes} B 未加载',
      chars: '{n} 字',
      skillsFailed: '技能目录读取失败',
      reading: '读取中',
    }

    const localeState = { t: null }
    const localeListeners = new Set()

    function fallbackTranslate(key, params) {
      const template = FALLBACK[key]
      if (typeof template !== 'string') return key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      )
    }

    localeState.t = fallbackTranslate
    const currentT = () => localeState.t ?? fallbackTranslate

    // 浅色是规格给的精确值；深色换成等价中性灰（宿主会打 body[data-ds-dark-theme]）。
    const STYLE = `
.cpf-v3{--ink:#18181b;--ink2:#52525b;--ink3:#a1a1aa;--ink4:#e4e4e7;--line:#ececec;--line2:#f4f4f5;--bg:#fafafa;--card:#ffffff;--warn:#b45309;--muted:#71717a;box-sizing:border-box;width:100%;height:100%;overflow:auto;background:var(--bg);color:var(--ink);font-size:13px;line-height:20px;container-type:inline-size}
body[data-ds-dark-theme] .cpf-v3{--ink:#f4f4f5;--ink2:#a1a1aa;--ink3:#71717a;--ink4:#3f3f46;--line:#27272a;--line2:#1f1f22;--bg:#0f0f10;--card:#17171a;--warn:#d97706;--muted:#a1a1aa}
.cpf-shell{max-width:1120px;margin:0 auto;padding:calc(24px + var(--dsh-frame-top-clearance,0px)) 24px 24px}
.cpf-head{display:flex;align-items:center;gap:10px;min-height:56px;margin:-6px 0 16px}
.cpf-title{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.cpf-spacer{flex:1}
.cpf-close{width:28px;height:28px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink3);font:inherit;font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.cpf-close:hover{color:var(--ink);border-color:var(--ink4)}
.cpf-kpi{display:grid;grid-template-columns:240px repeat(4,minmax(0,1fr));gap:16px}
.cpf-hero-card{display:flex;flex-direction:column;justify-content:center}
.cpf-hero-card .cpf-big{font-size:34px;line-height:40px}
.cpf-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;min-width:0}
.cpf-card-title{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--muted)}
.cpf-policy{margin-top:16px}
.cpf-policy-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.cpf-policy-rows{margin-top:6px;display:flex;flex-direction:column}
.cpf-policy-row{display:flex;align-items:center;gap:12px;min-height:34px;border-top:1px solid var(--line2);flex-wrap:wrap}
.cpf-policy-row:first-child{border-top:0}
.cpf-policy-label{flex:none;width:96px;color:var(--ink);font-size:13px}
.cpf-policy-value{flex:none;width:64px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink2);font-size:12px}
.cpf-policy-ctl{flex:1;min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cpf-radio{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2);cursor:pointer}
.cpf-radio input{width:12px;height:12px;accent-color:var(--ink);margin:0}
.cpf-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 6px 0 8px;border-radius:6px;background:var(--line2);color:var(--ink2);font-size:13px;line-height:22px;max-width:220px}
.cpf-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpf-chip-x{border:0;background:transparent;color:var(--ink3);font:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0 2px}
.cpf-chip-x:hover{color:var(--ink)}
.cpf-input{height:24px;width:150px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);font:inherit;font-size:12px;padding:0 8px}
.cpf-input:focus-visible{outline:2px solid var(--ink3);outline-offset:1px}
.cpf-policy-foot{margin-top:10px;padding-top:10px;border-top:1px solid var(--line2);font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums}
.cpf-banner{margin-top:12px;border-left:2px solid var(--warn);padding-left:8px;color:var(--warn);font-size:12px;line-height:18px}
.cpf-mg-group{margin-top:10px}
.cpf-mg-head{font-size:12px;color:var(--muted);font-weight:500;letter-spacing:.02em;margin-bottom:4px}
.cpf-mg-list{max-height:220px;overflow:auto;border:1px solid var(--line2);border-radius:8px}
.cpf-mg-row{display:flex;align-items:center;gap:10px;height:30px;padding:0 10px;border-top:1px solid var(--line2)}
.cpf-mg-row:first-child{border-top:0}
.cpf-mg-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ink)}
.cpf-mg-detail{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ink3);font-variant-numeric:tabular-nums}
.cpf-mg-btn{flex:none;height:20px;padding:0 8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink3);font:inherit;font-size:12px;cursor:pointer}
.cpf-mg-btn:hover{color:var(--ink);border-color:var(--ink4)}
.cpf-mg-btn.is-on{color:var(--ink);border-color:var(--ink4);background:var(--line2)}
.cpf-mg-btn:disabled{opacity:.5;cursor:default}
.cpf-big{display:flex;align-items:baseline;margin-top:6px;font-size:30px;line-height:36px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink)}
.cpf-unit{font-size:.6em;font-weight:600;color:var(--ink3);margin-left:1px}
.cpf-sub{margin-top:2px;font-size:12px;color:var(--ink3)}
.cpf-charts{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;margin-top:16px}
.cpf-donut{display:flex;align-items:center;gap:20px;margin-top:12px;flex-wrap:wrap}
.cpf-donut-ring{position:relative;flex:none;width:120px;height:120px}
.cpf-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.cpf-donut-center .cpf-big{font-size:20px;line-height:24px;margin-top:0}
.cpf-donut-caption{margin-top:-2px;font-size:11px;line-height:14px;color:var(--ink3)}
.cpf-legend{flex:1;min-width:132px;display:flex;flex-direction:column;gap:6px}
.cpf-legend-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink2)}
.cpf-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.cpf-legend-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpf-legend-pct{flex:none;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
.cpf-bars{display:flex;flex-direction:column;margin-top:8px}
.cpf-bar-row{display:flex;align-items:center;gap:10px;height:30px;border-bottom:1px solid var(--line2)}
.cpf-bar-row:last-child{border-bottom:0}
.cpf-bar-name{max-width:55%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ink2)}
.cpf-bar-track{flex:1;min-width:24px;height:6px;border-radius:3px;background:var(--line2);overflow:hidden}
.cpf-bar-fill{height:100%;border-radius:3px;background:var(--ink)}
.cpf-bar-value{flex:none;width:72px;text-align:right;font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink2)}
.cpf-warn-card{margin-top:16px;display:flex;gap:10px;align-items:flex-start;border-left:2px solid var(--warn)}
.cpf-warn-text{color:var(--warn);font-size:13px;line-height:20px;min-width:0;word-break:break-word}
.cpf-foot{margin-top:16px;font-size:12px;color:var(--ink3)}
.cpf-state{margin-top:16px;padding:16px 0;color:var(--ink3);font-size:13px}
.cpf-retry{margin-left:8px;border:0;background:transparent;color:var(--warn);cursor:pointer;font:inherit;padding:0}
.cpf-skel{background:var(--card);border:1px solid var(--line);border-radius:12px;height:104px}
.cpf-skel-wide{height:168px;margin-top:16px}
@container (max-width: 1000px){.cpf-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}.cpf-hero-card{grid-column:1/-1}.cpf-charts{grid-template-columns:1fr}}
@container (max-width: 560px){.cpf-kpi{grid-template-columns:1fr}}
.cpf-strip-root{display:flex;align-items:center;justify-content:center;padding:4px 0;font-size:12px;line-height:20px;color:var(--ink2)}
.cpf-strip{display:inline-flex;align-items:center;gap:8px;height:20px;padding:0;border:0;background:transparent;box-shadow:none;cursor:pointer;user-select:none;font:inherit;color:var(--ink3)}
.cpf-strip:hover{color:var(--ink2)}
.cpf-strip:focus-visible{outline:2px solid var(--ink2);outline-offset:2px;border-radius:4px}
.cpf-sep{color:var(--ink3);opacity:.55}
.cpf-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transition:transform .12s ease}
.cpf-caret.cpf-open{transform:rotate(180deg)}
.cpf-pop{margin-top:6px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-height:min(60vh,480px);overflow:auto;text-align:left;width:100%;box-sizing:border-box}
.cpf-pop-row{display:flex;justify-content:space-between;gap:12px;font-size:12px;line-height:26px;color:var(--ink3)}
.cpf-pop-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpf-pop-val{flex:none;font-variant-numeric:tabular-nums}
`

    function splitValue(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return { number: DASH, unit: '' }
      if (value >= 10000) {
        const scaled = value / 1000
        return { number: scaled.toFixed(1), unit: 'k' }
      }
      return { number: String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), unit: '' }
    }

    function formatTokens(value) {
      const { number, unit } = splitValue(value)
      return `${number}${unit}`
    }

    function formatChars(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function tr(t, key, params, fallback) {
      const value = t(key, params)
      if (typeof value !== 'string' || value === key) return fallback ?? key
      return value
    }

    function blockKey(id) {
      const suffix = String(id).charAt(0).toUpperCase() + String(id).slice(1)
      return `blocks${suffix}`
    }

    function sessionIdOf(props) {
      if (typeof props?.sessionId === 'string') return props.sessionId
      if (props?.session && typeof props.session.id === 'string') return props.session.id
      if (props?.conversation && typeof props.conversation.sessionId === 'string') return props.conversation.sessionId
      return undefined
    }

    async function loadJson(url, signal) {
      let response
      try {
        response = await fetch(url, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        console.error('[context-preflight] fetch 失败', url, error)
        throw error
      }
      if (!response.ok) {
        console.error('[context-preflight] fetch 失败', url, `HTTP ${response.status}`)
        throw new Error(`HTTP ${response.status}`)
      }
      return response.json()
    }

    async function savePolicy(policy, signal) {
      let response
      try {
        response = await fetch(POLICY_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(policy),
          signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        console.error('[context-preflight] 策略写入失败', POLICY_ENDPOINT, error)
        throw error
      }
      if (!response.ok) {
        console.error('[context-preflight] 策略写入失败', POLICY_ENDPOINT, `HTTP ${response.status}`)
        throw new Error(`HTTP ${response.status}`)
      }
      return response.json()
    }

    function notifyLocale() {
      for (const listener of localeListeners) listener()
    }

    function useTranslate() {
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        const listener = () => setRevision((value) => value + 1)
        localeListeners.add(listener)
        return () => localeListeners.delete(listener)
      }, [])
      void revision
      return currentT()
    }

    function useSummary(props) {
      const sessionId = sessionIdOf(props)
      const [data, setData] = useState(null)
      const [failed, setFailed] = useState(false)
      const [nonce, setNonce] = useState(0)

      useEffect(() => {
        const controller = new AbortController()
        const url = sessionId ? `${ENDPOINT}?session=${encodeURIComponent(sessionId)}` : ENDPOINT
        loadJson(url, controller.signal)
          .then((next) => {
            setData(next)
            setFailed(false)
          })
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setFailed(true)
          })
        return () => controller.abort()
      }, [sessionId, nonce])

      const reload = useCallback(() => setNonce((value) => value + 1), [])
      const state = data !== null ? 'ready' : failed ? 'error' : 'loading'
      return { state, data, reload }
    }

    // ---------------------------------------------------------------- 默认策略（客户端状态）

    function usePolicy() {
      const [draft, setDraft] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState('idle')
      const [error, setError] = useState(null)

      useEffect(() => {
        const controller = new AbortController()
        loadJson(POLICY_ENDPOINT, controller.signal)
          .then((payload) => {
            setDraft(payload.policy)
            setDirty(false)
            setStatus('ready')
            if (payload.error) setError(String(payload.error))
          })
          .catch((failure) => {
            if (failure?.name === 'AbortError') return
            setStatus('error')
            setError(String(failure?.message ?? failure))
          })
        return () => controller.abort()
      }, [])

      // 改完立刻重算，落盘防抖 500ms。
      useEffect(() => {
        if (!dirty || draft === null) return undefined
        const timer = setTimeout(() => {
          setStatus('saving')
          savePolicy(draft)
            .then(() => {
              setDirty(false)
              setStatus('ready')
              setError(null)
            })
            .catch((failure) => {
              setStatus('error')
              setError(String(failure?.message ?? failure))
            })
        }, 500)
        return () => clearTimeout(timer)
      }, [draft, dirty])

      const update = useCallback((next) => {
        setDraft(next)
        setDirty(true)
      }, [])

      return { draft, update, status, error }
    }

    function toolMatcher(entries) {
      const exact = new Set()
      const prefixes = []
      for (const raw of entries ?? []) {
        const entry = String(raw ?? '').trim()
        if (entry === '') continue
        if (entry === '*') prefixes.push('')
        else if (entry.endsWith('*')) prefixes.push(entry.slice(0, -1))
        else if (entry.endsWith('_')) prefixes.push(entry)
        else exact.add(entry)
      }
      return (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix))
    }

    /** 与宿主 previewPolicy 同一口径：拿掉的部分从当前合计里减。 */
    function previewFrom(policy, data) {
      const total = data?.totals?.tokens ?? 0
      const toolRows = data?.tools?.rows ?? []
      const skillRows = data?.skills?.rows ?? []
      const matcher = toolMatcher(policy?.tools?.names)
      const exactSkills = new Set((policy?.skills?.names ?? []).map(String))
      const excludedTools =
        policy?.tools?.mode === 'all' || policy?.tools?.mode === undefined
          ? []
          : toolRows.filter((row) => (policy.tools.mode === 'only' ? !matcher(row.name) : matcher(row.name)))
      const excludedSkills =
        policy?.skills?.mode === 'all' || policy?.skills?.mode === undefined
          ? []
          : skillRows.filter((row) => (policy.skills.mode === 'only' ? !exactSkills.has(row.name) : exactSkills.has(row.name)))
      const savedTools = excludedTools.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
      const savedSkills = excludedSkills.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
      const savedContexts = policy?.runtimeContext?.enabled === false ? (data?.prompts?.contextTokens ?? 0) : 0
      const saved = savedTools + savedSkills + savedContexts
      return {
        tokens: Math.max(0, total - saved),
        saved,
        percent: total > 0 ? Math.round((saved / total) * 1000) / 10 : 0,
        excludedTools: excludedTools.length,
        excludedSkills: excludedSkills.length,
      }
    }

    // ---------------------------------------------------------------- 原子块

    function BigNumber({ value }) {
      const { number, unit } = splitValue(value)
      return h(
        'div',
        { className: 'cpf-big' },
        number,
        unit ? h('span', { className: 'cpf-unit' }, unit) : null,
      )
    }

    function KpiCard({ title, tokens, sub }) {
      return h(
        'div',
        { className: 'cpf-card' },
        h('div', { className: 'cpf-card-title' }, title),
        h(BigNumber, { value: tokens }),
        h('div', { className: 'cpf-sub' }, sub),
      )
    }

    // 手写环形图：viewBox 120，半径 48，线宽 14，段间 2px 间隙。
    const RING_RADIUS = 48
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
    const RING_GAP = 2
    const RING_COLORS = ['#18181b', '#52525b', '#a1a1aa', '#e4e4e7']

    function Donut({ segments, total, t }) {
      let offset = 0
      const arcs = segments.map((segment, index) => {
        const fraction = total > 0 ? segment.tokens / total : 0
        const raw = fraction * RING_CIRCUMFERENCE
        const length = Math.max(0, raw - (segments.length > 1 ? RING_GAP : 0))
        const arc = h('circle', {
          key: segment.id,
          cx: 60,
          cy: 60,
          r: RING_RADIUS,
          fill: 'none',
          stroke: RING_COLORS[index % RING_COLORS.length],
          strokeWidth: 14,
          strokeLinecap: 'butt',
          strokeDasharray: `${length} ${RING_CIRCUMFERENCE - length}`,
          strokeDashoffset: -offset,
          transform: 'rotate(-90 60 60)',
        })
        offset += raw
        return arc
      })

      const legend = segments.map((segment, index) =>
        h(
          'div',
          { key: segment.id, className: 'cpf-legend-row' },
          h('span', {
            className: 'cpf-swatch',
            style: { background: RING_COLORS[index % RING_COLORS.length] },
          }),
          h('span', { className: 'cpf-legend-name' }, segment.label),
          h(
            'span',
            { className: 'cpf-legend-pct' },
            total > 0 ? `${((segment.tokens / total) * 100).toFixed(1)}%` : DASH,
          ),
        ),
      )

      return h(
        'div',
        { className: 'cpf-donut' },
        h(
          'div',
          { className: 'cpf-donut-ring' },
          h(
            'svg',
            { width: 120, height: 120, viewBox: '0 0 120 120', role: 'img', 'aria-label': tr(t, 'donutTitle') },
            h('circle', { cx: 60, cy: 60, r: RING_RADIUS, fill: 'none', stroke: '#f4f4f5', strokeWidth: 14 }),
            ...arcs,
          ),
          h(
            'div',
            { className: 'cpf-donut-center' },
            h(BigNumber, { value: total }),
            h('div', { className: 'cpf-donut-caption' }, tr(t, 'estimate')),
          ),
        ),
        h('div', { className: 'cpf-legend' }, ...legend),
      )
    }

    function Bars({ tools, t }) {
      const rows = tools?.largest ?? []
      const max = rows.reduce((value, row) => Math.max(value, row.chars ?? 0), 0)
      return h(
        'div',
        { className: 'cpf-bars' },
        ...rows.map((row) =>
          h(
            'div',
            { className: 'cpf-bar-row', key: row.name },
            h('span', { className: 'cpf-bar-name', title: row.name }, row.name),
            h(
              'span',
              { className: 'cpf-bar-track' },
              h('span', {
                className: 'cpf-bar-fill',
                style: { width: `${max > 0 ? Math.max(2, ((row.chars ?? 0) / max) * 100) : 0}%` },
              }),
            ),
            h('span', { className: 'cpf-bar-value' }, formatChars(row.chars)),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- 默认策略卡片

    function Radio({ name, checked, label, onSelect }) {
      return h(
        'label',
        { className: 'cpf-radio' },
        h('input', { type: 'radio', name, checked, onChange: onSelect }),
        h('span', null, label),
      )
    }

    function NameAdder({ placeholder, onAdd, t }) {
      const [text, setText] = useState('')
      const commit = () => {
        const value = text.trim()
        if (value.length === 0) return
        onAdd(value)
        setText('')
      }
      return h('input', {
        className: 'cpf-input',
        type: 'text',
        value: text,
        placeholder,
        'aria-label': placeholder,
        onChange: (event) => setText(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        },
        onBlur: commit,
      })
    }

    function ToolChips({ policy, onChange, t }) {
      const names = policy.tools.names ?? []
      return h(
        React.Fragment,
        null,
        ...names.map((name) =>
          h(
            'span',
            { className: 'cpf-chip', key: name },
            h('span', { className: 'cpf-chip-name' }, name),
            h(
              'button',
              {
                type: 'button',
                className: 'cpf-chip-x',
                'aria-label': tr(t, 'removeAria', { name }),
                title: tr(t, 'removeAria', { name }),
                onClick: () => onChange({ ...policy, tools: { ...policy.tools, names: names.filter((row) => row !== name) } }),
              },
              '\u00d7',
            ),
          ),
        ),
        h(NameAdder, {
          t,
          placeholder: tr(t, 'addTool'),
          onAdd: (value) => onChange({ ...policy, tools: { ...policy.tools, names: [...names, value] } }),
        }),
      )
    }

    function SkillChips({ policy, onChange, t }) {
      const names = policy.skills.names ?? []
      return h(
        React.Fragment,
        null,
        ...names.map((name) =>
          h(
            'span',
            { className: 'cpf-chip', key: name },
            h('span', { className: 'cpf-chip-name' }, name),
            h(
              'button',
              {
                type: 'button',
                className: 'cpf-chip-x',
                'aria-label': tr(t, 'removeAria', { name }),
                title: tr(t, 'removeAria', { name }),
                onClick: () =>
                  onChange({ ...policy, skills: { ...policy.skills, names: names.filter((row) => row !== name) } }),
              },
              '\u00d7',
            ),
          ),
        ),
        h(NameAdder, {
          t,
          placeholder: tr(t, 'addSkill'),
          onAdd: (value) => onChange({ ...policy, skills: { ...policy.skills, names: [...names, value] } }),
        }),
      )
    }

    function setMode(policy, section, mode) {
      return { ...policy, [section]: { ...policy[section], mode } }
    }

    async function postAction(body) {
      const response = await fetch(ACTION_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    /** 管理卡：技能与画像文件各自的开关（每个动作执行后回读真实状态）。 */
    function ManagementCard({ data, t, onAction, busy, error }) {
      const management = data?.management
      if (management === undefined || management.error !== undefined) return null
      const skills = management.skills ?? []
      const rules = management.rules ?? []

      function row(key, label, detail, active, onToggle) {
        return h(
          'div',
          { className: 'cpf-mg-row', key },
          h('span', { className: 'cpf-mg-name', title: label }, label),
          h('span', { className: 'cpf-mg-detail' }, detail),
          h(
            'button',
            {
              type: 'button',
              className: active ? 'cpf-mg-btn is-on' : 'cpf-mg-btn',
              disabled: busy,
              onClick: onToggle,
            },
            active ? tr(t, 'mgOn') : tr(t, 'mgOff'),
          ),
        )
      }

      return h(
        'section',
        { className: 'cpf-card cpf-policy' },
        h(
          'div',
          { className: 'cpf-policy-head' },
          h('div', { className: 'cpf-card-title' }, tr(t, 'mgTitle')),
          h('div', { className: 'cpf-sub' }, tr(t, 'mgSub')),
        ),
        error ? h('div', { className: 'cpf-banner' }, error) : null,
        h(
          'div',
          { className: 'cpf-mg-group' },
          h('div', { className: 'cpf-mg-head' }, `${tr(t, 'kpiSkills')} ${skills.length}`),
          h(
            'div',
            { className: 'cpf-mg-list' },
            ...skills.map((skill) =>
              row(
                `s-${skill.path}`,
                skill.name,
                `${skill.descriptionLength} 字 · ${skill.hasKey ? skill.keyValue : '无键'}`,
                !skill.disabled,
                () => onAction('skill', skill.dir, skill.disabled ? 'on' : 'off'),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'cpf-mg-group' },
          h('div', { className: 'cpf-mg-head' }, `${tr(t, 'kpiInstructions')} ${rules.length}`),
          h(
            'div',
            { className: 'cpf-mg-list' },
            ...rules.map((rule, index) =>
              row(
                `r-${rule.path}`,
                rule.path.split('\\').pop(),
                rule.state === 'active' ? tr(t, 'mgLoaded') : tr(t, 'mgDisabled'),
                rule.state === 'active',
                () => onAction('rule', String(index + 1), rule.state === 'active' ? 'off' : 'on'),
              ),
            ),
          ),
        ),
      )
    }

    function PolicyCard({ policy, onChange, t, data }) {      if (policy === null) return null
      const preview = previewFrom(policy, data)
      const instructions = data?.blocks?.find((block) => block.id === 'instructions')

      return h(
        'section',
        { className: 'cpf-card cpf-policy' },
        h(
          'div',
          { className: 'cpf-policy-head' },
          h('div', { className: 'cpf-card-title' }, tr(t, 'policyTitle')),
          h('div', { className: 'cpf-sub' }, tr(t, 'policySub')),
        ),
        h(
          'div',
          { className: 'cpf-policy-rows' },
          h(
            'div',
            { className: 'cpf-policy-row' },
            h('span', { className: 'cpf-policy-label' }, tr(t, 'kpiInstructions')),
            h('span', { className: 'cpf-policy-value' }, formatTokens(instructions?.tokens)),
            h('div', { className: 'cpf-policy-ctl' }, h('span', { className: 'cpf-sub' }, tr(t, 'policyFixed'))),
          ),
          h(
            'div',
            { className: 'cpf-policy-row' },
            h('span', { className: 'cpf-policy-label' }, tr(t, 'kpiSkills')),
            h('span', { className: 'cpf-policy-value' }, formatTokens(data?.skills?.tokens)),
            h(
              'div',
              { className: 'cpf-policy-ctl' },
              h(Radio, { name: 'cpf-skills', checked: policy.skills.mode === 'all', label: tr(t, 'modeAll'), onSelect: () => onChange(setMode(policy, 'skills', 'all')) }),
              h(Radio, { name: 'cpf-skills', checked: policy.skills.mode === 'only', label: tr(t, 'modeOnly'), onSelect: () => onChange(setMode(policy, 'skills', 'only')) }),
              h(Radio, { name: 'cpf-skills', checked: policy.skills.mode === 'except', label: tr(t, 'modeExcept'), onSelect: () => onChange(setMode(policy, 'skills', 'except')) }),
              policy.skills.mode === 'all' ? null : h(SkillChips, { policy, onChange, t }),
            ),
          ),
          h(
            'div',
            { className: 'cpf-policy-row' },
            h('span', { className: 'cpf-policy-label' }, tr(t, 'kpiTools')),
            h('span', { className: 'cpf-policy-value' }, formatTokens(data?.tools?.tokens)),
            h(
              'div',
              { className: 'cpf-policy-ctl' },
              h(Radio, { name: 'cpf-tools', checked: policy.tools.mode === 'all', label: tr(t, 'modeAll'), onSelect: () => onChange(setMode(policy, 'tools', 'all')) }),
              h(Radio, { name: 'cpf-tools', checked: policy.tools.mode === 'only', label: tr(t, 'modeOnly'), onSelect: () => onChange(setMode(policy, 'tools', 'only')) }),
              h(Radio, { name: 'cpf-tools', checked: policy.tools.mode === 'except', label: tr(t, 'modeExcept'), onSelect: () => onChange(setMode(policy, 'tools', 'except')) }),
              policy.tools.mode === 'all' ? null : h(ToolChips, { policy, onChange, t }),
            ),
          ),
          h(
            'div',
            { className: 'cpf-policy-row' },
            h('span', { className: 'cpf-policy-label' }, tr(t, 'policyContext')),
            h('span', { className: 'cpf-policy-value' }, formatTokens(data?.prompts?.contextTokens)),
            h(
              'div',
              { className: 'cpf-policy-ctl' },
              h(
                'label',
                { className: 'cpf-radio' },
                h('input', {
                  type: 'checkbox',
                  role: 'switch',
                  'aria-checked': policy.runtimeContext.enabled !== false,
                  checked: policy.runtimeContext.enabled !== false,
                  onChange: (event) =>
                    onChange({ ...policy, runtimeContext: { enabled: event.target.checked } }),
                }),
                h('span', null, tr(t, 'policyContextLabel')),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'cpf-policy-foot' },
          tr(t, 'policyEstimate', {
            tokens: formatTokens(preview.tokens),
            saved: formatTokens(preview.saved),
            percent: preview.percent,
          }),
        ),
      )
    }

    function PanelBody({ state, data, t, reload, policy, onPolicyChange, onAction, actionBusy, actionError }) {
      if (state === 'loading') {
        return h(
          React.Fragment,
          null,
          h('div', { className: 'cpf-kpi' }, ...[0, 1, 2, 3, 4].map((index) => h('div', { key: index, className: 'cpf-skel' }))),
          h('div', { className: 'cpf-skel cpf-skel-wide' }),
          h('div', { className: 'cpf-foot' }, tr(t, 'loadingPanel')),
        )
      }
      if (state === 'error') {
        return h(
          'div',
          { className: 'cpf-state' },
          tr(t, 'readFailed'),
          h('button', { type: 'button', className: 'cpf-retry', onClick: reload }, tr(t, 'retry')),
        )
      }

      const blocks = Array.isArray(data.blocks) ? data.blocks : []
      const total = data.totals?.tokens
      const byId = new Map(blocks.map((block) => [block.id, block]))
      const blockSum = blocks.reduce((sum, block) => sum + (block.tokens ?? 0), 0)
      const mismatch = typeof total === 'number' && blockSum > 0 && Math.abs(blockSum - total) > 2

      const kpi = [
        {
          id: 'instructions',
          title: tr(t, 'kpiInstructions'),
          block: byId.get('instructions'),
          sub: tr(t, 'subFiles', { n: data.instructions?.loadedCount ?? DASH }),
        },
        {
          id: 'skills',
          title: tr(t, 'kpiSkills'),
          block: byId.get('skills'),
          sub: tr(t, 'subSkills', { model: data.skills?.modelVisible ?? DASH }),
        },
        {
          id: 'tools',
          title: tr(t, 'kpiTools'),
          block: byId.get('tools'),
          sub: tr(t, 'subTools', { n: data.tools?.count ?? DASH }),
        },
        {
          id: 'prompts',
          title: tr(t, 'kpiPrompts'),
          block: byId.get('prompts'),
          sub: tr(t, 'subSections', { n: data.prompts?.sectionCount ?? DASH }),
        },
      ]

      const segments = [...kpi]
        .filter((entry) => (entry.block?.tokens ?? 0) > 0)
        .sort((a, b) => (b.block?.tokens ?? 0) - (a.block?.tokens ?? 0))
        .map((entry) => ({
          id: entry.id,
          label: entry.title,
          tokens: entry.block?.tokens ?? 0,
        }))

      const warnings = data.instructions?.warnings ?? []

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'cpf-kpi' },
          h(
            'div',
            { className: 'cpf-card cpf-hero-card' },
            h('div', { className: 'cpf-card-title' }, tr(t, 'heroTitle')),
            h(BigNumber, { value: total }),
            h('div', { className: 'cpf-sub' }, tr(t, 'estimate')),
          ),
          ...kpi.map((entry) =>
            h(KpiCard, {
              key: entry.id,
              title: entry.title,
              tokens: entry.block?.tokens,
              sub: entry.sub,
            }),
          ),
        ),
        h(
          'div',
          { className: 'cpf-charts' },
          h(
            'section',
            { className: 'cpf-card' },
            h('div', { className: 'cpf-card-title' }, tr(t, 'donutTitle')),
            h(Donut, { segments, total: total ?? 0, t }),
          ),
          h(
            'section',
            { className: 'cpf-card' },
            h('div', { className: 'cpf-card-title' }, tr(t, 'barsTitle')),
            h(Bars, { tools: data.tools, t }),
          ),
        ),
        mismatch
          ? h(
              'div',
              { className: 'cpf-card cpf-warn-card' },
              h(
                'div',
                { className: 'cpf-warn-text' },
                tr(t, 'mismatch', { sum: formatChars(blockSum), total: formatChars(total) }),
              ),
            )
          : null,
        h(PolicyCard, { policy, onChange: onPolicyChange, t, data }),
        h(ManagementCard, { data, t, onAction, busy: actionBusy, error: actionError }),
        ...warnings.map((warning) =>
          h(
            'div',
            { className: 'cpf-card cpf-warn-card', key: warning.path },
            h(
              'div',
              { className: 'cpf-warn-text' },
              `${warning.path} ${tr(t, 'notLoaded', { bytes: formatChars(warning.bytes) })}`,
            ),
          ),
        ),
        h(
          'div',
          { className: 'cpf-foot' },
          tr(t, 'sessionUsage', {
            tokens: data.totals?.anchor ? formatTokens(data.totals.anchor.tokens) : DASH,
          }),
        ),
      )
    }

    function InjectedPanel(props) {
      const t = useTranslate()
      const { state, data, reload } = useSummary(props)
      const policyState = usePolicy()
      const [actionBusy, setActionBusy] = useState(false)
      const [actionError, setActionError] = useState(null)

      // 执行管理动作后立刻回读（不做乐观更新）。
      const runAction = useCallback(
        async (kind, id, op) => {
          setActionBusy(true)
          setActionError(null)
          try {
            const result = await postAction({ kind, id, op })
            console.info('[context-preflight] action done', kind, id, op, '| undo:', result?.undo)
            reload()
          } catch (error) {
            setActionError(String(error?.message ?? error))
          } finally {
            setActionBusy(false)
          }
        },
        [reload],
      )

      const close = useCallback(() => {
        const layout = layoutCtx?.get?.('layout') ?? layoutCtx?.layout
        try {
          layout?.selectPanel?.(null)
        } catch (error) {
          console.error('[context-preflight] 关闭面板失败', error)
        }
      }, [])

      return h(
        'div',
        { className: 'cpf-v3' },
        h('style', null, STYLE),
        h(
          'div',
          { className: 'cpf-shell' },
          h(
            'div',
            { className: 'cpf-head' },
            h('span', { className: 'cpf-title' }, tr(t, 'panelTitle')),
            h('span', { className: 'cpf-spacer' }),
            h(
              'button',
              { type: 'button', className: 'cpf-close', onClick: close, 'aria-label': tr(t, 'close'), title: tr(t, 'close') },
              '\u00d7',
            ),
          ),
          policyState.status === 'error'
            ? h(
                'div',
                { className: 'cpf-banner' },
                tr(t, 'saveFailed', { reason: policyState.error ?? '?' }),
              )
            : null,
          h(PanelBody, {
            state,
            data,
            t,
            reload,
            policy: policyState.draft,
            onPolicyChange: policyState.update,
            onAction: runAction,
            actionBusy,
            actionError,
          }),
        ),
      )
    }

    // ---------------------------------------------------------------- 侧边栏入口图标

    function PanelIcon({ size = 20 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 36 36',
          fill: 'none',
          'aria-hidden': 'true',
          xmlns: 'http://www.w3.org/2000/svg',
          style: { display: 'block' },
        },
        h('rect', {
          x: 6.8,
          y: 8.4,
          width: 22.4,
          height: 19.2,
          rx: 2.6,
          stroke: 'currentColor',
          strokeWidth: 1.8,
        }),
        h('path', {
          d: 'M11.6 14.6h12.8M11.6 19h12.8M11.6 23.4h8.2',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      )
    }

    // ---------------------------------------------------------------- 细条（次要入口）

    function PreflightStrip(props) {
      const t = useTranslate()
      const { state, data, reload } = useSummary(props)
      const [open, setOpen] = useState(false)

      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [open])

      const summary = useMemo(() => {
        const blocks = Array.isArray(data?.blocks) ? data.blocks : []
        const parts = []
        blocks.forEach((block, index) => {
          if (index > 0) parts.push(h('span', { key: `s${index}`, className: 'cpf-sep' }, DOT))
          const label = tr(t, blockKey(block.id), undefined, block.title)
          parts.push(h('span', { key: `b${index}`, className: 'cpf-num' }, `${label} ${formatTokens(block.tokens)}`))
        })
        return [
          h('span', { key: 'label' }, tr(t, 'inject')),
          h('span', { key: 'v', className: 'cpf-strong' }, data === null ? DASH : formatTokens(data.totals?.tokens)),
          h('span', { key: 'gap', className: 'cpf-sep' }, ' '),
          ...parts,
        ]
      }, [data, t])

      const onToggle = useCallback(() => setOpen((value) => !value), [])

      return h(
        'div',
        { className: 'cpf-v3 cpf-strip-root' },
        h('style', null, STYLE),
        h(
          'button',
          {
            type: 'button',
            className: 'cpf-strip',
            'aria-expanded': open,
            'aria-label': tr(t, 'aria'),
            onClick: onToggle,
          },
          ...summary,
          h('span', { className: open ? 'cpf-caret cpf-open' : 'cpf-caret' }),
        ),
        open
          ? h(
              'div',
              { className: 'cpf-pop' },
              state === 'error'
                ? h(
                    'div',
                    { className: 'cpf-pop-row' },
                    tr(t, 'readFailed'),
                    h('button', { type: 'button', className: 'cpf-retry', onClick: reload }, tr(t, 'retry')),
                  )
                : h(
                    React.Fragment,
                    null,
                    ...(data?.blocks ?? []).map((block) =>
                      h(
                        'div',
                        { className: 'cpf-pop-row', key: block.id },
                        h('span', { className: 'cpf-pop-name' }, tr(t, blockKey(block.id), undefined, block.title)),
                        h('span', { className: 'cpf-pop-val' }, formatTokens(block.tokens)),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'cpf-pop-row', key: 'session' },
                      h('span', { className: 'cpf-pop-name' }, tr(t, 'sessionUsage', {
                        tokens: data?.totals?.anchor ? formatTokens(data.totals.anchor.tokens) : DASH,
                      })),
                      h('span', { className: 'cpf-pop-val' }, ''),
                    ),
                  ),
            )
          : null,
      )
    }

    // ---------------------------------------------------------------- 注册

    let layoutCtx = null
    let applyStarted = false

    function registerClient(ctx) {
      layoutCtx = ctx
      reportBoot({ stage: 'apply-entered', hasLoader: true, hasReact: true })

      // 1) 槽位注册先做、同步做完、立刻上报——不依赖 locale，也不等任何异步。
      const results = { sidebarPanellist: 'pending', main: 'pending', composerDock: 'pending' }
      const failures = []

      function attempt(slot, key, run, optional) {
        try {
          run()
          results[key] = 'ok'
          console.info(`[context-preflight] registered slot: ${slot}`)
        } catch (error) {
          const message = String(error?.message ?? error)
          if (optional) {
            results[key] = 'skipped'
            console.info(`[context-preflight] optional slot unavailable, skipped: ${slot}`, message)
          } else {
            results[key] = 'failed'
            failures.push({ slot, message })
            console.error(`[context-preflight] register failed: ${slot}`, error)
          }
        }
      }

      attempt('sidebar.panellist', 'sidebarPanellist', () =>
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_KEY,
              order: 6,
              label: () => {
                const t = currentT()
                const value = t('panelLabel')
                return typeof value === 'string' && value !== 'panelLabel' ? value : '注入'
              },
            },
            PanelIcon,
          ),
        ),
      )

      attempt('main', 'main', () =>
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_KEY }, InjectedPanel)),
      )

      // 细条是可选入口：槽位没被声明就跳过（记 info，不报错）。
      attempt(
        'conversation.composer.dock',
        'composerDock',
        () =>
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'context-preflight', order: 6 },
              PreflightStrip,
            ),
          ),
        true,
      )

      reportBoot({ stage: 'slots-registered', hasLoader: true, hasReact: true, slots: results })
      reportRegistrations(results, failures)

      // 2) locale 是旁路：注册完之后才去取字典，失败就继续用内置文案。
      try {
        ctx.effect(() => {
          const controller = new AbortController()
          let disposeDictionary = null
          let cancelled = false
          loadJson(LOCALE_ENDPOINT, controller.signal)
            .then((dictionary) => {
              if (cancelled) return
              const dispose = ctx.locale.register(NAMESPACE, {
                zh: dictionary?.zh ?? {},
                en: dictionary?.en ?? {},
              })
              disposeDictionary = typeof dispose === 'function' ? dispose : null
              localeState.t = ctx.locale.bind(NAMESPACE)
              notifyLocale()
            })
            .catch((error) => {
              if (error?.name !== 'AbortError') {
                console.error('[context-preflight] locale 字典加载失败，继续用内置兜底文案', LOCALE_ENDPOINT, error)
              }
            })
          return () => {
            cancelled = true
            controller.abort()
            if (typeof disposeDictionary === 'function') disposeDictionary()
            localeState.t = fallbackTranslate
          }
        }, 'context-preflight.client-locale')
        reportBoot({ stage: 'locale-effect-ok', hasLoader: true, hasReact: true })
      } catch (error) {
        reportBoot({ stage: 'locale-effect-failed', hasLoader: true, hasReact: true, error: String(error?.message ?? error) })
        console.error('[context-preflight] locale effect 注册失败（不影响面板与注册结果）', error)
      }

      // 语言切换的实时联动：locale 服务的 subscribe 不是稳定公开 API（实测会抛
      // "Cannot read properties of undefined (reading 'listeners')"），所以不再挂它。
      // 文案仍会在下次数据刷新时跟随当前语言；registry 的 t 本身是按语言解析的。
    }

    /** 把三条注册结果报回宿主，/diag 里能一条 curl 看到断在哪一步。 */
    function reportRegistrations(slots, errors) {
      try {
        fetch(REGISTRATIONS_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            moduleId: 'dsh-context-preflight',
            loadedAt: Date.now(),
            slots,
            errors,
          }),
        }).catch((error) => {
          console.error('[context-preflight] 注册结果上报失败（不影响界面）', REGISTRATIONS_ENDPOINT, error)
        })
      } catch (error) {
        console.error('[context-preflight] 注册结果上报失败（不影响界面）', error)
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // count:45 说明 apply 会被反复进入；重复注册会让 slot 抛「已注册」并拖垮整轮。
        if (applyStarted) {
          reportBoot({ stage: 'apply-skipped', hasLoader: true, hasReact: true })
          console.info('[context-preflight] apply 重复进入，跳过')
          return
        }
        applyStarted = true
        try {
          registerClient(ctx)
        } catch (error) {
          reportBoot({ stage: 'apply-failed', hasLoader: true, hasReact: true, error: String(error?.message ?? error) })
          console.error('[context-preflight] 客户端注册失败', error)
          throw error
        }
      },
    }
  }

  // 已经就绪就立刻注册；否则等 DOMContentLoaded / load / 轮询（最多约 10 秒）。
  if (typeof initialLoader?.load === 'function') {
    start(initialLoader, 'immediate')
  } else {
    reportBoot({ stage: 'loader-missing', hasLoader: false })
    const attempt = (source) => {
      const loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined
      if (typeof loader?.load === 'function') start(loader, source)
    }
    if (typeof document !== 'undefined') {
      const onReady = () => attempt('DOMContentLoaded')
      const onLoad = () => attempt('load')
      document.addEventListener('DOMContentLoaded', onReady)
      window.addEventListener('load', onLoad)
      listeners.push(['DOMContentLoaded', onReady], ['load', onLoad])
    }
    timer = setInterval(() => {
      attempts += 1
      attempt(`poll#${attempts}`)
      if (attempts >= 100 && !registered) {
        cleanupWaiters()
        console.error('[context-preflight] loader never appeared')
        reportBoot({ stage: 'loader-timeout', hasLoader: false })
      }
    }, 100)
  }
})()
