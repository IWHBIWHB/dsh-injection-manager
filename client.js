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
  const ID = 'dsh-injection-manager'
  const BASE = '/plugins/dsh-injection-manager'
  const ROUTES = {
    summary: BASE + '/summary',
    locale: BASE + '/locale',
    action: BASE + '/action',
    export: BASE + '/export',
    verify: BASE + '/verify',
    boot: BASE + '/boot',
    registrations: BASE + '/registrations',
    stats: BASE + '/stats',
    // v2 read-only surfaces. All GET + JSON, same origin; the host owns every
    // number and every byte these return.
    content: BASE + '/content',
    trend: BASE + '/trend',
    events: BASE + '/events',
    health: BASE + '/health',
  }

  // v2 API version the browser half expects. /summary reports it; a v1 host
  // keeps working with the old surfaces and never sees these requests.
  const API_V2 = 2
  const RESOURCE_TTL = 30000

  const CHANNELS = ['sections', 'contexts', 'skills', 'tools', 'instructions']
  const MANAGED = ['sections', 'contexts', 'skills', 'tools']
  const COLOR = {
    sections: '#4d6bfe',
    contexts: '#14b8a6',
    skills: '#a855f7',
    tools: '#f59e0b',
    instructions: '#94a3b8',
  }

  // The window bar answers a different question than the injection bar, so it
  // gets one blue ramp instead of the channel hues: three parts of one request,
  // not five independent channels. The ramp is themed so the deepest step still
  // separates from the track in dark mode.
  const WINDOW_COLOR = {
    system: 'var(--ci-win1)',
    tools: 'var(--ci-win2)',
    messages: 'var(--ci-win3)',
    used: 'var(--ci-win2)',
    free: 'transparent',
  }

  // Minimal Chinese fallback so controls still read when /locale fails.
  const FALLBACK = {
    panelLabel: '上下文注入',
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
    window: '上下文窗口',
    windowHint: '占用率来自宿主自己的测量：下一次请求的预计占用 ÷ 模型窗口。',
    noWindow: '窗口未知',
    noWindowHint: '本会话还没有测量数据；发一条消息后就会出现。',
    windowUsedOf: '{used} / {window}',
    remain: '剩余',
    windowBarLabel: '上下文窗口已用 {pct}%',
    systemPart: '系统',
    toolsPart: '工具',
    messagesPart: '消息',
    windowBreakdownHint: '构成是估算值，含对话历史，不只是首轮注入。',
    compactionLine: '已压缩 {count} 次 · 释放 {saved}',
    compactionHint: '压缩回执只统计本插件装载之后的事件，之前的压缩不在内。',
    compactionFailed: '失败 {count} 次',
    trendLabel: '首轮注入趋势，{min} ~ {max} token',
    requestComposition: '本次请求构成',
    injectionComposition: '首轮注入构成',
    noTrim: '策略未裁剪',
    mixedOff: '部分关闭',
    skillsCallout: '收藏的技能会出现在每一个请求里',
    skillsLine: '{tokens} token · 占首轮 {share}% · 平均每个 {avg} · {providers} 个来源',
    skillsUnit: '个技能',
    skillsManage: '去管理',
    skillsJump: '只看技能通道',
    truncatedHint: '{count} 条描述超过目录长度上限，会被截断',
    heaviestSkill: '最大：{name}（{tokens}）',
    scopeLabel: '查看范围',
    scopeGlobal: '默认策略',
    scopeGlobalHint: '现在新建一个会话会收到什么',
    scopeSession: '本会话',
    scopeSessionHint: '屏幕上这段对话此刻实际在发什么',
    closedBadge: '已关闭',
    closedRestoreHint: '对新会话已关闭；在这里可以重新打开',
    filterLabel: '按通道筛选',
    activeFilters: '筛选：',
    tabManage: '管理',
    tabStats: '统计',
    tabSettings: '设置',
    statsEmpty: '还没有历史记录。打开面板任意会话都会留下一条；这里汇总所有被测量过的对话。',
    statsSessions: '对话数',
    statsSessionsSub: '本插件测量过',
    statsAvg: '平均首轮',
    statsAvgSub: '每个对话的 token',
    statsSkills: '平均技能',
    statsSkillsSub: '每个对话的 token',
    statsPeak: '最大一次',
    statsSkillsShort: '技能',
    statsPeakShort: '峰值',
    statsWhen: '最近测量',
    statsByDay: '每天的首轮均值',
    statsSessionsTitle: '每一个测量过的对话',
    statsCoverage: '本机 {known} 个对话中，已记录 {recorded} 个',
    statsUnmeasured: '未测量',
    statsSubagent: '子智能体',
    statsBackfilled: '刚补齐 {count} 个历史会话',
    statsCurrent: '当前会话',
    statsHistory: '历史记录',
    // v2 chrome. The full v2 dictionary ships in locale/*.json and arrives with
    // /summary; these few keep degraded states readable when it does not.
    'v2.tabInsights': '洞察',
    'v2.tabsLabel': '面板分区',
    'v2.apiOld': '宿主接口还是 v1：洞察、内容透视、健康检查需要 v2 宿主插件；升级后自动出现。',
    'v2.openContent': '查看内容',
    'v2.health': '健康检查',
    'v2.retry': '重试',
    'content.close': '关闭',
    'content.retry': '重试',
    'content.copy': '复制全文',
    'content.search': '在内容里搜索',
    'trend.title': '首轮注入趋势',
    'trend.empty': '还没有可画的记录。打开一次面板或新建会话后就会留下数据。',
    'trend.retry': '重试',
    'v2.eventsTitle': '本会话事件时间线',
    'v2.sessions': '会话',
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

  // v2 reads: abortable, and a failure carries the host's error code when it
  // sent one. The cached copy below is only ever a *display* convenience; the
  // host stays the single source of truth when the next read lands.
  async function getJsonSignal(url, signal) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal })
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const error = new Error((payload && (payload.message || payload.error)) || `HTTP ${response.status}`)
      error.status = response.status
      error.code = payload && typeof payload.error === 'string' ? payload.error : undefined
      throw error
    }
    if (payload !== null && typeof payload === 'object' && payload.ok === false) {
      const error = new Error(payload.message || payload.error || 'request-failed')
      error.code = typeof payload.error === 'string' ? payload.error : undefined
      throw error
    }
    return payload
  }

  // 30s cache shared by every instance of the panel. A tab switch re-renders
  // but does not re-hit the host; an explicit refresh/reload bypasses it.
  const RESOURCE_CACHE = new Map()
  function cachePeek(url) {
    const row = RESOURCE_CACHE.get(url)
    return row === undefined ? undefined : row.data
  }
  function cacheFresh(url, ttl) {
    const row = RESOURCE_CACHE.get(url)
    if (row === undefined) return undefined
    return Date.now() - row.at < ttl ? row.data : undefined
  }
  function cacheSet(url, data) {
    RESOURCE_CACHE.set(url, { at: Date.now(), data })
    if (RESOURCE_CACHE.size > 48) {
      const oldest = RESOURCE_CACHE.keys().next()
      if (oldest.done !== true) RESOURCE_CACHE.delete(oldest.value)
    }
  }

  const token = (value) => {
    const number = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
    if (number < 1000) return String(number)
    if (number < 1000000) return `${Math.round((number / 1000) * 10) / 10}k`
    return `${Math.round((number / 1000000) * 10) / 10}M`
  }
  const digits = (value) => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // pct() stays numeric: three call sites do arithmetic with it (budget bar
  // width, drawer share data). Display-only interpolation uses pctText so one
  // column never mixes "3%" with "3.6%".
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
  const pctText = (part, whole) => (whole > 0 ? (Math.round((part / whole) * 1000) / 10).toFixed(1) + '%' : '0.0%')

  const DOCK_STYLE = `
.ci-dock-wrap{display:inline-flex;align-items:center;gap:0}
.ci-dock{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;background:transparent;color:var(--ci-fg3,#8a8f99);border-radius:999px;padding:2px 7px;font-size:11px;font-family:inherit;cursor:pointer;line-height:1.5;opacity:.7;transition:opacity .15s,background .15s,border-color .15s}
.ci-dock:hover{opacity:1;border-color:var(--ci-line,rgba(127,127,127,.28));background:var(--ci-bg,transparent)}
.ci-dock:focus-visible{outline:2px solid var(--ci-accent,#4d6bfe);outline-offset:2px}
.ci-dock b{color:var(--ci-fg2,#5f6470);font-weight:600;font-variant-numeric:tabular-nums}
.ci-dock i{width:5px;height:5px;border-radius:50%;background:var(--ci-accent,#4d6bfe);opacity:.75;display:block}
.ci-dock em{font-style:normal;color:var(--ci-fg3,#8a8f99);font-size:10px}
.ci-dock.warn i{background:var(--ci-danger,#b91c1c);opacity:.9}
.ci-dock-x{width:15px;height:15px;border:0;background:transparent;color:var(--ci-fg3,#8a8f99);cursor:pointer;font-size:12px;line-height:1;padding:0;opacity:0;transition:opacity .12s}
.ci-dock-wrap:hover .ci-dock-x,.ci-dock-x:focus-visible{opacity:.55}
.ci-dock-x:hover{opacity:1}
`

  const STYLE = `
.ci-root{--ci-fg:var(--dsw-alias-content-primary,#18181b);--ci-fg2:var(--dsw-alias-content-secondary,#52525b);--ci-fg3:var(--dsw-alias-content-tertiary,#8a8a93);--ci-line:var(--dsw-alias-border-secondary,rgba(0,0,0,.09));--ci-line2:var(--dsw-alias-border-tertiary,rgba(0,0,0,.055));--ci-bg:var(--dsw-alias-bg-primary,#fff);--ci-card:var(--dsw-alias-bg-secondary,#fafafa);--ci-accent:var(--dsw-alias-brand-primary,#4d6bfe);--ci-warn:var(--dsw-alias-warning-primary,#b45309);--ci-danger:var(--dsw-alias-danger-primary,#b91c1c);--ci-win1:#2f4bd8;--ci-win2:#5f7bff;--ci-win3:#a8bcff;color:var(--ci-fg);font-size:12px;line-height:1.55;display:flex;flex-direction:column;height:100%;min-height:0;container-type:inline-size}
body[data-ds-dark-theme] .ci-root{--ci-fg:#ececf1;--ci-fg2:#b9b9c3;--ci-fg3:#8b8b95;--ci-line:rgba(255,255,255,.12);--ci-line2:rgba(255,255,255,.07);--ci-bg:#161619;--ci-card:#1d1d21;--ci-accent:#7c8dff;--ci-warn:#fbbf24;--ci-danger:#f87171;--ci-win1:#5f7bff;--ci-win2:#8fa6ff;--ci-win3:#c9d6ff}
.ci-scroll{overflow:auto;min-height:0}
.ci-scroll::-webkit-scrollbar{width:8px;height:8px}
.ci-scroll::-webkit-scrollbar-thumb{background:var(--ci-line);border-radius:8px}
.ci-head{display:flex;align-items:flex-start;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--ci-line2);flex:0 0 auto}
.ci-head h1{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em}
.ci-head p{margin:2px 0 0;color:var(--ci-fg2);font-size:12px}
.ci-head .ci-spacer{flex:1}
.ci-btn{border:1px solid var(--ci-line);background:var(--ci-bg);color:var(--ci-fg);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;line-height:1.5;white-space:nowrap}
.ci-btn:hover{background:var(--ci-card)}
.ci-btn[disabled]{opacity:.5;cursor:default}
.ci-btn.ci-primary{background:var(--ci-accent);border-color:transparent;color:#fff}
.ci-body{padding:14px 20px 14px;display:flex;flex-direction:column;gap:14px;flex:0 0 auto}
.ci-body.grow{flex:1 1 auto;min-height:0;overflow:auto;padding-top:12px}
.ci-manage{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
.ci-history{display:flex;flex-direction:column;gap:5px}
.ci-history-row{display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:11px;color:var(--ci-fg3)}
.ci-history-row .d{font-variant-numeric:tabular-nums}
.ci-history-row .t{font-variant-numeric:tabular-nums;white-space:nowrap}
.ci-current{display:flex;flex-direction:column;gap:10px}
.ci-section-title{font-size:12px;font-weight:600;color:var(--ci-fg2);padding:2px 0}
.ci-stathead,.ci-statrow{display:grid;grid-template-columns:minmax(0,90px) 130px 88px 96px 72px minmax(0,1fr);gap:8px;align-items:center;font-size:11px}
.ci-stathead{color:var(--ci-fg3);padding-bottom:4px;border-bottom:1px solid var(--ci-line2)}
.ci-statrow{padding:4px 0;border-bottom:1px solid var(--ci-line2);color:var(--ci-fg2)}
.ci-statrow:last-child{border-bottom:0}
.ci-statrow .n{font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-statrow .w{color:var(--ci-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-statrow .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ci-statrow .b{color:var(--ci-fg);font-weight:600}
.ci-statrow.unmeasured{color:var(--ci-fg3)}
.ci-statrow.unmeasured .b{color:var(--ci-fg3);font-weight:400}
.ci-stathead .r{text-align:right}
.ci-bar-track.mini{height:6px;min-width:0}
@container (max-width:900px){.ci-stathead,.ci-statrow{grid-template-columns:minmax(0,80px) 1fr 74px 76px minmax(0,0.6fr)}.ci-statrow .w,.ci-stathead :nth-child(2){display:none}}
.ci-card.ci-overview{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:18px;align-items:start}
.ci-donut{display:flex;align-items:center;gap:14px;min-width:0}
.ci-donut-svg{flex:0 0 auto}
.ci-donut-v{font-size:18px;font-weight:600;fill:var(--ci-fg)}
.ci-donut-k{font-size:10px;fill:var(--ci-fg3)}
.ci-donut-legend{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto}
.ci-donut-row{display:grid;grid-template-columns:10px minmax(0,1fr) minmax(52px,auto) 44px;gap:6px;align-items:center;font-size:11px}
.ci-donut-row b{text-align:right}
.ci-donut-row .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ci-fg2)}
.ci-donut-row b{font-weight:600;font-variant-numeric:tabular-nums}
.ci-donut-row .p{color:var(--ci-fg3);text-align:right;font-variant-numeric:tabular-nums}
.ci-bars{display:flex;flex-direction:column;gap:7px;min-width:0}
.ci-bars-title{font-size:11px;color:var(--ci-fg3);margin-bottom:1px}
.ci-barrow{display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr) auto;gap:8px;align-items:center;font-size:11px;min-width:0}
.ci-barrow .ci-bar-track{min-width:0}
.ci-barrow.off .n,.ci-barrow.off .t{color:var(--ci-fg3)}
.ci-barrow .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-barrow .t{color:var(--ci-fg3);font-variant-numeric:tabular-nums;white-space:nowrap}
.ci-bar-track{height:8px;border-radius:5px;background:var(--ci-line2);overflow:hidden;display:flex;min-width:3px}
.ci-bar-fill{display:block;height:100%;border-radius:5px}
.ci-bar-closed{display:block;height:100%;border-radius:5px;opacity:.28;min-width:3px}
.ci-spark{display:block;width:100%;height:18px;margin:4px 0 2px;opacity:.9}
.ci-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
@container (max-width:560px){.ci-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ci-kpi{border:1px solid var(--ci-line2);background:var(--ci-card);border-radius:8px;padding:8px 10px;min-width:0}
.ci-kpi .k{font-size:11px;color:var(--ci-fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-kpi .v{font-size:18px;font-weight:600;letter-spacing:-.01em;margin-top:0;white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1.35}
.ci-kpi .s{font-size:11px;color:var(--ci-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ci-kpi.tone-warn .v{color:var(--ci-warn)}
.ci-kpi.tone-danger .v{color:var(--ci-danger)}
.ci-window-head{display:flex;align-items:baseline;gap:8px;min-width:0}
.ci-window-head h2{font-size:12px;font-weight:600;margin:0;color:var(--ci-fg2);white-space:nowrap}
.ci-window-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--ci-line2);gap:1px}
.ci-window-bar span{display:block;height:100%;min-width:0}
.ci-skills{display:flex;flex-direction:column;gap:8px}
.ci-skills-head{display:flex;align-items:center;gap:12px;min-width:0}
.ci-skills-num{display:flex;align-items:baseline;gap:3px;flex:0 0 auto}
.ci-skills-num b{font-size:20px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ci-skills-num span{font-size:11px;color:var(--ci-fg3)}
.ci-skills-text{flex:1 1 auto;min-width:0}
.ci-skills-text .k{font-size:12px;font-weight:600}
.ci-skills-text .s{font-size:11px;color:var(--ci-fg3);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-skills-providers{display:flex;flex-wrap:wrap;gap:4px 14px}
.ci-skills-provider{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ci-fg2);font-size:11px;cursor:pointer;padding:2px 0;min-width:0}
.ci-skills-provider:hover{color:var(--ci-fg)}
.ci-skills-provider .n{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-skills-provider .ci-bar-track{width:56px;height:6px;flex:0 0 56px}
.ci-skills-provider .t{color:var(--ci-fg3);font-variant-numeric:tabular-nums;white-space:nowrap}
@container (max-width:430px){
.ci-skills-head{flex-wrap:wrap;gap:8px}
.ci-skills-text{flex:1 1 100%;order:2}
.ci-skills-head .ci-btn{order:1;margin-left:auto}
.ci-skills-provider{flex:0 0 100%}
.ci-skills-provider .n{max-width:none;flex:1 1 auto}
}
.ci-skills-note{font-size:11px;color:var(--ci-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-kinds{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ci-kinds .lbl{font-size:11px;color:var(--ci-fg3);margin-right:2px}
.ci-kind{display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--ci-line2);background:var(--ci-bg);color:var(--ci-fg2);border-radius:999px;padding:2px 9px;font-size:11px;cursor:pointer}
.ci-kind:hover{border-color:var(--ci-line);color:var(--ci-fg)}
.ci-kind b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--ci-fg)}
.ci-kind .p{color:var(--ci-fg3);font-variant-numeric:tabular-nums}
.ci-kind.on{border-color:var(--ci-accent);color:var(--ci-accent)}
.ci-kind.on b{color:var(--ci-accent)}
.ci-strip{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-strip .k{color:var(--ci-fg2);font-weight:600;white-space:nowrap}
.ci-strip .ci-window-bar{flex:1 1 220px;min-width:110px}
.ci-strip .lg{display:flex;gap:4px 12px;flex-wrap:wrap;min-width:0}
.ci-strip .lg .item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ci-strip .lg i{width:8px;height:8px;border-radius:3px;display:block}
.ci-strip .lg b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--ci-fg2)}
.ci-strip .rt{white-space:nowrap;font-variant-numeric:tabular-nums}
.ci-strip .rt.warn{color:var(--ci-warn)}
.ci-strip.tone-warn .rt{color:var(--ci-warn)}
.ci-strip.tone-danger .rt{color:var(--ci-danger)}
@container (max-width:430px){
.ci-strip .ci-window-bar{order:2;flex:1 1 100%}
.ci-strip .k{order:1}
.ci-strip .rt{order:1}
.ci-strip .lg{order:4}
}
.ci-bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--ci-line2)}
.ci-composition{display:flex;flex-direction:column;gap:6px}
.ci-bar span{display:block;height:100%;min-width:2px}
.ci-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px}
.ci-legend button{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ci-fg2);font-size:11px;cursor:pointer;padding:2px 0}
.ci-legend i{width:8px;height:8px;border-radius:3px;display:block}
.ci-legend b{color:var(--ci-fg);font-weight:600}
.ci-tabs{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--ci-line2);background:var(--ci-card);border-radius:8px;align-self:flex-start;margin:0 20px 10px;flex:0 0 auto}
.ci-tabs button{border:0;background:transparent;color:var(--ci-fg2);padding:5px 13px;font-size:12px;cursor:pointer;border-radius:6px;line-height:1.6}
.ci-tabs button:hover{color:var(--ci-fg)}
.ci-tabs button.on{background:var(--ci-bg);color:var(--ci-fg);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.07)}
body[data-ds-dark-theme] .ci-tabs button.on{background:rgba(255,255,255,.1);box-shadow:none}
.ci-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 0 auto}
.ci-select{border:1px solid var(--ci-line);border-radius:8px;background:var(--ci-bg);color:var(--ci-fg);font:inherit;font-size:12px;padding:4px 8px;cursor:pointer;max-width:150px}
.ci-select:focus-visible{outline:2px solid var(--ci-accent);outline-offset:1px}
.ci-viewopts button{font-size:11px;padding:4px 9px}
@media (max-width:1220px){.ci-select{display:none}}
@media (max-width:1040px){.ci-viewopts{display:none}}
.ci-activefilters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);flex:0 0 auto}
.ci-activefilters .lbl{white-space:nowrap}
.ci-input{flex:1;min-width:120px;border:1px solid var(--ci-line);border-radius:8px;padding:5px 10px;font-size:12px;background:var(--ci-bg);color:var(--ci-fg);outline:none}
.ci-input:focus{border-color:var(--ci-accent)}
.ci-chip{border:1px solid var(--ci-line);background:transparent;color:var(--ci-fg2);border-radius:999px;padding:3px 10px;font-size:11px;cursor:pointer}
.ci-chip.on{background:var(--ci-fg);color:var(--ci-bg);border-color:transparent}
.ci-table{border:1px solid var(--ci-line2);border-radius:8px;overflow:auto;background:var(--ci-bg);min-height:0}
.ci-thead,.ci-row{display:grid;grid-template-columns:minmax(0,1fr) 96px 72px 58px 52px;gap:8px;align-items:center;padding:7px 12px}
.ci-thead{font-size:11px;color:var(--ci-fg3);background:var(--ci-card);border-bottom:1px solid var(--ci-line2);position:sticky;top:0;z-index:1}
.ci-sort{width:100%;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;text-align:inherit}
.ci-sort:hover{color:var(--ci-fg2)}
.ci-sort.active{color:var(--ci-fg)}
.ci-arrow{font-size:10px;opacity:.55;line-height:1}
.ci-row{border-bottom:1px solid var(--ci-line2);font-size:12px}
.ci-row:last-child{border-bottom:0}
.ci-row:hover{background:var(--ci-card)}
.ci-row .n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-row .id{color:var(--ci-fg3);font-size:11px;margin-left:6px}
.ci-hit{background:rgba(77,107,254,.22);background:color-mix(in srgb, var(--ci-accent) 24%, transparent);color:inherit;border-radius:2px;padding:0 1px}
.ci-row .badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ci-fg2);white-space:nowrap}
.ci-row .badge i{width:8px;height:8px;border-radius:3px;display:block}
.ci-row .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--ci-fg2)}
.ci-btn:focus-visible,.ci-chip:focus-visible,.ci-switch:focus-visible,.ci-seg button:focus-visible,.ci-tabs button:focus-visible,.ci-legend button:focus-visible,.ci-grouphead:focus-visible,.ci-input:focus-visible,.ci-dock:focus-visible{outline:2px solid var(--ci-accent);outline-offset:2px}
@media (prefers-reduced-motion: reduce){.ci-root *{transition:none!important;animation:none!important}}
.ci-tag{font-size:10px;line-height:1.6;padding:0 5px;border-radius:999px;border:1px solid var(--ci-line);color:var(--ci-fg3);margin-left:6px;white-space:nowrap}
.ci-lock{justify-self:end;font-size:10px;color:var(--ci-fg2);border:1px solid var(--ci-line);border-radius:999px;padding:1px 7px;white-space:nowrap}
.ci-row.locked .n{color:var(--ci-fg2)}
.ci-row-off .n,.ci-row-off .num{color:var(--ci-fg3)}
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
.ci-card{border:1px solid var(--ci-line2);border-radius:8px;padding:12px 14px;background:var(--ci-card);display:flex;flex-direction:column;gap:8px}
.ci-card h2{font-size:12px;font-weight:600;margin:0;color:var(--ci-fg2)}
.ci-rowline{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ci-rowline .lbl{font-size:12px}
.ci-rowline .hint{font-size:11px;color:var(--ci-fg3)}
.ci-seg{display:inline-flex;border:1px solid var(--ci-line);border-radius:8px;overflow:hidden}
.ci-tag-closed{border-color:var(--ci-warn);color:var(--ci-warn)}
.ci-seg button{border:0;background:transparent;color:var(--ci-fg2);padding:4px 10px;font-size:11px;cursor:pointer}
.ci-seg button.on{background:var(--ci-fg);color:var(--ci-bg)}
.ci-empty{padding:26px 12px;text-align:center;color:var(--ci-fg3);font-size:12px}
.ci-skel{height:56px;border-radius:10px;background:var(--ci-card);border:1px solid var(--ci-line2)}
.ci-foot{color:var(--ci-fg3);font-size:11px;padding-bottom:4px;word-break:break-all}
.ci-list{display:flex;flex-direction:column;gap:6px}
.ci-mini{display:flex;align-items:center;gap:8px}
.ci-mini .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.ci-mini .t{font-size:11px;color:var(--ci-fg3);font-variant-numeric:tabular-nums}
.ci-dock-wrap{display:inline-flex;align-items:center;gap:0}
.ci-dock{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;background:transparent;color:var(--ci-fg3);border-radius:999px;padding:2px 7px;font-size:11px;cursor:pointer;line-height:1.5;opacity:.7;transition:opacity .15s,background .15s,border-color .15s}
.ci-dock:hover{opacity:1;border-color:var(--ci-line);background:var(--ci-bg)}
.ci-dock b{color:var(--ci-fg2);font-weight:600;font-variant-numeric:tabular-nums}
.ci-dock i{width:5px;height:5px;border-radius:50%;background:var(--ci-accent);opacity:.75;display:block}
.ci-dock em{font-style:normal;color:var(--ci-fg3);font-size:10px}
.ci-dock-x{width:15px;height:15px;border:0;background:transparent;color:var(--ci-fg3);cursor:pointer;font-size:12px;line-height:1;padding:0;opacity:0;transition:opacity .12s}
.ci-dock-wrap:hover .ci-dock-x,.ci-dock-x:focus-visible{opacity:.55}
.ci-dock-x:hover{opacity:1}
.ci-toast{position:sticky;bottom:8px;align-self:center;max-width:92%;display:flex;align-items:center;gap:10px;border:1px solid var(--ci-line);background:var(--ci-card);color:var(--ci-fg);border-radius:10px;padding:7px 12px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.08);z-index:5}
.ci-toast.warn{border-color:var(--ci-warn);color:var(--ci-warn)}
.ci-toast .ci-btn{padding:2px 8px;font-size:11px}
.ci-side{display:flex;flex-direction:column;min-height:0;height:100%}
.ci-side .ci-body{padding:12px 12px 16px;gap:10px;flex:1 1 auto;min-height:0;overflow:auto}
/* ============================================================ v2 surfaces
   Everything below is new in 2.0: KPI budget tone, health strip, inline
   previews, the content drawer, the hand-written trend chart, insights grids
   and the settings preferences. Tokens follow the host contract: 8px spacing
   grid, 11/12/13/15/20 type, 8/10/12 radii, --dsw-alias-* first. */
.ci-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1.7;padding:0 7px;border-radius:999px;border:1px solid var(--ci-line);color:var(--ci-fg3);white-space:nowrap;background:transparent}
.ci-badge.accent{border-color:var(--ci-accent);color:var(--ci-accent)}
.ci-badge.warn{border-color:var(--ci-warn);color:var(--ci-warn)}
.ci-badge.danger{border-color:var(--ci-danger);color:var(--ci-danger)}
.ci-btn.ci-sm{padding:2px 8px;font-size:11px;border-radius:8px}
.ci-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ci-errorbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--ci-warn);background:var(--ci-card);color:var(--ci-warn);border-radius:8px;padding:6px 10px;font-size:12px;min-width:0}
.ci-errorbar .ci-btn{color:var(--ci-fg)}
.ci-stale{font-size:11px;color:var(--ci-warn)}
.ci-inline-meta{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-inline-meta b{font-weight:600;color:var(--ci-fg2);font-variant-numeric:tabular-nums}
/* ---- manage: health strip ---- */
.ci-health{display:flex;flex-direction:column;gap:0;border:1px solid var(--ci-line2);border-radius:10px;background:var(--ci-card);padding:7px 12px 8px;font-size:12px;min-width:0}
.ci-health-head{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;min-width:0}
.ci-health-title{font-weight:600;font-size:12px;color:var(--ci-fg2);white-space:nowrap}
.ci-health-counts{display:flex;gap:10px;color:var(--ci-fg3);font-size:11px;flex-wrap:wrap}
.ci-health-counts b{font-variant-numeric:tabular-nums;color:var(--ci-fg2);font-weight:600;margin-right:2px}
.ci-health-counts .high b{color:var(--ci-danger)}
.ci-health-counts .warn b{color:var(--ci-warn)}
.ci-health-counts .sep{color:var(--ci-line);padding:0 1px}
.ci-health-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:10px;align-items:center;padding:5px 0 0;margin-top:5px;border-top:1px solid var(--ci-line2)}
.ci-health-row .sev{width:8px;height:8px;border-radius:50%;display:block;background:var(--ci-fg3)}
.ci-health-row .sev.high{background:var(--ci-danger)}
.ci-health-row .sev.warn{background:var(--ci-warn)}
.ci-health-row .sev.info{background:var(--ci-fg3)}
.ci-health-text{min-width:0;color:var(--ci-fg2);font-size:12px;overflow:hidden;text-overflow:ellipsis}
.ci-health-allclear{font-size:11px;color:var(--ci-fg3);padding-top:3px}
.ci-health .ci-btn{align-self:center}
/* ---- manage: inline preview row ---- */
.ci-caret-btn{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 16px;padding:0;margin-right:4px;border:0;border-radius:4px;background:transparent;color:var(--ci-fg3);font-size:10px;line-height:1;cursor:pointer;vertical-align:-3px;transition:transform .12s}
.ci-caret-btn:hover{color:var(--ci-fg);background:var(--ci-line2)}
.ci-caret-btn[aria-expanded="true"]{transform:rotate(90deg)}
.ci-row-preview{padding:6px 12px 9px 34px;background:var(--ci-card);border-bottom:1px solid var(--ci-line2);box-shadow:inset 2px 0 0 var(--ci-line2);display:flex;flex-direction:column;gap:6px;min-width:0}
.ci-row-preview .pv{margin:0;font-size:12px;line-height:1.55;color:var(--ci-fg2);white-space:pre-wrap;word-break:break-word;font-family:inherit}
.ci-row-preview .meta{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-row-preview .actions{display:flex;gap:6px;flex-wrap:wrap}
/* ---- content drawer ---- */
.ci-drawer-backdrop{position:fixed;inset:0;z-index:60;background:rgba(15,15,20,.38)}
.ci-drawer{position:fixed;top:0;right:0;bottom:0;z-index:61;width:min(520px,92%);max-width:100%;display:flex;flex-direction:column;min-height:0;background:var(--ci-bg);color:var(--ci-fg);border-left:1px solid var(--ci-line);box-shadow:-10px 0 34px rgba(0,0,0,.2);outline:none}
.ci-drawer-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--ci-line2);flex:0 0 auto;min-width:0}
.ci-drawer-title{flex:1 1 auto;min-width:0}
.ci-drawer-title h2{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-breadcrumb{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);margin-bottom:2px;min-width:0}
.ci-breadcrumb .sep{opacity:.5}
.ci-breadcrumb .last{color:var(--ci-fg2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-drawer-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--ci-line2);flex:0 0 auto;font-size:11px;min-width:0}
.ci-drawer-source{display:flex;align-items:center;gap:6px;padding:6px 16px;border-bottom:1px solid var(--ci-line2);flex:0 0 auto;font-size:11px;color:var(--ci-fg3);min-width:0;flex-wrap:wrap}
.ci-drawer-path{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:11px;color:var(--ci-fg2);word-break:break-all;min-width:0;flex:1 1 auto}
.ci-drawer-search{flex:1 1 130px;min-width:110px}
.ci-drawer-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 0 24px}
.ci-drawer-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 16px 0;border:1px solid var(--ci-warn);border-radius:8px;padding:6px 10px;font-size:11px;color:var(--ci-warn)}
.ci-content-lines{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;line-height:1.6;min-width:0}
.ci-content-line{display:flex;gap:10px;padding:0 16px;min-width:0}
.ci-content-line:hover{background:var(--ci-card)}
.ci-content-line .ln{flex:0 0 44px;text-align:right;color:var(--ci-fg3);user-select:none;font-variant-numeric:tabular-nums;font-size:11px}
.ci-content-line .tx{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word}
.ci-content-plain{padding:4px 16px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;font-family:inherit}
.ci-content-hit{background:rgba(77,107,254,.24);border-radius:2px;color:inherit}
body[data-ds-dark-theme] .ci-content-hit{background:rgba(124,141,255,.34)}
.ci-drawer-empty{padding:28px 16px;text-align:center;color:var(--ci-fg3);font-size:12px}
.ci-drawer-foot{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;padding:6px 16px;border-top:1px solid var(--ci-line2);font-size:11px;color:var(--ci-fg3)}
/* ---- insights ---- */
.ci-insights{display:flex;flex-direction:column;gap:12px;min-width:0}
.ci-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:10px;align-items:start;min-width:0}
@container (max-width:900px){.ci-grid2{grid-template-columns:minmax(0,1fr)}}
.ci-card.ci-pad0{padding:0;overflow:hidden}
.ci-cardhead{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;min-width:0}
.ci-cardhead h2{font-size:12px;font-weight:600;margin:0;color:var(--ci-fg2);white-space:nowrap}
.ci-cardhead .sp{flex:1 1 auto}
.ci-cardhead .hint{font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-seg.ci-small button{padding:2px 9px;font-size:11px}
/* trend chart */
.ci-trend{display:flex;flex-direction:column;gap:8px;min-width:0}
.ci-trend-wrap{position:relative;min-width:0}
.ci-trend-svg{display:block;width:100%;height:auto}
.ci-trend-axis text{fill:var(--ci-fg3);font-size:10px;font-variant-numeric:tabular-nums}
.ci-trend-grid line{stroke:var(--ci-line2)}
.ci-trend-bar{cursor:pointer;outline:none}
.ci-trend-bar .ci-trend-hit{fill:transparent}
.ci-trend-bar:hover .ci-trend-hit,.ci-trend-bar:focus .ci-trend-hit{fill:var(--ci-line2);opacity:.6}
.ci-trend-bar:focus-visible .ci-trend-focus{stroke:var(--ci-accent);stroke-width:2}
.ci-trend-tip{position:absolute;z-index:4;pointer-events:none;min-width:176px;max-width:var(--ci-tip-w,220px);background:var(--ci-bg);border:1px solid var(--ci-line);border-radius:var(--ci-radius-row,6px);box-shadow:var(--ci-shadow-pop);padding:8px 10px;font-size:var(--ci-fs-body,12px);color:var(--ci-fg2);display:flex;flex-direction:column;gap:4px;animation:ci-tip-in .2s ease}
.ci-trend-tip .t{font-weight:600;color:var(--ci-fg);font-size:12px}
.ci-trend-tip .r{display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:0}
.ci-trend-tip .r .l{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-trend-tip .r b{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ci-fg);white-space:nowrap}
.ci-trend-tip .sw{width:8px;height:8px;border-radius:2px;display:block;flex:0 0 8px}
.ci-trend-tip .sep{height:1px;background:var(--ci-line2);margin:2px 0}
.ci-trend-legend{display:flex;flex-wrap:wrap;gap:2px 6px;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-trend-legend button{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;padding:1px 6px;border-radius:999px;cursor:pointer;min-width:0}
.ci-trend-legend button:hover{color:var(--ci-fg2)}
.ci-trend-legend button[aria-pressed="false"]{opacity:.42;text-decoration:line-through}
.ci-trend-legend i{width:8px;height:8px;border-radius:2px;display:block;flex:0 0 8px}
.ci-trend-legend .unknown i{background:repeating-linear-gradient(45deg,var(--ci-fg3) 0 1.5px,transparent 1.5px 4px)}
.ci-trend-agg{display:flex;align-items:baseline;gap:8px 20px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-trend-agg .cell{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
.ci-trend-agg b{font-size:15px;font-weight:600;color:var(--ci-fg);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.ci-trend-empty{padding:26px 12px;text-align:center;color:var(--ci-fg3);font-size:12px}
.ci-trend-note{font-size:11px;color:var(--ci-fg3);line-height:1.5}
.ci-trend-note .hatch{display:inline-block;width:16px;height:8px;border-radius:2px;vertical-align:-1px;margin-right:3px;background:repeating-linear-gradient(45deg,var(--ci-fg3) 0 1.5px,transparent 1.5px 4px);border:1px solid var(--ci-line2)}
/* sessions */
.ci-session-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.ci-session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:8px;min-width:0}
.ci-session{border:1px solid var(--ci-line2);border-radius:10px;background:var(--ci-bg);padding:8px 10px 9px;display:flex;flex-direction:column;gap:5px;min-width:0}
.ci-session.live{border-color:var(--ci-accent)}
.ci-session .top{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;color:var(--ci-fg3)}
.ci-session .top .sid{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ci-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}
.ci-session .top .when{margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}
.ci-session .big{font-size:20px;font-weight:600;letter-spacing:-.015em;line-height:1.2;font-variant-numeric:tabular-nums}
.ci-session .big small{font-size:11px;font-weight:400;color:var(--ci-fg3);margin-left:5px;letter-spacing:0}
.ci-session .sub{font-size:11px;color:var(--ci-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-session .mini-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--ci-line2);gap:1px}
.ci-session .mini-bar span{display:block;min-width:1px}
.ci-session .mini-bar.unknown{background:repeating-linear-gradient(45deg,var(--ci-line2) 0 3px,transparent 3px 6px)}
.ci-session .badges{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
/* events */
.ci-events{display:flex;flex-direction:column;min-width:0}
.ci-events-list{display:flex;flex-direction:column;max-height:300px;overflow:auto;min-width:0;padding-right:2px}
.ci-event{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:10px;align-items:start;padding:6px 0;min-width:0;border-top:1px solid var(--ci-line2)}
.ci-event:first-child{border-top:0}
.ci-event .dot{width:8px;height:8px;border-radius:50%;display:block;margin-top:5px;background:var(--ci-line)}
.ci-event .dot.k-switch,.ci-event .dot.k-policy-saved,.ci-event .dot.k-preset{background:var(--ci-accent)}
.ci-event .dot.k-budget,.ci-event .dot.k-import{background:var(--ci-warn)}
.ci-event .dot.k-compaction,.ci-event .dot.k-prune{background:var(--ci-fg3)}
.ci-event .body{min-width:0;display:flex;flex-direction:column;gap:2px}
.ci-event .lbl{font-size:12px;color:var(--ci-fg);font-weight:500;line-height:1.45}
.ci-event .prm{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap;font-size:11px;color:var(--ci-fg3);min-width:0}
.ci-event .when{font-size:11px;color:var(--ci-fg3);white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
.ci-event .delta{color:var(--ci-fg2);font-variant-numeric:tabular-nums}
.ci-event .delta.neg{color:var(--ci-fg3)}
/* settings prefs / version */
.ci-prefs{display:flex;flex-direction:column;gap:8px}
.ci-prefrow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.ci-prefrow .lbl{font-size:12px;min-width:0}
.ci-prefrow .hint{font-size:11px;color:var(--ci-fg3);margin-left:8px}
.ci-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;font-size:11px;color:var(--ci-fg3);align-items:baseline}
.ci-kv b{color:var(--ci-fg2);font-weight:500;font-variant-numeric:tabular-nums;word-break:break-all}
.ci-kv .k{white-space:nowrap}
@container (max-width:560px){
  .ci-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ci-kpi .v{font-size:18px}
  .ci-session-grid{grid-template-columns:minmax(0,1fr)}
  .ci-trend-tip{max-width:212px}
}
/* ---- design tokens (self-owned, host variables first) ---------------------
   The 20-token set from _research/v2-bench.md §7. Values are applied below so
   every new surface reads from --ci-*; a host variable wins when present. */
.ci-root{
  --ci-space-1:2px;--ci-space-2:4px;--ci-space-3:6px;--ci-space-4:8px;--ci-space-5:12px;--ci-space-6:16px;--ci-space-7:24px;
  --ci-radius-chip:4px;--ci-radius-row:6px;--ci-radius-card:10px;--ci-radius-pill:999px;
  --ci-fs-micro:10px;--ci-fs-label:11px;--ci-fs-body:12px;--ci-fs-title:13px;--ci-fs-kpi:20px;--ci-fs-stat:18px;
  --ci-hairline:1px;
  --ci-shadow-card:0 1px 2px rgba(0,0,0,.05);
  --ci-shadow-pop:0 8px 24px rgba(0,0,0,.16);
  --ci-motion:.2s ease;
  --ci-chart-bar:14px;--ci-chart-gap:2px;--ci-chart-h:150px;--ci-tip-w:220px;
  --ci-good:var(--dsw-alias-success-primary,#15803d);
  --ci-track:rgba(0,0,0,.06);
  font-size:var(--ci-fs-body);
}
body[data-ds-dark-theme] .ci-root{
  --ci-hairline:1px;
  --ci-shadow-card:none;
  --ci-shadow-pop:0 8px 24px rgba(0,0,0,.5);
  --ci-good:var(--dsw-alias-success-primary,#4ade80);
  --ci-track:rgba(255,255,255,.1);
}
.ci-card{border-radius:var(--ci-radius-card);padding:var(--ci-space-4) var(--ci-space-5);box-shadow:var(--ci-shadow-card)}
.ci-card h2{font-size:var(--ci-fs-title);font-weight:600}
.ci-btn{border-radius:var(--ci-radius-row)}
.ci-badge{border-radius:var(--ci-radius-chip)}
.ci-kpi{border-radius:var(--ci-radius-card);padding:var(--ci-space-4)}
.ci-kpi .v{font-size:var(--ci-fs-kpi)}
.ci-kpis{gap:var(--ci-space-4)}
.ci-block-gap{gap:var(--ci-space-5)}
/* range pills — a third control tier next to Segmented and FilterChip */
.ci-pills{display:inline-flex;align-items:center;gap:var(--ci-space-2);flex-wrap:wrap}
.ci-pills button{border:1px solid var(--ci-line);background:transparent;color:var(--ci-fg2);border-radius:var(--ci-radius-pill);padding:3px 11px;font-size:var(--ci-fs-label);line-height:1.6;cursor:pointer;transition:background var(--ci-motion),border-color var(--ci-motion)}
.ci-pills button:hover{border-color:var(--ci-fg3);color:var(--ci-fg)}
.ci-pills button.on{background:var(--ci-fg);border-color:transparent;color:var(--ci-bg);font-weight:600}
.ci-pills button:focus-visible{outline:2px solid var(--ci-accent);outline-offset:2px}
/* persistent filter bar */
.ci-filterbar{display:flex;align-items:center;gap:var(--ci-space-2);flex-wrap:wrap;font-size:var(--ci-fs-label);color:var(--ci-fg3);min-height:24px;flex:0 0 auto}
.ci-filterbar .lbl{white-space:nowrap;color:var(--ci-fg2)}
.ci-filterchip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--ci-line);background:var(--ci-card);color:var(--ci-fg2);border-radius:var(--ci-radius-chip);padding:1px 4px 1px 8px;font-size:var(--ci-fs-label);line-height:1.7;max-width:220px}
.ci-filterchip .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ci-filterchip button{border:0;background:transparent;color:var(--ci-fg3);cursor:pointer;font-size:12px;line-height:1;padding:2px 4px;border-radius:3px}
.ci-filterchip button:hover{color:var(--ci-fg);background:var(--ci-line2)}
.ci-filterchip:focus-within{border-color:var(--ci-accent)}
.ci-filterclear{border:0;background:transparent;color:var(--ci-accent);font-size:var(--ci-fs-label);cursor:pointer;padding:1px 4px}
.ci-filterclear:hover{text-decoration:underline}
/* signed delta badge: relative to an all-on policy */
.ci-delta{display:inline-flex;align-items:center;font-size:var(--ci-fs-micro);line-height:1.6;padding:0 5px;border-radius:var(--ci-radius-chip);border:1px solid var(--ci-line);color:var(--ci-good);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:6px}
.ci-delta.zero{color:var(--ci-fg3)}
/* gate card for apiVersion < 2 */
.ci-gate{display:flex;flex-direction:column;gap:var(--ci-space-3);border:1px solid var(--ci-warn);border-left-width:3px;border-radius:var(--ci-radius-card);background:var(--ci-card);padding:var(--ci-space-4) var(--ci-space-5)}
.ci-gate h2{font-size:var(--ci-fs-title);font-weight:600;margin:0;color:var(--ci-fg)}
.ci-gate p{margin:0;font-size:var(--ci-fs-body);color:var(--ci-fg2);line-height:1.55}
.ci-gate .kv{display:flex;gap:var(--ci-space-5);flex-wrap:wrap;font-size:var(--ci-fs-label);color:var(--ci-fg3)}
.ci-gate .kv b{color:var(--ci-fg2);font-weight:600;font-variant-numeric:tabular-nums;margin-left:4px}
.ci-gate .actions{display:flex;gap:var(--ci-space-3);flex-wrap:wrap}
/* layout-shaped skeletons: same boxes as the real surfaces, aria-hidden */
.ci-skel-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--ci-space-4)}
.ci-skel-kpis .ci-skel{height:78px;border-radius:var(--ci-radius-card)}
.ci-skel-strip{height:28px;border-radius:var(--ci-radius-row)}
.ci-skel-table{display:flex;flex-direction:column;gap:1px;border:1px solid var(--ci-line2);border-radius:var(--ci-radius-card);overflow:hidden;background:var(--ci-bg)}
.ci-skel-table .head{height:30px;background:var(--ci-card)}
.ci-skel-table .row{height:34px;border-top:1px solid var(--ci-line2)}
.ci-skel-chart{height:var(--ci-chart-h);border-radius:var(--ci-radius-row);background:linear-gradient(180deg,var(--ci-card),transparent);border:1px solid var(--ci-line2);display:flex;align-items:flex-end;gap:6px;padding:8px 10px}
.ci-skel-chart span{flex:1;border-radius:3px 3px 0 0;background:var(--ci-line2);min-height:8px}
.ci-skel-lines{display:flex;flex-direction:column;gap:8px;padding:4px 0}
.ci-skel-lines .line{height:12px;border-radius:3px;background:var(--ci-card);border:1px solid var(--ci-line2)}
.ci-skel-lines .line:nth-child(2n){width:72%}
.ci-skel-lines .line:nth-child(3n){width:88%}
@container (max-width:560px){.ci-skel-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* tools content: description / parameter table / raw JSON */
.ci-drawer-desc{margin:0;font-size:var(--ci-fs-body);line-height:1.6;color:var(--ci-fg2);white-space:pre-wrap;word-break:break-word}
.ci-drawer-sect{padding:0 16px;display:flex;flex-direction:column;gap:var(--ci-space-3)}
.ci-drawer-sect h3{font-size:var(--ci-fs-title);font-weight:600;margin:var(--ci-space-4) 0 var(--ci-space-2);color:var(--ci-fg)}
.ci-param-table{width:calc(100% - 32px);margin:0 16px;border-collapse:collapse;font-size:var(--ci-fs-body)}
.ci-param-table th{font-size:var(--ci-fs-label);font-weight:600;color:var(--ci-fg3);text-align:left;padding:6px 8px 4px;border-bottom:1px solid var(--ci-line2);background:transparent}
.ci-param-table td{padding:6px 8px;border-bottom:1px solid var(--ci-line2);vertical-align:top;color:var(--ci-fg2)}
.ci-param-table td.name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ci-fg);white-space:nowrap}
.ci-param-table td.type{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--ci-fs-label);color:var(--ci-fg3);white-space:nowrap}
.ci-param-table td.req{text-align:center;color:var(--ci-good)}
.ci-param-table td.desc{line-height:1.5}
.ci-empty-next{display:flex;flex-direction:column;gap:var(--ci-space-3);align-items:flex-start;padding:20px 12px;color:var(--ci-fg3);font-size:var(--ci-fs-body);text-align:left}
.ci-empty-next .ci-btn{align-self:flex-start}
.ci-suitename{border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;padding:0;margin:0;margin-right:4px;text-align:left;border-radius:3px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-suitename:hover{color:var(--ci-accent);text-decoration:underline;text-underline-offset:2px}
.ci-suitename:focus-visible{outline:2px solid var(--ci-accent);outline-offset:2px}
.ci-trend-tip-hint{font-size:var(--ci-fs-micro);color:var(--ci-fg3);border-top:1px solid var(--ci-line2);padding-top:3px;margin-top:2px}
@keyframes ci-tip-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.ci-trend-tip{animation:none}}
/* manage overview: two peer cards instead of one mixed card */
.ci-manage-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:stretch}
@container (max-width:900px){.ci-manage-overview{grid-template-columns:minmax(0,1fr)}}
.ci-overview-card{padding:10px 12px;gap:6px}
.ci-overview-card .ci-cardhead .hint{font-variant-numeric:tabular-nums}
.ci-barrow-btn{border:0;background:transparent;font:inherit;color:inherit;padding:2px 4px;border-radius:var(--ci-radius-chip);cursor:pointer;text-align:left;width:100%}
.ci-barrow-btn:hover{background:var(--ci-card)}
.ci-barrow-btn:focus-visible{outline:2px solid var(--ci-accent);outline-offset:1px}
/* insights first screen: trend 2fr + events 1fr */
.ci-insight-top{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px;align-items:stretch}
@container (max-width:1000px){.ci-insight-top{grid-template-columns:minmax(0,1fr)}}
.ci-events-card{display:flex;flex-direction:column;min-height:0}
.ci-events-card .ci-events{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0}
.ci-events-card .ci-events-list{flex:1 1 auto;max-height:none}
.ci-insight-current{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;font-size:var(--ci-fs-label);color:var(--ci-fg3);min-width:0}
.ci-insight-current b{color:var(--ci-fg);font-weight:600;font-variant-numeric:tabular-nums}
.ci-insight-current .ci-btn{margin-left:auto}
.ci-events.ci-card{padding:10px 12px}
/* density pass: KPI 10-12px padding, 20/700 numbers, 10px units */
.ci-kpi{padding:10px 12px;gap:1px}
.ci-kpi .v{font-weight:700;line-height:1.3}
.ci-kpi .s{font-size:var(--ci-fs-micro)}
.ci-body{gap:12px}
.ci-manage{gap:8px}
.ci-insights{gap:10px}
/* 5 channel colours stay the single source; unknown reads as hatching */
.ci-donut-row b,.ci-barrow .t{font-variant-numeric:tabular-nums}
/* KPI value hierarchy: 20px number, 10px denominator/unit (design review #2) */
.ci-kpi .v{display:flex;align-items:baseline;gap:var(--ci-space-1);min-width:0}
.ci-kpi .v .u{font-size:var(--ci-fs-micro);font-weight:500;color:var(--ci-fg3);letter-spacing:0}
.ci-kpi-num{display:inline-flex;align-items:baseline;gap:var(--ci-space-1)}
/* Items table gains a description column only when the panel is wide (#5) */
.ci-about{display:none}
@container (min-width:1100px){
  .ci-thead,.ci-row{grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 96px 72px 58px 52px}
  .ci-about{display:block;font-size:12px;color:var(--ci-fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .ci-row:hover .ci-about{color:var(--ci-fg2)}
}
`

  function createTranslator(dictionary, language) {
    const dict = dictionary || {}
    return function t(key, vars) {
      let value = dict[key]
      // Degraded first paint (no /summary locale yet) still shows readable
      // Chinese chrome instead of raw keys such as `pageTitle`.
      if (typeof value !== 'string' || value === key) value = FALLBACK[key]
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
      const { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } = React

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

      const STORAGE_PREFIX = 'injection-manager:'

      function useStoredState(key, initial) {
        const [value, setValue] = useState(() => {
          try {
            const raw = localStorage.getItem(STORAGE_PREFIX + key)
            return raw === null ? initial : JSON.parse(raw)
          } catch {
            return initial
          }
        })
        useEffect(() => {
          try {
            localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
          } catch {
            /* storage may be disabled; the in-memory value still works */
          }
        }, [key, value])
        return [value, setValue]
      }

      // Sparkline history of the first-turn total, kept in localStorage. This
      // is a local decoration; the cross-session trend lives in useTrend below.
      function useSparkTrend(value) {
        const [trend, setTrend] = useState(() => {
          try {
            const raw = localStorage.getItem(STORAGE_PREFIX + 'trend')
            const parsed = raw === null ? [] : JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })
        useEffect(() => {
          if (!Number.isFinite(value) || value <= 0) return
          setTrend((previous) => {
            const last = previous[previous.length - 1]
            if (last !== undefined && Math.abs(last.v - value) < 1 && Date.now() - last.t < 60000) return previous
            const next = previous.concat({ t: Date.now(), v: value }).slice(-40)
            try {
              localStorage.setItem(STORAGE_PREFIX + 'trend', JSON.stringify(next))
            } catch {
              /* private mode */
            }
            return next
          })
        }, [value])
        return trend
      }

      function useSnapshot(sessionId, pollMs = 5000) {
        const [state, setState] = useState({ status: 'loading', data: null, error: null })
        const [nonce, setNonce] = useState(0)
        // Latest response wins. A poll that started before a write must never
        // overwrite the fresh snapshot that the write triggered -- that was the
        // "I closed it but the panel still shows the old numbers" bug.
        const sequence = useRef(0)
        useEffect(() => {
          let cancelled = false
          const url = ROUTES.summary + (sessionId ? `?session=${encodeURIComponent(sessionId)}` : '')
          let local = 0

          const load = async (silent) => {
            local += 1
            const ticket = local
            sequence.current += 1
            const globalTicket = sequence.current
            if (!silent) setState((previous) => ({ ...previous, status: previous.data === null ? 'loading' : 'refreshing' }))
            try {
              const data = await getJson(url)
              if (cancelled || ticket !== local || globalTicket !== sequence.current) return
              setState({ status: 'ready', data, error: null })
            } catch (error) {
              if (cancelled || ticket !== local) return
              setState((previous) => ({
                status: previous.data === null ? 'failed' : 'ready',
                data: previous.data,
                error: String(error.message || error),
              }))
            }
          }

          load(false).catch(() => {})
          const timer = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') load(true).catch(() => {})
          }, pollMs)
          const onVisible = () => {
            if (document.visibilityState === 'visible') load(true).catch(() => {})
          }
          document.addEventListener('visibilitychange', onVisible)
          return () => {
            cancelled = true
            clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }
        }, [sessionId, nonce, pollMs])
        const reload = useCallback(() => setNonce((value) => value + 1), [])
        return { ...state, reload }
      }

      // --------------------------------------------------------- v2 data hooks
      //
      // One abortable, 30s-cached reader shared by all four v2 surfaces. Rules
      // the panel relies on:
      //   - a failed read never blanks the panel: the last good payload stays
      //     rendered and the surface shows a retry bar;
      //   - an in-flight read is aborted on unmount / URL change, so switching
      //     the trend range cannot land an older response on top of a newer one;
      //   - apiVersion < 2 means the hook is disabled and no request is made.
      function useResource(url, { enabled = true, ttl = RESOURCE_TTL } = {}) {
        const [state, setState] = useState(() => {
          const cached = enabled && url ? cachePeek(url) : undefined
          return {
            status: cached === undefined ? (enabled && url ? 'loading' : 'idle') : 'ready',
            data: cached === undefined ? null : cached,
            error: null,
          }
        })
        const [nonce, setNonce] = useState(0)
        useEffect(() => {
          if (enabled !== true || !url) {
            setState((previous) => ({ ...previous, status: previous.data === null ? 'idle' : previous.status }))
            return undefined
          }
          if (nonce === 0) {
            const fresh = cacheFresh(url, ttl)
            if (fresh !== undefined) {
              setState({ status: 'ready', data: fresh, error: null })
              return undefined
            }
          }
          const stale = cachePeek(url)
          const controller = new AbortController()
          let live = true
          setState((previous) => ({
            status: stale === undefined && previous.data === null ? 'loading' : 'refreshing',
            data: stale === undefined ? previous.data : stale,
            error: null,
          }))
          getJsonSignal(url, controller.signal)
            .then((data) => {
              if (!live) return
              cacheSet(url, data)
              setState({ status: 'ready', data, error: null })
            })
            .catch((error) => {
              if (!live || (error && error.name === 'AbortError')) return
              setState((previous) => ({
                status: 'failed',
                data: previous.data,
                error: String((error && error.message) || error),
                errorCode: error && typeof error.code === 'string' ? error.code : null,
              }))
            })
          return () => {
            live = false
            controller.abort()
          }
        }, [url, enabled, nonce, ttl])
        const reload = useCallback(() => setNonce((value) => value + 1), [])
        return { ...state, reload }
      }

      function useTrend(range, enabled) {
        const url = ROUTES.trend + `?range=${encodeURIComponent(range || 'all')}&limit=120`
        return useResource(url, { enabled })
      }

      function useEvents(sessionId, enabled) {
        const url = ROUTES.events + `?limit=60` + (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '')
        return useResource(url, { enabled })
      }

      function useHealth(sessionId, enabled) {
        const url = ROUTES.health + (sessionId ? `?session=${encodeURIComponent(sessionId)}` : '')
        return useResource(url, { enabled })
      }

      function useContent(target, sessionId) {
        const enabled = target !== null && target !== undefined && typeof target.channel === 'string' && typeof target.id === 'string'
        const url = enabled
          ? ROUTES.content + `?channel=${encodeURIComponent(target.channel)}&id=${encodeURIComponent(target.id)}` + (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '')
          : null
        return useResource(url, { enabled })
      }

      const isV2 = (snapshot) => snapshot !== null && snapshot !== undefined && Number(snapshot.apiVersion) >= API_V2

      // `scope` is a free string since the contract revision; only the three
      // known values have labels, everything else falls back to "unknown source"
      // instead of rendering a raw i18n key.
      function scopeLabel(t, scope) {
        const text = typeof scope === 'string' ? scope : ''
        if (text.length === 0) return '—'
        return ['startup', 'clear', 'backfill'].indexOf(text) >= 0 ? t('v2.scope.' + text) : t('v2.scopeUnknown')
      }

      // Error surfaces carry the host's machine code when it sent one, so a
      // user can quote it in a bug report instead of screenshotting a sentence.
      function errorText(result) {
        if (result === null || result === undefined) return ''
        const code = typeof result.errorCode === 'string' && result.errorCode.length > 0 ? '[' + result.errorCode + '] ' : ''
        return code + String(result.error || '')
      }

      function FilterChip({ label, onClear, title }) {
        return h(
          'span',
          { className: 'ci-filterchip', title: title || label },
          h('span', { className: 't' }, label),
          h('button', { type: 'button', onClick: onClear, 'aria-label': `${label} ×` }, '×'),
        )
      }

      // --------------------------------------------------------- small helpers

      // "3m" / "2h" / "5d" — timestamps in the trend and event feeds are
      // relative because absolute dates there are noise.
      function ago(ms) {
        const value = Number(ms)
        if (!Number.isFinite(value) || value <= 0) return '—'
        const diff = Math.max(0, Date.now() - value)
        const minute = 60000
        const hour = 3600000
        const day = 86400000
        if (diff < minute) return 'now'
        if (diff < hour) return `${Math.round(diff / minute)}m`
        if (diff < day) return `${Math.round(diff / hour)}h`
        if (diff < day * 30) return `${Math.round(diff / day)}d`
        return new Date(value).toLocaleDateString()
      }

      function dayLabel(ms) {
        const value = Number(ms)
        if (!Number.isFinite(value) || value <= 0) return '—'
        try {
          return new Date(value).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
        } catch {
          return new Date(value).toLocaleDateString()
        }
      }

      function fullTime(ms) {
        const value = Number(ms)
        if (!Number.isFinite(value) || value <= 0) return '—'
        try {
          return new Date(value).toLocaleString()
        } catch {
          return '—'
        }
      }

      function useElementWidth(ref, fallback) {
        const [width, setWidth] = useState(fallback)
        useEffect(() => {
          const node = ref.current
          if (!node) return undefined
          const read = () => {
            const next = node.getBoundingClientRect().width
            if (Number.isFinite(next) && next > 0) setWidth(Math.round(next))
          }
          read()
          if (typeof ResizeObserver === 'undefined') return undefined
          const observer = new ResizeObserver(read)
          observer.observe(node)
          return () => observer.disconnect()
        }, [ref, fallback])
        return width
      }

      const SUPPORTED = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

      function useLocale(payload) {
        return useMemo(() => {
          let base = 'zh'
          try {
            if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
              base = navigator.language.toLowerCase().split('-')[0]
            }
          } catch {
            /* keep Chinese */
          }
          const all = (payload && payload.locale) || {}
          const language = SUPPORTED.indexOf(base) >= 0 && all[base] ? base : 'en'
          const primary = all[language] || all.en || all.zh || {}
          const secondary = all.en || {}
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
            return h(
              'div',
              { className: 'ci-root' },
              h(
                'div',
                { className: 'ci-body' },
                h(
                  'div',
                  { className: 'ci-card' },
                  h('h2', null, '面板渲染失败 · Panel failed to render'),
                  h('div', { className: 'ci-note warn' }, this.state.failed),
                  h(
                    'div',
                    { className: 'ci-toolbar' },
                    h(
                      'button',
                      { type: 'button', className: 'ci-btn ci-primary', onClick: () => window.location.reload() },
                      '重新加载面板 · Reload',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ci-btn',
                        onClick: () => {
                          try {
                            void navigator.clipboard.writeText(String(this.state.failed))
                          } catch {
                            /* clipboard may be unavailable */
                          }
                        },
                      },
                      '复制错误 · Copy error',
                    ),
                  ),
                  h('div', { className: 'hint' }, '错误已记录到 /diag；其余功能不受影响，仍可用 /inject 命令。'),
                ),
              ),
            )
          }
          return this.props.children
        }
      }

      const guarded = (Component) => function Guarded(props) {
        return h(Boundary, null, h(Component, props))
      }

      function Toast({ notice, t, onUndo }) {
        if (!notice) return null
        return h(
          'div',
          {
            className: 'ci-toast' + (notice.kind === 'error' ? ' warn' : ''),
            role: notice.kind === 'error' ? 'alert' : 'status',
            'aria-live': notice.kind === 'error' ? 'assertive' : 'polite',
          },
          h('span', null, notice.text),
          notice.undo === true ? h('button', { type: 'button', className: 'ci-btn', onClick: onUndo }, t('undo')) : null,
        )
      }

      // ------------------------------------------------------------ atoms

      function Dot({ channel }) {
        return h('i', { style: { background: COLOR[channel] || '#94a3b8' }, 'aria-hidden': 'true' })
      }

      // A trend line is decoration unless it says what it ranges over: the
      // title carries min/max and the SVG carries an accessible label.
      function Sparkline({ values, width, height, label }) {
        if (!Array.isArray(values) || values.length < 2) return null
        const max = Math.max(...values)
        const min = Math.min(...values)
        const span = max - min || 1
        const step = width / (values.length - 1)
        const points = values
          .map((value, index) => `${(index * step).toFixed(1)},${(height - ((value - min) / span) * (height - 4) - 2).toFixed(1)}`)
          .join(' ')
        return h(
          'svg',
          {
            className: 'ci-spark',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'none',
            role: 'img',
            'aria-label': label || '',
          },
          h('polyline', {
            points,
            fill: 'none',
            stroke: 'var(--ci-accent)',
            strokeWidth: 1.5,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
            vectorEffect: 'non-scaling-stroke',
          }),
        )
      }

      function Donut({ rows, t, size, centerLabel, centerSub, ariaLabel }) {
        const list = Array.isArray(rows) ? rows : []
        const total = list.reduce((sum, row) => sum + (Number(row.tokens) || 0), 0)
        const safe = total || 1
        const radius = 52
        const circumference = 2 * Math.PI * radius
        let offset = 0
        const segments = list
          .filter((row) => (Number(row.tokens) || 0) > 0)
          .map((row) => {
            const length = ((Number(row.tokens) || 0) / safe) * circumference
            const segment = h('circle', {
              key: row.id,
              cx: 66,
              cy: 66,
              r: radius,
              fill: 'none',
              stroke: COLOR[row.id] || 'var(--ci-fg3)',
              strokeWidth: 13,
              strokeDasharray: `${Math.max(0, length - 1.5)} ${circumference - Math.max(0, length - 1.5)}`,
              strokeDashoffset: -offset,
              transform: 'rotate(-90 66 66)',
            })
            offset += length
            return segment
          })
        return h(
          'svg',
          {
            className: 'ci-donut-svg',
            viewBox: '0 0 132 132',
            width: size || 120,
            height: size || 120,
            role: 'img',
            'aria-label': ariaLabel || `${t('total')} ${token(total)}`,
          },
          h('title', null, ariaLabel || `${t('total')} ${token(total)}`),
          h('circle', { cx: 66, cy: 66, r: radius, fill: 'none', stroke: 'var(--ci-line2)', strokeWidth: 13 }),
          segments,
          h('text', { x: 66, y: centerSub === undefined ? 64 : 62, textAnchor: 'middle', className: 'ci-donut-v' }, token(total)),
          h('text', { x: 66, y: centerSub === undefined ? 81 : 79, textAnchor: 'middle', className: 'ci-donut-k' }, centerLabel || t('total')),
          centerSub === undefined ? null : h('text', { x: 66, y: 94, textAnchor: 'middle', className: 'ci-donut-k' }, centerSub),
        )
      }

      // Skills are the reason people end up needing this plugin: a collected
      // catalog sits in every request. This card is the "why is my prompt so
      // big" answer, and its button jumps straight to that channel.
      function SkillsFocus({ snapshot, t, onFilter }) {
        const state = snapshot.skillsState
        if (state === undefined || state === null || !Number.isFinite(state.catalogTokens)) return null
        if ((state.total ?? 0) === 0) return null
        const heaviest = state.heaviest
        const rows = (state.topProviders ?? []).slice(0, 3)
        const providerMax = rows.reduce((max, row) => Math.max(max, row.tokens), 1)
        // Skills are one kind of line item; tool schemas are another. Saying
        // both on the same card is what stops "my skills are only 3k, so why is
        // the prompt 84k" from being a question in the first place.
        const kinds = (state.kinds ?? []).filter((kind) => kind.tokens > 0)
        // "tool schemas" is not a skill: say it on the card so a 3k skill block
        // next to a 84k prompt does not read as a contradiction.
        const labels = { skills: t('skills'), tools: t('tools'), prompts: t('sections'), rules: t('instructions') }
        const toolsKind = (state.kinds ?? []).find((kind) => kind.id === 'tools')
        const topTools = (snapshot.groups ?? []).filter((group) => group.channel === 'tools')[0]
        return h(
          'div',
          { className: 'ci-card ci-skills' },
          h(
            'div',
            { className: 'ci-skills-head' },
            h('div', { className: 'ci-skills-num' }, h('b', null, String(state.total)), h('span', null, t('skillsUnit'))),
            h(
              'div',
              { className: 'ci-skills-text' },
              h('div', { className: 'k' }, t('skillsCallout')),
              h(
                'div',
                { className: 's' },
                t('skillsLine', {
                  tokens: token(state.catalogTokens),
                  share: state.catalogShare,
                  avg: token(state.averageTokens ?? 0),
                  providers: state.providers ?? 0,
                }),
              ),
            ),
            h(
              'button',
              { type: 'button', className: 'ci-btn', onClick: () => onFilter('skills'), title: t('skillsJump') },
              t('skillsManage'),
            ),
          ),
          kinds.length > 0
            ? h(
                'div',
                { className: 'ci-kinds' },
                h('span', { className: 'lbl' }, t('kindsLabel')),
                kinds.map((kind) =>
                  h(
                    'button',
                    {
                      key: kind.id,
                      type: 'button',
                      className: 'ci-kind' + (kind.id === 'skills' ? ' on' : ''),
                      'aria-pressed': kind.id === 'skills' ? 'true' : 'false',
                      title: `${labels[kind.id] ?? kind.id} · ${kind.count} ${t('items')} · ${digits(kind.tokens)} token`,
                      onClick: () => onFilter(kind.id),
                    },
                    labels[kind.id] ?? t(kind.id),
                    h('b', null, token(kind.tokens)),
                    h('span', { className: 'p' }, `${kind.share}%`),
                  ),
                ),
              )
            : null,
          rows.length > 0
            ? h(
                'div',
                { className: 'ci-skills-providers' },
                rows.map((row) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ci-skills-provider',
                      key: row.provider,
                      title: `${row.provider} · ${row.count} ${t('items')} · ${digits(row.tokens)} token`,
                      onClick: () => onFilter('skills'),
                    },
                    h('span', { className: 'n' }, row.provider),
                    h('span', { className: 'ci-bar-track' }, h('span', { className: 'ci-bar-fill', style: { width: `${Math.max(3, (row.tokens / providerMax) * 100)}%`, background: COLOR.skills } })),
                    h('span', { className: 't' }, `${row.count} · ${token(row.tokens)}`),
                  ),
                ),
              )
            : null,
          state.truncated > 0
            ? h('div', { className: 'ci-skills-note' }, t('truncatedHint', { count: state.truncated }))
            : null,
          heaviest !== null && heaviest !== undefined
            ? h('div', { className: 'ci-skills-note' }, t('heaviestSkill', { name: heaviest.name, tokens: token(heaviest.tokens) }))
            : null,
          toolsKind !== undefined && toolsKind.tokens > state.catalogTokens
            ? h(
                'div',
                { className: 'ci-skills-note' },
                t('kindsNote', {
                  tools: token(toolsKind.tokens),
                  top: topTools === undefined ? '—' : topTools.label,
                  topTokens: topTools === undefined ? '—' : token(topTools.tokens),
                }),
              )
            : null,
        )
      }

      function Kpis({ snapshot, t, trend }) {
        const totals = snapshot.totals
        const policy = snapshot.policy
        const view = snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals : totals
        const context = snapshot.context || null
        const trendValues = (trend || []).map((point) => point.v)
        const windowKnown = context !== null && context.window !== null && context.used !== null
        const budget = Number(policy.budget && policy.budget.tokens) || 0
        const overBudget = budget > 0 && view.tokens > budget
        const rows = [
          {
            key: 'total',
            value: token(view.tokens),
            sub: `${digits(view.chars)} ${t('chars')} · ${view.count === undefined ? snapshot.items.length : view.count} ${t('items')}`,
            spark: true,
          },
          {
            key: 'window',
            value: windowKnown
              ? h(
                  'span',
                  { className: 'ci-kpi-num' },
                  h('span', null, token(context.used)),
                  h('span', { className: 'u' }, '/'),
                  h('span', { className: 'u' }, token(context.window)),
                )
              : '—',
            sub: windowKnown ? `${context.occupancy}% · ${t('remain')} ${token(context.remaining)}` : t('noWindow'),
            tone: windowKnown && context.tone !== undefined ? context.tone : 'unknown',
            title: windowKnown ? t('v2.windowHint2') : t('noWindowHint'),
          },
          {
            key: 'savable',
            value: token(view.savableTokens),
            sub: `${view.savablePercent}% · ${t('shareOf')}`,
          },
          {
            key: 'budget',
            value: budget > 0 ? token(budget) : '—',
            sub:
              budget > 0
                ? overBudget
                  ? t('v2.budgetOver', { tokens: token(view.tokens - budget) })
                  : t('v2.budgetUnder', { tokens: token(budget - view.tokens) })
                : t('v2.noBudget'),
            tone: overBudget ? 'danger' : undefined,
            title: t('budgetHint'),
          },
        ]
        const sparkLabel = trendValues.length > 1 ? t('trendLabel', { min: token(Math.min(...trendValues)), max: token(Math.max(...trendValues)) }) : ''
        return h(
          'div',
          { className: 'ci-kpis' },
          rows.map((row) =>
            h(
              'div',
              { className: 'ci-kpi' + (row.tone && row.tone !== 'ok' && row.tone !== 'unknown' ? ` tone-${row.tone}` : ''), key: row.key, title: row.title || null },
              h('div', { className: 'k' }, t(row.key)),
              h('div', { className: 'v' }, row.value),
              row.spark ? h(Sparkline, { values: trendValues, width: 200, height: 18, label: sparkLabel }) : null,
              h('div', { className: 's', title: row.sub }, row.sub),
            ),
          ),
        )
      }

      // Where the money actually goes: the next request measured against the
      // model's window, split the way the host splits it. One line, not a card:
      // the headline percentage already lives in the KPI above it, and a nearly
      // empty bar inside a tall card read as wasted space.
      function RequestStrip({ snapshot, t }) {
        const context = snapshot.context
        if (context === undefined || context === null) return null
        const windowKnown = context.window !== null && context.used !== null
        const breakdown = context.breakdown
        const compaction = context.compaction || null
        const hasCompaction = compaction !== null && (compaction.count > 0 || compaction.prunes > 0)
        if (!windowKnown && breakdown === null && !hasCompaction) return null

        const window = windowKnown ? context.window : 0
        const segments = []
        if (windowKnown && breakdown !== null) {
          const parts = [
            ['system', breakdown.system],
            ['tools', breakdown.tools],
            ['messages', breakdown.messages],
          ]
          let usedByParts = 0
          for (const [key, value] of parts) {
            usedByParts += value
            segments.push({ key, value: Math.min(value, window) })
          }
          // The breakdown is a heuristic and can exceed or fall short of the
          // provider figure; the leftover stays visible as unaccounted space.
          const leftover = Math.max(0, window - Math.min(window, usedByParts))
          if (leftover > 0) segments.push({ key: 'free', value: leftover })
        } else if (windowKnown) {
          segments.push({ key: 'used', value: context.used })
          segments.push({ key: 'free', value: Math.max(0, window - context.used) })
        } else if (breakdown !== null) {
          // No capacity yet, but the composition is still measured: scale the
          // bar to the request itself instead of drawing an empty window.
          segments.push({ key: 'system', value: breakdown.system })
          segments.push({ key: 'tools', value: breakdown.tools })
          segments.push({ key: 'messages', value: breakdown.messages })
        }
        const sum = segments.reduce((total, segment) => total + segment.value, 0) || 1

        return h(
          'div',
          { className: 'ci-strip' + (context.tone && context.tone !== 'ok' && context.tone !== 'unknown' ? ` tone-${context.tone}` : '') },
          h('span', { className: 'k' }, t('requestComposition')),
          segments.length > 1
            ? h(
                'span',
                { className: 'ci-window-bar', role: 'img', 'aria-label': windowKnown ? t('windowBarLabel', { pct: context.occupancy }) : t('requestComposition') },
                segments.map((segment) =>
                  h('span', {
                    key: segment.key,
                    style: { width: `${Math.max(1, (segment.value / sum) * 100)}%`, background: WINDOW_COLOR[segment.key] || 'var(--ci-line2)' },
                  }),
                ),
              )
            : null,
          h(
            'span',
            { className: 'rt', title: windowKnown ? t('windowHint') : t('noWindowHint') },
            windowKnown ? `${t('remain')} ${token(context.remaining)} (${context.occupancy}%)` : t('noWindow'),
          ),
          breakdown !== null
            ? h(
                'span',
                { className: 'lg' },
                [
                  ['system', t('systemPart'), breakdown.system],
                  ['tools', t('toolsPart'), breakdown.tools],
                  ['messages', t('messagesPart'), breakdown.messages],
                ].map(([key, label, value]) =>
                  h(
                    'span',
                    { className: 'item', key, title: `${label} · ${digits(value)} token` },
                    h('i', { 'aria-hidden': 'true', style: { background: WINDOW_COLOR[key] } }),
                    label,
                    ' ',
                    h('b', null, token(value)),
                  ),
                ),
              )
            : null,
          hasCompaction
            ? h(
                'span',
                { className: 'rt', title: t('compactionHint') },
                t('compactionLine', { count: compaction.count + compaction.prunes, saved: token(compaction.saved) }),
              )
            : null,
          compaction !== null && compaction.failures > 0 ? h('span', { className: 'rt warn' }, t('compactionFailed', { count: compaction.failures })) : null,
        )
      }

      // First-turn injection by channel. Labelled, because the window card
      // above it is also a bar and two unlabelled bars read as one control.
      function Composition({ snapshot, t, filter, onFilter }) {
        const channels = snapshot.effective && snapshot.effective.channels ? snapshot.effective.channels : snapshot.channels
        const total = (snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals.tokens : snapshot.totals.tokens) || 1
        return h(
          'div',
          { className: 'ci-composition' },
          h('div', { className: 'ci-window-head' }, h('h2', null, t('injectionComposition'))),
          h(
            'div',
            { className: 'ci-bar' },
            channels
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
            channels.map((channel) =>
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
                ` · ${pctText(channel.tokens, total)}`,
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
              h(Switch, {
                on: channelEnabled(snapshot, channel),
                onChange: (next) => act({ kind: 'channel', channel, enabled: next }, `${next ? t('turnedOn') : t('turnedOff')} ${t(channel)}`),
                title: t(channel),
              }),
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

      function presetLabel(t, name) {
        if (name === 'all') return t('presetAll')
        if (name === 'minimal') return t('presetMinimal')
        if (name === 'custom') return t('custom')
        return name
      }

      function groupLabelOf(t, group) {
        const dict = t.groupNames || {}
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

      // Inline match highlighting for search. Named HitMark because `Highlight`
      // is a DOM global (CSS Custom Highlight API) and would be shadowed badly.
      function HitMark({ text, needle }) {
        const value = String(text)
        if (!needle) return value
        const at = value.toLowerCase().indexOf(needle)
        if (at < 0) return value
        return [value.slice(0, at), h('mark', { className: 'ci-hit', key: 'hit' }, value.slice(at, at + needle.length)), value.slice(at + needle.length)]
      }

      // Shares are always of the injection that will actually happen: the
      // effective total, not the all-on one. Under an old policy the two differ
      // by 5×, and a percentage of the wrong denominator is how "REA 79.6%"
      // ended up sitting next to a 17k total.
      function effectiveTotalOf(snapshot) {
        return Math.max(1, (snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals.tokens : snapshot.totals.tokens) || 1)
      }

      function ItemRow({ item, t, snapshot, isOn, onToggle, busy, nested, needle, planned, previewOpen, onPreview }) {
        const label = nameOf(t, item)
        const locked = item.locked === true
        const showRaw = !snapshot.settings || snapshot.settings.showRawNames !== false
        const on = isOn(item)
        return h(
          'div',
          { className: 'ci-row' + (locked ? ' locked' : '') + (nested === true ? ' ci-row-nested' : '') + (on ? '' : ' ci-row-off'), key: itemKey(item) },
          h(
            'div',
            { className: 'n', title: `${item.name} · ${item.tokens} token` },
            onPreview === undefined
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ci-caret-btn',
                    'aria-expanded': previewOpen === true ? 'true' : 'false',
                    'aria-label': previewOpen === true ? t('v2.collapsePreview') : t('v2.expandPreview'),
                    title: previewOpen === true ? t('v2.collapsePreview') : t('v2.expandPreview'),
                    onClick: (event) => {
                      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                      onPreview(item)
                    },
                  },
                  '▸',
                ),
            h(HitMark, { text: label, needle }),
            planned ? h('span', { className: 'ci-tag', title: t('outsideBudgetHint') }, t('outsideBudget')) : null,
            !on && !locked ? h('span', { className: 'ci-tag' }, t('turnedOff')) : null,
            item.offClosed === true ? h('span', { className: 'ci-tag ci-tag-closed', title: t('closedRestoreHint') }, t('closedBadge')) : null,
            showRaw && label !== item.name ? h('span', { className: 'id' }, item.name) : null,
          ),
          h('div', { className: 'ci-about', title: typeof item.preview === 'string' ? item.preview : '' }, typeof item.preview === 'string' ? item.preview : ''),
          h('div', { className: 'badge' }, h(Dot, { channel: item.channel }), t(item.channel)),
          h('div', { className: 'num' }, digits(item.tokens)),
          h('div', { className: 'num' }, on ? `${pctText(item.tokens, effectiveTotalOf(snapshot))}` : '—'),
          locked
            ? h('span', { className: 'ci-lock', title: t('lockedHint') }, t('locked'))
            : h(Switch, { on, disabled: busy, onChange: (next) => onToggle(item, next), title: item.name }),
        )
      }

      // The inline preview answers "what is this row" before the drawer has to
      // load 200KB over the wire; the drawer is still the only place with the
      // full text. Pure text, never HTML.
      function ItemPreview({ item, snapshot, t, onOpenContent }) {
        const preview = typeof item.preview === 'string' && item.preview.trim().length > 0 ? item.preview : null
        return h(
          'div',
          { className: 'ci-row-preview', role: 'group', 'aria-label': `${t('v2.previewLabel')} · ${item.name}` },
          h('p', { className: 'pv' }, preview === null ? t('v2.noPreview') : preview),
          h(
            'div',
            { className: 'meta' },
            h(Dot, { channel: item.channel }),
            h('span', null, t(item.channel)),
            h('span', null, `${digits(item.tokens)} ${t('tokens')}`),
            h('span', null, `${pctText(item.tokens, effectiveTotalOf(snapshot))}`),
            item.locked === true ? h('span', { className: 'ci-badge' }, t('locked')) : null,
          ),
          onOpenContent === undefined
            ? null
            : h('div', { className: 'actions' }, h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: () => onOpenContent(item) }, t('v2.openContent'))),
        )
      }

      // Where a list entry comes from. The policy is a *default for new
      // sessions*, not the state of the running one: an already-open session
      // keeps injecting everything until it is recreated (the host never
      // rewrites a live assembly), which is exactly what the user sees in the
      // transcript. Two scopes, two questions, no guessing:
      //   默认策略 — what a session created now would receive (classic view)
      //   本会话   — what the session on screen is actually sending right now
      function buildItems(snapshot, filter, scope) {
        const policyOn = (item) => {
          const channel = snapshot.policy.channels[item.channel]
          if (channel === undefined || channel.mode === 'all') return true
          if (channel.mode === 'only') return channel.names.indexOf(item.name) >= 0
          return channel.names.indexOf(item.name) < 0
        }

        const rows = snapshot.items.map((item) => ({
          ...item,
          // The host now stamps items[].on; prefer it when present so the list
          // and the ranking agree with the effective projection exactly.
          on: scope === 'session' ? true : typeof item.on === 'boolean' ? item.on : policyOn(item),
          used: true,
        }))
        // A closed item keeps its remembered size so it can be switched back
        // from the same list instead of from a separate card — the classic
        // "I closed REA and now I cannot open it again" trap.
        for (const item of snapshot.closed || []) {
          if (item.unknown === true) continue
          rows.push({ ...item, locked: false, on: scope === 'session' ? true : false, used: false, offClosed: true })
        }
        return rows.filter((item) => filter === 'all' || item.channel === filter)
      }

      function ItemsTable({ snapshot, t, filter, setFilter, onToggle, onGroup, onUndo, busy, act, v2, onOpenContent }) {
        const [query, setQuery] = useState('')
        const [view, setView] = useStoredState('view', 'group')
        const [scope, setScope] = useStoredState('scope', 'global')
        const [onlySwitchable, setOnlySwitchable] = useStoredState('onlySwitchable', false)
        const [sort, setSort] = useStoredState('itemSort', 'tokens:desc')
        const [sortKey, sortDir] = String(sort).split(':')
        const [expanded, setExpanded] = useState({})
        const [peek, setPeek] = useState({})
        const [suite, setSuite] = useState(null)
        const deferredQuery = useDeferredValue(query)
        const searchRef = useRef(null)
        const clearAllFilters = () => {
          setQuery('')
          setFilter('all')
          setOnlySwitchable(false)
          setSuite(null)
        }
        const togglePeek = (item) => {
          const key = itemKey(item)
          setPeek((previous) => ({ ...previous, [key]: previous[key] !== true }))
        }

        // "/" jumps to search unless the user is already typing somewhere.
        useEffect(() => {
          const onKeyDown = (event) => {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
            const target = event.target
            const tag = target && target.tagName ? target.tagName.toLowerCase() : ''
            if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) return
            event.preventDefault()
            if (searchRef.current) searchRef.current.focus()
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }, [])
        const needle = deferredQuery.trim().toLowerCase()
        const plannedKeys = useMemo(() => {
          const plan = snapshot.policy.plan
          if (!plan || !Array.isArray(plan.drop) || snapshot.policy.budget.tokens <= 0) return new Set()
          return new Set(plan.drop.map((entry) => entry.channel + ':' + entry.name))
        }, [snapshot.policy])
        const items = useMemo(() => {
          const needle = deferredQuery.trim().toLowerCase()
          const names = t.names || {}
          return buildItems(snapshot, filter, scope)
            .filter((item) => (onlySwitchable ? item.locked !== true : true))
            .filter((item) => (suite === null ? true : String(item.groupLabel !== undefined && item.groupLabel !== null ? item.groupLabel : item.group) === suite))
            .filter((item) => {
              if (needle.length === 0) return true
              const label = names[item.name] || NAMES_ZH[item.name] || ''
              return item.name.toLowerCase().indexOf(needle) >= 0 || label.toLowerCase().indexOf(needle) >= 0
            })
            .slice()
            .sort((left, right) => {
              const compare =
                sortKey === 'name'
                  ? left.name.localeCompare(right.name)
                  : sortKey === 'channel'
                    ? left.channel.localeCompare(right.channel) || left.name.localeCompare(right.name)
                    : left.tokens - right.tokens || left.name.localeCompare(right.name)
              return sortDir === 'asc' ? compare : -compare
            })
        }, [snapshot, filter, scope, onlySwitchable, deferredQuery, t, sortKey, sortDir, suite])

        // In the session scope nothing is blocked by the policy: the running
        // session already has it all, so every row reads as on.
        const isOn = (item) => (scope === 'session' ? true : item.on === true)

        const groups = useMemo(() => {
          const map = new Map()
          for (const item of items) {
            // Same suite may own items in several channels (REA's tools plus its
            // prompt section); merge by label so it reads as one switch.
            const key = String(item.groupLabel ?? item.group).toLowerCase()
            const entry = map.get(key) ?? {
              id: key,
              channel: item.channel,
              label: item.groupLabel,
              channels: [],
              parts: [],
              items: [],
              tokens: 0,
              savableTokens: 0,
            }
            if (!entry.channels.includes(item.channel)) entry.channels.push(item.channel)
            if (!entry.parts.some((part) => part.channel === item.channel && part.group === item.group)) {
              entry.parts.push({ channel: item.channel, group: item.group })
            }
            entry.items.push(item)
            entry.tokens += item.tokens
            if (!item.locked) entry.savableTokens += item.tokens
            map.set(key, entry)
          }
          const rows = [...map.values()]
          return rows.sort((left, right) => {
            const compare =
              sortKey === 'name'
                ? String(left.label).localeCompare(String(right.label))
                : sortKey === 'channel'
                  ? String(left.channel).localeCompare(String(right.channel)) || left.tokens - right.tokens
                  : left.tokens - right.tokens || String(left.label).localeCompare(String(right.label))
            return sortDir === 'asc' ? compare : -compare
          })
        }, [items, sortKey, sortDir, sort])

        const groupState = (group) => {
          const unlocked = group.items.filter((item) => !item.locked)
          if (unlocked.length === 0) return { on: true, mixed: false, disabled: true }
          const onCount = unlocked.filter(isOn).length
          return { on: onCount === unlocked.length, mixed: onCount > 0 && onCount < unlocked.length, disabled: false }
        }

      // In each scope, a suite whose rows are mixed or missing needs a
      // different repair: the session scope can add back a suite the policy
      // closed, but only by the exact channel:name rows the policy excludes —
      // so the restore reads the excluded names back from the policy itself
      // instead of guessing from labels.
      function closedNamesFor(snapshot, label) {
        const wanted = String(label).toLowerCase()
        const out = []
        for (const [channel, state] of Object.entries(snapshot.policy.channels || {})) {
          if (state.mode !== 'except') continue
          for (const name of state.names) {
            const labelOf = (name) => (/^mcp:([^:]+)$/.exec(name) || /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name) || []).at(1)
            if (String(labelOf(name) || name).toLowerCase() === wanted) out.push({ channel, name })
          }
        }
        return out
      }

        const toggleGroup = (group) => {
          const state = groupState(group)
          if (state.disabled) return
          onGroup(group, !state.on)
        }

        const toggleExpanded = (id) => setExpanded((previous) => ({ ...previous, [id]: previous[id] !== true }))

        const sortHeader = (key, label, alignRight) => {
          const active = sortKey === key
          const nextDir = active ? (sortDir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'channel' ? 'asc' : 'desc'
          return h(
            'button',
            {
              type: 'button',
              className: 'ci-sort' + (active ? ' active' : ''),
              style: alignRight ? { justifyContent: 'flex-end' } : null,
              'aria-sort': active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
              title: `${label} · ${t('sortHint')}`,
              onClick: () => setSort(key + ':' + nextDir),
            },
            label,
            h('span', { className: 'ci-arrow', 'aria-hidden': 'true' }, active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'),
          )
        }

        const effective = snapshot.effective && snapshot.effective.channels ? snapshot.effective.channels : snapshot.channels
        const effectiveTotal = Math.max(1, (snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals.tokens : snapshot.totals.tokens) || 1)
        const viewSavablePercent = snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals.savablePercent : snapshot.totals.savablePercent
        // The ranking above the list is about the whole snapshot, never about
        // the current filter: filtering the table must not hide the big suites.
        const topSuites = (() => {
          const map = new Map()
          for (const group of snapshot.groups) {
            const label = String(group.label !== undefined && group.label !== null ? group.label : group.id)
            const key = label.toLowerCase()
            const entry = map.get(key) || { id: key, label, channel: group.channel, tokens: 0, effectiveTokens: 0, items: [] }
            entry.tokens += Number(group.tokens) || 0
            map.set(key, entry)
          }
          for (const item of snapshot.items) {
            const key = String(item.groupLabel !== undefined && item.groupLabel !== null ? item.groupLabel : item.group).toLowerCase()
            const entry = map.get(key)
            if (entry === undefined) continue
            // Prefer the host's stamped on; fall back to the policy projection so
            // the ranking still works on a v1 snapshot without the field.
            const on = typeof item.on === 'boolean' ? item.on : policyItemOn(snapshot, item)
            if (on) entry.effectiveTokens += item.tokens
          }
          return [...map.values()].sort((left, right) => right.tokens - left.tokens).slice(0, 6)
        })()
        const suiteMax = topSuites.reduce((max, group) => Math.max(max, group.tokens), 1)

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: '1 1 auto' } },
          // Two peer cards, not one mixed card: composition is a "what is in
          // here" question, the suite ranking is a "what should I switch off"
          // question. Each gets its own header and its own column.
          h(
            'div',
            { className: 'ci-manage-overview' },
            h(
              'div',
              { className: 'ci-card ci-overview-card' },
              h(
                'div',
                { className: 'ci-cardhead' },
                h('h2', null, t('v2.overviewComposition')),
                h('span', { className: 'sp' }),
                h('span', { className: 'hint' }, `${t('total')} ${token(effectiveTotal)}`),
              ),
              h(
                'div',
                { className: 'ci-donut' },
                h(Donut, { rows: effective, t, size: 124, centerSub: `${viewSavablePercent}% ${t('savable')}` }),
                h(
                  'div',
                  { className: 'ci-donut-legend' },
                  effective
                    .filter((channel) => channel.tokens > 0)
                    .map((channel) =>
                      h(
                        'div',
                        { className: 'ci-donut-row', key: channel.id },
                        h(Dot, { channel: channel.id }),
                        h('span', { className: 'n' }, t(channel.id)),
                        h('b', null, token(channel.tokens)),
                        h('span', { className: 'p' }, `${pctText(channel.tokens, effectiveTotal)}`),
                      ),
                    ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'ci-card ci-overview-card' },
              h(
                'div',
                { className: 'ci-cardhead' },
                h('h2', null, t('v2.heaviestTitle')),
                h('span', { className: 'sp' }),
                h('span', { className: 'hint' }, `${t('topSuites')} · ${topSuites.length} · ${t('v2.closedLight')}`),
              ),
              h(
                'div',
                { className: 'ci-bars' },
                topSuites.map((group, index) => {
                  const closedTokens = Math.max(0, group.tokens - group.effectiveTokens)
                  const onPercent = group.tokens > 0 ? Math.max(0, Math.min(100, (group.effectiveTokens / group.tokens) * 100)) : 0
                  return h(
                    'button',
                    {
                      type: 'button',
                      className: 'ci-barrow ci-barrow-btn' + (group.effectiveTokens === 0 ? ' off' : ''),
                      key: group.id,
                      title: `${groupLabelOf(t, group)} · ${t('total')} ${digits(group.tokens)} · ${t('after')} ${digits(group.effectiveTokens)} · ${t('v2.closedLight')}`,
                      onClick: () => setSuite(groupLabelOf(t, group)),
                    },
                    h(
                      'span',
                      { className: 'n' },
                      groupLabelOf(t, group),
                    ),
                    // The track spans the suite's full (all-on) size; the solid
                    // part is what stays on and the faded part is what the
                    // policy switched off, so an all-off suite still reads as a
                    // long bar instead of an empty rail.
                    h(
                      'span',
                      { className: 'ci-bar-track', style: { width: `${Math.max(2, (group.tokens / suiteMax) * 100)}%`, minWidth: 3 } },
                      onPercent > 0
                        ? h('span', { className: 'ci-bar-fill', style: { width: `${onPercent}%`, background: COLOR[group.channel] } })
                        : null,
                      closedTokens > 0
                        ? h('span', { className: 'ci-bar-closed', style: { width: `${Math.max(3, 100 - onPercent)}%`, background: COLOR[group.channel] } })
                        : null,
                    ),
                    h(
                      'span',
                      { className: 't' },
                      group.effectiveTokens === 0
                        ? `${token(group.tokens)} · ${t('turnedOff')}`
                        : `${token(group.effectiveTokens)} · ${pctText(group.effectiveTokens, effectiveTotal)}`,
                    ),
                  )
                }),
              ),
            ),
          ),
          // Two rows, not one: scope + search + view + the filter menu on top,
          // the active filters (when any) on a second line. Eight chips in a row
          // was the densest thing in the panel and none of them was the primary
          // action.
          h(
            'div',
            { className: 'ci-toolbar' },
            h(
              // The default view answers "what does a new session get"; the
              // session view answers "what is this conversation actually
              // sending". A policy never rewrites a live session, so both are
              // true at once and the user must be able to see which is which.
              'div',
              { className: 'ci-seg', role: 'tablist', 'aria-label': t('scopeLabel') },
              [
                ['global', t('scopeGlobal'), t('scopeGlobalHint')],
                ['session', t('scopeSession'), t('scopeSessionHint')],
              ].map(([key, label, hint]) =>
                h(
                  'button',
                  {
                    key,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': scope === key ? 'true' : 'false',
                    className: scope === key ? 'on' : '',
                    title: hint,
                    onClick: () => setScope(key),
                  },
                  label,
                ),
              ),
            ),
            h('input', {
              ref: searchRef,
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
            h('select', {
              className: 'ci-select',
              value: filter,
              'aria-label': t('filterLabel'),
              title: t('filterLabel'),
              onChange: (event) => setFilter(event.target.value),
            }, ['all'].concat(CHANNELS).map((channel) => h('option', { key: channel, value: channel }, channel === 'all' ? t('all') : t(channel)))),
            h(
              'div',
              { className: 'ci-seg ci-viewopts' },
              [
                ['only', onlySwitchable, t('onlySwitchable'), t('onlySwitchableHint'), () => setOnlySwitchable(!onlySwitchable), onlySwitchable ? 'true' : 'false'],
                ['expand', false, t('expandAll'), t('expandAll'), () => {
                  const next = {}
                  for (const group of groups) next[group.id] = true
                  setExpanded(next)
                }, 'false', view === 'group'],
                ['collapse', false, t('collapseAll'), t('collapseAll'), () => setExpanded({}), 'false', view === 'group'],
              ].filter(([key, , , , , , visible]) => key === 'only' || visible !== false).map(([key, on, label, hint, onClick, pressed]) =>
                h(
                  'button',
                  { key, type: 'button', className: on ? 'on' : '', title: hint || label, 'aria-pressed': pressed, onClick },
                  label,
                ),
              ),
            ),
          ),
          // The filter bar is always visible: every active exclusion is a chip
          // with an ×, and one control clears the whole set. Clicking a suite
          // name adds its chip here, so "why is this list short" is answerable.
          h(
            'div',
            { className: 'ci-filterbar', role: 'group', 'aria-label': t('v2.filters') },
            h('span', { className: 'lbl' }, t('activeFilters')),
            filter === 'all' ? null : h(FilterChip, { label: t(filter), onClear: () => setFilter('all') }),
            suite === null ? null : h(FilterChip, { label: suite, title: t('v2.filterSuite', { label: suite }), onClear: () => setSuite(null) }),
            onlySwitchable ? h(FilterChip, { label: t('onlySwitchable'), onClear: () => setOnlySwitchable(false) }) : null,
            query.trim().length > 0 ? h(FilterChip, { label: `「${query.trim()}」`, onClear: () => setQuery('') }) : null,
            filter === 'all' && suite === null && !onlySwitchable && query.trim().length === 0
              ? h('span', { className: 'hint' }, t('v2.noFilters'))
              : h('button', { type: 'button', className: 'ci-filterclear', onClick: clearAllFilters }, t('v2.clearAll')),
          ),
          h(
            'div',
            { className: 'ci-table', role: 'group', 'aria-label': t('items') + ' · ' + items.length },
            h(
              'div',
              { className: 'ci-thead' },
              h('div', null, sortHeader('name', t('name'))),
              h('div', { className: 'ci-about' }, t('about')),
              h('div', null, sortHeader('channel', t('channel'))),
              h('div', { style: { textAlign: 'right' } }, sortHeader('tokens', t('tokens'), true)),
              h('div', { style: { textAlign: 'right' } }, sortHeader('share', t('share'), true)),
              h('div', { style: { textAlign: 'right' } }, t('switch')),
            ),
            items.length === 0
              ? h(
                  'div',
                  { className: 'ci-empty' },
                  h('div', null, query.trim().length > 0 ? t('noMatch') : t('empty')),
                  query.trim().length > 0 || filter !== 'all' || onlySwitchable || suite !== null
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'ci-btn',
                          style: { marginTop: 8 },
                          onClick: clearAllFilters,
                        },
                        t('clearFilters'),
                      )
                    : null,
                )
              : view === 'group'
                ? groups.map((group) => {
                    const state = groupState(group)
                    const open = expanded[group.id] === true
                    const groupEffective = group.items.reduce((sum, item) => (isOn(item) ? sum + item.tokens : sum), 0)
                    const groupSaved = Math.max(0, group.tokens - groupEffective)
                    const suiteLabel = groupLabelOf(t, group)
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
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'ci-suitename',
                              title: t('v2.filterSuite', { label: suiteLabel }),
                              onClick: (event) => {
                                event.stopPropagation()
                                setSuite((previous) => (previous === suiteLabel ? null : suiteLabel))
                              },
                            },
                            h(HitMark, { text: suiteLabel, needle }),
                          ),
                          h('span', { className: 'id' }, `${group.items.length} ${t('items')}`),
                          groupSaved > 0 ? h('span', { className: 'ci-delta', title: t('v2.savedHint', { tokens: digits(groupSaved) }) }, '−' + token(groupSaved)) : null,
                          plannedKeys.size > 0 && group.items.filter((item) => plannedKeys.has(item.channel + ':' + item.name)).length > 0
                            ? h(
                                'span',
                                { className: 'ci-tag' },
                                `${group.items.filter((item) => plannedKeys.has(item.channel + ':' + item.name)).length} ${t('outsideBudget')}`,
                              )
                            : null,
                          state.on ? null : h('span', { className: 'ci-tag' }, state.mixed ? t('mixedOff') : t('turnedOff')),
                        ),
                        h(
                          'div',
                          { className: 'ci-about', title: `${group.items.length} ${t('items')} · ${(group.channels || [group.channel]).length > 1 ? t('mixed') : t(group.channel)}` },
                          `${group.items.length} ${t('items')} · ${(group.channels || [group.channel]).length > 1 ? t('mixed') : t(group.channel)}`,
                        ),
                        h(
                          'div',
                          { className: 'badge' },
                          (group.channels || [group.channel]).map((channel) => h(Dot, { key: channel, channel })),
                          (group.channels || [group.channel]).length > 1 ? t('mixed') : t(group.channel),
                        ),
                        h('div', { className: 'num' }, digits(group.tokens)),
                        h('div', { className: 'num' }, state.on ? `${pctText(group.tokens, effectiveTotal)}` : '—'),
                        h(Switch, { on: state.on, mixed: state.mixed, disabled: busy || state.disabled, onChange: () => toggleGroup(group), title: group.label }),
                      ),
                      open
                        ? group.items.flatMap((item) => {
                            const key = itemKey(item)
                            const openPeek = peek[key] === true
                            const rows = [
                              h(ItemRow, {
                                key,
                                item,
                                t,
                                snapshot,
                                isOn,
                                onToggle,
                                busy,
                                nested: true,
                                needle,
                                planned: plannedKeys.has(item.channel + ':' + item.name),
                                previewOpen: openPeek,
                                onPreview: v2 === true ? togglePeek : undefined,
                              }),
                            ]
                            if (v2 === true && openPeek) rows.push(h(ItemPreview, { key: key + ':preview', item, snapshot, t, onOpenContent }))
                            return rows
                          })
                        : null,
                    )
                  })
                : items.flatMap((item) => {
                    const key = itemKey(item)
                    const openPeek = peek[key] === true
                    const rows = [
                      h(ItemRow, {
                        key,
                        item,
                        t,
                        snapshot,
                        isOn,
                        onToggle,
                        busy,
                        needle,
                        planned: plannedKeys.has(item.channel + ':' + item.name),
                        previewOpen: openPeek,
                        onPreview: v2 === true ? togglePeek : undefined,
                      }),
                    ]
                    if (v2 === true && openPeek) rows.push(h(ItemPreview, { key: key + ':preview', item, snapshot, t, onOpenContent }))
                    return rows
                  }),
          ),
          snapshot.closedGroups && snapshot.closedGroups.length > 0
            ? h(
                'div',
                { className: 'ci-card' },
                h('h2', null, `${t('closedTitle')} · ${snapshot.closed.length} ${t('items')}`),
                h('div', { className: 'hint' }, t('closedHint')),
                h(
                  'div',
                  { className: 'ci-list' },
                  snapshot.closedGroups.map((group) =>
                    h(
                      'div',
                      { className: 'ci-mini', key: group.id },
                      h(Dot, { channel: group.channel }),
                      h('span', { className: 'n', title: group.label }, group.label),
                      h('span', { className: 't' }, `${group.items.length} ${t('items')}`),
                      h('span', { className: 't' }, group.tokens > 0 ? digits(group.tokens) : '—'),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'ci-btn',
                          onClick: () =>
                            act(
                              { kind: 'names', channel: group.channel, names: group.items.map((item) => item.name), enabled: true },
                              `${t('restoreGroup')} ${group.label}`,
                            ),
                        },
                        t('restoreGroup'),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'ci-note', style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(
              'span',
              null,
              (() => {
                const view = snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals : snapshot.totals
                const shown = groups.length
                const totalGroups = snapshot.groups.length
                return `${t('total')} ${digits(view.tokens)} · ${t('savable')} ${digits(view.savableTokens)} (${view.savablePercent}%) · ${shown !== totalGroups ? `${shown}/${totalGroups}` : String(shown)} ${t('groups')} · ${t('locked')} ${snapshot.locks.length}`
              })(),
            ),
            snapshot.undo && snapshot.undo.available
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ci-btn',
                    disabled: busy,
                    title: snapshot.undo.last || '',
                    style: { maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    onClick: () => onUndo(),
                  },
                  `${t('undo')}${snapshot.undo.last ? ` · ${snapshot.undo.last}` : ''}`,
                )
              : null,
          ),
        )
      }

      // ------------------------------------------------------------ v2 surfaces

      // Resolve a health check's "switch this suite" action to the exact
      // (channel, group id) pairs /action expects. A suite can span channels,
      // so the resolution returns every matching part rather than guessing one.
      function resolveGroupParts(snapshot, channel, key) {
        const wanted = String(key === undefined || key === null ? '' : key).toLowerCase()
        if (wanted.length === 0) return []
        const parts = []
        for (const item of snapshot.items) {
          if (item.channel !== channel) continue
          const group = String(item.group === undefined || item.group === null ? '' : item.group)
          if (group.length === 0) continue
          const lower = group.toLowerCase()
          const label = String(item.groupLabel === undefined || item.groupLabel === null ? group : item.groupLabel).toLowerCase()
          const tail = lower.slice(lower.lastIndexOf(':') + 1)
          if (label === wanted || lower === wanted || tail === wanted || lower.endsWith(':' + wanted)) {
            if (!parts.some((entry) => entry.group === group)) parts.push({ channel, group })
          }
        }
        return parts
      }

      function HealthStrip({ health, t, v2, snapshot, act, onOpenContent, onOpenTab }) {
        if (v2 !== true) return null
        const data = health && health.data !== null && health.data !== undefined ? health.data : null
        const checks = data !== null && Array.isArray(data.checks) ? data.checks : []
        const summary = (data !== null && data.summary) || (snapshot !== null && snapshot.healthSummary) || null
        const counts = {
          high: Number(summary && summary.high) || 0,
          warn: Number(summary && summary.warn) || 0,
          info: Number(summary && summary.info) || 0,
        }
        const failed = health !== null && health.status === 'failed'
        const loading = (health === null || health.status === 'loading' || health.status === 'refreshing') && data === null
        const visible = checks.filter((check) => check !== null && typeof check === 'object').slice(0, 6)
        const rest = checks.length - visible.length

        const runAction = (check) => {
          const action = check.action
          if (action === null || action === undefined || typeof action !== 'object') return
          const payload = action.payload !== null && typeof action.payload === 'object' ? action.payload : {}
          if (action.kind === 'switch-group') {
            const channel = String(payload.channel || '')
            const parts = resolveGroupParts(snapshot, channel, payload.group !== undefined ? payload.group : payload.key !== undefined ? payload.key : payload.name)
            if (parts.length === 0) return
            const enabled = payload.op !== 'off' && payload.enabled !== false
            act({ kind: 'groups', groups: parts, enabled }, `${enabled ? t('turnedOn') : t('turnedOff')} ${payload.key || ''}`)
            return
          }
          if (action.kind === 'set-budget') {
            onOpenTab('settings')
            return
          }
          if (action.kind === 'open-content') {
            if (payload.channel !== undefined && (payload.id !== undefined || payload.itemId !== undefined)) {
              onOpenContent({ channel: String(payload.channel), id: String(payload.id !== undefined ? payload.id : payload.itemId), name: payload.name })
            }
            return
          }
          if (action.kind === 'open-tab') {
            const raw = typeof payload.tab === 'string' ? payload.tab : ''
            const tab = raw === 'settings' ? 'settings' : raw === 'insights' || raw === 'stats' ? 'insights' : 'manage'
            onOpenTab(tab, payload.channel)
          }
        }

        const actionLabel = (action) => {
          if (action === null || action === undefined) return ''
          const known = ['switch-group', 'set-budget', 'open-content', 'open-tab'].indexOf(action.kind) >= 0
          return known ? t('health.action.' + action.kind) : t('v2.openContent')
        }

        return h(
          'div',
          { className: 'ci-health', role: 'group', 'aria-label': t('v2.health') },
          h(
            'div',
            { className: 'ci-health-head' },
            h('span', { className: 'ci-health-title' }, t('v2.health')),
            h(
              'span',
              { className: 'ci-health-counts' },
              // Zero levels are noise: only render severities that actually
              // have checks, joined with a middot (design review optional #9).
              [
                ['high', 'high', counts.high],
                ['warn', 'warn', counts.warn],
                ['info', 'info', counts.info],
              ]
                .filter(([, , value]) => Number(value) > 0)
                .map(([key, className, value], index) => [
                  index === 0 ? null : h('span', { key: key + ':sep', className: 'sep' }, '·'),
                  h('span', { key, className }, h('b', null, String(value)), key === 'high' ? t('v2.sevHigh') : key === 'warn' ? t('v2.sevWarn') : t('v2.sevInfo')),
                ])
                .flat(),
            ),
            data !== null && Number.isFinite(Number(data.checkedAt))
              ? h('span', { className: 'ci-inline-meta', style: { marginLeft: 'auto' } }, t('v2.healthChecked', { time: fullTime(data.checkedAt) }))
              : null,
          ),
          failed
            ? h(
                'div',
                { className: 'ci-errorbar', style: { marginTop: 6 } },
                h('span', null, `${t('health.failed')}：${errorText(health)}`),
                h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: health.reload }, t('v2.retry')),
              )
            : null,
          loading
            ? h('div', { className: 'ci-health-allclear' }, t('loading'))
            : null,
          !loading && data !== null && checks.length === 0
            ? h('div', { className: 'ci-health-allclear' }, t('v2.healthAllClear'))
            : null,
          visible.map((check, index) => {
            const severity = check.severity === 'high' ? 'high' : check.severity === 'warn' ? 'warn' : 'info'
            const params = check.params !== null && typeof check.params === 'object' ? check.params : {}
            // Different codes carry different params; fill the placeholders the
            // copy expects so a missing field reads as "—" and never as `{count}`.
            const text = t('health.' + String(check.code || ''), {
              label: params.label !== undefined ? params.label : '—',
              count: params.count !== undefined ? params.count : '—',
              share: params.share !== undefined ? params.share : '—',
              tokens: Number.isFinite(Number(params.tokens)) && Number(params.tokens) > 0 ? token(params.tokens) : '—',
            })
            return h(
              'div',
              { className: 'ci-health-row', key: `${check.code || 'check'}:${index}` },
              h('span', { className: 'sev ' + severity, 'aria-hidden': 'true' }),
              h(
                'span',
                { className: 'ci-health-text', title: text },
                text,
                severity !== 'info' && Number.isFinite(Number(params.tokens)) && Number(params.tokens) > 0
                  ? h('span', { className: 'ci-delta', title: t('v2.savedHint', { tokens: digits(params.tokens) }) }, '−' + token(params.tokens))
                  : null,
              ),
              check.action !== null && check.action !== undefined && typeof check.action === 'object'
                ? h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: () => runAction(check) }, actionLabel(check.action))
                : null,
            )
          }),
          rest > 0 ? h('div', { className: 'ci-health-allclear' }, t('v2.moreChecks', { count: rest })) : null,
        )
      }

      // apiVersion < 2 is not hidden silently: the card says what the host
      // returns, what the panel needs, and lets the user dismiss it.
      function V2Gate({ snapshot, t }) {
        const [dismissed, setDismissed] = useStoredState('v2GateDismissed', false)
        if (dismissed === true) return null
        const api = Number(snapshot !== null && snapshot !== undefined ? snapshot.apiVersion : 1) || 1
        return h(
          'div',
          { className: 'ci-gate', role: 'status' },
          h('h2', null, t('v2.gateTitle')),
          h('p', null, t('v2.gateBody')),
          h(
            'div',
            { className: 'kv' },
            h('span', null, t('v2.gateCurrent'), h('b', null, `v${api}`)),
            h('span', null, t('v2.gateMin'), h('b', null, `v${API_V2}`)),
          ),
          h('div', { className: 'actions' }, h('button', { type: 'button', className: 'ci-btn ci-primary', onClick: () => setDismissed(true) }, t('v2.gateDismiss'))),
        )
      }

      // The manage page mounts the health strip through this thin shell so the
      // /health request only happens while that tab is actually visible.
      function ManageHealth({ snapshot, t, sessionId, v2, act, onOpenContent, onOpenTab }) {
        const health = useHealth(sessionId, v2 === true)
        return h(HealthStrip, { health, t, v2, snapshot, act, onOpenContent, onOpenTab })
      }

      // Third control tier: range pills. Pills = "which slice of time", the seg
      // control = "which ordering/view", filter chips = "what is excluded".
      function RangePills({ value, options, onChange, label }) {
        return h(
          'div',
          { className: 'ci-pills', role: 'group', 'aria-label': label },
          options.map(([key, text]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                className: value === key ? 'on' : '',
                'aria-pressed': value === key ? 'true' : 'false',
                title: text,
                onClick: () => onChange(key),
              },
              text,
            ),
          ),
        )
      }

      // A trend with more than 40 points would compress bars into hairlines, so
      // range=all folds equal-count buckets into one overview screen instead of
      // scrolling horizontally. Channels stay null when no bucket row was
      // measured, so the striped "unknown" state is never faked as zero.
      function bucketTrend(points, limit) {
        if (points.length <= limit) return { rows: points, buckets: 0 }
        const size = Math.ceil(points.length / limit)
        const rows = []
        for (let index = 0; index < points.length; index += size) {
          const slice = points.slice(index, index + size)
          const total = slice.reduce((sum, point) => sum + (Number(point.total) || 0), 0)
          const effective = slice.reduce((sum, point) => sum + (Number(point.effective) || 0), 0)
          const saved = slice.reduce((sum, point) => sum + (Number(point.saved) || 0), 0)
          const measured = slice.filter((point) => point.channels !== null && point.channels !== undefined && typeof point.channels === 'object')
          let channels = null
          if (measured.length > 0) {
            channels = {}
            for (const channel of CHANNELS) channels[channel] = measured.reduce((sum, point) => sum + (Number(point.channels[channel]) || 0), 0)
          }
          const samples = slice.reduce((sum, point) => sum + (Number(point.samples) || 0), 0)
          const compactions = slice.reduce(
            (accumulator, point) => {
              const source = point.compactions || {}
              return { count: accumulator.count + (Number(source.count) || 0), freed: accumulator.freed + (Number(source.freed) || 0) }
            },
            { count: 0, freed: 0 },
          )
          rows.push({
            sessionId: 'bucket:' + index,
            at: Number(slice[slice.length - 1].at) || 0,
            firstAt: Number(slice[0].firstAt || slice[0].at) || 0,
            cwd: slice[slice.length - 1].cwd,
            scope: slice[slice.length - 1].scope,
            total,
            effective,
            saved,
            channels,
            source: slice.every((point) => point.source === 'log') ? 'log' : 'measured',
            samples,
            compactions,
            policy: slice[slice.length - 1].policy,
            bucketCount: slice.length,
          })
        }
        return { rows, buckets: rows.length }
      }

      function TrendChart({ points, t, range }) {
        const wrapRef = useRef(null)
        const width = useElementWidth(wrapRef, 720)
        const hatchId = useId()
        const source = Array.isArray(points) ? points : []
        const [hidden, setHidden] = useState([])
        const [hover, setHover] = useState(-1)
        const [pinned, setPinned] = useState(-1)
        const barRefs = useRef([])
        const bucketed = useMemo(() => bucketTrend(source, 40), [source])
        const data = bucketed.rows
        const overview = bucketed.buckets > 0
        const { useEffect: useEffectLocal } = React
        useEffectLocal(() => {
          if (pinned >= 0 && pinned >= data.length) setPinned(-1)
        }, [data.length, pinned])
        useEffectLocal(() => {
          if (pinned < 0) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') setPinned(-1)
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [pinned])

        const W = Math.max(320, Math.min(width, 1400))
        const pad = { l: 40, r: 10, t: 10, b: 24 }
        const plotH = 150
        const H = plotH + pad.t + pad.b
        const plotW = W - pad.l - pad.r
        const hiddenSet = new Set(hidden)
        const series = CHANNELS.filter((channel) => !hiddenSet.has(channel))
        const pointTotal = (point) => Math.max(0, Number(point.total) || 0)
        const maxTotal = data.reduce((max, point) => Math.max(max, pointTotal(point)), 1)
        const niceMax = (() => {
          const exponent = Math.pow(10, Math.floor(Math.log10(Math.max(1, maxTotal))))
          for (const step of [1, 2, 2.5, 5, 10]) {
            const candidate = step * exponent
            if (candidate >= maxTotal) return Math.round(candidate)
          }
          return Math.round(10 * exponent)
        })()
        const yMax = Math.max(1, niceMax)
        const slot = plotW / Math.max(1, data.length)
        const gap = 2
        const barW = Math.max(2, Math.min(14, slot - gap))
        const yOf = (value) => pad.t + plotH - (value / yMax) * plotH
        const xOf = (index) => pad.l + slot * index + slot / 2
        const segmentsOf = (point) => {
          const channels = point.channels
          if (channels === null || channels === undefined || typeof channels !== 'object') return [{ id: 'unknown', value: pointTotal(point) }]
          const out = []
          let sum = 0
          for (const channel of series) {
            const value = Math.max(0, Number(channels[channel]) || 0)
            if (value > 0) {
              out.push({ id: channel, value })
              sum += value
            }
          }
          const leftover = pointTotal(point) - sum
          if (leftover > 0) out.push({ id: 'unknown', value: leftover })
          return out
        }
        const unknown = data.some((point) => point.channels === null || point.channels === undefined)
        const hiddenCount = CHANNELS.length - series.length
        const gridValues = [0.25, 0.5, 0.75, 1].map((ratio) => yMax * ratio)
        const step = Math.max(1, Math.ceil(data.length / 6))
        const xTicks = data
          .map((point, index) => ({ index, point }))
          .filter(({ index }, position, list) => {
            if (index === 0) return true
            if (index === data.length - 1) {
              // The last tick owns the right edge; drop a neighbour that would
              // overlap it when the final bucket sits one step away.
              const previous = list[position - 1]
              return previous === undefined || index - previous.index >= Math.max(2, Math.ceil(step / 2))
            }
            return index % step === 0
          })
        const active = pinned >= 0 && pinned < data.length ? pinned : hover
        const tooltip = active >= 0 ? data[active] : null
        const labelOf = (point) => {
          const at = Number(point.firstAt || point.at) || 0
          return at > 0 ? fullTime(at) : '—'
        }

        if (data.length === 0) {
          return h(
            'div',
            { className: 'ci-empty-next' },
            h('span', null, t('trend.empty')),
            h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: () => window.location.reload() }, t('refresh')),
          )
        }

        const summaryLabel = t('trend.summary', {
          count: source.length,
          avg: token(source.reduce((sum, point) => sum + pointTotal(point), 0) / Math.max(1, source.length)),
          max: token(maxTotal),
        })

        return h(
          'div',
          { className: 'ci-trend' },
          h(
            'div',
            { className: 'ci-trend-wrap', ref: wrapRef, onClick: () => setPinned(-1) },
            h(
              'svg',
              {
                className: 'ci-trend-svg',
                viewBox: `0 0 ${W} ${H}`,
                width: W,
                height: H,
                role: 'group',
                'aria-label': summaryLabel,
              },
              h('title', null, t('trend.title')),
              h(
                'defs',
                null,
                h(
                  'pattern',
                  { id: hatchId, patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' },
                  h('rect', { width: 6, height: 6, fill: 'var(--ci-line2)' }),
                  h('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--ci-fg3)', strokeWidth: 1.5, opacity: 0.55 }),
                ),
              ),
              h(
                'g',
                { className: 'ci-trend-grid' },
                gridValues.map((tick) =>
                  h('line', { key: 'g' + tick, x1: pad.l, y1: yOf(tick), x2: W - pad.r, y2: yOf(tick), strokeDasharray: '2 4', strokeWidth: 0.5 }),
                ),
                h('line', { x1: pad.l, y1: yOf(0), x2: W - pad.r, y2: yOf(0), strokeWidth: 1 }),
              ),
              h(
                'g',
                { className: 'ci-trend-axis' },
                gridValues.map((tick) =>
                  h('text', { key: 'y' + tick, x: pad.l - 8, y: yOf(tick) + 3, textAnchor: 'end' }, token(tick)),
                ),
                h('text', { x: pad.l - 8, y: yOf(0) + 3, textAnchor: 'end' }, '0'),
              ),
              data.map((point, index) => {
                const segments = segmentsOf(point)
                let cursor = 0
                const center = xOf(index)
                const resolved = point.channels !== null && point.channels !== undefined
                const label = `${labelOf(point)} · ${digits(pointTotal(point))} token${resolved ? '' : ' · ' + t('trend.unknown')}`
                const dimmed = (pinned >= 0 || hover >= 0) && active !== index
                return h(
                  'g',
                  {
                    key: point.sessionId || 'p' + index,
                    ref: (node) => {
                      barRefs.current[index] = node
                    },
                    className: 'ci-trend-bar',
                    tabIndex: 0,
                    role: 'img',
                    'aria-label': label,
                    'aria-pressed': pinned === index ? 'true' : 'false',
                    onMouseEnter: () => setHover(index),
                    onMouseLeave: () => setHover(-1),
                    onFocus: () => setHover(index),
                    onBlur: () => setHover(-1),
                    onClick: (event) => {
                      event.stopPropagation()
                      setPinned((previous) => (previous === index ? -1 : index))
                    },
                    onKeyDown: (event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                        event.preventDefault()
                        const next = event.key === 'ArrowRight' ? index + 1 : index - 1
                        const node = barRefs.current[next]
                        if (node && typeof node.focus === 'function') node.focus()
                      } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setPinned((previous) => (previous === index ? -1 : index))
                      } else if (event.key === 'Escape') {
                        setPinned(-1)
                        if (event.target && typeof event.target.blur === 'function') event.target.blur()
                      }
                    },
                  },
                  h('rect', { className: 'ci-trend-hit', x: pad.l + slot * index, y: pad.t, width: slot, height: plotH }),
                  segments.map((segment) => {
                    const bottom = cursor
                    cursor += segment.value
                    const yTop = yOf(bottom + segment.value)
                    const height = Math.max(segment.value > 0 ? 1 : 0, yOf(bottom) - yTop)
                    const top = segment === segments[segments.length - 1]
                    return h('rect', {
                      key: segment.id,
                      x: center - barW / 2,
                      y: yTop,
                      width: barW,
                      height,
                      rx: top ? 2 : 0,
                      fill: segment.id === 'unknown' ? `url(#${hatchId})` : COLOR[segment.id],
                      opacity: dimmed ? 0.4 : 1,
                    })
                  }),
                  pinned === index ? h('rect', { x: center - barW / 2 - 2, y: pad.t, width: barW + 4, height: plotH, fill: 'none', stroke: 'var(--ci-accent)', strokeWidth: 2, rx: 3 }) : null,
                )
              }),
              h(
                'g',
                { className: 'ci-trend-axis' },
                xTicks.map(({ index, point }) =>
                  h(
                    'text',
                    {
                      key: 'x' + index,
                      x: xOf(index),
                      y: H - 6,
                      textAnchor: index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle',
                    },
                    dayLabel(Number(point.firstAt || point.at)),
                  ),
                ),
              ),
            ),
            tooltip === null
              ? null
              : h(
                  'div',
                  { className: 'ci-trend-tip', style: { left: Math.max(6, Math.min(W - 206, xOf(active) - 100)), top: 6 } },
                  h('div', { className: 't' }, labelOf(tooltip)),
                  Number(tooltip.bucketCount) > 1 ? h('div', { className: 'r' }, h('span', { className: 'l' }, t('trend.bucketCount', { count: tooltip.bucketCount })), h('b', null, '')) : null,
                  h('div', { className: 'r' }, h('span', { className: 'l' }, t('total')), h('b', null, `${digits(pointTotal(tooltip))} token`)),
                  h('div', { className: 'r' }, h('span', { className: 'l' }, t('trend.effective')), h('b', null, token(Number(tooltip.effective) || 0))),
                  h('div', { className: 'r' }, h('span', { className: 'l' }, t('savable')), h('b', null, token(Math.max(0, Number(tooltip.saved) || 0)))),
                  h('div', { className: 'sep' }),
                  segmentsOf(tooltip).map((segment) =>
                    h(
                      'div',
                      { className: 'r', key: segment.id },
                      h(
                        'span',
                        { className: 'l' },
                        h('i', {
                          className: 'sw',
                          style: segment.id === 'unknown' ? { background: 'repeating-linear-gradient(45deg,var(--ci-fg3) 0 1.5px,transparent 1.5px 4px)' } : { background: COLOR[segment.id] },
                        }),
                        segment.id === 'unknown' ? t('trend.unknown') : t(segment.id),
                      ),
                      h('b', null, token(segment.value)),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'r' },
                    h('span', { className: 'l' }, tooltip.source === 'log' ? t('v2.badgeLog') : t('v2.badgeMeasured')),
                    h('b', null, tooltip.scope ? scopeLabel(t, tooltip.scope) : '—'),
                  ),
                  Number(tooltip.samples) > 1 ? h('div', { className: 'r' }, h('span', { className: 'l' }, t('v2.samples', { count: tooltip.samples })), h('b', null, '')) : null,
                  tooltip.compactions !== null && tooltip.compactions !== undefined && Number(tooltip.compactions.count) > 0
                    ? h('div', { className: 'r' }, h('span', { className: 'l' }, t('v2.compactions', { count: tooltip.compactions.count, saved: token(tooltip.compactions.freed) })), h('b', null, ''))
                    : null,
                  h('div', { className: 'ci-trend-tip-hint' }, pinned >= 0 ? t('trend.pinned') : t('trend.pinHint')),
                ),
          ),
          h(
            'div',
            { className: 'ci-trend-legend', role: 'group', 'aria-label': t('trend.legendHint') },
            CHANNELS.map((channel) =>
              h(
                'button',
                {
                  key: channel,
                  type: 'button',
                  'aria-pressed': hiddenSet.has(channel) ? 'false' : 'true',
                  title: t('trend.legendHint'),
                  onClick: () => setHidden((previous) => (previous.indexOf(channel) >= 0 ? previous.filter((entry) => entry !== channel) : previous.concat(channel))),
                },
                h('i', { style: { background: COLOR[channel] } }),
                t(channel),
              ),
            ),
            unknown ? h('span', { className: 'unknown', title: t('trend.logHint'), style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 6px' } }, h('i', null), t('trend.unknown')) : null,
            hiddenCount > 0 ? h('button', { type: 'button', onClick: () => setHidden([]), title: t('trend.legendHint') }, '×') : null,
          ),
          h('div', { className: 'ci-trend-note' }, h('span', { className: 'hatch' }), t('trend.striped'), ' · ', t('trend.keyboardHint')),
          overview
            ? h('div', { className: 'ci-trend-note' }, t('trend.overviewNote', { count: source.length, buckets: data.length }))
            : range === 'all'
              ? h('div', { className: 'ci-trend-note' }, t('trend.allHint'))
              : null,
        )
      }

      function CrossComposition({ aggregate, t }) {
        const avg = aggregate !== null && aggregate !== undefined && aggregate.avgChannels !== null && typeof aggregate.avgChannels === 'object' ? aggregate.avgChannels : null
        const rows = avg === null ? [] : CHANNELS.filter((channel) => Number(avg[channel]) > 0).map((channel) => ({ id: channel, tokens: Number(avg[channel]) }))
        const total = rows.reduce((sum, row) => sum + row.tokens, 0)
        return h(
          'div',
          { className: 'ci-card' },
          h('div', { className: 'ci-cardhead' }, h('h2', null, t('v2.crossTitle'))),
          rows.length === 0
            ? h('div', { className: 'ci-note' }, t('v2.crossEmpty'))
            : h(
                'div',
                { className: 'ci-donut' },
                h(Donut, { rows, t, size: 116, centerLabel: t('trend.avg'), ariaLabel: t('v2.crossTitle') }),
                h(
                  'div',
                  { className: 'ci-donut-legend' },
                  rows.map((row) =>
                    h(
                      'div',
                      { className: 'ci-donut-row', key: row.id },
                      h(Dot, { channel: row.id }),
                      h('span', { className: 'n' }, t(row.id)),
                      h('b', null, token(row.tokens)),
                      h('span', { className: 'p' }, `${pctText(row.tokens, total)}`),
                    ),
                  ),
                ),
              ),
          h('div', { className: 'ci-trend-note' }, t('v2.crossNote')),
        )
      }

      function HeaviestSuites({ snapshot, t }) {
        const groups = Array.isArray(snapshot.groups) ? snapshot.groups : []
        const itemsByGroup = new Map()
        for (const item of snapshot.items) {
          const list = itemsByGroup.get(item.group) || []
          list.push(item)
          itemsByGroup.set(item.group, list)
        }
        // One suite can own rows in several channels (REA's tools plus its
        // prompt section); the ranking merges by label so it reads as one suite.
        const merged = new Map()
        for (const group of groups) {
          const label = String(group.label !== undefined && group.label !== null ? group.label : group.id)
          const key = label.toLowerCase()
          const items = itemsByGroup.get(group.id) || []
          const effective = items.reduce((sum, item) => (policyItemOn(snapshot, item) ? sum + item.tokens : sum), 0)
          const entry = merged.get(key) || { id: key, label, channel: group.channel, channels: [], tokens: 0, effective: 0 }
          if (entry.channels.indexOf(group.channel) < 0) entry.channels.push(group.channel)
          entry.tokens += Number(group.tokens) || 0
          entry.effective += effective
          merged.set(key, entry)
        }
        const rows = [...merged.values()]
          .sort((left, right) => right.tokens - left.tokens)
          .slice(0, 8)
        const max = rows.reduce((value, row) => Math.max(value, Number(row.tokens) || 0), 1)
        const total = Math.max(1, effectiveTotalOf(snapshot))
        return h(
          'div',
          { className: 'ci-card' },
          h('div', { className: 'ci-cardhead' }, h('h2', null, t('v2.heaviestTitle')), h('span', { className: 'sp' }), h('span', { className: 'hint' }, t('v2.heaviestHint'))),
          rows.length === 0
            ? h('div', { className: 'ci-note' }, t('v2.heaviestEmpty'))
            : h(
                'div',
                { className: 'ci-bars' },
                rows.map((group) =>
                  h(
                    'div',
                    {
                      className: 'ci-barrow' + (group.effective === 0 ? ' off' : ''),
                      key: group.id,
                      title: `${group.label} · ${t('total')} ${digits(group.tokens)} · ${t('after')} ${digits(group.effective)}`,
                    },
                    h('span', { className: 'n' }, groupLabelOf(t, group)),
                    h(
                      'span',
                      { className: 'ci-bar-track', style: { width: `${Math.max(2, ((Number(group.tokens) || 0) / max) * 100)}%` } },
                      h('span', {
                        className: 'ci-bar-fill',
                        style: {
                          width: `${group.tokens === 0 ? 0 : Math.max(0, Math.min(100, (group.effective / group.tokens) * 100))}%`,
                          background: COLOR[group.channel],
                        },
                      }),
                    ),
                    h('span', { className: 't', style: { textAlign: 'right' } }, `${token(group.effective)} · ${pctText(group.effective, total)}`),
                  ),
                ),
              ),
        )
      }

      function EventsFeed({ events, t, limit, initial, bare }) {
        const [showAll, setShowAll] = useState(false)
        const data = events !== null && events.data !== null && events.data !== undefined ? events.data : null
        const list = data !== null && Array.isArray(data.events) ? data.events : []
        const coverage = data !== null && data.coverage !== null && typeof data.coverage === 'object' ? data.coverage : null
        const max = limit || 60
        const first = initial || 12
        const sliced = showAll ? list.slice(0, max) : list.slice(0, first)
        const failed = events !== null && events.status === 'failed'
        const loading = events !== null && (events.status === 'loading' || events.status === 'refreshing') && data === null

        const paramsOf = (event) => {
          const params = event.params !== null && typeof event.params === 'object' ? event.params : {}
          const chips = []
          for (const key of ['group', 'name', 'scope', 'mode', 'preset', 'detail']) {
            const value = params[key]
            if (typeof value === 'string' && value.length > 0) chips.push(value.length > 60 ? value.slice(0, 60) + '…' : value)
          }
          if (typeof params.channel === 'string' && params.channel.length > 0) chips.push(t(params.channel))
          if (typeof params.op === 'string' && params.op.length > 0) {
            if (typeof params.channel === 'string') chips.push(params.op === 'off' ? t('turnedOff') : t('turnedOn'))
            else chips.push(params.op)
          }
          if (Number.isFinite(Number(params.count)) && Number(params.count) > 0) chips.push(`${params.count} ${t('items')}`)
          return chips
        }

        return h(
          'div',
          { className: (bare === true ? '' : 'ci-card ') + 'ci-events' },
          h(
            'div',
            { className: 'ci-cardhead' },
            h('h2', null, t('v2.eventsTitle')),
            h('span', { className: 'sp' }),
            coverage !== null && Number.isFinite(Number(coverage.count))
              ? h('span', { className: 'hint' }, t('v2.eventsCoverage', { count: coverage.count, limit: coverage.limit || max }))
              : null,
            h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: events.reload, title: t('refresh') }, t('refresh')),
          ),
          failed
            ? h(
                'div',
                { className: 'ci-errorbar' },
                h('span', null, `${t('v2.eventsFailed')}：${errorText(events)}`),
                h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: events.reload }, t('v2.retry')),
              )
            : null,
          loading
            ? h(
                'div',
                { className: 'ci-skel-lines', 'aria-hidden': 'true' },
                [0, 1, 2, 3, 4, 5].map((index) => h('div', { className: 'line', key: index })),
              )
            : null,
          !loading && list.length === 0 && !failed ? h('div', { className: 'ci-note' }, t('v2.eventsEmpty')) : null,
          sliced.length === 0
            ? null
            : h(
                'div',
                { className: 'ci-events-list', role: 'list', 'aria-label': t('v2.eventsTitle') },
                sliced.map((event, index) => {
                  const kind = typeof event.kind === 'string' ? event.kind : 'unknown'
                  const known = ['session-created', 'policy-saved', 'preset', 'budget', 'switch', 'undo', 'import', 'compaction', 'prune', 'model-switch', 'mode-toggle', 'diagnostic']
                  const label = known.indexOf(kind) >= 0 ? t('ev.' + kind) : t('ev.unknown')
                  const delta = Number(event.tokensDelta)
                  const chips = paramsOf(event)
                  return h(
                    'div',
                    { className: 'ci-event', key: event.id || 'e' + index, role: 'listitem' },
                    h('span', { className: 'dot k-' + kind, 'aria-hidden': 'true' }),
                    h(
                      'div',
                      { className: 'body' },
                      h(
                        'div',
                        { className: 'lbl' },
                        label,
                        Number.isFinite(delta) && delta !== 0
                          ? h('span', { className: 'delta' }, ` ${delta < 0 ? '−' : '+'}${token(Math.abs(delta))}`)
                          : null,
                      ),
                      chips.length === 0 ? null : h('div', { className: 'prm' }, chips.map((chip, chipIndex) => h('span', { key: chipIndex }, chip))),
                    ),
                    h('time', { className: 'when', dateTime: Number(event.at) > 0 ? new Date(event.at).toISOString() : undefined, title: fullTime(event.at) }, ago(event.at)),
                  )
                }),
              ),
          !showAll && list.length > first
            ? h('button', { type: 'button', className: 'ci-btn ci-sm', style: { alignSelf: 'flex-start' }, onClick: () => setShowAll(true) }, t('v2.eventsMore', { count: Math.min(list.length, max) - first }))
            : null,
        )
      }

      function SessionCards({ trend, t, sessionId, onRangeAll }) {
        const [query, setQuery] = useState('')
        const [sort, setSort] = useStoredState('insightsSort', 'recent')
        const [shown, setShown] = useState(24)
        const deferredQuery = useDeferredValue(query)
        const points = trend !== null && trend.data !== null && trend.data !== undefined && Array.isArray(trend.data.points) ? trend.data.points : []
        const needle = deferredQuery.trim().toLowerCase()
        const filtered = points.filter((point) => {
          if (needle.length === 0) return true
          const haystack = `${point.sessionId || ''} ${point.title || ''} ${point.cwd || ''}`.toLowerCase()
          return haystack.indexOf(needle) >= 0
        })
        const sorted = filtered.slice().sort((left, right) => {
          if (sort === 'heavy') return (Number(right.total) || 0) - (Number(left.total) || 0)
          if (sort === 'saved') return (Number(right.saved) || 0) - (Number(left.saved) || 0)
          return (Number(right.firstAt || right.at) || 0) - (Number(left.firstAt || left.at) || 0)
        })
        const visible = sorted.slice(0, shown)
        const miniBar = (point) => {
          const channels = point.channels
          if (channels === null || channels === undefined || typeof channels !== 'object') return h('span', { className: 'mini-bar unknown', 'aria-hidden': 'true' })
          const total = Math.max(1, Number(point.total) || 0)
          return h(
            'span',
            { className: 'mini-bar', 'aria-hidden': 'true', title: t('v2.crossTitle') },
            CHANNELS.filter((channel) => Number(channels[channel]) > 0).map((channel) =>
              h('span', { key: channel, style: { width: `${Math.max(1, (Number(channels[channel]) / total) * 100)}%`, background: COLOR[channel] } }),
            ),
          )
        }
        return h(
          'div',
          { className: 'ci-card' },
          h(
            'div',
            { className: 'ci-cardhead' },
            h('h2', null, t('v2.sessions')),
            h('span', { className: 'hint' }, t('v2.sessionsCount', { count: sorted.length })),
          ),
          h(
            'div',
            { className: 'ci-session-toolbar' },
            h('input', {
              className: 'ci-input',
              placeholder: t('v2.sessionSearch'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
              'aria-label': t('v2.sessionSearch'),
            }),
            h(
              'div',
              { className: 'ci-seg ci-small', role: 'group', 'aria-label': t('v2.sortLabel') },
              [
                ['recent', t('v2.sortRecent')],
                ['heavy', t('v2.sortHeavy')],
                ['saved', t('v2.sortSaved')],
              ].map(([key, label]) =>
                h('button', { key, type: 'button', className: sort === key ? 'on' : '', 'aria-pressed': sort === key ? 'true' : 'false', onClick: () => setSort(key) }, label),
              ),
            ),
          ),
          sorted.length === 0
            ? h(
                'div',
                { className: 'ci-empty-next' },
                h('span', null, t('v2.noSessions')),
                onRangeAll === undefined ? null : h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: onRangeAll }, t('trend.rangeAll')),
              )
            : h(
                'div',
                { className: 'ci-session-grid' },
                visible.map((point) => {
                  const live = sessionId !== undefined && sessionId !== '' && point.sessionId === sessionId
                  return h(
                    'div',
                    { className: 'ci-session' + (live ? ' live' : ''), key: point.sessionId || String(point.at), title: `${point.sessionId || ''}${point.cwd ? ' · ' + point.cwd : ''}` },
                    h(
                      'div',
                      { className: 'top' },
                      h('span', { className: 'sid' }, shortId(point.sessionId)),
                      live ? h('span', { className: 'ci-badge accent' }, t('v2.currentSession')) : null,
                      h('span', { className: 'when' }, dayLabel(Number(point.firstAt || point.at))),
                    ),
                    h('div', { className: 'big' }, token(Number(point.total) || 0), h('small', null, t('tokens'))),
                    h('div', { className: 'sub' }, `${t('trend.effective')} ${token(Number(point.effective) || 0)} · ${t('savable')} ${token(Number(point.saved) || 0)}`),
                    miniBar(point),
                    h(
                      'div',
                      { className: 'badges' },
                      point.source === 'log' ? h('span', { className: 'ci-badge' }, t('v2.badgeLog')) : h('span', { className: 'ci-badge' }, t('v2.badgeMeasured')),
                      Number(point.samples) > 1 ? h('span', { className: 'ci-badge' }, t('v2.samples', { count: point.samples })) : null,
                      point.compactions !== null && point.compactions !== undefined && Number(point.compactions.count) > 0
                        ? h('span', { className: 'ci-badge' }, t('v2.compactions', { count: point.compactions.count, saved: token(point.compactions.freed) }))
                        : null,
                      point.channels === null || point.channels === undefined ? h('span', { className: 'ci-badge' }, t('v2.channelsUnknown')) : null,
                    ),
                  )
                }),
              ),
          sorted.length > visible.length
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ci-btn ci-sm',
                  style: { alignSelf: 'flex-start' },
                  onClick: () => setShown((previous) => previous + 24),
                },
                t('v2.showMore', { count: Math.min(24, sorted.length - visible.length) }),
              )
            : null,
        )
      }

      // Cross-session KPI row: the insights page answers "how big has this been
      // over time", not "what is on screen". The current session's numbers move
      // to one compact line so the trend card owns the first screen.
      function InsightKpis({ aggregate, coverage, t }) {
        const rows = [
          {
            key: 'v2.kpiMeasured',
            value: aggregate === null ? '—' : `${aggregate.measured ?? '—'}/${aggregate.sessions ?? '—'}`,
            sub: t('v2.kpiMeasuredSub'),
            title: coverage === null ? '' : t('trend.coverage', { recorded: coverage.recorded ?? '—', known: coverage.known ?? '—' }),
          },
          { key: 'trend.avg', value: aggregate === null ? '—' : token(aggregate.avgTotal), sub: t('trend.avgSub'), title: t('trend.avgSub') },
          { key: 'trend.max', value: aggregate === null ? '—' : token(aggregate.maxTotal), sub: t('trend.maxSub'), title: t('trend.maxSub') },
          { key: 'trend.saved', value: aggregate === null ? '—' : token(aggregate.totalSaved), sub: t('trend.savedSub'), title: t('trend.savedSub') },
        ]
        return h(
          'div',
          { className: 'ci-kpis' },
          rows.map((row) =>
            h(
              'div',
              { className: 'ci-kpi', key: row.key, title: row.title || null },
              h('div', { className: 'k' }, t(row.key)),
              h('div', { className: 'v' }, row.value),
              h('div', { className: 's' }, row.sub),
            ),
          ),
        )
      }

      function InsightsTab({ snapshot, t, sessionId, onOpenContent, onOpenTab, act }) {
        const [range, setRange] = useStoredState('trendRange', 'all')
        const trend = useTrend(range, true)
        const events = useEvents(sessionId, true)
        const data = trend.data !== null && trend.data !== undefined ? trend.data : null
        const aggregate = data !== null && data.aggregate !== null && typeof data.aggregate === 'object' ? data.aggregate : null
        const coverage = data !== null && data.coverage !== null && typeof data.coverage === 'object' ? data.coverage : null
        const backfilling = data !== null && data.backfilling === true
        const points = data !== null && Array.isArray(data.points) ? data.points : []
        const currentTotals = snapshot.effective && snapshot.effective.totals ? snapshot.effective.totals : snapshot.totals
        const context = snapshot.context !== null && snapshot.context !== undefined ? snapshot.context : null
        const windowKnown = context !== null && context.window !== null && context.used !== null
        const aggCells = aggregate === null ? [] : [
          { key: 'v2.sessionsCount', value: aggregate.sessions, label: t('v2.sessionsCount', { count: aggregate.sessions }) },
          { key: 'trend.measured', value: aggregate.measured, label: t('trend.measured', { count: aggregate.measured }) },
          { key: 'trend.avg', value: token(aggregate.avgTotal), label: t('trend.avg') },
          { key: 'trend.max', value: token(aggregate.maxTotal), label: t('trend.max') },
          { key: 'trend.saved', value: token(aggregate.totalSaved), label: t('trend.saved') },
        ]
        return h(
          'div',
          { className: 'ci-insights' },
          h(
            'div',
            { className: 'ci-inline-meta' },
            h('span', null, t('v2.insightsSub')),
            h('span', { style: { flex: '1 1 auto' } }),
            h(RangePills, {
              value: range,
              label: t('trend.rangeLabel'),
              options: [
                ['7d', t('trend.range7')],
                ['30d', t('trend.range30')],
                ['all', t('trend.rangeAll')],
              ],
              onChange: setRange,
            }),
            h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: () => Promise.all([trend.reload(), events.reload()]).catch(() => {}) }, t('refresh')),
          ),
          h(InsightKpis, { aggregate, coverage, t }),
          h(
            'div',
            { className: 'ci-insight-current' },
            h('span', null, t('v2.currentSession')),
            h('span', null, `${t('total')} `, h('b', null, token(currentTotals.tokens))),
            h('span', null, `${t('window')} `, h('b', null, windowKnown ? `${token(context.used)} / ${token(context.window)}` : t('noWindow'))),
            h('span', null, `${t('savable')} `, h('b', null, token(currentTotals.savableTokens))),
            h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: () => onOpenTab('manage') }, t('v2.goManage')),
          ),
          h(RequestStrip, { snapshot, t }),
          h(
            'div',
            { className: 'ci-insight-top' },
            h(
              'div',
              { className: 'ci-card' },
              h(
                'div',
                { className: 'ci-cardhead' },
                h('h2', null, t('trend.title')),
                h('span', { className: 'sp' }),
                h('span', { className: 'hint' }, t('trend.legendHint')),
              ),
              aggCells.length === 0
                ? null
                : h(
                    'div',
                    { className: 'ci-trend-agg' },
                    aggCells.map((cell) =>
                      h('span', { className: 'cell', key: cell.key }, cell.label, h('b', null, cell.value === undefined || cell.value === null ? '—' : String(cell.value))),
                    ),
                  ),
              trend.status === 'failed'
                ? h(
                    'div',
                    { className: 'ci-errorbar' },
                    h('span', null, `${t('trend.loadFailed')}：${errorText(trend)}`),
                    h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: trend.reload }, t('trend.retry')),
                  )
                : null,
              trend.status === 'loading' && data === null
                ? h(
                    'div',
                    { className: 'ci-skel-lines', 'aria-hidden': 'true' },
                    h('div', { className: 'ci-skel-chart' }, [38, 62, 44, 71, 55, 83, 49, 66, 40, 74].map((height, index) => h('span', { key: index, style: { height: height + '%' } }))),
                    h('div', { className: 'line' }),
                    h('div', { className: 'line' }),
                  )
                : h(TrendChart, { points, t, range }),
              coverage !== null
                ? h('div', { className: 'ci-trend-note' }, t('trend.coverage', { recorded: coverage.recorded ?? '—', known: coverage.known ?? '—' }), ' · ', t('trend.coverageFootnote'))
                : null,
              backfilling ? h('div', { className: 'ci-trend-note' }, t('trend.backfilling')) : null,
            ),
            h('div', { className: 'ci-card ci-events-card' }, h(EventsFeed, { events, t, limit: 60, initial: 4, bare: true })),
          ),
          h('div', { className: 'ci-grid2' }, h(CrossComposition, { aggregate, t }), h(HeaviestSuites, { snapshot, t })),
          h(SessionCards, { trend, t, sessionId, onRangeAll: () => setRange('all') }),
          h('div', { className: 'ci-foot' }, t('v2.aboutHonesty')),
        )
      }

      // ------------------------------------------------------- content drawer
      //
      // A right-hand overlay that shows one item's raw content. Everything here
      // is plain React text: no raw-HTML injection anywhere, so a tool
      // description or an AGENTS.md that contains HTML reads as text.
      function ContentDrawer({ target, sessionId, t, onClose }) {
        const open = target !== null && target !== undefined
        const content = useContent(open ? target : null, sessionId)
        const [query, setQuery] = useState('')
        const [linesOn, setLinesOn] = useStoredState('contentLines', true)
        const [copied, setCopied] = useState('')
        const [view, setView] = useState('desc')
        const deferredQuery = useDeferredValue(query)
        const panelRef = useRef(null)
        const copyTimer = useRef(null)
        const restoreRef = useRef(null)
        const closeRef = useRef(null)

        useEffect(() => {
          if (open !== true) return undefined
          restoreRef.current = typeof document !== 'undefined' ? document.activeElement : null
          const timer = setTimeout(() => {
            if (closeRef.current && typeof closeRef.current.focus === 'function') closeRef.current.focus()
          }, 30)
          return () => {
            clearTimeout(timer)
            const previous = restoreRef.current
            if (previous && typeof previous.focus === 'function') {
              try {
                previous.focus()
              } catch {
                /* the trigger may be gone after a re-render */
              }
            }
          }
        }, [open])

        useEffect(() => {
          if (open !== true) return undefined
          setQuery('')
          setCopied('')
          setView('desc')
          return undefined
        }, [open, target === null || target === undefined ? '' : target.id])

        useEffect(() => () => { if (copyTimer.current !== null) clearTimeout(copyTimer.current) }, [])

        // Focus trap + Escape. Capture phase so the host's own Escape handlers
        // (e.g. closing the side panel) do not fight the drawer.
        useEffect(() => {
          if (open !== true) return undefined
          const onKeyDown = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
              return
            }
            if (event.key !== 'Tab') return
            const root = panelRef.current
            if (!root) return
            const nodes = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
            const list = []
            for (const node of nodes) {
              if (node.disabled === true) continue
              if (node.getAttribute('aria-hidden') === 'true') continue
              if (node.offsetParent === null && node !== document.activeElement) continue
              list.push(node)
            }
            if (list.length === 0) return
            const first = list[0]
            const last = list[list.length - 1]
            if (event.shiftKey === true && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (event.shiftKey !== true && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, [open, onClose])

        if (open !== true) return null

        const data = content.data !== null && content.data !== undefined ? content.data : null
        const body = data !== null && typeof data.content === 'string' ? data.content : ''
        const info = data !== null && data.item !== null && typeof data.item === 'object' ? data.item : { name: target.name, channel: target.channel, tokens: target.tokens, chars: target.chars }
        const name = typeof info.name === 'string' && info.name.length > 0 ? info.name : String(target.name || target.id || '')
        const channel = typeof info.channel === 'string' ? info.channel : String(target.channel || '')
        const contentType = data !== null && typeof data.contentType === 'string' ? data.contentType : 'text'
        const sourcePath = data !== null && typeof data.sourcePath === 'string' ? data.sourcePath : ''
        const truncated = data !== null && data.truncated === true
        const limit = data !== null && Number(data.limit) > 0 ? data.limit : 262144
        const note = data !== null && typeof data.note === 'string' ? data.note : ''
        const bytes = data !== null && Number.isFinite(Number(data.bytes)) ? Number(data.bytes) : Number(info.chars) || body.length
        const chars = Number.isFinite(Number(info.chars)) ? Number(info.chars) : body.length
        const tokens = Number.isFinite(Number(info.tokens)) ? Number(info.tokens) : Math.round(chars / 3.5)
        const groupLabel = target.group !== undefined && target.group !== null ? String(target.group) : ''

        const allLines = body.length === 0 ? [] : body.split('\n')
        const maxLines = 4000
        const shownLines = allLines.length > maxLines ? allLines.slice(0, maxLines) : allLines
        const needle = deferredQuery.trim()
        const lowerNeedle = needle.toLowerCase()
        const matchInfo = (() => {
          if (needle.length === 0 || body.length === 0) return { count: 0, lines: 0 }
          const lower = body.toLowerCase()
          let count = 0
          let at = 0
          while (count < 5000) {
            const found = lower.indexOf(lowerNeedle, at)
            if (found < 0) break
            count += 1
            at = found + lowerNeedle.length
          }
          let lines = 0
          for (const line of shownLines) if (line.toLowerCase().indexOf(lowerNeedle) >= 0) lines += 1
          return { count, lines }
        })()

        const markLine = (text, index) => {
          if (needle.length === 0) return text
          const lower = text.toLowerCase()
          if (lower.indexOf(lowerNeedle) < 0) return text
          const out = []
          let at = 0
          let count = 0
          while (count < 400) {
            const found = lower.indexOf(lowerNeedle, at)
            if (found < 0) break
            if (found > at) out.push(text.slice(at, found))
            out.push(h('mark', { className: 'ci-content-hit', key: 'm' + index + ':' + count }, text.slice(found, found + needle.length)))
            at = found + needle.length
            count += 1
          }
          if (at < text.length) out.push(text.slice(at))
          return out
        }

        const copyText = async (value, key) => {
          try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard-unavailable')
            await navigator.clipboard.writeText(value)
            setCopied(key)
          } catch {
            setCopied('error')
          }
          if (copyTimer.current !== null) clearTimeout(copyTimer.current)
          copyTimer.current = setTimeout(() => setCopied(''), 1800)
        }

        const knownNotes = ['catalog', 'file', 'assemble', 'snapshot']

        // Tools arrive as pretty-printed JSON. A raw dump is hard to scan, so
        // the drawer splits it the way a reader needs it: description, a
        // parameter table, and the untouched JSON as the audit view. Non-JSON
        // content has no tabs — it is already text.
        const isJson = contentType === 'json'
        let parsed = null
        if (isJson && body.length > 0) {
          try {
            parsed = JSON.parse(body)
          } catch {
            parsed = null
          }
        }
        const parameters = parsed !== null && parsed.parameters !== null && typeof parsed.parameters === 'object' ? parsed.parameters : null
        const properties = parameters !== null && parameters.properties !== null && typeof parameters.properties === 'object' ? parameters.properties : null
        const requiredNames = parameters !== null && Array.isArray(parameters.required) ? parameters.required.map(String) : []
        const hasStructured = isJson && parsed !== null && typeof parsed === 'object'
        const mode = hasStructured ? view : 'raw'
        const sharePct = target !== null && target !== undefined && Number.isFinite(Number(target.share)) ? Number(target.share) : null
        const savedTokens = target !== null && target !== undefined && Number.isFinite(Number(target.saved)) ? Math.max(0, Number(target.saved)) : 0
        const propertyRows = properties === null ? [] : Object.keys(properties).map((key) => {
          const spec = properties[key] !== null && typeof properties[key] === 'object' ? properties[key] : {}
          const type = typeof spec.type === 'string' ? spec.type : spec.type !== undefined ? String(spec.type) : '—'
          return {
            name: key,
            type,
            required: requiredNames.indexOf(key) >= 0,
            desc: typeof spec.description === 'string' && spec.description.length > 0 ? spec.description : '—',
          }
        })
        const copyLabel = isJson ? t('content.copyJson') : t('content.copy')
        const bodyLines = () =>
          h(
            'div',
            { className: 'ci-content-lines' },
            shownLines.map((line, index) =>
              h(
                'div',
                { className: 'ci-content-line', key: index },
                linesOn ? h('span', { className: 'ln', 'aria-hidden': 'true' }, String(index + 1)) : null,
                h('span', { className: 'tx' }, markLine(line, index)),
              ),
            ),
          )

        return h(
          React.Fragment,
          null,
          h('style', null, STYLE),
          h('div', {
            className: 'ci-drawer-backdrop',
            'aria-hidden': 'true',
            onClick: onClose,
          }),
          h(
            'section',
            {
              className: 'ci-drawer',
              ref: panelRef,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'ci-drawer-title',
              tabIndex: -1,
            },
            h(
              'div',
              { className: 'ci-drawer-head' },
              h(
                'div',
                { className: 'ci-drawer-title' },
                h(
                  'div',
                  { className: 'ci-breadcrumb' },
                    h('span', null, t('tabManage')),
                    h('span', { className: 'sep' }, '/'),
                    h(Dot, { channel }),
                    h('span', null, t(channel)),
                  groupLabel.length > 0 ? h('span', { className: 'sep' }, '/') : null,
                  groupLabel.length > 0 ? h('span', null, groupLabel) : null,
                  h('span', { className: 'sep' }, '/'),
                  h('span', { className: 'last', title: name }, name),
                ),
                h('h2', { id: 'ci-drawer-title' }, name),
                h(
                  'div',
                  { className: 'ci-inline-meta', style: { marginTop: 2 } },
                  h('span', { title: t('content.tokensHint') }, `≈${token(tokens)} token`),
                  sharePct === null ? null : h('span', null, `${Number(sharePct).toFixed(1)}% ${t('shareOf')}`),
                  savedTokens > 0 ? h('span', { className: 'ci-delta', title: t('v2.savedHint', { tokens: digits(savedTokens) }) }, '−' + token(savedTokens)) : null,
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ci-btn',
                  ref: closeRef,
                  'data-autofocus': 'true',
                  onClick: onClose,
                  'aria-label': t('content.close'),
                  title: t('content.escHint'),
                },
                '×',
              ),
            ),
            h(
              'div',
              { className: 'ci-drawer-tools' },
              h('span', { className: 'ci-badge' }, t('content.type.' + (['json', 'markdown', 'text'].indexOf(contentType) >= 0 ? contentType : 'text'))),
              h('span', { className: 'ci-badge' }, h(Dot, { channel }), t(channel)),
              note.length > 0 ? h('span', { className: 'ci-badge' }, knownNotes.indexOf(note) >= 0 ? t('content.note.' + note) : note) : null,
              h('span', { style: { flex: '1 1 auto' } }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ci-btn ci-sm',
                  disabled: body.length === 0,
                  onClick: () => copyText(body, 'content'),
                },
                copied === 'content' ? t('content.copied') : copied === 'error' ? t('content.copyFailed') : copyLabel,
              ),
            ),
            hasStructured || mode === 'raw'
              ? h(
                  'div',
                  { className: 'ci-drawer-tools' },
                  h('span', { className: 'ci-inline-meta' }, t('content.meta', { bytes: digits(bytes), chars: digits(chars), tokens: token(tokens) })),
                  hasStructured
                    ? h(
                        'div',
                        { className: 'ci-seg ci-small', role: 'group', 'aria-label': t('content.viewLabel') },
                        [
                          ['desc', t('content.viewDesc')],
                          ['params', t('content.viewParams')],
                          ['raw', t('content.viewRaw')],
                        ].map(([key, label]) =>
                          h('button', { key, type: 'button', className: mode === key ? 'on' : '', 'aria-pressed': mode === key ? 'true' : 'false', onClick: () => setView(key) }, label),
                        ),
                      )
                    : null,
                  h('span', { style: { flex: '1 1 auto' } }),
                  mode === 'raw'
                    ? h(
                        React.Fragment,
                        null,
                        h('span', { className: 'ci-inline-meta' }, t('content.lines')),
                        h(Switch, { on: linesOn, onChange: (next) => setLinesOn(next), title: t('content.lines') }),
                      )
                    : null,
                )
              : null,
            sourcePath.length > 0
              ? h(
                  'div',
                  { className: 'ci-drawer-source' },
                  h('span', null, t('content.source')),
                  h('span', { className: 'ci-drawer-path', title: sourcePath }, sourcePath),
                  h(
                    'button',
                    { type: 'button', className: 'ci-btn ci-sm', onClick: () => copyText(sourcePath, 'path') },
                    copied === 'path' ? t('content.pathCopied') : t('content.copyPath'),
                  ),
                )
              : null,
            mode === 'raw' && body.length > 0
              ? h(
                  'div',
                  { className: 'ci-drawer-tools' },
                  h('input', {
                    className: 'ci-input ci-drawer-search',
                    placeholder: t('content.search'),
                    value: query,
                    onChange: (event) => setQuery(event.target.value),
                    'aria-label': t('content.search'),
                  }),
                  needle.length > 0 ? h('span', { className: 'ci-inline-meta' }, t('content.matchSummary', { lines: matchInfo.lines, count: matchInfo.count })) : null,
                  h('span', { className: 'ci-inline-meta' }, t('content.linesMeta', { count: allLines.length })),
                )
              : null,
            truncated
              ? h('div', { className: 'ci-drawer-note' }, t('content.truncated', { limit: digits(limit) }))
              : null,
            h(
              'div',
              { className: 'ci-drawer-body' },
              content.status === 'failed' && data === null
                ? h(
                    'div',
                    { className: 'ci-drawer-empty' },
                    h('div', { style: { marginBottom: 8 } }, `${t('content.failed')}：${errorText(content)}`),
                    h('button', { type: 'button', className: 'ci-btn', onClick: content.reload }, t('content.retry')),
                  )
                : content.status === 'loading' && data === null
                  ? h(
                      'div',
                      { className: 'ci-skel-lines', 'aria-hidden': 'true', style: { padding: '0 16px' } },
                      [0, 1, 2, 3, 4, 5, 6, 7].map((index) => h('div', { className: 'line', key: index })),
                    )
                  : content.status === 'failed'
                    ? h(
                        'div',
                        { className: 'ci-errorbar', style: { margin: '0 16px 8px' } },
                        h('span', null, t('content.failed')),
                        h('button', { type: 'button', className: 'ci-btn ci-sm', onClick: content.reload }, t('content.retry')),
                      )
                    : null,
              content.status === 'failed' && data === null
                ? null
                : body.length === 0 && (content.status === 'ready' || content.status === 'failed')
                  ? content.status === 'ready'
                    ? h('div', { className: 'ci-drawer-empty' }, t('content.empty'))
                    : null
                  : mode === 'desc'
                    ? h(
                        'div',
                        { className: 'ci-drawer-sect' },
                        h('h3', null, name),
                        h('p', { className: 'ci-drawer-desc' }, parsed !== null && typeof parsed.description === 'string' && parsed.description.length > 0 ? parsed.description : t('content.noDesc')),
                      )
                    : mode === 'params'
                      ? propertyRows.length === 0
                        ? h('div', { className: 'ci-drawer-empty' }, t('content.noParams'))
                        : h(
                            'table',
                            { className: 'ci-param-table' },
                            h(
                              'thead',
                              null,
                              h(
                                'tr',
                                null,
                                h('th', null, t('content.paramName')),
                                h('th', null, t('content.paramType')),
                                h('th', { style: { textAlign: 'center' } }, t('content.paramRequired')),
                                h('th', null, t('content.paramDesc')),
                              ),
                            ),
                            h(
                              'tbody',
                              null,
                              propertyRows.map((row) =>
                                h(
                                  'tr',
                                  { key: row.name },
                                  h('td', { className: 'name' }, row.name),
                                  h('td', { className: 'type' }, row.type),
                                  h('td', { className: 'req' }, row.required ? '✓' : '—'),
                                  h('td', { className: 'desc' }, row.desc),
                                ),
                              ),
                            ),
                          )
                      : bodyLines(),
              allLines.length > maxLines ? h('div', { className: 'ci-drawer-note' }, t('content.clipped', { count: digits(maxLines) })) : null,
            ),
            h(
              'div',
              { className: 'ci-drawer-foot' },
              h('span', null, t('content.escHint')),
              h('span', null, t('content.readonly')),
            ),
          ),
        )
      }

      function SettingsTab({ snapshot, t, act, sessionId, notify }) {
        const policy = snapshot.policy
        const [prefix, setPrefix] = useState(policy.prompt.prefix)
        const [suffix, setSuffix] = useState(policy.prompt.suffix)
        const [saving, setSaving] = useState(false)
        const [confirmRestore, setConfirmRestore] = useState(null)
        const timer = useRef(null)

        useEffect(() => {
          setPrefix(policy.prompt.prefix)
          setSuffix(policy.prompt.suffix)
        }, [policy.prompt.prefix, policy.prompt.suffix])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])

        const fileInput = useRef(null)

        const copyReport = async () => {
          try {
            const text = typeof snapshot.text === 'string' ? snapshot.text : ''
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
              throw new Error('clipboard-unavailable')
            }
            await navigator.clipboard.writeText(text)
            notify({ kind: 'ok', text: t('copied') }, 1800)
          } catch (error) {
            notify({ kind: 'error', text: `${t('copyFailed')}：${String((error && error.message) || error)}` })
          }
        }

        const importPolicy = async (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          try {
            const text = await file.text()
            const parsed = JSON.parse(text)
            await act({ kind: 'import', policy: parsed })
          } catch (error) {
            notify({ kind: 'error', text: `${t('importInvalid')}：${String((error && error.message) || error)}` })
          }
        }

        const downloadManifest = async (format) => {
          try {
            const query = `format=${format}` + (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '')
            const response = await fetch(`${ROUTES.export}?${query}`, { credentials: 'same-origin' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const blob = await response.blob()
            const href = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            anchor.href = href
            anchor.download = `injection-manifest-${stamp}.${format === 'json' ? 'json' : 'md'}`
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
            setTimeout(() => URL.revokeObjectURL(href), 2000)
          } catch (error) {
            console.error('[injection-manager] export failed', error)
          }
        }

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
                  h('button', {
                    key: name,
                    type: 'button',
                    className: policy.preset === name ? 'on' : '',
                    onClick: () => act({ kind: 'preset', name }, `${t('preset')}: ${label}`),
                  }, label),
                ),
              ),
              h('span', { className: 'hint' }, policy.preset === 'custom' ? t('custom') : ''),
            ),
            excludedCountOf(snapshot) > 0
              ? h('div', { className: 'ci-note warn' }, t('presetOverwrite', { count: excludedCountOf(snapshot) }))
              : null,
            h('div', { className: 'ci-note' }, t('saveHint')),
          ),
          h('div', { className: 'ci-card' }, h('h2', null, t('aboutManageable')), h(ChannelSwitches, { snapshot, t, act })),
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('historyTitle')),
            (snapshot.undo && snapshot.undo.entries ? snapshot.undo.entries : []).length === 0
              ? h('div', { className: 'ci-note' }, t('historyEmpty'))
              : h(
                  'div',
                  { className: 'ci-list' },
                  snapshot.undo.entries
                    .slice()
                    .reverse()
                    .map((entry) =>
                      h(
                        'div',
                        { className: 'ci-mini', key: entry.index },
                        h('span', { className: 'n', title: entry.label }, entry.label),
                        h('span', { className: 't' }, new Date(entry.at).toLocaleTimeString()),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'ci-btn' + (confirmRestore === entry.index ? ' ci-primary' : ''),
                            onClick: () => {
                              if (confirmRestore === entry.index) {
                                setConfirmRestore(null)
                                act({ kind: 'restore', index: entry.index }, t('restored'))
                              } else {
                                setConfirmRestore(entry.index)
                              }
                            },
                          },
                          confirmRestore === entry.index ? t('confirmRestore') : t('restoreTo'),
                        ),
                        confirmRestore === entry.index
                          ? h('button', { type: 'button', className: 'ci-btn', onClick: () => setConfirmRestore(null) }, t('cancel'))
                          : null,
                      ),
                    ),
                ),
          ),
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('promptPrefix')),
            h('textarea', {
              className: 'ci-input',
              style: { height: 72, resize: 'vertical', fontFamily: 'inherit', maxWidth: 720 },
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
              style: { height: 56, resize: 'vertical', fontFamily: 'inherit', maxWidth: 720 },
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
            h('h2', null, t('exportTitle')),
            h('div', { className: 'ci-note' }, t('exportHint')),
            h(
              'div',
              { className: 'ci-toolbar' },
              h('button', { type: 'button', className: 'ci-btn', onClick: copyReport }, t('copyReport')),
              h('button', { type: 'button', className: 'ci-btn', onClick: () => downloadManifest('md') }, t('exportMd')),
              h('button', { type: 'button', className: 'ci-btn', onClick: () => downloadManifest('json') }, t('exportJson')),
              h('input', {
                ref: fileInput,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: importPolicy,
                'aria-hidden': 'true',
                tabIndex: -1,
              }),
              h('button', { type: 'button', className: 'ci-btn', onClick: () => fileInput.current && fileInput.current.click() }, t('importPolicy')),
            ),
            h('div', { className: 'hint' }, t('importHint')),
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
            policy.lastApplication && policy.lastApplication.report && policy.lastApplication.report.counts
              ? h(
                  'div',
                  { className: 'hint' },
                  CHANNELS.map((channel) => {
                    const state = policy.lastApplication.report.counts[channel]
                    return state === undefined ? null : `${t(channel)} ${state.on}/${state.total}`
                  })
                    .filter((line) => line !== null)
                    .join(' · '),
                )
              : null,
            h('div', { className: 'ci-foot' }, `${t('policyPath')}：${policy.path}`),
            policy.updatedAt ? h('div', { className: 'ci-foot' }, `${t('updatedAt')}：${policy.updatedAt}`) : null,
            policy.error ? h('div', { className: 'ci-note warn' }, policy.error) : null,
          ),
        )
      }

      function excludedCountOf(snapshot) {
        return CHANNELS.reduce((sum, channel) => {
          const state = snapshot.policy.channels[channel]
          if (state === undefined || state.mode === 'all') return sum
          const row = snapshot.channels.find((entry) => entry.id === channel)
          const total = row === undefined ? 0 : row.count
          if (state.mode === 'except') return sum + state.names.length
          return sum + Math.max(0, total - state.names.length)
        }, 0)
      }

      function BudgetTab({ snapshot, t, act }) {
        const policy = snapshot.policy
        const [target, setTarget] = useState(policy.budget.tokens > 0 ? String(policy.budget.tokens) : '')
        const plan = policy.plan
        const timer = useRef(null)
        const [sort, setSort] = useStoredState('budgetSort', 'tokens')

        // Applying a plan recomputes every channel; count manual choices first.
        const excludedCount = excludedCountOf(snapshot)
        const dropGroups = (plan.dropGroups || []).slice().sort((left, right) =>
          sort === 'name'
            ? groupLabelOf(t, left).localeCompare(groupLabelOf(t, right), undefined, { numeric: true })
            : right.tokens - left.tokens,
        )

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
              [24000, 48000, 80000].map((value) =>
                h(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    className: 'ci-chip' + (Number(target) === value ? ' on' : ''),
                    onClick: () => {
                      setTarget(String(value))
                      commit(String(value))
                    },
                  },
                  digits(value),
                ),
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
            excludedCount > 0 ? h('div', { className: 'ci-note warn' }, t('budgetOverwrite', { count: excludedCount })) : null,
            h(
              'div',
              { className: 'ci-toolbar', style: { margin: '6px 0' } },
              h('button', { type: 'button', className: 'ci-chip' + (sort === 'tokens' ? ' on' : ''), onClick: () => setSort('tokens') }, t('sortTokens')),
              h('button', { type: 'button', className: 'ci-chip' + (sort === 'name' ? ' on' : ''), onClick: () => setSort('name') }, t('sortName')),
            ),
            plan.reachable ? null : h('div', { className: 'ci-note warn' }, t('unreachable')),
            plan.drop.length === 0
              ? h('div', { className: 'ci-note' }, t('planEmpty'))
              : h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'hint', style: { marginBottom: 4 } },
                    `${t('planDrop')} ${plan.drop.length} ${t('items')} · ${dropGroups.length} ${t('groups')} · −${digits(plan.savedTokens)} token`,
                  ),
                  h(
                    'div',
                    { className: 'ci-list' },
                    dropGroups.slice(0, 8).map((group) =>
                      h(
                        'div',
                        { className: 'ci-mini', key: group.id },
                        h(Dot, { channel: group.channel }),
                        h('span', { className: 'n', title: group.id }, groupLabelOf(t, group)),
                        h('span', { className: 't' }, `${group.count} ${t('items')}`),
                        h('span', { className: 't' }, digits(group.tokens)),
                      ),
                    ),
                  ),
                  dropGroups.length > 8 ? h('div', { className: 'hint' }, t('moreGroups', { count: dropGroups.length - 8 })) : null,
                ),
          ),
        )
      }

      function AboutTab({ snapshot, t, sessionId }) {
        const locked = snapshot.locks
        const [dockHidden, setDockHidden] = useStoredState('dockHidden', false)

        useEffect(() => {
          const onPref = (event) => {
            const detail = event && event.detail
            if (detail && typeof detail.hidden === 'boolean') setDockHidden(detail.hidden)
          }
          window.addEventListener('injection-manager:dock', onPref)
          return () => window.removeEventListener('injection-manager:dock', onPref)
        }, [setDockHidden])

        const setDockVisible = (visible) => {
          setDockHidden(!visible)
          window.dispatchEvent(new CustomEvent('injection-manager:dock', { detail: { hidden: !visible } }))
        }
        const [verification, setVerification] = useState(null)
        const [verifying, setVerifying] = useState(false)

        const runVerify = async () => {
          setVerifying(true)
          try {
            const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
            const response = await fetch(ROUTES.verify + query, { credentials: 'same-origin' })
            if (!response.ok) {
              const body = await response.json().catch(() => null)
              throw new Error((body && (body.error || body.message)) || `HTTP ${response.status}`)
            }
            setVerification(await response.json())
          } catch (error) {
            setVerification({ error: String((error && error.message) || error) })
          } finally {
            setVerifying(false)
          }
        }

        return h(
          'div',
          { className: 'ci-list' },
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('verifyTitle')),
            h('div', { className: 'ci-note' }, t('verifyHint')),
            h('button', { type: 'button', className: 'ci-btn', style: { alignSelf: 'flex-start' }, disabled: verifying, onClick: runVerify }, t('verifyNow')),
            verification && verification.error
              ? h('div', { className: 'ci-note warn' }, `${t('verifyFailed')}：${verification.error}`)
              : null,
            verification && !verification.error
              ? h(
                  'div',
                  { className: 'ci-list' },
                  h('div', { className: 'ci-note' }, verification.applied ? t('verifyApplied') : t('verifyNotApplied')),
                  h(
                    'div',
                    { className: 'hint' },
                    t('verifyCounts', {
                      sections: (verification.sections || []).length,
                      contexts: (verification.contexts || []).length,
                      tools: (verification.tools || []).length,
                    }),
                  ),
                )
              : null,
          ),
          h(
            'div',
            { className: 'ci-card' },
            h('h2', null, t('dockCardTitle')),
            h('div', { className: 'ci-note' }, t('dockCardHint')),
            h(
              'div',
              { className: 'ci-rowline' },
              h('span', null, t('showDock')),
              h(Switch, { on: !dockHidden, onChange: (next) => setDockVisible(next), title: t('showDock') }),
            ),
          ),
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
                      h('span', { className: 't' }, lock.reason === 'required-context' ? t('required') : t('locked')),
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
              t('rulesLine', { loaded: snapshot.instructions.files.filter((file) => file.status !== 'missing').length, budget: digits(snapshot.instructions.budgetBytes) }),
            ),
          ),
        )
      }

      // ------------------------------------------------------------ panel


      function shortId(id) {
        const text = String(id ?? '')
        const match = /([0-9a-f]{8})-[0-9a-f]{4}/.exec(text)
        return match === null ? text.slice(0, 12) : match[1]
      }

      // Browser-local preferences. They never touch policy.json — they only
      // change how this panel renders for this user.
      function PreferencesCard({ t }) {
        const [linesOn, setLinesOn] = useStoredState('contentLines', true)
        const [range, setRange] = useStoredState('trendRange', 'all')
        return h(
          'div',
          { className: 'ci-card' },
          h('h2', null, t('v2.prefs')),
          h(
            'div',
            { className: 'ci-prefs' },
            h(
              'div',
              { className: 'ci-prefrow' },
              h('span', { className: 'lbl' }, t('v2.prefLines'), h('span', { className: 'hint' }, t('v2.prefNote'))),
              h(Switch, { on: linesOn, onChange: (next) => setLinesOn(next), title: t('v2.prefLines') }),
            ),
            h(
              'div',
              { className: 'ci-prefrow' },
              h('span', { className: 'lbl' }, t('v2.prefRange')),
              h(RangePills, {
                value: range,
                label: t('v2.prefRange'),
                options: [
                  ['7d', t('trend.range7')],
                  ['30d', t('trend.range30')],
                  ['all', t('trend.rangeAll')],
                ],
                onChange: setRange,
              }),
            ),
          ),
        )
      }

      // Everything the panel knows about versions, and the honest limits of the
      // v2 data set. No plugin version is invented: the host snapshot does not
      // carry one, so this card says what is actually known.
      function VersionCard({ snapshot, t }) {
        const host = snapshot.host !== null && snapshot.host !== undefined ? snapshot.host : {}
        const api = Number(snapshot.apiVersion) || 1
        return h(
          'div',
          { className: 'ci-card' },
          h('h2', null, t('v2.version')),
          host.supported === false ? h('div', { className: 'ci-note warn' }, t('hostOld', { version: host.version, tested: host.tested })) : null,
          h(
            'div',
            { className: 'ci-kv' },
            h('span', { className: 'k' }, t('v2.versionHost')),
            h('b', null, host.version ? t('v2.versionLine', { version: host.version, tested: host.tested }) : t('v2.versionUnknown')),
            h('span', { className: 'k' }, t('v2.apiVersionLabel')),
            h('b', null, `v${api}`),
            h('span', { className: 'k' }, t('v2.languageLabel')),
            h('b', null, t.language || '—'),
          ),
          h('div', { className: 'ci-note' }, t('v2.aboutV2')),
          h('div', { className: 'ci-note' }, t('v2.aboutData')),
          h('div', { className: 'ci-note' }, t('v2.aboutHonesty')),
          h('div', { className: 'ci-foot' }, t('v2.docsHint')),
        )
      }

      // 设置 is everything about the plugin itself and the policy document, so
      // it stacks the three former tabs instead of hiding them behind another
      // level of tabs.
      function SettingsPage({ snapshot, t, act, sessionId, notify }) {
        return h(
          'div',
          { className: 'ci-list' },
          h(SettingsTab, { snapshot, t, act, sessionId, notify }),
          h(BudgetTab, { snapshot, t, act }),
          h(PreferencesCard, { t }),
          h(AboutTab, { snapshot, t, sessionId }),
          h(VersionCard, { snapshot, t }),
        )
      }

      function Panel({ props, compact }) {
        const sessionId = pickSessionId(props)
        const { status, data, error, reload } = useSnapshot(sessionId)
        const t = useLocale(data)
        // Migrate the old two-word tab ids: a stored 'list'/'budget'/'about'
        // would otherwise land on an empty body after this release.
        const [storedTab, setTab] = useStoredState('tab', 'manage')
        const tab = storedTab === 'list' ? 'manage' : storedTab === 'budget' || storedTab === 'about' ? 'settings' : storedTab === 'stats' ? 'insights' : storedTab
        const [filter, setFilter] = useState('all')
        const [busy, setBusy] = useState(false)
        const [notice, setNotice] = useState(null)
        const [drawer, setDrawer] = useState(null)
        const v2 = isV2(data)
        // A v1 host hides the new tab; a stored 'insights' falls back instead of
        // rendering an empty body.
        const activeTab = tab === 'insights' && v2 !== true ? 'manage' : tab
        const trend = useSparkTrend(data ? (data.effective && data.effective.totals ? data.effective.totals.tokens : data.totals.tokens) : 0)
        const noticeTimer = useRef(null)

        const showNotice = useCallback((next, ttl) => {
          setNotice(next)
          if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
          if (ttl !== undefined) noticeTimer.current = setTimeout(() => setNotice(null), ttl)
        }, [])
        useEffect(() => () => { if (noticeTimer.current !== null) clearTimeout(noticeTimer.current) }, [])

        // Another window may have changed the policy; refresh when this one
        // comes back into focus instead of showing stale numbers.
        useEffect(() => {
          if (!data || (data.settings && data.settings.refreshOnFocus === false)) return undefined
          const onFocus = () => reload()
          window.addEventListener('focus', onFocus)
          return () => window.removeEventListener('focus', onFocus)
        }, [data, reload])

        // Escape closes the sidebar panel; the host owns the actual close.
        useEffect(() => {
          if (compact !== true) return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            try {
              const layout = ctxRef.current && ctxRef.current.get && ctxRef.current.get('layout')
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
            } catch {
              /* no layout service */
            }
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [compact])

        const act = useCallback(
          async (action, message) => {
            setBusy(true)
            try {
              await postJson(ROUTES.action, Object.assign({ session: sessionId, label: message }, action))
              // A switch changes health/trend computations, so the 30s read
              // cache must not keep serving the pre-switch health strip.
              RESOURCE_CACHE.clear()
              reload()
              try {
                window.dispatchEvent(new CustomEvent('injection-manager:changed'))
              } catch {
                /* no window in tests */
              }
              showNotice({ kind: 'ok', text: message || t('applied'), undo: true }, 6000)
            } catch (failure) {
              // A failed switch must be visible: silence here would look like
              // the click did nothing.
              showNotice({ kind: 'error', text: `${t('actionFailed')}：${String((failure && failure.message) || failure)}` })
            } finally {
              setBusy(false)
            }
          },
          [sessionId, reload, showNotice, t],
        )

        const onToggle = useCallback(
          (item, next) => {
            const verb = next ? t('turnedOn') : t('turnedOff')
            act({ kind: 'item', channel: item.channel, name: item.name, enabled: next }, `${verb} ${nameOf(t, item)}`)
          },
          [act, t],
        )
        const onGroupToggle = useCallback(
          (group, enabled) => {
            const verb = enabled ? t('turnedOn') : t('turnedOff')
            const count = group.items ? group.items.length : group.count
            const label = `${verb} ${groupLabelOf(t, group)} · ${count} ${t('items')}`
            if (Array.isArray(group.parts) && group.parts.length > 1) {
              act({ kind: 'groups', groups: group.parts, enabled }, label)
            } else {
              act({ kind: 'group', channel: group.channel, group: group.id, enabled }, label)
            }
          },
          [act, t],
        )
        const onUndo = useCallback(() => act({ kind: 'undo' }, t('undone')), [act, t])

        // Cross-tab jumps: the insights page and health checks need to land the
        // reader on a tab (and sometimes a channel filter).
        const openTab = useCallback(
          (next, channel) => {
            if (typeof next === 'string' && next.length > 0) setTab(next === 'stats' ? 'insights' : next)
            if (typeof channel === 'string' && channel.length > 0) setFilter(channel)
          },
          [setFilter, setTab],
        )
        const openContent = useCallback(
          (item) => {
            if (item === null || item === undefined || typeof item !== 'object') return
            const source = data !== null && data !== undefined ? data : null
            const wantedId = typeof item.id === 'string' ? item.id : ''
            const wantedName = typeof item.name === 'string' ? item.name : ''
            const found = source !== null && wantedId.length > 0 && Array.isArray(source.items) ? source.items.find((entry) => entry.id === wantedId) : undefined
            const row = item.tokens === undefined && found !== undefined ? Object.assign({}, found, item) : item
            const channel = String(row.channel || (found !== undefined && found.channel) || '')
            const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : wantedName
            const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : wantedId.length > 0 ? wantedId : `${channel}:${name}`
            if (id.length === 0) return
            const tokens = Number(row.tokens) || 0
            const on = source !== null && typeof policyItemOn === 'function' ? policyItemOn(source, row) : true
            setDrawer({
              channel,
              id,
              name: name.length > 0 ? name : id,
              group: row.groupLabel !== undefined && row.groupLabel !== null ? String(row.groupLabel) : row.group !== undefined && row.group !== null ? String(row.group) : '',
              tokens,
              chars: Number(row.chars) || 0,
              share: source !== null ? pct(tokens, effectiveTotalOf(source)) : null,
              saved: on ? 0 : tokens,
            })
          },
          [data],
        )
        const closeDrawer = useCallback(() => setDrawer(null), [])

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
            h(
              'div',
              { className: 'ci-body grow' },
              h('span', { className: 'ci-sr' }, t('loading')),
              h(
                'div',
                { className: 'ci-skel-kpis', 'aria-hidden': 'true' },
                [0, 1, 2, 3].map((index) => h('div', { className: 'ci-skel', key: index })),
              ),
              h('div', { className: 'ci-skel-strip', 'aria-hidden': 'true' }),
              h(
                'div',
                { className: 'ci-skel-table', 'aria-hidden': 'true' },
                h('div', { className: 'head' }),
                [0, 1, 2, 3, 4, 5].map((index) => h('div', { className: 'row', key: index })),
              ),
            ),
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
              snapshot.host && snapshot.host.supported === false
                ? h('div', { className: 'ci-note warn' }, t('hostOld', { version: snapshot.host.version, tested: snapshot.host.tested }))
                : null,
              h(Kpis, { snapshot, t, trend }),
              h(RequestStrip, { snapshot, t }),
              h(SkillsFocus, { snapshot, t, onFilter: setFilter }),
              h(Composition, { snapshot, t, filter, onFilter: setFilter }),
              snapshot.policy.appliedToThisAgent === false && snapshot.policy.preview && snapshot.policy.preview.savedTokens > 0
                ? h('div', { className: 'ci-note warn' }, t('sessionNotApplied'))
                : null,
              h('div', { className: 'ci-card', style: { padding: '8px 10px' } }, h(ChannelSwitches, { snapshot, t, act })),
              h(
                'div',
                { className: 'ci-list' },
                groups.map((group) => {
                  const state = policyGroupState(snapshot, group)
                  // Does the policy keep this suite out of a new session? If so,
                  // the row says 已关闭 and its switch is the way back.
                  return h(
                    'div',
                    { className: 'ci-mini', key: group.id },
                    h(Dot, { channel: group.channel }),
                    h(
                      'span',
                      { className: 'n', title: `${group.label} · ${group.count} ${t('items')}` },
                      `${groupLabelOf(t, group)} · ${group.count}`,
                      state.on ? null : h('span', { className: 'ci-tag' }, t('closedBadge')),
                    ),
                    h('span', { className: 't' }, token(group.tokens)),
                    h(Switch, {
                      on: state.on,
                      mixed: state.mixed,
                      disabled: busy || state.disabled,
                      onChange: () => {
                        // Turning a suite back on has to also restore the rows
                        // the policy had removed, or it reads as "on" while
                        // half of it is still closed.
                        const closed = state.on ? [] : closedNamesFor(snapshot, group.label)
                        if (closed.length === 0) {
                          onGroupToggle(group, !state.on)
                          return
                        }
                        for (const channel of new Set(closed.map((entry) => entry.channel))) {
                          const names = closed.filter((entry) => entry.channel === channel).map((entry) => entry.name)
                          act({ kind: 'names', channel, names, enabled: true }, `${t('turnedOn')} ${groupLabelOf(t, group)}`)
                        }
                      },
                      title: group.label,
                    }),
                  )
                }),
              ),
              h('div', { className: 'ci-foot' }, `${t('total')} ${digits(snapshot.totals.tokens)} · ${t('savable')} ${digits(snapshot.totals.savableTokens)} (${snapshot.totals.savablePercent}%)`),
              h(Toast, { notice, t, onUndo: () => { setNotice(null); act({ kind: 'undo' }, t('undone')) } }),
            ),
          )
        }

        return h(
          'div',
          { className: 'ci-root' },
          h('style', null, STYLE),
          head,
          h(
            'div',
            { className: 'ci-tabs', role: 'tablist', 'aria-label': t('v2.tabsLabel') },
            (v2 === true
              ? [
                  ['manage', t('tabManage'), t('v2.tabManageHint')],
                  ['insights', t('v2.tabInsights'), t('v2.tabInsightsHint')],
                  ['settings', t('tabSettings'), t('v2.tabSettingsHint')],
                ]
              : [
                  ['manage', t('tabManage'), t('v2.tabManageHint')],
                  ['settings', t('tabSettings'), t('v2.tabSettingsHint')],
                ]
            ).map(([key, label, hint]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'tab',
                  id: 'ci-tab-' + key,
                  'aria-selected': activeTab === key ? 'true' : 'false',
                  'aria-controls': 'ci-tabpanel-' + key,
                  tabIndex: activeTab === key ? 0 : -1,
                  className: activeTab === key ? 'on' : '',
                  title: hint,
                  onClick: () => setTab(key),
                  onKeyDown: (event) => {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                    const keys = v2 === true ? ['manage', 'insights', 'settings'] : ['manage', 'settings']
                    const index = keys.indexOf(activeTab)
                    const next = keys[(index + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
                    event.preventDefault()
                    setTab(next)
                    const node = document.getElementById('ci-tab-' + next)
                    if (node && typeof node.focus === 'function') node.focus()
                  },
                },
                label,
              ),
            ),
          ),
          h(
            'div',
            {
              className: 'ci-body grow',
              role: 'tabpanel',
              id: 'ci-tabpanel-' + activeTab,
              'aria-labelledby': 'ci-tab-' + activeTab,
              tabIndex: -1,
            },
            activeTab === 'manage'
              ? h(
                  'div',
                  { className: 'ci-manage' },
                  snapshot.host && snapshot.host.supported === false
                    ? h('div', { className: 'ci-note warn' }, t('hostOld', { version: snapshot.host.version, tested: snapshot.host.tested }))
                    : null,
                  v2 !== true ? h(V2Gate, { snapshot, t }) : null,
                  h(Kpis, { snapshot, t, trend }),
                  h(RequestStrip, { snapshot, t }),
                  h(ManageHealth, { snapshot, t, sessionId, v2, act, onOpenContent: openContent, onOpenTab: openTab }),
                  snapshot.policy.appliedToThisAgent !== true && snapshot.policy.preview && snapshot.policy.preview.savedTokens > 0
                    ? h('div', { className: 'ci-note warn' }, t('sessionNotApplied'))
                    : null,
                  h(ItemsTable, { snapshot, t, filter, setFilter, onToggle, onGroup: onGroupToggle, onUndo, busy, act, v2, onOpenContent: openContent }),
                )
              : activeTab === 'insights'
                ? h(InsightsTab, { snapshot, t, sessionId, onOpenContent: openContent, onOpenTab: openTab, act })
                : h(SettingsPage, { snapshot, t, act, sessionId, notify: showNotice }),
          ),
          h(Toast, { notice, t, onUndo: () => { setNotice(null); act({ kind: 'undo' }, t('undone')) } }),
          h(ContentDrawer, { target: drawer, sessionId, t, onClose: closeDrawer }),
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
        // The chip is ambient information; poll slowly so it does not compete
        // with the panel's own refresh.
        const { status, data, reload } = useSnapshot(sessionId, 15000)
        const t = useLocale(data)
        const [hidden, setHidden] = useStoredState('dockHidden', false)

        useEffect(() => {
          const onPref = (event) => {
            const detail = event && event.detail
            if (detail && typeof detail.hidden === 'boolean') setHidden(detail.hidden)
          }
          window.addEventListener('injection-manager:dock', onPref)
          window.addEventListener('injection-manager:changed', reload)
          return () => {
            window.removeEventListener('injection-manager:dock', onPref)
            window.removeEventListener('injection-manager:changed', reload)
          }
        }, [setHidden, reload])

        if (status === 'failed') return null
        // Config `dock: false` is the installation-level switch.
        if (data && data.settings && data.settings.dock === false) return null
        if (hidden) return null

        const tokens = data ? data.totals.tokens : null
        const context = data ? data.context : null
        const windowKnown = context !== null && context !== undefined && context.window !== null && context.used !== null
        const open = () => {
          try {
            const layout = ctxRef.current && ctxRef.current.get && ctxRef.current.get('layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('injection-manager')
          } catch {
            /* opening is best effort */
          }
        }
        const hide = () => {
          setHidden(true)
          window.dispatchEvent(new CustomEvent('injection-manager:dock', { detail: { hidden: true } }))
        }
        // The ambient number is the one that decides when a session gets
        // compacted: how much of the window the next request will take. The
        // injected total stays first because it is what this plugin controls.
        const hint = windowKnown
          ? `${t('dockHint')} · ${t('windowUsedOf', { used: token(context.used), window: token(context.window) })}`
          : t('dockHint')

        return h(
          'span',
          { className: 'ci-dock-wrap' },
          h('style', null, DOCK_STYLE),
          h(
            'button',
            { type: 'button', className: 'ci-dock' + (windowKnown && context.tone === 'danger' ? ' warn' : ''), onClick: open, title: hint },
            h('i', null),
            h('b', null, tokens === null ? '…' : token(tokens)),
            windowKnown ? h('em', null, `${context.occupancy}%`) : data && data.totals.savableTokens > 0 ? h('em', null, `${data.totals.savablePercent}%`) : null,
          ),
          h(
            'button',
            { type: 'button', className: 'ci-dock-x', onClick: hide, title: t('hideDock'), 'aria-label': t('hideDock') },
            '×',
          ),
        )
      }

      function PanelIcon() {
        // The sidebar panellist renders one icon per panel, so this is the
        // entry point. Same funnel as icon.svg, drawn in currentColor so it
        // follows the host's selected/unselected state; only the terminus dot
        // keeps the brand blue.
        return h(
          'svg',
          { viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2, y: 3.2, width: 16, height: 3.1, rx: 1.55, fill: 'currentColor', opacity: 0.9 }),
          h('rect', { x: 2, y: 8.4, width: 11.5, height: 3.1, rx: 1.55, fill: 'currentColor', opacity: 0.62 }),
          h('rect', { x: 2, y: 13.6, width: 7, height: 3.1, rx: 1.55, fill: 'currentColor', opacity: 0.34 }),
          h('circle', { cx: 15.6, cy: 15.1, r: 2.2, fill: '#4d6bfe' }),
        )
      }

      let applyStarted = false
      let localeRegistered = false

      function panelLabel(ctx) {
        try {
          const bound = ctx.locale.bind('injection-manager')
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
            if (optional !== true) console.error(`[injection-manager] slot registration failed: ${key}`, error)
          }
        }

        attempt(
          'sidebar',
          () => {
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({ name: 'sidebar.panellist', id: 'injection-manager', order: 6, label: () => panelLabel(ctx) }, guarded(PanelIcon)),
            )
          },
          false,
        )
        attempt('main', () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'injection-manager' }, guarded(MainPanel))), false)
        // Optional right-sidebar body: only registered when the host declares
        // that slot, so profiles without it lose nothing.
        attempt(
          'sidebar-body',
          () => ctx.slots.inject('sidebar.panel', () => ctx.slots.register({ name: 'sidebar.panel', id: 'injection-manager', order: 6 }, guarded(SidePanel))),
          true,
        )
        attempt(
          'dock',
          () =>
            ctx.slots.inject('conversation.composer.dock', () =>
              ctx.slots.register({ name: 'conversation.composer.dock', id: 'injection-manager', order: 6 }, guarded(DockChip)),
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
                const dicts = {}
                for (const code of SUPPORTED) {
                  if (payload && payload[code] !== undefined) dicts[code] = payload[code]
                }
                ctx.locale.register('injection-manager', dicts)
              } catch (error) {
                console.warn('[injection-manager] locale registration unavailable', error)
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
            console.error('[injection-manager] apply failed', error)
          }
        },
      }
    },
  })
})()
