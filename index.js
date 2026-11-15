// context-preflight：注入前清单（v2）。
//
// 只读：把「下一轮请求会往模型里塞什么、各占多少字符 / 多少 token」摊平，
// 不改任何注入内容，也不提供设置页。
//
// 数据来源分四类，报告里也分得清：
//   1. 画像/规则：按 dsh-agent-instructions 的固定路径探测（存在性 + 字节数），
//      加载范围内的文件另读原文统计字符数。
//   2. 技能目录：ctx.skills.snapshot() 的原始摘要，不是目录渲染后的文本。
//   3. 工具 schema：ctx.tools.schemas(agent) —— 与 cordis_inspect_query host/Tool/listTools
//      取的是同一个调用，保证「清单里的工具名集合」与真机工具名集合完全一致。
//   4. 段落 / 动态上下文：ctx.systemPrompt.assemble() 的实际装配结果。
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'context-preflight'
// 硬依赖：注册工具、读装配结果、读技能目录、取会话工作目录、取当前智能体，以及挂路由的 webServer。
// webServer 必须进 inject：用 ctx.get('webServer') 会在宿主启动早期拿到 undefined，
// 路由于是静默没注册（线上 404 就是这么来的）。tokenMeter 仍可选。
export const inject = ['tools', 'systemPrompt', 'skills', 'workingDirectory', 'agents', 'webServer', 'commands']

const TOOL_NAME = 'context_preflight'
const PING_ROUTE_PATH = '/plugins/dsh-context-preflight/ping'
const ROUTE_PATH = '/plugins/dsh-context-preflight/summary'
// 浏览器文案的唯一来源：locale/zh.json 与 locale/en.json 的 client 段。
const LOCALE_ROUTE_PATH = '/plugins/dsh-context-preflight/locale'
const POLICY_ROUTE_PATH = '/plugins/dsh-context-preflight/policy'
const DIAG_ROUTE_PATH = '/plugins/dsh-context-preflight/diag'
// 浏览器侧把「三条槽位注册各自成没成」报回来，/diag 才能一条 curl 看完。
const REGISTRATIONS_ROUTE_PATH = '/plugins/dsh-context-preflight/registrations'
const BOOT_ROUTE_PATH = '/plugins/dsh-context-preflight/boot'
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

// 最近一次浏览器上报的槽位注册结果（只在内存里，随进程重启清空）。
let lastClientRegistrations = null
// 最近一次浏览器 factory 的启动上报（stage / hasReact / loaderOk / error）。
let lastClientBoot = null

// ---------------------------------------------------------------- 默认注入策略（v4）

// 策略只落在插件自己的数据目录：$DSH_HOME/context-preflight/policy.json。
// 不碰用户工作区，也不碰 ~/.agents/skills。
const POLICY_DIR_NAME = 'context-preflight'
const POLICY_FILE_NAME = 'policy.json'
const POLICY_VERSION = 1
const POLICY_MODES = new Set(['all', 'only', 'except'])

const DEFAULT_POLICY = Object.freeze({
  version: POLICY_VERSION,
  skills: { mode: 'all', names: [] },
  tools: { mode: 'all', names: [] },
  runtimeContext: { enabled: true },
  updatedAt: null,
})

/** $DSH_HOME（默认 ~/.dsh），与 dsh-home-paths 同一套解析。 */
function resolveDshHome() {
  const configured = envPath('DSH_HOME')
  return configured ?? join(homedir(), '.dsh')
}

function policyFilePath() {
  return join(resolveDshHome(), POLICY_DIR_NAME, POLICY_FILE_NAME)
}

// 单次装配的画像文件预算（dsh-agent-instructions 的既有限制）。
const INSTRUCTION_BUDGET_BYTES = 65536
// 技能目录里摘要的渲染上限，超过即被截断。
const SKILL_DESCRIPTION_LIMIT = 500
// 候选文件名与顺序，和 dsh-agent-instructions 的默认配置一致。
const INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
const PROJECT_ROOT_MARKERS = ['.git']

const SKILL_TOP_ROWS = 3
const TOOL_TOP_ROWS = 8

const TOOL_DESCRIPTION =
  '查看本轮请求将注入的内容构成——画像/规则文件、技能目录、工具 schema、运行时上下文——并给出字符数与估算 token，同时给出「默认策略」对新建会话的首轮注入预估。工具本身只读；默认策略由侧边栏面板维护，只影响之后新建的会话。'

// ---------------------------------------------------------------- 计数

const groupDigits = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * 混合估算：ASCII ÷ 4，非 ASCII（CJK 等）÷ 1.6。
 * 纯 ASCII 的 JSON schema 用「字符÷2」会高估近一倍，这是 v1 的失真源。
 */
function countText(text) {
  const source = typeof text === 'string' ? text : ''
  let ascii = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) < 128) ascii += 1
  }
  const wide = source.length - ascii
  return {
    chars: source.length,
    tokens: Math.round(ascii / 4 + wide / 1.6),
  }
}

const emptyMeasure = () => ({ chars: 0, tokens: 0 })

function addMeasure(total, measure) {
  return { chars: total.chars + measure.chars, tokens: total.tokens + measure.tokens }
}

const padColumn = (text, width) => {
  let visible = 0
  for (const ch of text) visible += /[\u1100-\u115f\u2e80-\u303e\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : 1
  return text + ' '.repeat(Math.max(0, width - visible))
}

function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function envPath(envName) {
  const raw = process.env[envName]
  if (raw === undefined || raw.trim().length === 0) return undefined
  return resolvePath(expandHome(raw))
}

function rootDisplay(resolvedRoot, defaultRoot, envName) {
  return resolvePath(resolvedRoot) === resolvePath(defaultRoot) ? undefined : `$${envName}`
}

// ---------------------------------------------------------------- 画像/规则

/** 探测一个候选画像文件：只取存在性与字节数，需要时读原文统计字符数。 */
async function probeInstructionFile(path, { readContent }) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return undefined
  }
  const probe = { path, bytes: stat.size, isFile: stat.isFile() }
  if (probe.isFile && readContent) {
    try {
      probe.measure = countText(await readFile(path, 'utf8'))
    } catch {
      probe.measure = emptyMeasure()
    }
  }
  return probe
}

/** 从 cwd 往上找最近的 .git 祖先；找不到就退回 cwd（与 DSH 的保守回退一致）。 */
function findProjectRoot(cwd) {
  let current = resolvePath(cwd)
  for (;;) {
    if (PROJECT_ROOT_MARKERS.some((marker) => existsSync(join(current, marker)))) return current
    const parent = dirname(current)
    if (parent === current) return resolvePath(cwd)
    current = parent
  }
}

/** 项目根到 cwd 的目录链，含两端，顺序由外到内。 */
function ancestorChain(root, cwd) {
  const chain = []
  let current = resolvePath(cwd)
  const stop = resolvePath(root)
  for (;;) {
    chain.push(current)
    if (current === stop) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return chain.reverse()
}

async function collectInstructions(cwd) {
  const home = homedir()
  const dshHome = envPath('DSH_HOME') ?? join(home, '.dsh')
  const agentsHome = envPath('DSH_AGENTS_HOME') ?? join(home, '.agents')

  const globals = [
    {
      scope: 'user-global',
      path: join(dshHome, 'AGENTS.md'),
      display: `${rootDisplay(dshHome, join(home, '.dsh'), 'DSH_HOME') ?? '~/.dsh'}/AGENTS.md`,
    },
    {
      scope: 'user-global',
      path: join(agentsHome, 'AGENTS.md'),
      display: `${rootDisplay(agentsHome, join(home, '.agents'), 'DSH_AGENTS_HOME') ?? '~/.agents'}/AGENTS.md`,
    },
  ]

  const files = []
  let total = emptyMeasure()
  let overBudgetCount = 0

  for (const global of globals) {
    const probe = await probeInstructionFile(global.path, { readContent: true })
    if (probe === undefined) {
      files.push({ path: global.path, display: global.display, scope: global.scope, status: 'missing' })
      continue
    }
    const overBudget = probe.bytes > INSTRUCTION_BUDGET_BYTES
    if (overBudget) overBudgetCount += 1
    total = addMeasure(total, probe.measure ?? emptyMeasure())
    files.push({
      path: global.path,
      display: global.display,
      scope: global.scope,
      status: overBudget ? 'over-budget' : 'loaded',
      bytes: probe.bytes,
      chars: probe.measure?.chars ?? 0,
      tokens: probe.measure?.tokens ?? 0,
    })
  }

  const cwdAbsolute = resolvePath(cwd)
  let projectRoot
  try {
    projectRoot = findProjectRoot(cwdAbsolute)
  } catch {
    projectRoot = cwdAbsolute
  }
  for (const directory of ancestorChain(projectRoot, cwdAbsolute)) {
    for (const candidate of [...INSTRUCTION_FILE_CANDIDATES, ...LOCAL_INSTRUCTION_FILE_CANDIDATES]) {
      const path = join(directory, candidate)
      const probe = await probeInstructionFile(path, { readContent: true })
      if (probe === undefined) continue
      const overBudget = probe.bytes > INSTRUCTION_BUDGET_BYTES
      if (overBudget) overBudgetCount += 1
      total = addMeasure(total, probe.measure ?? emptyMeasure())
      files.push({
        path,
        display: path,
        scope: 'project',
        status: overBudget ? 'over-budget' : 'loaded',
        bytes: probe.bytes,
        chars: probe.measure?.chars ?? 0,
        tokens: probe.measure?.tokens ?? 0,
      })
    }
  }

  // 存在但根本不在加载路径上的画像文件：只 stat，不读内容。
  const warnings = []
  for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
    const path = join(home, candidate)
    const probe = await probeInstructionFile(path, { readContent: false })
    if (probe === undefined) continue
    warnings.push({ path, bytes: probe.bytes })
  }

  const loadedCount = files.filter((file) => file.status !== 'missing').length
  return {
    budgetBytes: INSTRUCTION_BUDGET_BYTES,
    projectRoot,
    loadedCount,
    overBudgetCount,
    files,
    warnings,
    ...total,
  }
}

