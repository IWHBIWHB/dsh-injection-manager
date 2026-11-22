// Ownership and controllability catalog for every surface that can put text in
// front of the model in DSH 0.2.2.
//
// The mapping is derived from the installed host source (see
// docs/INJECTION-PANORAMA.md for the per-entry evidence): each row names the
// package that registers the surface, how the surface enters the request, and
// which side can change it:
//
//   plugin    - a third-party plugin can drop or rewrite it from a supported
//               extension point (the `system-prompt/assemble` waterfall for
//               sections/contexts, `tools.restrict` for schemas)
//   protected - present by contract; the host restores it even when the
//               waterfall removes it (required runtime contexts, a `complete`
//               prompt section)
//   preview   - the plugin can show it exactly but cannot remove it; the user
//               changes it in the host UI or a workspace file
//   user      - user-authored content carried in messages; only the user
//               decides what enters the conversation
//
// Nothing here guesses: a surface with no catalog row is classified by prefix
// and reported as unknown (`preview`) instead of claiming control.
import { CHANNELS } from './policy.js'

export const CONTROL = Object.freeze({
  plugin: 'plugin',
  protected: 'protected',
  preview: 'preview',
  user: 'user',
})

const CONTROL_LABEL = Object.freeze({
  plugin: { zh: '插件可管', en: 'plugin-controlled' },
  protected: { zh: '宿主保护', en: 'host-protected' },
  preview: { zh: '只能预览', en: 'preview-only' },
  user: { zh: '用户内容', en: 'user content' },
})

// Section-name rules. First match wins, so specific prefixes precede generic.
const SECTION_RULES = [
  {
    match: /^harness:identity$/,
    owner: 'dsh-system-prompt',
    kind: 'identity',
    control: CONTROL.plugin,
    evidence: 'dsh-system-prompt/src/index.ts:458',
  },
  {
    match: /^deployment:persona-(prefix|suffix)$/,
    owner: 'dsh-persona / agent preset',
    kind: 'persona',
    control: CONTROL.plugin,
    // An agent preset may register the persona as a `complete` section; the
    // assembly restores that exact section after the waterfall, so a plugin
    // rewrite is discarded. Detection happens at capture time, not here.
    note: { zh: '预设把 persona 标成 complete 时，宿主会在 waterfall 之后还原它', en: 'A preset that marks persona complete restores it after the waterfall' },
    evidence: 'dsh-system-prompt/src/index.ts:44-74, dsh-persona/src/index.ts:65',
  },
  {
    match: /^plan:policy$/,
    owner: 'dsh-plan-mode',
    kind: 'policy',
    control: CONTROL.plugin,
    evidence: 'dsh-plan-mode/src/index.ts:199',
  },
  {
    match: /^team:policy$/,
    owner: 'dsh-tool-agent-team',
    kind: 'policy',
    control: CONTROL.plugin,
    evidence: 'dsh-tool-agent-team/src/index.ts:114',
  },
  {
    match: /^tools:(sdk|ptc-only)$/,
    owner: 'dsh-tool-executor-ptc',
    kind: 'tool-guidance',
    control: CONTROL.plugin,
    evidence: 'dsh-tool-executor-ptc/src/index.ts:36-37',
  },
  {
    match: /^tool:/,
    owner: 'tool package (dsh-tool-*)',
    kind: 'tool-guidance',
    control: CONTROL.plugin,
    evidence: 'e.g. dsh-tool-fs/src/index.ts:65-79, dsh-tool-bash/src/index.ts:272',
  },
  {
    match: /^mcp:/,
    owner: 'MCP server instructions (dsh-mcp-client)',
    kind: 'mcp-instructions',
    control: CONTROL.plugin,
    evidence: 'dsh-mcp-client/src/index.ts:35',
  },
  {
    match: /^mcp-resource-servers$/,
    owner: 'dsh-mcp-resources',
    kind: 'mcp-instructions',
    control: CONTROL.plugin,
    evidence: 'dsh-mcp-resources/src/index.ts:64',
  },
  {
    match: /^harness:source$/,
    owner: 'dsh-harness-dev-context',
    kind: 'dev-context',
    control: CONTROL.plugin,
    evidence: 'dsh-harness-dev-context/src/index.ts:134',
  },
  {
    match: /^app:web-surface$/,
    owner: 'dsh-harness-dev-context',
    kind: 'dev-context',
    control: CONTROL.plugin,
    evidence: 'dsh-harness-dev-context/src/index.ts:146',
  },
  {
    match: /^context:file-reference$/,
    owner: 'dsh-file-reference-local',
    kind: 'guidance',
    control: CONTROL.plugin,
    evidence: 'dsh-file-reference-local/src/index.ts:73',
  },
  {
    match: /^ui:deliverable-file-references$/,
    owner: 'dsh-deliverable-file-references',
    kind: 'guidance',
    control: CONTROL.plugin,
    evidence: 'dsh-deliverable-file-references/src/index.ts:27',
  },
  {
    match: /^computer-use:/,
    owner: 'dsh-cua',
    kind: 'tool-guidance',
    control: CONTROL.plugin,
    evidence: 'dsh-cua/src/index.ts:365',
  },
]

