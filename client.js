// 上下文注入管理 — browser half.
//
// Loaded by the harness module loader as a lazy factory (no JSX; React comes
// from the loader). Three surfaces share one dataset:
//   - sidebar.panellist : narrow panel with totals and quick switches
//   - main              : full page (清单 / 策略 / 预算 / 说明)
//   - composer dock     : one-line chip with the first-turn total
//
// The host owns every number. This file renders snapshots and sends single-item
// actions back; it never recomputes tokens or policy semantics.
(function () {
  const ID = 'dsh-context-injection'
  const BASE = '/plugins/dsh-context-injection'
  const ROUTES = {
    summary: BASE + '/summary',
    locale: BASE + '/locale',
    action: BASE + '/action',
    boot: BASE + '/boot',
    registrations: BASE + '/registrations',
  }

  const CHANNELS = ['sections', 'contexts', 'skills', 'tools', 'instructions']
  const MANAGED = ['sections', 'contexts', 'skills', 'tools']
  const COLOR = {
    sections: '#4d6bfe',
    contexts: '#14b8a6',
    skills: '#a855f7',
    tools: '#f59e0b',
    instructions: '#94a3b8',
  }

  // Minimal Chinese fallback so controls still read when /locale fails.
  const FALLBACK = {
    panelLabel: '注入',
    panelTitle: '上下文注入',
    pageTitle: '上下文注入管理',
    subtitle: '新会话的第一轮请求会带上这些内容；开关只影响之后新建的会话',
    refresh: '刷新',
    retry: '重试',
    loading: '正在读取注入构成…',
    failed: '读取失败',
    total: '首轮注入',
    savable: '可关闭',
    items: '条目',
    policy: '当前策略',
    after: '策略后',
    anchor: '本会话已占用',
    sections: '系统提示词段落',
    contexts: '运行时上下文',
    skills: '技能目录',
    tools: '工具 schema',
    instructions: '工作区规则',
    list: '清单',
    settings: '策略',
    budget: '预算',
    about: '说明',
    search: '搜索条目',
    all: '全部',
    name: '条目',
    channel: '通道',
    tokens: 'token',
    share: '占比',
    switch: '开关',
    locked: '只读',
    lockedHint: 'DSH 直接注入，0.2.2 没有公开的关闭入口',
    preset: '预设',
    presetAll: '全开',
    presetMinimal: '极简',
    custom: '自定义',
    promptPrefix: '自定义前言（替换 persona 前缀）',
    promptPrefixHint: '留空即不注入；改动从下一个新会话开始，会改变提示词前缀缓存',
    promptSuffix: '自定义后记（替换 persona 后缀）',
    budgetTarget: '预算目标（token）',
    budgetHint: '按条目大小从大到小挑选可关项；必填上下文和工作区规则不参与',
    budgetBefore: '当前',
    budgetAfter: '预算后',
    applyPlan: '应用这套建议',
    planDrop: '建议关闭',
    planEmpty: '当前注入已经在预算内，不需要关闭任何条目',
    unreachable: '即使关掉全部可关条目也到不了这个预算',
    saveHint: '改动即时写入策略文件，只影响之后新建的会话',
    policyPath: '策略文件',
    updatedAt: '更新时间',
    appliedNow: '本会话已按策略处理',
    appliedNot: '本会话未受策略影响（在策略保存前创建）',
    lastApply: '最近一次应用',
    anchorHint: '含对话历史，与首轮注入量不可直接比较',
    aboutManageable: '能管的',
    aboutLocked: '不能管的',
    aboutTokens: '这些 token 是估算：ASCII ÷ 4，其他字符 ÷ 1.6，不是分词器结果',
    aboutFiles: '插件不读写你的 AGENTS.md / SKILL.md，只登记会话作用域内的注册',
    aboutNew: '策略只作用于之后新建的会话；正在跑的会话不会被改写',
    aboutTool: '模型侧工具 context_injection 只读，管理动作只能由你在这里点',
    aboutBudget: '预算按「关掉最大的可关条目优先」贪心计算，结果可逆',
    close: '关闭',
    open: '打开面板',
    empty: '没有匹配的条目',
    shareOf: '占首轮注入',
    applied: '已写入',
    actionFailed: '操作失败',
  }

  const NAMES_ZH = {
    'harness:identity': '身份声明',
    'deployment:persona-prefix': '角色前缀',
    'deployment:persona-suffix': '角色后记',
    'plan:policy': '计划模式',
    'team:policy': '团队协作',
    'tools:ptc-only': 'PTC 说明',
    'context:file-reference': '文件引用',
    'tools:sdk': '工具 SDK 文档',
    'ui:deliverable-file-references': '交付物引用',
    'harness:source': '源码位置',
    'app:web-surface': 'GUI 地址',
    'working-directory:current': '当前目录',
    'sandbox:policy': '沙箱策略',
    'approval:policy': '审批策略',
    'subagent:identity': '子智能体身份',
    'subagent:delegation': '委派说明',
  }

  // ------------------------------------------------------------ helpers

  function pickSessionId(props) {
    const candidates = [
      props && props.sessionId,
      props && props.session && props.session.id,
      props && props.conversation && props.conversation.sessionId,
      props && props.conversation && props.conversation.session && props.conversation.session.id,
    ]
    for (const candidate of candidates) if (typeof candidate === 'string' && candidate.length > 0) return candidate
    return ''
  }

  async function getJson(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    const text = await response.text()
    let parsed = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok) throw new Error((parsed && parsed.message) || `HTTP ${response.status}`)
    return parsed
  }

  const token = (value) => {
    const number = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
    if (number < 1000) return String(number)
    if (number < 1000000) return `${Math.round((number / 1000) * 10) / 10}k`
    return `${Math.round((number / 1000000) * 10) / 10}M`
  }
  const digits = (value) => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

  const STYLE = `
.ci-root{--ci-fg:var(--dsw-alias-content-primary,#18181b);--ci-fg2:var(--dsw-alias-content-secondary,#52525b);--ci-fg3:var(--dsw-alias-content-tertiary,#8a8a93);--ci-line:var(--dsw-alias-border-secondary,rgba(0,0,0,.09));--ci-line2:var(--dsw-alias-border-tertiary,rgba(0,0,0,.055));--ci-bg:var(--dsw-alias-bg-primary,#fff);--ci-card:var(--dsw-alias-bg-secondary,#fafafa);--ci-accent:var(--dsw-alias-brand-primary,#4d6bfe);--ci-warn:var(--dsw-alias-warning-primary,#b45309);color:var(--ci-fg);font-size:13px;line-height:1.55;display:flex;flex-direction:column;height:100%;min-height:0;container-type:inline-size}
body[data-ds-dark-theme] .ci-root{--ci-fg:#ececf1;--ci-fg2:#b9b9c3;--ci-fg3:#8b8b95;--ci-line:rgba(255,255,255,.12);--ci-line2:rgba(255,255,255,.07);--ci-bg:#161619;--ci-card:#1d1d21;--ci-accent:#7c8dff;--ci-warn:#fbbf24}
.ci-scroll{overflow:auto;min-height:0}
.ci-scroll::-webkit-scrollbar{width:8px;height:8px}
.ci-scroll::-webkit-scrollbar-thumb{background:var(--ci-line);border-radius:8px}
.ci-head{display:flex;align-items:flex-start;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--ci-line2);flex:0 0 auto}
.ci-head h1{font-size:16px;font-weight:600;margin:0;letter-spacing:.01em}
.ci-head p{margin:2px 0 0;color:var(--ci-fg2);font-size:12px}
.ci-head .ci-spacer{flex:1}
.ci-btn{border:1px solid var(--ci-line);background:var(--ci-bg);color:var(--ci-fg);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;line-height:1.5;white-space:nowrap}
.ci-btn:hover{background:var(--ci-card)}
.ci-btn[disabled]{opacity:.5;cursor:default}
.ci-btn.ci-primary{background:var(--ci-accent);border-color:transparent;color:#fff}
.ci-body{padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px;flex:0 0 auto}
.ci-body.grow{flex:1 1 auto;min-height:0;overflow:auto;padding-top:12px}
.ci-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
@container (max-width:560px){.ci-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ci-kpi{border:1px solid var(--ci-line2);background:var(--ci-card);border-radius:10px;padding:10px 12px;min-width:0}
.ci-kpi .k{font-size:11px;color:var(--ci-fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-kpi .v{font-size:19px;font-weight:600;letter-spacing:-.01em;margin-top:2px;white-space:nowrap}
.ci-kpi .s{font-size:11px;color:var(--ci-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--ci-line2)}
.ci-bar span{display:block;height:100%;min-width:2px}
.ci-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px}
.ci-legend button{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ci-fg2);font-size:11px;cursor:pointer;padding:2px 0}
.ci-legend i{width:8px;height:8px;border-radius:3px;display:block}
.ci-legend b{color:var(--ci-fg);font-weight:600}
.ci-tabs{display:flex;gap:4px;border-bottom:1px solid var(--ci-line2);padding:0 20px;flex:0 0 auto}
.ci-tabs button{border:0;background:transparent;color:var(--ci-fg2);padding:8px 10px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.ci-tabs button.on{color:var(--ci-fg);border-bottom-color:var(--ci-accent);font-weight:600}
.ci-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 0 auto}
.ci-input{flex:1;min-width:120px;border:1px solid var(--ci-line);border-radius:8px;padding:5px 10px;font-size:12px;background:var(--ci-bg);color:var(--ci-fg);outline:none}
.ci-input:focus{border-color:var(--ci-accent)}
.ci-chip{border:1px solid var(--ci-line);background:transparent;color:var(--ci-fg2);border-radius:999px;padding:3px 10px;font-size:11px;cursor:pointer}
.ci-chip.on{background:var(--ci-fg);color:var(--ci-bg);border-color:transparent}
.ci-table{border:1px solid var(--ci-line2);border-radius:10px;overflow:auto;background:var(--ci-bg);min-height:0}
.ci-thead,.ci-row{display:grid;grid-template-columns:minmax(0,1fr) 96px 72px 58px 52px;gap:8px;align-items:center;padding:7px 12px}
.ci-thead{font-size:11px;color:var(--ci-fg3);background:var(--ci-card);border-bottom:1px solid var(--ci-line2);position:sticky;top:0;z-index:1}
.ci-row{border-bottom:1px solid var(--ci-line2);font-size:12.5px}
.ci-row:last-child{border-bottom:0}
.ci-row:hover{background:var(--ci-card)}
.ci-row .n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-row .id{color:var(--ci-fg3);font-size:11px;margin-left:6px}
.ci-row .badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ci-fg2);white-space:nowrap}
.ci-row .badge i{width:8px;height:8px;border-radius:3px;display:block}
.ci-row .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--ci-fg2)}
.ci-lock{justify-self:end;font-size:10.5px;color:var(--ci-fg3);border:1px solid var(--ci-line);border-radius:999px;padding:1px 7px;white-space:nowrap}
.ci-row.locked .n{color:var(--ci-fg2)}
.ci-switch{position:relative;width:34px;height:20px;border-radius:999px;border:0;background:var(--ci-line);cursor:pointer;padding:0;justify-self:end;transition:background .15s}
.ci-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.ci-switch.on{background:var(--ci-accent)}
.ci-switch.on span{transform:translateX(14px)}
.ci-switch.mixed{background:var(--ci-line)}
.ci-switch.mixed span{transform:translateX(7px)}
.ci-switch[disabled]{opacity:.45;cursor:default}
.ci-grouphead{cursor:pointer;font-weight:600;background:var(--ci-bg)}
.ci-grouphead:hover{background:var(--ci-card)}
.ci-caret{display:inline-block;width:14px;color:var(--ci-fg3);font-size:10px;transform:translateY(-1px)}
.ci-row-nested{background:var(--ci-card);padding-left:34px;box-shadow:inset 2px 0 0 var(--ci-line2)}
.ci-row-nested .n{font-weight:400}
.ci-note{color:var(--ci-fg2);font-size:12px}
.ci-note.warn{color:var(--ci-warn)}
.ci-card{border:1px solid var(--ci-line2);border-radius:10px;padding:12px 14px;background:var(--ci-card);display:flex;flex-direction:column;gap:8px}
.ci-card h2{font-size:12px;font-weight:600;margin:0;color:var(--ci-fg2)}
.ci-rowline{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ci-rowline .lbl{font-size:12.5px}
.ci-rowline .hint{font-size:11px;color:var(--ci-fg3)}
.ci-seg{display:inline-flex;border:1px solid var(--ci-line);border-radius:8px;overflow:hidden}
.ci-seg button{border:0;background:transparent;color:var(--ci-fg2);padding:4px 10px;font-size:11.5px;cursor:pointer}
.ci-seg button.on{background:var(--ci-fg);color:var(--ci-bg)}
.ci-empty{padding:26px 12px;text-align:center;color:var(--ci-fg3);font-size:12px}
.ci-skel{height:56px;border-radius:10px;background:var(--ci-card);border:1px solid var(--ci-line2)}
.ci-foot{color:var(--ci-fg3);font-size:11px;padding-bottom:4px;word-break:break-all}
.ci-list{display:flex;flex-direction:column;gap:6px}
.ci-mini{display:flex;align-items:center;gap:8px}
.ci-mini .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.ci-mini .t{font-size:11px;color:var(--ci-fg3);font-variant-numeric:tabular-nums}
.ci-dock{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ci-line);background:var(--ci-bg);color:var(--ci-fg2);border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer;line-height:1.4}
.ci-dock:hover{background:var(--ci-card)}
.ci-dock b{color:var(--ci-fg);font-weight:600;font-variant-numeric:tabular-nums}
.ci-dock i{width:6px;height:6px;border-radius:50%;background:var(--ci-accent);display:block}
.ci-side{display:flex;flex-direction:column;min-height:0;height:100%}
.ci-side .ci-body{padding:12px 12px 16px;gap:10px;flex:1 1 auto;min-height:0;overflow:auto}
`

  function createTranslator(dictionary, language) {
    const dict = dictionary || {}
    const zh = language !== 'en'
    return function t(key, vars) {
      let value = dict[key]
      if (typeof value !== 'string' || value === key) value = zh ? FALLBACK[key] : undefined
      if (typeof value !== 'string') return key
      if (vars === undefined) return value
      return value.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
    }
  }

  function nameOf(t, item) {
    const dict = t.names || {}
    const label = dict[item.name] || (t.language === 'zh' ? NAMES_ZH[item.name] : undefined)
    return label && label !== item.name ? label : item.name
  }

  window.__ModuleLoader__.load({
    id: ID,
    factory(require) {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useMemo, useRef, useState } = React

      const ctxRef = { current: null }
      const reportedStages = new Set()
      const reportBoot = (stage, error) => {
        if (reportedStages.has(stage) && stage !== 'render-error') return
        reportedStages.add(stage)
        try {
          void fetch(ROUTES.boot, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stage, error: error === undefined ? null : String((error && error.message) || error) }),
          }).catch(() => {})
        } catch {
          /* diagnostics never break the panel */
        }
      }
      reportBoot('factory-entered')

      function useSnapshot(sessionId) {
        const [state, setState] = useState({ status: 'loading', data: null, error: null })
        const [nonce, setNonce] = useState(0)
        useEffect(() => {
          let cancelled = false
          const url = ROUTES.summary + (sessionId ? `?session=${encodeURIComponent(sessionId)}` : '')
          setState((previous) => ({ ...previous, status: previous.data === null ? 'loading' : 'refreshing' }))
          getJson(url)
            .then((data) => {
              if (!cancelled) setState({ status: 'ready', data, error: null })
            })
            .catch((error) => {
              if (cancelled) return
              setState((previous) => ({
                status: previous.data === null ? 'failed' : 'ready',
                data: previous.data,
                error: String(error.message || error),
              }))
            })
          return () => {
            cancelled = true
          }
        }, [sessionId, nonce])
        const reload = useCallback(() => setNonce((value) => value + 1), [])
        return { ...state, reload }
      }

      function useLocale(payload) {
        return useMemo(() => {
          let language = 'zh'
          try {
            if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.toLowerCase().indexOf('zh') !== 0) {
              language = 'en'
            }
          } catch {
            /* keep Chinese */
          }
          const all = (payload && payload.locale) || {}
          const primary = all[language] || all.zh || {}
          const secondary = all[language === 'zh' ? 'en' : 'zh'] || {}
          const t = createTranslator(Object.assign({}, secondary, primary), language)
          t.names = Object.assign({}, secondary.names, primary.names)
          t.groupNames = Object.assign({}, secondary.groupNames, primary.groupNames)
          t.language = language
          return t
        }, [payload])
      }

      // A slot entry that throws blanks that slot in the host; the boundary keeps
      // the failure visible here (and reported to /diag) instead of silent.
      class Boundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { failed: null }
        }

        static getDerivedStateFromError(error) {
          return { failed: String((error && error.message) || error) }
        }

        componentDidCatch(error) {
          reportBoot('render-error', error)
        }

        render() {
          if (this.state.failed !== null) {
            return h('div', { className: 'ci-root' }, h('div', { className: 'ci-body' }, h('div', { className: 'ci-note warn' }, this.state.failed)))
          }
          return this.props.children
        }
      }

      const guarded = (Component) => function Guarded(props) {
        return h(Boundary, null, h(Component, props))
      }

      // ------------------------------------------------------------ atoms

      function Switch({ on, disabled, onChange, title }) {
        return h(
          'button',
          {
            type: 'button',
            className: 'ci-switch' + (on ? ' on' : ''),
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': title || '',
            title: title || '',
            disabled: disabled === true,
            onClick: () => {
              if (disabled !== true) onChange(!on)
            },
          },
          h('span', null),
        )
      }

      function Dot({ channel }) {
        return h('i', { style: { background: COLOR[channel] || '#94a3b8' }, 'aria-hidden': 'true' })
      }

      function Kpis({ snapshot, t }) {
        const totals = snapshot.totals
        const policy = snapshot.policy
        const rows = [
          { key: 'total', value: token(totals.tokens), sub: `${digits(totals.chars)} 字 · ${snapshot.items.length} 条` },
          { key: 'savable', value: token(totals.savableTokens), sub: `${totals.savablePercent}% · ${t('shareOf')}` },
          { key: 'after', value: token(policy.preview.after), sub: `${t('preset')}: ${policy.preset}` },
          { key: 'anchor', value: totals.anchor === null ? '—' : token(totals.anchor.tokens), sub: t('anchorHint') },
        ]
        return h(
          'div',
          { className: 'ci-kpis' },
          rows.map((row) =>
            h(
              'div',
              { className: 'ci-kpi', key: row.key },
              h('div', { className: 'k' }, t(row.key)),
              h('div', { className: 'v' }, row.value),
              h('div', { className: 's', title: row.sub }, row.sub),
            ),
          ),
        )
      }

      function Composition({ snapshot, t, filter, onFilter }) {
        const total = snapshot.totals.tokens || 1
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'ci-bar' },
            snapshot.channels
              .filter((channel) => channel.tokens > 0)
              .map((channel) =>
                h('span', {
                  key: channel.id,
                  style: { width: `${Math.max(1, (channel.tokens / total) * 100)}%`, background: COLOR[channel.id] },
                  title: `${t(channel.id)} ${digits(channel.tokens)}`,
                }),
              ),
          ),
          h(
            'div',
            { className: 'ci-legend' },
            snapshot.channels.map((channel) =>
              h(
                'button',
                {
                  key: channel.id,
                  type: 'button',
                  onClick: () => onFilter(filter === channel.id ? 'all' : channel.id),
                  title: `${t(channel.id)} · ${digits(channel.tokens)} token`,
                },
                h(Dot, { channel: channel.id }),
                t(channel.id),
                ' ',
                h('b', null, token(channel.tokens)),
                ` · ${pct(channel.tokens, snapshot.totals.tokens)}%`,
              ),
            ),
          ),
        )
      }

      function channelEnabled(snapshot, channel) {
        const state = snapshot.policy.channels[channel]
        if (state === undefined) return true
        if (state.mode === 'only') return state.names.length > 0
        return true
      }

      function ChannelSwitches({ snapshot, t, act }) {
        return h(
          'div',
          { className: 'ci-list' },
          MANAGED.map((channel) => {
            const info = snapshot.policy.channels[channel] || { total: 0, included: 0, mode: 'all', names: [] }
            const row = snapshot.channels.find((entry) => entry.id === channel)
            return h(
              'div',
              { className: 'ci-mini', key: channel },
              h(Dot, { channel }),
              h('span', { className: 'n', title: `${t(channel)} · ${info.names.join(', ')}` }, `${t(channel)} · ${info.included}/${info.total}`),
              h('span', { className: 't' }, token(row ? row.tokens : 0)),
              h(Switch, { on: channelEnabled(snapshot, channel), onChange: (next) => act({ kind: 'channel', channel, enabled: next }), title: t(channel) }),
            )
          }),
        )
      }

      const itemKey = (item) => `${item.channel}\u0000${item.name}`

      function Switch({ on, mixed, disabled, onChange, title }) {
        return h(
          'button',
          {
            type: 'button',
            className: 'ci-switch' + (on ? ' on' : '') + (mixed === true ? ' mixed' : ''),
            role: 'switch',
            'aria-checked': mixed === true ? 'mixed' : on ? 'true' : 'false',
            'aria-label': title || '',
            title: title || '',
            disabled: disabled === true,
            onClick: (event) => {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
              if (disabled !== true) onChange(!on)
            },
          },
          h('span', null),
        )
      }

      const GROUP_ZH = {
        core: '基础工具',
        'tool-guidance': '工具说明',
        rules: '工作区规则',
        harness: '系统提示词',
        deployment: '部署人设',
        ui: '界面',
        plan: '计划模式',
        team: '团队协作',
        context: '文件引用',
        approval: '审批策略',
        sandbox: '沙箱策略',
        'working-directory': '工作目录',
        subagent: '子智能体',
        app: 'GUI 地址',
      }

      function groupLabelOf(t, group) {        const dict = t.groupNames || {}
        const label = group.label
        const mapped = dict[label] || dict[label.toLowerCase()]
        if (typeof mapped === 'string' && mapped.length > 0) return mapped
        if (t.language === 'zh') return GROUP_ZH[label.toLowerCase()] || label
        return label
      }

      function policyItemOn(snapshot, item) {
        const channel = snapshot.policy.channels[item.channel]
        if (channel === undefined || channel.mode === 'all') return true
        if (channel.mode === 'only') return channel.names.indexOf(item.name) >= 0
        return channel.names.indexOf(item.name) < 0
      }

      function policyGroupState(snapshot, group) {
        const rows = snapshot.items.filter((item) => item.group === group.id)
        const unlocked = rows.filter((item) => !item.locked)
        if (unlocked.length === 0) return { on: true, mixed: false, disabled: true }
        const onCount = unlocked.filter((item) => policyItemOn(snapshot, item)).length
        return { on: onCount === unlocked.length, mixed: onCount > 0 && onCount < unlocked.length, disabled: false }
      }

      function ItemRow({ item, t, snapshot, isOn, onToggle, busy, nested }) {
        const label = nameOf(t, item)
        const locked = item.locked === true
        return h(
          'div',
          { className: 'ci-row' + (locked ? ' locked' : '') + (nested === true ? ' ci-row-nested' : ''), key: itemKey(item) },
          h('div', { className: 'n', title: `${item.name} · ${item.tokens} token` }, label, label !== item.name ? h('span', { className: 'id' }, item.name) : null),
          h('div', { className: 'badge' }, h(Dot, { channel: item.channel }), t(item.channel)),
          h('div', { className: 'num' }, digits(item.tokens)),
          h('div', { className: 'num' }, `${pct(item.tokens, snapshot.totals.tokens)}%`),
          locked
            ? h('span', { className: 'ci-lock', title: t('lockedHint') }, t('locked'))
            : h(Switch, { on: isOn(item), disabled: busy, onChange: (next) => onToggle(item, next), title: item.name }),
        )
      }

      function ItemsTable({ snapshot, t, filter, setFilter, onToggle, onGroup, busy }) {
        const [query, setQuery] = useState('')
        const [view, setView] = useState('group')
        const [expanded, setExpanded] = useState({})
        const items = useMemo(() => {
          const needle = query.trim().toLowerCase()
          const names = t.names || {}
          return snapshot.items
            .filter((item) => filter === 'all' || item.channel === filter)
            .filter((item) => {
              if (needle.length === 0) return true
              const label = names[item.name] || NAMES_ZH[item.name] || ''
              return item.name.toLowerCase().indexOf(needle) >= 0 || label.toLowerCase().indexOf(needle) >= 0
            })
            .slice()
            .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
        }, [snapshot.items, filter, query, t])

        const isOn = (item) => {
          const channel = snapshot.policy.channels[item.channel]
          if (channel === undefined || channel.mode === 'all') return true
          if (channel.mode === 'only') return channel.names.indexOf(item.name) >= 0
          return channel.names.indexOf(item.name) < 0
        }

        const groups = useMemo(() => {
          const map = new Map()
          for (const item of items) {
            const entry = map.get(item.group) ?? {
              id: item.group,
              channel: item.channel,
              label: item.groupLabel,
              items: [],
              tokens: 0,
              savableTokens: 0,
            }
            entry.items.push(item)
            entry.tokens += item.tokens
            if (!item.locked) entry.savableTokens += item.tokens
            map.set(item.group, entry)
          }
          return [...map.values()].sort((left, right) => right.tokens - left.tokens)
        }, [items])

        const groupState = (group) => {
          const unlocked = group.items.filter((item) => !item.locked)
          if (unlocked.length === 0) return { on: true, mixed: false, disabled: true }
          const onCount = unlocked.filter(isOn).length
          return { on: onCount === unlocked.length, mixed: onCount > 0 && onCount < unlocked.length, disabled: false }
        }

        const toggleGroup = (group) => {
          const state = groupState(group)
          if (state.disabled) return
          onGroup(group, !state.on)
        }

        const toggleExpanded = (id) => setExpanded((previous) => ({ ...previous, [id]: previous[id] !== true }))

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: '1 1 auto' } },
          h(
            'div',
            { className: 'ci-toolbar' },
            h('input', {
              className: 'ci-input',
              placeholder: t('search'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
              'aria-label': t('search'),
            }),
            h(
              'div',
              { className: 'ci-seg' },
              [
                ['group', t('group')],
                ['flat', t('flat')],
              ].map(([key, label]) => h('button', { key, type: 'button', className: view === key ? 'on' : '', onClick: () => setView(key) }, label)),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              ['all'].concat(CHANNELS).map((channel) =>
                h(
                  'button',
                  { key: channel, type: 'button', className: 'ci-chip' + (filter === channel ? ' on' : ''), onClick: () => setFilter(channel) },
                  channel === 'all' ? t('all') : t(channel),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'ci-table' },
            h(
              'div',
              { className: 'ci-thead' },
              h('div', null, t('name')),
              h('div', null, t('channel')),
              h('div', { style: { textAlign: 'right' } }, t('tokens')),
              h('div', { style: { textAlign: 'right' } }, t('share')),
              h('div', { style: { textAlign: 'right' } }, t('switch')),
            ),
            items.length === 0
              ? h('div', { className: 'ci-empty' }, t('empty'))
              : view === 'group'
                ? groups.map((group) => {
                    const state = groupState(group)
                    const open = expanded[group.id] === true
                    return h(
                      'div',
                      { className: 'ci-group', key: group.id },
                      h(
                        'div',
                        {
                          className: 'ci-row ci-grouphead',
                          role: 'button',
                          tabIndex: 0,
                          'aria-expanded': open ? 'true' : 'false',
                          onClick: () => toggleExpanded(group.id),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggleExpanded(group.id)
                            }
                          },
                        },
                        h(
                          'div',
                          { className: 'n' },
                          h('span', { className: 'ci-caret' + (open ? ' open' : '') }, open ? '▾' : '▸'),
                          groupLabelOf(t, group),
                          h('span', { className: 'id' }, `${group.items.length} 条`),
                        ),
                        h('div', { className: 'badge' }, h(Dot, { channel: group.channel }), t(group.channel)),
                        h('div', { className: 'num' }, digits(group.tokens)),
                        h('div', { className: 'num' }, `${pct(group.tokens, snapshot.totals.tokens)}%`),
                        h(Switch, { on: state.on, mixed: state.mixed, disabled: busy || state.disabled, onChange: () => toggleGroup(group), title: group.label }),
                      ),
                      open
                        ? group.items.map((item) => h(ItemRow, { key: itemKey(item), item, t, snapshot, isOn, onToggle, busy, nested: true }))
                        : null,
                    )
                  })
                : items.map((item) => h(ItemRow, { key: itemKey(item), item, t, snapshot, isOn, onToggle, busy })),
          ),
          h(
            'div',
            { className: 'ci-note' },
            `${t('total')} ${digits(snapshot.totals.tokens)} · ${t('savable')} ${digits(snapshot.totals.savableTokens)} (${snapshot.totals.savablePercent}%) · ${snapshot.groups.length} 组 · ${t('locked')} ${snapshot.locks.length}`,
          ),
        )
      }

      function SettingsTab({ snapshot, t, act }) {
        const policy = snapshot.policy
        const [prefix, setPrefix] = useState(policy.prompt.prefix)
        const [suffix, setSuffix] = useState(policy.prompt.suffix)
        const [saving, setSaving] = useState(false)
        const timer = useRef(null)

        useEffect(() => {
          setPrefix(policy.prompt.prefix)
          setSuffix(policy.prompt.suffix)
        }, [policy.prompt.prefix, policy.prompt.suffix])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])

        const persist = (nextPrefix, nextSuffix) => {
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            setSaving(true)
            act({ kind: 'prompt', prefix: nextPrefix, suffix: nextSuffix }).finally(() => setSaving(false))
          }, 500)
        }

        return h(
          'div',
          { className: 'ci-list' },
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('preset')),
            h(
              'div',
              { className: 'ci-rowline' },
              h(
                'div',
                { className: 'ci-seg' },
                [
                  ['all', t('presetAll')],
                  ['minimal', t('presetMinimal')],
                ].map(([name, label]) =>
                  h('button', { key: name, type: 'button', className: policy.preset === name ? 'on' : '', onClick: () => act({ kind: 'preset', name }) }, label),
                ),
              ),
              h('span', { className: 'hint' }, policy.preset === 'custom' ? t('custom') : ''),
            ),
            h('div', { className: 'ci-note' }, t('saveHint')),
          ),
          h('div', { className: 'ci-card' }, h('h2', null, t('aboutManageable')), h(ChannelSwitches, { snapshot, t, act })),
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('promptPrefix')),
            h('textarea', {
              className: 'ci-input',
              style: { minHeight: 64, resize: 'vertical', fontFamily: 'inherit' },
              value: prefix,
              onChange: (event) => {
                setPrefix(event.target.value)
                persist(event.target.value, suffix)
              },
              'aria-label': t('promptPrefix'),
            }),
            h('div', { className: 'hint' }, t('promptPrefixHint')),
            h('h2', { style: { marginTop: 6 } }, t('promptSuffix')),
            h('textarea', {
              className: 'ci-input',
              style: { minHeight: 48, resize: 'vertical', fontFamily: 'inherit' },
              value: suffix,
              onChange: (event) => {
                setSuffix(event.target.value)
                persist(prefix, event.target.value)
              },
              'aria-label': t('promptSuffix'),
            }),
            saving ? h('div', { className: 'hint' }, t('applied')) : null,
          ),
          h(
            'div',
            { className: 'ci-card' },
            h(
              'div',
              { className: 'ci-rowline' },
              h('h2', null, t('lastApply')),
              h('span', { className: 'hint' }, policy.appliedToThisAgent ? t('appliedNow') : t('appliedNot')),
            ),
            h(
              'div',
              { className: 'ci-note' },
              policy.lastApplication && policy.lastApplication.report
                ? `${policy.lastApplication.report.sessionId || ''} · ${policy.lastApplication.report.error ? policy.lastApplication.report.error : `OK · −${token(policy.lastApplication.report.savedTokens || 0)}`}`
                : '—',
            ),
            h('div', { className: 'ci-foot' }, `${t('policyPath')}：${policy.path}`),
            policy.updatedAt ? h('div', { className: 'ci-foot' }, `${t('updatedAt')}：${policy.updatedAt}`) : null,
            policy.error ? h('div', { className: 'ci-note warn' }, policy.error) : null,
          ),
        )
      }

      function BudgetTab({ snapshot, t, act }) {
        const policy = snapshot.policy
        const [target, setTarget] = useState(policy.budget.tokens > 0 ? String(policy.budget.tokens) : '')
        const plan = policy.plan
        const timer = useRef(null)

        useEffect(() => {
          setTarget(policy.budget.tokens > 0 ? String(policy.budget.tokens) : '')
        }, [policy.budget.tokens])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])

        const commit = (value) => {
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => act({ kind: 'budget', tokens: value.length > 0 ? Number(value) : 0 }), 450)
        }

        return h(
          'div',
          { className: 'ci-list' },
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('budgetTarget')),
            h(
              'div',
              { className: 'ci-toolbar' },
              h('input', {
                className: 'ci-input',
                inputMode: 'numeric',
                placeholder: '24000',
                value: target,
                onChange: (event) => {
                  const value = event.target.value.replace(/[^0-9]/g, '')
                  setTarget(value)
                  commit(value)
                },
                'aria-label': t('budgetTarget'),
              }),
              h(
                'button',
                { type: 'button', className: 'ci-btn ci-primary', disabled: plan.target <= 0, onClick: () => act({ kind: 'budget.apply', tokens: Number(target) || plan.target }) },
                t('applyPlan'),
              ),
            ),
            h('div', { className: 'hint' }, t('budgetHint')),
          ),
          h(
            'div',
            { className: 'ci-card' },
            h(
              'div',
              { className: 'ci-rowline' },
              h('span', { className: 'lbl' }, `${t('budgetBefore')} ${digits(plan.before)}`),
              h('span', { className: 'lbl' }, `${t('budgetAfter')} ${digits(plan.after)}`),
            ),
            h('div', { className: 'ci-bar' }, h('span', { style: { width: `${Math.min(100, pct(plan.after, Math.max(1, plan.before)))}%`, background: COLOR.sections } })),
            plan.reachable ? null : h('div', { className: 'ci-note warn' }, t('unreachable')),
            plan.drop.length === 0
              ? h('div', { className: 'ci-note' }, t('planEmpty'))
              : h(
                  'div',
                  null,
                  h('div', { className: 'hint', style: { marginBottom: 4 } }, `${t('planDrop')} ${plan.drop.length} · −${digits(plan.savedTokens)} token`),
                  h(
                    'div',
                    { className: 'ci-list' },
                    plan.drop.slice(0, 12).map((entry) =>
                      h(
                        'div',
                        { className: 'ci-mini', key: `${entry.channel}:${entry.name}` },
                        h(Dot, { channel: entry.channel }),
                        h('span', { className: 'n', title: entry.name }, (t.names || {})[entry.name] || NAMES_ZH[entry.name] || entry.name),
                        h('span', { className: 't' }, digits(entry.tokens)),
                      ),
                    ),
                  ),
                  plan.drop.length > 12 ? h('div', { className: 'hint' }, `+${plan.drop.length - 12}`) : null,
                ),
          ),
        )
      }

      function AboutTab({ snapshot, t }) {
        const locked = snapshot.locks
        return h(
          'div',
          { className: 'ci-list' },
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('aboutLocked')),
            locked.length === 0
              ? h('div', { className: 'ci-note' }, '—')
              : h(
                  'div',
                  { className: 'ci-list' },
                  locked.slice(0, 20).map((lock) =>
                    h(
                      'div',
                      { className: 'ci-mini', key: `${lock.channel}:${lock.name}` },
                      h(Dot, { channel: lock.channel }),
                      h('span', { className: 'n', title: lock.name }, (t.names || {})[lock.name] || NAMES_ZH[lock.name] || lock.name),
                      h('span', { className: 't' }, lock.reason === 'required-context' ? '必填' : t('locked')),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('about')),
            h('div', { className: 'ci-note' }, t('aboutTokens')),
            h('div', { className: 'ci-note' }, t('aboutFiles')),
            h('div', { className: 'ci-note' }, t('aboutNew')),
            h('div', { className: 'ci-note' }, t('aboutTool')),
            h('div', { className: 'ci-note' }, t('aboutBudget')),
            h(
              'div',
              { className: 'ci-foot' },
              `AGENTS.md 链：${snapshot.instructions.files.filter((file) => file.status !== 'missing').length} 个已加载 / 预算 ${digits(snapshot.instructions.budgetBytes)} B`,
            ),
          ),
        )
      }

      // ------------------------------------------------------------ panel

      function Panel({ props, compact }) {
        const sessionId = pickSessionId(props)
        const { status, data, error, reload } = useSnapshot(sessionId)
        const t = useLocale(data)
        const [tab, setTab] = useState('list')
        const [filter, setFilter] = useState('all')
        const [busy, setBusy] = useState(false)

        const act = useCallback(
          async (action) => {
            setBusy(true)
            try {
              await postJson(ROUTES.action, Object.assign({ session: sessionId }, action))
              reload()
            } catch (failure) {
              console.error('[context-injection] action failed', failure)
            } finally {
              setBusy(false)
            }
          },
          [sessionId, reload],
        )

        const onToggle = useCallback((item, next) => act({ kind: 'item', channel: item.channel, name: item.name, enabled: next }), [act])
        const onGroupToggle = useCallback(
          (group, enabled) => act({ kind: 'group', channel: group.channel, group: group.id, enabled }),
          [act],
        )

        const close = () => {
          try {
            const layout = ctxRef.current && ctxRef.current.get && ctxRef.current.get('layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
          } catch {
            /* nothing to close without the layout service */
          }
        }

        if (status === 'loading') {
          return h(
            'div',
            { className: 'ci-root' },
            h('style', null, STYLE),
            h('div', { className: 'ci-head' }, h('h1', null, t(compact ? 'panelTitle' : 'pageTitle'))),
            h('div', { className: 'ci-body' }, h('div', { className: 'ci-skel' }), h('div', { className: 'ci-skel' }), h('div', { className: 'ci-note' }, t('loading'))),
          )
        }

        if (status === 'failed') {
          return h(
            'div',
            { className: 'ci-root' },
            h('style', null, STYLE),
            h('div', { className: 'ci-head' }, h('h1', null, t(compact ? 'panelTitle' : 'pageTitle'))),
            h('div', { className: 'ci-body' }, h('div', { className: 'ci-note warn' }, `${t('failed')}：${error}`), h('button', { type: 'button', className: 'ci-btn', onClick: reload }, t('retry'))),
          )
        }

        const snapshot = data
        const head = h(
          'div',
          { className: 'ci-head' },
          h('div', { style: { minWidth: 0 } }, h('h1', null, t(compact ? 'panelTitle' : 'pageTitle')), h('p', null, t('subtitle'))),
          h('div', { className: 'ci-spacer' }),
          h('button', { type: 'button', className: 'ci-btn', onClick: reload, title: t('refresh') }, t('refresh')),
          compact ? h('button', { type: 'button', className: 'ci-btn', onClick: close }, t('close')) : null,
        )

        if (compact) {
          const groups = snapshot.groups.slice(0, 12)
          return h(
            'div',
            { className: 'ci-root ci-side' },
            h('style', null, STYLE),
            head,
            h(
              'div',
              { className: 'ci-body' },
              h(Kpis, { snapshot, t }),
              h(Composition, { snapshot, t, filter, onFilter: setFilter }),
              h('div', { className: 'ci-card', style: { padding: '8px 10px' } }, h(ChannelSwitches, { snapshot, t, act })),
              h(
                'div',
                { className: 'ci-list' },
                groups.map((group) => {
                  const state = policyGroupState(snapshot, group)
                  return h(
                    'div',
                    { className: 'ci-mini', key: group.id },
                    h(Dot, { channel: group.channel }),
                    h('span', { className: 'n', title: `${group.label} · ${group.count} 条` }, `${groupLabelOf(t, group)} · ${group.count}`),
                    h('span', { className: 't' }, token(group.tokens)),
                    h(Switch, {
                      on: state.on,
                      mixed: state.mixed,
                      disabled: busy || state.disabled,
                      onChange: () => onGroupToggle(group, !state.on),
                      title: group.label,
                    }),
                  )
                }),
              ),
              h('div', { className: 'ci-foot' }, `${t('total')} ${digits(snapshot.totals.tokens)} · ${t('savable')} ${digits(snapshot.totals.savableTokens)} (${snapshot.totals.savablePercent}%)`),
            ),
          )
        }

        return h(
          'div',
          { className: 'ci-root' },
          h('style', null, STYLE),
          head,
          h('div', { className: 'ci-body' }, h(Kpis, { snapshot, t }), h(Composition, { snapshot, t, filter, onFilter: setFilter })),
          h(
            'div',
            { className: 'ci-tabs' },
            [
              ['list', t('list')],
              ['settings', t('settings')],
              ['budget', t('budget')],
              ['about', t('about')],
            ].map(([key, label]) => h('button', { key, type: 'button', className: tab === key ? 'on' : '', onClick: () => setTab(key) }, label)),
          ),
          h(
            'div',
            { className: 'ci-body grow' },
            tab === 'list'
              ? h(ItemsTable, { snapshot, t, filter, setFilter, onToggle, onGroup: onGroupToggle, busy })
              : tab === 'settings'
                ? h(SettingsTab, { snapshot, t, act })
                : tab === 'budget'
                  ? h(BudgetTab, { snapshot, t, act })
                  : h(AboutTab, { snapshot, t }),
          ),
        )
      }

      function MainPanel(props) {
        return h(Panel, { props, compact: false })
      }

      function SidePanel(props) {
        return h(Panel, { props, compact: true })
      }

      function DockChip(props) {
        const sessionId = pickSessionId(props)
        const { status, data } = useSnapshot(sessionId)
        const t = useLocale(data)
        if (status === 'failed') return null
        const tokens = data ? data.totals.tokens : null
        const open = () => {
          try {
            const layout = ctxRef.current && ctxRef.current.get && ctxRef.current.get('layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('context-injection')
          } catch {
            /* opening is best effort */
          }
        }
        return h(
          'button',
          { type: 'button', className: 'ci-dock', onClick: open, title: t('open') },
          h('i', null),
          h('span', null, t('panelLabel')),
          h('b', null, tokens === null ? '…' : token(tokens)),
          data && data.totals.savableTokens > 0 ? h('span', null, `· ${t('savable')} ${data.totals.savablePercent}%`) : null,
        )
      }

      function PanelIcon() {
        // The sidebar panellist renders one icon per panel, so this is the
        // entry point: three stacked source bands narrowing into one line.
        return h(
          'svg',
          { viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 3, width: 15, height: 2.6, rx: 1.3, fill: 'currentColor', opacity: 0.85 }),
          h('rect', { x: 2.5, y: 8.2, width: 11, height: 2.6, rx: 1.3, fill: 'currentColor', opacity: 0.6 }),
          h('rect', { x: 2.5, y: 13.4, width: 7, height: 2.6, rx: 1.3, fill: 'currentColor', opacity: 0.35 }),
          h('circle', { cx: 16.4, cy: 14.7, r: 2.1, fill: '#4d6bfe' }),
        )
      }

      let applyStarted = false
      let localeRegistered = false

      function panelLabel(ctx) {
        try {
          const bound = ctx.locale.bind('context-injection')
          const value = bound('panelLabel')
          if (typeof value === 'string' && value.length > 0 && value !== 'panelLabel') return value
        } catch {
          /* fall through to the Chinese label */
        }
        return FALLBACK.panelLabel
      }

      function registerClient(ctx) {
        const attempts = []
        const attempt = (key, run, optional) => {
          try {
            run()
            attempts.push({ key, ok: true })
          } catch (error) {
            attempts.push({ key, ok: false, optional: optional === true, message: String((error && error.message) || error) })
            if (optional !== true) console.error(`[context-injection] slot registration failed: ${key}`, error)
          }
        }

        attempt(
          'sidebar',
          () => {
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({ name: 'sidebar.panellist', id: 'context-injection', order: 6, label: () => panelLabel(ctx) }, guarded(PanelIcon)),
            )
          },
          false,
        )
        attempt('main', () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'context-injection' }, guarded(MainPanel))), false)
        // Optional right-sidebar body: only registered when the host declares
        // that slot, so profiles without it lose nothing.
        attempt(
          'sidebar-body',
          () => ctx.slots.inject('sidebar.panel', () => ctx.slots.register({ name: 'sidebar.panel', id: 'context-injection', order: 6 }, guarded(SidePanel))),
          true,
        )
        attempt(
          'dock',
          () =>
            ctx.slots.inject('conversation.composer.dock', () =>
              ctx.slots.register({ name: 'conversation.composer.dock', id: 'context-injection', order: 6 }, guarded(DockChip)),
            ),
          true,
        )
        attempt('icon', () => {
          // The panel list uses the label function above; the icon component is
          // exported for hosts that ask for one by name.
          if (typeof ctx.slots.register === 'function') void PanelIcon
        }, true)

        reportBoot('slots-registered')
        void fetch(ROUTES.registrations, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slots: attempts, errors: attempts.filter((entry) => entry.ok === false) }),
        }).catch(() => {})

        if (!localeRegistered) {
          localeRegistered = true
          void getJson(ROUTES.locale)
            .then((payload) => {
              try {
                ctx.locale.register('context-injection', { zh: payload.zh || {}, en: payload.en || {} })
              } catch (error) {
                console.warn('[context-injection] locale registration unavailable', error)
              }
            })
            .catch(() => {})
        }
      }

      return {
        inject: ['slots', 'locale'],
        apply(ctx) {
          if (applyStarted) return
          applyStarted = true
          ctxRef.current = ctx
          try {
            registerClient(ctx)
          } catch (error) {
            reportBoot('apply-failed', error)
            console.error('[context-injection] apply failed', error)
          }
        },
      }
    },
  })
})()
