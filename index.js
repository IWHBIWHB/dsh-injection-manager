// 上下文注入管理 — Context Injection Manager.
//
// One place that answers "what is this session about to be given before its
// first request, and which of it can I turn off?" and then applies the answer
// to every new session.
//
// Design boundaries, kept deliberately narrow:
//   - Read-only toward the workspace: the plugin never edits AGENTS.md,
//     SKILL.md or any project file. Every switch is a scoped registration.
//   - The panel's numbers, the tool card and the applied policy all come from
//     one snapshot, so they cannot drift apart.
//   - Only sessions created after a policy change are affected; a running
//     conversation is never rewritten mid-flight.
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyPolicyForAgent, releaseAll, savePolicy } from './lib/apply.js'
import { createRoutes, makeFencedHandler, ROUTES } from './lib/routes.js'
import { buildSnapshot } from './lib/snapshot.js'
import { watchCompaction } from './lib/compaction.js'
import { CONTENT_CHANNELS, TOOL_CONTENT_LIMIT, collectContent } from './lib/content.js'
import { appendEvent } from './lib/events.js'
import { getSettings, setSettings } from './lib/settings.js'
import { renderCard, renderText } from './lib/text.js'
import { captureAssembly, configureLedger, finalizePreStep, ledgerEntries, ledgerEntry, ledgerStats, setLedgerEnabled } from './lib/ledger-capture.js'

export const name = 'injection-manager'

// A linked plugin directory has no node_modules of its own, so the schema
// library must be resolved from the profile that loaded us. If no anchor works
// (a non-profile launch), Config stays undefined and the plugin still runs with
// the defaults in lib/settings.js.
function loadSchema() {
  const anchors = []
  if (process.env.DSH_PROFILE_DIR) anchors.push(join(process.env.DSH_PROFILE_DIR, 'package.json'))
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'desktop'
  anchors.push(join(home, 'profiles', profile, 'package.json'))
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('@deepseek-ai/schemastery')
    } catch {
      /* try the next anchor */
    }
  }
  return undefined
}

const Schema = loadSchema()

// Presentation and one seeding default. Every actual switch lives in
// policy.json, so this form stays short and safe to edit. All three fields are
// volatile: they are toggled from the settings cards in the running UI, and an
// edit that restarted the plugin to hide a chip would drop the in-memory state.
export const Config =
  Schema === undefined
    ? undefined
    : Schema.object({
        dock: Schema.boolean()
          .default(true)
          .volatile()
          .description('在输入框旁显示「注入 xxk · 可关 xx%」徽标；关掉只隐藏入口，不影响策略。'),
        refreshOnFocus: Schema.boolean()
          .default(true)
          .volatile()
          .description('窗口重新获得焦点时刷新面板，多窗口同时开关时不会看到旧数字。'),
        showRawNames: Schema.boolean()
          .default(true)
          .volatile()
          .description('在中文条目名旁显示原始键名（如 harness:identity），排障时有用。'),
        ledger: Schema.boolean()
          .default(true)
          .volatile()
          .description('记录每次请求的注入台账（逐项精确原文与估算 token，落在 $DSH_HOME/injection-manager/ledger*），面板「台账」页回看。'),
      })

// Hard dependencies: the tool needs the registry, the snapshot needs the prompt
// registry, skills and the agent boundary, the panel needs a web server, and the
// routes need a live agent. `webServer` must be declared here rather than
// fetched with ctx.get(): during early boot it is undefined and the routes would
// silently never register. `workingDirectory` is deliberately NOT here: it
// arrived after 0.2.0-rc.1, and lib/snapshot.js resolves the cwd through
// optional services so the plugin still activates on 0.2.0 hosts.
export const inject = ['tools', 'systemPrompt', 'skills', 'agents', 'webServer']

const TOOL_NAME = 'context_injection'