// Dynamic-context rules (the runtime-context snapshot message).
const CONTEXT_RULES = [
  {
    match: /^working-directory:current$/,
    owner: 'dsh-working-directory',
    kind: 'environment',
    control: CONTROL.protected,
    note: { zh: 'required 上下文：宿主的 refreshContext 会还原它', en: 'required context: refreshContext restores it' },
    evidence: 'dsh-working-directory/src/index.ts:109-113',
  },
  {
    match: /^sandbox:policy$/,
    owner: 'dsh-sandbox-policy',
    kind: 'policy',
    control: CONTROL.plugin,
    evidence: 'dsh-sandbox-policy/src/index.ts:183',
  },
  {
    match: /^approval:policy$/,
    owner: 'dsh-user-approval',
    kind: 'policy',
    control: CONTROL.plugin,
    evidence: 'dsh-user-approval/src/index.ts:190',
  },
  {
    match: /^subagent:identity$/,
    owner: 'dsh-tool-subagent-control',
    kind: 'delegation',
    control: CONTROL.protected,
    note: { zh: 'required 上下文：子智能体身份，宿主会还原', en: 'required context: child identity, restored by the host' },
    evidence: 'dsh-tool-subagent-control/src/index.ts:85-87',
  },
  {
    match: /^tool:.+:depth$/,
    owner: 'dsh-tool-subagent',
    kind: 'delegation',
    control: CONTROL.preview,
    note: { zh: '子代理作用域的委派深度提示', en: 'delegation-depth guidance, child scopes only' },
    evidence: 'dsh-tool-subagent/src/index.ts:379-381',
  },
  {
    match: /^subagent:delegation$/,
    owner: 'dsh-subagent',
    kind: 'delegation',
    control: CONTROL.preview,
    note: { zh: '只在子智能体的作用域里出现', en: 'registered in child-agent scopes only' },
    evidence: 'dsh-subagent/src/child-agent.ts:206',
  },
  {
    match: /^harness:source$/,
    owner: 'dsh-harness-dev-context',
    kind: 'dev-context',
    control: CONTROL.plugin,
    evidence: 'dsh-harness-dev-context/src/index.ts:140',
  },
  {
    match: /^app:web-surface$/,
    owner: 'dsh-harness-dev-context',
    kind: 'dev-context',
    control: CONTROL.plugin,
    evidence: 'dsh-harness-dev-context/src/index.ts:152',
  },
]