// ---------------------------------------------------------------- 技能目录

async function collectSkills(ctx, agent, cwd, signal) {
  const options = { cwd }
  if (agent !== undefined) options.scope = agent
  if (signal !== undefined) options.signal = signal

  let snapshot
  try {
    snapshot = await ctx.skills.snapshot(options)
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }

  const skills = Array.isArray(snapshot?.skills) ? snapshot.skills : []
  const described = skills.map((skill) => {
    const skillName = String(skill.name ?? '')
    const description = typeof skill.description === 'string' ? skill.description : ''
    return {
      name: skillName,
      descriptionChars: description.length,
      measure: countText(`${skillName}\n${description}`),
      modelInvocable: skill.invocation?.modelInvocable === true,
      userInvocable: skill.invocation?.userInvocable === true,
      hasWhenToUse: typeof skill.whenToUse === 'string' && skill.whenToUse.length > 0,
      truncated: description.length > SKILL_DESCRIPTION_LIMIT,
    }
  })

  const modelVisible = described.filter((skill) => skill.modelInvocable)
  const userOnly = described.filter((skill) => !skill.modelInvocable && skill.userInvocable)
  const total = modelVisible.reduce((sum, skill) => addMeasure(sum, skill.measure), emptyMeasure())

  return {
    total: described.length,
    modelVisible: modelVisible.length,
    userOnly: userOnly.length,
    complete: snapshot?.complete === true,
    whenToUseUnused: modelVisible.filter((skill) => skill.hasWhenToUse).length,
    truncated: modelVisible.filter((skill) => skill.truncated).length,
    // 逐条体积：面板与策略预览都要按名字算「拿掉这几个能省多少」。
    rows: modelVisible.map((skill) => ({ name: skill.name, tokens: skill.measure.tokens, chars: skill.measure.chars })),
    longest: [...modelVisible]
      .sort((a, b) => b.descriptionChars - a.descriptionChars)
      .slice(0, SKILL_TOP_ROWS)
      .map((skill) => ({ name: skill.name, descriptionChars: skill.descriptionChars })),
    ...total,
  }
}

// ---------------------------------------------------------------- 工具 schema

/** 与 cordis_inspect_query（host / Tool / listTools）取同一个集合：ctx.tools.schemas(agent)。 */
function collectTools(ctx, agent) {
  const schemas = ctx.tools.schemas(agent)
  const rows = schemas.map((schema) => {
    const toolName = String(schema.name ?? '')
    const description = typeof schema.description === 'string' ? schema.description : ''
    let parameters = ''
    try {
      parameters = JSON.stringify(schema.parameters ?? {}) ?? ''
    } catch {
      parameters = ''
    }
    const measure = countText(`${toolName}\n${description}\n${parameters}`)
    return { name: toolName, deferLoading: schema.deferLoading === true, ...measure }
  })

  const names = rows.map((row) => row.name).sort()
  const total = rows.reduce((sum, row) => addMeasure(sum, row), emptyMeasure())

  return {
    count: rows.length,
    deferred: rows.filter((row) => row.deferLoading).length,
    nameDigest: createHash('sha1').update(names.join('\n')).digest('hex').slice(0, 12),
    names,
    // 全部工具的逐行体积：面板的「策略预览」本地重算要用，不回传会算不准。
    rows: rows.map((row) => ({ name: row.name, chars: row.chars, tokens: row.tokens })),
    largest: [...rows].sort((a, b) => b.chars - a.chars).slice(0, TOOL_TOP_ROWS).map((row) => ({ name: row.name, chars: row.chars })),
    ...total,
  }
}

// ---------------------------------------------------------------- 装配结果

async function collectPrompts(ctx, agent, signal) {
  const context = {}
  if (agent !== undefined) context.scope = agent
  if (signal !== undefined) context.signal = signal

  const assembly = await ctx.systemPrompt.assemble(context)
  const sections = assembly?.sections ?? []
  const contexts = assembly?.contexts ?? []

  const sectionTotal = sections.reduce((sum, section) => addMeasure(sum, countText(section?.text ?? '')), emptyMeasure())
  const contextTotal = contexts.reduce((sum, entry) => addMeasure(sum, countText(entry?.text ?? '')), emptyMeasure())

  return {
    sectionCount: sections.length,
    sectionChars: sectionTotal.chars,
    sectionTokens: sectionTotal.tokens,
    contextCount: contexts.length,
    contextChars: contextTotal.chars,
    contextTokens: contextTotal.tokens,
    sectionNames: sections.map((section) => String(section?.name ?? '')),
  }
}

// ---------------------------------------------------------------- 实测锚点

/** 读该会话最近一次真实请求的 prompt 用量，作为估算锚点。 */
function collectAnchor(ctx, agent) {
  const meter = ctx.get('tokenMeter')
  const session = agent?.session
  if (meter === undefined || session === undefined || session === null) return undefined
  try {
    const pressure = meter.contextPressure(session)
    if (typeof pressure?.pressureTokens === 'number' && pressure.pressureTokens > 0) {
      return { tokens: pressure.pressureTokens, source: 'contextPressure' }
    }
    const measurement = meter.measure(session)
    if (measurement?.baseline?.kind === 'usage' && typeof measurement.baseline.tokens === 'number') {
      return { tokens: measurement.baseline.tokens, source: 'usage.baseline' }
    }
    if (typeof measurement?.totalTokens === 'number' && measurement.totalTokens > 0) {
      return { tokens: measurement.totalTokens, source: 'measure.total' }
    }
  } catch {
    /* 锚点算不出来就不给，界面显示 — */
  }
  return undefined
}

// ---------------------------------------------------------------- 策略：读写与匹配

function normalizeNames(raw) {
  if (!Array.isArray(raw)) return []
  const names = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length === 0 || names.includes(trimmed)) continue
    names.push(trimmed)
  }
  return names
}

function normalizePolicy(raw) {
  const policy = {
    version: POLICY_VERSION,
    skills: { mode: 'all', names: [] },
    tools: { mode: 'all', names: [] },
    runtimeContext: { enabled: true },
    updatedAt: null,
  }
  if (raw === null || typeof raw !== 'object') return policy
  if (raw.skills !== null && typeof raw.skills === 'object') {
    if (POLICY_MODES.has(raw.skills.mode)) policy.skills.mode = raw.skills.mode
    policy.skills.names = normalizeNames(raw.skills.names)
  }
  if (raw.tools !== null && typeof raw.tools === 'object') {
    if (POLICY_MODES.has(raw.tools.mode)) policy.tools.mode = raw.tools.mode
    policy.tools.names = normalizeNames(raw.tools.names)
  }
  if (raw.runtimeContext !== null && typeof raw.runtimeContext === 'object') {
    policy.runtimeContext.enabled = raw.runtimeContext.enabled !== false
  }
  if (typeof raw.updatedAt === 'string') policy.updatedAt = raw.updatedAt
  return policy
}

async function readPolicy() {
  const path = policyFilePath()
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { policy: normalizePolicy(null), path, exists: false }
    return { policy: normalizePolicy(null), path, exists: false, error: `读取失败：${error?.code ?? error}` }
  }
  try {
    return { policy: normalizePolicy(JSON.parse(text)), path, exists: true }
  } catch (error) {
    return { policy: normalizePolicy(null), path, exists: true, error: `JSON 解析失败：${error?.message ?? error}` }
  }
}

async function writePolicy(raw) {
  const policy = normalizePolicy(raw)
  policy.updatedAt = new Date().toISOString()
  const path = policyFilePath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
  return { policy, path }
}

/**
 * 工具名匹配：精确名、`前缀*`、以及以 `_` / `__` 结尾的前缀写法（如 `mcp__rea__`）。
 * 技能名只认精确匹配，由调用方直接比较。
 */
function toolNameMatcher(entries) {
  const exact = new Set()
  const prefixes = []
  for (const entry of normalizeNames(entries)) {
    if (entry === '*') {
      prefixes.push('')
    } else if (entry.endsWith('*')) {
      prefixes.push(entry.slice(0, -1))
    } else if (entry.endsWith('_')) {
      prefixes.push(entry)
    } else {
      exact.add(entry)
    }
  }
  return (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix))
}

