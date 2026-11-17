// Clustering: turn several hundred flat entries into a handful of suites.
//
// The registry does not tell us which plugin registered a tool (ToolSchema is
// only name/description/parameters), so tools are grouped by their own naming:
// an MCP server namespace (`mcp__rea__…`) is one suite, and otherwise a shared
// leading segment is a family when at least two tools use it. Skills do carry a
// provider, so they group by that directly.
//
// The point is the user's own sentence: "REA 那是一套" — one switch for the
// whole server instead of 250 switches.

// Segments that describe an action, not a product; they would create groups
// like "list" or "create" that mean nothing.
const GENERIC_SEGMENTS = new Set([
  'read',
  'write',
  'edit',
  'apply',
  'list',
  'get',
  'create',
  'update',
  'set',
  'delete',
  'run',
  'send',
  'wait',
  'exit',
  'load',
  'inspect',
  'search',
  'import',
  'export',
  'present',
  'skill',
  'workflow',
  'context',
  'working',
  'todo',
  'ask',
  'plugin',
  'reset',
  'start',
  'stop',
  'open',
  'close',
  'add',
  'remove',
])

const mcpServerOf = (name) => {
  if (!name.startsWith('mcp__')) return undefined
  const rest = name.slice('mcp__'.length)
  const end = rest.indexOf('__')
  return end > 0 ? rest.slice(0, end) : rest.split('_')[0]
}

/**
 * Build one cluster map for every item of a snapshot.
 * Item channel decides the naming rule; ids are `channel:key` so two channels
 * can both have a "team" group without colliding.
 */
export function assignGroups(items) {
  const toolNames = items.filter((item) => item.channel === 'tools').map((item) => item.name)
  const segmentCount = new Map()
  for (const name of toolNames) {
    if (name.startsWith('mcp__')) continue
    const segment = name.split('_')[0]
    segmentCount.set(segment, (segmentCount.get(segment) ?? 0) + 1)
  }

  const familyOfTool = (name) => {
    const server = mcpServerOf(name)
    if (server !== undefined) return { key: `mcp:${server}`, label: server.toUpperCase() }
    const segment = name.split('_')[0]
    if (GENERIC_SEGMENTS.has(segment)) return { key: 'core', label: 'core' }
    if ((segmentCount.get(segment) ?? 0) >= 2) return { key: segment, label: segment }
    return { key: 'core', label: 'core' }
  }

  const familyOfSection = (name) => {
    if (name.startsWith('mcp:')) {
      const server = name.slice('mcp:'.length)
      return { key: `mcp:${server}`, label: server.toUpperCase() }
    }
    const toolMatch = /^tool:([A-Za-z0-9_]+)/.exec(name)
    if (toolMatch !== null) {
      const inner = toolMatch[1]
      const server = mcpServerOf(inner)
      if (server !== undefined) return { key: `mcp:${server}`, label: server.toUpperCase() }
      const family = familyOfTool(inner)
      return family.key === 'core' ? { key: 'tool-guidance', label: 'tool-guidance' } : family
    }
    if (name.startsWith('tool:')) return { key: 'tool-guidance', label: 'tool-guidance' }
    const head = name.split(':')[0]
    return { key: head, label: head }
  }

  const familyOfContext = (name) => {
    const parts = name.split(':')
    if (parts[0] === 'tool' && parts.length > 1) return { key: `tool:${parts[1]}`, label: `tool:${parts[1]}` }
    return { key: parts[0], label: parts[0] }
  }

  return items.map((item) => {
    let family
    if (item.channel === 'sections') family = familyOfSection(item.name)
    else if (item.channel === 'contexts') family = familyOfContext(item.name)
    else if (item.channel === 'skills') {
      const key = String(item.provider || item.source || 'skills')
      family = { key, label: key }
    } else if (item.channel === 'instructions') family = { key: 'rules', label: 'rules' }
    else family = familyOfTool(item.name)

    return { ...item, group: `${item.channel}:${family.key}`, groupLabel: family.label }
  })
}

/** Per-group totals for the panel and the tool card, largest first.
 *
 * `tokens`/`count` describe the suite as it was measured (everything on);
 * `onTokens`/`onCount` describe what the saved policy leaves in the next
 * request. Health checks read the `on*` fields so a suite that was just closed
 * stops warning about itself — the panel's counters were already effective while
 * the health strip still measured the all-on state.
 */
export function summarizeGroups(items) {
  const groups = new Map()
  for (const item of items) {
    const entry = groups.get(item.group) ?? {
      id: item.group,
      channel: item.channel,
      label: item.groupLabel,
      origin: item.origin === 'plugin' ? 'plugin' : 'builtin',
      count: 0,
      tokens: 0,
      chars: 0,
      savableTokens: 0,
      locked: 0,
      onCount: 0,
      offCount: 0,
      onTokens: 0,
      offTokens: 0,
      onSavableTokens: 0,
    }
    if (item.origin === 'plugin') entry.origin = 'plugin'
    entry.count += 1
    entry.tokens += item.tokens
    entry.chars += item.chars
    if (item.locked) entry.locked += 1
    else entry.savableTokens += item.tokens
    // A snapshot from before the `on` field existed reads as everything on;
    // the effective counters are only meaningful once the host stamps it.
    if (item.on === false) {
      entry.offCount += 1
      entry.offTokens += item.tokens
    } else {
      entry.onCount += 1
      entry.onTokens += item.tokens
      if (!item.locked) entry.onSavableTokens += item.tokens
    }
    groups.set(item.group, entry)
  }
  return [...groups.values()].sort((left, right) => right.tokens - left.tokens)
}