// Message-level surfaces: user-role snapshots and notices that agent-loop
// appends to the conversation instead of the prompt. A plugin sees them in the
// `agent/pre-step` payload; removal is experimental and per-kind because the
// host may re-offer the same message on the next step.
const MESSAGE_RULES = [
  {
    match: 'runtime-context',
    owner: 'optional runtime contexts',
    kind: 'environment',
    control: CONTROL.plugin,
    manage: { zh: '在「管理」页关掉对应的上下文项', en: 'switch the matching context item off on the Manage page' },
    evidence: 'dsh-agent-loop/src/agent.ts:452-477, dsh-system-prompt/src/index.ts:90-93',
  },
  {
    match: 'agent-instructions',
    owner: 'AGENTS.md / CLAUDE.md chain',
    kind: 'workspace-rules',
    control: CONTROL.user,
    manage: {
      zh: '改用户级 ~/.dsh/AGENTS.md 或工作区 AGENTS.md；面板只能预览摘要与生效文件',
      en: 'edit ~/.dsh/AGENTS.md or the workspace AGENTS.md; the panel previews the active files',
    },
    evidence: 'dsh-agent-instructions/src/index.ts:88,197',
  },
  {
    match: 'skill-catalog',
    owner: 'skill catalog (dsh-tool-skill)',
    kind: 'skills',
    control: CONTROL.user,
    manage: {
      zh: '在「管理 → 技能」里逐个关闭，或在 ~/.dsh/skills / 项目 .dsh/skills 里删除/改名技能',
      en: 'switch individual skills off on Manage, or edit ~/.dsh/skills / the project .dsh/skills',
    },
    evidence: 'dsh-tool-skill/src/index.ts:281-320',
  },
  {
    match: 'time-context',
    owner: 'dsh-time-context',
    kind: 'environment',
    control: CONTROL.preview,
    manage: { zh: '宿主自动注入的当前时间，无法关闭', en: 'host-injected clock; no switch' },
    evidence: 'dsh-time-context/src/index.ts:238',
  },
  {
    match: 'tmux-context',
    owner: 'dsh-tmux-context',
    kind: 'terminal',
    control: CONTROL.preview,
    manage: { zh: '来自 tmux 面板的终端快照，关掉 tmux 面板即不再出现', en: 'terminal snapshot from the tmux panel; close the panel to stop it' },
    evidence: 'dsh-tmux-context/src/index.ts:265',
  },
  {
    match: 'repeat-tool-reminder',
    owner: 'dsh-repeat-tool-reminder',
    kind: 'reminder',
    control: CONTROL.preview,
    manage: { zh: '同一工具连续重复调用时的提醒，宿主行为', en: 'reminder after repeated calls of one tool; host behavior' },
    evidence: 'dsh-repeat-tool-reminder/src/index.ts:212',
  },
  {
    match: 'plan-mode',
    owner: 'dsh-plan-mode',
    kind: 'mode',
    control: CONTROL.preview,
    manage: { zh: '切换会话模式（标准 / 计划）时出现', en: 'appears when the session mode changes' },
    evidence: 'dsh-plan-mode/src/index.ts:478',
  },
  {
    match: 'goal',
    owner: 'dsh-goal-round-driver',
    kind: 'goal',
    control: CONTROL.preview,
    manage: { zh: '目标轮次续跑的上下文；在目标面板里结束目标即可停止', en: 'goal-round continuation; end the goal to stop it' },
    evidence: 'dsh-goal-round-driver/src/index.ts:194',
  },
  {
    match: 'compaction',
    owner: 'compaction summary',
    kind: 'compaction',
    control: CONTROL.preview,
    manage: { zh: '压缩摘要，由上下文压力触发；/compact 可手动触发', en: 'compaction summary; triggered by context pressure or /compact' },
    evidence: 'dsh-compaction-basic/src/region.ts:412-506',
  },
  { match: 'action-cards', owner: 'dsh-action-cards', kindLabel: 'action-cards', control: CONTROL.preview, manage: { zh: '动作卡投影，宿主自动维护', en: 'action-card projection maintained by the host' }, evidence: 'dsh-action-cards/src/index.ts:63' },
  { match: 'model-selection', owner: 'dsh-agent', kindLabel: 'model-selection', control: CONTROL.preview, manage: { zh: '切换模型时注入的说明', en: 'notice injected when the model changes' }, evidence: 'dsh-agent/src/index.ts:125' },
  { match: 'schedule', owner: 'dsh-schedule', kindLabel: 'schedule', control: CONTROL.preview, manage: { zh: '定时任务触发时的上下文', en: 'context from a scheduled task run' }, evidence: 'dsh-schedule/src/index.ts:7' },
  { match: 'tool-goal', owner: 'dsh-tool-goal', kindLabel: 'goal', control: CONTROL.preview, manage: { zh: '目标工具写入的上下文', en: 'context written by the goal tool' }, evidence: 'dsh-tool-goal/src/index.ts:15' },
  { match: 'tool-jobs', owner: 'dsh-tool-jobs', kindLabel: 'jobs', control: CONTROL.preview, manage: { zh: '后台任务结果注入', en: 'background-job result context' }, evidence: 'dsh-tool-jobs/src/index.ts:28' },
  { match: 'ptc-mode', owner: 'dsh-tool-executor-ptc', kindLabel: 'ptc-mode', control: CONTROL.preview, manage: { zh: 'PTC 运行模式说明', en: 'PTC execution-mode notice' }, evidence: 'dsh-tool-executor-ptc/src/index.ts:68' },
  { match: 'user-approval', owner: 'dsh-user-approval', kindLabel: 'approval', control: CONTROL.preview, manage: { zh: '审批结果通知', en: 'approval outcome notice' }, evidence: 'dsh-user-approval/src/index.ts:16' },
  { match: 'working-directory', owner: 'dsh-working-directory', kindLabel: 'environment', control: CONTROL.preview, manage: { zh: '工作目录变化通知', en: 'working-directory change notice' }, evidence: 'dsh-working-directory/src/index.ts:48' },
  { match: 'tool-registry', owner: 'dsh-tools', kindLabel: 'tools', control: CONTROL.preview, manage: { zh: '工具注册变化通知', en: 'tool-registry change notice' }, evidence: 'dsh-tools/src/index.ts:28' },
  { match: 'cordis-host-runner', owner: 'dsh-cordis-host-runner', kindLabel: 'runner', control: CONTROL.preview, manage: { zh: '宿主运行器消息', en: 'host-runner message' }, evidence: 'dsh-cordis-host-runner/src/index.ts:14' },
  {
    match: 'user',
    owner: 'your message',
    kind: 'user',
    control: CONTROL.user,
    manage: { zh: '你自己发的消息', en: 'your own message' },
    evidence: 'dsh-llm message source',
  },
]