const TOOL_DESCRIPTION =
  '查看本轮请求将注入给模型的上下文构成：系统提示词段落、运行时上下文、技能目录、工具 schema、工作区规则，各占多少字符与估算 token，以及哪些条目可以关闭。只读：本工具不改策略、不改任何文件；开关在侧栏「上下文注入」面板里。可选参数 {channel, name}：只返回该条目的原文（单条 ≤32KB），不带参数才返回完整清单。加 {ledger:true} 改读注入台账：本会话每次请求实际注入的条目、归属与拦截情况（可再带 {entry, limit}）。'

const SINGLE_CONTENT_HINT = 'channel 和 name 必须同时提供（如 {channel:"tools", name:"read"}）；不带参数调用才返回完整清单。'

function resolveAgent(ctx, exec) {
  if (exec?.agent !== undefined) return { agent: exec.agent, source: 'exec.agent' }
  try {
    const initiator = ctx.agents.currentInitiator()
    if (initiator !== undefined) return { agent: initiator, source: 'initiator' }
  } catch {
    /* no initiator boundary */
  }
  return { agent: undefined, source: 'none' }
}

export function createTool(ctx) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: [...CONTENT_CHANNELS],
          description: '可选：只读查看单条内容所属的通道；必须同时提供 name。',
        },
        name: {
          type: 'string',
          description: '可选：条目名，与 /summary items[].name 一致（段落名 / 上下文名 / 技能名 / 工具名 / 规则文件路径）；必须同时提供 channel。',
        },
        ledger: {
          type: 'boolean',
          description: '可选：true 时改读「注入台账」——本会话每次模型请求实际注入了什么（逐项来源归属、是否被策略拦下、估算 token）。默认返回最近 5 条摘要。',
        },
        entry: {
          type: 'string',
          description: '可选：台账记录 id，配合 ledger:true 返回该次请求的逐项明细。',
        },
        limit: {
          type: 'number',
          description: '可选：ledger:true 时返回的最近记录条数（1-50，默认 5）。',
        },
      },
      additionalProperties: false,
    },
    timeoutMs: 30000,
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: String(value?.card ?? value?.text ?? value?.content ?? '') }],
    },
    async execute(args, exec) {
      const { agent, source } = resolveAgent(ctx, exec)
      if (args?.ledger === true) {
        // Ledger mode: the record captured at the assembly waterfall, i.e. what
        // the model was really given, not a re-derivation.
        const entryId = typeof args?.entry === 'string' && args.entry.length > 0 ? args.entry : undefined
        if (entryId !== undefined) {
          const found = ledgerEntry(entryId)
          if (found.ok !== true) return { ok: false, error: found.error ?? 'not-found', entry: entryId }
          return JSON.parse(JSON.stringify({ ok: true, apiVersion: 3, entry: found.entry, note: '台账条目：sections/contexts/tools 是实际注入项，blocked 是被策略拦下的项，estimates 为估算 token（非计费）。' }))
        }
        const sessionId = typeof agent?.id === 'string' ? agent.id : undefined
        const limit = typeof args?.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(50, Math.round(args.limit))) : 5
        const payload = ledgerEntries({ session: sessionId, limit })
        const latest = payload.latest
        return JSON.parse(
          JSON.stringify({
            ok: true,
            apiVersion: 3,
            session: sessionId,
            stats: ledgerStats(),
            total: payload.total,
            entries: payload.entries,
            latest,
            card: latest === null
              ? '注入台账：本会话还没有请求记录（发一条消息后出现）。'
              : `注入台账：${payload.total} 次请求；最近一次 ${latest.id}，段落 ${latest.counts.sections} / 上下文 ${latest.counts.contexts} / 工具 ${latest.counts.tools}，估算 ${latest.totals.tokens} token，策略拦下 ${latest.counts.blockedSections + latest.counts.blockedContexts} 项。完整明细用 {ledger:true, entry:"<id>"}。`,
            note: '台账只读：记录来自 system-prompt/assemble 装配现场，含每次请求的精确文本摘要与归属；原文用面板台账页查看。',
          }),
        )
      }
      const channel = typeof args?.channel === 'string' && args.channel.length > 0 ? args.channel : undefined
      const name = typeof args?.name === 'string' && args.name.trim().length > 0 ? args.name.trim() : undefined
      if (channel !== undefined || name !== undefined) {
        // Single-item mode: the caller asked to read one row, not the whole
        // snapshot. Hard-capped at 32KB so a page of prompt text cannot flood a
        // model turn; the full snapshot stays behind the no-argument call.
        if (channel === undefined || name === undefined) {
          return { ok: false, error: 'invalid-arguments', message: SINGLE_CONTENT_HINT }
        }
        const result = await collectContent(ctx, agent, channel, name, exec?.signal, { limit: TOOL_CONTENT_LIMIT })
        if (result.ok !== true) {
          return JSON.parse(
            JSON.stringify({ ok: false, error: result.error ?? 'content-failed', message: result.message ?? '', channel, name }),
          )
        }
        const payload = {
          ok: true,
          item: result.item,
          contentType: result.contentType,
          content: result.content,
          bytes: result.bytes,
          truncated: result.truncated,
          limit: result.limit,
          ...(result.sourcePath === undefined ? {} : { sourcePath: result.sourcePath }),
          ...(result.note === undefined ? {} : { note: result.note }),
        }
        return JSON.parse(JSON.stringify(payload))
      }
      const snapshot = await buildSnapshot(ctx, agent, source, exec?.signal)
      const payload = {
        ok: true,
        apiVersion: 3,
        ...snapshot,
        text: renderText(snapshot),
        card: renderCard(snapshot),
      }
      // The tool result must be lossless JSON.
      return JSON.parse(JSON.stringify(payload))
    },
  }
}

