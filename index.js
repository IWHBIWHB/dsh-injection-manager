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
import { buildHealth } from './lib/health.js'
import { presetPolicy } from './lib/presets.js'
import { readPolicy } from './lib/policy.js'
import { setSettings } from './lib/settings.js'
import { pushUndo, undoLastPolicy } from './lib/actions.js'
import { withPolicyLock } from './lib/lock.js'
import { renderCard, renderHealthLine, renderHealthText, renderText } from './lib/text.js'

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
      })

// Hard dependencies: the tool needs the registry, the snapshot needs the prompt
// registry, skills and the agent boundary, the panel needs a web server, and the
// routes need a live agent. `webServer` must be declared here rather than
// fetched with ctx.get(): during early boot it is undefined and the routes would
// silently never register. `workingDirectory` is deliberately NOT here: it
// arrived after 0.2.0-rc.1, and lib/snapshot.js resolves the cwd through
// optional services so the plugin still activates on 0.2.0 hosts.
export const inject = ['tools', 'systemPrompt', 'skills', 'agents', 'webServer', 'commands']

const TOOL_NAME = 'context_injection'

const TOOL_DESCRIPTION =
  '查看本轮请求将注入给模型的上下文构成：系统提示词段落、运行时上下文、技能目录、工具 schema、工作区规则，各占多少字符与估算 token，以及哪些条目可以关闭。只读：本工具不改策略、不改任何文件；开关在侧栏「上下文注入」面板里。可选参数 {channel, name}：只返回该条目的原文（单条 ≤32KB），不带参数才返回完整清单。'

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
        apiVersion: 2,
        ...snapshot,
        text: renderText(snapshot),
        card: renderCard(snapshot),
      }
      // The tool result must be lossless JSON.
      return JSON.parse(JSON.stringify(payload))
    },
  }
}

export function createCommand(ctx) {
  return {
    name: 'inject',
    description: '查看首轮上下文注入清单；`/inject health` 看健康检查，`/inject minimal|all` 切换预设，`/inject undo` 撤销上一步。',
    async handler(invocation) {
      const agent = invocation?.agent
      const sessionId = typeof agent?.id === 'string' && agent.id.length > 0 ? agent.id : undefined
      const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
      const snapshot = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
      try {
        const [command, value] = raw.split(/\s+/).filter((part) => part.length > 0)
        if (command === undefined) {
          // The full report plus a single health line: the line is the "should I
          // care?" answer, and `/inject health` is the detail behind it.
          return { kind: 'success', text: `${renderText(snapshot)}\n\n${renderHealthLine(buildHealth(snapshot))}` }
        }

        if (command === 'health') {
          return { kind: 'success', text: renderHealthText(buildHealth(snapshot)) }
        }

        if (command === 'all' || command === 'minimal') {
          const names = {
            sections: snapshot.items.filter((item) => item.channel === 'sections').map((item) => item.name),
            contexts: snapshot.items.filter((item) => item.channel === 'contexts').map((item) => item.name),
            skills: snapshot.items.filter((item) => item.channel === 'skills').map((item) => item.name),
            tools: snapshot.items.filter((item) => item.channel === 'tools').map((item) => item.name),
          }
          // Same queue as the panel's writes: a slash command racing a click
          // must not lose either change.
          await withPolicyLock(async () => {
            const state = await readPolicy()
            pushUndo(state.policy)
            const next = presetPolicy(command, names)
            next.prompt = state.policy.prompt
            await savePolicy(next, { sessionId, kind: 'preset', params: { name: command, via: 'command' } })
          })
          const after = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
          return {
            kind: 'success',
            text: `已切换预设：${command}\n新会话首轮 ≈ ${after.policy.preview.after} token（−${after.policy.preview.savedTokens}）\n\n${renderText(after)}`,
          }
        }

        if (command === 'undo') {
          await withPolicyLock(() => undoLastPolicy({ sessionId, params: { via: 'command' } }))
          const after = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
          return {
            kind: 'success',
            text: `已撤销上一步策略。新会话首轮 ≈ ${after.policy.preview.after} token。`,
          }
        }

        return {
          kind: 'error',
          text: '可用：/inject · /inject health · /inject all · /inject minimal · /inject undo',
        }
      } catch (error) {
        return { kind: 'error', text: `注入策略操作失败：${error?.message ?? error}` }
      }
    },
  }
}

export function apply(ctx, config) {
  setSettings(config)
  ctx.tools.register(createTool(ctx))

  ctx.effect(() => ctx.commands.register(createCommand(ctx)), 'injection-manager command')

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
