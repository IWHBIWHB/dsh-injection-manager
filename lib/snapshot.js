// Snapshot: what this session's next request actually injects, item by item.
//
// One snapshot feeds the tool card, the HTTP route and the panel, so the three
// can never disagree about a number the way a second client-side
// implementation would. Everything here is read-only.
import { countText, emptyMeasure, percent } from './measure.js'
import { collectInstructions } from './instructions.js'
import { assignGroups, summarizeGroups } from './group.js'
import { undoState } from './history.js'
import {
  CHANNELS,
  describeChannel,
  isExcluded,
  readPolicy,
  selectExcluded,
} from './policy.js'

// How much of one skill's catalog line a description may occupy before the
// harness truncates it (dsh-tool-skill default).
const SKILL_DESCRIPTION_LIMIT = 500

export async function resolveCwd(ctx, agent, signal) {
  if (agent !== undefined && agent !== null) {
    try {
      const options = signal === undefined ? { agent } : { agent, signal }
      const cwd = await ctx.workingDirectory.ensure(agent, options.signal)
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    } catch {
      /* fall through to the default directory */
    }
  }
  const fallback = ctx.workingDirectory.defaultDirectory
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : process.cwd()
}

function sectionItems(sections) {
  return sections.map((section, index) => {
    const measure = countText(typeof section?.text === 'string' ? section.text : '')
    return {
      id: `section:${section?.name ?? index}`,
      channel: 'sections',
      name: String(section?.name ?? `section-${index}`),
      order: Number.isFinite(section?.order) ? section.order : index,
      chars: measure.chars,
      tokens: measure.tokens,
      locked: false,
    }
  })
}

// Contexts the harness marks `required` in its own registration. The assembled
// payload does not always carry that flag back, so the two operational facts
// that must never be dropped are also pinned by name here.
const REQUIRED_CONTEXTS = new Set(['working-directory:current', 'subagent:identity'])

function contextItems(contexts) {
  return contexts.map((context, index) => {
    const measure = countText(typeof context?.text === 'string' ? context.text : '')
    const locked = context?.required === true || REQUIRED_CONTEXTS.has(String(context?.name ?? ''))
    return {
      id: `context:${context?.name ?? index}`,
      channel: 'contexts',
      name: String(context?.name ?? `context-${index}`),
      order: Number.isFinite(context?.order) ? context.order : index,
      chars: measure.chars,
      tokens: measure.tokens,
      locked,
      lockReason: locked ? 'required-context' : undefined,
    }
  })
}

function skillItems(skills) {
  return skills.map((skill) => {
    const description = typeof skill.description === 'string' ? skill.description : ''
    const measure = countText(`${skill.name}\n${description}`)
    return {
      id: `skill:${skill.name}`,
      channel: 'skills',
      name: String(skill.name ?? ''),
      order: 0,
      chars: measure.chars,
      tokens: measure.tokens,
      descriptionChars: description.length,
      truncated: description.length > SKILL_DESCRIPTION_LIMIT,
      provider: typeof skill.provider === 'string' ? skill.provider : undefined,
      source: typeof skill.source === 'string' ? skill.source : undefined,
      locked: false,
    }
  })
}

function toolItems(schemas) {
  return schemas.map((schema, index) => {
    const description = typeof schema.description === 'string' ? schema.description : ''
    let parameters = ''
    try {
      parameters = JSON.stringify(schema.parameters ?? {}) ?? ''
    } catch {
      parameters = ''
    }
    const measure = countText(`${schema.name}\n${description}\n${parameters}`)
    return {
      id: `tool:${schema.name ?? index}`,
      channel: 'tools',
      name: String(schema.name ?? `tool-${index}`),
      order: index,
      chars: measure.chars,
      tokens: measure.tokens,
      deferred: schema.deferLoading === true,
      locked: false,
    }
  })
}

