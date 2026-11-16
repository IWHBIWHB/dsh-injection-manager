// 生成 _research/v2-host-routes.json：四条 v2 路由的示例响应，供 UI/QA 对齐。
//
// 用假 ctx 跑真实路由处理器（不启动 DSH、不碰真实 profile），数据里刻意放
// 了三种状态：measured 行带 channels、log 行 channels=null、技能有文件/无文件。
// 运行：node scripts/sample-routes.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const home = await mkdtemp(join(process.env.TEMP ?? '/tmp', 'injection-samples-'))
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const cwd = join(home, 'work')
const skillDir = join(home, 'skills', 'alpha')
await mkdir(cwd, { recursive: true })
await mkdir(skillDir, { recursive: true })
await mkdir(join(home, 'injection-manager'), { recursive: true })
await writeFile(join(cwd, 'AGENTS.md'), '# Workspace rules\n\nBe brief and cite evidence.\n', 'utf8')
await writeFile(join(skillDir, 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n\nFollow the alpha procedure.\n', 'utf8')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
await writeFile(
  join(home, 'injection-manager', 'stats.json'),
  JSON.stringify({
    version: 1,
    sessions: {
      'demo-old': {
        id: 'demo-old',
        at: NOW - DAY * 20,
        firstAt: NOW - DAY * 20,
        cwd: 'D:\\DSH',
        scope: 'startup',
        allOn: 51200,
        effective: 41000,
        peak: 51200,
        samples: 2,
        saved: 10200,
        policy: 'custom',
        channels: { sections: 2400, contexts: 900, skills: 3000, tools: 44120, instructions: 780 },
        compactions: { count: 1, freed: 5000 },
      },
      'demo-log': {
        id: 'demo-log',
        at: NOW - DAY * 3,
        firstAt: NOW - DAY * 3,
        cwd: 'D:\\DSH',
        scope: 'backfill',
        allOn: 83600,
        effective: 83600,
        peak: 83600,
        samples: 0,
        saved: 0,
        policy: 'unknown',
        fromLog: true,
      },
    },
  }),
  'utf8',
)

const { createRoutes } = await import('../lib/routes.js')
const { appendEvent } = await import('../lib/events.js')
const { flushStats, whenBackfillIdle } = await import('../lib/stats.js')
const { resetSourceCache } = await import('../lib/snapshot.js')

const addressNameDescription = 'Return the primary analyzed name at a code or data address. Headless providers require an explicit address; GUI providers may default to their current cursor. Null means the provider has no primary name at that address.'
const reaTools = []
for (let index = 0; index < 60; index += 1) {
  reaTools.push({
    name: index === 0 ? 'mcp__rea__address_name' : `mcp__rea__tool_${String(index).padStart(2, '0')}`,
    description: index === 0 ? addressNameDescription : `REA capability ${index}: ${'analyze the selected artifact '.repeat(80)}`,
    parameters: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Hex address to inspect.' } },
      required: ['address'],
      additionalProperties: false,
    },
  })
}

const ctx = {
  workingDirectory: { ensure: async () => cwd, defaultDirectory: cwd },
  systemPrompt: {
    assemble: async () => ({
      sections: [
        { name: 'harness:identity', order: -1000, text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'deployment:persona-prefix', order: 0, text: 'You are a careful engineering assistant.' },
        { name: 'tools:sdk', order: 5000, text: `Generated tool SDK documentation.\n\n${'Call tools by name with JSON arguments. '.repeat(120)}` },
      ],
      contexts: [
        { name: 'working-directory:current', order: 100, text: `Current working directory: ${cwd}`, required: true },
        { name: 'sandbox:policy', order: 110, text: 'Sandbox policy: danger-full-access.' },
      ],
    }),
  },
  skills: {
    snapshot: async () => ({
      complete: true,
      skills: [
        {
          name: 'alpha',
          description: 'Alpha skill: a demo skill with a real SKILL.md on disk.',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'preset',
          source: 'user',
          path: join(skillDir, 'SKILL.md'),
        },
        {
          name: 'beta',
          description: 'Beta skill: catalog-only, no registered file path.',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'runtime',
          source: 'runtime',
        },
      ],
    }),
  },
  tools: { schemas: () => reaTools },
  agents: {
    get: (id) => (id === 'demo-session' ? agent : undefined),
    currentInitiator: () => agent,
    list: () => [agent],
  },
  get: (name) => {
    if (name !== 'sessionQuery') return undefined
    // 664 个历史会话，和契约示例的 coverage.known 同量级；回填只补 newest 未测日志。
    return {
      async listSessions() {
        return Array.from({ length: 664 }, (_, index) => ({
          header: {
            id: index === 0 ? 'demo-old' : index === 1 ? 'demo-log' : `history-${index}`,
            createdAt: NOW - DAY * 20 + index * 1000,
            cwd: 'D:\\DSH',
          },
          live: false,
        }))
      },
      async readSession() {
        return { events: [] }
      },
    }
  },
}

const agent = { id: 'demo-session', session: {} }

function invoke(handler, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([])
    req.method = method
    req.url = url
    req.headers = headers
    req.destroy = () => {}
    const chunks = []
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: this.statusCode, json })
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

