// Text renderings of a snapshot: a compact Markdown card for the model-facing
// tool and the slash command, and a plain-text report for terminals and logs.
//
// Both are produced from the same snapshot the panel renders, so the model and
// the user are looking at identical numbers.
import { formatTokens, groupDigits, percent } from './measure.js'
import { policyFilePath } from './policy.js'

const CHANNEL_TITLES = {
  sections: '系统提示词段落',
  contexts: '运行时上下文',
  skills: '技能目录',
  tools: '工具 schema',
  instructions: '工作区规则',
}

const statusText = (status) => {
  if (status === 'missing') return '缺失'
  if (status === 'over-budget') return '超预算'
  if (status === 'unreadable') return '读不了'
  return '加载'
}

/**
 * What a model can DO with this snapshot.
 *
 * The tool is read-only by design, so the honest answer is "these switches exist,
 * here is what they would save, and a human has to press one". A model that
 * reads a table without this sentence can only describe it; a model that reads
 * this sentence knows the next move is a sentence to its user, not a tool call.
 */
function advice(snapshot) {
  const total = Math.max(1, snapshot.totals.tokens)
  const context = snapshot.context
  const skills = snapshot.skillsState ?? {}
  const biggest = (snapshot.groups ?? []).filter((group) => group.savableTokens > 0)[0]
  const lines = []

  // Skills first: a user who collected hundreds of skills is the user this
  // plugin is for, and their catalog is the line that actually answers "why is
  // my prompt so big".
  if (Number.isFinite(skills.catalogTokens) && skills.catalogTokens > 0) {
    const heaviest = skills.heaviest ? `，最大的是 ${skills.heaviest.name}（${formatTokens(skills.heaviest.tokens)}）` : ''
    lines.push(
      `- 技能目录：${skills.total ?? 0} 个技能共 ${formatTokens(skills.catalogTokens)} token，占首轮 ${skills.catalogShare}%，平均每个 ${formatTokens(skills.averageTokens ?? 0)}${heaviest}。收藏越多，这条越长——它对每个请求都生效。`,
    )
  }

  const overBudget = snapshot.policy.budget.tokens > 0 && snapshot.policy.preview.after > snapshot.policy.budget.tokens
  const nearWindow = context !== undefined && context !== null && Number.isFinite(context.occupancy) && context.occupancy >= 70
  if (nearWindow || overBudget) {
    const why = nearWindow ? `窗口已用 ${context.occupancy}%` : `策略后 ${formatTokens(snapshot.policy.preview.after)} 仍超预算 ${formatTokens(snapshot.policy.budget.tokens)}`
    lines.push(`- **${why}**：先关最大的可关套件${biggest === undefined ? '' : `（${biggest.label}，−${formatTokens(biggest.savableTokens)}）`}，而不是逐个条目挑。`)
  } else if (biggest !== undefined && biggest.savableTokens / total >= 0.2) {
    lines.push(
      `- 最大的可关套件是 **${biggest.label}**：${biggest.count} 条、${formatTokens(biggest.savableTokens)} token（占首轮 ${percent(biggest.savableTokens, total)}%）。关掉整套比逐条关划算。`,
    )
  }

  if (snapshot.policy.appliedToThisAgent !== true) {
    lines.push('- 本会话**没有**受当前策略影响（策略只作用于之后新建的会话）；改完策略要让用户开一个新会话才会看到效果。')
  }
  if (context !== undefined && context !== null && context.compaction !== undefined && context.compaction !== null && context.compaction.saved > 0) {
    lines.push(`- 宿主已经压缩过 ${context.compaction.count + context.compaction.prunes} 次、释放 ${formatTokens(context.compaction.saved)} token；压缩不可逆，需要原文时让用户尽早看。`)
  }

  lines.push(
    '- 开关只能由用户在侧栏面板点：模型侧工具 `context_injection` 只读，没有写入口。要动手就对用户说清楚「关哪一套、省多少、什么时候生效」。',
  )
  return lines
}

/**
 * Tool card: one table for the four manageable channels plus the read-only
 * instruction chain, the current policy, and what it would save next session.
 */
