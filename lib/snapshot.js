// Snapshot: what this session's next request actually injects, item by item.
//
// One snapshot feeds the tool card, the HTTP route and the panel, so the three
// can never disagree about a number the way a second client-side
// implementation would. Everything here is read-only.
import { countText, emptyMeasure, percent } from './measure.js'
import { collectInstructions } from './instructions.js'
import { assignGroups, summarizeGroups } from './group.js'
import { undoState } from './history.js'
import { hostInfo } from './hostinfo.js'
import { compactionOf } from './compaction.js'
import { occupancyTone, readContext } from './pressure.js'
import { recordSnapshot } from './stats.js'
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
// Preview ceil: the panel renders this inline, so a row stays one line-ish and
// the /summary payload stays bounded even with hundreds of items.
const PREVIEW_LIMIT = 180

/**
 * First paragraph of arbitrary text, flattened and cut to PREVIEW_LIMIT code
 * units without splitting a surrogate pair. Used only for presentation; the
 * measured numbers stay on the item itself.
 */
export function previewText(text, limit = PREVIEW_LIMIT) {
  const source = typeof text === 'string' ? text : ''
  if (source.trim().length === 0) return undefined
  const paragraph = source.split(/\n\s*\n/).find((part) => part.trim().length > 0) ?? source
  const flat = paragraph.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return undefined
  if (flat.length <= limit) return flat
  let cut = limit - 1
  const code = flat.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  return `${flat.slice(0, cut)}…`
}

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
    const text = typeof section?.text === 'string' ? section.text : ''
    const measure = countText(text)
    const preview = previewText(text)
    return {
      id: `section:${section?.name ?? index}`,
      channel: 'sections',
      name: String(section?.name ?? `section-${index}`),
      order: Number.isFinite(section?.order) ? section.order : index,
      chars: measure.chars,
      tokens: measure.tokens,
      locked: false,
      ...(preview === undefined ? {} : { preview }),
    }
  })
}

// Contexts the harness marks `required` in its own registration. The assembled
// payload does not always carry that flag back, so the two operational facts
// that must never be dropped are also pinned by name here.
const REQUIRED_CONTEXTS = new Set(['working-directory:current', 'subagent:identity'])

/** Contexts that no policy can switch off; /content reports the same lock. */
export function isLockedContext(name) {
  return REQUIRED_CONTEXTS.has(String(name ?? ''))
}

function contextItems(contexts) {
  return contexts.map((context, index) => {
    const text = typeof context?.text === 'string' ? context.text : ''
    const measure = countText(text)
    const locked = context?.required === true || isLockedContext(context?.name)
    const preview = previewText(text)
    return {
      id: `context:${context?.name ?? index}`,
      channel: 'contexts',
      name: String(context?.name ?? `context-${index}`),
      order: Number.isFinite(context?.order) ? context.order : index,
      chars: measure.chars,
      tokens: measure.tokens,
      locked,
      lockReason: locked ? 'required-context' : undefined,
      ...(preview === undefined ? {} : { preview }),
    }
  })
}