/** 按策略算出「会被拿掉的那部分」。返回名字列表，供预览与面板共用。 */
function selectExcludedTools(policy, rows) {
  if (policy.tools.mode === 'all') return []
  const matcher = toolNameMatcher(policy.tools.names)
  return rows.filter((row) =>
    policy.tools.mode === 'only' ? !matcher(row.name) : matcher(row.name),
  )
}

function selectExcludedSkills(policy, rows) {
  if (policy.skills.mode === 'all') return []
  const exact = new Set(normalizeNames(policy.skills.names))
  return rows.filter((row) =>
    policy.skills.mode === 'only' ? !exact.has(row.name) : exact.has(row.name),
  )
}

// ---------------------------------------------------------------- 策略：应用到新会话

// 只记「已经按策略处理过」的 agent，避免同一会话重复注册 shadow。
const policyAppliedAgents = new WeakSet()
// 最近一次策略应用的结果（成功或失败），面板与 /policy 都要能看到，不能只写进日志。
let lastPolicyApplication = null
// 每个 agent 的注册 disposer：插件卸载时也要能解开，不能只等 agent 自己释放。
const policyDisposers = new Map()

function trackDisposer(agent, dispose) {
  if (typeof dispose !== 'function') return
  const key = typeof agent.id === 'string' ? agent.id : 'unknown'
  const list = policyDisposers.get(key) ?? []
  list.push(dispose)
  policyDisposers.set(key, list)
}

/** 插件卸载时解除所有按 agent 注册的策略效果。 */
function releasePolicyDisposers() {
  for (const disposers of policyDisposers.values()) {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        console.error('[context-preflight] policy disposer failed', error)
      }
    }
  }
  policyDisposers.clear()
}

/**
 * 在会话建立后、第一次注入之前应用默认策略。
 * 所有注册都挂在 agent 自己的作用域上（agent.ctx），随该 agent 一起释放，
 * 因此只影响之后新建的会话，不会动已经在跑的会话。
 */
async function applyPolicyToAgent(ctx, agent, source) {
  if (agent === undefined || agent === null) return
  if (policyAppliedAgents.has(agent)) return
  policyAppliedAgents.add(agent)

  const agentCtx = agent.ctx
  const report = { sessionId: typeof agent.id === 'string' ? agent.id : '(unknown)', source }
  if (agentCtx === undefined || agentCtx === null) {
    console.error('[context-preflight] policy skipped: agent has no scoped context', report)
    return
  }

  const { policy, path, error } = await readPolicy()
  report.path = path
  if (error !== undefined) report.policyError = error

  // agent.ctx 只声明了它自己要用的服务；skills / systemPrompt 必须通过 inject()
  // 拿到一个声明过依赖的子上下文，注册才会落在该 agent 的作用域里。
  const run = async (scoped) => {
    if (policy.tools.mode !== 'all') {
      const available = ctx.tools
        .schemas()
        .map((schema) => String(schema.name ?? ''))
        .filter((toolName) => toolName.length > 0)
      const matcher = toolNameMatcher(policy.tools.names)
      const matched = available.filter((toolName) => matcher(toolName))
      const filter = policy.tools.mode === 'only' ? { allow: matched } : { deny: matched }
      trackDisposer(agent, scoped.tools.restrict(filter))
      report.tools = {
        mode: policy.tools.mode,
        entries: policy.tools.names,
        excluded: policy.tools.mode === 'only' ? available.length - matched.length : matched.length,
      }
    } else {
      report.tools = { mode: 'all', excluded: 0 }
    }

    if (policy.skills.mode === 'all') {
      report.skills = { mode: 'all', excluded: [] }
    } else {
      const exact = new Set(normalizeNames(policy.skills.names))
      // 候选必须取自「这个 agent 看到的那份目录」，全局层的快照只有插件自带的那几条。
      const snapshot = await scoped.skills.snapshot({ scope: agent })
      const visible = (snapshot?.skills ?? []).filter((skill) => skill.invocation?.modelInvocable === true)
      const excluded = visible.filter((skill) =>
        policy.skills.mode === 'only' ? !exact.has(skill.name) : exact.has(skill.name),
      )
      for (const skill of excluded) {
        // deny-shadow：同名的 runtime 技能落在本会话作用域的层里，最近的层覆盖全局层，且不可被模型调用。
        trackDisposer(
          agent,
          scoped.skills.register({
            name: skill.name,
            description: 'hidden by the context-preflight default policy',
            content: '',
            source: 'runtime',
            invocation: { modelInvocable: false, userInvocable: false },
          }),
        )
      }
      report.skills = { mode: policy.skills.mode, excluded: excluded.map((skill) => skill.name) }
    }

    if (policy.runtimeContext.enabled === false) {
      trackDisposer(agent, scoped.systemPrompt.suppressRuntimeContext())
      report.runtimeContext = 'suppressed'
    } else {
      report.runtimeContext = 'on'
    }
  }

  try {
    if (typeof agentCtx.inject !== 'function') {
      throw new Error('agent context has no inject(); cannot scope skills/systemPrompt registrations')
    }
    await new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      agentCtx.inject(['tools', 'skills', 'systemPrompt'], (scoped) => {
        Promise.resolve()
          .then(() => run(scoped))
          .catch((failure) => {
            report.error = String(failure?.message ?? failure)
            console.error('[context-preflight] policy apply failed', report, failure)
          })
          .finally(finish)
        return () => {}
      })
      // inject 的依赖若永远不就绪，这里给一个短兜底，避免静默悬挂。
      setTimeout(() => {
        if (!settled) {
          report.error = report.error ?? 'agent context inject() did not resolve within 3s'
          finish()
        }
      }, 3000)
    })

    console.info('[context-preflight] policy applied', report)
  } catch (failure) {
    report.error = String(failure?.message ?? failure)
    console.error('[context-preflight] policy apply failed', report, failure)
  } finally {
    lastPolicyApplication = { at: Date.now(), report }
  }
}

// ---------------------------------------------------------------- 策略：预览

/** 按策略估算「新会话首轮注入」，口径与 /summary 一致（不含对话历史）。 */
function previewPolicy(policy, tools, skills, prompts, totalTokens) {
  const excludedTools = selectExcludedTools(policy, tools.rows)
  const excludedSkills = selectExcludedSkills(policy, skills.rows ?? [])
  const excludedToolTokens = excludedTools.reduce((sum, row) => sum + row.tokens, 0)
  const excludedSkillTokens = excludedSkills.reduce((sum, row) => sum + row.tokens, 0)
  const contextTokens = policy.runtimeContext.enabled === false ? prompts.contextTokens : 0
  const savedTokens = excludedToolTokens + excludedSkillTokens + contextTokens
  const projectedTokens = Math.max(0, totalTokens - savedTokens)
  const savedPercent = totalTokens > 0 ? Math.round((savedTokens / totalTokens) * 1000) / 10 : 0
  return {
    tokens: projectedTokens,
    savedTokens,
    savedPercent,
    excludedTools: excludedTools.map((row) => row.name),
    excludedSkills: excludedSkills.map((row) => row.name),
    excludedContexts: policy.runtimeContext.enabled === false,
  }
}

// ---------------------------------------------------------------- 快照

function resolveAgent(ctx, exec) {
  if (exec?.agent !== undefined) return { agent: exec.agent, source: 'exec.agent' }
  try {
    const initiator = ctx.agents.currentInitiator()
    if (initiator !== undefined) return { agent: initiator, source: 'initiator' }
  } catch {
    /* 没有 initiator 边界 */
  }
  return { agent: undefined, source: 'none' }
}

async function resolveCwd(ctx, agent, signal) {
  if (agent !== undefined) {
    try {
      const cwd = await ctx.workingDirectory.ensure(agent, signal)
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    } catch {
      /* 取不到会话目录就退到默认目录 */
    }
  }
  const fallback = ctx.workingDirectory.defaultDirectory
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : process.cwd()
}