export function apply(ctx, config) {
  setSettings(config)
  ctx.tools.register(createTool(ctx))

  // Injection ledger: observe the one place where the complete model-facing
  // prompt exists (the assembly waterfall) instead of re-deriving it from
  // services. `captureAssembly` runs first and records after `next()`, so the
  // offered/admitted pair is the real before/after of every listener, including
  // this plugin's own policy filter. `agent/pre-step` runs after the assembly
  // (agent-loop/src/agent.ts:300 then :302) and finalises the same record with
  // the step numbers and the decided message-level injections.
  configureLedger({ enabled: () => getSettings().ledger !== false })
  ctx.effect(
    () => ctx.on('system-prompt/assemble', (assembly, context, next) => captureAssembly(ctx, assembly, context, next)),
    'injection-manager ledger assembly capture',
  )
  ctx.effect(
    () =>
      ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next()
        try {
          finalizePreStep(payload?.agent, payload, decision)
        } catch (error) {
          console.warn('[injection-manager] ledger pre-step capture failed', error)
        }
        return decision
      }),
    'injection-manager ledger pre-step capture',
  )

  const routes = createRoutes(ctx)
  for (const [key, path] of Object.entries(ROUTES)) {
    const handler = routes[key]
    if (typeof handler !== 'function') continue
    // Every registered route first asks the host's connection service for a
    // Host/Origin (and browser-auth) rejection. A rejected request is answered
    // by the fence itself, before any route logic or file read. Older hosts
    // without the service fall through unchanged (see makeFencedHandler).
    const fenced = makeFencedHandler(ctx, handler)
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: fenced }), `injection-manager route ${key}`)
  }

  // The only moment a policy can still influence the first assemble().
  ctx.on('agent/created', async (payload) => {
    const sessionId = typeof payload?.agent?.id === 'string' ? payload.agent.id : undefined
    // Fire-and-forget: session creation is serial and blocks the first request,
    // so the feed write must not sit in its critical path.
    void appendEvent({
      sessionId,
      kind: 'session-created',
      params: { source: typeof payload?.source === 'string' ? payload.source : 'unknown' },
    })
    await applyPolicyForAgent(ctx, payload?.agent, payload?.source)
  })

  // Compaction receipts: "it threw away 78k tokens for you" is a durable log
  // fact, not an inference from a shrinking total.
  ctx.effect(() => {
    const dispose = watchCompaction(ctx)
    return typeof dispose === 'function' ? dispose : () => {}
  }, 'injection-manager compaction receipts')

  ctx.effect(() => () => releaseAll(), 'injection-manager cleanup')
}