export function renderCard(snapshot) {
  const totals = snapshot.totals
  const policy = snapshot.policy
  const preview = policy.preview
  const rows = [
    '| 通道 | token | 条目 | 可关 |',
    '| --- | ---: | ---: | ---: |',
    ...snapshot.channels.map(
      (channel) =>
        `| ${CHANNEL_TITLES[channel.id] ?? channel.id} | ${groupDigits(channel.tokens)} | ${channel.count} | ${
          channel.manageable ? `${formatTokens(channel.savableTokens)}` : '只读'
        } |`,
    ),
    `| **合计** | **${groupDigits(totals.tokens)}** | ${snapshot.items.length} | 可省 ${formatTokens(totals.savableTokens)}（${totals.savablePercent}%） |`,
  ]

  const top = snapshot.items
    .filter((item) => !item.locked)
    .slice()
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 5)
    .map((item) => `- \`${item.name}\`（${CHANNEL_TITLES[item.channel] ?? item.channel}）${groupDigits(item.tokens)} token`)

  const suites = (snapshot.groups ?? [])
    .slice(0, 5)
    .map((group) => `- ${group.label} · ${group.count} 条 · ${formatTokens(group.tokens)} token（可关 ${formatTokens(group.savableTokens)}）`)

  const skills = snapshot.skillsState ?? {}
  const skillLine =
    Number.isFinite(skills.catalogTokens) && skills.catalogTokens > 0
      ? `**技能目录（收藏越多越长）** ${skills.total ?? 0} 个 · ${formatTokens(skills.catalogTokens)} token · 占首轮 ${skills.catalogShare}%`
      : null

  const lines = [
    `### 上下文注入 · 首轮 ${formatTokens(totals.tokens)} token`,
    '',
    ...(skillLine === null ? [] : [skillLine, '']),
    ...rows,
    '',
    ...windowLines(snapshot, true),
    '**能做什么**',
    ...advice(snapshot),
    '',
    '**最大的套件（可一键关整套）**',
    ...(suites.length > 0 ? suites : ['- 无']),
    '',
    '**占用最大的可关条目**',
    ...(top.length > 0 ? top : ['- 无']),
    '',
    '**当前策略**',
    `预设 ${policy.preset} · 段落 ${describe(policy.sections)} · 上下文 ${describe(policy.contexts)} · 技能 ${describe(policy.skills)} · 工具 ${describe(policy.tools)}`,
    `→ 新会话首轮 ≈ ${groupDigits(preview.after)} token（−${formatTokens(preview.savedTokens)}，−${preview.savedPercent}%）`,
    policy.prompt.prefix.trim().length > 0 ? `自定义前言 ${policy.prompt.prefix.trim().length} 字；后记 ${policy.prompt.suffix.trim().length} 字` : null,
    '',
    `<sub>token 为估算（ASCII÷4 + 非 ASCII÷1.6）；工作区规则由 DSH 直接注入，本插件只读不改；策略只影响之后新建的会话</sub>`,
  ].filter((line) => line !== null)
  return lines.join('\n')
}

const describe = (channel) => {
  if (channel.mode === 'all') return '全部'
  const names = channel.names.length > 0 ? channel.names.join('、') : '（空）'
  return `${channel.mode === 'only' ? '仅' : '排除'} ${names}`
}

/**
 * The context-window block shared by the card and the text report. Absent when
 * the host has not measured this session yet — a made-up denominator is worse
 * than a missing one.
 */