/** 生成一份完整快照；宿主工具与浏览器面板共用同一份 JSON。 */
async function buildSnapshot(ctx, agent, scopeSource, signal) {
  const cwd = await resolveCwd(ctx, agent, signal)
  const instructions = await collectInstructions(cwd)
  const skills = await collectSkills(ctx, agent, cwd, signal)
  const tools = collectTools(ctx, agent)
  const prompts = await collectPrompts(ctx, agent, signal)
  const anchor = collectAnchor(ctx, agent)

  const skillMeasure = skills.error === undefined ? { chars: skills.chars, tokens: skills.tokens } : emptyMeasure()
  const promptMeasure = { chars: prompts.sectionChars + prompts.contextChars, tokens: prompts.sectionTokens + prompts.contextTokens }

  const blocks = [
    { id: 'instructions', title: '画像/规则', chars: instructions.chars, tokens: instructions.tokens },
    { id: 'skills', title: '技能', chars: skillMeasure.chars, tokens: skillMeasure.tokens },
    { id: 'tools', title: '工具', chars: tools.chars, tokens: tools.tokens },
    { id: 'prompts', title: '系统提示词', chars: promptMeasure.chars, tokens: promptMeasure.tokens },
  ]

  const total = blocks.reduce((sum, block) => addMeasure(sum, block), emptyMeasure())
  const delta = anchor === undefined ? undefined : Math.round(((total.tokens - anchor.tokens) / anchor.tokens) * 100)

  const policyState = await readPolicy()
  const policy = {
    ...policyState.policy,
    path: policyState.path,
    exists: policyState.exists === true,
    error: policyState.error ?? null,
    appliedToThisAgent: agent !== undefined && policyAppliedAgents.has(agent),
    lastApplication: lastPolicyApplication,
    preview: previewPolicy(policyState.policy, tools, skills, prompts, total.tokens),
  }

  const snapshot = {
    generatedAt: Date.now(),
    cwd,
    agent: { id: typeof agent?.id === 'string' ? agent.id : undefined, scopeSource },
    instructions,
    skills,
    tools: {
      count: tools.count,
      deferred: tools.deferred,
      nameDigest: tools.nameDigest,
      names: tools.names,
      largest: tools.largest,
      chars: tools.chars,
      tokens: tools.tokens,
    },
    prompts,
    blocks,
    policy,
    totals: {
      chars: total.chars,
      tokens: total.tokens,
      anchor: anchor ?? null,
      delta: delta === undefined ? null : delta,
    },
  }
  // 给「工具结果卡片」用的可视化版本：markdown 表格 + 分块，不依赖任何客户端模块。
  snapshot.card = renderCard(snapshot)
  return snapshot
}

// ---------------------------------------------------------------- 文本报告（给模型看）

function statusLabel(status) {
  if (status === 'missing') return '[缺失]'
  if (status === 'over-budget') return '[超预算]'
  return '[加载]'
}

/**
 * 工具结果卡片用的 markdown：一张表读完四类构成，再给告警与默认策略结论。
 * 纯 markdown，不依赖任何客户端模块——宿主自带的工具结果渲染就能显示。
 */
function renderCard(snapshot) {
  const instructions = snapshot.instructions
  const skills = snapshot.skills
  const prompts = snapshot.prompts
  const policy = snapshot.policy
  const describe = (block) => {
    if (block.mode === 'all') return '全部'
    const names = block.names.length > 0 ? block.names.join('、') : '（空）'
    return `${block.mode === 'only' ? '仅' : '排除'} ${names}`
  }

  const rows = [
    `| 类别 | token | 明细 |`,
    `| --- | ---: | --- |`,
    `| 画像/规则 | ${groupDigits(instructions.tokens)} | ${instructions.loadedCount} 个文件 |`,
    skills.error === undefined
      ? `| 技能目录 | ${groupDigits(skills.tokens)} | 模型可见 ${skills.modelVisible} / 共 ${skills.total} |`
      : `| 技能目录 | — | 读取失败：${skills.error} |`,
    `| 工具 schema | ${groupDigits(snapshot.tools.tokens)} | ${snapshot.tools.count} 个 |`,
    `| 提示词 | ${groupDigits(prompts.sectionTokens + prompts.contextTokens)} | ${prompts.sectionCount} 段 + ${prompts.contextCount} 个动态上下文 |`,
    `| **合计** | **${groupDigits(snapshot.totals.tokens)}** | ${groupDigits(snapshot.totals.chars)} 字 |`,
  ]

  const warnings = instructions.warnings.map(
    (warning) => `- \`${warning.path}\` ${groupDigits(warning.bytes)} B 存在但不在任何加载路径（不会加载）`,
  )
  const policyError = policy.error ?? policy.lastApplication?.report?.error ?? null
  if (policyError !== null) warnings.push(`- 策略文件：${policyError}`)

  const lines = [
    `### 注入清单 · 合计 ${groupDigits(snapshot.totals.tokens)} token`,
    '',
    ...rows,
    '',
    '**告警**',
    ...(warnings.length > 0 ? warnings : ['- 无：没有「存在但未加载」的画像文件']),
    '',
    `**默认策略**（每个新会话生效）`,
    `技能 ${describe(policy.skills)} · 工具 ${describe(policy.tools)} · 运行时上下文 ${policy.runtimeContext.enabled ? '开' : '关'}`,
    `→ 新会话首轮 ≈ ${groupDigits(policy.preview.tokens)} token（−${groupDigits(policy.preview.savedTokens)}，−${policy.preview.savedPercent}%）`,
    '',
    `<sub>token 为估算（ASCII÷4 + 非 ASCII÷1.6）；画像只读；策略只影响之后新建的会话</sub>`,
  ]
  return lines.join('\n')
}

function renderText(snapshot) {
  const lines = []
  lines.push(`注入前清单（估算：ASCII÷4 + 非 ASCII÷1.6）`)
  lines.push(`工作目录：${snapshot.cwd}`)
  lines.push('')

  lines.push(`画像/规则（单次装配预算 ${groupDigits(snapshot.instructions.budgetBytes)} 字节）`)
  for (const file of snapshot.instructions.files) {
    const detail =
      file.status === 'missing' ? '不存在' : `${groupDigits(file.bytes)} B → ${groupDigits(file.chars)} 字符`
    lines.push(`  ${statusLabel(file.status)} ${padColumn(file.display, 40)} ${detail}`)
  }
  for (const warning of snapshot.instructions.warnings) {
    lines.push(`  [告警] ${padColumn(warning.path, 40)} ${groupDigits(warning.bytes)} B，存在但不在任何加载路径上`)
  }
  lines.push(`  小计 ${groupDigits(snapshot.instructions.chars)} 字符 ≈ ${groupDigits(snapshot.instructions.tokens)} token`)
  lines.push('')

  const skills = snapshot.skills
  if (skills.error !== undefined) {
    lines.push(`技能目录读取失败：${skills.error}`)
  } else {
    lines.push(`技能目录 ${skills.total} 个（模型可见 ${skills.modelVisible} / 仅命令 ${skills.userOnly}）`)
    lines.push(`  名字+摘要合计 ${groupDigits(skills.chars)} 字符 ≈ ${groupDigits(skills.tokens)} token`)
    if (skills.longest.length > 0) {
      lines.push(`  最长 ${skills.longest.length} 条：${skills.longest.map((s) => `${s.name} ${s.descriptionChars}`).join(' / ')}`)
    }
    const notes = [`写了 whenToUse 但未被目录采用的：${skills.whenToUseUnused} 条`]
    if (skills.truncated > 0) notes.push(`摘要超过 ${SKILL_DESCRIPTION_LIMIT} 字符：${skills.truncated} 条`)
    if (!skills.complete) notes.push('目录扫描未完成，本轮数字可能偏低')
    lines.push(`  ${notes.join('；')}`)
  }
  lines.push('')

  lines.push(`工具 schema ${snapshot.tools.count} 个（名集 sha1 ${snapshot.tools.nameDigest}）`)
  lines.push(`  schema 文本合计 ${groupDigits(snapshot.tools.chars)} 字符 ≈ ${groupDigits(snapshot.tools.tokens)} token`)
  if (snapshot.tools.largest.length > 0) {
    lines.push(
      `  最大 ${snapshot.tools.largest.length} 个：${snapshot.tools.largest.map((t) => `${t.name} ${groupDigits(t.chars)}`).join(' / ')}`,
    )
  }
  lines.push('')

  lines.push('运行时上下文')
  lines.push(
    `  系统提示词段落 ${snapshot.prompts.sectionCount} 个，合计 ${groupDigits(snapshot.prompts.sectionChars)} 字符 ≈ ${groupDigits(snapshot.prompts.sectionTokens)} token`,
  )
  lines.push(
    `  动态运行时上下文 ${snapshot.prompts.contextCount} 个，合计 ${groupDigits(snapshot.prompts.contextChars)} 字符 ≈ ${groupDigits(snapshot.prompts.contextTokens)} token`,
  )
  lines.push('')

  const totalLine = `合计（画像 + 技能 + 工具 + 段落 + 动态上下文） ${groupDigits(snapshot.totals.chars)} 字符 ≈ ${groupDigits(snapshot.totals.tokens)} token`
  lines.push(totalLine)
  if (snapshot.totals.anchor !== null && snapshot.totals.anchor !== undefined) {
    // 与上面的注入合计并列展示会让人以为两个数在比同一件事，所以单独一行、明确不可比。
    lines.push(
      `本会话已占用 ${groupDigits(snapshot.totals.anchor.tokens)} token（含对话历史，与上方注入量不可直接比较）`,
    )
  }
  lines.push('')

  const policy = snapshot.policy
  const preview = policy.preview
  const describeMode = (block, label) => {
    if (block.mode === 'all') return `${label}：全部`
    const names = block.names.length > 0 ? block.names.join(', ') : '（空）'
    return `${label}：${block.mode === 'only' ? '仅这些' : '排除'} ${names}`
  }
  lines.push(`默认策略（${policy.exists ? '已保存' : '未保存，按全开'}${policy.appliedToThisAgent ? '；已应用到本会话' : '；不影响正在运行的会话，只对新会话生效'}）`)
  lines.push(`  ${describeMode(policy.skills, '技能')}`)
  lines.push(`  ${describeMode(policy.tools, '工具')}`)
  lines.push(`  运行时上下文：${policy.runtimeContext.enabled ? '开' : '关'}`)
  lines.push(
    `  按此默认，新会话首轮注入 ≈ ${groupDigits(preview.tokens)} token（−${groupDigits(preview.savedTokens)}，−${preview.savedPercent}%）`,
  )
  if (policy.error !== null) lines.push(`  [告警] 策略文件读取失败：${policy.error}`)
  if (policy.lastApplication?.report?.error) {
    lines.push(`  [告警] 最近一次策略应用失败：${policy.lastApplication.report.error}`)
  }
  lines.push(`  策略文件：${policy.path}`)
  lines.push('')

  lines.push('限制：')
  lines.push('  - token 是估算：ASCII÷4 + 非 ASCII÷1.6，不是分词器结果。')
  lines.push(
    `  - 画像文件按固定路径探测（预算 ${groupDigits(INSTRUCTION_BUDGET_BYTES)} 字节），加载范围内的文件由本工具读原文统计；DSH 渲染时会另加标题并按预算截断。`,
  )
  lines.push('  - 工具 schema 用 ctx.tools.schemas(agent)，与 inspect host/Tool/listTools 同一集合。')
  lines.push('  - 技能摘要按 snapshot 原始摘要统计，不是目录渲染后的文本。')
  lines.push('  - 默认策略只对之后新建的会话生效；正在跑的会话不会被改动。')

  return lines.join('\n')
}