function skillItems(skills) {
  return skills.map((skill) => {
    const description = typeof skill.description === 'string' ? skill.description : ''
    const measure = countText(`${skill.name}\n${description}`)
    const preview = previewText(description)
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
      ...(preview === undefined ? {} : { preview }),
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
    const preview = previewText(description)
    return {
      id: `tool:${schema.name ?? index}`,
      channel: 'tools',
      name: String(schema.name ?? `tool-${index}`),
      order: index,
      chars: measure.chars,
      tokens: measure.tokens,
      deferred: schema.deferLoading === true,
      locked: false,
      ...(preview === undefined ? {} : { preview }),
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

// Why this plugin exists: people collect skills. Every skill's name and
// description sits in the catalog of every request, so a few dozen collected
// skills quietly costs money and dilutes the model's attention. The counts below
// are what the panel leads with — not a generic "how much is injected" figure.
//
// Skills are also not the only thing that grows: tool schemas (MCP servers) are
// a different kind of line item, and on most machines the bigger one. Kinds are
// reported side by side so "my skills are 3k, then why is the prompt 84k" is
// answered on the same card instead of left to the reader.
function kindOf(item) {
  if (item.channel === 'skills') return 'skills'
  if (item.channel === 'tools') return 'tools'
  if (item.channel === 'sections') return 'prompts'
  if (item.channel === 'contexts') return 'prompts'
  return 'rules'
}

function skillFocus(skills, items, totals) {
  const rows = items.filter((item) => item.channel === 'skills')
  const catalogTokens = rows.reduce((sum, item) => sum + item.tokens, 0)
  const total = Math.max(1, totals.tokens)
  const byProvider = new Map()
  for (const row of rows) {
    const key = String(row.provider || row.source || 'skills')
    const entry = byProvider.get(key) ?? { provider: key, count: 0, tokens: 0, unlocked: 0 }
    entry.count += 1
    entry.tokens += row.tokens
    if (!row.locked) entry.unlocked += 1
    byProvider.set(key, entry)
  }
  const providers = [...byProvider.values()].sort((left, right) => right.tokens - left.tokens)
  const heaviest = rows.slice().sort((left, right) => right.tokens - left.tokens)[0] ?? null

  // Same three kinds everywhere: what the reader compares, not a raw dump.
  const kinds = { skills: { count: 0, tokens: 0 }, tools: { count: 0, tokens: 0 }, prompts: { count: 0, tokens: 0 }, rules: { count: 0, tokens: 0 } }
  for (const item of items) {
    const kind = kinds[kindOf(item)]
    kind.count += 1
    kind.tokens += item.tokens
  }
  const kindsOut = Object.entries(kinds).map(([id, entry]) => ({ id, count: entry.count, tokens: entry.tokens, share: percent(entry.tokens, total) }))

  return {
    total: rows.length,
    modelVisible: skills.modelVisible?.length ?? 0,
    userOnly: skills.userOnly ?? 0,
    truncated: rows.filter((row) => row.truncated).length,
    catalogTokens,
    catalogShare: percent(catalogTokens, total),
    averageTokens: rows.length === 0 ? 0 : Math.round(catalogTokens / rows.length),
    providers: providers.length,
    heaviest: heaviest === null ? null : { name: heaviest.name, tokens: heaviest.tokens, provider: heaviest.provider ?? null },
    topProviders: providers.slice(0, 5),
    kinds: kindsOut,
  }
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
      // Kept whole for /content: a skill row can be hidden by policy and still
      // be worth reading, and its registered path lives on the same object.
      all,
      modelVisible: all.filter((skill) => skill.invocation?.modelInvocable === true),
      userOnly: all.filter((skill) => skill.invocation?.modelInvocable !== true && skill.invocation?.userInvocable === true).length,
    }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

// Raw collection shared by the snapshot pipeline and the content route.
//
// Both consumers need the same four sources (assembled prompt, skill catalogs,
// tool schemas, instruction files), and assembling the prompt is the expensive
// part. A snapshot stores its raw sources here for a short window, and
// `/content` reuses them when the drawer is opened right after a panel read.
// `buildSnapshot` itself always collects fresh data: registries and files can
// change between two builds, and a stale snapshot would be worse than a second
// read.
const SOURCE_TTL_MS = 2000
const SOURCE_CACHE_LIMIT = 8
const SOURCE_CACHE = new Map()

export function resetSourceCache() {
  SOURCE_CACHE.clear()
}

/** Last collected raw sources for an agent, if they are still within the TTL. */
export function cachedSources(agent) {
  const entry = SOURCE_CACHE.get(cacheKey(agent))
  if (entry === undefined) return undefined
  if (Date.now() - entry.at > SOURCE_TTL_MS) {
    SOURCE_CACHE.delete(cacheKey(agent))
    return undefined
  }
  return entry.sources
}

export async function collectSources(ctx, agent, cwd, signal) {
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

  const skillState = await collectSkills(ctx, agent, cwd, signal)
  let schemas = []
  let toolsError = null
  try {
    schemas = ctx.tools.schemas(agent)
  } catch (error) {
    toolsError = String(error?.message ?? error)
  }
  const instructions = await collectInstructions(cwd)
  const sources = {
    at: Date.now(),
    assembly,
    assemblyError,
    skillState,
    schemas: Array.isArray(schemas) ? schemas : [],
    toolsError,
    instructions,
  }
  const key = cacheKey(agent)
  SOURCE_CACHE.delete(key)
  SOURCE_CACHE.set(key, { at: sources.at, sources })
  if (SOURCE_CACHE.size > SOURCE_CACHE_LIMIT) {
    const oldest = SOURCE_CACHE.keys().next()
    if (!oldest.done) SOURCE_CACHE.delete(oldest.value)
  }
  return sources
}

function collectAnchor(ctx, agent, context) {
  if (context !== undefined && context !== null && Number.isFinite(context.pressure) && context.pressure > 0) {
    return { tokens: context.pressure, source: 'contextPressure' }
  }
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
 * Count how many items stay on per channel under a policy. Used by the apply
 * report so the panel can say "段落 2/25 · 工具 51/280" instead of a token delta.
 */
export function countChannelState(items, policy) {
  const counts = {}
  for (const item of items) {
    const channel = item.channel
    const state = counts[channel] ?? { on: 0, total: 0 }
    state.total += 1
    const rule = policy.channels[channel]
    const on = rule === undefined || rule.mode === 'all' ? true : rule.mode === 'only' ? rule.names.indexOf(item.name) >= 0 : rule.names.indexOf(item.name) < 0
    if (on) state.on += 1
    counts[channel] = state
  }
  return counts
}

// ---------------------------------------------------------------- snapshot

// Items seen on earlier builds, so a switched-off suite can still be listed
// (name, size, suite) and switched back on. The assembled prompt no longer
// contains them, and asking the host for "what would be here if it were on"
// is not part of the public API.
const inventoryCache = new Map()
const nameCache = new Map()
const CACHE_LIMIT = 4000

function cacheKey(agent) {
  return agent && agent.id ? String(agent.id) : 'global'
}

function itemIsOff(policy, item) {
  const rule = policy ? policy[item.channel] : undefined
  if (rule === undefined || rule.mode === 'all') return false
  return rule.mode === 'only' ? rule.names.indexOf(item.name) < 0 : rule.names.indexOf(item.name) >= 0
}

function rememberInventory(agent, items) {
  const key = cacheKey(agent)
  let seen = inventoryCache.get(key)
  if (seen === undefined) {
    seen = new Map()
    inventoryCache.set(key, seen)
  }
  for (const item of items) {
    seen.set(item.channel + ':' + item.name, item)
    nameCache.set(item.channel + ':' + item.name, { tokens: item.tokens, chars: item.chars, group: item.group, groupLabel: item.groupLabel })
  }
  if (seen.size > CACHE_LIMIT) {
    const keep = [...seen.entries()].slice(-CACHE_LIMIT)
    inventoryCache.set(key, new Map(keep))
  }
}

/**
 * Size of items an earlier snapshot already measured. Policy actions use this
 * so a switch event can carry a token delta without re-assembling the prompt
 * just to answer "how much did I just turn off". A name this process never saw
 * contributes 0; the event then says fewer tokens, not a guessed number.
 */
export function estimateItemTokens(channel, names) {
  let tokens = 0
  let known = 0
  for (const name of Array.isArray(names) ? names : []) {
    const entry = nameCache.get(`${channel}:${name}`)
    if (entry === undefined) continue
    tokens += Number(entry.tokens) || 0
    known += 1
  }
  return { tokens, known }
}

// Where an injected item comes from. The host does not tag tool schemas with a
// provider, so the MCP namespace is the honest signal for "installed plugin or
// MCP server"; everything else is a host built-in (prompt sections, runtime
// contexts, instructions and the core tool families). Skills carry a provider:
// a skill that came with a provider or was installed by the user is a plugin
// capability, a skill without one stays built-in.
const MCP_ITEM = /^(?:mcp__|mcp:|tool:mcp__)/

export function itemOrigin(item) {
  if (item?.channel === 'skills') {
    return item?.provider !== undefined || item?.source === 'user' ? 'plugin' : 'builtin'
  }
  return MCP_ITEM.test(String(item?.name ?? '')) ? 'plugin' : 'builtin'
}

function labelFromName(name) {
  const server = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name)
  if (server !== null) return server[1].toUpperCase()
  const section = /^mcp:([^:]+)$/.exec(name)
  if (section !== null) return section[1].toUpperCase()
  return name
}

function collectClosed(agent, policy, items) {
  const seen = inventoryCache.get(cacheKey(agent))
  const present = new Set(items.map((item) => item.channel + ':' + item.name))
  const closed = []
  if (seen !== undefined) {
    for (const [key, cached] of seen) {
      if (present.has(key)) continue
      if (!itemIsOff(policy, cached)) continue
      closed.push({ ...cached, off: true })
    }
  }
  // Fall back to the cross-agent name memory: another session probably saw the
  // tool before this one closed it.
  for (const [key, cached] of nameCache) {
    const separator = key.indexOf(':')
    const channel = key.slice(0, separator)
    const name = key.slice(separator + 1)
    if (present.has(key)) continue
    if (closed.some((item) => item.channel === channel && item.name === name)) continue
    const pseudo = { id: key, channel, name, locked: false }
    if (!itemIsOff(policy, pseudo)) continue
    closed.push({
      id: key,
      channel,
      name,
      chars: cached.chars ?? 0,
      tokens: cached.tokens ?? 0,
      locked: false,
      group: cached.group ?? channel + ':' + labelFromName(name),
      groupLabel: cached.groupLabel ?? labelFromName(name),
      off: true,
    })
  }
  // Names the policy excludes but that were never observed still deserve a row.
  if (policy) {
    for (const channel of CHANNELS) {
      const rule = policy[channel]
      if (rule === undefined) continue
      if (rule.mode !== 'except') continue
      for (const name of rule.names) {
        const key = channel + ':' + name
        if (present.has(key) || closed.some((item) => item.channel === channel && item.name === name)) continue
        const label = labelFromName(name)
        closed.push({ id: key, channel, name, chars: 0, tokens: 0, locked: false, group: channel + ':' + label, groupLabel: label, unknown: true, off: true })
      }
    }
  }
  closed.sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
  const groups = new Map()
  for (const item of closed) {
    const id = item.group ?? item.channel
    const group = groups.get(id) ?? { id, channel: item.channel, label: item.groupLabel ?? item.name, tokens: 0, origin: item.origin ?? 'builtin', items: [] }
    group.tokens += item.tokens
    group.items.push(item)
    groups.set(id, group)
  }
  return { closed, closedGroups: [...groups.values()].sort((a, b) => b.tokens - a.tokens) }
}

export async function buildSnapshot(ctx, agent, scopeSource, signal) {
  const cwd = await resolveCwd(ctx, agent, signal)
  const policyState = await readPolicy()
  const sources = await collectSources(ctx, agent, cwd, signal)
  const assembly = sources.assembly
  const assemblyError = sources.assemblyError

  const sections = sectionItems(Array.isArray(assembly?.sections) ? assembly.sections : [])
  const contexts = contextItems(Array.isArray(assembly?.contexts) ? assembly.contexts : [])
  const skillState = sources.skillState
  const skills = skillState.error === undefined ? skillItems(skillState.modelVisible) : []
  const schemas = sources.schemas
  const toolsError = sources.toolsError
  const tools = toolItems(schemas)
  const instructions = sources.instructions
  const instructionRows = instructionItems(instructions)

  // `on` is the single source of truth the panel renders: does the saved policy
  // include this item in the next session? The panel used to recompute it (and
  // the "heaviest suite" ranking read a field the host never sent, so every
  // suite looked closed on real data). Locked items are always on: no policy can
  // switch them off, so reporting false would contradict the lock explanation.
  const items = assignGroups([...sections, ...contexts, ...skills, ...tools, ...instructionRows]).map((item) => ({
    ...item,
    origin: itemOrigin(item),
    on: item.locked === true ? true : !isExcluded(policyState.policy[item.channel], item.name),
  }))
  rememberInventory(agent, items)
  const closedState = collectClosed(agent, policyState.policy, items)
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
      count: sum.count + channel.count,
      savableTokens: sum.savableTokens + (channel.manageable ? channel.savableTokens : 0),
    }),
    { chars: 0, tokens: 0, count: 0, savableTokens: 0 },
  )

  // What the next session actually gets under the current policy, per channel.
  const effectiveChannels = CHANNELS.map((channel) => {
    // `on` already encodes the locked-items rule (a policy that names a locked
    // item still cannot switch it off), so the effective projection and the
    // per-item flag stay one answer instead of two.
    const rows = items.filter((item) => item.channel === channel && item.on !== false)
    return {
      id: channel,
      count: rows.length,
      chars: rows.reduce((sum, item) => sum + item.chars, 0),
      tokens: rows.reduce((sum, item) => sum + item.tokens, 0),
      savableTokens: rows.filter((item) => !item.locked).reduce((sum, item) => sum + item.tokens, 0),
      manageable: true,
    }
  })
  effectiveChannels.push({ ...channels[channels.length - 1], manageable: false })
  const effectiveTotals = effectiveChannels.reduce(
    (sum, channel) => ({
      chars: sum.chars + channel.chars,
      tokens: sum.tokens + channel.tokens,
      count: sum.count + channel.count,
      savableTokens: sum.savableTokens + (channel.manageable ? channel.savableTokens : 0),
    }),
    { chars: 0, tokens: 0, count: 0, savableTokens: 0 },
  )
  effectiveTotals.savablePercent = percent(effectiveTotals.savableTokens, effectiveTotals.tokens)

  const preview = previewPolicy(policyState.policy, items, channelNames)
  const context = await readContext(ctx, agent, signal)
  const anchor = collectAnchor(ctx, agent, context)
  const applied = agent !== undefined && agent !== null && appliedAgents.has(agent)
  // Skills are the reason most people need this plugin at all, so the snapshot
  // carries a dedicated view of the catalog rather than leaving the panel to
  // count rows in a 300-item list.
  const skillView = skillFocus(skillState, items, totals)

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
    manageableShare: percent(totals.savableTokens, totals.tokens),
  }

  const result = {
    generatedAt: Date.now(),
    cwd,
    agent: { id: typeof agent?.id === 'string' ? agent.id : undefined, scopeSource },
    channels,
    context: { ...context, compaction: compactionOf(agent), tone: occupancyTone(context) },
    effective: { channels: effectiveChannels, totals: effectiveTotals },
    items,
    groups,
    closed: closedState.closed,
    closedGroups: closedState.closedGroups,
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
      ...skillView,
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
    host: hostInfo(),
  }
  // History for the 统计 tab: every measured conversation contributes one row.
  // Wrapped because a statistics side effect must never fail a read.
  try {
    recordSnapshot(result)
  } catch {
    /* history is optional */
  }
  return result
}

// Filled in by index.js so the snapshot can report application state without
// importing the applier (which would create a cycle).
export const appliedAgents = new WeakSet()
export let lastApplicationState = null
export function setLastApplication(state) {
  lastApplicationState = state
}