function windowLines(snapshot, markdown) {
  const context = snapshot.context
  if (context === undefined || context === null || context.window === null || context.used === null) return []
  const head = markdown === true ? '**上下文窗口** ' : '上下文窗口：'
  const lines = [
    `${head}${groupDigits(context.used)} / ${groupDigits(context.window)} token（已用 ${context.occupancy}%，剩余 ${groupDigits(context.remaining)}）`,
  ]
  if (context.breakdown !== null && context.breakdown !== undefined) {
    const b = context.breakdown
    lines.push(`本次请求构成（估算）：系统 ${groupDigits(b.system)} · 工具 ${groupDigits(b.tools)} · 消息 ${groupDigits(b.messages)}`)
  }
  const compaction = context.compaction
  if (compaction !== undefined && compaction !== null && (compaction.count > 0 || compaction.prunes > 0)) {
    const parts = []
    if (compaction.count > 0) parts.push(`摘要 ${compaction.count} 次`)
    if (compaction.prunes > 0) parts.push(`剪枝 ${compaction.prunes} 次`)
    parts.push(`省下 ${groupDigits(compaction.saved)} token`)
    if (compaction.failures > 0) parts.push(`失败 ${compaction.failures} 次`)
    lines.push(`已压缩：${parts.join(' · ')}（本插件装载后记录）`)
  }
  lines.push('')
  return lines
}