// ---------------------------------------------------------------- 工具

function createTool(ctx) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 30000,
    output: {
      // 返回值是结构化 JSON（浏览器面板复用同一份），形状不对外约束。
      schema: {},
      render: (_args, value) => [{ type: 'text', text: String(value?.card ?? value?.text ?? '') }],
    },
    async execute(_args, exec) {
      const { agent, source } = resolveAgent(ctx, exec)
      const snapshot = await buildSnapshot(ctx, agent, source, exec?.signal)
      // 工具返回值必须是无损 JSON：过一遍序列化，去掉 undefined 之类的非 JSON 值。
      const value = JSON.parse(JSON.stringify({ ...snapshot, text: renderText(snapshot) }))
      return value
    },
  }
}

// ---------------------------------------------------------------- 浏览器路由

function respondJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.length))
  res.end(body)
}

function createRouteHandler(ctx) {
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? ROUTE_PATH, 'http://localhost')
      const sessionId = url.searchParams.get('session') ?? undefined
      let agent
      let scopeSource = 'route.none'
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        try {
          const found = ctx.agents.get(sessionId)
          if (found !== undefined) {
            agent = found
            scopeSource = 'route.session'
          }
        } catch {
          /* 会话不在线就退回下面的兜底 */
        }
      }
      if (agent === undefined) {
        const resolved = resolveAgent(ctx, undefined)
        agent = resolved.agent
        scopeSource = resolved.source === 'none' ? 'route.none' : `route.${resolved.source}`
      }
      if (agent === undefined) {
        const live = ctx.agents.list()
        if (live.length > 0) {
          agent = live[live.length - 1]
          scopeSource = 'route.last-live'
        }
      }

      const snapshot = await buildSnapshot(ctx, agent, scopeSource, undefined)
      const payload = { ...snapshot, text: renderText(snapshot), scopeSource }
      respondJson(res, 200, JSON.parse(JSON.stringify(payload)))
    } catch (error) {
      respondJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
    }
  }
}

/**
 * 读客户端文案。locale/zh.json 与 locale/en.json 的 `client` 段是浏览器侧文案的唯一来源，
 * 浏览器只负责把它们注册进 ctx.locale，不在 JS 里另抄一份。
 */
async function readClientLocale() {
  const read = async (code) => {
    const raw = await readFile(join(PACKAGE_DIR, 'locale', `${code}.json`), 'utf8')
    const parsed = JSON.parse(raw)
    const dictionary = parsed?.client
    return dictionary !== null && typeof dictionary === 'object' ? dictionary : {}
  }
  return { zh: await read('zh'), en: await read('en') }
}

function createLocaleHandler() {
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      respondJson(res, 200, await readClientLocale())
    } catch (error) {
      respondJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
    }
  }
}

/** 读请求体（上限 256 KiB），用于策略写入。 */
function readRequestBody(req, limit = 262144) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 策略读写：GET 返回当前策略，POST 原子写入并返回落盘结果。 */
function createPolicyHandler() {
  return async (req, res) => {
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const { policy, path, exists, error } = await readPolicy()
        respondJson(res, 200, { policy, path, exists, error: error ?? null, lastApplication: lastPolicyApplication })
        return
      }
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const raw = await readRequestBody(req)
      let parsed
      try {
        parsed = JSON.parse(raw === '' ? '{}' : raw)
      } catch (error) {
        respondJson(res, 400, { error: 'invalid-json', message: String(error?.message ?? error) })
        return
      }
      const { policy, path } = await writePolicy(parsed)
      console.info('[context-preflight] policy saved', { path, policy })
      respondJson(res, 200, { policy, path, exists: true, error: null })
    } catch (error) {
      const message = String(error?.message ?? error)
      console.error('[context-preflight] policy save failed', message)
      respondJson(res, 500, { error: 'write-failed', message })
    }
  }
}

/** 浏览器 factory 一进来就上报「我执行到了」，用来区分「没执行」和「执行到一半抛错」。 */
function createBootHandler() {
  return async (req, res) => {
    try {
      if (req.method !== 'POST' && req.method !== 'PUT') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const raw = await readRequestBody(req, 65536)
      let parsed
      try {
        parsed = JSON.parse(raw === '' ? '{}' : raw)
      } catch (error) {
        respondJson(res, 400, { error: 'invalid-json', message: String(error?.message ?? error) })
        return
      }
      lastClientBoot = {
        at: Date.now(),
        firstAt: lastClientBoot?.firstAt ?? Date.now(),
        count: (lastClientBoot?.count ?? 0) + 1,
        id: typeof parsed?.id === 'string' ? parsed.id : null,
        stage: typeof parsed?.stage === 'string' ? parsed.stage : null,
        hasReact: parsed?.hasReact === true,
        loaderOk: parsed?.loaderOk === true,
        error: typeof parsed?.error === 'string' ? parsed.error : null,
        history: [
          ...(lastClientBoot?.history ?? []),
          { at: Date.now(), stage: typeof parsed?.stage === 'string' ? parsed.stage : null, error: typeof parsed?.error === 'string' ? parsed.error : null },
        ].slice(-12),
      }
      console.info('[context-preflight] client boot reported', lastClientBoot)
      respondJson(res, 200, { ok: true })
    } catch (error) {
      respondJson(res, 500, { error: 'store-failed', message: String(error?.message ?? error) })
    }
  }
}

/** 浏览器上报槽位注册结果：写进内存，/diag 直接读。 */
function createRegistrationsHandler() {
  return async (req, res) => {
    try {
      if (req.method !== 'POST' && req.method !== 'PUT') {
        respondJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const raw = await readRequestBody(req, 65536)
      let parsed
      try {
        parsed = JSON.parse(raw === '' ? '{}' : raw)
      } catch (error) {
        respondJson(res, 400, { error: 'invalid-json', message: String(error?.message ?? error) })
        return
      }
      lastClientRegistrations = {
        at: Date.now(),
        moduleId: typeof parsed?.moduleId === 'string' ? parsed.moduleId : null,
        slots: parsed?.slots !== null && typeof parsed?.slots === 'object' ? parsed.slots : null,
        errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
        loadedAt: Number.isFinite(parsed?.loadedAt) ? parsed.loadedAt : null,
      }
      console.info('[context-preflight] client registrations reported', lastClientRegistrations)
      respondJson(res, 200, { ok: true })
    } catch (error) {
      respondJson(res, 500, { error: 'store-failed', message: String(error?.message ?? error) })
    }
  }
}

/** 最小探针：它 404 就说明插件没跑到注册这一步；它能通而 summary 404，就说明是 summary 的逻辑问题。 */
function createPingHandler() {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    respondJson(res, 200, {
      ok: true,
      plugin: 'dsh-context-preflight',
      routes: [PING_ROUTE_PATH, ROUTE_PATH, LOCALE_ROUTE_PATH, POLICY_ROUTE_PATH, DIAG_ROUTE_PATH, REGISTRATIONS_ROUTE_PATH],
      policyPath: policyFilePath(),
      at: Date.now(),
    })
  }
}

/**
 * 冷启动诊断（只读、无副作用、不依赖会话）。
 * 判断「宿主有没有把这个客户端模块收进 boot 表」，以及本包是不是 junction 进来的。
 * clientModules 用 ctx.get() 惰性取：它由 web 运行时提供，惰性读能在请求时拿到最新状态，
 * 又不会因为某个部署没有它而让整个插件（含工具）不激活。
 */
