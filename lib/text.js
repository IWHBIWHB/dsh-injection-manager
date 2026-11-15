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

  const lines = [
    `### 上下文注入 · 首轮 ${formatTokens(totals.tokens)} token`,
    '',
    ...rows,
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