function instructionItems(instructions) {
  return instructions.files
    .filter((file) => file.status !== 'missing')
    .map((file) => ({
      id: `instructions:${file.path}`,
      channel: 'instructions',
      name: file.display,
      order: 0,
      chars: file.chars,
      tokens: file.tokens,
      bytes: file.bytes,
      status: file.status,
      locked: true,
      lockReason: 'no-public-hook',
    }))
}

async function collectSkills(ctx, agent, cwd, signal) {
  const options = { cwd }
  if (agent !== undefined) options.scope = agent
  if (signal !== undefined) options.signal = signal
  try {
    const snapshot = await ctx.skills.snapshot(options)
    const all = Array.isArray(snapshot?.skills) ? snapshot.skills : []
    return {
      complete: snapshot?.complete === true,
      total: all.length,
      modelVisible: all.filter((skill) => skill.invocation?.modelInvocable === true),
      userOnly: all.filter((skill) => skill.invocation?.modelInvocable !== true && skill.invocation?.userInvocable === true).length,
    }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

function collectAnchor(ctx, agent) {
  const meter = ctx.get('tokenMeter')
  const session = agent?.session
  if (meter === undefined || meter === null || session === undefined || session === null) return null
  try {
    const pressure = meter.contextPressure(session)
    if (Number.isFinite(pressure?.pressureTokens) && pressure.pressureTokens > 0) {
      return { tokens: pressure.pressureTokens, source: 'contextPressure' }
    }
    const measurement = meter.measure(session)
    if (measurement?.baseline?.kind === 'usage' && Number.isFinite(measurement.baseline.tokens)) {
      return { tokens: measurement.baseline.tokens, source: 'usage.baseline' }
    }
    if (Number.isFinite(measurement?.totalTokens) && measurement.totalTokens > 0) {
      return { tokens: measurement.totalTokens, source: 'measure.total' }
    }
  } catch {
    /* an anchor is a nicety; the panel prints "—" without it */
  }
  return null
}

// ---------------------------------------------------------------- policy math

/**
 * Single implementation of "what does this policy do to the next injection".
 * The client renders these numbers verbatim; it never re-derives them.
 */
export function previewPolicy(policy, items, channelNames) {
  const lockedByChannel = {}
  for (const item of items) {
    if (!item.locked) continue
    lockedByChannel[item.channel] = lockedByChannel[item.channel] ?? []
    lockedByChannel[item.channel].push(item.name)
  }

  const excludedByChannel = {}
  for (const channel of CHANNELS) {
    const names = channelNames[channel] ?? []
    const locked = new Set(lockedByChannel[channel] ?? [])
    const excluded = selectExcluded(policy[channel], names).filter((name) => !locked.has(name))
    excludedByChannel[channel] = excluded
  }

  // A custom prefix/suffix replaces the persona section rather than stacking on
  // top of it, so the same name is never injected twice.
  const replaced = new Set()
  const adds = []
  if (policy.prompt.prefix.trim().length > 0) {
    replaced.add('deployment:persona-prefix')
    adds.push(countText(policy.prompt.prefix))
  }
  if (policy.prompt.suffix.trim().length > 0) {
    replaced.add('deployment:persona-suffix')
    adds.push(countText(policy.prompt.suffix))
  }

  const tokenOf = new Map(items.map((item) => [`${item.channel}:${item.name}`, item.tokens]))
  const excludedTokens = Object.entries(excludedByChannel).reduce(
    (sum, [channel, names]) =>
      sum + names.reduce((inner, name) => inner + (tokenOf.get(`${channel}:${name}`) ?? 0), 0),
    0,
  )
  const replacedTokens = [...replaced].reduce(
    (sum, name) => sum + (tokenOf.get(`sections:${name}`) ?? 0),
    0,
  )
  const addedTokens = adds.reduce((sum, measure) => sum + measure.tokens, 0)

  const before = items.reduce((sum, item) => sum + item.tokens, 0)
  const after = Math.max(0, before - excludedTokens - replacedTokens + addedTokens)

  return {
    before,
    after,
    savedTokens: Math.max(0, excludedTokens + replacedTokens - addedTokens),
    savedPercent: percent(Math.max(0, excludedTokens + replacedTokens - addedTokens), before),
    excluded: excludedByChannel,
    addedTokens,
    replaced: [...replaced],
  }
}

/**
 * Greedy budget planner: drop the largest manageable items first until the
 * projection fits the target. Deterministic for a given snapshot, and honest
 * about an unreachable budget (instruction files and required contexts cannot
 * be dropped).
 */
export function planBudget(policy, items, targetTokens) {
  const before = items.reduce((sum, item) => sum + item.tokens, 0)
  if (!Number.isFinite(targetTokens) || targetTokens <= 0) {
    return { target: 0, before, after: before, reachable: true, drop: [], dropGroups: [], savedTokens: 0 }
  }
  const candidates = items
    .filter((item) => !item.locked)
    .slice()
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))

  const drop = []
  let total = before
  for (const item of candidates) {
    if (total <= targetTokens) break
    drop.push({ channel: item.channel, name: item.name, tokens: item.tokens })
    total -= item.tokens
  }

  // Present the same drop list per suite: a 147-item suggestion is really
  // "turn REA off", and the panel should say that instead of 147 rows. Grouping
  // is by label, so a tool suite and its prompt section read as one line.
  const byGroup = new Map()
  const groupOf = new Map(items.map((item) => [`${item.channel}:${item.name}`, item]))
  for (const entry of drop) {
    const item = groupOf.get(`${entry.channel}:${entry.name}`)
    const label = item?.groupLabel ?? 'other'
    const key = label.toLowerCase()
    const group = byGroup.get(key) ?? {
      id: key,
      channel: entry.channel,
      label,
      count: 0,
      tokens: 0,
    }
    group.count += 1
    group.tokens += entry.tokens
    byGroup.set(key, group)
  }
  const dropGroups = [...byGroup.values()].sort((left, right) => right.tokens - left.tokens)

  return {
    target: Math.round(targetTokens),
    before,
    after: Math.max(0, total),
    reachable: total <= targetTokens,
    drop,
    dropGroups,
    savedTokens: before - Math.max(0, total),
  }
}