function createDiagHandler(ctx) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    const id = 'dsh-context-preflight'
    const payload = {
      id,
      at: Date.now(),
      importedFrom: PACKAGE_DIR,
      clientModulesAvailable: false,
      inGraph: false,
      tableSize: null,
      graphRev: null,
      entry: null,
      clientFile: null,
      clientFileExists: false,
      clientFileRealPath: null,
      selfPackageRealPath: null,
      nodeModulesEntry: null,
      error: null,
    }

    try {
      payload.selfPackageRealPath = realpathSync(PACKAGE_DIR)
    } catch (error) {
      payload.error = `realpath(package) failed: ${error?.code ?? error}`
    }

    const clientModules = ctx.get('clientModules')
    if (clientModules === undefined || clientModules === null) {
      payload.error = payload.error ?? 'clientModules service unavailable in this deployment'
    } else {
      payload.clientModulesAvailable = true
      try {
        const graph = clientModules.graph()
        payload.graphRev = graph?.rev ?? null
        payload.tableSize = Array.isArray(graph?.entries) ? graph.entries.length : null
        const entry = Array.isArray(graph?.entries)
          ? graph.entries.find((row) => row?.id === id)
          : undefined
        payload.entry = entry === undefined ? null : { id: entry.id, url: entry.url, rev: entry.rev, inject: entry.inject ?? null, immediately: entry.immediately === true }
        // 对照组：把两个「本机能正常显示」的插件条目一起带出来，方便比 URL 形状。
        payload.samples = ['dsh-cost-meter', 'dsh-context']
          .map((sampleId) => (Array.isArray(graph?.entries) ? graph.entries.find((row) => row?.id === sampleId) : undefined))
          .filter((row) => row !== undefined)
          .map((row) => ({ id: row.id, url: row.url, rev: row.rev, immediately: row.immediately === true }))
        const path = clientModules.clientPath(id)
        payload.inGraph = typeof path === 'string' && path.length > 0
        payload.clientFile = typeof path === 'string' && path.length > 0 ? path : null
      } catch (error) {
        payload.error = `clientModules query failed: ${error?.message ?? error}`
      }
    }

    if (payload.clientFile === null) {
      // 没进 boot 表时给一个「本该是哪个文件」的对照路径。
      payload.clientFile = join(PACKAGE_DIR, 'client.js')
    }
    try {
      payload.clientFileRealPath = realpathSync(payload.clientFile)
    } catch {
      payload.clientFileRealPath = null
    }
    payload.clientFileExists = existsSync(payload.clientFile)

    // node_modules 里的入口（junction 与否）——这是「包被链接进 profile」的直接证据。
    try {
      const profileDir = envPath('DSH_PROFILE_DIR') ?? join(resolveDshHome(), 'profiles', process.env.DSH_PROFILE ?? 'desktop')
      const entryPath = join(profileDir, 'node_modules', id)
      payload.nodeModulesPath = entryPath
      payload.nodeModulesEntry = existsSync(entryPath) ? realpathSync(entryPath) : null
      payload.nodeModulesIsLink = payload.nodeModulesEntry !== null && payload.nodeModulesEntry !== entryPath
    } catch {
      payload.nodeModulesEntry = null
    }

    // 浏览器侧上报的三条槽位注册结果（冷启动后一条 curl 就能定位断在哪一步）。
    payload.clientRegistrations = lastClientRegistrations
    payload.bootReport = lastClientBoot

    // 命令是否注册到「请求这个路由的那个 agent」上（只看描述，不执行，不往会话日志写事件）。
    payload.command = { name: 'preflight', registered: false, descriptor: null, error: null }
    // /diag 不依赖会话，但命令表是按 agent 解析的：优先 ?session=，其次当前 initiator，最后最近活跃会话。
    let diagAgent
    try {
      const sessionId = new URL(req.url ?? DIAG_ROUTE_PATH, 'http://localhost').searchParams.get('session')
      if (typeof sessionId === 'string' && sessionId.length > 0) diagAgent = ctx.agents.get(sessionId)
      if (diagAgent === undefined) diagAgent = resolveAgent(ctx, undefined).agent
      if (diagAgent === undefined) {
        const live = ctx.agents.list()
        if (live.length > 0) diagAgent = live[live.length - 1]
      }
    } catch (error) {
      payload.command.error = `agent resolution failed: ${error?.message ?? error}`
    }
    try {
      if (diagAgent === undefined) throw new Error('no live agent to resolve commands for')
      const descriptors = ctx.commands.list(diagAgent)
      const found = Array.isArray(descriptors) ? descriptors.find((row) => row?.name === 'preflight') : undefined
      payload.command.registered = found !== undefined
      payload.command.descriptor =
        found === undefined ? null : { name: found.name, description: found.description, input: found.input ?? null }
    } catch (error) {
      payload.command.error = String(error?.message ?? error)
    }

    // ?run=1：用「请求这个路由的 agent」真执行一次已注册的 /preflight handler，
    // 返回它产出的文本。走 handler 而不是 commands.execute()，所以不会往会话日志写 command/run。
    if (new URL(req.url ?? DIAG_ROUTE_PATH, 'http://localhost').searchParams.get('run') !== null) {
      payload.commandRun = { ok: false, kind: null, text: null, lines: 0, error: null }
      try {
        if (diagAgent === undefined) throw new Error('no live agent to run the command for')
        const definition = ctx.commands.find(diagAgent, 'preflight')
        if (definition === undefined) throw new Error('command /preflight is not registered for this agent')
        const runParam = new URL(req.url ?? DIAG_ROUTE_PATH, 'http://localhost').searchParams.get('run')
        const result = await definition.handler({
          commandId: 'diag-run',
          agent: diagAgent,
          // run=1 表示跑不带参数的主命令；run=skills 之类按子命令解析。
          rawInput: runParam === '1' ? '/preflight' : `/preflight ${runParam ?? ''}`.trim(),
          attachments: [],
          signal: new AbortController().signal,
        })
        payload.commandRun.kind = result?.kind ?? null
        payload.commandRun.text = typeof result?.text === 'string' ? result.text : null
        payload.commandRun.lines = typeof result?.text === 'string' ? result.text.split('\n').length : 0
        payload.commandRun.ok = result?.kind === 'success'
      } catch (error) {
        payload.commandRun.error = String(error?.message ?? error)
      }
    }

    respondJson(res, 200, payload)
  }
}

/**
 * 在插件的全局层注册一条路由。
 * webServer 已经是 inject 的硬依赖，这里不再用 ctx.get() 判断存在性——那会让注册被静默跳过。
 */
function registerRoute(ctx, path, handler, label) {
  try {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), label)
    return true
  } catch (error) {
    console.error(`[context-preflight] 路由注册失败：${path}`, error)
    return false
  }
}

// ---------------------------------------------------------------- 管理动作（v5）
//
// 只改名 / 只改 frontmatter 一行，绝不删文件、绝不动正文；每次动作都写审计日志并打印撤销方式。

const SKILL_DISABLE_KEY = 'disable-model-invocation'
const SKILL_STATE_FILE = 'skill-state.json'
const ACTIONS_LOG_FILE = 'actions.log'

function pluginDataDir() {
  return join(resolveDshHome(), POLICY_DIR_NAME)
}
function actionsLogPath() {
  return join(pluginDataDir(), ACTIONS_LOG_FILE)
}
function skillStatePath() {
  return join(pluginDataDir(), SKILL_STATE_FILE)
}
function agentsSkillsRoot() {
  return join(envPath('DSH_AGENTS_HOME') ?? join(homedir(), '.agents'), 'skills')
}

/** 追加一行审计：时间 | 动作 | 文件 | 原值 | 备注 */
async function appendAudit(action, file, original, note) {
  try {
    await mkdir(pluginDataDir(), { recursive: true })
    const line = `${new Date().toISOString()} | ${action} | ${file} | ${original ?? '-'} | ${note ?? '-'}\n`
    await writeFile(actionsLogPath(), line, { encoding: 'utf8', flag: 'a' })
  } catch (error) {
    console.error('[context-preflight] audit log failed', error)
  }
}