function labelFor(control) {
  return CONTROL_LABEL[control] ?? CONTROL_LABEL.preview
}

function unknown(owner, evidence) {
  return {
    owner,
    kind: 'unknown',
    control: CONTROL.preview,
    note: { zh: '目录里没有这类来源，只能预览', en: 'not in the catalog; preview only' },
    evidence,
  }
}

/** Classify one prompt-section name. */
export function sectionOwner(name) {
  const value = String(name ?? '')
  for (const rule of SECTION_RULES) {
    if (rule.match.test(value)) return { ...rule }
  }
  return unknown('unknown section provider', 'no catalog row')
}

/** Classify one dynamic-context name. */
export function contextOwner(name) {
  const value = String(name ?? '')
  for (const rule of CONTEXT_RULES) {
    if (rule.match.test(value)) return { ...rule }
  }
  return unknown('unknown context provider', 'no catalog row')
}

/** Classify one tool schema name. */
export function toolOwner(name) {
  const value = String(name ?? '')
  if (value.startsWith('mcp__')) {
    const server = value.slice(5).split('__')[0] || 'mcp'
    return {
      owner: `MCP server "${server}"`,
      kind: 'mcp-tool',
      control: CONTROL.plugin,
      evidence: 'dsh-mcp-manager/src/*.ts registers mcp__<server>__<tool> schemas',
    }
  }
  if (value.startsWith('job_')) {
    return { owner: 'dsh-tool-jobs', kind: 'builtin-tool', control: CONTROL.plugin, evidence: 'dsh-tool-jobs/src/index.ts' }
  }
  if (value.startsWith('schedule_')) {
    return { owner: 'dsh-tool-schedule', kind: 'builtin-tool', control: CONTROL.plugin, evidence: 'dsh-tool-schedule/src/index.ts' }
  }
  if (value === 'web_search' || value === 'web_fetch') {
    return { owner: 'dsh-tool-web', kind: 'builtin-tool', control: CONTROL.plugin, evidence: 'dsh-tool-web/src/index.ts' }
  }
  if (value === 'subagent' || value === 'subagent_fork') {
    return { owner: 'dsh-tool-subagent', kind: 'delegation-tool', control: CONTROL.plugin, evidence: 'dsh-tool-subagent/src/index.ts' }
  }
  const known = {
    read: 'dsh-tool-fs',
    write: 'dsh-tool-fs',
    edit: 'dsh-tool-fs',
    apply_patch: 'dsh-tool-fs',
    glob: 'dsh-tool-fs-search',
    grep: 'dsh-tool-fs-search',
    bash: 'dsh-tool-bash',
    pwsh: 'dsh-tool-pwsh',
    jobs: 'dsh-tool-jobs',
    terminal: 'dsh-tool-terminal',
    web_search: 'dsh-tool-web',
    web_fetch: 'dsh-tool-web',
    context_injection: 'dsh-injection-manager',
    skill: 'dsh-tool-skill',
    workflow: 'dsh-tool-workflow',
    schedule: 'dsh-tool-schedule',
    goal: 'dsh-tool-goal',
    agent_team: 'dsh-tool-agent-team',
    run_code: 'dsh-tool-executor-ptc',
    working_directory: 'dsh-tool-working-directory',
    present: 'dsh-tool-present',
    plugin_manager: 'dsh-plugin-manager',
    ask_user_question: 'dsh-tool-ask-user',
    todo_write: 'dsh-tool-todo',
    create_goal: 'dsh-tool-goal',
    get_goal: 'dsh-tool-goal',
    update_goal: 'dsh-tool-goal',
    list_agents: 'dsh-tool-agent-team',
    send_message: 'dsh-tool-agent-team',
    wait_agent: 'dsh-tool-agent-team',
    list_subagent_models: 'dsh-tool-subagent',
    create_worktree: 'dsh-tool-worktree',
  }
  if (known[value] !== undefined) {
    return { owner: known[value], kind: 'builtin-tool', control: CONTROL.plugin, evidence: `${known[value]}/src/index.ts` }
  }
  return unknown('unknown tool provider', 'no catalog row')
}