/** Turn a budget plan into the policy that would produce it. */
export function policyFromPlan(base, plan) {
  const next = JSON.parse(JSON.stringify(base))
  next.preset = 'custom'
  for (const channel of CHANNELS) {
    const names = plan.drop.filter((entry) => entry.channel === channel).map((entry) => entry.name)
    const existing = base[channel].mode === 'except' ? base[channel].names : []
    const merged = [...new Set([...existing, ...names])]
    next[channel] = merged.length > 0 ? { mode: 'except', names: merged } : { mode: 'all', names: [] }
  }
  return next
}

// ---------------------------------------------------------------- snapshot

export async function buildSnapshot(ctx, agent, scopeSource, signal) {
  const cwd = await resolveCwd(ctx, agent, signal)
  const policyState = await readPolicy()

  let assembly = { sections: [], contexts: [] }
  let assemblyError = null
  try {
    const options = {}
    if (agent !== undefined) options.scope = agent
    if (signal !== undefined) options.signal = signal
    assembly = await ctx.systemPrompt.assemble(options)
  } catch (error) {
    assemblyError = String(error?.message ?? error)
  }

  const sections = sectionItems(Array.isArray(assembly?.sections) ? assembly.sections : [])
  const contexts = contextItems(Array.isArray(assembly?.contexts) ? assembly.contexts : [])
  const skillState = await collectSkills(ctx, agent, cwd, signal)
  const skills = skillState.error === undefined ? skillItems(skillState.modelVisible) : []
  let schemas = []
  let toolsError = null
  try {
    schemas = ctx.tools.schemas(agent)
  } catch (error) {
    toolsError = String(error?.message ?? error)
  }
  const tools = toolItems(Array.isArray(schemas) ? schemas : [])
  const instructions = await collectInstructions(cwd)
  const instructionRows = instructionItems(instructions)

  const items = assignGroups([...sections, ...contexts, ...skills, ...tools, ...instructionRows])
  const groups = summarizeGroups(items)
  const channelNames = {
    sections: sections.map((item) => item.name),
    contexts: contexts.map((item) => item.name),
    skills: skills.map((item) => item.name),
    tools: tools.map((item) => item.name),
  }

  const byChannel = (channel) => {
    const rows = items.filter((item) => item.channel === channel)
    return {
      id: channel,
      count: rows.length,
      chars: rows.reduce((sum, item) => sum + item.chars, 0),
      tokens: rows.reduce((sum, item) => sum + item.tokens, 0),
      savableTokens: rows.filter((item) => !item.locked).reduce((sum, item) => sum + item.tokens, 0),
    }
  }
  const channels = [...CHANNELS, 'instructions'].map((channel) =>
    channel === 'instructions'
      ? {
          ...byChannel('instructions'),
          count: instructions.loadedCount,
          manageable: false,
          error: assemblyError,
        }
      : { ...byChannel(channel), manageable: true },
  )

  const totals = channels.reduce(
    (sum, channel) => ({
      chars: sum.chars + channel.chars,
      tokens: sum.tokens + channel.tokens,
      savableTokens: sum.savableTokens + (channel.manageable ? channel.savableTokens : 0),
    }),
    { chars: 0, tokens: 0, savableTokens: 0 },
  )

  const preview = previewPolicy(policyState.policy, items, channelNames)
  const plan = planBudget(policyState.policy, items, policyState.policy.budget.tokens)
  const anchor = collectAnchor(ctx, agent)
  const applied = agent !== undefined && agent !== null && appliedAgents.has(agent)

  const policy = {
    ...policyState.policy,
    path: policyState.path,
    exists: policyState.exists === true,
    legacy: policyState.legacy === true,
    error: policyState.error ?? null,
    appliedToThisAgent: applied,
    lastApplication: lastApplicationState,
    channels: Object.fromEntries(CHANNELS.map((channel) => [channel, describeChannel(policyState.policy[channel], channelNames[channel])])),
    preview,
    plan,
    manageableShare: percent(totals.savableTokens, totals.tokens),
  }

  return {
    generatedAt: Date.now(),
    cwd,
    agent: { id: typeof agent?.id === 'string' ? agent.id : undefined, scopeSource },
    channels,
    items,
    groups,
    locks: items
      .filter((item) => item.locked)
      .map((item) => ({ channel: item.channel, name: item.name, reason: item.lockReason ?? 'locked', tokens: item.tokens })),
    instructions,
    skillsState: {
      total: skillState.total ?? 0,
      modelVisible: skillState.modelVisible?.length ?? 0,
      userOnly: skillState.userOnly ?? 0,
      complete: skillState.complete === true,
      error: skillState.error ?? null,
      truncated: skills.filter((item) => item.truncated).length,
    },
    toolsState: { count: tools.length, deferred: tools.filter((item) => item.deferred).length, error: toolsError },
    promptsState: { sections: sections.length, contexts: contexts.length, error: assemblyError },
    totals: {
      ...totals,
      anchor,
      delta: anchor === null ? null : Math.round(((totals.tokens - anchor.tokens) / Math.max(1, anchor.tokens)) * 100),
      savablePercent: percent(totals.savableTokens, totals.tokens),
    },
    policy,
    undo: undoState(),
  }
}

// Filled in by index.js so the snapshot can report application state without
// importing the applier (which would create a cycle).
export const appliedAgents = new WeakSet()
export let lastApplicationState = null
export function setLastApplication(state) {
  lastApplicationState = state
}