async function readSkillState() {
  try {
    const parsed = JSON.parse(await readFile(skillStatePath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeSkillState(state) {
  await mkdir(pluginDataDir(), { recursive: true })
  await writeFile(skillStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** 收集 ~/.agents/skills 下真实存在的 SKILL.md（最多三层）。 */
async function listSkillFiles() {
  const root = agentsSkillsRoot()
  const found = []
  async function walk(dir, depth) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 3) await walk(full, depth + 1)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        found.push({ name: basename(dir), dir, path: full })
      }
    }
  }
  await walk(root, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function splitFrontmatter(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  if (lines[0] === undefined || lines[0].trim() !== '---') return { eol, lines, start: -1, end: -1 }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  return { eol, lines, start: 0, end }
}

function findKeyLine(lines, key, start, end) {
  for (let index = start + 1; index < end; index += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[index] ?? '')
    if (match !== null && match[1] === key) {
      return { index, value: match[2].trim() }
    }
  }
  return undefined
}

function readSkillFlag(text) {
  const { lines, start, end } = splitFrontmatter(text)
  if (start < 0 || end < 0) return { known: false, disabled: false, detail: '没有 frontmatter' }
  const line = findKeyLine(lines, SKILL_DISABLE_KEY, start, end)
  if (line === undefined) return { known: true, disabled: false, detail: '无此键（默认注入）' }
  const disabled = /^(true|yes|1)$/i.test(line.value)
  return { known: true, disabled, detail: `${SKILL_DISABLE_KEY}: ${line.value}` }
}

/**
 * 技能开关：只改 frontmatter 里 disable-model-invocation 这一行，正文一个字节不动。
 * 原值记进 sidecar（skill-state.json），`on` 时精确还原（原本没有这个键就删掉它）。
 */
async function setSkillDisabled(path, disabled) {
  const text = await readFile(path, 'utf8')
  const { eol, lines, start, end } = splitFrontmatter(text)
  if (start < 0 || end < 0) throw new Error('这个 SKILL.md 没有 YAML frontmatter，拒绝改动')
  const state = await readSkillState()
  const existing = findKeyLine(lines, SKILL_DISABLE_KEY, start, end)

  if (disabled) {
    if (state[path] === undefined) {
      state[path] = { original: existing === undefined ? 'absent' : existing.value === '' ? 'empty' : existing.value }
    }
    if (existing === undefined) lines.splice(end, 0, `${SKILL_DISABLE_KEY}: true`)
    else lines[existing.index] = `${SKILL_DISABLE_KEY}: true`
  } else {
    const saved = state[path]
    if (existing !== undefined) {
      if (saved === undefined || saved.original === 'absent' || saved.original === 'empty') lines.splice(existing.index, 1)
      else lines[existing.index] = `${SKILL_DISABLE_KEY}: ${saved.original}`
    }
    delete state[path]
  }

  await writeFile(path, lines.join(eol), 'utf8')
  await writeSkillState(state)
  return { original: state[path]?.original ?? 'restored' }
}

/** 当前项目的画像文件链：活跃(.md) 与已禁用(.md.disabled) 都列，便于反悔。 */
async function listRuleEntries(cwd) {
  const root = findProjectRoot(cwd)
  const chain = ancestorChain(root, cwd)
  const entries = []
  for (const dir of chain) {
    for (const candidate of [...INSTRUCTION_FILE_CANDIDATES, ...LOCAL_INSTRUCTION_FILE_CANDIDATES]) {
      const activePath = join(dir, candidate)
      const disabledPath = `${activePath}.disabled`
      if (existsSync(activePath)) entries.push({ path: activePath, state: 'active' })
      else if (existsSync(disabledPath)) entries.push({ path: disabledPath, state: 'disabled' })
    }
  }
  return entries
}

/**
 * 命令行用的压缩报告：一条命令结果里读完，不依赖浏览器模块。
 * 详细版仍由工具与面板提供；这里只保留四类合计、告警与默认策略结论。
 */
function renderCommandText(snapshot) {
  const lines = []
  const skills = snapshot.skills
  const skillsTokens = skills.error === undefined ? groupDigits(skills.tokens) : '读取失败'
  const skillsCount = skills.error === undefined ? `${skills.modelVisible}/${skills.total}` : '—'

  lines.push('注入上下文（估算 token：ASCII÷4 + 非 ASCII÷1.6）')
  lines.push(`  画像/规则    ${groupDigits(snapshot.instructions.tokens)}   ${snapshot.instructions.files.filter((file) => file.status !== 'missing').length} 个文件`)
  lines.push(`  技能目录     ${skillsTokens}   ${skillsCount} 模型可见`)
  lines.push(`  工具 schema  ${groupDigits(snapshot.tools.tokens)}   ${snapshot.tools.count} 个`)
  lines.push(`  提示词       ${groupDigits(snapshot.prompts.sectionTokens + snapshot.prompts.contextTokens)}   ${snapshot.prompts.sectionCount} 段 + ${snapshot.prompts.contextCount} 动态`)
  lines.push(`  合计         ${groupDigits(snapshot.totals.tokens)}`)

  for (const warning of snapshot.instructions.warnings) {
    lines.push(`  [告警] ${warning.path} ${groupDigits(warning.bytes)} B 存在但未加载`)
  }

  const policy = snapshot.policy
  const modeLabel = (block, label) => {
    if (block.mode === 'all') return `${label}全开`
    return `${label}${block.mode === 'only' ? '仅' : '排除'} ${block.names.join(',') || '（空）'}`
  }
  lines.push('')
  lines.push(
    `默认策略(${policy.exists ? '已保存' : '未保存，按全开'}): ${modeLabel(policy.skills, '技能')} / ${modeLabel(policy.tools, '工具')} / 运行时上下文${policy.runtimeContext.enabled ? '开' : '关'}`,
  )
  lines.push(
    `  新会话首轮 ≈ ${groupDigits(policy.preview.tokens)} token（−${groupDigits(policy.preview.savedTokens)}，−${policy.preview.savedPercent}%）`,
  )
  if (snapshot.totals.anchor) {
    lines.push(`  本会话已占用 ${groupDigits(snapshot.totals.anchor.tokens)}（含对话历史，不可与上方直接比较）`)
  }
  lines.push('限制：token 为估算；画像只读；默认策略只对之后新建的会话生效。')
  return lines.join('\n')
}

/** 技能清单：序号 + 名字 + 当前是否注入 + 文件路径。 */
async function commandSkills() {
  const files = await listSkillFiles()
  if (files.length === 0) {
    return `技能目录 ${agentsSkillsRoot()} 下没有找到任何 SKILL.md（只读展示，未做任何改动）`
  }
  const lines = [`技能 ${files.length} 个（来自 ${agentsSkillsRoot()}）`, '']
  for (const [index, file] of files.entries()) {
    let status = '?'
    let detail = ''
    try {
      const flag = readSkillFlag(await readFile(file.path, 'utf8'))
      status = flag.disabled ? '已关闭（不进模型目录）' : '注入中'
      detail = flag.detail
    } catch (error) {
      status = '读取失败'
      detail = String(error?.message ?? error)
    }
    lines.push(`${String(index + 1).padStart(2, ' ')}. ${file.name.padEnd(34, ' ')} ${status}   ${detail}`)
    lines.push(`     ${file.path}`)
  }
  lines.push('', '用法：/preflight skill off <序号或名字> 关闭 · /preflight skill on <序号或名字> 恢复')
  return lines.join('\n')
}

/** 按序号或名字定位技能文件。 */
async function resolveSkillTarget(target) {
  const files = await listSkillFiles()
  if (files.length === 0) throw new Error('技能目录里没有 SKILL.md')
  if (/^\d+$/.test(target)) {
    const index = Number(target) - 1
    if (index < 0 || index >= files.length) throw new Error(`序号 ${target} 超出范围（1…${files.length}）`)
    return files[index]
  }
  const found = files.find((file) => file.name === target)
  if (found === undefined) throw new Error(`没有叫 ${target} 的技能；用 /preflight skills 看清单`)
  return found
}

/** 技能开关：off / on 对称，打印改了哪一行与撤销方式。 */
async function commandSkillToggle(action, target) {
  const file = await resolveSkillTarget(target)
  const before = readSkillFlag(await readFile(file.path, 'utf8'))
  await setSkillDisabled(file.path, action === 'off')
  const after = readSkillFlag(await readFile(file.path, 'utf8'))
  await appendAudit(`skill.${action}`, file.path, before.detail, `now: ${after.detail}`)
  const undo = action === 'off' ? `/preflight skill on ${file.name}` : `/preflight skill off ${file.name}`
  return [
    `${action === 'off' ? '已关闭' : '已恢复'}技能 ${file.name}`,
    `  文件：${file.path}`,
    `  改动行：frontmatter 的 ${SKILL_DISABLE_KEY}（正文未动）`,
    `  原值：${before.detail} → 现值：${after.detail}`,
    `  撤销：${undo}`,
  ].join('\n')
}

/** 画像文件链：活跃 / 已禁用 / 缺失，附全局两处只读信息。 */
async function commandRules(ctx, agent) {
  const cwd = await resolveCwd(ctx, agent, undefined)
  const entries = await listRuleEntries(cwd)
  const home = homedir()
  const dshHome = envPath('DSH_HOME') ?? join(home, '.dsh')
  const agentsHome = envPath('DSH_AGENTS_HOME') ?? join(home, '.agents')
  const globals = [join(dshHome, 'AGENTS.md'), join(agentsHome, 'AGENTS.md')]

  const lines = [`画像文件（项目链：${cwd}）`, '']
  if (entries.length === 0) lines.push('  这一段链上没有 AGENTS.md / CLAUDE.md')
  entries.forEach((entry, index) => {
    const status = entry.state === 'active' ? '加载中' : '已禁用（.disabled，不加载）'
    const size = (() => {
      try {
        return `${groupDigits(statSync(entry.path).size)} B`
      } catch {
        return '?'
      }
    })()
    lines.push(`${String(index + 1).padStart(2, ' ')}. ${entry.path}   ${size}   ${status}`)
  })

  lines.push('', '全局两处（只读展示，本命令不会改动它们）：')
  for (const path of globals) {
    lines.push(`  ${existsSync(path) ? '存在' : '不存在'}  ${path}`)
  }
  if (!existsSync(globals[1]) && existsSync(join(home, 'AGENTS.md'))) {
    lines.push(
      '',
      `提示：${join(home, 'AGENTS.md')} 存在但不在任何加载路径上。要启用它（写 C 盘主工作区，需你本人执行，我不会代跑）：`,
      `  New-Item -ItemType SymbolicLink -Path "${globals[1]}" -Target "${join(home, 'AGENTS.md')}"`,
    )
  }
  lines.push('', '用法：/preflight rule off <序号> 改名为 .disabled · /preflight rule on <序号> 改回来')
  return lines.join('\n')
}

/** 画像文件开关：只改名 AGENTS.md ↔ AGENTS.md.disabled。 */
async function commandRuleToggle(ctx, agent, action, target) {
  const cwd = await resolveCwd(ctx, agent, undefined)
  const entries = await listRuleEntries(cwd)
  if (entries.length === 0) throw new Error('这一条项目链上没有任何画像文件')
  if (!/^\d+$/.test(target)) throw new Error('rule 只接受序号；先跑 /preflight rules 看清单')
  const index = Number(target) - 1
  if (index < 0 || index >= entries.length) throw new Error(`序号 ${target} 超出范围（1…${entries.length}）`)
  const entry = entries[index]

  if (action === 'off') {
    if (entry.state !== 'active') throw new Error(`${entry.path} 已经是禁用状态`)
    const destination = `${entry.path}.disabled`
    await rename(entry.path, destination)
    await appendAudit('rule.off', entry.path, 'active', `renamed -> ${destination}`)
    return [
      `已禁用画像文件 ${basename(entry.path)}`,
      `  改名：${entry.path} → ${destination}`,
      '  文件内容未改；DSH 只认 AGENTS.md / CLAUDE.md，所以这一份下一轮不再注入。',
      `  撤销：/preflight rule on ${target}`,
    ].join('\n')
  }

  if (entry.state !== 'disabled') throw new Error(`${entry.path} 当前不是禁用状态`)
  const destination = entry.path.replace(/\.disabled$/, '')
  if (existsSync(destination)) throw new Error(`${destination} 已存在，先处理冲突再恢复`)
  await rename(entry.path, destination)
  await appendAudit('rule.on', entry.path, 'disabled', `renamed -> ${destination}`)
  return [
    `已恢复画像文件 ${basename(destination)}`,
    `  改名：${entry.path} → ${destination}`,
    `  撤销：/preflight rule off ${target}`,
  ].join('\n')
}

/** 工具策略：except / reset。 */
async function commandToolEdit(action, prefix) {
  const { policy } = await readPolicy()
  if (action === 'reset') {
    const next = { ...policy, tools: { mode: 'all', names: [] } }
    const { path } = await writePolicy(next)
    await appendAudit('tool.reset', path, JSON.stringify(policy.tools), 'tools=all')
    return [`已清空工具排除项（mode=all）`, `  文件：${path}`, '  撤销：重新用 /preflight tool except <前缀> 加回来'].join('\n')
  }
  if (prefix === undefined || prefix.length === 0) throw new Error('tool except 需要一个前缀或工具名，例如 mcp__rea__')
  const names = policy.tools.mode === 'except' ? [...policy.tools.names] : []
  if (!names.includes(prefix)) names.push(prefix)
  const next = { ...policy, tools: { mode: 'except', names } }
  const { path } = await writePolicy(next)
  await appendAudit('tool.except', path, JSON.stringify(policy.tools), `add ${prefix}`)
  return [
    `已把 ${prefix} 加入工具排除（前缀匹配，如 mcp__rea__ 表示整组）`,
    `  现值：排除 ${names.join('、')}`,
    `  文件：${path}`,
    '  说明：只影响之后新建的会话；当前会话的工具不会立刻减少。',
    `  撤销：/preflight tool reset`,
  ].join('\n')
}

/** 工具策略现状（读 policy.json）。 */
async function commandTools() {
  const { policy, path, exists, error } = await readPolicy()
  const describe = (block) => {
    if (block.mode === 'all') return '全部'
    const names = block.names.length > 0 ? block.names.join('、') : '（空）'
    return `${block.mode === 'only' ? '仅' : '排除'} ${names}`
  }
  return [
    `工具策略（${exists ? '已保存' : '未保存，按全开'}）`,
    `  技能：${describe(policy.skills)}`,
    `  工具：${describe(policy.tools)}`,
    `  运行时上下文：${policy.runtimeContext.enabled ? '开' : '关'}`,
    `  文件：${path}`,
    error === null ? '' : `  [告警] ${error}`,
    '说明：工具策略只影响之后新建的会话；改完用 /preflight tools 复核。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** /preflight 子命令分发。 */
async function runPreflightCommand(ctx, agent, rawInput) {
  const args = String(rawInput ?? '')
    .replace(/^\/preflight\b/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const [top, sub, ...rest] = args

  if (top === undefined) {
    const snapshot = await buildSnapshot(ctx, agent, 'command', undefined)
    return renderCommandText(snapshot)
  }
  if (top === 'skills') return commandSkills()
  if (top === 'skill') {
    if (sub !== 'on' && sub !== 'off') throw new Error('用法：/preflight skill on|off <序号或名字>')
    if (rest[0] === undefined) throw new Error('用法：/preflight skill on|off <序号或名字>')
    return commandSkillToggle(sub, rest[0])
  }
  if (top === 'rules') return commandRules(ctx, agent)
  if (top === 'rule') {
    if (sub !== 'on' && sub !== 'off') throw new Error('用法：/preflight rule on|off <序号>')
    if (rest[0] === undefined) throw new Error('用法：/preflight rule on|off <序号>')
    return commandRuleToggle(ctx, agent, sub, rest[0])
  }
  if (top === 'tools') return commandTools()
  if (top === 'tool') {
    if (sub === 'reset') return commandToolEdit('reset')
    if (sub === 'except') return commandToolEdit('except', rest[0])
    throw new Error('用法：/preflight tool except <前缀> 或 /preflight tool reset')
  }
  throw new Error(`未知子命令 ${top}；可用：skills / skill / rules / rule / tools / tool`)
}

function createCommand(ctx) {
  return {
    name: 'preflight',
    description: '注入管理：清单 / 技能开关 / 画像文件开关 / 工具排除（只改名与 frontmatter 一行，不删不改正文）',
    async handler(invocation) {
      try {
        const text = await runPreflightCommand(ctx, invocation.agent, invocation.rawInput)
        return { kind: 'success', text }
      } catch (error) {
        return { kind: 'error', text: `/preflight 失败：${String(error?.message ?? error)}` }
      }
    },
  }
}

export function apply(ctx) {
  ctx.tools.register(createTool(ctx))

  // 斜杠命令：不依赖浏览器模块，输入框打 /preflight 立刻可读。
  try {
    ctx.effect(() => ctx.commands.register(createCommand(ctx)), 'context-preflight.command')
  } catch (error) {
    console.error('[context-preflight] command /preflight registration failed', error)
  }

  // 全局层直接注册；webServer 由 inject 保证就绪。
  const registered = [
    registerRoute(ctx, PING_ROUTE_PATH, createPingHandler(), 'context-preflight.ping-route'),
    registerRoute(ctx, ROUTE_PATH, createRouteHandler(ctx), 'context-preflight.summary-route'),
    registerRoute(ctx, LOCALE_ROUTE_PATH, createLocaleHandler(), 'context-preflight.locale-route'),
    registerRoute(ctx, POLICY_ROUTE_PATH, createPolicyHandler(), 'context-preflight.policy-route'),
    registerRoute(ctx, DIAG_ROUTE_PATH, createDiagHandler(ctx), 'context-preflight.diag-route'),
    registerRoute(ctx, REGISTRATIONS_ROUTE_PATH, createRegistrationsHandler(), 'context-preflight.registrations-route'),
    registerRoute(ctx, BOOT_ROUTE_PATH, createBootHandler(), 'context-preflight.boot-route'),
  ]
  console.info(`[context-preflight] routes registered: ${registered.filter(Boolean).length}/7`)

  // 默认策略：会话建立后（第一次注入之前）按 agent 作用域应用一次。
  // 只在全新会话（startup / clear）上生效；resume / compact 继续沿用原来的行为。
  ctx.on('agent/created', (payload) => {
    const source = payload?.source
    if (source !== 'startup' && source !== 'clear') return undefined
    return applyPolicyToAgent(ctx, payload.agent, source)
  })

  // 插件卸载时把按 agent 注册的策略效果一起解开。
  ctx.effect(() => () => releasePolicyDisposers(), 'context-preflight.policy-disposers')
}