const routes = createRoutes(ctx)

/** /summary 的 v2 增量：只截取新字段和一条 item 示例，避免把 8 语言字典写进样例。 */
async function summaryDelta() {
  const response = await invoke(routes.summary, { url: '/summary?session=demo-session' })
  const snapshot = response.json
  const sampleItems = ['tools', 'skills', 'sections'].map((channel) => {
    const item = snapshot.items.find((entry) => entry.channel === channel && entry.preview !== undefined)
    return item === undefined
      ? null
      : { id: item.id, channel: item.channel, name: item.name, tokens: item.tokens, on: item.on, preview: item.preview }
  })
  return {
    status: response.status,
    apiVersion: snapshot.apiVersion,
    healthSummary: snapshot.healthSummary,
    previewLimit: 180,
    itemPreviewSamples: sampleItems.filter((item) => item !== null),
  }
}

// 事件先落几条，再读 /events；排序约定：窗口内按 at 升序。
await appendEvent({
  sessionId: 'demo-session',
  kind: 'session-created',
  params: { source: 'startup' },
  at: NOW - 5000,
})
await appendEvent({
  sessionId: 'demo-session',
  kind: 'switch',
  params: { group: 'REA', groupId: 'tools:mcp:rea', channel: 'tools', op: 'off', count: 60, tokens: 59542 },
  tokensDelta: -59542,
  at: NOW - 4000,
})
await appendEvent({
  sessionId: 'demo-session',
  kind: 'preset',
  params: { name: 'minimal', via: 'panel' },
  at: NOW - 3000,
})
await appendEvent({
  sessionId: 'demo-session',
  kind: 'compaction',
  params: { op: 'summary', saved: 78400, compactionId: 'cmp-1' },
  tokensDelta: -78400,
  dedupeKey: 'compaction:compaction:cmp-1',
  at: NOW - 2000,
})

// /trend 的 backfill 是后台任务：第一次请求演示 `backfilling:true`（只含已有
// measured 行），等后台补齐后取第二份响应，能看到 log 行 + coverage.known。
const trendFirst = await invoke(routes.trend, { url: '/trend?range=30d&limit=120' })
await whenBackfillIdle()

const [toolContent, skillContent, catalogContent, instructionContent, notFound, badChannel, trend, statsSample, events, health, summary] = [
  await invoke(routes.content, { url: '/content?channel=tools&id=tool%3Amcp__rea__address_name&session=demo-session' }),
  await invoke(routes.content, { url: '/content?channel=skills&id=skill%3Aalpha&session=demo-session' }),
  await invoke(routes.content, { url: '/content?channel=skills&id=skill%3Abeta&session=demo-session' }),
  await invoke(routes.content, { url: `/content?channel=instructions&id=${encodeURIComponent(`instructions:${join(cwd, 'AGENTS.md')}`)}&session=demo-session` }),
  await invoke(routes.content, { url: '/content?channel=tools&id=tool%3Anope&session=demo-session' }),
  await invoke(routes.content, { url: '/content?channel=bogus&id=x&session=demo-session' }),
  await invoke(routes.trend, { url: '/trend?range=30d&limit=120' }),
  await invoke(routes.stats, { url: '/stats' }),
  await invoke(routes.events, { url: '/events?session=demo-session&limit=60' }),
  await invoke(routes.health, { url: '/health?session=demo-session' }),
  await summaryDelta(),
]