/** Plain-text report used by `/inject` in a terminal and by the diag route. */
export function renderText(snapshot) {
  const lines = []
  lines.push('上下文注入管理 — 本轮请求的注入构成（估算：ASCII÷4 + 非 ASCII÷1.6）')
  lines.push(`工作目录：${snapshot.cwd}`)
  lines.push('')

  for (const channel of snapshot.channels) {
    lines.push(
      `${CHANNEL_TITLES[channel.id] ?? channel.id}：${groupDigits(channel.tokens)} token / ${groupDigits(channel.chars)} 字 / ${channel.count} 条`,
    )
  }
  lines.push(`合计：${groupDigits(snapshot.totals.tokens)} token，其中可关 ${groupDigits(snapshot.totals.savableTokens)}（${snapshot.totals.savablePercent}%）`)
  // `windowLines` ends with its own blank separator.
  lines.push(...windowLines(snapshot, false).slice(0, -1))
  lines.push('')

  lines.push('工作区规则（DSH 直接注入，本插件只读）')
  for (const file of snapshot.instructions.files) {
    lines.push(`  [${statusText(file.status)}] ${file.display} — ${groupDigits(file.bytes)} B`)
  }
  for (const warning of snapshot.instructions.warnings) {
    lines.push(`  [告警] ${warning.path} ${groupDigits(warning.bytes)} B 存在但不在加载路径`)
  }
  lines.push('')

  const policy = snapshot.policy
  lines.push(`默认策略（${policy.exists ? '已保存' : '未保存，按全开'}${policy.appliedToThisAgent ? '；已应用到本会话' : '；只对新会话生效'}）`)
  lines.push(`  预设：${policy.preset}`)
  lines.push(`  段落 ${describe(policy.sections)} · 上下文 ${describe(policy.contexts)} · 技能 ${describe(policy.skills)} · 工具 ${describe(policy.tools)}`)
  lines.push(`  新会话首轮 ≈ ${groupDigits(policy.preview.after)} token（−${groupDigits(policy.preview.savedTokens)}，−${policy.preview.savedPercent}%）`)
  if (policy.error !== null) lines.push(`  [告警] 策略文件：${policy.error}`)
  if (policy.lastApplication?.report?.error) lines.push(`  [告警] 最近一次应用失败：${policy.lastApplication.report.error}`)
  lines.push(`  策略文件：${policy.path}`)
  lines.push('')

  if (snapshot.totals.anchor !== null) {
    lines.push(`本会话已占用 ${groupDigits(snapshot.totals.anchor.tokens)} token（含对话历史，与上方注入量不可直接比较）`)
    lines.push('')
  }

  lines.push('限制：')
  lines.push('  - token 是估算，不是分词器结果。')
  lines.push('  - 段落通过作用域内的 system-prompt/assemble 过滤；必填上下文（工作目录、子智能体身份）不可关。')
  lines.push('  - 技能目录按条 shadow；关掉 skill 工具会整段清空目录。')
  lines.push('  - 工作区规则（AGENTS.md 链）在 0.2.2 没有公开抑制钩子，只读展示。')
  lines.push(`  - 可关条目合计占比：${percent(snapshot.totals.savableTokens, snapshot.totals.tokens)}%`)
  const host = snapshot.host && snapshot.host.version ? snapshot.host.version : '未知'
  const depth = snapshot.undo && snapshot.undo.depth ? snapshot.undo.depth : 0
  lines.push('')
  lines.push(`宿主 DSH ${host} · 撤销栈 ${depth} 步 · 策略文件 ${policyFilePath()}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- health

const SEVERITY_LABEL = { high: '高', warn: '注意', info: '信息' }
const TAB_LABEL = { manage: '管理', insights: '洞察', settings: '设置' }

/** One line of human text for a health check's params. */
export function healthCheckText(check) {
  const params = check?.params ?? {}
  switch (check?.code) {
    case 'heavy-suite':
      return `${params.label ?? '套件'} 占首轮 ${params.share ?? 0}%（${formatTokens(params.tokens ?? 0)} token · ${params.count ?? 0} 条）`
    case 'budget-gap':
      return `比预算多 ${formatTokens(params.gap ?? 0)} token（策略后 ${formatTokens(params.current ?? 0)} / 预算 ${formatTokens(params.target ?? 0)}）`
    case 'catalog-truncated':
      return `${params.count ?? 0} 个技能描述被截断（>${params.limit ?? 500} 字）`
    case 'locked-items':
      return `${params.count ?? 0} 项不可关，${formatTokens(params.tokens ?? 0)} token（占 ${params.share ?? 0}%）`
    case 'unknown-window':
      return '宿主还没报告上下文窗口，占用比例未知'
    case 'no-policy':
      return `还没保存过策略（全开），可关 ${formatTokens(params.savableTokens ?? 0)} token`
    case 'empty-catalog':
      return '技能目录为空'
    case 'duplicate-skill':
      return `同名技能来自多个来源${params.name === undefined ? '' : `：${params.name}`}`
    case 'tool-name-collision':
      return `工具名冲突${params.name === undefined ? '' : `：${params.name}`}`
    default:
      return String(check?.code ?? 'unknown')
  }
}

/** The one-line summary appended to `/inject` and shown in the dock tooltip. */
export function renderHealthLine(health) {
  const summary = health?.summary ?? { high: 0, warn: 0, info: 0 }
  const checks = Array.isArray(health?.checks) ? health.checks : []
  if (checks.length === 0) return '健康检查：未发现问题。'
  const head = `健康检查：${summary.high} 高 · ${summary.warn} 注意 · ${summary.info} 信息`
  const first = checks[0]
  const prefix = SEVERITY_LABEL[first.severity] ?? first.severity
  return `${head}；最需关注「${prefix}」${healthCheckText(first)}`
}

/** Full report for `/inject health`. */
export function renderHealthText(health) {
  const summary = health?.summary ?? { high: 0, warn: 0, info: 0 }
  const checks = Array.isArray(health?.checks) ? health.checks : []
  const lines = [`健康检查：${summary.high} 高 · ${summary.warn} 注意 · ${summary.info} 信息`]
  if (checks.length === 0) {
    lines.push('', '没有发现需要处理的项。')
    return lines.join('\n')
  }
  lines.push('')
  checks.forEach((check, index) => {
    const severity = SEVERITY_LABEL[check.severity] ?? check.severity
    lines.push(`${index + 1}. [${severity}] ${check.code} — ${healthCheckText(check)}`)
    const action = check.action
    if (action === undefined || action === null) return
    const payload = action.payload ?? {}
    if (action.kind === 'switch-group') lines.push(`   → 建议关掉「${payload.group ?? payload.key ?? ''}」（POST /action {kind:"group", channel:"${payload.channel ?? ''}", group:"${payload.group ?? ''}", enabled:false}）`)
    else if (action.kind === 'set-budget') lines.push(`   → 把预算调到 ${formatTokens(payload.tokens ?? 0)}（面板设置页）`)
    else if (action.kind === 'open-content') lines.push(`   → 在面板打开内容：${payload.id ?? ''}`)
    else if (action.kind === 'open-tab') lines.push(`   → 打开「${TAB_LABEL[payload.tab] ?? payload.tab ?? ''}」页`)
  })
  lines.push('')
  lines.push('说明：本命令只读；开关在侧栏「上下文注入」面板点，改完策略对之后新建的会话生效。')
  return lines.join('\n')
}
