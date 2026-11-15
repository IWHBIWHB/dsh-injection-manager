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
import { createRoutes, ROUTES } from './lib/routes.js'
import { buildSnapshot, planBudget, policyFromPlan } from './lib/snapshot.js'
import { presetPolicy } from './lib/presets.js'
import { readPolicy } from './lib/policy.js'
import { setSettings } from './lib/settings.js'
import { pushUndo, undoLastPolicy } from './lib/actions.js'
import { renderCard, renderText } from './lib/text.js'

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
// policy.json, so this form stays short and safe to edit.
export const Config =
  Schema === undefined
    ? undefined
    : Schema.object({
        dock: Schema.boolean()
          .default(true)
          .description('在输入框旁显示「注入 xxk · 可关 xx%」徽标；关掉只隐藏入口，不影响策略。'),
        refreshOnFocus: Schema.boolean()
          .default(true)
          .description('窗口重新获得焦点时刷新面板，多窗口同时开关时不会看到旧数字。'),
        showRawNames: Schema.boolean()
          .default(true)
          .description('在中文条目名旁显示原始键名（如 harness:identity），排障时有用。'),
        budgetTokens: Schema.number()
          .default(0)
          .description('策略文件还没有时的默认预算 token（0 = 不设）；只在首次使用前作为初始值。'),
      })

// Hard dependencies: the tool needs the registry, the snapshot needs the prompt
// registry, skills and the working directory, the panel needs a web server, and
// the routes need to resolve a live agent. `webServer` must be declared here
// rather than fetched with ctx.get(): during early boot it is undefined and the
// routes would silently never register.
export const inject = ['tools', 'systemPrompt', 'skills', 'workingDirectory', 'agents', 'webServer', 'commands']

const TOOL_NAME = 'context_injection'

const TOOL_DESCRIPTION =
  '查看本轮请求将注入给模型的上下文构成：系统提示词段落、运行时上下文、技能目录、工具 schema、工作区规则，各占多少字符与估算 token，以及哪些条目可以关闭。只读：本工具不改策略、不改任何文件；开关在侧栏「上下文注入」面板里。'

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

function createTool(ctx) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 30000,
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: String(value?.card ?? value?.text ?? '') }],
    },
    async execute(_args, exec) {
      const { agent, source } = resolveAgent(ctx, exec)
      const snapshot = await buildSnapshot(ctx, agent, source, exec?.signal)
      const payload = { ...snapshot, text: renderText(snapshot), card: renderCard(snapshot) }
      // The tool result must be lossless JSON.
      return JSON.parse(JSON.stringify(payload))
    },
  }
}

export function createCommand(ctx) {
  return {
    name: 'inject',
    description: '查看首轮上下文注入清单；`/inject minimal|all` 切换预设，`/inject budget 20000` 设定预算。',
    async handler(invocation) {
      const agent = invocation?.agent
      const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
      const snapshot = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
      try {
        const [command, value] = raw.split(/\s+/).filter((part) => part.length > 0)
        if (command === undefined) return { kind: 'success', text: renderText(snapshot) }

        if (command === 'all' || command === 'minimal') {
          const names = {
            sections: snapshot.items.filter((item) => item.channel === 'sections').map((item) => item.name),
            contexts: snapshot.items.filter((item) => item.channel === 'contexts').map((item) => item.name),
            skills: snapshot.items.filter((item) => item.channel === 'skills').map((item) => item.name),
            tools: snapshot.items.filter((item) => item.channel === 'tools').map((item) => item.name),
          }
          const state = await readPolicy()
          pushUndo(state.policy)
          const next = presetPolicy(command, names)
          next.prompt = state.policy.prompt
          next.budget = state.policy.budget
          await savePolicy(next)
          const after = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
          return {
            kind: 'success',
            text: `已切换预设：${command}\n新会话首轮 ≈ ${after.policy.preview.after} token（−${after.policy.preview.savedTokens}）\n\n${renderText(after)}`,
          }
        }

        if (command === 'budget') {
          const tokens = Number(value)
          if (!Number.isFinite(tokens) || tokens <= 0) {
            return { kind: 'error', text: '用法：/inject budget <token 数>，例如 /inject budget 20000' }
          }
          const state = await readPolicy()
          pushUndo(state.policy)
          await savePolicy({ ...state.policy, budget: { tokens: Math.round(tokens) } })
          return { kind: 'success', text: `首轮注入预算已设为 ${Math.round(tokens)} token（新会话生效）。` }
        }

        if (command === 'apply') {
          const state = await readPolicy()
          const target = Number(value) > 0 ? Math.round(Number(value)) : state.policy.budget.tokens
          if (!Number.isFinite(target) || target <= 0) {
            return { kind: 'error', text: '用法：/inject apply [token 数]，或用 /inject budget <token 数> 先设预算。' }
          }
          const plan = planBudget(state.policy, snapshot.items, target)
          if (plan.drop.length === 0) {
            return { kind: 'success', text: `当前首轮注入 ${plan.before} token 已在 ${plan.target} 预算内，无需关闭。` }
          }
          pushUndo(state.policy)
          const next = policyFromPlan(state.policy, plan)
          next.prompt = state.policy.prompt
          next.budget = { tokens: plan.target }
          await savePolicy(next)
          const after = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
          const suites = (plan.dropGroups ?? []).map((group) => `  ${group.label} · ${group.count} 项 · ${group.tokens} token`).join('\n')
          return {
            kind: 'success',
            text: `已按 ${plan.target} token 预算应用：关闭 ${plan.drop.length} 项（−${plan.savedTokens}），预计首轮 ${plan.after}。\n${suites}\n\n${renderText(after)}`,
          }
        }

        if (command === 'undo') {
          await undoLastPolicy()
          const after = await buildSnapshot(ctx, agent, 'command', invocation?.signal)
          return {
            kind: 'success',
            text: `已撤销上一步策略。新会话首轮 ≈ ${after.policy.preview.after} token。`,
          }
        }

        return {
          kind: 'error',
          text: '可用：/inject · /inject all · /inject minimal · /inject budget <token 数> · /inject apply [token 数] · /inject undo',
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
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `injection-manager route ${key}`)
  }

  // The only moment a policy can still influence the first assemble().
  ctx.on('agent/created', async (payload) => {
    await applyPolicyForAgent(ctx, payload?.agent, payload?.source)
  })

  ctx.effect(() => () => releaseAll(), 'injection-manager cleanup')
}