await flushStats()
resetSourceCache()

const document = {
  generatedAt: new Date().toISOString(),
  apiVersion: 2,
  package: 'dsh-injection-manager',
  contract: '_research/v2-contract.md §2.1–2.5',
  routePrefix: '/plugins/dsh-injection-manager',
  notes: [
    'GET /summary：items[] 每条带 `on:boolean`（该条是否被当前策略包含；locked 项恒 true，客户端据此渲染开关态与最重套件排行）；`groupLabel`、`savableTokens` 已有；`preview` ≤180 字符。',
    '所有响应 JSON 均为同源只读 GET；带 ok:true 或 ok:false。',
    'GET /content：channel ∈ sections|contexts|skills|tools|instructions；itemId 取 /summary items[].id（singular 前缀 tool:/skill:/section:/context:/instructions:）。找不到 404 {ok:false,error:"not_found"}；channel 非法 400 {ok:false,error:"invalid-channel"}；2s 预算超时 504 {ok:false,error:"timeout"}。',
    'GET /content：content 限 256KB（UTF-8 安全截断，truncated=true 时 content 是合法前缀）；sourcePath 只在读到真实文件（skills/instructions）时出现；note ∈ assemble|snapshot|file|catalog。',
    'GET /trend：points 按 firstAt 升序（时间轴左→右），最多 limit 条（取最近）；channels=null 表示老数据/日志回填未知（不要画成 0）；source ∈ measured|log；aggregate 覆盖 range 内全部行（不受 limit 截断）。',
    'GET /trend：scope 为自由字符串（常见 startup|clear|route.session|backfill，未知值原样显示，≤64 字符）；policy ∈ all|minimal|custom|unknown（unknown = v1 遗留/log 行，UI 显示破折号）。',
    'GET /trend：backfilling=true 表示后台正在补 durable-log 历史（进程内单飞、60s 冷却、每次 ≤8 条/6s）；读路径只返回已有 measured 行，不等待回填，后续轮询补上。',
    'GET /stats（v1 路由同样改造）：首读秒回 measured 行 + backfilling:true；sessions/coverage.known 由后台会话索引补齐，回来后再取即完整。',
    'GET /events：events 窗口内按 at 升序；session 缺省时取当前 agent（再退化为全量 feed）；coverage.from = 窗口最早一条的 at；kind 固定枚举见契约。',
    'GET /health：checks[].action.payload 以 routes.js /action 可直接执行为准——switch-group = {kind:"group",channel,group,enabled:false}（payload 同时给 key/op 供 UI 拼按钮）；set-budget = {kind:"budget",tokens}；open-content/open-tab 是 UI 侧动作。',
    'health 只产出可观测的 code：duplicate-skill / tool-name-collision 当前宿主 API 观察不到（registry 在 snapshot 前已去重），故意不伪造。',
    '所有 token 数字仍为估算（ASCII÷4 + 非 ASCII÷1.6）；events 不写入任何提示词/技能正文。',
  ],
  examples: {
    'GET /content?channel=tools': toolContent.json,
    'GET /content?channel=skills (file)': skillContent.json,
    'GET /content?channel=skills (catalog fallback)': catalogContent.json,
    'GET /content?channel=instructions': instructionContent.json,
    'GET /content (404)': notFound.json,
    'GET /content (400)': badChannel.json,
    'GET /trend?range=30d&limit=120': trend.json,
    'GET /trend 首次请求（backfilling:true）': trendFirst.json,
    'GET /stats（v1，同改造）': statsSample.json,
    'GET /events?session=demo-session&limit=60': events.json,
    'GET /health?session=demo-session': health.json,
  },
  summaryDelta: summary,
}

const target = join(packageDir, '_research', 'v2-host-routes.json')
// 临时目录路径替换成占位符，示例文件不带本机用户名。
const sanitize = (value) => {
  if (typeof value === 'string') return value.split(home).join('<DSH_HOME>')
  if (Array.isArray(value)) return value.map(sanitize)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) out[key] = sanitize(entry)
    return out
  }
  return value
}
await writeFile(target, `${JSON.stringify(sanitize(document), null, 2)}\n`, 'utf8')
console.log(`wrote ${target}`)
await rm(home, { recursive: true, force: true })