/** Classify one message source kind. */
export function messageOwner(kind) {
  const value = String(kind ?? '')
  for (const rule of MESSAGE_RULES) {
    if (rule.match === value) return { ...rule }
    if (rule.match instanceof RegExp && rule.match.test(value)) return { ...rule }
  }
  if (value === 'attachment' || value === 'file' || value === 'file-reference' || value === 'directory') {
    return {
      owner: 'attachment / file reference',
      kind: 'user-file',
      control: CONTROL.user,
      manage: { zh: '输入框里的 @ 文件、附件与引用；去掉它们即不再进入上下文', en: 'files attached or @@-referenced in the composer' },
      evidence: 'dsh-attachment / dsh-file-reference packages',
    }
  }
  return unknown(`message source "${value || 'unknown'}"`, 'no catalog row')
}

/** Public catalog rows for the client's "user-managed" reference list. */
export function catalogRows() {
  return {
    sections: SECTION_RULES.map((rule) => ({ pattern: String(rule.match), owner: rule.owner, kind: rule.kind, control: rule.control, manage: rule.manage, note: rule.note })),
    contexts: CONTEXT_RULES.map((rule) => ({ pattern: String(rule.match), owner: rule.owner, kind: rule.kind, control: rule.control, manage: rule.manage, note: rule.note })),
    messages: MESSAGE_RULES.map((rule) => ({ kind: String(rule.match), owner: rule.owner, kindLabel: rule.kindLabel ?? rule.kind, control: rule.control, manage: rule.manage })),
  }
}

/** One row for a captured item, ready for the UI. */
export function describeItem(surface, name) {
  let meta
  if (surface === 'section') meta = sectionOwner(name)
  else if (surface === 'context') meta = contextOwner(name)
  else if (surface === 'tool') meta = toolOwner(name)
  else if (surface === 'message') meta = messageOwner(name)
  else if (surface === 'variable') {
    meta = { owner: 'interpolation variable (host)', kind: 'variable', control: CONTROL.plugin, evidence: 'dsh-system-prompt/src/index.ts:172-182' }
  } else meta = unknown('unknown surface', 'no catalog row')
  return {
    owner: meta.owner,
    kind: meta.kind,
    control: meta.control,
    controlLabel: labelFor(meta.control),
    note: meta.note,
    manage: meta.manage,
    evidence: meta.evidence,
  }
}

export const CHANNEL_ORDER = CHANNELS
