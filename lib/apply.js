// Apply the saved policy to one newly created session.
//
// Every effect is scoped to the agent's own context, so:
//   - the running session is never touched (only sessions created afterwards),
//   - unloading the plugin or disposing the agent removes the effects,
//   - no workspace file is read or written for a switch to work.
//
// Sections and dynamic contexts cannot be shadowed by re-registering a
// same-named contribution: agent presets already register those names *in the
// agent scope*, and a second registration there throws "already registered in
// this scope". The supported rewrite point is the scoped
// `system-prompt/assemble` waterfall, which receives the resolved sections and
// contexts and lets a listener drop or rewrite them. Tools are removed with
// `tools.restrict()`; skills are hidden with a same-name, non-invocable
// registration in the agent's skill layer.
import { buildSnapshot, appliedAgents, setLastApplication } from './snapshot.js'
import { writePolicy } from './policy.js'

// Registrations a policy created, keyed by agent id, so plugin unload can undo
// them even if the agent outlives the plugin.
const disposers = new Map()

// Evidence that the scoped waterfall really ran, surfaced by GET /diag.
// Registration succeeding is not proof; a counted rewrite is.
let rewriteCount = 0
let lastRewrite = null
export const rewriteStats = () => ({ count: rewriteCount, last: lastRewrite })

export function releaseAll() {
  for (const list of disposers.values()) {
    for (const dispose of list) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch (error) {
        console.error('[injection-manager] disposer failed', error)
      }
    }
  }
  disposers.clear()
}

function remember(agent, dispose) {
  if (typeof dispose !== 'function') return
  const key = typeof agent.id === 'string' ? agent.id : 'unknown'
  const list = disposers.get(key) ?? []
  list.push(dispose)
  disposers.set(key, list)
}

/** Wait for a declared-dependency child context, without hanging forever. */
function withScope(agentCtx, deps, run) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer

    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (error === undefined) resolve()
      else reject(error)
    }

    try {
      agentCtx.inject(deps, (scoped) => {
        try {
          run(scoped)
          finish()
        } catch (error) {
          finish(error)
        }
        return () => {}
      })
    } catch (error) {
      finish(error)
      return
    }
    timer = setTimeout(() => finish(new Error('scoped dependencies did not resolve within 2000ms')), 2000)
  })
}

/** Apply one already-built snapshot (same numbers the panel shows). */
async function applySnapshotPolicy(agent, snapshot, report) {
  const policy = snapshot.policy
  const excluded = policy.preview.excluded
  const prefix = policy.prompt.prefix.trim()
  const suffix = policy.prompt.suffix.trim()

  const sectionsOff = new Set(excluded.sections ?? [])
  if (prefix.length > 0) sectionsOff.delete('deployment:persona-prefix')
  if (suffix.length > 0) sectionsOff.delete('deployment:persona-suffix')

  const contextsOff = new Set(excluded.contexts ?? [])
  const skillsOff = excluded.skills ?? []
  const toolsOff = excluded.tools ?? []

  const rewrite = async (assembly, context, next) => {
    // Cordis may pass (payload, next) or (payload, context, next) depending on
    // the waterfall's arity; accept both instead of crashing a session's first
    // prompt over a signature detail.
    const proceed = typeof next === 'function' ? next : context
    const resolved = await proceed()
    rewriteCount += 1
    const before = { sections: (resolved.sections ?? []).length, contexts: (resolved.contexts ?? []).length }
    const out = { ...resolved }
    out.sections = (resolved.sections ?? [])
      .filter((section) => !sectionsOff.has(section?.name))
      .map((section) => {
        if (prefix.length > 0 && section?.name === 'deployment:persona-prefix') {
          return { ...section, text: prefix, interpolate: false }
        }
        if (suffix.length > 0 && section?.name === 'deployment:persona-suffix') {
          return { ...section, text: suffix, interpolate: false }
        }
        return section
      })
    // A custom prefix/suffix also works when the deployment has no persona
    // section registered at all.
    const has = (name) => out.sections.some((section) => section?.name === name)
    if (prefix.length > 0 && !has('deployment:persona-prefix')) {
      out.sections = [{ name: 'deployment:persona-prefix', order: 0, text: prefix, interpolate: false }, ...out.sections]
    }
    if (suffix.length > 0 && !has('deployment:persona-suffix')) {
      out.sections = [...out.sections, { name: 'deployment:persona-suffix', order: 10200, text: suffix, interpolate: false }]
    }
    out.contexts = (resolved.contexts ?? []).filter((context) => !contextsOff.has(context?.name))
    lastRewrite = {
      at: Date.now(),
      before,
      after: { sections: out.sections.length, contexts: out.contexts.length },
      agent: typeof agent.id === 'string' ? agent.id : undefined,
    }
    return out
  }

  // The waterfall must be registered on the agent's own context: dispatch is
  // scope-filtered, so this listener runs for this agent only.
  remember(agent, agent.ctx.on('system-prompt/assemble', rewrite))

  await withScope(agent.ctx, ['tools', 'skills'], (scoped) => {
    const applied = {
      sections: [...sectionsOff],
      customPrefix: prefix.length > 0,
      customSuffix: suffix.length > 0,
      contexts: [...contextsOff],
      skills: [],
      tools: [],
    }

    for (const name of skillsOff) {
      // A same-name runtime skill in the agent layer wins over the global
      // catalog entry and is not model-invocable, so the catalog drops it.
      remember(
        agent,
        scoped.skills.register({
          name,
          description: 'hidden by dsh-injection-manager policy',
          content: '',
          source: 'runtime',
          invocation: { modelInvocable: false, userInvocable: false },
        }),
      )
      applied.skills.push(name)
    }

    if (toolsOff.length > 0) {
      // Deny the exact names that exist right now; an unknown name throws.
      remember(agent, scoped.tools.restrict({ deny: toolsOff }))
      applied.tools.push(...toolsOff)
    }

    report.applied = applied
  })
}

/**
 * Entry point for `agent/created`.
 * Only fresh sessions are touched: resume and compact already carry a prompt
 * and history, and rewriting those mid-flight is not what a default policy
 * means.
 */
export async function applyPolicyForAgent(ctx, agent, source) {
  if (agent === undefined || agent === null) return
  const report = {
    at: Date.now(),
    sessionId: typeof agent.id === 'string' ? agent.id : '(unknown)',
    source,
  }

  if (appliedAgents.has(agent)) return
  if (source !== 'startup' && source !== 'clear') {
    report.skipped = `source=${source}: policy applies to new sessions only`
    setLastApplication({ at: Date.now(), report })
    return
  }

  try {
    const snapshot = await buildSnapshot(ctx, agent, 'policy', undefined)
    await applySnapshotPolicy(agent, snapshot, report)
    report.projectedTokens = snapshot.policy.preview.after
    report.savedTokens = snapshot.policy.preview.savedTokens
    appliedAgents.add(agent)
    console.info('[injection-manager] policy applied', report)
  } catch (error) {
    report.error = String(error?.message ?? error)
    console.error('[injection-manager] policy apply failed', report, error)
  } finally {
    setLastApplication({ at: Date.now(), report })
  }
}

/** Persist a policy computed elsewhere (preset or budget plan). */
export async function savePolicy(policy) {
  const written = await writePolicy(policy)
  console.info('[injection-manager] policy saved', { path: written.path })
  return written.policy
}
